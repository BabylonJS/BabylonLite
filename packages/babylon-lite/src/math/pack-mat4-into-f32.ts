import type { Mat4 } from "./types.js";
import type { Mat4Storage } from "./types.js";

/** @internal Pack one Mat4 into a Float32Array upload view at the given float
 *  offset. Source storage may be F32 or F64; this is the F64→F32 downcast
 *  point for the precision-only path (every uploader except mesh-world UBOs
 *  in LWR-on engines). Does not allocate.
 *
 *  When `srcOffsetFloats` is provided, the helper reads 16 floats starting at
 *  `src[srcOffsetFloats]` instead of `src[0]`. This lets thin-instance and
 *  similar packed-slab uploaders walk a `Float32Array | Float64Array` of N×16
 *  values without subarray allocation.
 *
 *  LWR-on engines route mesh-world UBO uploads through
 *  `large-world/pack-mat4-with-offset.ts:packMat4IntoF32WithOffset` (5-arg
 *  variant that subtracts the floating-origin offset before the F32 store).
 *  That module is dynamic-imported only when `useFloatingOrigin: true`, so
 *  non-LWR bundles never reference the offset-subtracting variant.
 *
 *  The 16 element writes are intentionally unrolled to match the style of the
 *  mat4 kernels and avoid an indexable loop in hot paths. Do NOT replace with
 *  `view.set(src, offsetFloats)` — that pattern is the one Task 4.1 audits OUT
 *  outside this single helper. */
export function packMat4IntoF32(view: Float32Array, mat: Mat4 | Float32Array | Float64Array, offsetFloats: number = 0, srcOffsetFloats: number = 0): void {
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
    view[o + 12] = src[s + 12]!;
    view[o + 13] = src[s + 13]!;
    view[o + 14] = src[s + 14]!;
    view[o + 15] = src[s + 15]!;
}
