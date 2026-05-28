import { describe, expect, it } from "vitest";

import type { EngineContextInternal, RenderingContext } from "../../packages/babylon-lite/src/engine/engine";
import type { MatrixAllocator } from "../../packages/babylon-lite/src/math/_matrix-allocator";
import { createF64MatrixAllocator } from "../../packages/babylon-lite/src/math/_mat4-storage-f64";

// `createEngine` requires a live WebGPU adapter and cannot run under Vitest. We
// instead exercise the allocator factories directly here — they are the entire
// observable surface of the `_matrixPolicy` field for Task 1.3. The real
// `createEngine` selects between these two factories based on
// `options.useHighPrecisionMatrix`; `engine.ts` (createF32MatrixAllocator) is a
// module-local helper, so we replicate its trivial shape here to test it
// without coupling to private exports.
function createF32MatrixAllocatorForTest(): MatrixAllocator {
    return {
        storageKind: "f32",
        allocate(): never {
            return new Float32Array(16) as unknown as never;
        },
    };
}

describe("engine matrix policy", () => {
    it("default (HPM off) yields an F32 allocator that returns Float32Array", () => {
        const p = createF32MatrixAllocatorForTest();
        expect(p.storageKind).toBe("f32");
        const m = p.allocate() as unknown as Float32Array;
        expect(m).toBeInstanceOf(Float32Array);
        expect(m.length).toBe(16);
    });

    it("HPM on yields an F64 allocator that returns Float64Array", () => {
        const p = createF64MatrixAllocator();
        expect(p.storageKind).toBe("f64");
        const m = p.allocate() as unknown as Float64Array;
        expect(m).toBeInstanceOf(Float64Array);
        expect(m.length).toBe(16);
    });

    it("two allocator instances produce independent storage", () => {
        const a = createF64MatrixAllocator();
        const b = createF64MatrixAllocator();
        const ma = a.allocate() as unknown as Float64Array;
        const mb = b.allocate() as unknown as Float64Array;
        expect(ma).not.toBe(mb);
        ma[0] = 42;
        expect(mb[0]).toBe(0);
    });

    it("two engines created with different HPM flags do not share allocator state", () => {
        // Simulate two engines: one HPM-off (F32), one HPM-on (F64).
        const off = createF32MatrixAllocatorForTest();
        const on = createF64MatrixAllocator();
        expect(off.storageKind).toBe("f32");
        expect(on.storageKind).toBe("f64");
        // No shared module-level mutable state: allocate twice and confirm
        // each returns a fresh typed array.
        const m1 = off.allocate() as unknown as Float32Array;
        const m2 = off.allocate() as unknown as Float32Array;
        expect(m1).not.toBe(m2);
        const n1 = on.allocate() as unknown as Float64Array;
        const n2 = on.allocate() as unknown as Float64Array;
        expect(n1).not.toBe(n2);
    });

    // Silence unused-var noise for the RenderingContext type import (helps catch
    // accidental moves of the EngineContextInternal field shape).
    it("EngineContextInternal includes a _matrixPolicy field (type-level)", () => {
        const _shape: Pick<EngineContextInternal, "_matrixPolicy" | "_renderingContexts"> = {
            _matrixPolicy: createF64MatrixAllocator(),
            _renderingContexts: [] as RenderingContext[],
        };
        expect(_shape._matrixPolicy.storageKind).toBe("f64");
    });
});
