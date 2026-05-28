import type { EngineContextInternal } from "../engine/engine.js";
import type { MatrixAllocator } from "../math/_matrix-allocator.js";
import type { SceneContextOptions } from "./scene-core.js";

/** @internal Per-scene captured matrix-precision policy.
 *  In M0 this is a pure mirror of the engine policy. M1 will extend the
 *  resolver to enforce `useFloatingOrigin → useHighPrecisionMatrix` coupling
 *  without restructuring the call sites. */
export interface ScenePrecisionPolicy {
    readonly useHighPrecisionMatrix: boolean;
    readonly storageKind: "f32" | "f64";
    /** @internal Allocator inherited from the engine — shared across all scenes on the same engine. */
    readonly allocator: MatrixAllocator;
}

/** @internal Resolve a scene's matrix policy from its owning engine.
 *  M0: pure mirror. The structural seam exists so M1 can layer floating-origin
 *  validation here without touching `createSceneContext`.
 *
 *  Falls back to a default F32 allocator if the engine lacks `_matrixPolicy`.
 *  This is purely a test-ergonomics affordance: the synthetic engine objects
 *  used by some unit tests don't go through `createEngine` and therefore
 *  don't have the field populated. Production engines created via
 *  `createEngine` always set it, so the fallback path is never taken at
 *  runtime — keeping HPM-off bit-exact behavior unchanged. */
export function resolveScenePrecisionPolicy(engine: EngineContextInternal, _sceneOptions: SceneContextOptions): ScenePrecisionPolicy {
    const allocator: MatrixAllocator =
        engine._matrixPolicy ??
        ({
            storageKind: "f32",
            allocate: () => new Float32Array(16) as unknown as never,
        } as MatrixAllocator);
    return {
        useHighPrecisionMatrix: allocator.storageKind === "f64",
        storageKind: allocator.storageKind,
        allocator,
    };
}
