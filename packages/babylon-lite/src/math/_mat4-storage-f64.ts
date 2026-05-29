import type { Mat4 } from "./types.js";
import type { MatrixAllocator } from "./_matrix-allocator.js";

/** @internal Build-time tag string used by `tests/bundle-content-no-f64.test.ts`
 *  to assert this module is absent from HPM-off bundles. Bundlers (terser,
 *  esbuild) do not rename string contents, so this constant survives
 *  minification verbatim and is a reliable presence-marker.
 *
 *  The constant must be REFERENCED from the surviving code path (not just
 *  exported) — Rollup sees `const { createF64MatrixAllocator } = await
 *  import(...)` at the only call site and DCEs every other export. We embed
 *  the literal as a computed-key property on the returned allocator below so
 *  the string survives minification verbatim. */
export const MAT4_STORAGE_F64_BUILD_TAG = "@@MAT4_STORAGE_F64@@";

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
        // Build-time presence marker — see comment on MAT4_STORAGE_F64_BUILD_TAG.
        // Computed-key property forces the literal string into the minified
        // chunk so `tests/bundle-content-no-f64.test.ts` can grep for it.
        [MAT4_STORAGE_F64_BUILD_TAG]: true,
    } as MatrixAllocator;
}
