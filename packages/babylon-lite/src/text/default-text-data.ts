/** Default convenience TextData: shapes text + extracts curves into a fresh map. */

import type { DefaultTextData, Font } from "./internal.js";
import { setDefaultTextDataInternals, getDefaultTextDataInternals } from "./internal.js";
import type { CurveSetId, GlyphCurves, GlyphRun, TextLayoutOptions } from "./public-types.js";
import { extractGlyphCurves } from "./curves.js";
import { getRawFont } from "./font.js";
import { layoutText } from "./layout.js";
import { createTextData, updateTextData } from "./text-data.js";
import { getFontFamily } from "text-shaper";

/** Derive the curve-set id from the font's family name (e.g. "Inter", "Roboto"). Falls back
 *  to `"font"` for fonts that lack a usable name table. */
function familyCurveSetId(font: Font): CurveSetId {
    const raw = getRawFont(font);
    return (raw.name && getFontFamily(raw.name)) || "font";
}

/** Shape `text` with the default layout, extract glyph curves, and bundle into a
 *  `DefaultTextData`. `textColor` is applied as the run's defaultColor (per-glyph color
 *  overrides remain available via direct `updateTextData(replaceRun)` calls). */
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
    const curves = new Map<CurveSetId, Map<number, GlyphCurves>>([[curveSetId, innerCurves]]);
    const run: GlyphRun = {
        curveSet: curveSetId,
        glyphs: laid.glyphs,
        pixelsPerFontUnit: laid.pixelsPerFontUnit,
        defaultColor: textColor,
    };
    const data = createTextData({ runs: [run], curves }) as DefaultTextData;
    // Attach width/height as own properties so the brand-extended type matches at runtime.
    Object.defineProperty(data, "width", { value: laid.width, writable: true, configurable: true, enumerable: true });
    Object.defineProperty(data, "height", { value: laid.height, writable: true, configurable: true, enumerable: true });
    setDefaultTextDataInternals(data, { font, fontSizePx, options, curveSetId });
    return data;
}

/** Re-shape `text` and apply the new run via `updateTextData(replaceRun)`. When `textColor`
 *  is omitted, the live run's existing `defaultColor` is preserved (so any caller-driven
 *  color override survives a text re-shape). */
export function updateDefaultTextData(data: DefaultTextData, text: string, textColor?: readonly [number, number, number, number]): void {
    const state = getDefaultTextDataInternals(data);
    if (!state) {
        throw new Error("updateDefaultTextData: invalid DefaultTextData (was it produced by createDefaultTextData?).");
    }
    const laid = layoutText(state.font, text, state.fontSizePx, state.options);
    // Grow the curves map in place; addCurves is a no-op for already-cached glyph ids.
    const innerCurves = new Map<number, GlyphCurves>();
    const ids = new Set<number>();
    for (const g of laid.glyphs) {
        ids.add(g.glyphId);
    }
    extractGlyphCurves(state.font, ids, innerCurves);
    updateTextData(data, { update: "addCurves", curveSetId: state.curveSetId, curves: innerCurves });
    // Always use the current `data.runs[0]` as the previous reference; a DefaultTextData
    // owns exactly one run and the caller may have swapped it out via their own ops.
    const previousRun = data.runs[0]!;
    const newRun: GlyphRun = {
        curveSet: state.curveSetId,
        glyphs: laid.glyphs,
        pixelsPerFontUnit: laid.pixelsPerFontUnit,
        defaultColor: textColor ?? previousRun.defaultColor,
    };
    updateTextData(data, { update: "replaceRun", previous: previousRun, run: newRun });
    // Refresh the cached width/height on the branded object.
    (data as { width: number }).width = laid.width;
    (data as { height: number }).height = laid.height;
}
