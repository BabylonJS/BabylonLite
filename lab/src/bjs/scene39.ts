// Reference scene 39 — BJS sprite + parented child sprite.
//
// Uses Babylon.js `SpriteManager` + manual per-frame parenting (no scene-graph
// for sprites in BJS). Visually equivalent to the Lite handle-API demo:
// a moving "character" sprite with a health-bar offset 64px above it.

import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Scene } from "@babylonjs/core/scene";
import { Sprite } from "@babylonjs/core/Sprites/sprite";
import { SpriteManager } from "@babylonjs/core/Sprites/spriteManager";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { getSpriteAtlasDataUrl, SPRITE_ATLAS_INFO } from "../_shared/sprite-atlas-image";

(async function () {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: false });
    await engine.initAsync();

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.05, 0.06, 0.09, 1);

    const seekParam = new URLSearchParams(location.search).get("seekTime");
    const seekTime = seekParam !== null ? parseFloat(seekParam) : null;

    // Y-up ortho (top>bottom): a Y-down ortho would invert the projection's Y
    // axis, which flips sprite UVs vertically within each sprite quad.
    const cam = new FreeCamera("cam", new Vector3(0, 0, -10), scene);
    cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
    cam.orthoLeft = 0;
    cam.orthoRight = canvas.width;
    cam.orthoTop = canvas.height;
    cam.orthoBottom = 0;
    cam.minZ = 0.1;
    cam.maxZ = 100;

    const url = getSpriteAtlasDataUrl();
    const sm = new SpriteManager("sm", url, 4, { width: SPRITE_ATLAS_INFO.cellWidthPx, height: SPRITE_ATLAS_INFO.cellHeightPx }, scene);
    sm.texture.hasAlpha = true;

    const character = new Sprite("char", sm);
    character.cellIndex = 12;
    character.width = 96;
    character.height = 96;
    character.position = new Vector3(120, canvas.height - canvas.height / 2, 0);

    const healthBar = new Sprite("hp", sm);
    healthBar.cellIndex = 8;
    healthBar.width = 80;
    healthBar.height = 12;
    healthBar.color = new Color4(0.2, 1.0, 0.4, 1);

    let t = 0;
    let frameCounter = 0;
    const targetFrames = seekTime !== null ? Math.round(seekTime * 60) : 0;
    scene.onBeforeRenderObservable.add(() => {
        if (seekTime !== null) {
            // Match Lite's fixedDeltaMs=16.667 tick exactly. First frame's
            // dt is 0 (Lite's render-loop contract), so we advance only once
            // we've ticked past the first frame.
            const advances = Math.min(frameCounter, targetFrames);
            t = (advances * 16.667) / 1000;
            frameCounter++;
            if (frameCounter === targetFrames + 1) {
                canvas.dataset.animationFrozen = "true";
            }
        } else {
            t += engine.getDeltaTime() / 1000;
        }
        const x = canvas.width / 2 + Math.cos(t * 0.8) * (canvas.width / 2 - 120);
        character.position.x = x;
        // Negate angle: Y-up projection flips rotation direction (CW becomes CCW).
        character.angle = -Math.sin(t) * 0.1;
        // Manual parenting: BJS sprites have no scene graph.
        healthBar.position.x = character.position.x;
        healthBar.position.y = character.position.y + 64;
    });

    engine.runRenderLoop(() => scene.render());
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
})();
