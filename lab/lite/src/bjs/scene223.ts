// Scene 223 — Camera + Light Gizmos (BJS reference)
//
// A ground plane with one gizmo for every light type plus a CameraGizmo:
//   • HemisphericLight  → hemisphere dome + 3-level lines   (far left)
//   • PointLight        → sphere + 5-level star lines       (left)
//   • SpotLight         → sphere + wide hemisphere + lines  (right)
//   • DirectionalLight  → sphere + 3 parallel arrows        (far right)
//   • A subject FreeCamera visualised by a CameraGizmo      (back centre)
//
// All gizmos render in a UtilityLayerRenderer overlay so they always appear
// on top.  Static scene — this is the parity reference for the Lite port.
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { UtilityLayerRenderer } from "@babylonjs/core/Rendering/utilityLayerRenderer";
import { CameraGizmo } from "@babylonjs/core/Gizmos/cameraGizmo";
import { LightGizmo } from "@babylonjs/core/Gizmos/lightGizmo";

(async function () {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
    await engine.initAsync();

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.2, 0.2, 0.3, 1.0);

    const mainCamera = new ArcRotateCamera("main", -Math.PI / 2, Math.PI / 3, 18, new Vector3(0, 1.5, 0), scene);
    mainCamera.minZ = 0.1;
    mainCamera.maxZ = 100;
    mainCamera.attachControl(canvas, true);

    const groundMat = new StandardMaterial("groundMat", scene);
    groundMat.diffuseColor = new Color3(0.5, 0.5, 0.55);
    const ground = MeshBuilder.CreateGround("ground", { width: 20, height: 14 }, scene);
    ground.material = groundMat;

    // ── One light of each supported type, spread along X at y = 2 ──
    const Y = 2;

    const hemiLight = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
    hemiLight.intensity = 0.7;

    const pointLight = new PointLight("point", new Vector3(-2.5, Y, 0), scene);
    pointLight.diffuse = new Color3(1, 0.85, 0.4);
    pointLight.intensity = 0.3;

    const spotLight = new SpotLight("spot", new Vector3(2.5, Y, 0), new Vector3(0, -1, 0.0001), Math.PI / 3, 2, scene);
    spotLight.diffuse = new Color3(0.5, 0.7, 1);
    spotLight.intensity = 0.4;

    const dirLight = new DirectionalLight("dir", new Vector3(0.25, -1, 0.25), scene);
    dirLight.position = new Vector3(7, Y, 0);
    dirLight.intensity = 0.3;

    // Subject camera (back centre) — visualised by the CameraGizmo.
    const subjectCamera = new FreeCamera("subject", new Vector3(0, 3, -5), scene);
    subjectCamera.minZ = 1;
    subjectCamera.maxZ = 10;
    subjectCamera.setTarget(new Vector3(0, 0.5, 0));

    const utilityLayer = new UtilityLayerRenderer(scene);

    const cameraGizmo = new CameraGizmo(utilityLayer);
    cameraGizmo.camera = subjectCamera;

    const hemiGizmo = new LightGizmo(utilityLayer);
    hemiGizmo.light = hemiLight;
    // Hemispheric has no position — place the gizmo's attached mesh manually.
    hemiGizmo.attachedMesh!.position = new Vector3(-7, Y, 0);

    const pointGizmo = new LightGizmo(utilityLayer);
    pointGizmo.light = pointLight;

    const spotGizmo = new LightGizmo(utilityLayer);
    spotGizmo.light = spotLight;

    const dirGizmo = new LightGizmo(utilityLayer);
    dirGizmo.light = dirLight;

    const eng = engine as unknown as { _drawCalls?: { fetchNewFrame: () => void; current: number } };
    scene.onBeforeRenderObservable.add(() => eng._drawCalls?.fetchNewFrame());

    let frame = 0;
    scene.onAfterRenderObservable.add(() => {
        canvas.dataset.drawCalls = String(eng._drawCalls?.current ?? 0);
        frame++;
        if (frame === 3) {
            canvas.dataset.initMs = String(performance.now() - __initStart);
            canvas.dataset.ready = "true";
        }
    });

    await scene.whenReadyAsync();
    engine.runRenderLoop(() => scene.render());
})().catch(console.error);
