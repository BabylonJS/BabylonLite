/** @internal Brand symbols, lazy WeakMaps, and per-handle internal state for the text feature.
 *  Not re-exported from `src/index.ts`. */

import type { Font as TextShaperFont } from "text-shaper";
import type { CurveSetId, GlyphCurves, GlyphRun, TextLayoutOptions } from "./public-types.js";
import type { GlyphBands } from "./slug-bands.js";

// ─── Brand symbols (nominal-typing only — never instantiated at runtime) ───
export declare const FONT_BRAND: unique symbol;
export declare const TEXT_DATA_BRAND: unique symbol;
export declare const DEFAULT_TEXT_DATA_BRAND: unique symbol;

// ─── Branded public types ───
export type Font = { readonly [FONT_BRAND]: never };
export type TextData = {
    readonly [TEXT_DATA_BRAND]: never;
    /** Live, in-insertion-order view of the runs currently rendered. Mutated by
     *  `updateTextData`. Do not mutate from outside. */
    readonly runs: readonly GlyphRun[];
};
export type DefaultTextData = TextData & {
    /** Pixel-space width of the laid-out run (max line width). */
    readonly width: number;
    /** Pixel-space height of the laid-out run (lines × line-height). */
    readonly height: number;
    readonly [DEFAULT_TEXT_DATA_BRAND]: never;
};

// ─── Internal per-handle state ───
export type FontInternals = { font: TextShaperFont };

/** Atlas slot for a single glyph inside a SharedAtlas. */
export type AtlasSlot = {
    /** Index of the first curve texel for this glyph. */
    curveTexelStart: number;
    /** Texel coordinates of the band header block for this glyph. */
    glyphLocX: number;
    glyphLocY: number;
    /** vBandCount - 1, hBandCount - 1 (matching the fragment shader expectations). */
    bandMaxX: number;
    bandMaxY: number;
    /** Number of bands per axis used when packing (≤ 8). */
    vBandCount: number;
    hBandCount: number;
};

/** CPU + (lazy) GPU staging shared by every TextData built from the same curves map. */
export type SharedAtlas = {
    /** Pooled curve texel staging (rgba32float, width 4096). */
    curveTexData: Float32Array;
    /** Number of curve texels actually used. */
    curveTexelsUsed: number;
    /** Pooled band texel staging (rgba32float, width 4096). */
    bandTexData: Float32Array;
    /** Number of band texels actually used. */
    bandTexelsUsed: number;
    /** Per-glyph atlas slot lookup. Slots are append-only and never moved. */
    glyphSlots: Map<number, AtlasSlot>;
    /** Monotonic version bumped whenever a new glyph is appended. */
    version: number;
    /** Number of live `TextData`s currently referencing this atlas. When it drops to zero the
     *  GPU textures are destroyed (CPU staging stays warm in the WeakMap for lazy rebuild). */
    refCount: number;
    /** Lazy GPU resources (one set per SharedAtlas; recreated only on capacity grow). */
    _gpu: SharedAtlasGpu | null;
};

export type SharedAtlasGpu = {
    device: GPUDevice;
    curveTex: GPUTexture;
    bandTex: GPUTexture;
    curveTexRows: number;
    bandTexRows: number;
    uploadedVersion: number;
};

/** Per-curve-set draw group within a TextData. One group per unique font used by the live runs.
 *  Groups own a contiguous *slot range* in the shared instance buffer; live and dead slots
 *  intermix within that range. The vertex shader emits a degenerate quad for dead slots so
 *  they cost only a vertex-shader invocation. */
export type TextDataDrawGroup = {
    /** Curve-set id (matches the live curves dictionary key). */
    curveSetId: CurveSetId;
    /** Inner curves map this group is bound to. Used to detect when the caller passes a new
     *  inner-map reference (e.g. via `reset`) and to drive atlas sharing. */
    curves: ReadonlyMap<number, GlyphCurves>;
    /** Shared atlas for this curve set. May be reused across `TextData`s referencing the same inner map. */
    atlas: SharedAtlas;
    /** First slot index (in instances, not bytes) owned by this group. */
    slotStart: number;
    /** Number of slots reserved by this group (live + dead). The draw call covers
     *  `[slotStart, slotStart + slotCount)`. */
    slotCount: number;
    /** Number of *live* (non-dead) instances in this group. Tracked for stats. */
    liveCount: number;
    /** Indices (absolute, within `internals.instances`) of dead slots inside this group's
     *  range, available for reuse by `addRun`/`replaceRun`. LIFO order keeps recent frees
     *  reusable first (locality). */
    freeSlots: number[];
    /** Lazy GPU bind group for this group's atlas (recreated on atlas-grow or first bind). */
    _bindGroup: GPUBindGroup | null;
    /** Atlas-GPU upload version captured when `_bindGroup` was last (re)built. */
    _bindGroupVersion: number;
};

/** Per-run bookkeeping. Lets us locate a run's instances inside its draw group's slot range
 *  in O(1) for add/remove/replace ops. Slots are not guaranteed to be contiguous (the
 *  allocator may have reused freed slots from anywhere in the group's range). */
