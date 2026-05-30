/**
 * LibreQuake demo — Milestone 1: faithful E1M1 map rendering.
 *
 * Fetches the LibreQuake first-level BSP (BSD-3-Clause free game data, lazy-loaded
 * as a static asset — never bundled into JS), parses it clean-room from the
 * publicly documented Quake BSP v29 format, rebuilds the level geometry with
 * embedded textures and grayscale BSP lightmaps, and renders it with a free-fly
 * first-person camera spawned at info_player_start.
 *
 * Controls: WASD / arrows to move, mouse-drag to look, Space / Shift to fly up/down.
 *
 * Asset license: LibreQuake (https://github.com/lavenderdotpet/LibreQuake), BSD-3-Clause.
 * Run `pnpm fetch:librequake` to download the data into lab/public/librequake/.
 */

import {
    addToScene,
    createEngine,
    createFreeCamera,
    createMeshFromData,
    createSceneContext,
    createTexture2DFromPixels,
    onBeforeRender,
    registerScene,
    startEngine,
} from "babylon-lite";

import { parseBsp } from "./quake/bsp/parse-bsp.js";
import { parsePalette } from "./quake/palette.js";
import { parseEntities, parseVec3 } from "./quake/entities/parse-entities.js";
import { buildLevelGeometry, quakeToEngine } from "./quake/geometry/build-geometry.js";
import { QuakeTextureCache } from "./quake/render/texture-cache.js";
import { createQuakeMaterial } from "./quake/render/quake-material.js";
import { QuakePhysics, type MoveInput } from "./quake/physics/collision.js";

const BSP_URL = "/librequake/lq_e1m1.bsp";
const PALETTE_URL = "/librequake/palette.lmp";
const MOVE_SPEED = 320; // Quake units / second
const LOOK_SENS = 0.0022;
const MAX_FRAME = 0.05;

async function fetchBytes(url: string, hint: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}. ${hint}`);
    return res.arrayBuffer();
}

async function main(): Promise<void> {
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.05, g: 0.05, b: 0.07, a: 1 };

    const hint = "Run `pnpm fetch:librequake`.";
    const [bspBytes, palBytes] = await Promise.all([fetchBytes(BSP_URL, hint), fetchBytes(PALETTE_URL, hint)]);

    const bsp = parseBsp(bspBytes);
    const palette = parsePalette(palBytes);
    const entities = parseEntities(bsp.entities);

    // Decode textures and rebuild geometry batched per texture.
    const textures = new QuakeTextureCache(engine, bsp.mipTextures, palette);
    const { batches, atlas } = buildLevelGeometry(bsp);

    const lightTex = createTexture2DFromPixels(engine, atlas.pixels, atlas.width, atlas.height, {
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        minFilter: "linear",
        magFilter: "linear",
    });

    let i = 0;
    let drawn = 0;
    for (const [miptex, batch] of batches) {
        if (batch.idx.length === 0) continue;
        const diffuse = textures.get(miptex);
        const positions = new Float32Array(batch.pos);
        const normals = new Float32Array(batch.pos.length);
        const indices = new Uint32Array(batch.idx);
        const uvs = new Float32Array(batch.uv);
        const uvs2 = new Float32Array(batch.uv2);
        const mesh = createMeshFromData(engine, `quake_${i}_${diffuse.width}`, positions, normals, indices, uvs, uvs2);
        mesh.material = createQuakeMaterial(`quakeMat_${i}`, diffuse.texture, lightTex);
        addToScene(scene, mesh);
        drawn++;
        i++;
    }

    // Spawn the player at info_player_start and simulate Quake physics.
    const start = entities.find((e) => e.classname === "info_player_start") ?? entities.find((e) => e.classname?.startsWith("info_player"));
    const origin = parseVec3(start?.origin);
    const angleDeg = start?.angle ? Number(start.angle) : 0;
    let yaw = (angleDeg * Math.PI) / 180; // Quake yaw about +Z, 0 = +X
    let pitch = 0;

    const physics = new QuakePhysics(bsp, [origin[0], origin[1], origin[2]]);

    const [ex, ey, ez] = quakeToEngine(physics.eye[0], physics.eye[1], physics.eye[2]);
    const cam = createFreeCamera({ x: ex, y: ey, z: ez }, { x: ex + Math.cos(yaw), y: ey, z: ez + Math.sin(yaw) });
    cam.nearPlane = 1;
    cam.farPlane = 20000;
    scene.camera = cam;

    installPlayerControls(scene, canvas, physics, cam, () => yaw, () => pitch, (y, p) => {
        yaw = y;
        pitch = p;
    });

    await registerScene(engine, scene);
    await startEngine(engine);
    canvas.dataset.drawCalls = String(drawn);
    canvas.dataset.ready = "true";
}

/** First-person controls: mouse-drag look + WASD, driving the Quake physics. */
function installPlayerControls(
    scene: ReturnType<typeof createSceneContext>,
    canvas: HTMLCanvasElement,
    physics: QuakePhysics,
    cam: ReturnType<typeof createFreeCamera>,
    getYaw: () => number,
    getPitch: () => number,
    setView: (yaw: number, pitch: number) => void
): void {
    const keys = new Set<string>();
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let yaw = getYaw();
    let pitch = getPitch();

    if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
    canvas.addEventListener("keydown", (e) => {
        keys.add(e.code);
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    });
    canvas.addEventListener("keyup", (e) => keys.delete(e.code));
    canvas.addEventListener("pointerdown", (e) => {
        canvas.setPointerCapture(e.pointerId);
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.focus();
    });
    canvas.addEventListener("pointerup", (e) => {
        canvas.releasePointerCapture(e.pointerId);
        dragging = false;
    });
    canvas.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        yaw -= dx * LOOK_SENS;
        pitch -= dy * LOOK_SENS;
        const maxPitch = Math.PI / 2 - 0.01;
        pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
        setView(yaw, pitch);
    });

    onBeforeRender(scene, (deltaMs) => {
        const dt = Math.min(deltaMs / 1000, MAX_FRAME);
        let forward = 0;
        let side = 0;
        if (keys.has("KeyW") || keys.has("ArrowUp")) forward += MOVE_SPEED;
        if (keys.has("KeyS") || keys.has("ArrowDown")) forward -= MOVE_SPEED;
        if (keys.has("KeyD") || keys.has("ArrowRight")) side += MOVE_SPEED;
        if (keys.has("KeyA") || keys.has("ArrowLeft")) side -= MOVE_SPEED;
        const input: MoveInput = { forward, side, jump: keys.has("Space") };
        physics.update(dt, input, yaw);

        const [px, py, pz] = quakeToEngine(physics.eye[0], physics.eye[1], physics.eye[2]);
        cam.position.set(px, py, pz);
        // Quake look dir (cosYaw*cosPitch, sinYaw*cosPitch, sinPitch) → engine (x, z, y).
        const cp = Math.cos(pitch);
        cam.target.set(px + Math.cos(yaw) * cp, py + Math.sin(pitch), pz + Math.sin(yaw) * cp);
    });
}

main().catch((err) => {
    console.error(err);
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
    if (canvas) canvas.dataset.error = String(err);
    const pre = document.createElement("pre");
    pre.style.cssText = "position:fixed;inset:0;margin:0;padding:16px;color:#0f0;background:#000;font:14px monospace;white-space:pre-wrap;z-index:9999;";
    pre.textContent = `${String(err)}\n\n${err && err.stack ? err.stack : ""}`;
    document.body.appendChild(pre);
});
