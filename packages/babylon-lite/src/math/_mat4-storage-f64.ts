import type { Mat4 } from "./types.js";
import type { MatrixAllocator } from "./_matrix-allocator.js";

/** @internal F64-backed Mat4 allocator. Only imported by createEngine
 *  inside `if (options.useHighPrecisionMatrix)`. Tree-shaken out of HPM-off
 *  bundles via `sideEffects: false` in the package manifest. This module is
 *  the ONLY place in the package that names `new Float64Array(16)`. */
export function createF64MatrixAllocator(): MatrixAllocator {
    return {
        storageKind: "f64",
        allocate(): Mat4 {
            return new Float64Array(16) as unknown as Mat4;
        },
    };
}
