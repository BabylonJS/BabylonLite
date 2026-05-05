// Scene 52 BJS reference — Skinned Shadow Casting mirror.
// Same Alien.gltf rig as scene 5; here we add a directional light + ground +
// ShadowGenerator so the skinned mesh casts a shadow onto the floor. Animation
// is deterministic via `?seekTime=…`, matching scene 5's parity pattern.

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";

(async function () {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
    await engine.initAsync();

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.2, 0.2, 0.3, 1.0);

    const cam = new ArcRotateCamera("cam", Math.PI / 2, Math.PI / 2.6, 2.5, new Vector3(0, 0.4, 0), scene);
    cam.minZ = 0.1;
    cam.maxZ = 100;
    cam.attachControl(canvas, true);

    // Directional light for the cast shadow. Match the lite frustumSize override.
    const light = new DirectionalLight("dir", new Vector3(-0.5, -1, -0.5), scene);
    light.position = new Vector3(2, 4, 2);
    light.intensity = 1.0;
    light.autoUpdateExtends = false;
    light.shadowFrustumSize = 1.5;

    const importResult = await SceneLoader.ImportMeshAsync("", "https://playground.babylonjs.com/scenes/Alien/", "Alien.gltf", scene);
    // Lift the asset so its feet sit just above the ground plane at y=0
    // (Alien.gltf's local origin is at chest height; see lite scene for details).
    if (importResult.meshes[0]) {
        importResult.meshes[0].position.y = 0.7;
    }

    // Ground that receives the cast shadow.
    const ground = MeshBuilder.CreateGround("ground", { width: 6, height: 6 }, scene);
    const groundMat = new PBRMaterial("groundMat", scene);
    groundMat.albedoColor = new Color3(0.6, 0.55, 0.5);
    groundMat.metallic = 0;
    groundMat.roughness = 0.9;
    ground.material = groundMat;
    ground.receiveShadows = true;

    const shadowGen = new ShadowGenerator(1024, light);
    shadowGen.useBlurExponentialShadowMap = true;
    shadowGen.useKernelBlur = true;
    shadowGen.blurKernel = 64;
    // Add every skinned mesh in the loaded glTF as a shadow caster.
    for (const m of scene.meshes) {
        if ((m as AbstractMesh).skeleton) {
            shadowGen.addShadowCaster(m);
        }
    }

    engine.getDeltaTime = function () {
        return 16;
    };
    scene.useConstantAnimationDeltaTime = true;

    const params = new URLSearchParams(window.location.search);
    const seekTimeParam = parseFloat(params.get("seekTime") || "");

    let frameCount = 0;
    let seekDone = false;
    scene.onBeforeRenderObservable.add(() => {
        frameCount++;
        canvas.dataset.frameCount = String(frameCount);

        if (!isNaN(seekTimeParam) && seekTimeParam > 0 && frameCount === 10 && !seekDone) {
            scene.animationGroups.forEach((g) => {
                const range = g.to - g.from;
                if (range > 0) {
                    const seekFrame = g.from + ((seekTimeParam * 60 - g.from) % range);
                    g.goToFrame(seekFrame);
                }
            });
            scene.animatables.forEach((a) => a.pause());
            seekDone = true;
            canvas.dataset.animationFrozen = "true";
        }

        if (!seekDone && frameCount === 300) {
            scene.animatables.forEach((a) => a.pause());
            canvas.dataset.animationFrozen = "true";
        }
    });

    const eng = engine as any;
    scene.onBeforeRenderObservable.add(() => {
        if (eng._drawCalls) {
            eng._drawCalls.fetchNewFrame();
        }
    });
    scene.onAfterRenderObservable.add(() => {
        canvas.dataset.drawCalls = String(eng._drawCalls ? eng._drawCalls.current : 0);
    });
    await scene.whenReadyAsync();
    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
    await new Promise<void>((resolve) => scene.onAfterRenderObservable.addOnce(resolve));
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
})().catch(console.error);
