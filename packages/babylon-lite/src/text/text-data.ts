/** TextData — slot-allocator-backed per-instance vertex buffer for a text block.
 *
 *  Each draw group owns a contiguous slot range `[slotStart, slotStart + slotCount)`
 *  in the shared instance buffer. Live and dead slots intermix within that range;
 *  dead slots carry a sentinel (`slugAnchor.w = 1`) that the vertex shader detects
 *  and turns into a degenerate off-screen triangle. `addRun` / `replaceRun` reuse
 *  from the group's `freeSlots` LIFO when possible; otherwise they extend the
 *  group's range (shifting later *groups* — never other runs in the same group).
 *  `removeRun` writes the sentinel into its slots and returns them to the free-list.
 *
 *  Cost per edit: O(touched glyphs) in the common single-font case, with an extra
 *  O(later-group slot count) shift only when the touched group must grow.
 */

import type { CurveSetId, GlyphCurves, GlyphRun, TextDataUpdate } from "./public-types.js";
import type { RunRecord, SharedAtlas, TextData, TextDataDrawGroup, TextDataInternals } from "./internal.js";
import { getSharedAtlasForCurves, setSharedAtlasForCurves, getTextDataInternals, setTextDataInternals } from "./internal.js";
import { createSharedAtlas, packAppendGlyph } from "./slug-pack.js";
import { disposeSharedAtlasGpu } from "./_gpu/slug-textures.js";

/** Bytes per instance: 5 vec4 attributes (slugBounds, slugAnchor, slugAtlas, slugBand, slugColor). */
export const TEXT_INSTANCE_FLOATS = 20;
export const TEXT_INSTANCE_BYTES = TEXT_INSTANCE_FLOATS * 4;

const WHITE_COLOR: readonly [number, number, number, number] = [1, 1, 1, 1];

// ─── Atlas helpers ─────────────────────────────────────────────────────────

function getOrCreateAtlas(curves: ReadonlyMap<number, GlyphCurves>): SharedAtlas {
    let atlas = getSharedAtlasForCurves(curves);
    if (!atlas) {
        atlas = createSharedAtlas();
        setSharedAtlasForCurves(curves, atlas);
    }
    return atlas;
}

function syncAtlasGlyphs(atlas: SharedAtlas, curves: ReadonlyMap<number, GlyphCurves>): void {
    for (const [glyphId, glyph] of curves) {
        if (!atlas.glyphSlots.has(glyphId)) {
            atlas.glyphSlots.set(glyphId, packAppendGlyph(atlas, glyph));
        }
    }
}

function releaseAtlasRef(atlas: SharedAtlas): void {
    if (atlas.refCount > 0) {
        atlas.refCount--;
    }
    if (atlas.refCount === 0) {
        disposeSharedAtlasGpu(atlas);
    }
}

function acquireAtlasRef(internals: TextDataInternals, atlas: SharedAtlas): void {
    if (!internals.refdAtlases.has(atlas)) {
        atlas.refCount++;
        internals.refdAtlases.add(atlas);
    }
}

// ─── Per-slot packing ──────────────────────────────────────────────────────

function packGlyphAtSlot(
    out: Float32Array,
    slot: number,
    atlas: SharedAtlas,
    curves: ReadonlyMap<number, GlyphCurves>,
    glyphId: number,
    x: number,
    y: number,
    invScale: number,
    color: readonly [number, number, number, number]
): boolean {
    const glyph = curves.get(glyphId);
    const atlasSlot = atlas.glyphSlots.get(glyphId);
    if (!glyph || !atlasSlot) {
        return false;
    }
    const { xMin, yMin, xMax, yMax } = glyph.bounds;
    const widthFu = xMax - xMin;
    const heightFu = yMax - yMin;
    const bandScaleX = widthFu > 0 ? atlasSlot.vBandCount / widthFu : 0;
    const bandScaleY = heightFu > 0 ? atlasSlot.hBandCount / heightFu : 0;
    const bandOffsetX = -xMin * bandScaleX;
    const bandOffsetY = -yMin * bandScaleY;
    const w = slot * TEXT_INSTANCE_FLOATS;
    out[w] = xMin;
    out[w + 1] = yMin;
    out[w + 2] = xMax;
    out[w + 3] = yMax;
    out[w + 4] = x;
    out[w + 5] = y;
    out[w + 6] = invScale;
    out[w + 7] = 0; // slugAnchor.w = 0 → live
    out[w + 8] = atlasSlot.glyphLocX;
    out[w + 9] = atlasSlot.glyphLocY;
    out[w + 10] = atlasSlot.bandMaxX;
    out[w + 11] = atlasSlot.bandMaxY;
    out[w + 12] = bandScaleX;
    out[w + 13] = bandScaleY;
    out[w + 14] = bandOffsetX;
    out[w + 15] = bandOffsetY;
    out[w + 16] = color[0];
    out[w + 17] = color[1];
    out[w + 18] = color[2];
    out[w + 19] = color[3];
    return true;
}

