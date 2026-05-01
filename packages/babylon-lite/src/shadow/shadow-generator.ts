/**
 * ShadowGenerator — Exponential Shadow Map (ESM) with Gaussian blur.
 *
 * Pipeline (per frame):
 *   1. Render shadow casters to depth texture from light's perspective (rgba16float)
 *   2. Gaussian blur X pass (1024 → 512, blurScale=2)
 *   3. Gaussian blur Y pass (512 → 512)
 *   4. Final blurred ESM texture used in main pass for shadow sampling
 *
 * Matches Babylon.js ShadowGenerator with:
 *   - useBlurExponentialShadowMap = true
 *   - useKernelBlur = true
 *   - blurKernel = 64
 *   - mapSize = 1024
 *   - depthScale = 50
 *   - bias = 0.00005
 */

import type { DirectionalLight } from "../light/directional-light.js";
import type { Mesh } from "../mesh/mesh.js";
import type { EngineContext } from "../engine/engine.js";
import type { EngineContextInternal } from "../engine/engine.js";
import { getOrCreateSampler } from "../resource/gpu-pool.js";
import { createUniformBuffer } from "../resource/gpu-buffers.js";
import {
    syncCasterMatrices,
    drawCasters,
    buildLightViewMatrix,
    multiply4x4,
    createShadowParamsUBO,
    createSharedShadowUBO,
    createShadowDepthInfra,
    createShadowDirtyTracker,
    updateShadowLightMatrix,
} from "./shadow-base.js";
import depthVertSrc from "../../shaders/shadow-depth.vertex.wgsl?raw";
import depthFragSrc from "../../shaders/shadow-depth.fragment.wgsl?raw";
import skinnedVert4Src from "../../shaders/shadow-skinned-4.vertex.wgsl?raw";
import skinnedVert8Src from "../../shaders/shadow-skinned-8.vertex.wgsl?raw";
import blurVertSrc from "../../shaders/shadow-blur.vertex.wgsl?raw";
import blurFragSrc from "../../shaders/shadow-blur.fragment.wgsl?raw";
import { WGSL_SCENE_UNIFORMS_SHADOW } from "../shader/wgsl-helpers.js";

export interface ShadowGeneratorConfig {
    mapSize?: number;
    depthScale?: number;
    bias?: number;
    blurScale?: number;
    darkness?: number;
    frustumEdgeFalloff?: number;
    /** Ortho projection min Z — typically camera.nearPlane. Default 1. */
    orthoMinZ?: number;
    /** Ortho projection max Z — typically camera.farPlane. Default 10000. */
    orthoMaxZ?: number;
    /** Override the auto-fit X/Y orthographic frustum half-width with a fixed value (in light space).
     *  When set, the frustum is centered on the casters' AABB midpoint in light space and uses
     *  `frustumSize` as the half-extent on both axes. When unset, the frustum is auto-fit to caster
     *  AABBs (default behavior).
     *
     *  Mirrors BJS `DirectionalLight.shadowFrustumSize` (paired with `autoUpdateExtends = false`).
     *  Use this when the caster is small relative to the desired shadow extent — e.g. a thin model
     *  on a wide receiver plane — so the existing ESM blur can spread the model's silhouette into
     *  a soft drop-shadow over the full frustum area. */
    frustumSize?: number;
}

export type { ShadowCaster as ShadowCasterMesh } from "./shadow-base.js";

export interface ShadowGenerator {
    /** Shadow technique: 'esm' (exponential, default) or 'pcf' (percentage closer filtering). */
    shadowType: "esm" | "pcf";
    /** The light that owns this shadow generator. */
    light: import("../light/types.js").LightBase;
    blurredTexture: GPUTexture;
    blurredSampler: GPUSampler;
    renderShadowMap: (encoder: GPUCommandEncoder) => number;
    lightMatrix: Float32Array;
    shadowsInfo: Float32Array;
    depthValues: Float32Array;
    depthMeshBGL: GPUBindGroupLayout;
    shadowParamsUBO: GPUBuffer;
    /** Shared shadow UBO (96 bytes) for receiver meshes: lightMatrix(16) + depthValues(4) + shadowsInfo(4).
     *  Updated once per version bump; all receivers bind this same buffer. */
    shadowUBO: GPUBuffer;
    config: Required<ShadowGeneratorConfig>;
    /** Monotonically increasing version — bumped each time lightMatrix/shadowsInfo/depthValues changes.
     *  Consumers compare against a stashed version to skip redundant UBO uploads. */
    _version: number;
}

