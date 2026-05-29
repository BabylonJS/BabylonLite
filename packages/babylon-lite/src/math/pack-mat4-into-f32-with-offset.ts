import type { Mat4 } from "./types.js";
import type { Mat4Storage } from "./_mat4-storage.js";

/** @internal Pack a world-space Mat4 into a Float32Array upload view, applying
 *  a floating-origin offset subtraction at the translation column.
 *
 *  Elements 0–11 (linear/rotation) are an unrolled element-wise copy identical
 *  to `packMat4IntoF32`. Elements 12, 13, 14 (translation column) have
 *  `offsetXYZ[0..2]` subtracted in JavaScript number precision (F64) BEFORE
 *  the implicit F32 store. That subtraction is what wins the precision back —
 *  for an F64-backed `Mat4` the result of `large - large = small` is computed
 *  at full F64 precision, then a single F32 store rounds the small remainder
 *  with ample headroom. Element 15 is copied verbatim.
 *
 *  This is the M1 "eye-relative" pack helper. The precision-only M0 helper
 *  (`packMat4IntoF32`) explicitly forbids offset args per REQ-UPL-3; this
 *  separate helper is the architecturally-sanctioned eye-relative pack used
 *  by world-space matrix uploaders (mesh world UBO, etc.). Camera view and
 *  view-projection matrices are constructed with the offset already baked
 *  into their translation column (see `getViewMatrix`), so those uploads
 *  continue to use the precision-only `packMat4IntoF32` helper.
 *
 *  When `offsetXYZ` is `[0, 0, 0]` (floating-origin disabled), this helper
 *  produces output bit-identical to `packMat4IntoF32` modulo three trivial
 *  subtract-zero operations per matrix, satisfying the single-code-path rule
 *  for world matrix uploads regardless of floating-origin mode. */
export function packMat4IntoF32WithOffset(
    view: Float32Array,
    mat: Mat4 | Float32Array | Float64Array,
    offsetXYZ: readonly [number, number, number],
    offsetFloats: number = 0,
    srcOffsetFloats: number = 0
): void {
    const src = mat as Mat4 as unknown as Mat4Storage;
    const s = srcOffsetFloats;
    const o = offsetFloats;
    view[o + 0] = src[s + 0]!;
    view[o + 1] = src[s + 1]!;
    view[o + 2] = src[s + 2]!;
    view[o + 3] = src[s + 3]!;
    view[o + 4] = src[s + 4]!;
    view[o + 5] = src[s + 5]!;
    view[o + 6] = src[s + 6]!;
    view[o + 7] = src[s + 7]!;
    view[o + 8] = src[s + 8]!;
    view[o + 9] = src[s + 9]!;
    view[o + 10] = src[s + 10]!;
    view[o + 11] = src[s + 11]!;
    view[o + 12] = src[s + 12]! - offsetXYZ[0];
    view[o + 13] = src[s + 13]! - offsetXYZ[1];
    view[o + 14] = src[s + 14]! - offsetXYZ[2];
    view[o + 15] = src[s + 15]!;
}