function markSlotDead(out: Float32Array, slot: number): void {
    const base = slot * TEXT_INSTANCE_FLOATS;
    for (let i = 0; i < TEXT_INSTANCE_FLOATS; i++) {
        out[base + i] = 0;
    }
    out[base + 7] = 1; // sentinel
}

// ─── Buffer + dirty-range helpers ──────────────────────────────────────────

function ensureInstanceCapacity(internals: TextDataInternals, requiredInstances: number): void {
    const requiredFloats = requiredInstances * TEXT_INSTANCE_FLOATS;
    if (internals.instances.length >= requiredFloats) {
        return;
    }
    let newLen = Math.max(internals.instances.length * 2, TEXT_INSTANCE_FLOATS);
    while (newLen < requiredFloats) {
        newLen *= 2;
    }
    const grown = new Float32Array(newLen);
    grown.set(internals.instances.subarray(0, internals.instanceCount * TEXT_INSTANCE_FLOATS));
    internals.instances = grown;
    internals.dirtyStart = 0;
    internals.dirtyEnd = internals.instanceCount;
}

function markDirty(internals: TextDataInternals, startInstance: number, endInstance: number): void {
    if (endInstance <= startInstance) {
        return;
    }
    if (internals.dirtyStart === internals.dirtyEnd) {
        internals.dirtyStart = startInstance;
        internals.dirtyEnd = endInstance;
    } else {
        if (startInstance < internals.dirtyStart) {
            internals.dirtyStart = startInstance;
        }
        if (endInstance > internals.dirtyEnd) {
            internals.dirtyEnd = endInstance;
        }
    }
    internals.version++;
}

// ─── Slot allocator ────────────────────────────────────────────────────────

/** Pop a slot from `group.freeSlots`, or -1 if none. */
function popFreeSlot(group: TextDataDrawGroup): number {
    return group.freeSlots.length > 0 ? group.freeSlots.pop()! : -1;
}

/** Grow `group` by `extraSlots`. Returns the absolute index of the first newly-added
 *  slot. Shifts later groups' slot ranges right by `extraSlots` and rewrites any run
 *  slot indices that fall in the shifted range. Marks the shifted region dirty. */
function growGroup(internals: TextDataInternals, group: TextDataDrawGroup, extraSlots: number): number {
    const insertAt = group.slotStart + group.slotCount;
    if (extraSlots <= 0) {
        return insertAt;
    }
    ensureInstanceCapacity(internals, internals.instanceCount + extraSlots);
    const floatDelta = extraSlots * TEXT_INSTANCE_FLOATS;
    const moveStartFloat = insertAt * TEXT_INSTANCE_FLOATS;
    const moveEndFloat = internals.instanceCount * TEXT_INSTANCE_FLOATS;
    if (moveEndFloat > moveStartFloat) {
        internals.instances.copyWithin(moveStartFloat + floatDelta, moveStartFloat, moveEndFloat);
    }
    // Shift later groups + their freeSlots arrays.
    for (const g of internals.groups) {
        if (g !== group && g.slotStart >= insertAt) {
            g.slotStart += extraSlots;
            for (let i = 0; i < g.freeSlots.length; i++) {
                g.freeSlots[i] = g.freeSlots[i]! + extraSlots;
            }
        }
    }
    // Shift any run records whose slots fall inside the shifted region.
    for (const rec of internals.runRecords.values()) {
        const slots = rec.slots;
        for (let i = 0; i < slots.length; i++) {
            if (slots[i]! >= insertAt) {
                slots[i] = slots[i]! + extraSlots;
            }
        }
    }
    internals.instanceCount += extraSlots;
    group.slotCount += extraSlots;
    // Newly-added slots and the shifted region are dirty.
    markDirty(internals, insertAt, internals.instanceCount);
    return insertAt;
}