/**
 * Compute the light's view-projection matrix for a directional light.
 *
 * Matches Babylon.js DirectionalLight._setDefaultAutoExtendShadowProjectionMatrix:
 *   - X/Y bounds from caster world AABBs transformed to light space (expanded by shadowOrthoScale=0.1)
 *   - Z bounds from camera near/far (orthoMinZ, orthoMaxZ)
 *
 * When `frustumSize` is provided, X/Y bounds are fixed to ±frustumSize centered on the casters'
 * midpoint in light space (mirrors BJS `shadowFrustumSize` + `autoUpdateExtends = false`).
 */
function computeDirectionalLightMatrix(
    light: DirectionalLight,
    casterMeshes: Mesh[],
    orthoMinZ: number,
    orthoMaxZ: number,
    frustumSize?: number
): { viewProj: Float32Array; near: number; far: number } {
    const view = buildLightViewMatrix(light.direction.x, light.direction.y, light.direction.z, light.position.x, light.position.y, light.position.z);

    // Transform each caster's world AABB corners to light space for X/Y bounds
    // Matches BJS: iterates boundingBox.vectorsWorld through viewMatrix
    let lMinX = Infinity,
        lMaxX = -Infinity;
    let lMinY = Infinity,
        lMaxY = -Infinity;

    for (const mesh of casterMeshes) {
        const world = mesh.worldMatrix;
        // Local AABB — default to unit cube if not set
        const bmin = mesh.boundMin ?? [-0.5, -0.5, -0.5];
        const bmax = mesh.boundMax ?? [0.5, 0.5, 0.5];

        // 8 corners of local AABB → world → light space
        for (let ci = 0; ci < 8; ci++) {
            const lx = ci & 1 ? bmax[0] : bmin[0];
            const ly = ci & 2 ? bmax[1] : bmin[1];
            const lz = ci & 4 ? bmax[2] : bmin[2];

            // Local → World (world is column-major 4x4)
            const wx = world[0]! * lx + world[4]! * ly + world[8]! * lz + world[12]!;
            const wy = world[1]! * lx + world[5]! * ly + world[9]! * lz + world[13]!;
            const wz = world[2]! * lx + world[6]! * ly + world[10]! * lz + world[14]!;

            // World → Light space
            const vx = view[0]! * wx + view[4]! * wy + view[8]! * wz + view[12]!;
            const vy = view[1]! * wx + view[5]! * wy + view[9]! * wz + view[13]!;
            lMinX = Math.min(lMinX, vx);
            lMaxX = Math.max(lMaxX, vx);
            lMinY = Math.min(lMinY, vy);
            lMaxY = Math.max(lMaxY, vy);
        }
    }

    if (frustumSize !== undefined) {
        // Fixed-size frustum: keep X/Y centered on the caster AABB midpoint, override the
        // half-extent on both axes. The auto-fit bounds above produced (lMinX..lMaxX) etc.
        // The center in light space is the midpoint; replace the extent.
        const cxLight = (lMinX + lMaxX) / 2;
        const cyLight = (lMinY + lMaxY) / 2;
        lMinX = cxLight - frustumSize;
        lMaxX = cxLight + frustumSize;
        lMinY = cyLight - frustumSize;
        lMaxY = cyLight + frustumSize;
    } else {
        // Expand by shadowOrthoScale (default 0.1) — matches Babylon
        const sx = (lMaxX - lMinX) * 0.1;
        const sy = (lMaxY - lMinY) * 0.1;
        lMinX -= sx;
        lMaxX += sx;
        lMinY -= sy;
        lMaxY += sy;
    }

    // Z bounds from camera near/far (matching Babylon's default behavior)
    const near = orthoMinZ;
    const far = orthoMaxZ;

    // Orthographic projection (column-major, WebGPU NDC z=[0,1])
    const proj = new Float32Array(16);
    proj[0] = 2 / (lMaxX - lMinX);
    proj[5] = 2 / (lMaxY - lMinY);
    proj[10] = 1 / (far - near);
    proj[12] = -(lMaxX + lMinX) / (lMaxX - lMinX);
    proj[13] = -(lMaxY + lMinY) / (lMaxY - lMinY);
    proj[14] = -near / (far - near);
    proj[15] = 1;

    return { viewProj: multiply4x4(proj, view), near, far };
}

