import { describe, it, expect } from "vitest";
import { createGridSpriteAtlas } from "../../packages/babylon-lite/src/sprite/shared/sprite-atlas";
import { addSprite2D, createSprite2DLayer, removeSprite2D, setSprite2DFrame, SPRITE_2D_STRIDE, updateSprite2D } from "../../packages/babylon-lite/src/sprite/sprite-2d";
import type { Texture2D } from "../../packages/babylon-lite/src/texture/texture-2d";

function makeAtlas() {
    const tex: Texture2D = { texture: {} as GPUTexture, view: {} as GPUTextureView, sampler: {} as GPUSampler, width: 64, height: 64 };
    return createGridSpriteAtlas(tex, { cellWidthPx: 16, cellHeightPx: 16 });
}

describe("createSprite2DLayer", () => {
    it("starts with zero sprites and the requested defaults", () => {
        const layer = createSprite2DLayer(makeAtlas(), { capacity: 4, blendMode: "additive", opacity: 0.5, order: 7 });
        expect(layer.count).toBe(0);
        expect(layer.blendMode).toBe("additive");
        expect(layer.opacity).toBe(0.5);
        expect(layer.order).toBe(7);
        expect(layer._storage.capacity).toBe(4);
    });
});

describe("addSprite2D", () => {
    it("returns a stable index and packs position/size/color into the buffer", () => {
        const layer = createSprite2DLayer(makeAtlas(), { capacity: 2 });
        const i0 = addSprite2D(layer, { positionPx: [10, 20], sizePx: [30, 40], color: [1, 0, 0, 0.5] });
        const i1 = addSprite2D(layer, { positionPx: [50, 60] });
        expect(i0).toBe(0);
        expect(i1).toBe(1);
        const d = layer._storage.data;
        expect(d[0]).toBe(10);
        expect(d[1]).toBe(20);
        expect(d[2]).toBe(30);
        expect(d[3]).toBe(40);
        expect(d[12]).toBe(1);
        expect(d[15]).toBe(0.5);
        // Frame 0 default → uv [0,0]..[16/64, 16/64]
        expect(d[8]).toBe(0);
        expect(d[10]).toBeCloseTo(0.25);
    });

    it("doubles capacity on overflow and keeps existing data", () => {
        const layer = createSprite2DLayer(makeAtlas(), { capacity: 1 });
        addSprite2D(layer, { positionPx: [1, 2] });
        addSprite2D(layer, { positionPx: [3, 4] });
        expect(layer._storage.capacity).toBe(2);
        const d = layer._storage.data;
        expect(d[0]).toBe(1);
        expect(d[SPRITE_2D_STRIDE + 0]).toBe(3);
    });

    it("collapses invisible sprites to zero size in the packed buffer", () => {
        const layer = createSprite2DLayer(makeAtlas());
        const i = addSprite2D(layer, { positionPx: [0, 0], sizePx: [100, 100], visible: false });
        const off = i * SPRITE_2D_STRIDE;
        expect(layer._storage.data[off + 2]).toBe(0);
        expect(layer._storage.data[off + 3]).toBe(0);
    });
});

describe("updateSprite2D", () => {
    it("applies a partial patch and bumps the version", () => {
        const layer = createSprite2DLayer(makeAtlas());
        const i = addSprite2D(layer, { positionPx: [10, 20], sizePx: [40, 40] });
        const v0 = layer._storage.version;
        updateSprite2D(layer, i, { positionPx: [99, 88] });
        expect(layer._storage.data[0]).toBe(99);
        expect(layer._storage.data[1]).toBe(88);
        // Size preserved.
        expect(layer._storage.data[2]).toBe(40);
        expect(layer._storage.version).toBeGreaterThan(v0);
    });
});

describe("removeSprite2D", () => {
    it("swap-removes by overwriting with the last slot", () => {
        const layer = createSprite2DLayer(makeAtlas());
        const a = addSprite2D(layer, { positionPx: [1, 1] });
        const b = addSprite2D(layer, { positionPx: [2, 2] });
        const c = addSprite2D(layer, { positionPx: [3, 3] });
        removeSprite2D(layer, a);
        expect(layer.count).toBe(2);
        // index 0 now holds former c.
        expect(layer._storage.data[0]).toBe(3);
        expect(b).toBe(1);
        expect(c).toBe(2);
    });
});

describe("setSprite2DFrame", () => {
    it("rewrites only the UV rect floats", () => {
        const atlas = makeAtlas();
        const layer = createSprite2DLayer(atlas);
        const i = addSprite2D(layer, { positionPx: [0, 0] });
        // Move to frame index 5 (column 1, row 1 of a 4x4 grid → uv [0.25,0.25]..[0.5,0.5]).
        setSprite2DFrame(layer, i, 5);
        expect(layer._storage.data[8]).toBeCloseTo(0.25);
        expect(layer._storage.data[9]).toBeCloseTo(0.25);
        expect(layer._storage.data[10]).toBeCloseTo(0.5);
        expect(layer._storage.data[11]).toBeCloseTo(0.5);
        // Position untouched.
        expect(layer._storage.data[0]).toBe(0);
    });
});
