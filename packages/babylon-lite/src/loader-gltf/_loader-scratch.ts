import type { EngineContextInternal } from "../engine/engine.js";
import type { Mat4 } from "../math/types.js";

/** @internal Per-loadGltf-call mat4 scratch pool, sourced from the engine
 *  matrix-precision policy. Replaces the module-local `_localScratch` lazy
 *  state that previously shared a single Float32Array across every engine
 *  on the page (REQ-ARCH-3 violation). Each loadGltf invocation owns one
 *  pool; closures inside parser/animation/instancing receive the pool and
 *  reuse its scratch buffers for the duration of the call. */
export interface LoaderScratch {
    /** Scratch for non-recursive local TRS composition in `computeNodeWorldMatrix`.
     *  Safe to reuse across non-recursive sibling calls; recursive `world`
     *  matrices are still allocated per-call inside the parser. */
    tmpLocal: Mat4;
    /** Scratch for per-bone matrix multiplication inside `computeBoneTextureData`. */
    tmpAnim: Mat4;
    /** Scratch for per-instance world composition inside the GPU-instancing feature. */
    tmpInstance: Mat4;
}

export function createLoaderScratch(engine: EngineContextInternal): LoaderScratch {
    const a = engine._matrixPolicy;
    return {
        tmpLocal: a.allocate(),
        tmpAnim: a.allocate(),
        tmpInstance: a.allocate(),
    };
}
