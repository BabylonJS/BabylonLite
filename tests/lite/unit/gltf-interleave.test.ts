import { describe, it, expect } from "vitest";
import { accessorIsStrided, buildInterleavedPartial, installLazyCpu, computeAabbStrided } from "../../../packages/babylon-lite/src/loader-gltf/gltf-interleave.js";

const FLOAT = 5126;

/** Build a minimal glTF JSON + binary chunk with POSITION+NORMAL interleaved in
 *  one stride-32 bufferView (offset 0 and 12), plus a tight TEXCOORD_0 bufferView.
 *  Stride 32 is a multiple of 16 (like the real ClearCoatTest stride-48 layout), so
 *  POSITION@0 never crosses a 16-byte boundary (stays genuinely interleaved) while
 *  the vec3 NORMAL@12 always straddles it (bytes 12..23) and is de-interleaved. */
function makeInterleavedAsset() {
    const verts = 2;
    // Interleaved: [px,py,pz, nx,ny,nz, pad,pad] * 2  (32 bytes/vertex)
    const interleaved = new Float32Array([1, 2, 3, 0, 0, 1, 0, 0, 4, 5, 6, 0, 1, 0, 0, 0]);
    // Tight UVs: [u,v] * 2
    const uvs = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const buf = new ArrayBuffer(interleaved.byteLength + uvs.byteLength);
    new Float32Array(buf, 0, interleaved.length).set(interleaved);
    new Float32Array(buf, interleaved.byteLength, uvs.length).set(uvs);
    const binChunk = new DataView(buf);

    const json = {
        accessors: [
            { bufferView: 0, byteOffset: 0, componentType: FLOAT, count: verts, type: "VEC3" }, // POSITION
            { bufferView: 0, byteOffset: 12, componentType: FLOAT, count: verts, type: "VEC3" }, // NORMAL
            { bufferView: 1, byteOffset: 0, componentType: FLOAT, count: verts, type: "VEC2" }, // TEXCOORD_0
        ],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: interleaved.byteLength, byteStride: 32 },
            { buffer: 0, byteOffset: interleaved.byteLength, byteLength: uvs.byteLength }, // tight, no stride
        ],
    };
    const primitive = { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 } };
    return { json, binChunk, primitive };
}

describe("gltf-interleave", () => {
    it("accessorIsStrided detects interleaved vs tight bufferViews", () => {
        const { json } = makeInterleavedAsset();
        expect(accessorIsStrided(json, 0)).toBe(true); // POSITION (stride 32 ≠ 12)
        expect(accessorIsStrided(json, 1)).toBe(true); // NORMAL (stride 32 ≠ 12)
        expect(accessorIsStrided(json, 2)).toBe(false); // TEXCOORD_0 (no byteStride)
    });

    it("keeps boundary-safe POSITION interleaved (lazy) but de-interleaves a straddling NORMAL", () => {
        const { json, binChunk, primitive } = makeInterleavedAsset();
        const m = buildInterleavedPartial(json, binChunk, primitive, new Float32Array(16) as never, 0)!;
        expect(m).toBeDefined();

        // POSITION@0 never crosses a 16-byte boundary, so it stays genuinely interleaved:
        // its tight CPU copy is built only on demand (left null here), GPU layout recorded.
        expect(m._positions).toBeNull();
        expect(m._vb!._p).toMatchObject({ _stride: 32, _offset: 0, _bufferView: 0 });

        // NORMAL@12 (vec3, bytes 12..23) straddles the 16-byte line → de-interleaved into a
        // tight, offset-0 buffer to dodge the AMD/Dawn mis-fetch. CPU copy is materialized
        // eagerly and the interleave entry is dropped (no GPU boundary-crossing fetch).
        expect(Array.from(m._normals!)).toEqual([0, 0, 1, 0, 1, 0]);
        expect(m._vb!._n).toBeUndefined();

        // Tight UVs resolved through the normal (non-strided) path are present.
        expect(Array.from(m._uvs!)).toEqual([0.1, 0.2, 0.3, 0.4].map((v) => Math.fround(v)));
        expect(m._vertexCount).toBe(2);
        // The tight UV attribute has no interleave entry.
        expect(m._vb!._u).toBeUndefined();
    });

    it("installLazyCpu de-strides interleaved position lazily; eager-detangled normal is direct", () => {
        const { json, binChunk, primitive } = makeInterleavedAsset();
        const m = buildInterleavedPartial(json, binChunk, primitive, new Float32Array(16) as never, 0)!;
        const mesh: Record<string, unknown> = {};
        installLazyCpu(mesh, m as never);

        // Lazy getter reconstructs the tight POSITION copy from the strided source.
        expect(Array.from(mesh._cpuPositions as Float32Array)).toEqual([1, 2, 3, 4, 5, 6]);
        // NORMAL was de-interleaved eagerly → assigned directly (not via a getter).
        expect(Array.from(mesh._cpuNormals as Float32Array)).toEqual([0, 0, 1, 0, 1, 0]);
        // Tight UV is assigned directly (not via a getter).
        expect(Array.from(mesh._cpuUvs as Float32Array)).toEqual([0.1, 0.2, 0.3, 0.4].map((v) => Math.fround(v)));

        // Cached: repeated reads return the same array instance.
        expect(mesh._cpuPositions).toBe(mesh._cpuPositions);
    });

    it("computeAabbStrided folds the AABB directly from the strided slice", () => {
        const { json, binChunk, primitive } = makeInterleavedAsset();
        const m = buildInterleavedPartial(json, binChunk, primitive, new Float32Array(16) as never, 0)!;
        const [min, max] = computeAabbStrided(m._vb!._p!);
        expect(min).toEqual([1, 2, 3]);
        expect(max).toEqual([4, 5, 6]);
    });

    it("returns undefined for a fully-tight primitive (caller uses the tight path)", () => {
        const { json, binChunk } = makeInterleavedAsset();
        const tightOnly = { attributes: { TEXCOORD_0: 2 } };
        expect(buildInterleavedPartial(json, binChunk, tightOnly, new Float32Array(16) as never, 0)).toBeUndefined();
    });

    it("de-interleaves a vec3 that straddles only on a later vertex (stride not a multiple of 16)", () => {
        // POSITION@0 with stride 24: vertex 0 base 0 (residue 0, safe) but vertex 1 base 24
        // (residue 8, bytes 24..35 straddle the 32-byte line). The straddle is invisible if
        // only `offset` is inspected, so this guards the per-vertex `offset + v*stride` check.
        const verts = 2;
        const interleaved = new Float32Array([1, 2, 3, 9, 9, 9, 4, 5, 6, 9, 9, 9]); // [pos, pad] * 2, stride 24
        const buf = new ArrayBuffer(interleaved.byteLength);
        new Float32Array(buf).set(interleaved);
        const binChunk = new DataView(buf);
        const json = {
            accessors: [{ bufferView: 0, byteOffset: 0, componentType: FLOAT, count: verts, type: "VEC3" }],
            bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: interleaved.byteLength, byteStride: 24 }],
        };
        const primitive = { attributes: { POSITION: 0 } };
        const m = buildInterleavedPartial(json, binChunk, primitive, new Float32Array(16) as never, 0)!;
        expect(m).toBeDefined();
        // De-interleaved into a tight, offset-0 buffer; no GPU interleave entry remains.
        expect(Array.from(m._positions!)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(m._vb!._p).toBeUndefined();
    });
});
