import type { SceneContext, SceneContextInternal } from "../../scene/scene.js";
import type { EngineContextInternal } from "../../engine/engine.js";
import type { Mat4 } from "../../math/types.js";
import type { Renderable } from "../../render/renderable.js";
import type { RenderTargetSignature } from "../../engine/render-target.js";
import { computeSceneSize } from "./scene-size.js";
import { getOrCreateSampler, getBilinearSampler } from "../../resource/gpu-pool.js";
import { createMappedBuffer, createUniformBuffer } from "../../resource/gpu-buffers.js";
import { getSceneBindGroupLayout } from "../../render/scene-helpers.js";
import { targetSignatureKey } from "../../engine/render-target.js";
import { SCENE_UBO_WGSL } from "../../shader/scene-uniforms.js";
import { createCubemapSkyboxMaterial } from "./cubemap-skybox-material.js";
import ddsSkyboxVertSrc from "../../../shaders/skybox-dds.vertex.wgsl?raw";
import ddsSkyboxFragSrc from "../../../shaders/skybox-dds.fragment.wgsl?raw";
import groundVertSrc from "../../../shaders/background.vertex.wgsl?raw";
import groundFragSrc from "../../../shaders/background.ground.fragment.wgsl?raw";

const SKY_DDS_UNIFORM_SIZE = 96;
const BG_MESH_UNIFORM_SIZE = 96;
const ddsFragNoNoise = ddsSkyboxFragSrc.replace(
    /\s*\/\/ Dithering \(enableNoise=true, variance=0\.5\)\r?\n\s*color = color \+ vec3<f32>\(dither\(input\.positionW\.xy, 0\.5\)\);\r?\n/,
    "\n"
);
const groundFragNoNoise = groundFragSrc.replace(
    /\s*\/\/ Dithering\r?\n\s*color = vec4<f32>\(color\.rgb \+ vec3<f32>\(dither\(input\.vPositionW\.xy, 0\.5\)\), color\.a\);\r?\n/,
    "\n"
);
const WGSL_IMAGE_PROCESSING = `
fn applyImageProcessing(result: vec4<f32>) -> vec4<f32> {
var rgb = result.rgb;
rgb *= scene.vImageInfos.x;
rgb = 1.0 - exp2(-1.590579 * rgb);
rgb = pow(rgb, vec3<f32>(1.0 / 2.2));
rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
let highContrast = rgb * rgb * (3.0 - 2.0 * rgb);
if (scene.vImageInfos.y < 1.0) { rgb = mix(vec3<f32>(0.5), rgb, scene.vImageInfos.y); }
else { rgb = mix(rgb, highContrast, scene.vImageInfos.y - 1.0); }
rgb = max(rgb, vec3<f32>(0.0));
return vec4<f32>(rgb, result.a);
}
`;

export function addNoNoiseDdsBackground(scene: SceneContext, engine: EngineContextInternal, options: { skyboxUrl: string; groundTextureUrl: string; skyboxSize: number }): void {
    const sc = scene as SceneContextInternal;
    const groundTexPromise = fetch(options.groundTextureUrl)
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b, { premultiplyAlpha: "none" }));
    sc._deferredBuilders.push(async () => {
        const primaryColor = scene.environmentPrimaryColor ?? [0.08697355964132344, 0.08697355964132344, 0.2122208331110881];
        const { groundSize, skyboxSize, rootPosition } = computeSceneSize(scene, options.skyboxSize);
        sc._renderables.push(await buildDdsSkybox(scene, skyboxSize / 2, rootPosition, primaryColor, options.skyboxUrl));
        sc._renderables.push(await buildGround(engine, groundSize, rootPosition, primaryColor, groundTexPromise));
    });
}

