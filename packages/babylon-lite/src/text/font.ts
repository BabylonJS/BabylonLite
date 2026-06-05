/** Font loading and glyph-id lookup. Wraps text-shaper behind branded opaque types. */

import { Font as TextShaperFont } from "text-shaper";
import type { Font } from "./internal.js";

/** Load a TTF or OTF font from a URL. */
export async function loadFont(url: string): Promise<Font> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`loadFont: failed to fetch ${url} (${response.status})`);
    }
    const data = await response.arrayBuffer();
    return createFontFromBuffer(data);
}

/** Build a `Font` from an in-memory TTF/OTF buffer. */
export function createFontFromBuffer(data: ArrayBuffer): Font {
    return {
        _font: TextShaperFont.load(data),
        _curvesCache: null,
    } as unknown as Font;
}

/** Look up the glyph id for a Unicode code point. */
export function getGlyphId(font: Font, charCode: number): number {
    return font._font.glyphId(charCode);
}

/** Convenience: map every code point in `text` to its glyph id and return the unique set.
 *  Raw code-point → glyph mapping — does not shape. */
export function getGlyphIds(font: Font, text: string): Set<number> {
    const out = new Set<number>();
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp != null) {
            out.add(font._font.glyphId(cp));
        }
    }
    return out;
}
