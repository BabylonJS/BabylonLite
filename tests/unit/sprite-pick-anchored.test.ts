/**
 * sprite-pick-anchored.test.ts
 *
 * CPU rotation-aware hit test for AnchoredSpriteLayer. Uses a pinhole-style
 * orthographic-ish setup so the picking code's math (project → NDC → pixels →
 * inverse rotation about projected pivot) matches the renderer.
 */

import { describe, it, expect } from "vitest";
import { createGridSpriteAtlas } from "../../packages/babylon-lite/src/sprite/shared/sprite-atlas";
import { addAnchoredSprite, createAnchoredSpriteLayer, updateAnchoredSprite } from "../../packages/babylon-lite/src/sprite/sprite-anchored";
import { pickAnchoredSprite } from "../../packages/babylon-lite/src/sprite/picking/pick-anchored";
import type { SceneContext } from "../../packages/babylon-lite/src/scene/scene";
import type { Camera } from "../../packages/babylon-lite/src/camera/camera";
import type { Texture2D } from "../../packages/babylon-lite/src/texture/texture-2d";
import { mat4Identity, mat4PerspectiveLH } from "../../packages/babylon-lite/src/math/mat4";

function fakeAtlas() {
    const tex: Texture2D = { texture: {} as GPUTexture, view: {} as GPUTextureView, sampler: {} as GPUSampler, width: 64, height: 64 };
    return createGridSpriteAtlas(tex, { cellWidthPx: 16, cellHeightPx: 16 });
}

function fakeCamera(): Camera {
    // Identity world matrix → eye at origin, looking down -Z (LH convention used in
    // the project's view-matrix derivation; see camera.ts).  We pre-cache projection
    // and view-projection so getViewProjectionMatrix returns the values we want.
    const cam: Camera = {
        fov: Math.PI / 4,
        nearPlane: 0.1,
        farPlane: 100,
        children: [],
        worldMatrix: mat4Identity() as unknown as Float32Array as unknown as Camera["worldMatrix"],
        worldMatrixVersion: 1,
    };
    return cam;
}

function fakeScene(): SceneContext {
    const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
    return {
        engine: { canvas, msaaSamples: 1, drawCallCount: 0 },
        clearColor: { r: 0, g: 0, b: 0, a: 1 },
        camera: fakeCamera(),
        lights: [],
        meshes: [],
        animationGroups: [],
        fog: null,
        shadowGenerators: [],
        imageProcessing: { exposure: 1, contrast: 1, toneMappingEnabled: false },
        fixedDeltaMs: 0,
    } as unknown as SceneContext;
}

function registerLayer(scene: SceneContext, layer: ReturnType<typeof createAnchoredSpriteLayer>): void {
    const reg = (scene as unknown as { _anchoredLayers?: unknown[] })._anchoredLayers ?? [];
    reg.push(layer);
    (scene as unknown as { _anchoredLayers: unknown[] })._anchoredLayers = reg;
}

/** Compute the screen-pixel position of a world anchor for picking-test sanity. */
function anchorScreenPx(scene: SceneContext, world: [number, number, number]): [number, number] {
    const cam = scene.camera!;
    const aspect = scene.engine.canvas.width / scene.engine.canvas.height;
    const proj = mat4PerspectiveLH(cam.fov, aspect, cam.nearPlane, cam.farPlane);
    // View matrix for an identity-world camera is identity (column-major).
    const vp = proj;
    const cx = vp[0]! * world[0] + vp[4]! * world[1] + vp[8]! * world[2] + vp[12]!;
    const cy = vp[1]! * world[0] + vp[5]! * world[1] + vp[9]! * world[2] + vp[13]!;
    const cw = vp[3]! * world[0] + vp[7]! * world[1] + vp[11]! * world[2] + vp[15]!;
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    return [(ndcX * 0.5 + 0.5) * scene.engine.canvas.width, (1 - (ndcY * 0.5 + 0.5)) * scene.engine.canvas.height];
}

