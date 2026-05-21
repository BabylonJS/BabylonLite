import { describe, expect, it, vi } from "vitest";

import type { EngineContextInternal } from "../../packages/babylon-lite/src/engine/engine";
import type { SceneContextInternal } from "../../packages/babylon-lite/src/scene/scene-core";
import type { SpriteAtlas } from "../../packages/babylon-lite/src/sprite/shared/sprite-atlas";
import { addBillboardSpriteIndex, createFacingBillboardSystem } from "../../packages/babylon-lite/src/sprite/billboard-sprite";
import { addBillboardSprite, isBillboardSpriteHandleAlive } from "../../packages/babylon-lite/src/sprite/billboard-sprite-handle";
import { playBillboardSpriteAnimation } from "../../packages/babylon-lite/src/sprite/billboard-sprite-handle-animation";
import { playBillboardSpriteIndexAnimation } from "../../packages/babylon-lite/src/sprite/billboard-sprite-index-animation";
import {
    addSpriteAnimation,
    attachSpriteAnimationsToRenderer,
    attachSpriteAnimationsToScene,
    clearSpriteAnimations,
    createSpriteAnimationManager,
    disposeSpriteAnimationBinding,
    removeSpriteAnimation,
    stopSpriteAnimation,
    updateSpriteAnimationManager,
} from "../../packages/babylon-lite/src/sprite/sprite-animation";
import type { SpriteFrameAnimation } from "../../packages/babylon-lite/src/sprite/sprite-animation";
import { addSprite2DIndex, createSprite2DLayer, removeSprite2DIndex } from "../../packages/babylon-lite/src/sprite/sprite-2d";
import { addSprite2D, getSprite2DHandleIndex, isSprite2DHandleAlive } from "../../packages/babylon-lite/src/sprite/sprite-2d-handle";
import { playSprite2DAnimation } from "../../packages/babylon-lite/src/sprite/sprite-2d-handle-animation";
import { playSprite2DIndexAnimation } from "../../packages/babylon-lite/src/sprite/sprite-2d-index-animation";
import type { SpriteRenderer } from "../../packages/babylon-lite/src/sprite/sprite-renderer";
import type { Texture2D } from "../../packages/babylon-lite/src/texture/texture-2d";

function makeMockAtlas(): SpriteAtlas {
    const texture = {
        texture: {} as GPUTexture,
        view: {} as GPUTextureView,
        sampler: {} as GPUSampler,
        width: 256,
        height: 32,
    } satisfies Texture2D;
    return {
        texture,
        textureSizePx: [256, 32],
        frames: [
            { uvMin: [0, 0], uvMax: [0.125, 1], sourceSizePx: [32, 32], pivot: [0.5, 0.5] },
            { uvMin: [0.125, 0], uvMax: [0.25, 1], sourceSizePx: [32, 32], pivot: [0.5, 0.5] },
            { uvMin: [0.25, 0], uvMax: [0.375, 1], sourceSizePx: [32, 32], pivot: [0.5, 0.5] },
            { uvMin: [0.375, 0], uvMax: [0.5, 1], sourceSizePx: [32, 32], pivot: [0.5, 0.5] },
            { uvMin: [0.5, 0], uvMax: [0.625, 1], sourceSizePx: [32, 32], pivot: [0.5, 0.5] },
            { uvMin: [0.625, 0], uvMax: [0.75, 1], sourceSizePx: [32, 32], pivot: [0.5, 0.5] },
            { uvMin: [0.75, 0], uvMax: [0.875, 1], sourceSizePx: [32, 32], pivot: [0.5, 0.5] },
            { uvMin: [0.875, 0], uvMax: [1, 1], sourceSizePx: [32, 32], pivot: [0.5, 0.5] },
        ],
        premultipliedAlpha: false,
    };
}

function sprite2DUvMinX(layer: ReturnType<typeof createSprite2DLayer>, index = 0): number {
    return layer._instanceData[index * layer._instanceFloatsPerSprite + 4]!;
}

function sprite2DUvMaxX(layer: ReturnType<typeof createSprite2DLayer>, index = 0): number {
    return layer._instanceData[index * layer._instanceFloatsPerSprite + 6]!;
}

function billboardUvMinX(system: ReturnType<typeof createFacingBillboardSystem>, index = 0): number {
    return system._instanceData[index * system._instanceFloatsPerSprite + 5]!;
}

