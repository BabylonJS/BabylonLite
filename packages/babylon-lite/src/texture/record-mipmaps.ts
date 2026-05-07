import type { EngineContextInternal } from "../engine/engine.js";
import { getBilinearSampler } from "../resource/gpu-pool.js";

const BLIT_SHADER = `@group(0)@binding(0) var t:texture_2d<f32>;@group(0)@binding(1) var s:sampler;
struct V{@builtin(position) p:vec4<f32>,@location(0) u:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{var a=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));var b=array<vec2<f32>,3>(vec2<f32>(0,1),vec2<f32>(2,1),vec2<f32>(0,-1));return V(vec4<f32>(a[i],0,1),b[i]);}
@fragment fn fs(v:V)->@location(0) vec4<f32>{return textureSample(t,s,v.u);}`;

let pipelineCache: Map<string, GPURenderPipeline> | null = null;
let shaderModule: GPUShaderModule | null = null;
let linearSampler: GPUSampler | null = null;
let bindGroupLayout: GPUBindGroupLayout | null = null;
let cachedDevice: GPUDevice | null = null;

function clearCache(): void {
    pipelineCache?.clear();
    pipelineCache = null;
    shaderModule = null;
    linearSampler = null;
    bindGroupLayout = null;
    cachedDevice = null;
}

function ensureResources(engine: EngineContextInternal): void {
    const device = engine.device;
    if (device !== cachedDevice) {
        clearCache();
        cachedDevice = device;
    }
    shaderModule ??= device.createShaderModule({ code: BLIT_SHADER });
    linearSampler ??= getBilinearSampler(engine);
    bindGroupLayout ??= device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        ],
    });
}

function getPipeline(engine: EngineContextInternal, format: GPUTextureFormat): GPURenderPipeline {
    const device = engine.device;
    ensureResources(engine);
    pipelineCache ??= new Map();
    let pipeline = pipelineCache.get(format);
    if (!pipeline) {
        pipeline = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout!] }),
            vertex: { module: shaderModule!, entryPoint: "vs" },
            fragment: { module: shaderModule!, entryPoint: "fs", targets: [{ format }] },
            primitive: { topology: "triangle-list" },
        });
        pipelineCache.set(format, pipeline);
    }
    return pipeline;
}

export function recordMipmaps(engine: EngineContextInternal, texture: GPUTexture, encoder: GPUCommandEncoder): void {
    if (texture.mipLevelCount <= 1) {
        return;
    }
    const device = engine.device;
    const pipeline = getPipeline(engine, texture.format);
    for (let mip = 1; mip < texture.mipLevelCount; mip++) {
        const srcView = texture.createView({ baseMipLevel: mip - 1, mipLevelCount: 1 });
        const dstView = texture.createView({ baseMipLevel: mip, mipLevelCount: 1 });
        const bindGroup = device.createBindGroup({
            layout: bindGroupLayout!,
            entries: [
                { binding: 0, resource: srcView },
                { binding: 1, resource: linearSampler! },
            ],
        });
        const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: dstView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
    }
}