/** Allocate `count` slots for `group`. Reuses free slots first, then extends. Returns
 *  the array of absolute slot indices in the order they were allocated. */
function allocateSlots(internals: TextDataInternals, group: TextDataDrawGroup, count: number): number[] {
    const out: number[] = new Array(count);
    let extendNeeded = 0;
    for (let i = 0; i < count; i++) {
        const reused = popFreeSlot(group);
        if (reused !== -1) {
            out[i] = reused;
        } else {
            out[i] = -1;
            extendNeeded++;
        }
    }
    if (extendNeeded > 0) {
        const firstNewSlot = growGroup(internals, group, extendNeeded);
        let n = firstNewSlot;
        for (let i = 0; i < count; i++) {
            if (out[i] === -1) {
                out[i] = n++;
            }
        }
    }
    return out;
}

/** Release `slots` back to `group.freeSlots`, marking each dead in the buffer. */
function freeSlots(internals: TextDataInternals, group: TextDataDrawGroup, slots: number[]): void {
    let minSlot = Number.POSITIVE_INFINITY;
    let maxSlot = -1;
    for (const s of slots) {
        markSlotDead(internals.instances, s);
        group.freeSlots.push(s);
        if (s < minSlot) minSlot = s;
        if (s > maxSlot) maxSlot = s;
    }
    if (maxSlot >= 0) {
        markDirty(internals, minSlot, maxSlot + 1);
    }
}

// ─── Draw-group helpers ────────────────────────────────────────────────────

function findGroup(internals: TextDataInternals, curveSetId: CurveSetId): TextDataDrawGroup | undefined {
    for (const g of internals.groups) {
        if (g.curveSetId === curveSetId) {
            return g;
        }
    }
    return undefined;
}

function ensureGroup(internals: TextDataInternals, curveSetId: CurveSetId): TextDataDrawGroup {
    const existing = findGroup(internals, curveSetId);
    if (existing) {
        return existing;
    }
    const curves = internals.curves.get(curveSetId);
    if (!curves) {
        throw new Error(`updateTextData: addRun references unknown curveSet "${curveSetId}" — call addCurves (or reset) for this curve set first.`);
    }
    const atlas = getOrCreateAtlas(curves);
    syncAtlasGlyphs(atlas, curves);
    acquireAtlasRef(internals, atlas);
    const group: TextDataDrawGroup = {
        curveSetId,
        curves,
        atlas,
        slotStart: internals.instanceCount,
        slotCount: 0,
        liveCount: 0,
        freeSlots: [],
        _bindGroup: null,
        _bindGroupVersion: -1,
    };
    internals.groups.push(group);
    return group;
}

/** Write a run's glyphs into the given (already-allocated) slots. Returns the subset of
 *  slots that actually received live glyphs (skipped glyphs leave their slot dead). */
function writeRunToSlots(internals: TextDataInternals, group: TextDataDrawGroup, run: GlyphRun, slots: number[]): number[] {
    const ratio = run.pixelsPerFontUnit;
    const invScale = ratio !== 0 ? 1 / ratio : 0;
    const runColor = run.defaultColor ?? WHITE_COLOR;
    const liveSlots: number[] = [];
    let minSlot = Number.POSITIVE_INFINITY;
    let maxSlot = -1;
    for (let i = 0; i < run.glyphs.length; i++) {
        const pg = run.glyphs[i]!;
        const slot = slots[i]!;
        const color = pg.color ?? runColor;
        const ok = packGlyphAtSlot(internals.instances, slot, group.atlas, group.curves, pg.glyphId, pg.x, pg.y, invScale, color);
        if (ok) {
            liveSlots.push(slot);
        } else {
            markSlotDead(internals.instances, slot);
            group.freeSlots.push(slot);
        }
        if (slot < minSlot) minSlot = slot;
        if (slot > maxSlot) maxSlot = slot;
    }
    if (maxSlot >= 0) {
        markDirty(internals, minSlot, maxSlot + 1);
    }
    return liveSlots;
}

// ─── reset (also serves as compaction) ─────────────────────────────────────