describe("SpriteAnimationManager", () => {
    it("adds, removes, clears, and stops animations without touching sprite family code", () => {
        const manager = createSpriteAnimationManager();
        const setFrame = vi.fn();
        const animation: SpriteFrameAnimation = {
            _entityType: "sprite-frame-animation",
            target: { kind: "mock", setFrame },
            from: 0,
            to: 3,
            current: 0,
            loop: true,
            delayMs: 100,
            accumulatedMs: 0,
            animationStarted: true,
            removeWhenFinished: false,
            _direction: 1,
        };

        addSpriteAnimation(manager, animation);
        addSpriteAnimation(manager, animation);
        expect(manager.animations).toEqual([animation]);

        stopSpriteAnimation(animation);
        updateSpriteAnimationManager(manager, 101);
        expect(setFrame).not.toHaveBeenCalled();
        expect(animation.animationStarted).toBe(false);

        removeSpriteAnimation(manager, animation);
        expect(manager.animations).toEqual([]);

        addSpriteAnimation(manager, animation);
        clearSpriteAnimations(manager);
        expect(manager.animations).toEqual([]);
    });

    it("uses fixedDeltaMs when supplied", () => {
        const manager = createSpriteAnimationManager({ fixedDeltaMs: 51 });
        const layer = createSprite2DLayer(makeMockAtlas());
        addSprite2DIndex(layer, { positionPx: [0, 0], sizePx: [32, 32], frame: 0 });
        playSprite2DIndexAnimation(manager, layer, 0, 0, 2, true, 50);

        updateSpriteAnimationManager(manager, 1);

        expect(sprite2DUvMinX(layer)).toBeCloseTo(0.125);
    });
});

describe("Sprite2D index animation", () => {
    it("matches Babylon.js frame-delay semantics", () => {
        const manager = createSpriteAnimationManager();
        const layer = createSprite2DLayer(makeMockAtlas());
        addSprite2DIndex(layer, { positionPx: [100, 100], sizePx: [32, 32], frame: 0 });

        playSprite2DIndexAnimation(manager, layer, 0, 0, 3, true, 100);
        expect(sprite2DUvMinX(layer)).toBeCloseTo(0);

        updateSpriteAnimationManager(manager, 100);
        expect(sprite2DUvMinX(layer)).toBeCloseTo(0);

        updateSpriteAnimationManager(manager, 1);
        expect(sprite2DUvMinX(layer)).toBeCloseTo(0.125);

        updateSpriteAnimationManager(manager, 500);
        expect(sprite2DUvMinX(layer)).toBeCloseTo(0.25);
    });

    it("loops and supports reverse ranges", () => {
        const manager = createSpriteAnimationManager();
        const layer = createSprite2DLayer(makeMockAtlas());
        addSprite2DIndex(layer, { positionPx: [0, 0], sizePx: [32, 32], frame: 0 });

        playSprite2DIndexAnimation(manager, layer, 0, 0, 2, true, 50);
        updateSpriteAnimationManager(manager, 51);
        updateSpriteAnimationManager(manager, 51);
        expect(sprite2DUvMinX(layer)).toBeCloseTo(0.25);
        updateSpriteAnimationManager(manager, 51);
        expect(sprite2DUvMinX(layer)).toBeCloseTo(0);

        clearSpriteAnimations(manager);
        playSprite2DIndexAnimation(manager, layer, 0, 3, 0, false, 50);
        expect(sprite2DUvMinX(layer)).toBeCloseTo(0.375);
        updateSpriteAnimationManager(manager, 51);
        expect(sprite2DUvMinX(layer)).toBeCloseTo(0.25);
        updateSpriteAnimationManager(manager, 51);
        expect(sprite2DUvMinX(layer)).toBeCloseTo(0.125);
        updateSpriteAnimationManager(manager, 51);
        expect(sprite2DUvMinX(layer)).toBeCloseTo(0);
        updateSpriteAnimationManager(manager, 51);
        expect(manager.animations).toEqual([]);
        expect(sprite2DUvMinX(layer)).toBeCloseTo(0);
    });

    it("preserves Sprite2D flip state when advancing frames", () => {
        const manager = createSpriteAnimationManager();
        const layer = createSprite2DLayer(makeMockAtlas());
        addSprite2DIndex(layer, { positionPx: [0, 0], sizePx: [32, 32], frame: 0, flipX: true });

        expect(sprite2DUvMinX(layer)).toBeGreaterThan(sprite2DUvMaxX(layer));

        playSprite2DIndexAnimation(manager, layer, 0, 0, 2, true, 50);
        updateSpriteAnimationManager(manager, 51);

        expect(sprite2DUvMinX(layer)).toBeCloseTo(0.25);
        expect(sprite2DUvMaxX(layer)).toBeCloseTo(0.125);
    });

    it("fires end callback once and removes the index target when requested", () => {
        const manager = createSpriteAnimationManager();
        const layer = createSprite2DLayer(makeMockAtlas());
        addSprite2DIndex(layer, { positionPx: [0, 0], sizePx: [32, 32], frame: 0 });
        const onEnd = vi.fn(() => {
            expect(layer.count).toBe(1);
        });

        playSprite2DIndexAnimation(manager, layer, 0, 0, 1, false, 50, { onEnd, removeWhenFinished: true });
        updateSpriteAnimationManager(manager, 51);
        updateSpriteAnimationManager(manager, 51);
        updateSpriteAnimationManager(manager, 51);

        expect(onEnd).toHaveBeenCalledTimes(1);
        expect(layer.count).toBe(0);
        expect(manager.animations).toEqual([]);
    });
});

