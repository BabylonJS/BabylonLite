/** Default convenience descriptor: shapes text + extracts curves into a fresh map. */

import type { DefaultTextDescriptor, Font } from "./internal.js";
import { setDefaultDescriptorInternals, getDefaultDescriptorInternals } from "./internal.js";
import type { CurveSetId, GlyphCurves, GlyphRun, TextLayoutOptions } from "./public-types.js";
import { extractGlyphCurves } from "./curves.js";
import { getRawFont } from "./font.js";
import { layoutText } from "./layout.js";
import { getFontFamily } from "text-shaper";

/** Derive the curve-set id from the font's family name (e.g. "Inter", "Roboto"). Falls back to
 *  `"font"` for fonts that lack a usable name table. Within a `DefaultTextDescriptor` there is
 *  always exactly one font, so a family-name collision across multiple `DefaultTextDescriptor`s
 *  is harmless — each descriptor's curves map is independent and atlas sharing is keyed off the
 *  inner-map identity, not the curve-set name. */
function familyCurveSetId(font: Font): CurveSetId {
    const raw = getRawFont(font);
    return (raw.name && getFontFamily(raw.name)) || "font";
}

function brandedDescriptor(curves: ReadonlyMap<CurveSetId, ReadonlyMap<number, GlyphCurves>>, runs: readonly GlyphRun[], width: number, height: number): DefaultTextDescriptor {
    return { curves, runs, width, height } as DefaultTextDescriptor;
}

/** Shape `text` with the default layout, extract glyph curves, and bundle into a `DefaultTextDescriptor`. */
export function createDefaultTextDescriptor(font: Font, text: string, fontSizePx: number, options?: TextLayoutOptions): DefaultTextDescriptor {
    const laid = layoutText(font, text, fontSizePx, options);
    const innerCurves = new Map<number, GlyphCurves>();
    const ids = new Set<number>();
    for (const g of laid.glyphs) {
        ids.add(g.glyphId);
    }
    extractGlyphCurves(font, ids, innerCurves);
    const curveSetId = familyCurveSetId(font);
    const curves = new Map<CurveSetId, ReadonlyMap<number, GlyphCurves>>([[curveSetId, innerCurves]]);
    const run: GlyphRun = { curveSet: curveSetId, glyphs: laid.glyphs, pixelsPerFontUnit: laid.pixelsPerFontUnit };
    const out = brandedDescriptor(curves, [run], laid.width, laid.height);
    setDefaultDescriptorInternals(out, { font, fontSizePx, options, curveSetId });
    return out;
}

/** Build a new descriptor for an updated text string. Reuses `prior`'s curve map and only grows it. */
export function updateDefaultTextDescriptor(prior: DefaultTextDescriptor, text: string): DefaultTextDescriptor {
    const state = getDefaultDescriptorInternals(prior);
    if (!state) {
        throw new Error("updateDefaultTextDescriptor: invalid descriptor (was it produced by createDefaultTextDescriptor?).");
    }
    const laid = layoutText(state.font, text, state.fontSizePx, state.options);
    const priorInner = prior.curves.get(state.curveSetId);
    if (!priorInner) {
        throw new Error("updateDefaultTextDescriptor: missing curve set on prior descriptor.");
    }
    // Mutate the prior inner map in place (it's typed Readonly but was constructed mutable).
    const innerCurves = priorInner as Map<number, GlyphCurves>;
    const ids = new Set<number>();
    for (const g of laid.glyphs) {
        ids.add(g.glyphId);
    }
    extractGlyphCurves(state.font, ids, innerCurves);
    // Reuse the prior outer map reference too so atlas-sharing keys stay stable.
    const run: GlyphRun = { curveSet: state.curveSetId, glyphs: laid.glyphs, pixelsPerFontUnit: laid.pixelsPerFontUnit };
    const out = brandedDescriptor(prior.curves, [run], laid.width, laid.height);
    setDefaultDescriptorInternals(out, state);
    return out;
}