function createSkyboxBuffers(engine: EngineContextInternal, S: number): { posBuffer: GPUBuffer; idxBuffer: GPUBuffer; idxCount: number } {
    // prettier-ignore
    const positions = new Float32Array([
     S,-S, S, -S,-S, S, -S, S, S,  S, S, S,
     S, S,-S, -S, S,-S, -S,-S,-S,  S,-S,-S,
     S, S,-S,  S,-S,-S,  S,-S, S,  S, S, S,
    -S, S, S, -S,-S, S, -S,-S,-S, -S, S,-S,
    -S, S, S, -S, S,-S,  S, S,-S,  S, S, S,
     S,-S, S,  S,-S,-S, -S,-S,-S, -S,-S, S,
  ]);
    // prettier-ignore
    const indices = new Uint16Array([
     2, 1, 0,  3, 2, 0,   6, 5, 4,  7, 6, 4,
    10, 9, 8, 11,10, 8,  14,13,12, 15,14,12,
    18,17,16, 19,18,16,  22,21,20, 23,22,20,
  ]);
    return {
        posBuffer: createMappedBuffer(engine, positions, GPUBufferUsage.VERTEX),
        idxBuffer: createMappedBuffer(engine, indices, GPUBufferUsage.INDEX),
        idxCount: 36,
    };
}

function buildSkyboxWorldMatrix(rootPosition: [number, number, number]): Mat4 {
    const world = new Float32Array(16) as Mat4;
    world[0] = 1;
    world[5] = 1;
    world[10] = 1;
    world[15] = 1;
    world[12] = rootPosition[0];
    world[13] = rootPosition[1];
    world[14] = rootPosition[2];
    return world;
}

async function buildDdsSkybox(
    scene: SceneContext,
    skyHalfSize: number,
    rootPosition: [number, number, number],
    primaryColor: [number, number, number],
    skyboxTextureUrl: string
): Promise<Renderable> {
    const engine = scene.engine as EngineContextInternal;
    const skyBufs = createSkyboxBuffers(engine, skyHalfSize);
    const { cubeView, sampler } = await loadDdsCube(engine, skyboxTextureUrl);
    const mat = createCubemapSkyboxMaterial("skybox-dds-no-noise", SCENE_UBO_WGSL + ddsSkyboxVertSrc, ddsFragNoNoise);
    const ubo = createDdsMeshUBO(engine, buildSkyboxWorldMatrix(rootPosition), primaryColor, scene.imageProcessing.exposure, scene.imageProcessing.contrast);
    const bindGroup = mat.createBindGroup(engine, ubo, cubeView, sampler);
    const r: Renderable = {
        order: 0,
        isTransparent: false,
        bind(eng, sig) {
            return {
                renderable: r,
                pipeline: mat.getPipeline(eng as EngineContextInternal, sig),
                draw(pass) {
                    pass.setBindGroup(1, bindGroup);
                    pass.setVertexBuffer(0, skyBufs.posBuffer);
                    pass.setIndexBuffer(skyBufs.idxBuffer, "uint16");
                    pass.drawIndexed(skyBufs.idxCount);
                    return 1;
                },
            };
        },
    };
    return r;
}

function createDdsMeshUBO(engine: EngineContextInternal, world: Float32Array, primaryColor: [number, number, number], exposureLinear: number, contrast: number): GPUBuffer {
    const data = new Float32Array(SKY_DDS_UNIFORM_SIZE / 4);
    data.set(world, 0);
    data[16] = primaryColor[0];
    data[17] = primaryColor[1];
    data[18] = primaryColor[2];
    data[19] = exposureLinear;
    data[20] = contrast;
    return createUniformBuffer(engine, data);
}

