/** TextData — owns one or more per-curve-set atlases (shared across same-curves descriptors)
 *  and a single packed per-instance vertex buffer for a text block.
 *  Multi-font: one draw group per unique `GlyphRun.curveSet`. */

import type { CurveSetId, GlyphCurves, GlyphRun, TextDescriptor } from "./public-types.js";
import type { SharedAtlas, TextData, TextDataDrawGroup, TextDataInternals } from "./internal.js";
import { getSharedAtlasForCurves, setSharedAtlasForCurves, getTextDataInternals, setTextDataInternals } from "./internal.js";
import { createSharedAtlas, packAppendGlyph } from "./slug-pack.js";

/** Bytes per instance: 4 vec4 attributes (slugBounds, slugAnchor, slugAtlas, slugBand). */
export const TEXT_INSTANCE_FLOATS = 16;
export const TEXT_INSTANCE_BYTES = TEXT_INSTANCE_FLOATS * 4;

function resolveCurves(descriptor: TextDescriptor, id: CurveSetId): ReadonlyMap<number, GlyphCurves> {
    const m = descriptor.curves.get(id);
    if (!m) {
        throw new Error(`TextDescriptor: GlyphRun references unknown curveSet "${id}" (not present in descriptor.curves).`);
    }
    return m;
}

function getOrCreateAtlas(curves: ReadonlyMap<number, GlyphCurves>): SharedAtlas {
    let atlas = getSharedAtlasForCurves(curves);
    if (!atlas) {
        atlas = createSharedAtlas();
        setSharedAtlasForCurves(curves, atlas);
    }
    return atlas;
}

/** Append any glyphs in `curves` that aren't yet packed into `atlas`. */
function syncAtlasGlyphs(atlas: SharedAtlas, curves: ReadonlyMap<number, GlyphCurves>): void {
    for (const [glyphId, glyph] of curves) {
        if (!atlas.glyphSlots.has(glyphId)) {
            atlas.glyphSlots.set(glyphId, packAppendGlyph(atlas, glyph));
        }
    }
}

/** Write one run's placed glyphs into the instance buffer at `writeFloatOffset`.
 *  Returns the number of instances actually written (omitting glyphs with no atlas slot). */
function writeRunInstances(out: Float32Array, writeFloatOffset: number, atlas: SharedAtlas, curves: ReadonlyMap<number, GlyphCurves>, run: GlyphRun): number {
    let w = writeFloatOffset;
    let count = 0;
    const scale = run.pixelsPerFontUnit;
    const invScale = scale !== 0 ? 1 / scale : 0;
    for (const pg of run.glyphs) {
        const glyph = curves.get(pg.glyphId);
        const slot = atlas.glyphSlots.get(pg.glyphId);
        if (!glyph || !slot) {
            continue;
        }
        const { xMin, yMin, xMax, yMax } = glyph.bounds;
        const widthFu = xMax - xMin;
        const heightFu = yMax - yMin;
        const bandScaleX = widthFu > 0 ? slot.vBandCount / widthFu : 0;
        const bandScaleY = heightFu > 0 ? slot.hBandCount / heightFu : 0;
        const bandOffsetX = -xMin * bandScaleX;
        const bandOffsetY = -yMin * bandScaleY;
        out[w] = xMin;
        out[w + 1] = yMin;
        out[w + 2] = xMax;
        out[w + 3] = yMax;
        out[w + 4] = pg.x;
        out[w + 5] = pg.y;
        out[w + 6] = invScale;
        out[w + 7] = 0;
        out[w + 8] = slot.glyphLocX;
        out[w + 9] = slot.glyphLocY;
        out[w + 10] = slot.bandMaxX;
        out[w + 11] = slot.bandMaxY;
        out[w + 12] = bandScaleX;
        out[w + 13] = bandScaleY;
        out[w + 14] = bandOffsetX;
        out[w + 15] = bandOffsetY;
        w += TEXT_INSTANCE_FLOATS;
        count++;
    }
    return count;
}

