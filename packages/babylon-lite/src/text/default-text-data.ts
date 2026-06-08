/** Default convenience TextData: shapes text + extracts curves into a fresh GlyphStorage. */

import type { Font } from "./font.js";
import { extractGlyphCurves } from "./glyph-extraction.js";
import type { CurveSetId, GlyphCurves, GlyphStorage } from "./glyph-storage.js";
import { createGlyphStorage, disposeGlyphStorage, updateGlyphStorage } from "./glyph-storage.js";
import type { GlyphRun, TextData } from "./text-data.js";
import { createTextData, disposeTextData, updateTextData } from "./text-data.js";
import type { TextLayoutOptions } from "./layout.js";
import { layoutText } from "./layout.js";
import { getFontFamily } from "text-shaper";

declare const defaultTextDataBrand: unique symbol;

/** Convenience text-data variant that owns its `GlyphStorage` and exposes the laid-out
 *  pixel-space `width` / `height` of the text block. Produced by `createDefaultTextData`. */
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

/** Derive the curve-set id from the font's family name (e.g. "Inter", "Roboto"). Falls back
 *  to `"font"` for fonts that lack a usable name table. */
function familyCurveSetId(font: Font): CurveSetId {
    return (font._font.name && getFontFamily(font._font.name)) || "font";
}

/** Shape `text` with the default layout, extract glyph curves, and bundle into a
 *  `DefaultTextData`. `textColor` is applied as the run's defaultColor (per-glyph color
 *  overrides remain available via direct `updateTextData(replaceRun)` calls).
 *
 *  The returned `DefaultTextData` owns its underlying `GlyphStorage` — release both with
 *  `disposeDefaultTextData(data)`. */
export function createDefaultTextData(
    font: Font,
    fontSizePx: number,
    text: string,
    textColor?: readonly [number, number, number, number],
    options?: TextLayoutOptions
): DefaultTextData {
    const laid = layoutText(font, text, fontSizePx, options);
    const innerCurves = new Map<number, GlyphCurves>();
    const ids = new Set<number>();
    for (const g of laid.glyphs) {
        ids.add(g.glyphId);
    }
    extractGlyphCurves(font, ids, innerCurves);
    const curveSetId = familyCurveSetId(font);
    const storage = createGlyphStorage(new Map([[curveSetId, innerCurves]]));
    const run: GlyphRun = {
        curveSet: curveSetId,
        glyphs: laid.glyphs,
        pixelsPerFontUnit: laid.pixelsPerFontUnit,
        defaultColor: textColor,
    };
    return Object.assign(createTextData(storage, [run]), {
        width: laid.width,
        height: laid.height,
        _font: font,
        _fontSizePx: fontSizePx,
        _options: options,
        _curveSetId: curveSetId,
        _storage: storage,
    }) as DefaultTextData;
}

/** Re-shape `text` and apply the new run via `updateTextData(replaceRun)`. New glyphs are
 *  added to the storage in place. When `textColor` is omitted, the live run's existing
 *  `defaultColor` is preserved (so any caller-driven color override survives a text re-shape). */
export function updateDefaultTextData(data: DefaultTextData, text: string, textColor?: readonly [number, number, number, number]): void {
    const laid = layoutText(data._font, text, data._fontSizePx, data._options);
    // Extract any new glyph outlines and add them to the storage; existing ids are a no-op.
    const innerCurves = new Map<number, GlyphCurves>();
    const ids = new Set<number>();
    for (const g of laid.glyphs) {
        ids.add(g.glyphId);
    }
    extractGlyphCurves(data._font, ids, innerCurves);
    updateGlyphStorage(data._storage, data._curveSetId, innerCurves);
    // Always use the current `data.runs[0]` as the previous reference; a DefaultTextData
    // owns exactly one run and the caller may have swapped it out via their own ops.
    const previousRun = data.runs[0]!;
    const newRun: GlyphRun = {
        curveSet: data._curveSetId,
        glyphs: laid.glyphs,
        pixelsPerFontUnit: laid.pixelsPerFontUnit,
        defaultColor: textColor ?? previousRun.defaultColor,
    };
    updateTextData(data, { update: "replaceRun", previous: previousRun, run: newRun });
    // Refresh the cached width/height on the branded object.
    Object.assign(data, { width: laid.width, height: laid.height });
}

/** Release the per-block GPU resources AND the underlying `GlyphStorage` owned by `data`. */
export function disposeDefaultTextData(data: DefaultTextData): void {
    disposeTextData(data);
    disposeGlyphStorage(data._storage);
}
