/**
 * Skinned shadow caster — depth pipeline for skinned (skeletal-animated) meshes.
 *
 * Lives in its own module so the WGSL imports + per-mesh pipeline construction
 * are tree-shakable: scenes whose shadow generators have no skinned casters never
 * dynamic-import this module and pay zero runtime bytes for it. Static-caster-only
 * scenes (the common case) keep their bundle size flat.
 *
 * `shadow-generator.ts` calls {@link createSkinnedShadowHandle} via dynamic-import
 * only when at least one caster is skinned. Within the builder, the 4-bone and
 * 8-bone vertex WGSL files are also lazy-imported separately, so a 4-bone-only
 * scene never fetches the 8-bone shader (and vice-versa).
 *
 * Each skinning variant (4-bone vs 8-bone) shares a single BGL + render pipeline
 * per generator. Per caster we only allocate a mesh UBO + bind group + cached
 * world-matrix copy — pipeline creation is the expensive part, and skinned
 * meshes that share a width can reuse it.
 */

import type { Mesh, MeshInternal } from "../mesh/mesh.js";
import type { EngineContextInternal } from "../engine/engine.js";
import { createUniformBuffer } from "../resource/gpu-buffers.js";
import depthFragSrc from "../../shaders/shadow-depth.fragment.wgsl?raw";

/** Shadow-pass UBO: just the light's view-projection matrix (64 bytes). Mirrors
 *  the constant of the same name in `shadow-generator.ts`. Duplicated rather than
 *  exported so this dynamic-imported module stays self-contained. */
const SHADOW_LIGHT_VIEW_WGSL = `struct SceneUniforms { viewProjection: mat4x4<f32> }\n@group(0) @binding(0) var<uniform> scene: SceneUniforms;\n`;

/** Opaque handle returned to `shadow-generator.ts`. Holds enough state for the
 *  generator to invoke skinned shadow rendering each frame without seeing any of
 *  the skinning-specific data structures. */
export interface SkinnedShadowHandle {
    /** Number of skinned casters — included in the per-frame draw count. */
    readonly count: number;
    /** Re-upload world-matrix UBOs for any caster whose world matrix changed. */
    sync(device: GPUDevice): void;
    /** Issue the per-caster depth draws into the shadow depth pass. */
    draw(dp: GPURenderPassEncoder): void;
}

/** Shared GPU resources for one skinning width (4-bone or 8-bone) within a single
 *  shadow generator. Built once on demand and reused across all casters of that width. */
interface SkinnedVariant {
    readonly meshBGL: GPUBindGroupLayout;
    readonly pipeline: GPURenderPipeline;
}

/** Per-caster skinned depth state — light enough that one per skinned mesh is fine. */
interface SkinnedShadowCaster {
    readonly mesh: MeshInternal;
    readonly variant: SkinnedVariant;
    readonly meshBindGroup: GPUBindGroup;
    readonly meshUBO: GPUBuffer;
    readonly worldMatrix: Float32Array<ArrayBuffer>;
    _lastWorldVersion: number;
}

/** Build the shared (BGL + pipeline) for one skinning width. */
function buildSkinnedVariant(eng: EngineContextInternal, depthSceneBGL: GPUBindGroupLayout, has8Bones: boolean, skinnedVertSrc: string): SkinnedVariant {
    const device = eng.device;
    const vertCode = SHADOW_LIGHT_VIEW_WGSL + skinnedVertSrc;

    // Per-mesh bind group layout: mesh UBO + shadow params UBO + bone texture (rgba32float).
    const meshBglEntries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, texture: { sampleType: "unfilterable-float" } },
    ];
    const meshBGL = device.createBindGroupLayout({ label: has8Bones ? "shadow-skinned-mesh-8" : "shadow-skinned-mesh-4", entries: meshBglEntries });

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
        label: has8Bones ? "shadow-skinned-depth-8" : "shadow-skinned-depth-4",
        layout: device.createPipelineLayout({ bindGroupLayouts: [depthSceneBGL, meshBGL] }),
        vertex: { module: vertModule, entryPoint: "main", buffers },
        fragment: { module: fragModule, entryPoint: "main", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less-equal" },
    });

    return { meshBGL, pipeline };
}

