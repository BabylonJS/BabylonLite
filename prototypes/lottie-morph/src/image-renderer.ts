// Image renderer — textured quads, packaged as a LayerRenderer for image layers (ty 2).
//
// GATED: the player dynamically imports this module only when the animation actually
// contains image layers (see feature-detect.ts), so shape-only files never bundle the
// PNG-decode + texture-sampling path.
//
// Each asset's embedded data URI is decoded once to a GPUTexture. Per frame, every image
// layer contributes one screen-space quad (its w×h rect mapped through the layer transform)
// sampled from its asset texture, with the layer opacity applied. Output is premultiplied
// alpha, blended "over" into the same pass as the vector renderer for correct z-order.

import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine.js";
import type { LayerRenderContext, LayerRenderer } from "./layer-renderer.js";
import type { ParsedAsset, ParsedLayer } from "./parse.js";
import { DEPTH_STENCIL_FORMAT } from "./frame.js";
import { apply, type Mat2D } from "./matrix.js";

const FLOATS_PER_VERT = 5; // pos.xy, uv.xy, alpha
const VERTS_PER_QUAD = 6;

const IMAGE_WGSL = /* wgsl */ `
struct G { screen: vec4f };
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) alpha: f32 };
@vertex fn vs(@location(0) p: vec2f, @location(1) uv: vec2f, @location(2) alpha: f32) -> VO {
  var o: VO;
  o.pos = vec4f(p.x / g.screen.x * 2.0 - 1.0, 1.0 - p.y / g.screen.y * 2.0, 0.0, 1.0);
  o.uv = uv;
  o.alpha = alpha;
  return o;
}
@fragment fn fs(in: VO) -> @location(0) vec4f {
  let c = textureSample(tex, samp, in.uv);
  // PNGs are decoded as straight alpha; premultiply and apply the layer opacity.
  let a = c.a * in.alpha;
  return vec4f(c.rgb * a, a);
}
`;

const VERTEX_LAYOUT: GPUVertexBufferLayout = {
    arrayStride: FLOATS_PER_VERT * 4,
    attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" },
        { shaderLocation: 1, offset: 8, format: "float32x2" },
        { shaderLocation: 2, offset: 16, format: "float32" },
    ],
};

async function decodeAsset(device: GPUDevice, asset: ParsedAsset): Promise<GPUTexture> {
    const blob = await (await fetch(asset.src)).blob();
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const texture = device.createTexture({
        size: { width: bitmap.width, height: bitmap.height },
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, { width: bitmap.width, height: bitmap.height });
    bitmap.close();
    return texture;
}

/** Create the image-layer renderer. Async: decodes every asset's embedded image up front. */
export async function createImageRenderer(engine: EngineContext, assets: readonly ParsedAsset[]): Promise<LayerRenderer> {
    const device = engine._device;
    const format = engine.format;
    const sampleCount = engine.msaaSamples;

    const globalBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });

    const bgl = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        ],
    });

    const module = device.createShaderModule({ code: IMAGE_WGSL });
    const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        vertex: { module, entryPoint: "vs", buffers: [VERTEX_LAYOUT] },
        fragment: {
            module,
            entryPoint: "fs",
            targets: [
                {
                    format,
                    blend: {
                        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                    },
                },
            ],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        // The shared pass has a depth/stencil attachment; declare a no-op state (stencil unused).
        depthStencil: { format: DEPTH_STENCIL_FORMAT, depthWriteEnabled: false, depthCompare: "always" },
        multisample: { count: sampleCount },
    });

    // Decode all asset images and build one bind group per asset.
    const textures = await Promise.all(assets.map((a) => decodeAsset(device, a)));
    const bindGroups = textures.map((tex) =>
        device.createBindGroup({
            layout: bgl,
            entries: [
                { binding: 0, resource: { buffer: globalBuffer } },
                { binding: 1, resource: tex.createView() },
                { binding: 2, resource: sampler },
            ],
        })
    );

    // Per-frame accumulation.
    const verts: number[] = [];
    const instanceAsset: number[] = []; // token -> assetIndex
    let vertexBuffer: GPUBuffer | null = null;
    let vertexCapacity = 0;

    const corner: [number, number] = [0, 0];

    function ensureVertexBuffer(quads: number): void {
        const need = quads * VERTS_PER_QUAD;
        if (vertexBuffer && vertexCapacity >= need) {
            return;
        }
        vertexBuffer?.destroy();
        vertexCapacity = Math.max(need, Math.ceil((vertexCapacity || 64) * 1.5));
        vertexBuffer = device.createBuffer({ size: vertexCapacity * FLOATS_PER_VERT * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }

    function pushVert(x: number, y: number, u: number, v: number, alpha: number): void {
        verts.push(x, y, u, v, alpha);
    }

    return {
        kind: 2,
        beginFrame() {
            verts.length = 0;
            instanceAsset.length = 0;
        },
        emitLayer(layer: ParsedLayer, world: Mat2D, layerAlpha: number): number {
            const img = layer.image;
            if (!img || layerAlpha <= 0.0001) {
                return -1;
            }
            const w = img.width;
            const h = img.height;
            // Local image rect (0,0)-(w,h) → screen, via the layer world matrix.
            apply(world, 0, 0, corner);
            const ax = corner[0];
            const ay = corner[1];
            apply(world, w, 0, corner);
            const bx = corner[0];
            const by = corner[1];
            apply(world, w, h, corner);
            const cx = corner[0];
            const cy = corner[1];
            apply(world, 0, h, corner);
            const dx = corner[0];
            const dy = corner[1];
            // Two triangles: (a,b,c) and (a,c,d), uv matching corners.
            pushVert(ax, ay, 0, 0, layerAlpha);
            pushVert(bx, by, 1, 0, layerAlpha);
            pushVert(cx, cy, 1, 1, layerAlpha);
            pushVert(ax, ay, 0, 0, layerAlpha);
            pushVert(cx, cy, 1, 1, layerAlpha);
            pushVert(dx, dy, 0, 1, layerAlpha);
            const token = instanceAsset.length;
            instanceAsset.push(img.assetIndex);
            return token;
        },
        flush(ctx: LayerRenderContext) {
            const quads = instanceAsset.length;
            ensureVertexBuffer(Math.max(quads, 1));
            device.queue.writeBuffer(globalBuffer, 0, new Float32Array([ctx.screenW, ctx.screenH, 0, 0]));
            if (quads > 0) {
                device.queue.writeBuffer(vertexBuffer!, 0, new Float32Array(verts), 0, quads * VERTS_PER_QUAD * FLOATS_PER_VERT);
            }
        },
        recordLayer(pass: GPURenderPassEncoder, token: number) {
            const assetIndex = instanceAsset[token];
            const bindGroup = bindGroups[assetIndex];
            if (!bindGroup) {
                return;
            }
            pass.setPipeline(pipeline);
            pass.setVertexBuffer(0, vertexBuffer!);
            pass.setBindGroup(0, bindGroup);
            pass.draw(VERTS_PER_QUAD, 1, token * VERTS_PER_QUAD);
        },
        dispose() {
            vertexBuffer?.destroy();
            globalBuffer.destroy();
            for (const t of textures) {
                t.destroy();
            }
        },
    };
}
