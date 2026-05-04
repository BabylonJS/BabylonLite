/**
 * Skinned shadow caster — depth pipeline for skinned (skeletal-animated) meshes.
 *
 * Lives in its own module so the WGSL imports + per-mesh pipeline construction
 * are tree-shakable: scenes whose shadow generators have no skinned casters never
 * dynamic-import this module and pay zero runtime bytes for it. Static-caster-only
 * scenes (the common case) keep their bundle size flat.
 *
 * Imported lazily by `shadow-generator.ts` only when a skinned caster mesh is
 * detected. See `_pendingInit` in ShadowGenerator and the awaiter in `buildScene`.
 */

import type { Mesh, MeshInternal } from "../mesh/mesh.js";
import type { EngineContextInternal } from "../engine/engine.js";
import { createUniformBuffer } from "../resource/gpu-buffers.js";
import depthFragSrc from "../../shaders/shadow-depth.fragment.wgsl?raw";
import skinnedVert4Src from "../../shaders/shadow-skinned-4.vertex.wgsl?raw";
import skinnedVert8Src from "../../shaders/shadow-skinned-8.vertex.wgsl?raw";

/** Shadow-pass UBO: just the light's view-projection matrix (64 bytes). Mirrors
 *  the constant of the same name in `shadow-generator.ts`. Duplicated rather than
 *  exported so this dynamic-imported module stays self-contained. */
const SHADOW_LIGHT_VIEW_WGSL = `struct SceneUniforms { viewProjection: mat4x4<f32> }\n@group(0) @binding(0) var<uniform> scene: SceneUniforms;\n`;

/** Per-mesh skinned depth state: pipeline + bind group + buffers for one skinned caster. */
export interface SkinnedShadowCaster {
    readonly mesh: MeshInternal;
    readonly pipeline: GPURenderPipeline;
    readonly meshBindGroup: GPUBindGroup;
    readonly meshUBO: GPUBuffer;
    readonly worldMatrix: Float32Array<ArrayBuffer>;
    _lastWorldVersion: number;
}

/** Build per-mesh skinned depth state for one skinned caster. Each caster has its own bone
 *  texture, so each gets its own bind group; the pipeline could be shared across casters with
 *  matching skinning width (4-bone vs 8-bone) but here we keep it simple and create one per
 *  caster. */
function buildSkinnedDepthCaster(
    eng: EngineContextInternal,
    mesh: MeshInternal,
    skel: NonNullable<Mesh["skeleton"]>,
    depthSceneBGL: GPUBindGroupLayout,
    shadowParamsUBO: GPUBuffer
): SkinnedShadowCaster {
    const device = eng.device;
    const has8Bones = !!skel.joints1Buffer;
    const vertCode = SHADOW_LIGHT_VIEW_WGSL + (has8Bones ? skinnedVert8Src : skinnedVert4Src);

    // Per-mesh bind group layout: mesh UBO + shadow params UBO + bone texture (rgba32float).
    const meshBglEntries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, texture: { sampleType: "unfilterable-float" } },
    ];
    const meshBGL = device.createBindGroupLayout({ label: "shadow-skinned-mesh", entries: meshBglEntries });

    const worldMatrix = new Float32Array(mesh.worldMatrix) as Float32Array<ArrayBuffer>;
    const meshUBO = createUniformBuffer(eng, worldMatrix);
    const meshBindGroup = device.createBindGroup({
        layout: meshBGL,
        entries: [
            { binding: 0, resource: { buffer: meshUBO } },
            { binding: 1, resource: { buffer: shadowParamsUBO } },
            { binding: 2, resource: skel.boneTexture.createView() },
        ],
    });

    const vertModule = device.createShaderModule({ code: vertCode, label: has8Bones ? "shadow-skinned-vert-8" : "shadow-skinned-vert-4" });
    const fragModule = device.createShaderModule({ code: depthFragSrc, label: "shadow-skinned-frag" });

    // Vertex buffer layouts: position (slot 0), joints (slot 1), weights (slot 2),
    // and optionally joints1 (slot 3), weights1 (slot 4) for 8-bone meshes.
    const buffers: GPUVertexBufferLayout[] = [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: "uint32x4" }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x4" }] },
    ];
    if (has8Bones) {
        buffers.push(
            { arrayStride: 16, attributes: [{ shaderLocation: 3, offset: 0, format: "uint32x4" }] },
            { arrayStride: 16, attributes: [{ shaderLocation: 4, offset: 0, format: "float32x4" }] }
        );
    }

    const pipeline = device.createRenderPipeline({
        label: "shadow-skinned-depth",
        layout: device.createPipelineLayout({ bindGroupLayouts: [depthSceneBGL, meshBGL] }),
        vertex: { module: vertModule, entryPoint: "main", buffers },
        fragment: { module: fragModule, entryPoint: "main", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less-equal" },
    });

    return {
        mesh,
        pipeline,
        meshBindGroup,
        meshUBO,
        worldMatrix,
        _lastWorldVersion: mesh.worldMatrixVersion,
    };
}

/** Build all skinned depth states for a directional shadow generator. Called from
 *  `shadow-generator.ts` via dynamic import only when at least one caster is skinned. */
export function buildSkinnedDepthCasters(
    eng: EngineContextInternal,
    meshes: readonly MeshInternal[],
    depthSceneBGL: GPUBindGroupLayout,
    shadowParamsUBO: GPUBuffer
): SkinnedShadowCaster[] {
    return meshes.map((m) => buildSkinnedDepthCaster(eng, m, m.skeleton!, depthSceneBGL, shadowParamsUBO));
}

/** Issue the per-caster depth draws for a populated `SkinnedShadowCaster[]`. */
export function drawSkinnedShadowCasters(dp: GPURenderPassEncoder, skinnedCasters: readonly SkinnedShadowCaster[]): void {
    for (const sc of skinnedCasters) {
        const skel = sc.mesh.skeleton!;
        const gpu = sc.mesh._gpu;
        dp.setPipeline(sc.pipeline);
        dp.setBindGroup(1, sc.meshBindGroup);
        dp.setVertexBuffer(0, gpu.positionBuffer);
        dp.setVertexBuffer(1, skel.jointsBuffer);
        dp.setVertexBuffer(2, skel.weightsBuffer);
        if (skel.joints1Buffer && skel.weights1Buffer) {
            dp.setVertexBuffer(3, skel.joints1Buffer);
            dp.setVertexBuffer(4, skel.weights1Buffer);
        }
        dp.setIndexBuffer(gpu.indexBuffer, gpu.indexFormat);
        dp.drawIndexed(gpu.indexCount);
    }
}

/** Sync mesh world-matrix UBOs (and re-upload to GPU when the world matrix has changed)
 *  for every skinned caster. Bone textures are managed by the skeleton updater and are
 *  already current by the time this runs. */
export function syncSkinnedShadowCasterMatrices(device: GPUDevice, skinnedCasters: readonly SkinnedShadowCaster[]): void {
    for (const sc of skinnedCasters) {
        if (sc.mesh.worldMatrixVersion !== sc._lastWorldVersion) {
            sc.worldMatrix.set(sc.mesh.worldMatrix);
            device.queue.writeBuffer(sc.meshUBO, 0, sc.worldMatrix);
            sc._lastWorldVersion = sc.mesh.worldMatrixVersion;
        }
    }
}
