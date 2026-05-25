// Scene 142 — KHR_materials_volume_testing with frame-graph scene-texture transmission.
// Copied from Scene 30, but leaves KHR_materials_transmission materials marked
// transmissive so the render task captures the opaque scene as the refraction
// texture.

import {
    addToScene,
    startEngine,
    createEngine,
    createSceneContext,
    createArcRotateCamera,
    loadEnvironment,
    loadGltf,
    registerScene,
    attachControl,
    getFrameGraph,
    type RenderTask,
} from "babylon-lite";

async function main(): Promise<void> {
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    (getFrameGraph(scene)._tasks[0] as RenderTask)._config.transmission = { copyCount: 1 };

    // Exact camera values captured from the playground scene.
    const cam = createArcRotateCamera(Math.PI / 2, Math.PI / 2, 1.1856086997830126, { x: -0.2914360649171073, y: 0.4, z: 0.3975263311541397 });
    cam.fov = 0.8;
    cam.nearPlane = 0.0697417;
    cam.farPlane = 6974.17;
    scene.camera = cam;
    attachControl(cam, canvas, scene);

    await Promise.all([
        loadGltf(engine, "https://assets.babylonjs.com/meshes/KHR_materials_volume_testing.glb").then((asset) => addToScene(scene, asset)),
        loadEnvironment(scene, "https://assets.babylonjs.com/core/environments/environmentSpecular.env", {
            skipSkybox: true,
            skipGround: true,
            brdfUrl: "/brdf-lut.png",
        }),
    ]);

    await registerScene(engine, scene);
    await startEngine(engine);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.ready = "true";
}

main().catch(console.error);
