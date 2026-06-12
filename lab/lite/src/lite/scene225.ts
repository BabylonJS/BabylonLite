// Scene 225: Geospatial (globe-orbit) camera.
//
// A lit planet (sphere of radius PLANET_RADIUS, centred at the world origin) is
// orbited by a GeospatialCamera anchored to a surface point. A directional "sun"
// light carves a day/night terminator across the globe and glints off the ocean
// specular, a dim hemispheric light supplies cool earthshine on the night side,
// and a spray of emissive marker "cities" trace the surface so the camera's
// yaw/pitch/radius are all observable.
//
// The camera is placed at a fixed deterministic center/yaw/pitch/radius and the
// FIRST rendered frame is captured for pixel-for-pixel parity against the
// Babylon.js `GeospatialCamera` oracle. The globe is wrapped in a procedurally
// generated Earth map (oceans/continents/ice caps) shared byte-for-byte with the
// BJS reference, so the textured render stays deterministic and parity-safe.
//
// World "north" in Babylon's left-handed scene is +Z, so the ECEF mapping places
// the north pole at +Z and the equator in the XY plane. Markers, lights and the
// camera centre are computed from the SAME lat/long → ECEF helper as the BJS ref.

import {
    addToScene,
    startEngine,
    createEngine,
    createSceneContext,
    createSphere,
    createBox,
    createStandardMaterial,
    createHemisphericLight,
    createDirectionalLight,
    registerScene,
    createGeospatialCamera,
    setGeospatialOrientation,
    loadTexture2D,
} from "babylon-lite";

const PLANET_RADIUS = 100;
const CAMERA_RADIUS = 235;
const CAMERA_YAW = 0.55;
const CAMERA_PITCH = 0.6;
const CENTER_LAT = 12;
const CENTER_LON = 22;
const MARKER_SIZE = 9;

// Directional "sun" — grazing the visible disk to carve a day/night terminator.
const SUN_DIR: [number, number, number] = [-0.92, -0.1, 0.38];

// Procedurally generated stylized Earth map (committed asset, shared with the BJS
// oracle so the textured globe is pixel-for-pixel identical). See
// scripts/gen-earth-texture.mjs.
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
function ecef(latDeg: number, lonDeg: number, r: number): { x: number; y: number; z: number } {
    const lat = (latDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;
    const cosLat = Math.cos(lat);
    return { x: r * cosLat * Math.cos(lon), y: r * cosLat * Math.sin(lon), z: r * Math.sin(lat) };
}

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.01, g: 0.01, b: 0.03, a: 1 };

    const cam = createGeospatialCamera({ planetRadius: PLANET_RADIUS });
    cam.fov = 0.8;
    cam.nearPlane = 1;
    cam.farPlane = PLANET_RADIUS * 16;
    setGeospatialOrientation(cam, {
        center: ecef(CENTER_LAT, CENTER_LON, PLANET_RADIUS),
        radius: CAMERA_RADIUS,
        yaw: CAMERA_YAW,
        pitch: CAMERA_PITCH,
    });
    scene.camera = cam;

    // Sun: warm directional key light → day/night terminator + ocean glint.
    const sun = createDirectionalLight(SUN_DIR, 1.6);
    sun.diffuse = [1.0, 0.95, 0.88];
    sun.specular = [1.0, 1.0, 1.0];
    addToScene(scene, sun);

    // Dim hemispheric fill → cool "earthshine" so the night side isn't pure black.
    const fill = createHemisphericLight([0, 1, 0], 0.12);
    fill.diffuseColor = [0.45, 0.55, 0.8];
    fill.groundColor = [0.03, 0.04, 0.09];
    fill.specularColor = [0, 0, 0];
    addToScene(scene, fill);

    const globe = createSphere(engine, { diameter: PLANET_RADIUS * 2, segments: 64 });
    const globeMat = createStandardMaterial();
    globeMat.diffuseColor = [1, 1, 1];
    globeMat.diffuseTexture = await loadTexture2D(engine, EARTH_TEXTURE_URL, { invertY: true });
    globeMat.specularColor = [0.12, 0.14, 0.18];
    globeMat.specularPower = 96;
    globeMat.emissiveColor = [0.02, 0.03, 0.05];
    globe.material = globeMat;
    addToScene(scene, globe);

    for (const m of MARKERS) {
        const box = createBox(engine, MARKER_SIZE);
        const mat = createStandardMaterial();
        mat.diffuseColor = [m.color[0] * 0.2, m.color[1] * 0.2, m.color[2] * 0.2];
        mat.emissiveColor = m.color;
        mat.specularColor = [0, 0, 0];
        box.material = mat;
        const p = ecef(m.lat, m.lon, PLANET_RADIUS + MARKER_SIZE / 2);
        box.position.set(p.x, p.y, p.z);
        addToScene(scene, box);
    }

    await registerScene(engine, scene);
    await startEngine(engine);

    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

main().catch(console.error);
