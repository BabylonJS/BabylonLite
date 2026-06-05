/** Public, structural types for the text feature. Re-exported from `src/index.ts`. */

import type { GlyphBands } from "./slug-bands.js";
import type { GlyphStorage } from "./internal.js";

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
    /** @internal Lazily-computed band partitioning (memoized by `buildGlyphBands`). */
    _bands?: GlyphBands;
};

export type PlacedGlyph = {
    readonly glyphId: number;
    /** Pixel position of glyph baseline origin. */
    readonly x: number;
    readonly y: number;
    /** Optional per-glyph color as linear RGBA in [0,1]. When present this overrides the
     *  run's `defaultColor` for this glyph. When omitted, the glyph falls back to the run's
     *  `defaultColor`, and if that is also omitted, to opaque white. The rendered alpha is
     *  additionally scaled by the whole-block opacity (e.g. `TextRenderable.opacity`). */
    readonly color?: readonly [number, number, number, number];
};

/** Identifier for a curve set (a font's glyph-curves map). Strings let callers use a
 *  human-readable key (e.g. the font face name) for easy debugging. */
export type CurveSetId = string;

export type GlyphRun = {
    /** Which curve set this run's glyph ids index into. */
    readonly curveSet: CurveSetId;
    readonly glyphs: readonly PlacedGlyph[];
    /** Font-units → pixels scale used by the layout. */
    readonly pixelsPerFontUnit: number;
    /** Optional default color for every glyph in this run, as linear RGBA in [0,1]. A glyph's
     *  own `PlacedGlyph.color` takes precedence over this. When omitted, glyphs default to
     *  opaque white. The rendered alpha is additionally scaled by the whole-block opacity. */
    readonly defaultColor?: readonly [number, number, number, number];
};

/** Discriminated union driving `updateTextData`. Each variant's `update` field is the
 *  discriminator. Arrays/maps passed inside any variant are *adopted* by the `TextData`
 *  and must not be read or mutated by the caller afterward. */
export type TextDataUpdate =
    | {
          /** Rebuild runs and/or swap to a different storage. Both `runs` and `storage`
           *  are optional; missing fields default to the TextData's current value, so
           *  `{ update: "reset" }` with neither performs a pure compaction pass that
           *  re-lays-out the slot allocator without dead slots or gaps.
           *  Invalidates any previously-passed `GlyphRun` references when `runs` is set. */
          update: "reset";
          runs?: GlyphRun[];
          storage?: GlyphStorage;
      }
    | {
          /** Append a new run to the live runs list, or insert it before the run currently at
           *  `insertBefore`. The run's `curveSet` must already exist in the bound storage. */
          update: "addRun";
          run: GlyphRun;
          /** Index in `data.runs` to insert before. Default = append at end. */
          insertBefore?: number;
      }
    | {
          /** Remove a previously-added run. Accepts either the `GlyphRun` reference or its
           *  current index in `data.runs`. */
          update: "removeRun";
          run: GlyphRun | number;
      }
    | {
          /** Replace one run's contents in place. The new run takes the slot in `data.runs`
           *  that the previous run occupied. Cheapest when the new run has the same glyph
           *  count and the same `curveSet` as the previous one. */
          update: "replaceRun";
          previous: GlyphRun | number;
          run: GlyphRun;
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
