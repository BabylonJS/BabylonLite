/** @internal Shared interface types for the text feature. Not re-exported from `src/index.ts`. */

import type { Font as TextShaperFont } from "text-shaper";
import type { CurveSetId, GlyphCurves, GlyphRun, TextLayoutOptions } from "./public-types.js";

// ─── Brand symbols (nominal-typing only — never instantiated at runtime) ───
declare const fontBrand: unique symbol;
declare const textDataBrand: unique symbol;
declare const defaultTextDataBrand: unique symbol;
declare const glyphStorageBrand: unique symbol;

// ─── Branded public types ───
// Each carries its internal state directly on the object via `_`-prefixed `@internal`
// fields. The build's d.ts trim pass strips `@internal` declarations from the published
// types, so consumers see only the public surface.

export interface Font {
    readonly [fontBrand]: true;
    /** @internal Underlying text-shaper font handle. */
    readonly _font: TextShaperFont;
    /** @internal Lazily-allocated per-font glyph-curves cache. */
    _curvesCache: Map<number, GlyphCurves> | null;
}

/** Opaque bundle of glyph outlines (organized by curve-set) and the GPU atlases packed
 *  from them. Holds an arbitrary number of curve-sets — each curve-set gets its own atlas.
 *  Shared by reference across any number of `TextData`s that need the same glyph catalog.
 *
 *  Lifetime is caller-owned (matches `Texture2D` semantics):
 *    - `createGlyphStorage(initial?)` allocates a fresh storage, optionally seeded.
 *    - `updateGlyphStorage(storage, curveSetId, curves)` adds glyphs to a curve-set
 *      (creating the curve-set if it doesn't exist yet).
 *    - `disposeGlyphStorage(storage)` releases every atlas. The caller must ensure no
 *      `TextData` is still using the storage at this point. */
export interface GlyphStorage {
    readonly [glyphStorageBrand]: true;
    /** @internal Per-curve-set glyph outlines + the SharedAtlas they're packed into. */
    _curveSets: Map<CurveSetId, GlyphStorageCurveSet>;
}

/** @internal Per-curve-set entry within a GlyphStorage. */
export type GlyphStorageCurveSet = {
    curves: Map<number, GlyphCurves>;
    atlas: SharedAtlas;
};

export interface TextData {
    readonly [textDataBrand]: true;
    /** Live, in-insertion-order view of the runs currently rendered. Mutated by
     *  `updateTextData`. Do not mutate from outside. */
    readonly runs: readonly GlyphRun[];
    /** @internal Mutable alias of {@link runs} (same array reference). */
    _runs: GlyphRun[];
    /** @internal Per-curve-set draw groups. Length = number of unique curveSet ids referenced. */
    _groups: TextDataDrawGroup[];
    /** @internal Per-run bookkeeping records, keyed by `GlyphRun` reference. */
    _runRecords: Map<GlyphRun, RunRecord>;
    /** @internal Pooled per-instance float buffer (TEXT_INSTANCE_FLOATS per instance). */
    _instances: Float32Array;
    /** @internal Total *capacity* used (live + dead slots across all groups). */
    _instanceCount: number;
    /** @internal GlyphStorage backing this TextData. Borrowed reference — caller owns it. */
    _storage: GlyphStorage;
    /** @internal Monotonic version bumped whenever instance data changes. */
    _version: number;
    /** @internal Inclusive-exclusive dirty range of instances awaiting upload. */
    _dirtyStart: number;
    /** @internal */ _dirtyEnd: number;
    /** @internal Lazy per-text-block GPU resources. */
    _gpu: TextDataGpu | null;
}

export interface DefaultTextData extends TextData {
    readonly [defaultTextDataBrand]: true;
    /** Pixel-space width of the laid-out run (max line width). */
    readonly width: number;
    /** Pixel-space height of the laid-out run (lines × line-height). */
    readonly height: number;
    /** @internal Font used to shape this data. */
    readonly _font: Font;
    /** @internal Font size in pixels used to shape this data. */
    readonly _fontSizePx: number;
    /** @internal Layout options captured at create-time. */
    readonly _options: TextLayoutOptions | undefined;
    /** @internal Curve-set id derived from the font's family name. */
    readonly _curveSetId: CurveSetId;
    /** @internal GlyphStorage owned by this DefaultTextData. Disposed by `disposeDefaultTextData`. */
    readonly _storage: GlyphStorage;
}

// ─── Internal supporting types ───
// These are fully internal — `@internal` on the type itself strips them from the
// published d.ts. Fields therefore don't need `_` prefixes.

/** @internal Atlas slot for a single glyph inside a SharedAtlas. */
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

/** @internal CPU + (lazy) GPU staging packed from a `GlyphStorage`'s glyph outlines.
 *  One `SharedAtlas` per `GlyphStorage`; lifetime is bound to the storage. */
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
    /** Lazy GPU resources (one set per SharedAtlas; recreated only on capacity grow). */
    gpu: SharedAtlasGpu | null;
};

/** @internal */
export type SharedAtlasGpu = {
    device: GPUDevice;
    curveTex: GPUTexture;
    bandTex: GPUTexture;
    curveTexRows: number;
    bandTexRows: number;
    uploadedVersion: number;
};

/** @internal Per-curve-set draw group within a TextData. One group per unique font used by the
 *  live runs. Groups own a contiguous *slot range* in the shared instance buffer; live and dead
 *  slots intermix within that range. The vertex shader emits a degenerate quad for dead slots
 *  so they cost only a vertex-shader invocation. */
export type TextDataDrawGroup = {
    /** Curve-set id (matches the key inside the parent storage's `_curveSets` map). */
    curveSetId: CurveSetId;
    /** Cached pointer to the curve-set entry within the parent TextData's `_storage`.
     *  Refreshed whenever `_storage` swaps in `applyReset`; identity-compared to invalidate
     *  the cached `bindGroup`. */
    curveSet: GlyphStorageCurveSet;
    /** First slot index (in instances, not bytes) owned by this group. */
    slotStart: number;
    /** Number of slots reserved by this group (live + dead). The draw call covers
     *  `[slotStart, slotStart + slotCount)`. */
    slotCount: number;
    /** Number of *live* (non-dead) instances in this group. Tracked for stats. */
    liveCount: number;
    /** Indices (absolute, within `TextData._instances`) of dead slots inside this group's
     *  range, available for reuse by `addRun`/`replaceRun`. LIFO order keeps recent frees
     *  reusable first (locality). */
    freeSlots: number[];
    /** Lazy GPU bind group for this group's atlas (recreated on atlas-grow or first bind). */
    bindGroup: GPUBindGroup | null;
    /** Atlas-GPU upload version captured when `bindGroup` was last (re)built. */
    bindGroupVersion: number;
};

/** @internal Per-run bookkeeping. Lets us locate a run's instances inside its draw group's
 *  slot range in O(1) for add/remove/replace ops. Slots are not guaranteed to be contiguous
 *  (the allocator may have reused freed slots from anywhere in the group's range). */
export type RunRecord = {
    run: GlyphRun;
    /** Index of the owning draw group in `TextData._groups`. */
    groupIdx: number;
    /** Absolute slot indices (within `TextData._instances`) currently occupied by this run.
     *  Length === number of glyphs actually written (skipped glyphs do not occupy slots). */
    slots: number[];
};

/** @internal Lazy GPU instance buffer for a TextData (single buffer covering all groups). */
export type TextDataGpu = {
    device: GPUDevice;
    instanceBuf: GPUBuffer;
    instanceBufCapacity: number;
    uploadedVersion: number;
};

/** @internal */
export const TEX_WIDTH = 4096;
