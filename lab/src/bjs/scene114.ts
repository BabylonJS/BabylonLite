// Babylon.js reference for Scene 114: Morph/Skeleton Picking.

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { IMeshDataOptions } from "@babylonjs/core/Meshes/abstractMesh";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { MorphTarget } from "@babylonjs/core/Morph/morphTarget";
import { MorphTargetManager } from "@babylonjs/core/Morph/morphTargetManager";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import "@babylonjs/core/Culling/ray";

type BjsPickingInfo = NonNullable<ReturnType<Scene["pick"]>>;

const MORPH_DELTA_X = 1.35;
const SKELETON_DELTA_X = 1.45;

function createUnlitPbr(scene: Scene, name: string, color: Color3): PBRMaterial {
    const material = new PBRMaterial(name, scene);
    material.unlit = true;
    material.albedoColor = new Color3(color.r * color.r, color.g * color.g, color.b * color.b);
    material.metallic = 0;
    material.roughness = 1;
    material.backFaceCulling = false;
    return material;
}

function createQuadMesh(scene: Scene, name: string, color: Color3): Mesh {
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = [-0.55, -0.46, 0, 0.55, -0.46, 0, -0.55, 0.46, 0, 0.55, 0.46, 0];
    data.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    data.uvs = [0, 1, 1, 1, 0, 0, 1, 0];
    data.indices = [0, 1, 2, 1, 3, 2];
    data.applyToMesh(mesh);
    mesh.isPickable = true;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.refreshBoundingInfo();
    mesh.material = createUnlitPbr(scene, `${name}-mat`, color);
    return mesh;
}

function createMorphedQuad(scene: Scene): Mesh {
    const mesh = createQuadMesh(scene, "scene114-morph-target", new Color3(0, 1, 1));
    mesh.position.set(-1.65, 0.42, 0);

    const basePositions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const targetPositions = new Float32Array(basePositions.length);
    for (let i = 0; i < basePositions.length; i += 3) {
        targetPositions[i] = basePositions[i]! + MORPH_DELTA_X;
        targetPositions[i + 1] = basePositions[i + 1]!;
        targetPositions[i + 2] = basePositions[i + 2]!;
    }
    const manager = new MorphTargetManager(scene);
    const target = new MorphTarget("scene114-morph-shift", 1, scene);
    target.setPositions(targetPositions);
    manager.addTarget(target);
    mesh.morphTargetManager = manager;
    return mesh;
}

function createSkinnedQuad(scene: Scene): Mesh {
    const mesh = createQuadMesh(scene, "scene114-skeleton-target", new Color3(1, 0, 0));
    mesh.position.set(0.72, -0.42, 0);
    mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
    mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);

    const skeleton = new Skeleton("scene114-skeleton", "scene114-skeleton", scene);
    new Bone("scene114-root-bone", skeleton, null, Matrix.Identity());
    const shiftBone = new Bone("scene114-shift-bone", skeleton, null, Matrix.Identity());
    mesh.skeleton = skeleton;
    shiftBone.setPosition(new Vector3(SKELETON_DELTA_X, 0, 0));
    skeleton.prepare();
    return mesh;
}

function createMarker(scene: Scene, name: string, color: Color3): AbstractMesh {
    const marker = MeshBuilder.CreateBox(name, { size: 1 }, scene);
    marker.material = createUnlitPbr(scene, `${name}-mat`, color);
    marker.position.set(0, -100, 0);
    marker.scaling.set(0.12, 0.12, 0.12);
    return marker;
}

function createHelperBox(scene: Scene, name: string, color: Color3, position: Vector3, scaling: Vector3, rotationZ = 0): AbstractMesh {
    const box = MeshBuilder.CreateBox(name, { size: 1 }, scene);
    box.position.copyFrom(position);
    box.scaling.copyFrom(scaling);
    box.rotation.z = rotationZ;
    box.isPickable = true;
    box.alwaysSelectAsActiveMesh = true;
    box.material = createUnlitPbr(scene, `${name}-mat`, color);
    return box;
}

