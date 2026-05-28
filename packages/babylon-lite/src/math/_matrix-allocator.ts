import type { Mat4 } from "./types.js";

/** @internal Per-engine matrix allocator. M0 has two implementations:
 *  the default F32 allocator (colocated with createEngine for tree-shaking)
 *  and the gated F64 allocator in `_mat4-storage-f64.ts`. */
export interface MatrixAllocator {
    readonly storageKind: "f32" | "f64";
    /** Allocate a new zero-initialized 16-element Mat4. */
    allocate(): Mat4;
}
