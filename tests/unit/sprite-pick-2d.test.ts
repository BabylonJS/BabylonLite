import { describe, it, expect } from "vitest";
import { createGridSpriteAtlas } from "../../packages/babylon-lite/src/sprite/shared/sprite-atlas";
import { addSprite2D, createSprite2DLayer } from "../../packages/babylon-lite/src/sprite/sprite-2d";
import { createScene2DContext, addToScene2D } from "../../packages/babylon-lite/src/scene2d/scene2d";
import { pickSprite2D } from "../../packages/babylon-lite/src/sprite/picking/pick-2d";
import type { EngineContext } from "../../packages/babylon-lite/src/engine/engine";
import type { Texture2D } from "../../packages/babylon-lite/src/texture/texture-2d";

function fakeEngine(): EngineContext {
    const canvas = { width: 800, height: 600 } as HTMLCanvasElement;
    return { canvas, msaaSamples: 1, drawCallCount: 0 };
}
function fakeAtlas() {
    const tex: Texture2D = { texture: {} as GPUTexture, view: {} as GPUTextureView, sampler: {} as GPUSampler, width: 64, height: 64 };
    return createGridSpriteAtlas(tex, { cellWidthPx: 16, cellHeightPx: 16 });
}

describe("pickSprite2D", () => {
    it("hits a sprite under the cursor and reports normalised UV", () => {
        const scene = createScene2DContext(fakeEngine());
        const layer = createSprite2DLayer(fakeAtlas());
        // Centred 32×32 sprite at (100, 100) with default pivot 0.5.
        addSprite2D(layer, { positionPx: [100, 100], sizePx: [32, 32] });
        addToScene2D(scene, layer);
        const hit = pickSprite2D(scene, 100, 100);
        expect(hit).not.toBeNull();
        expect(hit!.spriteIndex).toBe(0);
        expect(hit!.uv[0]).toBeCloseTo(0.5);
        expect(hit!.uv[1]).toBeCloseTo(0.5);
    });

    it("misses outside the sprite's bounds", () => {
        const scene = createScene2DContext(fakeEngine());
        const layer = createSprite2DLayer(fakeAtlas());
        addSprite2D(layer, { positionPx: [100, 100], sizePx: [32, 32] });
        addToScene2D(scene, layer);
        expect(pickSprite2D(scene, 200, 200)).toBeNull();
    });

    it("skips invisible and !pickable sprites", () => {
        const scene = createScene2DContext(fakeEngine());
        const layer = createSprite2DLayer(fakeAtlas());
        addSprite2D(layer, { positionPx: [100, 100], sizePx: [32, 32], visible: false });
        addSprite2D(layer, { positionPx: [200, 100], sizePx: [32, 32], pickable: false });
        addToScene2D(scene, layer);
        expect(pickSprite2D(scene, 100, 100)).toBeNull();
        expect(pickSprite2D(scene, 200, 100)).toBeNull();
    });

    it("returns the topmost sprite when multiple overlap (higher layerZ wins)", () => {
        const scene = createScene2DContext(fakeEngine());
        const layer = createSprite2DLayer(fakeAtlas());
        addSprite2D(layer, { positionPx: [100, 100], sizePx: [32, 32], layer: 0.1 });
        const top = addSprite2D(layer, { positionPx: [100, 100], sizePx: [32, 32], layer: 0.9 });
        addToScene2D(scene, layer);
        const hit = pickSprite2D(scene, 100, 100);
        expect(hit!.spriteIndex).toBe(top);
    });

    it("respects rotation when testing the rectangle", () => {
        const scene = createScene2DContext(fakeEngine());
        const layer = createSprite2DLayer(fakeAtlas());
        // 10x100 vertical bar rotated 90°.
        addSprite2D(layer, { positionPx: [100, 100], sizePx: [10, 100], rotation: Math.PI / 2 });
        addToScene2D(scene, layer);
        // Far horizontal end of the rotated bar should hit.
        expect(pickSprite2D(scene, 145, 100)).not.toBeNull();
        // Above/below the (now) horizontal bar should miss.
        expect(pickSprite2D(scene, 100, 145)).toBeNull();
    });
});