/** Per-mesh skinned depth state: pipeline + bind group + buffers for one skinned caster. */
interface SkinnedShadowCaster {
    readonly mesh: Mesh;
    readonly pipeline: GPURenderPipeline;
    readonly meshBindGroup: GPUBindGroup;
    readonly meshUBO: GPUBuffer;
    readonly worldMatrix: Float32Array;
    _lastWorldVersion: number;
}

/** Build skinned-aware depth infra for a single skinned caster. Each caster has its own bone
 *  texture, so each gets its own bind group; the pipeline can be shared across casters with the
 *  same skinning width (4-bone vs 8-bone) but here we keep it simple and create one per caster. */
function buildSkinnedDepthCaster(
    eng: EngineContextInternal,
    mesh: Mesh,
    skel: NonNullable<Mesh["skeleton"]>,
    depthSceneBGL: GPUBindGroupLayout,
    shadowParamsUBO: GPUBuffer
): SkinnedShadowCaster {
    const device = eng.device;
    const has8Bones = !!skel.joints1Buffer;
    const vertCode = WGSL_SCENE_UNIFORMS_SHADOW + (has8Bones ? skinnedVert8Src : skinnedVert4Src);

    // Per-mesh bind group layout: mesh UBO + shadow params UBO + bone texture (rgba32float).
    const meshBglEntries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, texture: { sampleType: "unfilterable-float" } },
    ];
    const meshBGL = device.createBindGroupLayout({ label: "shadow-skinned-mesh", entries: meshBglEntries });

    const worldMatrix = new Float32Array(mesh.worldMatrix);
    const meshUBO = createUniformBuffer(eng, worldMatrix as Float32Array<ArrayBuffer>);
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
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" as GPUVertexFormat }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: "uint32x4" as GPUVertexFormat }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x4" as GPUVertexFormat }] },
    ];
    if (has8Bones) {
        buffers.push(
            { arrayStride: 16, attributes: [{ shaderLocation: 3, offset: 0, format: "uint32x4" as GPUVertexFormat }] },
            { arrayStride: 16, attributes: [{ shaderLocation: 4, offset: 0, format: "float32x4" as GPUVertexFormat }] }
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

export function createShadowGenerator(engine: EngineContext, light: DirectionalLight, casterMeshes: Mesh[], cfg: ShadowGeneratorConfig = {}): ShadowGenerator {
    const eng = engine as EngineContextInternal;
    const device = eng.device;
    const mapSize = cfg.mapSize ?? 1024;
    const depthScale = cfg.depthScale ?? 50;
    const bias = cfg.bias ?? 0.00005;
    const blurScale = cfg.blurScale ?? 2;
    const darkness = cfg.darkness ?? 0;
    const frustumEdgeFalloff = cfg.frustumEdgeFalloff ?? 0;
    const orthoMinZ = cfg.orthoMinZ ?? 1;
    const orthoMaxZ = cfg.orthoMaxZ ?? 10000;
    const frustumSize = cfg.frustumSize;
    const blurSize = mapSize / blurScale;

    const config: Required<ShadowGeneratorConfig> = {
        mapSize,
        depthScale,
        bias,
        blurScale,
        darkness,
        frustumEdgeFalloff,
        orthoMinZ,
        orthoMaxZ,
        frustumSize: frustumSize ?? 0,
    };

    const { viewProj } = computeDirectionalLightMatrix(light, casterMeshes, orthoMinZ, orthoMaxZ, frustumSize);

    // Shadow params UBO — depthValues = (0, 1) for WebGPU DirectionalLight (isNDCHalfZRange)
    const shadowParamsUBO = createShadowParamsUBO(eng, bias, depthScale);

    // Split casters: skinned meshes need a different depth pipeline (skinning vertex stage)
    // and per-frame re-rendering as bones move. Static meshes share a single depth pipeline.
    const staticCasterMeshes: Mesh[] = [];
    const skinnedCasterMeshes: Mesh[] = [];
    for (const m of casterMeshes) {
        if (m.skeleton?.boneTexture) {
            skinnedCasterMeshes.push(m);
        } else {
            staticCasterMeshes.push(m);
        }
    }

    // --- Shadow depth infra (BGLs, scene UBO/BG, casters, pipeline) ---
    const { depthMeshBGL, depthSceneBGL, depthSceneUBO, depthPipeline, depthSceneBG, casters } = createShadowDepthInfra(eng, {
        label: "shadow",
        viewProj,
        casterMeshes: staticCasterMeshes,
        vertCode: WGSL_SCENE_UNIFORMS_SHADOW + depthVertSrc,
        fragCode: depthFragSrc,
        colorTargets: [{ format: "rgba16float" }],
        extraMeshEntries: [{ binding: 1, resource: { buffer: shadowParamsUBO } }],
        extraMeshBglEntries: [{ binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
    });

    // Skinned casters share the depthSceneBGL/BG (same scene UBO) but need per-mesh skinning
    // pipelines (different vertex stage with bone-texture sampling) and bind groups (each has
    // its own bone texture). Built lazily per skinned caster mesh.
    const skinnedCasters: SkinnedShadowCaster[] = skinnedCasterMeshes.map((m) => buildSkinnedDepthCaster(eng, m, m.skeleton!, depthSceneBGL, shadowParamsUBO));

    // --- Textures ---
    const esmTexture = device.createTexture({
        label: "shadow-esm",
        size: { width: mapSize, height: mapSize },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const depthBuf = device.createTexture({
        label: "shadow-depth-buf",
        size: { width: mapSize, height: mapSize },
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const blurTexH = device.createTexture({
        label: "shadow-blur-h",
        size: { width: blurSize, height: blurSize },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const blurTexV = device.createTexture({
        label: "shadow-blur-v",
        size: { width: blurSize, height: blurSize },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // --- Blur pipeline ---
    const blurVert = device.createShaderModule({ code: blurVertSrc, label: "shadow-blur-vert" });
    const blurFrag = device.createShaderModule({ code: blurFragSrc, label: "shadow-blur-frag" });

    const blurBGL = device.createBindGroupLayout({
        label: "shadow-blur",
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        ],
    });

    const blurPipeline = device.createRenderPipeline({
        label: "shadow-blur",
        layout: device.createPipelineLayout({ bindGroupLayouts: [blurBGL] }),
        vertex: { module: blurVert, entryPoint: "main" },
        fragment: {
            module: blurFrag,
            entryPoint: "main",
            targets: [{ format: "rgba16float" }],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
    });

    const blurSampler = getOrCreateSampler(eng, { minFilter: "linear", magFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });

    // Blur H params — delta in output (blurSize) texel space, matching BJS PostProcess
    const blurHData = new Float32Array([1.0 / blurSize, 0, 0, 0]);
    const blurHUBO = createUniformBuffer(eng, blurHData);
    const blurHBG = device.createBindGroup({
        layout: blurBGL,
        entries: [
            { binding: 0, resource: { buffer: blurHUBO } },
            { binding: 1, resource: esmTexture.createView() },
            { binding: 2, resource: blurSampler },
        ],
    });

    // Blur V params
    const blurVData = new Float32Array([0, 1.0 / blurSize, 0, 0]);
    const blurVUBO = createUniformBuffer(eng, blurVData);
    const blurVBG = device.createBindGroup({
        layout: blurBGL,
        entries: [
            { binding: 0, resource: { buffer: blurVUBO } },
            { binding: 1, resource: blurTexH.createView() },
            { binding: 2, resource: blurSampler },
        ],
    });

    const outputSampler = getOrCreateSampler(eng, { minFilter: "linear", magFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });

    const lightMatrix = viewProj;
    const shadowsInfo = new Float32Array([darkness, 0, depthScale, frustumEdgeFalloff]);
    // depthValues = (0, 1) matching Babylon's DirectionalLight for WebGPU
    const depthValuesArr = new Float32Array([0, 1]);

    // Shared shadow UBO for all receiver meshes (96 bytes)
    const { ubo: sharedShadowUBO, data: shadowUboData } = createSharedShadowUBO(eng, lightMatrix, depthValuesArr, shadowsInfo);

    // Shadow matrix early-out tracking
    const dirtyTracker = createShadowDirtyTracker();

    const sg: ShadowGenerator = {
        shadowType: "esm" as const,
        light,
        blurredTexture: blurTexV,
        blurredSampler: outputSampler,
        renderShadowMap: null!,
        lightMatrix,
        shadowsInfo,
        depthValues: depthValuesArr,
        depthMeshBGL,
        shadowParamsUBO,
        shadowUBO: sharedShadowUBO,
        config,
        _version: 0,
    };

    sg.renderShadowMap = function renderShadowMap(encoder: GPUCommandEncoder): number {
        // Skinned casters animate their bone matrices every frame, so the dirty tracker (which
        // only watches mesh worldMatrixVersion + light) won't detect changes. Treat the presence
        // of any skinned caster as "always dirty" — we can refine to a per-skeleton version
        // counter later if the cost matters.
        const hasSkinned = skinnedCasters.length > 0;
        const { dirty, lightChanged } = dirtyTracker.check(light, casters);
        if (!dirty && !hasSkinned) {
            return 0;
        }
        if (lightChanged) {
            const updated = computeDirectionalLightMatrix(light, casterMeshes, orthoMinZ, orthoMaxZ, frustumSize);
            updateShadowLightMatrix(eng, sg, depthSceneUBO, updated.viewProj, shadowUboData);
        }
        dirtyTracker.commit(light, casters);

        syncCasterMatrices(eng, casters);
        // Sync skinned caster mesh UBOs (world matrix). Bone textures are managed by the
        // skeleton updater and are already current by the time renderShadowMap runs.
        for (const sc of skinnedCasters) {
            if (sc.mesh.worldMatrixVersion !== sc._lastWorldVersion) {
                sc.worldMatrix.set(sc.mesh.worldMatrix as unknown as Float32Array);
                device.queue.writeBuffer(sc.meshUBO, 0, sc.worldMatrix as Float32Array<ArrayBuffer>);
                sc._lastWorldVersion = sc.mesh.worldMatrixVersion;
            }
        }

        // Pass 1: Shadow depth
        const dp = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: esmTexture.createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                },
            ],
            depthStencilAttachment: {
                view: depthBuf.createView(),
                depthLoadOp: "clear",
                depthStoreOp: "store",
                depthClearValue: 1.0,
            },
        });
        dp.setBindGroup(0, depthSceneBG);
        // Static casters: shared depth pipeline, position-only vertex.
        if (casters.length > 0) {
            dp.setPipeline(depthPipeline);
            drawCasters(dp, casters);
        }
        // Skinned casters: per-caster pipeline + bind group + extra vertex buffers (joints, weights,
        // and joints1/weights1 for 8-bone meshes). Bones are sampled from the per-caster bone texture.
        for (const sc of skinnedCasters) {
            const skel = sc.mesh.skeleton!;
            const gpu = (sc.mesh as import("../mesh/mesh.js").MeshInternal)._gpu;
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
        dp.end();

        // Pass 2: Blur H
        const bh = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: blurTexH.createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                },
            ],
        });
        bh.setPipeline(blurPipeline);
        bh.setBindGroup(0, blurHBG);
        bh.draw(3);
        bh.end();

        // Pass 3: Blur V
        const bv = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: blurTexV.createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                },
            ],
        });
        bv.setPipeline(blurPipeline);
        bv.setBindGroup(0, blurVBG);
        bv.draw(3);
        bv.end();

        return casters.length + skinnedCasters.length + 2; // depth draws + 2 blur passes
    };

    return sg;
}
