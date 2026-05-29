import { describe, expect, it } from "vitest";

import type { Mat4 } from "../../packages/babylon-lite/src/math/types";
import { packMat4IntoF32 } from "../../packages/babylon-lite/src/math/pack-mat4-into-f32";
import { packMat4IntoF32WithOffset } from "../../packages/babylon-lite/src/math/pack-mat4-into-f32-with-offset";

function makeF32Mat4(values: number[]): Mat4 {
    const f = new Float32Array(16);
    for (let i = 0; i < 16; i++) {
        f[i] = values[i] ?? 0;
    }
    return f as unknown as Mat4;
}

function makeF64Mat4(values: number[]): Mat4 {
    const f = new Float64Array(16);
    for (let i = 0; i < 16; i++) {
        f[i] = values[i] ?? 0;
    }
    return f as unknown as Mat4;
}

const ZERO: readonly [number, number, number] = [0, 0, 0];

describe("packMat4IntoF32WithOffset", () => {
    it("with zero offset matches packMat4IntoF32 output bit-for-bit (F32 source)", () => {
        const src = makeF32Mat4([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        const a = new Float32Array(16);
        const b = new Float32Array(16);
        packMat4IntoF32(a, src);
        packMat4IntoF32WithOffset(b, src, ZERO);
        expect(Array.from(b)).toEqual(Array.from(a));
    });

    it("with zero offset matches packMat4IntoF32 output bit-for-bit (F64 source, lossy translation)", () => {
        const lossy = 1e6 + 1.23456789e-4;
        const src = makeF64Mat4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, lossy, -lossy, lossy, 1]);
        const a = new Float32Array(16);
        const b = new Float32Array(16);
        packMat4IntoF32(a, src);
        packMat4IntoF32WithOffset(b, src, ZERO);
        expect(Array.from(b)).toEqual(Array.from(a));
    });

    it("subtracts offset from elements [12,13,14] only — leaves rotation columns untouched", () => {
        const src = makeF32Mat4([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 100, 200, 300, 1]);
        const view = new Float32Array(16);
        packMat4IntoF32WithOffset(view, src, [10, 20, 30]);
        // Linear/rotation columns unchanged.
        for (let i = 0; i < 12; i++) {
            expect(view[i]).toBe(i + 1);
        }
        // Translation column offset-subtracted.
        expect(view[12]).toBe(90);
        expect(view[13]).toBe(180);
        expect(view[14]).toBe(270);
        // Final element copied verbatim.
        expect(view[15]).toBe(1);
    });

    it("F64 source: large-minus-large at translation is computed in F64 before F32 store", () => {
        // The world matrix translation is 1e6 + small, the offset (=eye) is 1e6.
        // In F32, 1e6 cannot resolve sub-0.06m perturbations (ULP at 1e6 is ~0.06).
        // In F64, the subtraction recovers the small remainder exactly, then F32
        // stores it with abundant precision.
        const small = 0.0078125; // exactly representable in F32 — 2^-7
        const worldTx = 1_000_000 + small;
        const src = makeF64Mat4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, worldTx, 0, 0, 1]);
        const view = new Float32Array(16);
        packMat4IntoF32WithOffset(view, src, [1_000_000, 0, 0]);
        // Expected: small, exactly.
        expect(view[12]).toBe(small);

        // Contrast: the precision-only packer downcasts worldTx directly, which
        // at this magnitude loses the small remainder entirely.
        const ref = new Float32Array(16);
        packMat4IntoF32(ref, src);
        expect(ref[12]).toBe(Math.fround(worldTx));
        expect(ref[12]).not.toBe(small + 1_000_000); // precision was lost
    });

    it("respects offsetFloats > 0 (dest slot) and leaves earlier slots untouched", () => {
        const src = makeF32Mat4([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 100, 200, 300, 1]);
        const view = new Float32Array(32);
        for (let i = 0; i < 16; i++) {
            view[i] = -1;
        }
        packMat4IntoF32WithOffset(view, src, [10, 20, 30], 16);
        for (let i = 0; i < 16; i++) {
            expect(view[i]).toBe(-1);
        }
        for (let i = 0; i < 12; i++) {
            expect(view[16 + i]).toBe(i + 1);
        }
        expect(view[16 + 12]).toBe(90);
        expect(view[16 + 13]).toBe(180);
        expect(view[16 + 14]).toBe(270);
        expect(view[16 + 15]).toBe(1);
    });

    it("srcOffsetFloats reads a strided mat4 out of a packed slab and applies offset to its translation", () => {
        const slab = new Float64Array(32);
        for (let i = 0; i < 16; i++) {
            slab[i] = i + 1;
            slab[16 + i] = 100 + i;
        }
        // Second slab translation: 112, 113, 114.
        const view = new Float32Array(16);
        packMat4IntoF32WithOffset(view, slab, [2, 3, 4], 0, 16);
        for (let i = 0; i < 12; i++) {
            expect(view[i]).toBe(100 + i);
        }
        expect(view[12]).toBe(110);
        expect(view[13]).toBe(110);
        expect(view[14]).toBe(110);
        expect(view[15]).toBe(115);
    });

    it("returns undefined", () => {
        const src = makeF32Mat4([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 1]);
        const view = new Float32Array(16);
        const result = packMat4IntoF32WithOffset(view, src, [1, 2, 3]);
        expect(result).toBeUndefined();
        expect(view[12]).toBe(0);
        expect(view[13]).toBe(0);
        expect(view[14]).toBe(0);
    });
});
