import type { Mat4 } from "./types.js";
import { asMat4Storage } from "./_mat4-storage.js";

/** @internal Pack one Mat4 into a Float32Array upload view at the given float
 *  offset. Source storage may be F32 or F64; this is the only place in the
 *  package where F64→F32 downcast happens for GPU upload. Does not allocate.
 *  Does not perform floating-origin offset subtraction (REQ-UPL-3).
 *
 *  The 16 element writes are intentionally unrolled to match the style of the
 *  mat4 kernels and avoid an indexable loop in hot paths. Do NOT replace with
 *  `view.set(src, offsetFloats)` — that pattern is the one Task 4.1 audits OUT
 *  outside this single helper. */
export function packMat4IntoF32(view: Float32Array, mat: Mat4, offsetFloats: number = 0): void {
    const src = asMat4Storage(mat);
    view[offsetFloats + 0] = src[0]!;
    view[offsetFloats + 1] = src[1]!;
    view[offsetFloats + 2] = src[2]!;
    view[offsetFloats + 3] = src[3]!;
    view[offsetFloats + 4] = src[4]!;
    view[offsetFloats + 5] = src[5]!;
    view[offsetFloats + 6] = src[6]!;
    view[offsetFloats + 7] = src[7]!;
    view[offsetFloats + 8] = src[8]!;
    view[offsetFloats + 9] = src[9]!;
    view[offsetFloats + 10] = src[10]!;
    view[offsetFloats + 11] = src[11]!;
    view[offsetFloats + 12] = src[12]!;
    view[offsetFloats + 13] = src[13]!;
    view[offsetFloats + 14] = src[14]!;
    view[offsetFloats + 15] = src[15]!;
}
