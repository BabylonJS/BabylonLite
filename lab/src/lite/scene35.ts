// Scene 35 — EXT_mesh_gpu_instancing glTF test — matches Babylon #YG3BBF#57
// Loads SimpleInstancing.glb (EXT_mesh_gpu_instancing), default environment
// (IBL only), default camera flipped by +π.

import { addToScene, startEngine, createEngine, createSceneContext, createDefaultCamera, loadEnvironment, loadGltf, attachControl, registerScene } from "babylon-lite";

async function main(): Promise<void> {
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);

    addToScene(scene, await loadGltf(engine, "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SimpleInstancing/glTF-Binary/SimpleInstancing.glb"));

    await loadEnvironment(scene, "https://assets.babylonjs.com/environments/environmentSpecular.env", {
        skipSkybox: true,
        skipGround: true,
        brdfUrl: "/brdf-lut.png",
    });

    const cam = createDefaultCamera(scene);
    cam.alpha += Math.PI;
    attachControl(cam, canvas, scene);

    await registerScene(engine, scene);
    await startEngine(engine);
    canvas.dataset.ready = "true";
}

main().catch(console.error);