describe("pickAnchoredSprite", () => {
    it("hits the sprite under the cursor at the projected anchor", () => {
        const scene = fakeScene();
        const layer = createAnchoredSpriteLayer(fakeAtlas());
        addAnchoredSprite(layer, { position: [0, 0, 5], sizePx: [80, 40] });
        registerLayer(scene, layer);
        const [px, py] = anchorScreenPx(scene, [0, 0, 5]);
        const hit = pickAnchoredSprite(scene, px, py);
        expect(hit).not.toBeNull();
        expect(hit!.spriteIndex).toBe(0);
        expect(hit!.uv[0]).toBeCloseTo(0.5, 1);
        expect(hit!.uv[1]).toBeCloseTo(0.5, 1);
    });

    it("misses when the cursor is outside the pivot-aware rectangle", () => {
        const scene = fakeScene();
        const layer = createAnchoredSpriteLayer(fakeAtlas());
        addAnchoredSprite(layer, { position: [0, 0, 5], sizePx: [40, 40] });
        registerLayer(scene, layer);
        const [px, py] = anchorScreenPx(scene, [0, 0, 5]);
        // 100px away — guaranteed outside a 40px square.
        expect(pickAnchoredSprite(scene, px + 100, py)).toBeNull();
    });

    it("skips !visible and !pickable sprites", () => {
        const scene = fakeScene();
        const layer = createAnchoredSpriteLayer(fakeAtlas());
        addAnchoredSprite(layer, { position: [0, 0, 5], sizePx: [60, 60], visible: false });
        addAnchoredSprite(layer, { position: [0, 0, 5], sizePx: [60, 60], pickable: false });
        registerLayer(scene, layer);
        const [px, py] = anchorScreenPx(scene, [0, 0, 5]);
        expect(pickAnchoredSprite(scene, px, py)).toBeNull();
    });

    it("rotation flips the hit/miss outcome on the long axis of a thin sprite", () => {
        const scene = fakeScene();
        const layer = createAnchoredSpriteLayer(fakeAtlas());
        // 200×10 horizontal bar.
        const idx = addAnchoredSprite(layer, { position: [0, 0, 5], sizePx: [200, 10], rotation: 0 });
        registerLayer(scene, layer);
        const [px, py] = anchorScreenPx(scene, [0, 0, 5]);
        // 80 px to the right, on the centerline → hit while horizontal.
        expect(pickAnchoredSprite(scene, px + 80, py)).not.toBeNull();
        // Same point, now bar is rotated 90° → vertical → 80px to the right is outside.
        updateAnchoredSprite(layer, idx, { rotation: Math.PI / 2 });
        expect(pickAnchoredSprite(scene, px + 80, py)).toBeNull();
        // But 80px above the anchor is now inside the rotated (now vertical) bar.
        expect(pickAnchoredSprite(scene, px, py - 80)).not.toBeNull();
    });

    it("returns the topmost sprite (later insertion wins among equal layers)", () => {
        const scene = fakeScene();
        const layer = createAnchoredSpriteLayer(fakeAtlas());
        addAnchoredSprite(layer, { position: [0, 0, 5], sizePx: [60, 60] });
        const top = addAnchoredSprite(layer, { position: [0, 0, 5], sizePx: [60, 60] });
        registerLayer(scene, layer);
        const [px, py] = anchorScreenPx(scene, [0, 0, 5]);
        const hit = pickAnchoredSprite(scene, px, py);
        expect(hit!.spriteIndex).toBe(top);
    });

    it("returns null when the anchor is behind the camera (cw <= 0)", () => {
        const scene = fakeScene();
        const layer = createAnchoredSpriteLayer(fakeAtlas());
        // z < 0 in LH-projection means behind the camera.
        addAnchoredSprite(layer, { position: [0, 0, -2], sizePx: [200, 200] });
        registerLayer(scene, layer);
        expect(pickAnchoredSprite(scene, 640, 360)).toBeNull();
    });
});