function createConceptHelpers(scene: Scene): void {
    const morphGhost = createQuadMesh(scene, "scene114-morph-bind-ghost", new Color3(0, 0, 1));
    morphGhost.position.set(-1.65, 0.42, 0.16);

    createHelperBox(scene, "scene114-morph-displacement-rail-a", new Color3(0, 1, 1), new Vector3(-0.98, 1.05, -0.08), new Vector3(1.16, 0.025, 0.025));
    createHelperBox(scene, "scene114-morph-displacement-rail-b", new Color3(0, 1, 1), new Vector3(-0.98, 0.84, -0.08), new Vector3(1.16, 0.025, 0.025));
    createHelperBox(scene, "scene114-morph-arrow-tip", new Color3(0, 1, 1), new Vector3(-0.36, 0.945, -0.08), new Vector3(0.13, 0.13, 0.035), Math.PI / 4);

    const skeletonGhost = createQuadMesh(scene, "scene114-skeleton-bind-ghost", new Color3(1, 0, 0));
    skeletonGhost.position.set(0.72, -0.42, 0.16);

    createHelperBox(scene, "scene114-root-bone-rail", new Color3(0, 0, 1), new Vector3(0.17, -0.42, -0.08), new Vector3(0.035, 1.05, 0.035));
    createHelperBox(scene, "scene114-shift-bone-rail", new Color3(1, 1, 0), new Vector3(2.72, -0.42, -0.08), new Vector3(0.035, 1.05, 0.035));
    createHelperBox(scene, "scene114-skeleton-bone-shift-rail", new Color3(1, 1, 0), new Vector3(1.445, 0.18, -0.08), new Vector3(2.55, 0.025, 0.025));
    createHelperBox(scene, "scene114-skeleton-bone-shift-tip", new Color3(1, 1, 0), new Vector3(2.76, 0.18, -0.08), new Vector3(0.12, 0.12, 0.035), Math.PI / 4);

    createHelperBox(scene, "scene114-root-influence-bottom", new Color3(0, 0, 1), new Vector3(0.17, -0.88, -0.12), new Vector3(0.1, 0.1, 0.1));
    createHelperBox(scene, "scene114-root-influence-top", new Color3(0, 0, 1), new Vector3(0.17, 0.04, -0.12), new Vector3(0.1, 0.1, 0.1));
    createHelperBox(scene, "scene114-shift-influence-bottom", new Color3(1, 1, 0), new Vector3(2.72, -0.88, -0.12), new Vector3(0.1, 0.1, 0.1));
    createHelperBox(scene, "scene114-shift-influence-top", new Color3(1, 1, 0), new Vector3(2.72, 0.04, -0.12), new Vector3(0.1, 0.1, 0.1));
}

function snapMarkerCoord(value: number): number {
    // The marker is a visual locator for the real pick; snapping avoids subpixel edge drift between engines.
    return Math.round(value * 8) / 8;
}

function placeGpuMarker(info: BjsPickingInfo | null, marker: AbstractMesh): void {
    if (!info?.hit || !info.pickedPoint) {
        return;
    }
    const point = info.pickedPoint;
    marker.position.set(snapMarkerCoord(point.x), snapMarkerCoord(point.y), snapMarkerCoord(point.z - 0.09));
    marker.scaling.set(0.14, 0.14, 0.14);
}

function placeDetailedMarker(info: BjsPickingInfo | null, marker: AbstractMesh): void {
    if (!info?.hit || !info.pickedPoint) {
        return;
    }
    const point = info.pickedPoint;
    marker.position.set(snapMarkerCoord(point.x), snapMarkerCoord(point.y), snapMarkerCoord(point.z - 0.16));
    marker.scaling.set(0.12, 0.12, 0.12);
}

function pickInRegion(scene: Scene, camera: ArcRotateCamera, canvas: HTMLCanvasElement, targetName: string, minFx: number, maxFx: number, minFy: number, maxFy: number, precise: boolean): BjsPickingInfo | null {
    const stepsX = 16;
    const stepsY = 12;
    const centerX = stepsX / 2;
    const centerY = stepsY / 2;
    for (let r = 0; r <= Math.max(centerX, centerY); r++) {
        for (let y = 0; y <= stepsY; y++) {
            for (let x = 0; x <= stepsX; x++) {
                if (Math.max(Math.abs(x - centerX), Math.abs(y - centerY)) !== r) {
                    continue;
                }
                const fx = minFx + ((maxFx - minFx) * x) / stepsX;
                const fy = minFy + ((maxFy - minFy) * y) / stepsY;
                const info = scene.pick(canvas.clientWidth * fx, canvas.clientHeight * fy, undefined, !precise, camera);
                if (info?.hit && info.pickedMesh?.name === targetName) {
                    return info;
                }
            }
        }
    }
    return null;
}

