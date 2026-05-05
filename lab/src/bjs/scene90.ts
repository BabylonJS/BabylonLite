// Scene 39 BJS reference — PBR Shadow-Only Receiver mirror.
// BJS analogue of the lite scene: BackgroundMaterial.shadowOnly on the ground,
// DirectionalLight with autoUpdateExtends=false + shadowFrustumSize for the
// fixed ortho frustum, ESM blur shadow generator.

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { BackgroundMaterial } from "@babylonjs/core/Materials/Background/backgroundMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";

(async function () {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
    await engine.initAsync();

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.15, 0.2, 0.35, 1.0);

    const cam = new ArcRotateCamera("cam", Math.PI / 2, Math.PI / 3, 12, new Vector3(0, 1, 0), scene);
    cam.minZ = 0.1;
    cam.maxZ = 100;
    cam.attachControl(canvas, true);

    const light = new DirectionalLight("dir", new Vector3(-1, -2, -1), scene);
    light.position = new Vector3(8, 16, 8);
    // Mirrors lite's `frustumSize: 8`. autoUpdateExtends=false locks the auto-fit
    // off; shadowFrustumSize sets the half-extent on both X and Y in light space.
    light.autoUpdateExtends = false;
    light.shadowFrustumSize = 8;

    // Shadow caster: small static sphere with a regular lit PBR material.
    const sphere = MeshBuilder.CreateSphere("caster", { segments: 32, diameter: 2 }, scene);
    sphere.position = new Vector3(0, 2, 0);
    const sphereMat = new PBRMaterial("casterMat", scene);
    sphereMat.albedoColor = new Color3(0.85, 0.25, 0.2);
    sphereMat.metallic = 0;
    sphereMat.roughness = 0.4;
    sphere.material = sphereMat;

    // Wide ground that catches the drop shadow but is otherwise invisible.
    const ground = MeshBuilder.CreateGround("ground", { width: 30, height: 30 }, scene);
    const groundMat = new BackgroundMaterial("shadowOnlyMat", scene);
    groundMat.shadowOnly = true;
    groundMat.useRGBColor = false;
    groundMat.primaryColor = new Color3(0, 0, 0);
    ground.material = groundMat;
    ground.receiveShadows = true;

    const shadowGen = new ShadowGenerator(1024, light);
    shadowGen.useBlurExponentialShadowMap = true;
    shadowGen.useKernelBlur = true;
    shadowGen.blurKernel = 64;
    shadowGen.addShadowCaster(sphere);

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