function applyReset(internals: TextDataInternals, runs: GlyphRun[], curves: Map<CurveSetId, Map<number, GlyphCurves>>): void {
    // Pre-reserve capacity for total glyphs across all runs.
    let totalGlyphs = 0;
    for (const run of runs) {
        totalGlyphs += run.glyphs.length;
    }
    const required = totalGlyphs * TEXT_INSTANCE_FLOATS;
    if (internals.instances.length < required) {
        let newLen = Math.max(internals.instances.length * 2, TEXT_INSTANCE_FLOATS);
        while (newLen < required) {
            newLen *= 2;
        }
        internals.instances = new Float32Array(newLen);
    }

    // Preserve previous groups for bind-group/atlas reuse.
    const prevGroupByCurveSet = new Map<CurveSetId, TextDataDrawGroup>();
    for (const g of internals.groups) {
        prevGroupByCurveSet.set(g.curveSetId, g);
    }

    internals.curves = curves;

    // Group runs by curveSet so each group's slots are contiguous initially.
    const runsByCurveSet = new Map<CurveSetId, GlyphRun[]>();
    for (const run of runs) {
        let list = runsByCurveSet.get(run.curveSet);
        if (!list) {
            list = [];
            runsByCurveSet.set(run.curveSet, list);
        }
        list.push(run);
    }

    const newGroups: TextDataDrawGroup[] = [];
    const newRunRecords = new Map<GlyphRun, RunRecord>();
    let writeSlot = 0;

    for (const [curveSetId, groupRuns] of runsByCurveSet) {
        const groupCurves = curves.get(curveSetId);
        if (!groupCurves) {
            throw new Error(`updateTextData reset: run references unknown curveSet "${curveSetId}" (not in curves map).`);
        }
        const atlas = getOrCreateAtlas(groupCurves);
        syncAtlasGlyphs(atlas, groupCurves);

        const existing = prevGroupByCurveSet.get(curveSetId);
        const group: TextDataDrawGroup =
            existing ??
            ({
                curveSetId,
                curves: groupCurves,
                atlas,
                slotStart: writeSlot,
                slotCount: 0,
                liveCount: 0,
                freeSlots: [],
                _bindGroup: null,
                _bindGroupVersion: -1,
            } as TextDataDrawGroup);
        group.curves = groupCurves;
        if (group.atlas !== atlas) {
            group.atlas = atlas;
            group._bindGroup = null;
            group._bindGroupVersion = -1;
        }
        group.slotStart = writeSlot;
        group.freeSlots = [];

        const groupIdx = newGroups.length;
        let liveInGroup = 0;
        for (const run of groupRuns) {
            const slots: number[] = new Array(run.glyphs.length);
            for (let i = 0; i < run.glyphs.length; i++) {
                slots[i] = writeSlot++;
            }
            const live = writeRunToSlots(internals, group, run, slots);
            liveInGroup += live.length;
            newRunRecords.set(run, { run, groupIdx, slots: live });
        }
        group.slotCount = writeSlot - group.slotStart;
        group.liveCount = liveInGroup;
        newGroups.push(group);
    }

    internals.instanceCount = writeSlot;
    internals.groups = newGroups;
    internals.runs.length = 0;
    for (const r of runs) {
        internals.runs.push(r);
    }
    internals.runRecords = newRunRecords;

    // Reconcile atlas refs.
    const newAtlases = new Set<SharedAtlas>();
    for (const g of newGroups) {
        newAtlases.add(g.atlas);
    }
    for (const atlas of newAtlases) {
        if (!internals.refdAtlases.has(atlas)) {
            atlas.refCount++;
        }
    }
    for (const atlas of internals.refdAtlases) {
        if (!newAtlases.has(atlas)) {
            releaseAtlasRef(atlas);
        }
    }
    internals.refdAtlases = newAtlases;

    internals.dirtyStart = 0;
    internals.dirtyEnd = writeSlot;
    internals.version++;
}

// ─── addCurves ─────────────────────────────────────────────────────────────

function applyAddCurves(internals: TextDataInternals, curveSetId: CurveSetId, curves: Map<number, GlyphCurves>): void {
    const existing = internals.curves.get(curveSetId);
    if (existing && existing !== curves) {
        for (const [glyphId, glyph] of curves) {
            if (!existing.has(glyphId)) {
                existing.set(glyphId, glyph);
            }
        }
        const atlas = getOrCreateAtlas(existing);
        syncAtlasGlyphs(atlas, existing);
        return;
    }
    if (!existing) {
        internals.curves.set(curveSetId, curves);
    }
    const atlas = getOrCreateAtlas(internals.curves.get(curveSetId)!);
    syncAtlasGlyphs(atlas, internals.curves.get(curveSetId)!);
}

