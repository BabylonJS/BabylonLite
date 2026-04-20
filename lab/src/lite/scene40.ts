// Scene 40 — Anchored Sprite Handles + 3D Parenting (Family 2, Handle API).
//
// Demonstrates the new high-level Anchored handle API:
//   - `addAnchoredSprite` returns an AnchoredSpriteHandle.
//   - The handle implements `IParentable` + `IWorldMatrixProvider`, so it can
//     be parented to any 3D node (mesh, transform-node) via `handle.parent = box`.
//   - The renderable's per-frame walker resolves world translation from the
//     parent's worldMatrix and writes it into the slot.
//
// Honours `?seekTime=` for deterministic golden capture (per GUIDANCE.md §2c).

import {
    addAnchoredSprite,
    addToScene,
    createAnchoredSpriteLayer,
    createArcRotateCamera,
    createBox,
    createEngine,
    createHemisphericLight,
    createSceneContext,
    createStandardMaterial,
    loadSpriteAtlas,
    onBeforeRender,
    startEngine,
} from "babylon-lite";
import { getLabelAtlasDataUrl, LABEL_ATLAS_INFO } from "../_shared/sprite-label-atlas";

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
    boxMat.diffuseColor = [0.3, 0.6, 0.95];
    const box = createBox(engine, 0.8);
    box.material = boxMat;
    box.position.y = 0.5;
    addToScene(scene, box);

    const atlas = await loadSpriteAtlas(engine, getLabelAtlasDataUrl(), {
        cellWidthPx: LABEL_ATLAS_INFO.cellWidthPx,
        cellHeightPx: LABEL_ATLAS_INFO.cellHeightPx,
        columns: LABEL_ATLAS_INFO.columns,
        rows: LABEL_ATLAS_INFO.rows,
        sampling: "linear",
    });

    const layer = createAnchoredSpriteLayer(atlas, { capacity: 4, blendMode: "alpha" });
    addToScene(scene, layer);

    // Label sprite parented to the box at local (0, 0.8, 0) — pure world-space
    // anchor (no pixel offset), so the BJS reference plane at the same local
    // position is comparable.
    const label = addAnchoredSprite(layer, {
        position: [0, 0.8, 0],
        sizePx: [56, 56],
        frame: 0,
    });
    label.parent = box;

    let t = 0;
    const targetFrames = seekTime !== null ? Math.round(seekTime * 60) : 0;
    let frameCounter = 0;
    onBeforeRender(scene, (dt) => {
        if (seekTime !== null) {
            // Frozen-tick mode: advance by exactly 16.667ms per frame, freeze
            // after `targetFrames` advances (first frame's dt is 0).
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
