// Orchestrates a playable DOOM level: parses a WAD, decodes the palette/colormap,
// builds per-texture geometry batches, uploads them as meshes, and installs a
// free-fly camera at the player-1 start with keyboard controls.

import { addToScene, createFreeCamera, createMeshFromData, createTexture2DFromPixels, onBeforeRender, type EngineContext, type SceneContext } from "babylon-lite";

import { parseWad } from "./wad/wad-file.js";
import { parseMap } from "./wad/map.js";
import type { DoomMap } from "./wad/map.js";
import { parsePlaypal, parseColormap, buildColormapLut } from "./wad/palette.js";
import { DoomTextureCache } from "./render/texture-cache.js";
import { createDoomMaterial } from "./render/doom-material.js";
import { buildLevelBatches } from "./geometry/build-level-geometry.js";
import { NF_SUBSECTOR } from "./wad/map.js";

const VIEW_HEIGHT = 41;
const MOVE_SPEED = 320; // map units per second
const TURN_SPEED = 2.4; // radians per second

export interface DoomLevel {
    map: DoomMap;
    dispose(): void;
}

export function buildDoomLevel(engine: EngineContext, scene: SceneContext, wadBytes: ArrayBuffer, mapName = "E1M1"): DoomLevel {
    const wad = parseWad(wadBytes);
    const map = parseMap(wad, mapName);

    const playpal = parsePlaypal(wad);
    const colormap = parseColormap(wad);
    const lut = buildColormapLut(playpal, colormap);
    const colormapTex = createTexture2DFromPixels(engine, lut, 256, 34, {
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
    });

    const textures = new DoomTextureCache(engine, wad);
    const batches = buildLevelBatches(map, textures);

    let i = 0;
    for (const [texName, batch] of batches) {
        if (batch.idx.length === 0) continue;
        const src = textures.getWall(texName) ?? textures.getFlat(texName);
        if (!src) continue;
        const positions = new Float32Array(batch.pos);
        const normals = new Float32Array(batch.pos.length); // unused by material
        const indices = new Uint32Array(batch.idx);
        const uvs = new Float32Array(batch.uv);
        const colors = new Float32Array(batch.col);
        const mesh = createMeshFromData(engine, `doom_${i}_${texName}`, positions, normals, indices, uvs, undefined, undefined, colors);
        mesh.material = createDoomMaterial(`doomMat_${i}_${texName}`, src.texture, colormapTex);
        addToScene(scene, mesh);
        i++;
    }

    installCamera(scene, map);

    return { map, dispose: () => {} };
}

function installCamera(scene: SceneContext, map: DoomMap): void {
    const start = map.things.find((t) => t.type === 1) ?? map.things[0];
    const sx = start ? start.x : 0;
    const sz = start ? start.y : 0;
    const floorH = floorHeightAt(map, sx, sz);
    const yaw0 = start ? (start.angle * Math.PI) / 180 : 0;

    const eye = { x: sx, y: floorH + VIEW_HEIGHT, z: sz };
    const cam = createFreeCamera(eye, { x: sx + Math.cos(yaw0), y: floorH + VIEW_HEIGHT, z: sz + Math.sin(yaw0) });
    cam.nearPlane = 1;
    cam.farPlane = 12000;
    scene.camera = cam;

    let yaw = yaw0;
    let pitch = 0;
    const keys = new Set<string>();
    const onDown = (e: KeyboardEvent): void => {
        keys.add(e.code);
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    };
    const onUp = (e: KeyboardEvent): void => void keys.delete(e.code);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);

    onBeforeRender(scene, (deltaMs) => {
        const dt = deltaMs / 1000;
        if (keys.has("ArrowLeft")) yaw -= TURN_SPEED * dt;
        if (keys.has("ArrowRight")) yaw += TURN_SPEED * dt;
        if (keys.has("ArrowUp")) pitch = Math.min(pitch + TURN_SPEED * dt, 1.2);
        if (keys.has("ArrowDown")) pitch = Math.max(pitch - TURN_SPEED * dt, -1.2);

        const fx = Math.cos(yaw);
        const fz = Math.sin(yaw);
        const speed = (keys.has("ShiftLeft") ? 2 : 1) * MOVE_SPEED * dt;
        let mx = 0;
        let mz = 0;
        if (keys.has("KeyW")) {
            mx += fx;
            mz += fz;
        }
        if (keys.has("KeyS")) {
            mx -= fx;
            mz -= fz;
        }
        if (keys.has("KeyA")) {
            mx += fz;
            mz -= fx;
        }
        if (keys.has("KeyD")) {
            mx -= fz;
            mz += fx;
        }
        eye.x += mx * speed;
        eye.z += mz * speed;
        eye.y = floorHeightAt(map, eye.x, eye.z) + VIEW_HEIGHT;

        cam.position.x = eye.x;
        cam.position.y = eye.y;
        cam.position.z = eye.z;
        const cp = Math.cos(pitch);
        cam.target.x = eye.x + fx * cp;
        cam.target.y = eye.y + Math.sin(pitch);
        cam.target.z = eye.z + fz * cp;
    });
}

/** Walks the BSP to the subsector containing (doomX, doomY), returns its sector floor height. */
function floorHeightAt(map: DoomMap, x: number, y: number): number {
    if (map.nodes.length === 0) return 0;
    let ref = map.nodes.length - 1;
    while (!(ref & NF_SUBSECTOR)) {
        const node = map.nodes[ref];
        if (!node) return 0;
        const s = node.dx * (y - node.y) - node.dy * (x - node.x);
        ref = s <= 0 ? node.rightChild : node.leftChild;
    }
    const ss = map.subsectors[ref & ~NF_SUBSECTOR];
    if (!ss) return 0;
    const seg = map.segs[ss.firstSeg];
    if (!seg) return 0;
    const ld = map.linedefs[seg.linedef];
    if (!ld) return 0;
    const sideRef = seg.side === 0 ? ld.front : ld.back;
    if (sideRef < 0) return 0;
    const side = map.sidedefs[sideRef];
    return side ? (map.sectors[side.sector]?.floorHeight ?? 0) : 0;
}
