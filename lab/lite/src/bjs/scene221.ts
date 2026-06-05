// Scene 221 — Pointer Drags (BJS reference)
//
// Four cubes over a flat ground.  Each cube is driven by a different gizmo
// rendered through the BJS UtilityLayerRenderer (always-on-top).
//   • Cube 1 (left)         → AxisDragGizmo on X
//   • Cube 2 (centre-left)  → PlaneRotationGizmo on Y
//   • Cube 3 (centre-right) → PlaneDragGizmo on Y normal
//   • Cube 4 (right)        → AxisScaleGizmo on Y
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { UtilityLayerRenderer } from "@babylonjs/core/Rendering/utilityLayerRenderer";
import { AxisDragGizmo } from "@babylonjs/core/Gizmos/axisDragGizmo";
import { PlaneDragGizmo } from "@babylonjs/core/Gizmos/planeDragGizmo";
import { PlaneRotationGizmo } from "@babylonjs/core/Gizmos/planeRotationGizmo";
import { AxisScaleGizmo } from "@babylonjs/core/Gizmos/axisScaleGizmo";

(async function () {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
    await engine.initAsync();

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.2, 0.2, 0.3, 1.0);
    scene.attachControl();

    const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 12, new Vector3(0, 0, 0), scene);
    camera.minZ = 0.1;
    camera.maxZ = 100;

    const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
    light.intensity = 0.9;

    const groundMat = new StandardMaterial("groundMat", scene);
    groundMat.diffuseColor = new Color3(0.5, 0.5, 0.55);
    const ground = MeshBuilder.CreateGround("ground", { width: 12, height: 12 }, scene);
    ground.material = groundMat;

    const makeCube = (name: string, x: number, color: Color3) => {
        const cube = MeshBuilder.CreateBox(name, { size: 1 }, scene);
        cube.position.set(x, 0.5, 0);
        const mat = new StandardMaterial(name + "Mat", scene);
        mat.diffuseColor = color;
        cube.material = mat;
        return cube;
    };

    const cube1 = makeCube("cube1", -3.75, new Color3(0.8, 0.25, 0.25));
    const cube2 = makeCube("cube2", -1.25, new Color3(0.25, 0.8, 0.25));
    const cube3 = makeCube("cube3", 1.25, new Color3(0.25, 0.25, 0.8));
    const cube4 = makeCube("cube4", 3.75, new Color3(0.85, 0.85, 0.25));

    (window as unknown as Record<string, unknown>).__scene221 = {
        cube1Pos: () => ({ x: cube1.position.x, y: cube1.position.y, z: cube1.position.z }),
        cube2Quat: () => {
            const q = cube2.rotationQuaternion ?? cube2.rotation.toQuaternion();
            return { x: q.x, y: q.y, z: q.z, w: q.w };
        },
        cube3Pos: () => ({ x: cube3.position.x, y: cube3.position.y, z: cube3.position.z }),
        cube4Scale: () => ({ x: cube4.scaling.x, y: cube4.scaling.y, z: cube4.scaling.z }),
    };

    const utilityLayer = new UtilityLayerRenderer(scene);

    const axisDrag = new AxisDragGizmo(new Vector3(1, 0, 0), new Color3(1, 0, 0), utilityLayer);
    axisDrag.attachedNode = cube1;

    const planeRotation = new PlaneRotationGizmo(new Vector3(0, 1, 0), new Color3(0, 1, 0), utilityLayer);
    planeRotation.attachedNode = cube2;

    const planeDrag = new PlaneDragGizmo(new Vector3(0, 1, 0), new Color3(0, 0, 1), utilityLayer);
    planeDrag.attachedNode = cube3;

    const axisScale = new AxisScaleGizmo(new Vector3(0, 1, 0), new Color3(1, 0.85, 0.1), utilityLayer);
    axisScale.attachedNode = cube4;

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
