// Scene 41 — Billboard Sprite Handles + 3D Parenting (Family 3, Handle API).
//
// Demonstrates the Billboard handle API: `addBillboardSprite` returns a handle,
// which we parent to a moving 3D box. The handle's worldMatrix (translation
// only — billboards face the camera in their renderable) follows the parent.

import {
    addBillboardSprite,
    addToScene,
    createArcRotateCamera,
    createBox,
    createEngine,
    createFacingBillboardSystem,
    createHemisphericLight,
    createSceneContext,
    createStandardMaterial,
    loadSpriteAtlas,
    onBeforeRender,
    startEngine,
} from "babylon-lite";
import { BILLBOARD_ATLAS_INFO, BILLBOARD_ATLAS_URL } from "../_shared/sprite-billboard-atlas";

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.04, g: 0.06, b: 0.1, a: 1 };

    const seekParam = new URLSearchParams(location.search).get("seekTime");
    const seekTime = seekParam !== null ? parseFloat(seekParam) : null;
    if (seekTime !== null) {
        scene.fixedDeltaMs = 16.667;
    }

    scene.camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 3, 9, { x: 0, y: 0.5, z: 0 });
    scene.camera.fov = Math.PI / 4;
    scene.camera.nearPlane = 0.1;
    scene.camera.farPlane = 100;

    addToScene(scene, createHemisphericLight([0, 1, 0], 0.95));

    const boxMat = createStandardMaterial();
    boxMat.diffuseColor = [0.95, 0.5, 0.3];
    const box = createBox(engine, 0.8);
    box.material = boxMat;
    box.position.y = 0.5;
    addToScene(scene, box);

    const atlas = await loadSpriteAtlas(engine, BILLBOARD_ATLAS_URL, {
        cellWidthPx: BILLBOARD_ATLAS_INFO.cellWidthPx,
        cellHeightPx: BILLBOARD_ATLAS_INFO.cellHeightPx,
        columns: BILLBOARD_ATLAS_INFO.columns,
        rows: BILLBOARD_ATLAS_INFO.rows,
        sampling: "linear",
    });

    const layer = createFacingBillboardSystem(atlas, { capacity: 4, blendMode: "alpha" });
    addToScene(scene, layer);

    const glow = addBillboardSprite(layer, {
        position: [0, 1.0, 0],
        sizeWorld: [0.8, 0.8],
        frame: BILLBOARD_ATLAS_INFO.frames.glow,
    });
    glow.parent = box;

    let t = 0;
    const targetFrames = seekTime !== null ? Math.round(seekTime * 60) : 0;
    let frameCounter = 0;
    onBeforeRender(scene, (dt) => {
        if (seekTime !== null) {
            const advances = Math.min(frameCounter, targetFrames);
            t = (advances * 16.667) / 1000;
            frameCounter++;
            if (frameCounter === targetFrames + 1) {
                canvas.dataset.animationFrozen = "true";
            }
        } else {
            t += dt / 1000;
        }
        box.position.x = Math.cos(t * 0.6) * 2;
        box.position.z = Math.sin(t * 0.6) * 2;
    });

    await startEngine(engine, scene);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

main().catch(console.error);
