/** @internal Storage view used by kernels, allocators, and the upload packer.
 *  This module MUST NOT be re-exported from packages/babylon-lite/src/index.ts
 *  or from src/math/index.ts — it is internal to the package. */
export type Mat4Storage = Float32Array | Float64Array;

// `Mat4` (opaque) and `Mat4Storage` (concrete) are structurally compatible;
// callers cast inline via `(m as unknown as Mat4Storage)` where the typed-array
// methods are needed. The previous `asMat4Storage()` helper was a runtime no-op
// and was inlined to recover bundle bytes (HPM M0 + LWR M1 cleanup pass).

/** @internal True iff the storage is Float64Array. */
export function isF64Storage(m: Mat4Storage): boolean {
    return m.BYTES_PER_ELEMENT === 8;
}
