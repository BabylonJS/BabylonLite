import type { EngineContextInternal } from "../engine/engine.js";
import type { MatrixAllocator } from "../math/_matrix-allocator.js";
import type { SceneContextOptions } from "./scene-core.js";

/** @internal Per-scene captured matrix-precision policy.
 *  In M0 this was a pure mirror of the engine policy. M1 extends it with the
 *  scene's floating-origin offset reference so any matrix-bound entity
 *  (camera, mesh, light) can subtract the offset without holding a scene
 *  pointer (preserving pillar 4b one-way ownership).
 *
 *  The offset is held by reference — the same array that scene-core mutates
 *  in `updateFloatingOriginOffset` each frame. When floating origin is
 *  disabled the array stays `[0, 0, 0]`, so consumers can subtract
 *  unconditionally (single-code-path principle from LWR M1). */
export interface ScenePrecisionPolicy {
    readonly useHighPrecisionMatrix: boolean;
    readonly storageKind: "f32" | "f64";
    /** @internal Allocator inherited from the engine — shared across all scenes on the same engine. */
    readonly allocator: MatrixAllocator;
    /** @internal Floating-origin offset reference (by-ref mutation each frame).
     *  Zero-array when the scene was created without `useFloatingOrigin: true`. */
    readonly floatingOriginOffset: readonly [number, number, number];
}

/** @internal Resolve a scene's matrix policy from its owning engine.
 *  M0: mirrored the engine policy. M1: also carries the floating-origin
 *  offset reference so view-matrix construction can subtract the offset
 *  without depending on the scene.
 *
 *  Falls back to a default F32 allocator if the engine lacks `_matrixPolicy`.
 *  This is purely a test-ergonomics affordance: the synthetic engine objects
 *  used by some unit tests don't go through `createEngine` and therefore
 *  don't have the field populated. Production engines created via
 *  `createEngine` always set it, so the fallback path is never taken at
 *  runtime — keeping HPM-off bit-exact behavior unchanged. */
export function resolveScenePrecisionPolicy(
    engine: EngineContextInternal,
    _sceneOptions: SceneContextOptions,
    floatingOriginOffset: readonly [number, number, number] = [0, 0, 0]
): ScenePrecisionPolicy {
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
        floatingOriginOffset,
    };
}