/** Build/update per-curve-set draw groups and pack all runs' instances contiguously
 *  into the pooled buffer. Groups are coalesced by `curveSet` (one draw call per unique font). */
function buildGroupsAndInstances(internals: TextDataInternals, descriptor: TextDescriptor): void {
    let totalGlyphs = 0;
    for (const run of descriptor.runs) {
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

    // Reuse existing group entries when possible (preserves bindGroup cache across updates).
    const prevGroupByCurveSet = new Map<CurveSetId, TextDataDrawGroup>();
    for (const g of internals.groups) {
        prevGroupByCurveSet.set(g.curveSetId, g);
    }

    // Group runs by curveSet to pack them contiguously (one draw call per group).
    const runsByCurveSet = new Map<CurveSetId, GlyphRun[]>();
    for (const run of descriptor.runs) {
        let list = runsByCurveSet.get(run.curveSet);
        if (!list) {
            list = [];
            runsByCurveSet.set(run.curveSet, list);
        }
        list.push(run);
    }

    const newGroups: TextDataDrawGroup[] = [];
    let writeFloatOffset = 0;
    let totalInstances = 0;
    for (const [curveSetId, runs] of runsByCurveSet) {
        const curves = resolveCurves(descriptor, curveSetId);
        const atlas = getOrCreateAtlas(curves);
        syncAtlasGlyphs(atlas, curves);

        const existing = prevGroupByCurveSet.get(curveSetId);
        const group: TextDataDrawGroup =
            existing ??
            ({
                curveSetId,
                atlas,
                instanceStart: 0,
                instanceCount: 0,
                _bindGroup: null,
                _bindGroupVersion: -1,
            } as TextDataDrawGroup);
        if (existing && existing.atlas !== atlas) {
            existing.atlas = atlas;
            existing._bindGroup = null;
            existing._bindGroupVersion = -1;
        }

        const groupStartInstance = writeFloatOffset / TEXT_INSTANCE_FLOATS;
        let groupInstances = 0;
        for (const run of runs) {
            const written = writeRunInstances(internals.instances, writeFloatOffset, atlas, curves, run);
            groupInstances += written;
            writeFloatOffset += written * TEXT_INSTANCE_FLOATS;
        }
        group.instanceStart = groupStartInstance;
        group.instanceCount = groupInstances;
        totalInstances += groupInstances;
        newGroups.push(group);

        internals.lastCurvesSizes.set(curveSetId, curves.size);
    }

    if (internals.lastCurvesSizes.size > runsByCurveSet.size) {
        for (const id of internals.lastCurvesSizes.keys()) {
            if (!runsByCurveSet.has(id)) {
                internals.lastCurvesSizes.delete(id);
            }
        }
    }

    internals.groups = newGroups;
    internals.instanceCount = totalInstances;
}

export function createTextData(descriptor: TextDescriptor): TextData {
    const data = {} as TextData;
    const internals: TextDataInternals = {
        groups: [],
        instances: new Float32Array(TEXT_INSTANCE_FLOATS),
        instanceCount: 0,
        lastRunsRef: descriptor.runs,
        lastCurvesSizes: new Map(),
        version: 1,
        _gpu: null,
    };
    setTextDataInternals(data, internals);
    buildGroupsAndInstances(internals, descriptor);
    return data;
}

export function updateTextData(data: TextData, descriptor: TextDescriptor): void {
    const internals = getTextDataInternals(data);
    if (!internals) {
        throw new Error("updateTextData: invalid TextData (was it produced by createTextData?).");
    }
    buildGroupsAndInstances(internals, descriptor);
    internals.lastRunsRef = descriptor.runs;
    internals.version++;
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
    // SharedAtlases are kept — they may still be in use by other TextData blocks,
    // and the curves WeakMap reclaims them naturally when the caller drops the curves map.
}

/** @internal Read TextData internals from a renderable. */
export function getTextDataInternalsOrThrow(data: TextData): TextDataInternals {
    const i = getTextDataInternals(data);
    if (!i) {
        throw new Error("Text: TextData has no internals (invalid handle).");
    }
    return i;
}