// ─── addRun / removeRun / replaceRun ───────────────────────────────────────

function resolveRun(internals: TextDataInternals, ref: GlyphRun | number): GlyphRun {
    if (typeof ref === "number") {
        const r = internals.runs[ref];
        if (!r) {
            throw new Error(`updateTextData: run index ${ref} out of range (0..${internals.runs.length - 1}).`);
        }
        return r;
    }
    return ref;
}

function applyAddRun(internals: TextDataInternals, run: GlyphRun, insertBefore?: number): void {
    if (internals.runRecords.has(run)) {
        throw new Error("updateTextData addRun: GlyphRun reference is already in this TextData.");
    }
    const group = ensureGroup(internals, run.curveSet);
    const groupIdx = internals.groups.indexOf(group);
    const slots = allocateSlots(internals, group, run.glyphs.length);
    const live = writeRunToSlots(internals, group, run, slots);
    group.liveCount += live.length;
    internals.runRecords.set(run, { run, groupIdx, slots: live });
    const at = insertBefore ?? internals.runs.length;
    internals.runs.splice(at, 0, run);
}

function applyRemoveRun(internals: TextDataInternals, ref: GlyphRun | number): void {
    const run = resolveRun(internals, ref);
    const rec = internals.runRecords.get(run);
    if (!rec) {
        throw new Error("updateTextData removeRun: GlyphRun reference is not in this TextData.");
    }
    const group = internals.groups[rec.groupIdx]!;
    freeSlots(internals, group, rec.slots);
    group.liveCount -= rec.slots.length;
    internals.runRecords.delete(run);
    const runIdx = internals.runs.indexOf(run);
    if (runIdx >= 0) {
        internals.runs.splice(runIdx, 1);
    }
    // If the group has no live instances left, drop it entirely and shrink the buffer tail.
    if (group.liveCount === 0) {
        dropEmptyGroup(internals, group);
    }
}

/** Remove a group with no live instances. Shifts later groups left over the vacated range. */
function dropEmptyGroup(internals: TextDataInternals, group: TextDataDrawGroup): void {
    const idx = internals.groups.indexOf(group);
    if (idx < 0) {
        return;
    }
    const removedStart = group.slotStart;
    const removedCount = group.slotCount;
    internals.groups.splice(idx, 1);
    // Re-index groupIdx for runs in later groups.
    for (const r of internals.runRecords.values()) {
        if (r.groupIdx > idx) {
            r.groupIdx--;
        }
    }
    if (removedCount > 0) {
        const floatDelta = removedCount * TEXT_INSTANCE_FLOATS;
        const moveStartFloat = (removedStart + removedCount) * TEXT_INSTANCE_FLOATS;
        const moveEndFloat = internals.instanceCount * TEXT_INSTANCE_FLOATS;
        if (moveEndFloat > moveStartFloat) {
            internals.instances.copyWithin(moveStartFloat - floatDelta, moveStartFloat, moveEndFloat);
        }
        for (const g of internals.groups) {
            if (g.slotStart >= removedStart) {
                g.slotStart -= removedCount;
                for (let i = 0; i < g.freeSlots.length; i++) {
                    g.freeSlots[i] = g.freeSlots[i]! - removedCount;
                }
            }
        }
        for (const r of internals.runRecords.values()) {
            const slots = r.slots;
            for (let i = 0; i < slots.length; i++) {
                if (slots[i]! >= removedStart) {
                    slots[i] = slots[i]! - removedCount;
                }
            }
        }
        internals.instanceCount -= removedCount;
        markDirty(internals, removedStart, internals.instanceCount);
    }
    // Drop atlas ref if no remaining group uses it.
    let stillReferenced = false;
    for (const g of internals.groups) {
        if (g.atlas === group.atlas) {
            stillReferenced = true;
            break;
        }
    }
    if (!stillReferenced) {
        internals.refdAtlases.delete(group.atlas);
        releaseAtlasRef(group.atlas);
    }
}

