import type { Mat4 } from "./types.js";

/** @internal Storage view used by kernels, allocators, and the upload packer.
 *  This module MUST NOT be re-exported from packages/babylon-lite/src/index.ts
 *  or from src/math/index.ts — it is internal to the package. */
export type Mat4Storage = Float32Array | Float64Array;

/** @internal Reinterpret an opaque Mat4 as its concrete storage view. */
export function asMat4Storage(m: Mat4): Mat4Storage {
    return m as unknown as Mat4Storage;
}

/** @internal True iff the storage is Float64Array. */
export function isF64Storage(m: Mat4Storage): boolean {
    return m.BYTES_PER_ELEMENT === 8;
}
