import { describe, expect, it } from "vitest";

import type { EngineContextInternal } from "../../packages/babylon-lite/src/engine/engine";
import type { MatrixAllocator } from "../../packages/babylon-lite/src/math/_matrix-allocator";
import type { Mat4Storage } from "../../packages/babylon-lite/src/math/_mat4-storage-f64";
import { createLoaderScratch } from "../../packages/babylon-lite/src/loader-gltf/_loader-scratch";

// `loadGltf` requires a real WebGPU engine + an asset to fetch, neither of
// which is available under Vitest. We test the scratch factory directly —
// it's the entire observable surface of the REQ-ARCH-3 fix (per-loadGltf
// scratch, sourced from engine matrix policy, never module-level).

function f32Allocator(): MatrixAllocator {
    return {
        storageKind: "f32",
        allocate: () => new Float32Array(16) as unknown as never,
    };
}

function fakeEngine(allocator: MatrixAllocator): EngineContextInternal {
    return { _matrixPolicy: allocator } as unknown as EngineContextInternal;
}

describe("glTF loader scratch isolation", () => {
    it("HPM-off engine produces F32-backed scratch buffers", () => {
        const scratch = createLoaderScratch(fakeEngine(f32Allocator()));
        expect(scratch.tmpLocal as unknown as Mat4Storage).toBeInstanceOf(Float32Array);
        expect(scratch.tmpAnim as unknown as Mat4Storage).toBeInstanceOf(Float32Array);
        expect(scratch.tmpInstance as unknown as Mat4Storage).toBeInstanceOf(Float32Array);
    });

    it("HPM-on engine produces F64-backed scratch buffers", () => {
        const scratch = createLoaderScratch(fakeEngine(createF64MatrixAllocator()));
        expect(scratch.tmpLocal as unknown as Mat4Storage).toBeInstanceOf(Float64Array);
        expect(scratch.tmpAnim as unknown as Mat4Storage).toBeInstanceOf(Float64Array);
        expect(scratch.tmpInstance as unknown as Mat4Storage).toBeInstanceOf(Float64Array);
    });

    it("two engines on the same page get independent scratch (REQ-ARCH-3)", () => {
        // The old module-local _localScratch in gltf-parser.ts was shared
        // across every engine. Each createLoaderScratch call must return a
        // freshly-allocated pool.
        const a = createLoaderScratch(fakeEngine(f32Allocator()));
        const b = createLoaderScratch(fakeEngine(createF64MatrixAllocator()));
        expect(a.tmpLocal).not.toBe(b.tmpLocal);
        expect(a.tmpLocal as unknown as Mat4Storage).toBeInstanceOf(Float32Array);
        expect(b.tmpLocal as unknown as Mat4Storage).toBeInstanceOf(Float64Array);
        // Writing to one must not leak into the other.
        (a.tmpLocal as unknown as Mat4Storage)[0] = 42;
        expect((b.tmpLocal as unknown as Mat4Storage)[0]).toBe(0);
    });

    it("repeated calls on the same engine return fresh, independent scratch", () => {
        const eng = fakeEngine(f32Allocator());
        const s1 = createLoaderScratch(eng);
        const s2 = createLoaderScratch(eng);
        expect(s1.tmpLocal).not.toBe(s2.tmpLocal);
        expect(s1.tmpAnim).not.toBe(s2.tmpAnim);
        expect(s1.tmpInstance).not.toBe(s2.tmpInstance);
    });
});