export type RunRecord = {
    run: GlyphRun;
    /** Index of the owning draw group in `internals.groups`. */
    groupIdx: number;
    /** Absolute slot indices (within `internals.instances`) currently occupied by this run.
     *  Length === number of glyphs actually written (skipped glyphs do not occupy slots). */
    slots: number[];
};

export type TextDataInternals = {
    /** Per-curve-set draw groups. Length = number of unique curveSet ids referenced by live runs. */
    groups: TextDataDrawGroup[];
    /** Live, in-insertion-order list of runs. Same reference as `TextData.runs`. */
    runs: GlyphRun[];
    /** Per-run bookkeeping records, keyed by `GlyphRun` reference. */
    runRecords: Map<GlyphRun, RunRecord>;
    /** Pooled per-instance float buffer (TEXT_INSTANCE_FLOATS per instance). */
    instances: Float32Array;
    /** Total *capacity* used (slots reserved by all groups, including dead slots within
     *  their ranges, plus a tail of fully-free capacity past the last group). The renderer
     *  uploads up to `internals.instances.subarray(0, instanceCount * floats-per-instance)`. */
    instanceCount: number;
    /** Per-curveSet curves maps (the live state); mirrors what addCurves/reset has
     *  accumulated. */
    curves: Map<CurveSetId, Map<number, GlyphCurves>>;
    /** Atlases this `TextData` currently holds a reference on (for refcount reconcile/release). */
    refdAtlases: Set<SharedAtlas>;
    /** Monotonic version bumped whenever instance data changes (any non-empty dirty range
     *  produced). Renderers compare against their `uploadedDataVersion` to decide whether
     *  to upload. */
    version: number;
    /** Inclusive-exclusive *instance-index* range that has been written but not yet uploaded
     *  to the GPU. `dirtyStart === dirtyEnd` means "nothing dirty". Renderers clear it after
     *  upload. */
    dirtyStart: number;
    dirtyEnd: number;
    /** Lazy per-text-block GPU resources (single instance buffer covering all groups). */
    _gpu: TextDataGpu | null;
};

export type TextDataGpu = {
    device: GPUDevice;
    instanceBuf: GPUBuffer;
    instanceBufCapacity: number;
    uploadedVersion: number;
};

export type DefaultTextDataInternals = {
    font: Font;
    fontSizePx: number;
    options: TextLayoutOptions | undefined;
    /** Curve-set id derived from the font's family name (or `"font"` as fallback).
     *  Captured at create-time and reused on every update so the inner curves map
     *  stays addressable by the same key. */
    curveSetId: CurveSetId;
};

// ─── Lazy WeakMaps (zero module-level side effects per GUIDANCE §4) ───
let _fontInternals: WeakMap<Font, FontInternals> | null = null;
let _textDataInternals: WeakMap<TextData, TextDataInternals> | null = null;
let _defaultTextDataInternals: WeakMap<DefaultTextData, DefaultTextDataInternals> | null = null;
let _atlasByCurves: WeakMap<ReadonlyMap<number, GlyphCurves>, SharedAtlas> | null = null;
let _curvesCacheByFont: WeakMap<Font, Map<number, GlyphCurves>> | null = null;
let _bandsCache: WeakMap<GlyphCurves, GlyphBands> | null = null;

export function getFontInternals(font: Font): FontInternals | undefined {
    return _fontInternals?.get(font);
}
export function setFontInternals(font: Font, state: FontInternals): void {
    (_fontInternals ??= new WeakMap()).set(font, state);
}

export function getTextDataInternals(data: TextData): TextDataInternals | undefined {
    return _textDataInternals?.get(data);
}
export function setTextDataInternals(data: TextData, state: TextDataInternals): void {
    (_textDataInternals ??= new WeakMap()).set(data, state);
}

export function getDefaultTextDataInternals(d: DefaultTextData): DefaultTextDataInternals | undefined {
    return _defaultTextDataInternals?.get(d);
}
export function setDefaultTextDataInternals(d: DefaultTextData, state: DefaultTextDataInternals): void {
    (_defaultTextDataInternals ??= new WeakMap()).set(d, state);
}

export function getSharedAtlasForCurves(curves: ReadonlyMap<number, GlyphCurves>): SharedAtlas | undefined {
    return _atlasByCurves?.get(curves);
}
export function setSharedAtlasForCurves(curves: ReadonlyMap<number, GlyphCurves>, atlas: SharedAtlas): void {
    (_atlasByCurves ??= new WeakMap()).set(curves, atlas);
}

export function getCurvesCacheForFont(font: Font): Map<number, GlyphCurves> {
    let cache = _curvesCacheByFont?.get(font);
    if (!cache) {
        cache = new Map();
        (_curvesCacheByFont ??= new WeakMap()).set(font, cache);
    }
    return cache;
}

export function getBandsCache(): WeakMap<GlyphCurves, GlyphBands> {
    return (_bandsCache ??= new WeakMap());
}

export const TEX_WIDTH = 4096;