async function waitFrames(frameCount: number): Promise<void> {
    for (let i = 0; i < frameCount; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
}

(async function () {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
    await engine.initAsync();

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.145, 0.165, 0.21, 1);

    const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2, 5.5, new Vector3(0.15, 0, 0), scene);
    camera.fov = 0.72;
    scene.activeCamera = camera;

    new HemisphericLight("hemi", new Vector3(0, 1, 0), scene).intensity = 0.7;

    const morphTarget = createMorphedQuad(scene);
    const skeletonTarget = createSkinnedQuad(scene);
    createConceptHelpers(scene);

    const morphGpuMarker = createMarker(scene, "scene114-morph-gpu-marker", new Color3(1, 0, 1));
    const morphDetailedMarker = createMarker(scene, "scene114-morph-detailed-marker", new Color3(0, 1, 0));
    const skeletonGpuMarker = createMarker(scene, "scene114-skeleton-gpu-marker", new Color3(1, 1, 0));
    const skeletonDetailedMarker = createMarker(scene, "scene114-skeleton-detailed-marker", new Color3(0, 0, 1));

    const eng = engine as unknown as { _drawCalls?: { fetchNewFrame(): void; current: number } };
    scene.onBeforeRenderObservable.add(() => {
        eng._drawCalls?.fetchNewFrame();
    });
    scene.onAfterRenderObservable.add(() => {
        canvas.dataset.drawCalls = String(eng._drawCalls?.current ?? 0);
    });

    await scene.whenReadyAsync();
    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());

    await new Promise<void>((resolve) => scene.onAfterRenderObservable.addOnce(() => resolve()));
    await waitFrames(4);

    const pickCamera = scene.activeCamera ?? camera;
    const deformedPickOptions = { applySkeleton: true, applyMorph: true, updatePositionsArray: true } satisfies IMeshDataOptions;
    morphTarget.refreshBoundingInfo(deformedPickOptions);
    skeletonTarget.refreshBoundingInfo(deformedPickOptions);

    const morphGpuInfo = pickInRegion(scene, pickCamera, canvas, "scene114-morph-target", 0.39, 0.55, 0.34, 0.48, false);
    placeGpuMarker(morphGpuInfo, morphGpuMarker);

    const morphDetailedInfo = pickInRegion(scene, pickCamera, canvas, "scene114-morph-target", 0.43, 0.58, 0.34, 0.48, true);
    placeDetailedMarker(morphDetailedInfo, morphDetailedMarker);

    const skeletonGpuInfo = pickInRegion(scene, pickCamera, canvas, "scene114-skeleton-target", 0.7, 0.88, 0.52, 0.66, false);
    placeGpuMarker(skeletonGpuInfo, skeletonGpuMarker);

    const skeletonDetailedInfo = pickInRegion(scene, pickCamera, canvas, "scene114-skeleton-target", 0.74, 0.92, 0.52, 0.66, true);
    placeDetailedMarker(skeletonDetailedInfo, skeletonDetailedMarker);

    await waitFrames(4);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.morphGpuHit = morphGpuInfo?.hit ? morphGpuInfo.pickedMesh?.name ?? "" : "miss";
    canvas.dataset.morphDetailedHit = morphDetailedInfo?.hit ? morphDetailedInfo.pickedMesh?.name ?? "" : "miss";
    canvas.dataset.skeletonGpuHit = skeletonGpuInfo?.hit ? skeletonGpuInfo.pickedMesh?.name ?? "" : "miss";
    canvas.dataset.skeletonDetailedHit = skeletonDetailedInfo?.hit ? skeletonDetailedInfo.pickedMesh?.name ?? "" : "miss";
    canvas.dataset.morphDetailedFace = String(morphDetailedInfo?.faceId ?? -1);
    canvas.dataset.skeletonDetailedFace = String(skeletonDetailedInfo?.faceId ?? -1);
    canvas.dataset.ready = "true";
})().catch(console.error);
