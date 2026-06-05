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
import type { RunRecord, SharedAtlas, TextData, TextDataDrawGroup } from "./internal.js";
import { getSharedAtlasForCurves, setSharedAtlasForCurves } from "./internal.js";
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

function acquireAtlasRef(data: TextData, atlas: SharedAtlas): void {
    if (!data._refdAtlases.has(atlas)) {
        atlas.refCount++;
        data._refdAtlases.add(atlas);
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

function ensureInstanceCapacity(data: TextData, requiredInstances: number): void {
    const requiredFloats = requiredInstances * TEXT_INSTANCE_FLOATS;
    if (data._instances.length >= requiredFloats) {
        return;
    }
    let newLen = Math.max(data._instances.length * 2, TEXT_INSTANCE_FLOATS);
    while (newLen < requiredFloats) {
        newLen *= 2;
    }
    const grown = new Float32Array(newLen);
    grown.set(data._instances.subarray(0, data._instanceCount * TEXT_INSTANCE_FLOATS));
    data._instances = grown;
    data._dirtyStart = 0;
    data._dirtyEnd = data._instanceCount;
}

function markDirty(data: TextData, startInstance: number, endInstance: number): void {
    if (endInstance <= startInstance) {
        return;
    }
    if (data._dirtyStart === data._dirtyEnd) {
        data._dirtyStart = startInstance;
        data._dirtyEnd = endInstance;
    } else {
        if (startInstance < data._dirtyStart) {
            data._dirtyStart = startInstance;
        }
        if (endInstance > data._dirtyEnd) {
            data._dirtyEnd = endInstance;
        }
    }
    data._version++;
}

// ─── Slot allocator ────────────────────────────────────────────────────────

/** Pop a slot from `group.freeSlots`, or -1 if none. */
function popFreeSlot(group: TextDataDrawGroup): number {
    return group.freeSlots.length > 0 ? group.freeSlots.pop()! : -1;
}

/** Grow `group` by `extraSlots`. Returns the absolute index of the first newly-added
 *  slot. Shifts later groups' slot ranges right by `extraSlots` and rewrites any run
 *  slot indices that fall in the shifted range. Marks the shifted region dirty. */
function growGroup(data: TextData, group: TextDataDrawGroup, extraSlots: number): number {
    const insertAt = group.slotStart + group.slotCount;
    if (extraSlots <= 0) {
        return insertAt;
    }
    ensureInstanceCapacity(data, data._instanceCount + extraSlots);
    const floatDelta = extraSlots * TEXT_INSTANCE_FLOATS;
    const moveStartFloat = insertAt * TEXT_INSTANCE_FLOATS;
    const moveEndFloat = data._instanceCount * TEXT_INSTANCE_FLOATS;
    if (moveEndFloat > moveStartFloat) {
        data._instances.copyWithin(moveStartFloat + floatDelta, moveStartFloat, moveEndFloat);
    }
    // Shift later groups + their freeSlots arrays.
    for (const g of data._groups) {
        if (g !== group && g.slotStart >= insertAt) {
            g.slotStart += extraSlots;
            for (let i = 0; i < g.freeSlots.length; i++) {
                g.freeSlots[i] = g.freeSlots[i]! + extraSlots;
            }
        }
    }
    // Shift any run records whose slots fall inside the shifted region.
    for (const rec of data._runRecords.values()) {
        const slots = rec.slots;
        for (let i = 0; i < slots.length; i++) {
            if (slots[i]! >= insertAt) {
                slots[i] = slots[i]! + extraSlots;
            }
        }
    }
    data._instanceCount += extraSlots;
    group.slotCount += extraSlots;
    // Newly-added slots and the shifted region are dirty.
    markDirty(data, insertAt, data._instanceCount);
    return insertAt;
}

/** Allocate `count` slots for `group`. Reuses free slots first, then extends. Returns
 *  the array of absolute slot indices in the order they were allocated. */
function allocateSlots(data: TextData, group: TextDataDrawGroup, count: number): number[] {
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
        const firstNewSlot = growGroup(data, group, extendNeeded);
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
function freeSlots(data: TextData, group: TextDataDrawGroup, slots: number[]): void {
    let minSlot = Number.POSITIVE_INFINITY;
    let maxSlot = -1;
    for (const s of slots) {
        markSlotDead(data._instances, s);
        group.freeSlots.push(s);
        if (s < minSlot) {
            minSlot = s;
        }
        if (s > maxSlot) {
            maxSlot = s;
        }
    }
    if (maxSlot >= 0) {
        markDirty(data, minSlot, maxSlot + 1);
    }
}

// ─── Draw-group helpers ────────────────────────────────────────────────────

function findGroup(data: TextData, curveSetId: CurveSetId): TextDataDrawGroup | undefined {
    for (const g of data._groups) {
        if (g.curveSetId === curveSetId) {
            return g;
        }
    }
    return undefined;
}

function ensureGroup(data: TextData, curveSetId: CurveSetId): TextDataDrawGroup {
    const existing = findGroup(data, curveSetId);
    if (existing) {
        return existing;
    }
    const curves = data._curves.get(curveSetId);
    if (!curves) {
        throw new Error(`updateTextData: addRun references unknown curveSet "${curveSetId}" — call addCurves (or reset) for this curve set first.`);
    }
    const atlas = getOrCreateAtlas(curves);
    syncAtlasGlyphs(atlas, curves);
    acquireAtlasRef(data, atlas);
    const group: TextDataDrawGroup = {
        curveSetId,
        curves,
        atlas,
        slotStart: data._instanceCount,
        slotCount: 0,
        liveCount: 0,
        freeSlots: [],
        bindGroup: null,
        bindGroupVersion: -1,
    };
    data._groups.push(group);
    return group;
}

/** Write a run's glyphs into the given (already-allocated) slots. Returns the subset of
 *  slots that actually received live glyphs (skipped glyphs leave their slot dead). */
function writeRunToSlots(data: TextData, group: TextDataDrawGroup, run: GlyphRun, slots: number[]): number[] {
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
        const ok = packGlyphAtSlot(data._instances, slot, group.atlas, group.curves, pg.glyphId, pg.x, pg.y, invScale, color);
        if (ok) {
            liveSlots.push(slot);
        } else {
            markSlotDead(data._instances, slot);
            group.freeSlots.push(slot);
        }
        if (slot < minSlot) {
            minSlot = slot;
        }
        if (slot > maxSlot) {
            maxSlot = slot;
        }
    }
    if (maxSlot >= 0) {
        markDirty(data, minSlot, maxSlot + 1);
    }
    return liveSlots;
}

// ─── reset (also serves as compaction) ─────────────────────────────────────

function applyReset(data: TextData, runs: GlyphRun[], curves: Map<CurveSetId, Map<number, GlyphCurves>>): void {
    // Pre-reserve capacity for total glyphs across all runs.
    let totalGlyphs = 0;
    for (const run of runs) {
        totalGlyphs += run.glyphs.length;
    }
    const required = totalGlyphs * TEXT_INSTANCE_FLOATS;
    if (data._instances.length < required) {
        let newLen = Math.max(data._instances.length * 2, TEXT_INSTANCE_FLOATS);
        while (newLen < required) {
            newLen *= 2;
        }
        data._instances = new Float32Array(newLen);
    }

    // Preserve previous groups for bind-group/atlas reuse.
    const prevGroupByCurveSet = new Map<CurveSetId, TextDataDrawGroup>();
    for (const g of data._groups) {
        prevGroupByCurveSet.set(g.curveSetId, g);
    }

    data._curves = curves;

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
                bindGroup: null,
                bindGroupVersion: -1,
            } as TextDataDrawGroup);
        group.curves = groupCurves;
        if (group.atlas !== atlas) {
            group.atlas = atlas;
            group.bindGroup = null;
            group.bindGroupVersion = -1;
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
            const live = writeRunToSlots(data, group, run, slots);
            liveInGroup += live.length;
            newRunRecords.set(run, { run, groupIdx, slots: live });
        }
        group.slotCount = writeSlot - group.slotStart;
        group.liveCount = liveInGroup;
        newGroups.push(group);
    }

    data._instanceCount = writeSlot;
    data._groups = newGroups;
    data._runs.length = 0;
    for (const r of runs) {
        data._runs.push(r);
    }
    data._runRecords = newRunRecords;

    // Reconcile atlas refs.
    const newAtlases = new Set<SharedAtlas>();
    for (const g of newGroups) {
        newAtlases.add(g.atlas);
    }
    for (const atlas of newAtlases) {
        if (!data._refdAtlases.has(atlas)) {
            atlas.refCount++;
        }
    }
    for (const atlas of data._refdAtlases) {
        if (!newAtlases.has(atlas)) {
            releaseAtlasRef(atlas);
        }
    }
    data._refdAtlases = newAtlases;

    data._dirtyStart = 0;
    data._dirtyEnd = writeSlot;
    data._version++;
}

