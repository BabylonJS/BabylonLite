/** Public, structural types for the text feature. Re-exported from `src/index.ts`. */

export type QuadCurve = {
    readonly p0x: number;
    readonly p0y: number;
    readonly p1x: number;
    readonly p1y: number;
    readonly p2x: number;
    readonly p2y: number;
};

export type GlyphBounds = {
    readonly xMin: number;
    readonly yMin: number;
    readonly xMax: number;
    readonly yMax: number;
};

export type GlyphCurves = {
    readonly glyphId: number;
    readonly curves: readonly QuadCurve[];
    readonly bounds: GlyphBounds;
};

export type PlacedGlyph = {
    readonly glyphId: number;
    /** Pixel position of glyph baseline origin. */
    readonly x: number;
    readonly y: number;
};

/** Identifier for a curve set (a font's glyph-curves map) within a `TextDescriptor.curves` dictionary.
 *  Strings let callers use a human-readable key (e.g. the font face name) for easy debugging. */
export type CurveSetId = string;

export type GlyphRun = {
    /** Which entry in `TextDescriptor.curves` these glyph ids index into. */
    readonly curveSet: CurveSetId;
    readonly glyphs: readonly PlacedGlyph[];
    /** Font-units → pixels scale used by the layout. */
    readonly pixelsPerFontUnit: number;
};

export type TextDescriptor = {
    /** Glyph outlines, keyed by curve-set id. Each value is a glyph-id → outline map for one font.
     *  Atlas sharing across `TextData`s keys off the inner-map identity, so prefer to keep the
     *  same inner-map reference across edits (e.g. by growing it in place via `extractGlyphCurves`). */
    readonly curves: ReadonlyMap<CurveSetId, ReadonlyMap<number, GlyphCurves>>;
    /** One or more glyph runs. Runs sharing the same `curveSet` collapse to a single draw call;
     *  runs against different fonts produce one draw call per distinct `curveSet`. */
    readonly runs: readonly GlyphRun[];
};

export type TextLayoutOptions = {
    /** Max line width in pixels before word-wrap. Default: Infinity. */
    readonly maxWidth?: number;
    /** Line-height multiplier. Default: 1.2. */
    readonly lineHeight?: number;
    /** Horizontal alignment. Default: "left". */
    readonly align?: "left" | "center" | "right";
    /** Extra spacing in font units. Default: 0. */
    readonly letterSpacing?: number;
    /** Tab size in spaces. Default: 4. */
    readonly tabSize?: number;
};
