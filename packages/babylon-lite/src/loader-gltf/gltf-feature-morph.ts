/** Morph target feature. Extracts per-primitive morph targets lazily so the
 *  core loader doesn't carry any morph-related code for non-morphed assets. */

import type { GltfFeature } from "./gltf-feature.js";
import { resolveAccessor } from "./gltf-parser.js";

const feature: GltfFeature = {
    id: "_morph",
    async applyMesh(meshData, mesh, ctx) {
        const primitive = meshData._primitive;
        const targets = primitive.targets;
        if (!targets || targets.length === 0) {
            return;
        }
        const { json, binChunk } = ctx;
        const morphTargets: { positions: Float32Array; normals: Float32Array | null }[] = [];
        for (const target of targets) {
            const posAcc = target.POSITION !== undefined ? resolveAccessor(json, binChunk, target.POSITION) : null;
            const normAcc = target.NORMAL !== undefined ? resolveAccessor(json, binChunk, target.NORMAL) : null;
            morphTargets.push({
                positions: posAcc ? (posAcc.data as Float32Array) : new Float32Array(meshData.vertexCount * 3),
                normals: normAcc ? (normAcc.data as Float32Array) : null,
            });
        }
        const parentMesh = json.meshes[json.nodes[meshData.nodeIndex].mesh];
        const morphWeights = parentMesh.weights ?? new Array(targets.length).fill(0);
        const { createMorphTargets } = await import("../morph/create-morph-targets.js");
        mesh.morphTargets = createMorphTargets(ctx.engine, morphTargets, meshData.vertexCount, morphWeights);
    },
};
export default feature;
