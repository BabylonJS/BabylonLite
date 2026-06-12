// BJS reference for scene 225 — Babylon.js GeospatialCamera oracle.
//
// Mirrors the Lite scene225: a lit planet (sphere radius PLANET_RADIUS at the
// world origin) orbited by a GeospatialCamera anchored to a surface point, with a
// directional "sun" (day/night terminator + ocean glint), a dim hemispheric fill
// and emissive marker "cities". The camera is set to the SAME fixed
// center/radius/yaw/pitch (no controls attached) so both engines render an
// identical frame. Lighting/material values are kept in lock-step with the Lite
// scene so the comparison is pixel-for-pixel.
//
// IMPORTANT — property order: GeospatialCamera clamps pitch against the effective
// pitch-max for the CURRENT radius (pitch is disabled as the camera zooms out).
// We therefore set `radius` before `pitch` so the requested pitch is allowed.
// Lite applies all four in a single setOrientation call (radius-aware), so the
// final state is identical.

import { GeospatialCamera } from "@babylonjs/core/Cameras/geospatialCamera";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Scene } from "@babylonjs/core/scene";

const PLANET_RADIUS = 100;
const CAMERA_RADIUS = 235;
const CAMERA_YAW = 0.55;
const CAMERA_PITCH = 0.6;
const CENTER_LAT = 12;
const CENTER_LON = 22;
const MARKER_SIZE = 9;

const SUN_DIR: [number, number, number] = [-0.92, -0.1, 0.38];

const EARTH_TEXTURE_URL = "/textures/earth-procedural.png";

interface Marker {
    lat: number;
    lon: number;
    color: [number, number, number];
}

const MARKERS: Marker[] = [
    { lat: 0, lon: 0, color: [0.95, 0.25, 0.2] },
    { lat: 25, lon: 40, color: [0.97, 0.8, 0.2] },
    { lat: 45, lon: 70, color: [0.3, 0.85, 0.35] },
    { lat: -20, lon: 18, color: [0.85, 0.3, 0.85] },
    { lat: 12, lon: -25, color: [0.25, 0.8, 0.9] },
    { lat: 58, lon: 50, color: [0.95, 0.95, 0.95] },
    { lat: -42, lon: -12, color: [0.98, 0.55, 0.15] },
    { lat: 33, lon: 108, color: [0.35, 0.75, 0.95] },
];

/** Latitude/longitude (degrees) → ECEF position on a sphere of `r`, with +Z = north pole. */
function ecef(latDeg: number, lonDeg: number, r: number): Vector3 {
    const lat = (latDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;
    const cosLat = Math.cos(lat);
    return new Vector3(r * cosLat * Math.cos(lon), r * cosLat * Math.sin(lon), r * Math.sin(lat));
}

(async function () {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
    await engine.initAsync();

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.01, 0.01, 0.03, 1);

    const cam = new GeospatialCamera("cam", scene, { planetRadius: PLANET_RADIUS });
    cam.fov = 0.8;
    cam.minZ = 1;
    cam.maxZ = PLANET_RADIUS * 16;
    cam.center = ecef(CENTER_LAT, CENTER_LON, PLANET_RADIUS);
    cam.radius = CAMERA_RADIUS;
    cam.yaw = CAMERA_YAW;
    cam.pitch = CAMERA_PITCH;

    const sun = new DirectionalLight("sun", new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]), scene);
    sun.intensity = 1.6;
    sun.diffuse = new Color3(1.0, 0.95, 0.88);
    sun.specular = new Color3(1.0, 1.0, 1.0);

    const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
    fill.intensity = 0.12;
    fill.diffuse = new Color3(0.45, 0.55, 0.8);
    fill.groundColor = new Color3(0.03, 0.04, 0.09);
    fill.specular = new Color3(0, 0, 0);

    const globe = MeshBuilder.CreateSphere("globe", { diameter: PLANET_RADIUS * 2, segments: 64 }, scene);
    const globeMat = new StandardMaterial("globeMat", scene);
    globeMat.diffuseColor = new Color3(1, 1, 1);
    globeMat.diffuseTexture = new Texture(EARTH_TEXTURE_URL, scene, false, true);
    globeMat.specularColor = new Color3(0.12, 0.14, 0.18);
    globeMat.specularPower = 96;
    globeMat.emissiveColor = new Color3(0.02, 0.03, 0.05);
    globe.material = globeMat;

    for (let i = 0; i < MARKERS.length; i++) {
        const m = MARKERS[i]!;
        const box = MeshBuilder.CreateBox("marker" + i, { size: MARKER_SIZE }, scene);
        const mat = new StandardMaterial("markerMat" + i, scene);
        mat.diffuseColor = new Color3(m.color[0] * 0.2, m.color[1] * 0.2, m.color[2] * 0.2);
        mat.emissiveColor = new Color3(m.color[0], m.color[1], m.color[2]);
        mat.specularColor = new Color3(0, 0, 0);
        box.material = mat;
        box.position = ecef(m.lat, m.lon, PLANET_RADIUS + MARKER_SIZE / 2);
    }

    const eng = engine as any;
    scene.onBeforeRenderObservable.add(() => {
        if (eng._drawCalls) eng._drawCalls.fetchNewFrame();
    });
    scene.onAfterRenderObservable.add(() => {
        canvas.dataset.drawCalls = String(eng._drawCalls ? eng._drawCalls.current : 0);
    });
    await scene.whenReadyAsync();
    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
    await new Promise<void>((resolve) => scene.onAfterRenderObservable.addOnce(() => resolve()));
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
})().catch(console.error);