async function loadDdsCube(engine: EngineContextInternal, url: string): Promise<{ cubeView: GPUTextureView; sampler: GPUSampler }> {
    const device = engine.device;
    const buf = await (await fetch(url)).arrayBuffer();
    const header = new Int32Array(buf, 0, 32);
    const width = header[3]!;
    const height = header[4]!;
    const mipCount = Math.max(header[7]!, 1);
    const dataOffset = header[21] === 0x30315844 ? 148 : 128;
    const raw = new Uint8Array(buf, dataOffset);
    const tex = device.createTexture({
        size: [width, height, 6],
        format: "rgba16float",
        mipLevelCount: mipCount,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        dimension: "2d",
    });
    let offset = 0;
    for (let face = 0; face < 6; face++) {
        for (let m = 0; m < mipCount; m++) {
            const s = Math.max(width >> m, 1);
            device.queue.writeTexture(
                { texture: tex, origin: { x: 0, y: 0, z: face }, mipLevel: m },
                raw.buffer,
                { offset: raw.byteOffset + offset, bytesPerRow: s * 8 },
                { width: s, height: s }
            );
            offset += s * s * 8;
        }
    }
    return {
        cubeView: tex.createView({ dimension: "cube" }),
        sampler: getOrCreateSampler(engine, {
            magFilter: "linear",
            minFilter: "linear",
            mipmapFilter: "linear",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            addressModeW: "clamp-to-edge",
            maxAnisotropy: 4,
        }),
    };
}

async function buildGround(
    engine: EngineContextInternal,
    groundSize: number,
    rootPosition: [number, number, number],
    primaryColor: [number, number, number],
    groundImagePromise: Promise<ImageBitmap>
): Promise<Renderable> {
    const groundWorld = new Float32Array(16) as Mat4;
    const eps = 2.220446049250313e-16;
    groundWorld[0] = 1;
    groundWorld[5] = eps;
    groundWorld[6] = -1;
    groundWorld[9] = 1;
    groundWorld[10] = eps;
    groundWorld[12] = rootPosition[0];
    groundWorld[13] = rootPosition[1];
    groundWorld[14] = rootPosition[2];
    groundWorld[15] = 1;
    const bufs = createGroundBuffers(engine, groundSize);
    const tex = await loadGroundTexture(engine, groundImagePromise);
    const mat = createGroundMaterial();
    const bg = mat.createBindGroup(engine, createBgMeshUBO(engine, groundWorld, primaryColor), tex.createView(), getBilinearSampler(engine));
    const r: Renderable = {
        order: 200,
        isTransparent: true,
        bind(eng, sig) {
            return {
                renderable: r,
                pipeline: mat.getPipeline(eng as EngineContextInternal, sig),
                draw(pass) {
                    pass.setBindGroup(1, bg);
                    pass.setVertexBuffer(0, bufs.posBuffer);
                    pass.setVertexBuffer(1, bufs.normBuffer);
                    pass.setVertexBuffer(2, bufs.uvBuffer);
                    pass.setIndexBuffer(bufs.idxBuffer, "uint16");
                    pass.drawIndexed(bufs.idxCount);
                    return 1;
                },
            };
        },
    };
    return r;
}

interface GroundMaterial {
    getPipeline(engine: EngineContextInternal, sig: RenderTargetSignature): GPURenderPipeline;
    createBindGroup(engine: EngineContextInternal, meshUBO: GPUBuffer, groundTextureView: GPUTextureView, groundSampler: GPUSampler): GPUBindGroup;
}

let _gndPipelines: Map<string, GPURenderPipeline> | null = null;
let _gndLayout: GPUBindGroupLayout | null = null;
let _gndCachedDevice: GPUDevice | null = null;

