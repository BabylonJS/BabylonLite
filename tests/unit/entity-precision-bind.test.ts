import { describe, expect, it } from "vitest";

import type { EngineContextInternal } from "../../packages/babylon-lite/src/engine/engine";
import type { MatrixAllocator } from "../../packages/babylon-lite/src/math/_matrix-allocator";
import { createF64MatrixAllocator } from "../../packages/babylon-lite/src/math/_mat4-storage-f64";
import { bindEntityMatrixPolicy, type MatrixBindable } from "../../packages/babylon-lite/src/scene/_entity-precision-bind";
import { resolveScenePrecisionPolicy } from "../../packages/babylon-lite/src/scene/_scene-precision";

// `createSceneContext` requires a WebGPU device for its frame-graph wiring,
// so we exercise the bind helper directly with synthetic policies that have
// the same shape as the one stamped onto a real scene. This is the entire
// observable surface of Task 2.2.

function f32Allocator(): MatrixAllocator {
    return {
        storageKind: "f32",
        allocate: () => new Float32Array(16) as unknown as never,
    };
}

function fakeEngine(allocator: MatrixAllocator): EngineContextInternal {
    return { _matrixPolicy: allocator } as unknown as EngineContextInternal;
}

describe("entity matrix-policy bind", () => {
    it("first attach sets _boundPolicy and invokes _rebindAllocator", () => {
        const engine = fakeEngine(f32Allocator());
        const policy = resolveScenePrecisionPolicy(engine, {});
        let rebindCalls = 0;
        const entity: MatrixBindable = {
            _rebindAllocator: () => {
                rebindCalls++;
            },
        };
        bindEntityMatrixPolicy(entity, policy);
        expect(entity._boundPolicy).toBe(policy);
        expect(rebindCalls).toBe(1);
    });

    it("same-engine reattach is a no-op (does not throw, does not re-rebind)", () => {
        const engine = fakeEngine(f32Allocator());
        const policyA1 = resolveScenePrecisionPolicy(engine, {});
        const policyA2 = resolveScenePrecisionPolicy(engine, { useFloatingOrigin: true });
        // Two scenes on the same engine — distinct policy objects, same allocator.
        expect(policyA1).not.toBe(policyA2);
        expect(policyA1.allocator).toBe(policyA2.allocator);

        let rebindCalls = 0;
        const entity: MatrixBindable = {
            _rebindAllocator: () => {
                rebindCalls++;
            },
        };
        bindEntityMatrixPolicy(entity, policyA1);
        expect(rebindCalls).toBe(1);
        // Reattach to scene A2 — must be a no-op, the storage is still valid.
        expect(() => bindEntityMatrixPolicy(entity, policyA2)).not.toThrow();
        expect(rebindCalls).toBe(1);
        expect(entity._boundPolicy).toBe(policyA1);
    });

    it("cross-engine reattach throws synchronously with the mandated message", () => {
        const engineA = fakeEngine(f32Allocator());
        const engineB = fakeEngine(createF64MatrixAllocator());
        const policyA = resolveScenePrecisionPolicy(engineA, {});
        const policyB = resolveScenePrecisionPolicy(engineB, {});
        const entity: MatrixBindable = {};
        bindEntityMatrixPolicy(entity, policyA);
        expect(() => bindEntityMatrixPolicy(entity, policyB)).toThrowError(/matrix-precision policy/);
    });

    it("works for entities without a _rebindAllocator hook (cameras pre-Task-2.3)", () => {
        const engine = fakeEngine(f32Allocator());
        const policy = resolveScenePrecisionPolicy(engine, {});
        const entity: MatrixBindable = {};
        expect(() => bindEntityMatrixPolicy(entity, policy)).not.toThrow();
        expect(entity._boundPolicy).toBe(policy);
    });

    it("cross-engine fast-fail fires regardless of matching storage kind", () => {
        // Two HPM-on engines each have their OWN F64 allocator. Reattach across
        // them must still throw — allocators are reference-compared, not type-compared.
        const engineA = fakeEngine(createF64MatrixAllocator());
        const engineB = fakeEngine(createF64MatrixAllocator());
        const policyA = resolveScenePrecisionPolicy(engineA, {});
        const policyB = resolveScenePrecisionPolicy(engineB, {});
        expect(policyA.storageKind).toBe("f64");
        expect(policyB.storageKind).toBe("f64");
        const entity: MatrixBindable = {};
        bindEntityMatrixPolicy(entity, policyA);
        expect(() => bindEntityMatrixPolicy(entity, policyB)).toThrowError(/matrix-precision policy/);
    });
});
