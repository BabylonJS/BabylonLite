// Reconstructs renderable geometry from a parsed Quake BSP.
//
// For every visible face we walk its surfedges to recover the polygon, compute
// diffuse UVs from the texinfo projection vectors, allocate a lightmap block,
// fan-triangulate, and append into a per-texture batch. Vertices are converted
// from Quake space (X fwd, Y left, Z up; right-handed) into the engine's
// left-handed Y-up space by swapping Y and Z — a determinant -1 transform, so
// the world is reproduced without mirroring.

import { TEX_SPECIAL, type BspData } from "../bsp/parse-bsp.js";
import { LightmapAtlas } from "./lightmap.js";

/** Texture names that mark invisible/utility surfaces we must not render. */
const SKIP_TEXTURES = new Set(["trigger", "clip", "skip", "hint", "hintskip", "waterskip", "common/caulk"]);

export interface GeometryBatch {
    miptex: number;
    pos: number[];
    uv: number[];
    uv2: number[];
    idx: number[];
}

export interface LevelGeometry {
    batches: Map<number, GeometryBatch>;
    atlas: LightmapAtlas;
}

/** Convert a Quake-space point to engine space (swap Y and Z). */
export function quakeToEngine(qx: number, qy: number, qz: number): [number, number, number] {
    return [qx, qz, qy];
}

/**
 * Build per-texture geometry batches for a contiguous face range (one BSP
 * model) into the shared lightmap atlas. Call once per model so movers stay
 * separate from the static world.
 */
export function buildModelGeometry(bsp: BspData, atlas: LightmapAtlas, firstFace: number, numFaces: number): Map<number, GeometryBatch> {
    const batches = new Map<number, GeometryBatch>();
    const [whiteU, whiteV] = atlas.whiteUV;

    const getBatch = (miptex: number): GeometryBatch => {
        let b = batches.get(miptex);
        if (!b) {
            b = { miptex, pos: [], uv: [], uv2: [], idx: [] };
            batches.set(miptex, b);
        }
        return b;
    };

    for (let fi = firstFace; fi < firstFace + numFaces; fi++) {
        const face = bsp.faces[fi];
        if (!face) continue;
        const ti = bsp.texInfos[face.texInfo];
        if (!ti) continue;
        const mt = bsp.mipTextures[ti.miptex];
        if (mt && SKIP_TEXTURES.has(mt.name.toLowerCase())) continue;

        const special = (ti.flags & TEX_SPECIAL) !== 0;
        const texW = mt && mt.width > 0 ? mt.width : 64;
        const texH = mt && mt.height > 0 ? mt.height : 64;

        const n = face.numEdges;
        if (n < 3) continue;
        const qx: number[] = [];
        const qy: number[] = [];
        const qz: number[] = [];
        const sArr: number[] = [];
        const tArr: number[] = [];
        let minS = Infinity;
        let minT = Infinity;
        let maxS = -Infinity;
        let maxT = -Infinity;
        const v = ti.vecs;
        for (let k = 0; k < n; k++) {
            const se = bsp.surfEdges[face.firstEdge + k];
            const vIndex = se >= 0 ? bsp.edges[se * 2] : bsp.edges[-se * 2 + 1];
            const px = bsp.vertices[vIndex * 3];
            const py = bsp.vertices[vIndex * 3 + 1];
            const pz = bsp.vertices[vIndex * 3 + 2];
            qx.push(px);
            qy.push(py);
            qz.push(pz);
            const s = px * v[0] + py * v[1] + pz * v[2] + v[3];
            const t = px * v[4] + py * v[5] + pz * v[6] + v[7];
            sArr.push(s);
            tArr.push(t);
            if (s < minS) minS = s;
            if (t < minT) minT = t;
            if (s > maxS) maxS = s;
            if (t > maxT) maxT = t;
        }

        let lm = null as ReturnType<LightmapAtlas["alloc"]>;
        let bminS = 0;
        let bminT = 0;
        if (!special && face.lightOfs >= 0) {
            bminS = Math.floor(minS / 16);
            bminT = Math.floor(minT / 16);
            const bmaxS = Math.ceil(maxS / 16);
            const bmaxT = Math.ceil(maxT / 16);
            lm = atlas.alloc(bsp.lighting, face.lightOfs, bmaxS - bminS + 1, bmaxT - bminT + 1);
        }

        const batch = getBatch(ti.miptex);
        const base = batch.pos.length / 3;
        for (let k = 0; k < n; k++) {
            const [ex, ey, ez] = quakeToEngine(qx[k], qy[k], qz[k]);
            batch.pos.push(ex, ey, ez);
            batch.uv.push(sArr[k] / texW, tArr[k] / texH);
            if (lm) {
                const luxS = (sArr[k] - bminS * 16) / 16;
                const luxT = (tArr[k] - bminT * 16) / 16;
                batch.uv2.push((lm.atlasX + luxS + 0.5) / atlas.width, (lm.atlasY + luxT + 0.5) / atlas.height);
            } else {
                batch.uv2.push(whiteU, whiteV);
            }
        }
        for (let k = 1; k < n - 1; k++) {
            batch.idx.push(base, base + k, base + k + 1);
        }
    }

    return batches;
}

/** Build the entire world (model 0) geometry. */
export function buildLevelGeometry(bsp: BspData): LevelGeometry {
    const atlas = new LightmapAtlas();
    const world = bsp.models[0];
    const batches = buildModelGeometry(bsp, atlas, world.firstFace, world.numFaces);
    return { batches, atlas };
}