// ─── addCurves ─────────────────────────────────────────────────────────────

function applyAddCurves(data: TextData, curveSetId: CurveSetId, curves: Map<number, GlyphCurves>): void {
    const existing = data._curves.get(curveSetId);
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
        data._curves.set(curveSetId, curves);
    }
    const atlas = getOrCreateAtlas(data._curves.get(curveSetId)!);
    syncAtlasGlyphs(atlas, data._curves.get(curveSetId)!);
}

// ─── addRun / removeRun / replaceRun ───────────────────────────────────────

function resolveRun(data: TextData, ref: GlyphRun | number): GlyphRun {
    if (typeof ref === "number") {
        const r = data._runs[ref];
        if (!r) {
            throw new Error(`updateTextData: run index ${ref} out of range (0..${data._runs.length - 1}).`);
        }
        return r;
    }
    return ref;
}

function applyAddRun(data: TextData, run: GlyphRun, insertBefore?: number): void {
    if (data._runRecords.has(run)) {
        throw new Error("updateTextData addRun: GlyphRun reference is already in this TextData.");
    }
    const group = ensureGroup(data, run.curveSet);
    const groupIdx = data._groups.indexOf(group);
    const slots = allocateSlots(data, group, run.glyphs.length);
    const live = writeRunToSlots(data, group, run, slots);
    group.liveCount += live.length;
    data._runRecords.set(run, { run, groupIdx, slots: live });
    const at = insertBefore ?? data._runs.length;
    data._runs.splice(at, 0, run);
}