function createGroundMaterial(): GroundMaterial {
    function getLayout(engine: EngineContextInternal): GPUBindGroupLayout {
        const device = engine.device;
        if (_gndLayout && _gndCachedDevice === device) {
            return _gndLayout;
        }
        _gndLayout = device.createBindGroupLayout({
            label: "ground-no-noise-material",
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "2d" } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
            ],
        });
        return _gndLayout;
    }
    return {
        getPipeline(engine, sig) {
            const device = engine.device;
            if (_gndCachedDevice !== device) {
                _gndPipelines?.clear();
                _gndLayout = null;
                _gndCachedDevice = device;
            }
            const key = targetSignatureKey(sig);
            const cached = _gndPipelines?.get(key);
            if (cached) {
                return cached;
            }
            const pipeline = device.createRenderPipeline({
                label: "ground-no-noise-pipeline",
                layout: device.createPipelineLayout({ bindGroupLayouts: [getSceneBindGroupLayout(engine), getLayout(engine)] }),
                vertex: {
                    module: device.createShaderModule({ code: SCENE_UBO_WGSL + groundVertSrc, label: "ground-no-noise-vert" }),
                    entryPoint: "main",
                    buffers: [
                        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" as GPUVertexFormat }] },
                        { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" as GPUVertexFormat }] },
                        { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" as GPUVertexFormat }] },
                    ],
                },
                fragment: {
                    module: device.createShaderModule({ code: SCENE_UBO_WGSL + WGSL_IMAGE_PROCESSING + groundFragNoNoise, label: "ground-no-noise-frag" }),
                    entryPoint: "main",
                    targets: [
                        {
                            format: sig.colorFormat,
                            blend: {
                                color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                            },
                        },
                    ],
                },
                depthStencil: {
                    format: sig.depthStencilFormat ?? "depth24plus-stencil8",
                    depthCompare: "less-equal",
                    depthWriteEnabled: false,
                },
                multisample: { count: sig.sampleCount },
                primitive: { topology: "triangle-list", cullMode: "back", frontFace: sig.flipY ? "cw" : "ccw" },
            });
            (_gndPipelines ??= new Map()).set(key, pipeline);
            return pipeline;
        },
        createBindGroup(engine, meshUBO, groundTextureView, groundSampler) {
            return engine.device.createBindGroup({
                layout: getLayout(engine),
                entries: [
                    { binding: 0, resource: { buffer: meshUBO } },
                    { binding: 1, resource: groundTextureView },
                    { binding: 2, resource: groundSampler },
                ],
            });
        },
    };
}

function createGroundBuffers(
    engine: EngineContextInternal,
    groundSize: number
): { posBuffer: GPUBuffer; normBuffer: GPUBuffer; uvBuffer: GPUBuffer; idxBuffer: GPUBuffer; idxCount: number } {
    const h = groundSize / 2;
    // prettier-ignore
    const positions = new Float32Array([
    -h, -h, 0,
     h, -h, 0,
     h,  h, 0,
    -h,  h, 0,
  ]);
    // prettier-ignore
    const normals = new Float32Array([
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
  ]);
    // prettier-ignore
    const uvs = new Float32Array([
    0, 0,  1, 0,  1, 1,  0, 1,
  ]);
    return {
        posBuffer: createMappedBuffer(engine, positions, GPUBufferUsage.VERTEX),
        normBuffer: createMappedBuffer(engine, normals, GPUBufferUsage.VERTEX),
        uvBuffer: createMappedBuffer(engine, uvs, GPUBufferUsage.VERTEX),
        idxBuffer: createMappedBuffer(engine, new Uint16Array([0, 2, 1, 0, 3, 2]), GPUBufferUsage.INDEX),
        idxCount: 6,
    };
}

function createBgMeshUBO(engine: EngineContextInternal, world: Mat4, primaryColor: [number, number, number]): GPUBuffer {
    const data = new Float32Array(BG_MESH_UNIFORM_SIZE / 4);
    data.set(world, 0);
    data[16] = primaryColor[0];
    data[17] = primaryColor[1];
    data[18] = primaryColor[2];
    data[19] = 0.9;
    return createUniformBuffer(engine, data);
}

async function loadGroundTexture(engine: EngineContextInternal, preloadedImage: Promise<ImageBitmap>): Promise<GPUTexture> {
    const bmp = await preloadedImage;
    const tex = engine.device.createTexture({
        size: [bmp.width, bmp.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    engine.device.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex }, [bmp.width, bmp.height]);
    bmp.close();
    return tex;
}
