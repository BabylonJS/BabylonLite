import { describe, it, expect } from "vitest";
import { createGridSpriteAtlas, createNamedSpriteAtlas, resolveSpriteFrame } from "../../packages/babylon-lite/src/sprite/shared/sprite-atlas";
import type { Texture2D } from "../../packages/babylon-lite/src/texture/texture-2d";

function fakeTexture(width: number, height: number): Texture2D {
    return { texture: {} as GPUTexture, view: {} as GPUTextureView, sampler: {} as GPUSampler, width, height };
}

describe("createGridSpriteAtlas", () => {
    it("computes UV rects for a tightly-packed 4×2 grid", () => {
        const atlas = createGridSpriteAtlas(fakeTexture(128, 64), { cellWidthPx: 32, cellHeightPx: 32 });
        expect(atlas.frames).toHaveLength(8);
        // Top-left frame: u in [0, 0.25], v in [0, 0.5].
        expect(atlas.frames[0]!.uvMin).toEqual([0, 0]);
        expect(atlas.frames[0]!.uvMax).toEqual([32 / 128, 32 / 64]);
        // Last frame: column 3, row 1.
        expect(atlas.frames[7]!.uvMin).toEqual([96 / 128, 32 / 64]);
        expect(atlas.frames[7]!.uvMax).toEqual([128 / 128, 64 / 64]);
        // Default pivot is centre.
        expect(atlas.frames[3]!.pivot).toEqual([0.5, 0.5]);
        expect(atlas.frames[0]!.sourceSizePx).toEqual([32, 32]);
    });

    it("honours explicit columns/rows and margin/spacing", () => {
        const atlas = createGridSpriteAtlas(fakeTexture(72, 36), {
            cellWidthPx: 16,
            cellHeightPx: 16,
            columns: 3,
            rows: 1,
            marginPx: 4,
            spacingPx: 4,
        });
        expect(atlas.frames).toHaveLength(3);
        // Frame 1: x = 4 + 1 * (16+4) = 24.
        expect(atlas.frames[1]!.uvMin[0]).toBeCloseTo(24 / 72);
    });

    it("populates _clipByName lookup", () => {
        const clips = [{ name: "walk", frames: [0, 1, 2, 3], fps: 12, loop: true }];
        const atlas = createGridSpriteAtlas(fakeTexture(64, 64), { cellWidthPx: 16, cellHeightPx: 16, clips });
        expect(atlas._clipByName.get("walk")).toBe(0);
    });
});

describe("createNamedSpriteAtlas", () => {
    it("populates _frameByName lookup", () => {
        const tex = fakeTexture(64, 64);
        const atlas = createNamedSpriteAtlas(tex, [
            { name: "head", uvMin: [0, 0], uvMax: [0.5, 0.5], sourceSizePx: [32, 32], pivot: [0.5, 0.5] },
            { name: "body", uvMin: [0.5, 0], uvMax: [1, 0.5], sourceSizePx: [32, 32], pivot: [0.5, 0.5] },
        ]);
        expect(atlas._frameByName.get("head")).toBe(0);
        expect(atlas._frameByName.get("body")).toBe(1);
    });
});

describe("resolveSpriteFrame", () => {
    const atlas = createNamedSpriteAtlas(fakeTexture(64, 64), [{ name: "a", uvMin: [0, 0], uvMax: [1, 1], sourceSizePx: [64, 64], pivot: [0.5, 0.5] }]);

    it("returns numeric frames as-is when in range", () => {
        expect(resolveSpriteFrame(atlas, 0)).toBe(0);
    });

    it("looks up named frames", () => {
        expect(resolveSpriteFrame(atlas, "a")).toBe(0);
    });

    it("throws on out-of-range index", () => {
        expect(() => resolveSpriteFrame(atlas, 99)).toThrow(/out of range/);
    });

    it("throws on unknown name", () => {
        expect(() => resolveSpriteFrame(atlas, "missing")).toThrow(/not found/);
    });
});
