// Scene 24: Hill Valley (.babylon) — pre-baked lighting, standard materials
// Based on playground #TJIGQ1#349

import { addToScene, startEngine, createEngine, createSceneContext, createFreeCamera, attachFreeControl, loadBabylon } from "babylon-lite";

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);

    addToScene(scene, await loadBabylon(engine, "https://www.babylonjs.com/Scenes/hillvalley/HillValley.babylon"));

    // Camera matching the .babylon file's Camera01 (UniversalCamera)
    // Position: [-24.0960045, 1.96352375, 11.0729446]
    // Rotation: [pitch=0.0436326638, yaw=-1.06290591, roll=0]
    // Target = position + forward(yaw, pitch) computed with full precision
    const cam = createFreeCamera(
        { x: -24.0960045, y: 1.96352375, z: 11.0729446 },
        { x: -24.968945299300156, y: 1.919904929594395, z: 11.558816763664094 }
    );
    cam.nearPlane = 0.1;
    cam.farPlane = 1000;
    cam.fov = 0.8985202;
    scene.camera = cam;
    attachFreeControl(cam, canvas, scene);

    await startEngine(engine, scene);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

main().catch(console.error);