describe("Sprite2D handle animation", () => {
    it("survives swap-removes through stable handles", () => {
        const manager = createSpriteAnimationManager();
        const layer = createSprite2DLayer(makeMockAtlas());
        const first = addSprite2D(layer, { positionPx: [0, 0], sizePx: [32, 32], frame: 0 });
        const animated = addSprite2D(layer, { positionPx: [64, 0], sizePx: [32, 32], frame: 0 });
        addSprite2D(layer, { positionPx: [128, 0], sizePx: [32, 32], frame: 0 });

        playSprite2DAnimation(manager, animated, 0, 3, true, 50);
        removeSprite2DIndex(layer, 0);
        expect(isSprite2DHandleAlive(first)).toBe(false);

        updateSpriteAnimationManager(manager, 51);

        expect(sprite2DUvMinX(layer, getSprite2DHandleIndex(animated))).toBeCloseTo(0.125);
    });

    it("removes the handle target when requested", () => {
        const manager = createSpriteAnimationManager();
        const layer = createSprite2DLayer(makeMockAtlas(), { depth: "test-write" });
        const handle = addSprite2D(layer, { positionPx: [0, 0], sizePx: [32, 32], frame: 0, z: 0.6 });

        playSprite2DAnimation(manager, handle, 0, 1, false, 50, { removeWhenFinished: true });
        updateSpriteAnimationManager(manager, 51);
        updateSpriteAnimationManager(manager, 51);

        expect(layer.count).toBe(0);
        expect(isSprite2DHandleAlive(handle)).toBe(false);
    });
});

describe("Billboard sprite animation", () => {
    it("animates billboard frames by index", () => {
        const manager = createSpriteAnimationManager();
        const system = createFacingBillboardSystem(makeMockAtlas());
        addBillboardSpriteIndex(system, { position: [0, 0, 0], sizeWorld: [1, 1], frame: 0 });

        playBillboardSpriteIndexAnimation(manager, system, 0, 0, 3, true, 100);
        updateSpriteAnimationManager(manager, 101);

        expect(billboardUvMinX(system)).toBeCloseTo(0.125);
    });

    it("animates and removes billboard handle targets", () => {
        const manager = createSpriteAnimationManager();
        const system = createFacingBillboardSystem(makeMockAtlas());
        const handle = addBillboardSprite(system, { position: [0, 0, 0], sizeWorld: [1, 1], frame: 0 });

        playBillboardSpriteAnimation(manager, handle, 0, 1, false, 50, { removeWhenFinished: true });
        updateSpriteAnimationManager(manager, 51);
        updateSpriteAnimationManager(manager, 51);

        expect(system.count).toBe(0);
        expect(isBillboardSpriteHandleAlive(handle)).toBe(false);
    });
});

describe("sprite animation render-loop attachments", () => {
    it("attaches to scenes using the actual before-render delta", () => {
        const manager = createSpriteAnimationManager();
        const layer = createSprite2DLayer(makeMockAtlas());
        addSprite2DIndex(layer, { positionPx: [0, 0], sizePx: [32, 32], frame: 0 });
        playSprite2DIndexAnimation(manager, layer, 0, 0, 3, true, 50);
        const scene = { _beforeRender: [] as Array<(deltaMs: number) => void> } as unknown as SceneContextInternal;

        const binding = attachSpriteAnimationsToScene(scene, manager);
        scene._beforeRender[0]!(51);

        expect(sprite2DUvMinX(layer)).toBeCloseTo(0.125);
        disposeSpriteAnimationBinding(binding);
        expect(scene._beforeRender).toEqual([]);
    });

    it("attaches to renderers before upload using engine current delta", () => {
        const manager = createSpriteAnimationManager();
        const layer = createSprite2DLayer(makeMockAtlas());
        addSprite2DIndex(layer, { positionPx: [0, 0], sizePx: [32, 32], frame: 0 });
        playSprite2DIndexAnimation(manager, layer, 0, 0, 3, true, 50);
        let frameSeenByUpload = -1;
        const renderer = {
            _engine: { _currentDelta: 51 } as EngineContextInternal,
            _update: () => {
                frameSeenByUpload = sprite2DUvMinX(layer);
            },
        } as unknown as SpriteRenderer;

        const binding = attachSpriteAnimationsToRenderer(renderer, manager);
        renderer._update();

        expect(frameSeenByUpload).toBeCloseTo(0.125);
        disposeSpriteAnimationBinding(binding);
        (renderer as unknown as { _engine: { _currentDelta: number } })._engine._currentDelta = 51;
        renderer._update();
        expect(sprite2DUvMinX(layer)).toBeCloseTo(0.125);
    });

    it("prevents double attachment for one manager", () => {
        const manager = createSpriteAnimationManager();
        const scene = { _beforeRender: [] as Array<(deltaMs: number) => void> } as unknown as SceneContextInternal;
        attachSpriteAnimationsToScene(scene, manager);

        expect(() => attachSpriteAnimationsToScene(scene, manager)).toThrow(/already attached/);
    });
});