function applyReplaceRun(internals: TextDataInternals, prevRef: GlyphRun | number, newRun: GlyphRun): void {
    const prev = resolveRun(internals, prevRef);
    const rec = internals.runRecords.get(prev);
    if (!rec) {
        throw new Error("updateTextData replaceRun: previous GlyphRun reference is not in this TextData.");
    }
    if (prev !== newRun && internals.runRecords.has(newRun)) {
        throw new Error("updateTextData replaceRun: new GlyphRun reference is already in this TextData.");
    }
    const group = internals.groups[rec.groupIdx]!;
    const sameGroup = newRun.curveSet === group.curveSetId;
    if (sameGroup && newRun.glyphs.length === rec.slots.length) {
        // In-place rewrite over the existing slots.
        const live = writeRunToSlots(internals, group, newRun, rec.slots);
        if (live.length === rec.slots.length) {
            // All glyphs succeeded; reuse same slot list.
            internals.runRecords.delete(prev);
            internals.runRecords.set(newRun, { run: newRun, groupIdx: rec.groupIdx, slots: live });
            const runIdx = internals.runs.indexOf(prev);
            if (runIdx >= 0) {
                internals.runs[runIdx] = newRun;
            }
            return;
        }
        // Some glyphs missed atlas — writeRunToSlots already pushed the missed slots to
        // freeSlots. Update bookkeeping.
        group.liveCount -= rec.slots.length - live.length;
        internals.runRecords.delete(prev);
        internals.runRecords.set(newRun, { run: newRun, groupIdx: rec.groupIdx, slots: live });
        const runIdx = internals.runs.indexOf(prev);
        if (runIdx >= 0) {
            internals.runs[runIdx] = newRun;
        }
        return;
    }
    // Different size or different group → remove + add at the same position.
    const insertPos = internals.runs.indexOf(prev);
    applyRemoveRun(internals, prev);
    applyAddRun(internals, newRun, insertPos >= 0 ? insertPos : undefined);
}

// ─── Public API ────────────────────────────────────────────────────────────

export function createTextData(initial?: { runs: GlyphRun[]; curves: Map<CurveSetId, Map<number, GlyphCurves>> }): TextData {
    const runs: GlyphRun[] = [];
    const data = { runs } as unknown as TextData;
    const internals: TextDataInternals = {
        groups: [],
        runs,
        runRecords: new Map(),
        instances: new Float32Array(TEXT_INSTANCE_FLOATS),
        instanceCount: 0,
        curves: new Map(),
        refdAtlases: new Set(),
        version: 1,
        dirtyStart: 0,
        dirtyEnd: 0,
        _gpu: null,
    };
    setTextDataInternals(data, internals);
    if (initial) {
        applyReset(internals, initial.runs, initial.curves);
    }
    return data;
}

export function updateTextData(data: TextData, update: TextDataUpdate): void {
    const internals = getTextDataInternals(data);
    if (!internals) {
        throw new Error("updateTextData: invalid TextData (was it produced by createTextData?).");
    }
    switch (update.update) {
        case "reset":
            applyReset(internals, update.runs, update.curves);
            return;
        case "addCurves":
            applyAddCurves(internals, update.curveSetId, update.curves);
            return;
        case "addRun":
            applyAddRun(internals, update.run, update.insertBefore);
            return;
        case "removeRun":
            applyRemoveRun(internals, update.run);
            return;
        case "replaceRun":
            applyReplaceRun(internals, update.previous, update.run);
            return;
    }
}

export function disposeTextData(data: TextData): void {
    const internals = getTextDataInternals(data);
    if (!internals) {
        return;
    }
    if (internals._gpu) {
        internals._gpu.instanceBuf.destroy();
        internals._gpu = null;
    }
    for (const g of internals.groups) {
        g._bindGroup = null;
    }
    internals.groups = [];
    internals.instanceCount = 0;
    internals.runs.length = 0;
    internals.runRecords.clear();
    for (const atlas of internals.refdAtlases) {
        releaseAtlasRef(atlas);
    }
    internals.refdAtlases.clear();
}

/** @internal Read TextData internals from a renderable. */
export function getTextDataInternalsOrThrow(data: TextData): TextDataInternals {
    const i = getTextDataInternals(data);
    if (!i) {
        throw new Error("Text: TextData has no internals (invalid handle).");
    }
    return i;
}

/** @internal Reset dirty range to empty after a renderer has uploaded its bytes. */
export function clearTextDataDirtyRange(internals: TextDataInternals): void {
    internals.dirtyStart = 0;
    internals.dirtyEnd = 0;
}