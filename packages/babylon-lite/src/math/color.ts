/** Convert linear [0,1] to sRGB [0,255] using the IEC 61966-2-1 transfer curve. */
export function linearToSrgbByte(v: number): number {
    const c = Math.max(0, Math.min(1, v));
    return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
}

/** Inverse of `linearToSrgbByte` — sRGB byte [0,255] → linear [0,1]. */
export function srgbByteToLinear(b: number): number {
    const c = Math.max(0, Math.min(255, b)) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Convert a packed 0xRRGGBB sRGB color to a linear-RGBA tuple suitable for
 *  text-renderer `defaultColor` / `PlacedGlyph.color`. */
export function packedSrgbToLinearRgba(packed: number, alpha = 1): readonly [number, number, number, number] {
    return [srgbByteToLinear((packed >> 16) & 0xff), srgbByteToLinear((packed >> 8) & 0xff), srgbByteToLinear(packed & 0xff), alpha];
}