function applyRemoveRun(data: TextData, ref: GlyphRun | number): void {
    const run = resolveRun(data, ref);
    const rec = data._runRecords.get(run);
    if (!rec) {
        throw new Error("updateTextData removeRun: GlyphRun reference is not in this TextData.");
    }
    const group = data._groups[rec.groupIdx]!;
    freeSlots(data, group, rec.slots);
    group.liveCount -= rec.slots.length;
    data._runRecords.delete(run);
    const runIdx = data._runs.indexOf(run);
    if (runIdx >= 0) {
        data._runs.splice(runIdx, 1);
    }
    // If the group has no live instances left, drop it entirely and shrink the buffer tail.
    if (group.liveCount === 0) {
        dropEmptyGroup(data, group);
    }
}

/** Remove a group with no live instances. Shifts later groups left over the vacated range. */
function dropEmptyGroup(data: TextData, group: TextDataDrawGroup): void {
    const idx = data._groups.indexOf(group);
    if (idx < 0) {
        return;
    }
    const removedStart = group.slotStart;
    const removedCount = group.slotCount;
    data._groups.splice(idx, 1);
    // Re-index groupIdx for runs in later groups.
    for (const r of data._runRecords.values()) {
        if (r.groupIdx > idx) {
            r.groupIdx--;
        }
    }
    if (removedCount > 0) {
        const floatDelta = removedCount * TEXT_INSTANCE_FLOATS;
        const moveStartFloat = (removedStart + removedCount) * TEXT_INSTANCE_FLOATS;
        const moveEndFloat = data._instanceCount * TEXT_INSTANCE_FLOATS;
        if (moveEndFloat > moveStartFloat) {
            data._instances.copyWithin(moveStartFloat - floatDelta, moveStartFloat, moveEndFloat);
        }
        for (const g of data._groups) {
            if (g.slotStart >= removedStart) {
                g.slotStart -= removedCount;
                for (let i = 0; i < g.freeSlots.length; i++) {
                    g.freeSlots[i] = g.freeSlots[i]! - removedCount;
                }
            }
        }
        for (const r of data._runRecords.values()) {
            const slots = r.slots;
            for (let i = 0; i < slots.length; i++) {
                if (slots[i]! >= removedStart) {
                    slots[i] = slots[i]! - removedCount;
                }
            }
        }
        data._instanceCount -= removedCount;
        markDirty(data, removedStart, data._instanceCount);
    }
    // Drop atlas ref if no remaining group uses it.
    let stillReferenced = false;
    for (const g of data._groups) {
        if (g.atlas === group.atlas) {
            stillReferenced = true;
            break;
        }
    }
    if (!stillReferenced) {
        data._refdAtlases.delete(group.atlas);
        releaseAtlasRef(group.atlas);
    }
}

