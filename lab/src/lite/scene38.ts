// Scene 38 — Billboard Axis-Locked to world-X (Family 3).
//
// Five sprites rendered through `createAxisLockedBillboardSystem` with lock
// axis = [1, 0, 0]. Quad up-axis is locked to world-X; right is built from
// the camera-projected forward perpendicular to that axis. Sprites stand
// "sideways" — their up vector points along world-X.
//
// Reference path: BJS has no axis-locked SpriteManager, so the BJS reference
// builds its quads via textured planes with the same basis math (see
// `bjs/scene38.ts`).

import {
    addBillboardSprite,
    addToScene,
    createArcRotateCamera,
    createAxisLockedBillboardSystem,
    createGround,
    createHemisphericLight,
    createSceneContext,
    createStandardMaterial,
    createEngine,
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

    const layer = createAxisLockedBillboardSystem(atlas, [1, 0, 0], { capacity: 8, blendMode: "alpha" });
    for (const s of BILLBOARD_SCENE_LAYOUT.sprites) {
        addBillboardSprite(layer, {
            position: s.position,
            sizeWorld: s.sizeWorld,
            frame: BILLBOARD_ATLAS_INFO.frames.flag,
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
