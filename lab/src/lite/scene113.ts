// Scene 113 — Picking Precision
// Performs one detailed GPU pick on a sphere, then visualizes the picked surface point
// and interpolated normal with two small markers.

import type { EngineContext, Mesh, PickingInfo, Vec3Tuple } from "babylon-lite";
import { addToScene, createArcRotateCamera, createBox, createEngine, createGpuPicker, createSceneContext, createSphere, createStandardMaterial, disposePicker, enableDetailedPicking, getPickedNormal, normalizeVec3, pickAsync, registerScene, startEngine } from "babylon-lite";

type ColorTuple = [number, number, number];
type QuatTuple = [number, number, number, number];

const PICK_TARGET_X_RATIO = 0.625;
const PICK_TARGET_Y_RATIO = 0.625;

function createUnlitMaterial(color: ColorTuple) {
    const material = createStandardMaterial();
    material.diffuseColor = [1, 1, 1];
    material.emissiveColor = color;
    material.specularColor = [0, 0, 0];
    material.disableLighting = true;
    return material;
}

function computeNormalBasisQuaternion(normal: Vec3Tuple): QuatTuple {
    const w = 1 + normal[1];
    if (w < 1e-8) {
        return [1, 0, 0, 0];
    }
    const len = Math.hypot(normal[2], normal[0], w);
    return [normal[2] / len, 0, -normal[0] / len, w / len];
}

function rotateLocalYAxis(q: QuatTuple): Vec3Tuple {
    const [x, y, z, w] = q;
    return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function createMarkerSphere(engine: EngineContext): Mesh {
    const marker = createSphere(engine, { segments: 16, diameter: 0.14 });
    marker.name = "scene113-surface-marker";
    marker.material = createUnlitMaterial([1, 0.18, 0.82]);
    marker.position.set(0, -4, 0);
    return marker;
}

function createNormalMarker(engine: EngineContext): Mesh {
    const marker = createBox(engine, 1);
    marker.name = "scene113-normal-marker";
    marker.material = createUnlitMaterial([0.12, 0.92, 1]);
    marker.position.set(0, -4, 0);
    marker.scaling.set(0.055, 0.48, 0.055);
    return marker;
}

function markerNearPick(marker: Mesh, point: Vec3Tuple, maxDistanceSquared: number): boolean {
    const dx = marker.position.x - point[0];
    const dy = marker.position.y - point[1];
    const dz = marker.position.z - point[2];
    return dx * dx + dy * dy + dz * dz < maxDistanceSquared;
}

function formatVec3(value: Vec3Tuple | null): string {
    return value ? value.map((v) => v.toPrecision(12)).join(",") : "";
}

function placeMarkers(info: PickingInfo, surfaceMarker: Mesh, normalMarker: Mesh): [Vec3Tuple | null, boolean, boolean, boolean, boolean, boolean] {
    if (!info.hit || !info.pickedPoint) {
        return [null, false, false, false, false, false];
    }

    const point = info.pickedPoint;
    const pickedNormal = getPickedNormal(info);
    const normal = pickedNormal ? normalizeVec3(pickedNormal[0], pickedNormal[1], pickedNormal[2], 1e-8) : ([0, 0, -1] as Vec3Tuple);
    surfaceMarker.position.set(point[0], point[1], point[2]);

    normalMarker.position.set(point[0] + normal[0] * 0.38, point[1] + normal[1] * 0.38, point[2] + normal[2] * 0.38);
    const q = computeNormalBasisQuaternion(normal);
    normalMarker.rotationQuaternion.set(q[0], q[1], q[2], q[3]);

    const alignedAxis = rotateLocalYAxis(q);
    return [point, true, true, dot(alignedAxis, normal) > 0.999, markerNearPick(surfaceMarker, point, 1e-8), markerNearPick(normalMarker, point, 0.2)];
}

async function waitFrames(frameCount: number): Promise<void> {
    for (let i = 0; i < frameCount; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
}

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);

    const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2.28, 4.2, { x: 0, y: 0, z: 0 });
    camera.fov = 0.74;
    camera.nearPlane = 1;
    camera.farPlane = 10000;
    scene.camera = camera;

    const sphere = createSphere(engine, { segments: 32, diameter: 1.8 });
    sphere.name = "scene113-picked-sphere";
    sphere.material = createUnlitMaterial([0.18, 0.48, 0.95]);
    addToScene(scene, sphere);

    const surfaceMarker = createMarkerSphere(engine);
    const normalMarker = createNormalMarker(engine);
    addToScene(scene, surfaceMarker);
    addToScene(scene, normalMarker);

    await registerScene(engine, scene);
    await startEngine(engine);
    await waitFrames(4);

    const picker = createGpuPicker(scene);
    enableDetailedPicking(picker);
    const pickInfo = await pickAsync(picker, canvas.clientWidth * PICK_TARGET_X_RATIO, canvas.clientHeight * PICK_TARGET_Y_RATIO);
    const state = placeMarkers(pickInfo, surfaceMarker, normalMarker);
    disposePicker(picker);

    await waitFrames(4);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.pickedHit = pickInfo.hit ? pickInfo.pickedMesh?.name ?? "" : "miss";
    canvas.dataset.pickPoint = formatVec3(state[0]);
    canvas.dataset.markerPlaced = String(state[1]);
    canvas.dataset.normalMarkerPlaced = String(state[2]);
    canvas.dataset.normalMarkerAligned = String(state[3]);
    canvas.dataset.markerNearPick = String(state[4]);
    canvas.dataset.normalMarkerNearPick = String(state[5]);
    canvas.dataset.ready = "true";
}

main().catch(console.error);