function applyReplaceRun(data: TextData, prevRef: GlyphRun | number, newRun: GlyphRun): void {
    const prev = resolveRun(data, prevRef);
    const rec = data._runRecords.get(prev);
    if (!rec) {
        throw new Error("updateTextData replaceRun: previous GlyphRun reference is not in this TextData.");
    }
    if (prev !== newRun && data._runRecords.has(newRun)) {
        throw new Error("updateTextData replaceRun: new GlyphRun reference is already in this TextData.");
    }
    const group = data._groups[rec.groupIdx]!;
    const sameGroup = newRun.curveSet === group.curveSetId;
    if (sameGroup && newRun.glyphs.length === rec.slots.length) {
        // In-place rewrite over the existing slots.
        const live = writeRunToSlots(data, group, newRun, rec.slots);
        if (live.length === rec.slots.length) {
            // All glyphs succeeded; reuse same slot list.
            data._runRecords.delete(prev);
            data._runRecords.set(newRun, { run: newRun, groupIdx: rec.groupIdx, slots: live });
            const runIdx = data._runs.indexOf(prev);
            if (runIdx >= 0) {
                data._runs[runIdx] = newRun;
            }
            return;
        }
        // Some glyphs missed atlas — writeRunToSlots already pushed the missed slots to
        // freeSlots. Update bookkeeping.
        group.liveCount -= rec.slots.length - live.length;
        data._runRecords.delete(prev);
        data._runRecords.set(newRun, { run: newRun, groupIdx: rec.groupIdx, slots: live });
        const runIdx = data._runs.indexOf(prev);
        if (runIdx >= 0) {
            data._runs[runIdx] = newRun;
        }
        return;
    }
    // Different size or different group → remove + add at the same position.
    const insertPos = data._runs.indexOf(prev);
    applyRemoveRun(data, prev);
    applyAddRun(data, newRun, insertPos >= 0 ? insertPos : undefined);
}

// ─── Public API ────────────────────────────────────────────────────────────

export function createTextData(initial?: { runs: GlyphRun[]; curves: Map<CurveSetId, Map<number, GlyphCurves>> }): TextData {
    const runs: GlyphRun[] = [];
    const data = {
        runs,
        _runs: runs,
        _groups: [],
        _runRecords: new Map(),
        _instances: new Float32Array(TEXT_INSTANCE_FLOATS),
        _instanceCount: 0,
        _curves: new Map(),
        _refdAtlases: new Set(),
        _version: 1,
        _dirtyStart: 0,
        _dirtyEnd: 0,
        _gpu: null,
    } as unknown as TextData;
    if (initial) {
        applyReset(data, initial.runs, initial.curves);
    }
    return data;
}

export function updateTextData(data: TextData, update: TextDataUpdate): void {
    switch (update.update) {
        case "reset":
            applyReset(data, update.runs, update.curves);
            return;
        case "addCurves":
            applyAddCurves(data, update.curveSetId, update.curves);
            return;
        case "addRun":
            applyAddRun(data, update.run, update.insertBefore);
            return;
        case "removeRun":
            applyRemoveRun(data, update.run);
            return;
        case "replaceRun":
            applyReplaceRun(data, update.previous, update.run);
            return;
    }
}

export function disposeTextData(data: TextData): void {
    if (data._gpu) {
        data._gpu.instanceBuf.destroy();
        data._gpu = null;
    }
    for (const g of data._groups) {
        g.bindGroup = null;
    }
    data._groups = [];
    data._instanceCount = 0;
    data._runs.length = 0;
    data._runRecords.clear();
    for (const atlas of data._refdAtlases) {
        releaseAtlasRef(atlas);
    }
    data._refdAtlases.clear();
}
