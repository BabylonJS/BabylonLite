/**
 *  Lazy-loaded animation/skin parsing for glTF.
 *  Dynamically imported by load-gltf.ts only when a glTF contains animations or skins.
 */
import type { Mat4 } from "../math/types.js";
import type { Mesh } from "../mesh/mesh.js";
import type { GltfAnimationData, AnimationClip, AnimationSampler, AnimationChannel, NodeRest, SkeletonBinding, MorphBinding } from "../animation/types.js";
import { INTERP_LINEAR, INTERP_STEP, INTERP_CUBICSPLINE, PATH_TRANSLATION, PATH_ROTATION, PATH_SCALE, PATH_WEIGHTS } from "../animation/types.js";
import { mat4Invert, mat4Identity, mat4Multiply } from "../math/mat4.js";
import { resolveAccessor, computeNodeWorldMatrix, findParent } from "./gltf-parser.js";

/** Parsed skin/skeleton data. */
export interface GltfSkinData {
    /** Node indices of joints in this skin. */
    jointNodes: number[];
    /** Inverse bind matrices — one 4×4 per joint (column-major Float32Array). */
    inverseBindMatrices: Float32Array;
    /** World matrices of each joint at rest pose. */
    jointWorldMatrices: Mat4[];
    /** World matrix of the mesh node that owns this skin. */
    meshWorldMatrix: Mat4;
}

// ─── Skin / Skeleton Extraction ─────────────────────────────────────

export function extractSkin(
    json: any,
    binChunk: DataView,
    skinIdx: number,
    meshWorldMatrix: Mat4,
    parentMap: Map<number, number>,
    worldMatrixCache: Map<number, Mat4>
): GltfSkinData {
    const skin = json.skins[skinIdx];
    const jointNodes: number[] = skin.joints;

    // Resolve inverse bind matrices
    let inverseBindMatrices: Float32Array;
    if (skin.inverseBindMatrices !== undefined) {
        const ibmData = resolveAccessor(json, binChunk, skin.inverseBindMatrices);
        inverseBindMatrices = new Float32Array(ibmData.data.buffer, ibmData.data.byteOffset, jointNodes.length * 16);
    } else {
        // Default: identity for each joint
        inverseBindMatrices = new Float32Array(jointNodes.length * 16);
        for (let i = 0; i < jointNodes.length; i++) {
            inverseBindMatrices[i * 16 + 0] = 1;
            inverseBindMatrices[i * 16 + 5] = 1;
            inverseBindMatrices[i * 16 + 10] = 1;
            inverseBindMatrices[i * 16 + 15] = 1;
        }
    }

    // Compute world matrices for each joint at rest pose
    const jointWorldMatrices: Mat4[] = jointNodes.map((nodeIdx) => computeNodeWorldMatrix(json, nodeIdx, parentMap, worldMatrixCache));

    return { jointNodes, inverseBindMatrices, jointWorldMatrices, meshWorldMatrix };
}

/** Compute rest-pose bone texture data. Each bone gets 4 vec4 (one 4×4 matrix).
 *  Formula: boneMatrix[i] = inverse(meshWorld) * jointWorld[i] * IBM[i]
 *  At rest pose this simplifies to identity for each bone. */
export function computeBoneTextureData(skin: GltfSkinData): Float32Array {
    const numBones = skin.jointNodes.length;
    // 4 floats per texel (rgba32float), 4 texels per bone = 16 floats per bone
    const data = new Float32Array(numBones * 16);

    // Compute inverse mesh world matrix
    const invMeshWorld = mat4Invert(skin.meshWorldMatrix) ?? mat4Identity();

    for (let i = 0; i < numBones; i++) {
        const jointWorld = skin.jointWorldMatrices[i]!;
        const ibmOffset = i * 16;
        const ibm = new Float32Array(skin.inverseBindMatrices.buffer, skin.inverseBindMatrices.byteOffset + ibmOffset * 4, 16) as Mat4;

        // boneMatrix = inverse(meshWorld) * jointWorld * IBM
        const temp = mat4Multiply(invMeshWorld, jointWorld);
        const boneMatrix = mat4Multiply(temp, ibm);

        // Store column-major (GPU reads 4 texels = 4 columns)
        data.set(boneMatrix, i * 16);
    }

    return data;
}

// ─── Animation Parsing ──────────────────────────────────────────────

const INTERP_MAP: Record<string, 0 | 1 | 2> = {
    LINEAR: INTERP_LINEAR,
    STEP: INTERP_STEP,
    CUBICSPLINE: INTERP_CUBICSPLINE,
};

const PATH_MAP: Record<string, 0 | 1 | 2 | 3> = {
    translation: PATH_TRANSLATION,
    rotation: PATH_ROTATION,
    scale: PATH_SCALE,
    weights: PATH_WEIGHTS,
};

/**
 * Parse glTF animation data: clips, node hierarchy, and skeleton bindings.
 * Returns null if no animations or no skeletons present.
 */
