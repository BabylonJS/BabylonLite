import { describe, expect, it } from "vitest";

import type { Mat4 } from "../../packages/babylon-lite/src/math/types";
import { packMat4IntoF32 } from "../../packages/babylon-lite/src/math/pack-mat4-into-f32";
import { mat4Identity } from "../../packages/babylon-lite/src/math/mat4-identity";

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

describe("packMat4IntoF32", () => {
    it("packs an F32-backed Mat4 at offset 0 (bit-identical copy)", () => {
        const src = makeF32Mat4([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        const view = new Float32Array(16);
        packMat4IntoF32(view, src);
        for (let i = 0; i < 16; i++) {
            expect(view[i]).toBe(i + 1);
        }
    });

    it("packs an F64-backed Mat4 whose values are exactly representable in F32", () => {
        const exact = [1, 2, 0.5, 0.25, 0, -1, -2, -0.125, 4, 8, 16, 32, 64, 128, 256, 512];
        const src = makeF64Mat4(exact);
        const view = new Float32Array(16);
        packMat4IntoF32(view, src);
        for (let i = 0; i < 16; i++) {
            expect(view[i]).toBe(exact[i]);
        }
    });

    it("downcasts F64 to F32 via Math.fround for translation-like values that lose precision", () => {
        // F64 carries digits past the F32 ULP for ~1e5; downcast must equal Math.fround().
        const lossy = 1e5 + 1.23456789e-4;
        const src = makeF64Mat4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, lossy, 0, 0, 1]);
        const view = new Float32Array(16);
        packMat4IntoF32(view, src);
        expect(view[12]).toBe(Math.fround(lossy));
        // Confirm there *is* a precision loss versus the F64 source.
        expect(view[12]).not.toBe(lossy);
    });

    it("respects offsetFloats > 0 and leaves earlier slots untouched", () => {
        const src = makeF64Mat4([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        const view = new Float32Array(32);
        for (let i = 0; i < 16; i++) {
            view[i] = -1; // sentinel
        }
        packMat4IntoF32(view, src, 16);
        for (let i = 0; i < 16; i++) {
            expect(view[i]).toBe(-1);
        }
        for (let i = 0; i < 16; i++) {
            expect(view[16 + i]).toBe(i + 1);
        }
    });

    it("returns undefined and writes only into `view` (no allocation observable)", () => {
        const src = makeF32Mat4([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        const view = new Float32Array(16);
        const result = packMat4IntoF32(view, src);
        expect(result).toBeUndefined();
    });

    it("identity round-trip: mat4Identity packed into a fresh view is byte-identical", () => {
        const id = mat4Identity();
        const view = new Float32Array(16);
        packMat4IntoF32(view, id);
        const expected = new Float32Array(16);
        expected[0] = 1;
        expected[5] = 1;
        expected[10] = 1;
        expected[15] = 1;
        expect(Array.from(view)).toEqual(Array.from(expected));
    });
});