/** Build per-caster bind group + mesh UBO using a shared {@link SkinnedVariant}. */
function buildSkinnedDepthCaster(
    eng: EngineContextInternal,
    mesh: MeshInternal,
    skel: NonNullable<Mesh["skeleton"]>,
    variant: SkinnedVariant,
    shadowParamsUBO: GPUBuffer
): SkinnedShadowCaster {
    const device = eng.device;
    const worldMatrix = new Float32Array(mesh.worldMatrix) as Float32Array<ArrayBuffer>;
    const meshUBO = createUniformBuffer(eng, worldMatrix);
    const meshBindGroup = device.createBindGroup({
        layout: variant.meshBGL,
        entries: [
            { binding: 0, resource: { buffer: meshUBO } },
            { binding: 1, resource: { buffer: shadowParamsUBO } },
            { binding: 2, resource: skel.boneTexture.createView() },
        ],
    });
    return {
        mesh,
        variant,
        meshBindGroup,
        meshUBO,
        worldMatrix,
        _lastWorldVersion: mesh.worldMatrixVersion,
    };
}

/** Build a {@link SkinnedShadowHandle} for the skinned subset of a shadow generator's
 *  caster list. The 4-bone and 8-bone vertex WGSL files are imported via separate
 *  `import("...")` calls so an all-4-bone scene never fetches the 8-bone shader. */
export async function createSkinnedShadowHandle(
    eng: EngineContextInternal,
    casterMeshes: readonly Mesh[],
    depthSceneBGL: GPUBindGroupLayout,
    shadowParamsUBO: GPUBuffer
): Promise<SkinnedShadowHandle> {
    const skinnedMeshes: MeshInternal[] = [];
    for (const m of casterMeshes) {
        if (m.skeleton?.boneTexture) {
            skinnedMeshes.push(m as MeshInternal);
        }
    }
    const has4 = skinnedMeshes.some((m) => !m.skeleton!.joints1Buffer);
    const has8 = skinnedMeshes.some((m) => !!m.skeleton!.joints1Buffer);
    const [variant4, variant8] = await Promise.all([
        has4 ? import("../../shaders/shadow-skinned-4.vertex.wgsl?raw").then((mod) => buildSkinnedVariant(eng, depthSceneBGL, false, mod.default)) : Promise.resolve(null),
        has8 ? import("../../shaders/shadow-skinned-8.vertex.wgsl?raw").then((mod) => buildSkinnedVariant(eng, depthSceneBGL, true, mod.default)) : Promise.resolve(null),
    ]);
    const casters = skinnedMeshes.map((m) => {
        const has8Bones = !!m.skeleton!.joints1Buffer;
        return buildSkinnedDepthCaster(eng, m, m.skeleton!, has8Bones ? variant8! : variant4!, shadowParamsUBO);
    });
    return {
        count: casters.length,
        sync(device: GPUDevice): void {
            for (const sc of casters) {
                if (sc.mesh.worldMatrixVersion !== sc._lastWorldVersion) {
                    sc.worldMatrix.set(sc.mesh.worldMatrix);
                    device.queue.writeBuffer(sc.meshUBO, 0, sc.worldMatrix);
                    sc._lastWorldVersion = sc.mesh.worldMatrixVersion;
                }
            }
        },
        // Avoids a redundant `setPipeline` when consecutive casters share the same variant
        // pipeline — the common 4-bone-only case ends up with a single setPipeline call.
        draw(dp: GPURenderPassEncoder): void {
            let lastPipeline: GPURenderPipeline | null = null;
            for (const sc of casters) {
                const skel = sc.mesh.skeleton!;
                const gpu = sc.mesh._gpu;
                if (sc.variant.pipeline !== lastPipeline) {
                    dp.setPipeline(sc.variant.pipeline);
                    lastPipeline = sc.variant.pipeline;
                }
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
        },
    };
}