export function parseAnimationData(json: any, binChunk: DataView, meshes: Mesh[], parentMap: Map<number, number>, worldMatrixCache: Map<number, Mat4>): GltfAnimationData | null {
    if (!json.animations || json.animations.length === 0) {
        return null;
    }

    // Parse animation clips
    const clips: AnimationClip[] = [];
    for (const anim of json.animations) {
        const samplers: AnimationSampler[] = [];
        for (const s of anim.samplers) {
            const inputAcc = resolveAccessor(json, binChunk, s.input);
            const outputAcc = resolveAccessor(json, binChunk, s.output);
            samplers.push({
                input: new Float32Array(inputAcc.data.buffer, inputAcc.data.byteOffset, inputAcc.count),
                output: new Float32Array(outputAcc.data.buffer, outputAcc.data.byteOffset, outputAcc.count * outputAcc.componentCount),
                interpolation: INTERP_MAP[s.interpolation ?? "LINEAR"] ?? INTERP_LINEAR,
            });
        }

        const channels: AnimationChannel[] = [];
        for (const c of anim.channels) {
            if (c.target.node === undefined) {
                continue;
            }
            const path = PATH_MAP[c.target.path];
            if (path === undefined) {
                continue;
            }
            channels.push({ samplerIdx: c.sampler, nodeIdx: c.target.node, path });
        }

        let duration = 0;
        for (const s of samplers) {
            if (s.input.length > 0) {
                const last = s.input[s.input.length - 1]!;
                if (last > duration) {
                    duration = last;
                }
            }
        }

        clips.push({ name: anim.name ?? "", channels, samplers, duration });
    }

    // Build node hierarchy (rest-pose TRS + parent indices)
    const nodeCount = json.nodes?.length ?? 0;
    const nodes: NodeRest[] = [];
    for (let i = 0; i < nodeCount; i++) {
        const n = json.nodes[i];
        const t = n.translation ?? [0, 0, 0];
        const r = n.rotation ?? [0, 0, 0, 1];
        const s = n.scale ?? [1, 1, 1];
        nodes.push({
            parentIdx: findParent(parentMap, i),
            tx: t[0],
            ty: t[1],
            tz: t[2],
            rx: r[0],
            ry: r[1],
            rz: r[2],
            rw: r[3],
            sx: s[0],
            sy: s[1],
            sz: s[2],
        });
    }

    // Build skeleton bindings (connect skin data to GPU bone textures)
    // First, build node→gpuMesh mapping by replaying extraction order
    const nodeToMeshIndices = new Map<number, number[]>();
    let gpuIdx = 0;
    for (let ni = 0; ni < nodeCount; ni++) {
        const node = json.nodes[ni];
        if (node.mesh === undefined) {
            continue;
        }
        const mesh = json.meshes[node.mesh];
        const indices: number[] = [];
        for (let p = 0; p < mesh.primitives.length; p++) {
            indices.push(gpuIdx++);
        }
        nodeToMeshIndices.set(ni, indices);
    }

    const skeletons: SkeletonBinding[] = [];
    for (let nodeIdx = 0; nodeIdx < nodeCount; nodeIdx++) {
        const node = json.nodes[nodeIdx];
        if (node.skin === undefined || !json.skins) {
            continue;
        }

        const meshIndices = nodeToMeshIndices.get(nodeIdx);
        if (!meshIndices) {
            continue;
        }

        const skin = json.skins[node.skin];
        const jointNodes: number[] = skin.joints;

        let inverseBindMatrices: Float32Array;
        if (skin.inverseBindMatrices !== undefined) {
            const ibmData = resolveAccessor(json, binChunk, skin.inverseBindMatrices);
            inverseBindMatrices = new Float32Array(ibmData.data.buffer, ibmData.data.byteOffset, jointNodes.length * 16);
        } else {
            inverseBindMatrices = new Float32Array(jointNodes.length * 16);
            for (let i = 0; i < jointNodes.length; i++) {
                inverseBindMatrices[i * 16] = 1;
                inverseBindMatrices[i * 16 + 5] = 1;
                inverseBindMatrices[i * 16 + 10] = 1;
                inverseBindMatrices[i * 16 + 15] = 1;
            }
        }

        const meshWorldMatrix = computeNodeWorldMatrix(json, nodeIdx, parentMap, worldMatrixCache);
        const invMeshWorld = mat4Invert(meshWorldMatrix) ?? mat4Identity();

        // Create a binding for EACH mesh primitive of this skinned node
        for (const mi of meshIndices) {
            const mesh = meshes[mi];
            if (!mesh?.skeleton) {
                continue;
            }
            skeletons.push({
                jointNodes,
                inverseBindMatrices,
                invMeshWorld,
                boneTexture: mesh.skeleton.boneTexture,
                boneCount: jointNodes.length,
            });
        }
    }

    // Build morph bindings (connect morph-target meshes to GPU weight buffers)
    const morphBindings: MorphBinding[] = [];
    for (let nodeIdx = 0; nodeIdx < nodeCount; nodeIdx++) {
        const node = json.nodes[nodeIdx];
        if (node.mesh === undefined) {
            continue;
        }
        const gltfMesh = json.meshes[node.mesh];
        if (!gltfMesh.primitives?.[0]?.targets?.length) {
            continue;
        }

        const meshIndices = nodeToMeshIndices.get(nodeIdx);
        if (!meshIndices) {
            continue;
        }

        for (const mi of meshIndices) {
            const mesh = meshes[mi];
            if (!mesh?.morphTargets) {
                continue;
            }
            morphBindings.push({
                nodeIdx,
                weightsBuffer: mesh.morphTargets.weightsBuffer,
                targetCount: mesh.morphTargets.count,
            });
        }
    }

    if (clips.length === 0 || (skeletons.length === 0 && morphBindings.length === 0)) {
        return null;
    }
    return { clips, nodes, skeletons, morphBindings };
}
