// Scene 37 — Billboard Yaw-Locked / Cylindrical (Family 3).
//
// Five sprites rendered through `createYawLockedBillboardSystem`. Quad up-axis
// is locked to world-Y, so trees stay vertical regardless of camera tilt.
// Comparing this scene's golden against scene 36's exposes the difference:
// here the top edges remain world-vertical, while in scene 36 they tilt with
// the camera.
//
// Reference path: BJS has no native yaw-locked SpriteManager, so the BJS
// reference (`bjs/scene37.ts`) builds its own quads via textured planes with
// the same yaw-lock basis (up = worldY, right = normalize(cross(worldY,
// toCam))). This produces tight parity (MAD ≪ 0.01) — the alternative of
// using BJS's spherical SpriteManager would produce a structural diff that
// has nothing to do with the math we're validating.

import {
    addBillboardSprite,
    addToScene,
    createArcRotateCamera,
    createGround,
    createHemisphericLight,
    createSceneContext,
    createStandardMaterial,
    createEngine,
    createYawLockedBillboardSystem,
    loadSpriteAtlas,
    onBeforeRender,
    startEngine,
} from "babylon-lite";
import { BILLBOARD_ATLAS_INFO, BILLBOARD_ATLAS_URL } from "../_shared/sprite-billboard-atlas";
import { BILLBOARD_SCENE_LAYOUT } from "../_shared/billboard-scene-layout";

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);

    const seekParam = new URLSearchParams(location.search).get("seekTime");
    const seekTime = seekParam !== null ? parseFloat(seekParam) : 1.0;

    const scene = createSceneContext(engine);
    scene.clearColor = BILLBOARD_SCENE_LAYOUT.clearColor;
    scene.fixedDeltaMs = 16.667;

    const cam = BILLBOARD_SCENE_LAYOUT.camera;
    scene.camera = createArcRotateCamera(cam.alpha, cam.beta, cam.radius, cam.target);
    scene.camera.fov = cam.fov;
    scene.camera.nearPlane = cam.near;
    scene.camera.farPlane = cam.far;

    addToScene(scene, createHemisphericLight([0, 1, 0], 0.95));

    const groundMat = createStandardMaterial();
    groundMat.diffuseColor = BILLBOARD_SCENE_LAYOUT.groundColor;
    const ground = createGround(engine, { width: 12, height: 12 });
    ground.material = groundMat;
    addToScene(scene, ground);

    const atlas = await loadSpriteAtlas(engine, BILLBOARD_ATLAS_URL, {
        cellWidthPx: BILLBOARD_ATLAS_INFO.cellWidthPx,
        cellHeightPx: BILLBOARD_ATLAS_INFO.cellHeightPx,
        columns: BILLBOARD_ATLAS_INFO.columns,
        rows: BILLBOARD_ATLAS_INFO.rows,
        sampling: "linear",
    });

    const layer = createYawLockedBillboardSystem(atlas, { capacity: 8, blendMode: "alpha" });
    for (const s of BILLBOARD_SCENE_LAYOUT.sprites) {
        addBillboardSprite(layer, {
            position: s.position,
            sizeWorld: s.sizeWorld,
            frame: BILLBOARD_ATLAS_INFO.frames.tree,
        });
    }
    addToScene(scene, layer);

    let frames = 0;
    const target = Math.round(seekTime * 60);
    onBeforeRender(scene, () => {
        frames++;
        if (frames === target + 1) {
            canvas.dataset.animationFrozen = "true";
        }
    });

    await startEngine(engine, scene);

    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

main().catch(console.error);
