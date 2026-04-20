// Scene 39 — Sprite2D Handles + 2D Parenting (Family 1, Handle API).
//
// Demonstrates the new high-level Sprite2D handle API:
//   - `addSprite2D` returns a Sprite2DHandle (not a number).
//   - `handle.position.x = ...` writes via the Observable -> flat buffer slot.
//   - A parented "health-bar" handle follows the moving "character" via
//     `bar.parent = character` (IParentable2D wiring).
//
// Lab-only demo (not in parity test). Side-by-side with BJS reference for
// visual eyeball + bundle-size comparison.

import {
    addSprite2D,
    addToScene2D,
    createEngine,
    createScene2DContext,
    createSprite2DLayer,
    loadSpriteAtlas,
    onBeforeRender2D,
    startEngine2D,
} from "babylon-lite";
import { getSpriteAtlasDataUrl, SPRITE_ATLAS_INFO } from "../_shared/sprite-atlas-image";

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);

    const scene = createScene2DContext(engine, { clearColor: { r: 0.05, g: 0.06, b: 0.09, a: 1 } });

    const seekParam = new URLSearchParams(location.search).get("seekTime");
    const seekTime = seekParam !== null ? parseFloat(seekParam) : null;
    if (seekTime !== null) {
        scene.fixedDeltaMs = 16.667;
    }

    const atlas = await loadSpriteAtlas(engine, getSpriteAtlasDataUrl(), {
        cellWidthPx: SPRITE_ATLAS_INFO.cellWidthPx,
        cellHeightPx: SPRITE_ATLAS_INFO.cellHeightPx,
        columns: SPRITE_ATLAS_INFO.columns,
        rows: SPRITE_ATLAS_INFO.rows,
        sampling: "nearest",
    });

    const layer = createSprite2DLayer(atlas, { capacity: 8, blendMode: "alpha" });
    addToScene2D(scene, layer);

    // Character sprite (un-parented; moves directly).
    const character = addSprite2D(layer, {
        positionPx: [120, canvas.height / 2],
        sizePx: [96, 96],
        frame: 12,
        color: [1, 1, 1, 1],
    });

    // Health bar — parented to the character; its position is local-to-character.
    const healthBar = addSprite2D(layer, {
        positionPx: [0, -64], // 64px above the character (parent local space).
        sizePx: [80, 12],
        frame: 8,
        color: [0.2, 1.0, 0.4, 1],
    });
    healthBar.parent = character;

    let t = 0;
    const targetFrames = seekTime !== null ? Math.round(seekTime * 60) : 0;
    let frameCounter = 0;
    onBeforeRender2D(scene, (dt) => {
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
        const x = canvas.width / 2 + Math.cos(t * 0.8) * (canvas.width / 2 - 120);
        character.position.x = x;
        character.rotation = Math.sin(t) * 0.1;
    });

    await startEngine2D(engine, scene);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

main().catch(console.error);
