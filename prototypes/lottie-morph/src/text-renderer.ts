// Text renderer — rasterizes each text layer to a texture via Canvas2D, then draws it as a
// textured quad. Packaged as a LayerRenderer for text layers (ty 5).
//
// GATED: the player dynamically imports this module only when the animation has text layers
// (see feature-detect.ts), so shape/image-only files never bundle the text-rasterization path.
//
// Lottie text here has no baked glyph outlines, so we rely on the platform font (Segoe UI etc.)
// via Canvas2D `fillText`. Each text document is rasterized ONCE at a supersampled resolution;
// per frame, its layer transform maps the text's local rect to a screen quad (same premultiplied
// textured-quad pipeline as the image renderer). Animated text (per-glyph animators) is not
// handled — the whole block is drawn with the layer opacity.

import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine.js";
import type { LayerRenderContext, LayerRenderer } from "./layer-renderer.js";
import type { ParsedLayer, ParsedText } from "./parse.js";
import { DEPTH_STENCIL_FORMAT } from "./frame.js";
import { apply, type Mat2D } from "./matrix.js";

const FLOATS_PER_VERT = 5; // pos.xy, uv.xy, alpha
const VERTS_PER_QUAD = 6;
const SUPERSAMPLE = 3; // rasterize at 3x for crisp downscaling

const TEXT_WGSL = /* wgsl */ `
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

/** A rasterized text block: its texture and the layer-local rect the texture covers. */
interface TextBlock {
    texture: GPUTexture;
    /** Local-space rect [left, top, width, height] (content units, origin at text anchor). */
    left: number;
    top: number;
    width: number;
    height: number;
}

function cssFont(t: ParsedText): string {
    return `${t.style} ${t.weight} ${t.size}px "${t.family}"`;
}

/** Greedy word-wrap a single paragraph to fit within `maxW` (in local px). */
function wrapParagraph(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    if (text.length === 0) {
        return [""];
    }
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
        const test = current ? current + " " + word : word;
        if (current && ctx.measureText(test).width > maxW) {
            lines.push(current);
            current = word;
        } else {
            current = test;
        }
    }
    if (current) {
        lines.push(current);
    }
    return lines;
}

/** Rasterize one text document into a GPUTexture + its local rect. */
function rasterizeText(device: GPUDevice, t: ParsedText): TextBlock | null {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const font = cssFont(t);
    ctx.font = font;
    // Letter spacing (Chrome 99+); harmless if unsupported.
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${t.letterSpacing}px`;

    // Build lines: explicit breaks always; boxed/paragraph text also word-wraps to the box width.
    const boxed = t.boxW !== undefined && t.boxW > 0;
    const rawLines = t.text.split(/\r\n|\r|\n/);
    let lines: string[];
    if (boxed) {
        lines = [];
        for (const rl of rawLines) {
            lines.push(...wrapParagraph(ctx, rl, t.boxW!));
        }
    } else {
        lines = rawLines;
    }

    // Measure.
    let maxW = 0;
    for (const line of lines) {
        maxW = Math.max(maxW, ctx.measureText(line).width);
    }
    const m = ctx.measureText("Mg");
    const ascent = m.fontBoundingBoxAscent || t.size * 0.8;
    const descent = m.fontBoundingBoxDescent || t.size * 0.25;
    const pad = Math.ceil(t.size * 0.35);
    const blockH = ascent + (lines.length - 1) * t.lineHeight + descent;
    // Content width: a boxed layer reserves the full box width so justification + the box
    // origin map exactly; point text uses the measured max line width.
    const contentW = boxed ? t.boxW! : maxW;
    const localW = contentW + 2 * pad;
    const localH = blockH + 2 * pad;
    if (localW < 1 || localH < 1) {
        return null;
    }

    canvas.width = Math.ceil(localW * SUPERSAMPLE);
    canvas.height = Math.ceil(localH * SUPERSAMPLE);
    // Re-apply state after resize (resizing clears the context).
    ctx.scale(SUPERSAMPLE, SUPERSAMPLE);
    ctx.font = font;
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${t.letterSpacing}px`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = `rgb(${Math.round(t.color[0] * 255)}, ${Math.round(t.color[1] * 255)}, ${Math.round(t.color[2] * 255)})`;

    for (let i = 0; i < lines.length; i++) {
        const lineW = ctx.measureText(lines[i]).width;
        let lineX = pad; // left
        if (t.justify === 2) {
            lineX = pad + (contentW - lineW) / 2;
        } else if (t.justify === 1) {
            lineX = pad + (contentW - lineW);
        }
        ctx.fillText(lines[i], lineX, pad + ascent + i * t.lineHeight);
    }

    // Local rect: where the texture maps in layer-local space.
    let localLeft: number;
    let localTop: number;
    if (boxed) {
        // Boxed text is anchored at its box top-left (`ps`); the first baseline sits one ascent
        // below the box top. The texture top-left is one `pad` up-left of the box origin.
        localLeft = (t.boxX ?? 0) - pad;
        localTop = (t.boxY ?? 0) - pad;
    } else {
        // Point text: the first-line baseline start sits at local (0,0); justify shifts the origin.
        if (t.justify === 2) {
            localLeft = -maxW / 2 - pad;
        } else if (t.justify === 1) {
            localLeft = -maxW - pad;
        } else {
            localLeft = -pad;
        }
        localTop = -(pad + ascent);
    }

    const texture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: canvas }, { texture, premultipliedAlpha: false }, { width: canvas.width, height: canvas.height });

    return { texture, left: localLeft, top: localTop, width: localW, height: localH };
}

/** Create the text-layer renderer. Rasterizes every text document up front. */
export function createTextRenderer(engine: EngineContext, textLayers: readonly ParsedLayer[]): LayerRenderer {
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

    const module = device.createShaderModule({ code: TEXT_WGSL });
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
        depthStencil: { format: DEPTH_STENCIL_FORMAT, depthWriteEnabled: false, depthCompare: "always" },
        multisample: { count: sampleCount },
    });

    // Rasterize every text block, keyed by layer ind, with its bind group.
    const blocks = new Map<number, TextBlock>();
    const bindGroups = new Map<number, GPUBindGroup>();
    for (const layer of textLayers) {
        if (!layer.text || layer.text.text.length === 0) {
            continue;
        }
        const block = rasterizeText(device, layer.text);
        if (!block) {
            continue;
        }
        blocks.set(layer.ind, block);
        bindGroups.set(
            layer.ind,
            device.createBindGroup({
                layout: bgl,
                entries: [
                    { binding: 0, resource: { buffer: globalBuffer } },
                    { binding: 1, resource: block.texture.createView() },
                    { binding: 2, resource: sampler },
                ],
            })
        );
    }

    const verts: number[] = [];
    const tokenInd: number[] = []; // token -> layer ind
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
        kind: 5,
        beginFrame() {
            verts.length = 0;
            tokenInd.length = 0;
        },
        emitLayer(layer: ParsedLayer, world: Mat2D, layerAlpha: number): number {
            const block = blocks.get(layer.ind);
            if (!block || layerAlpha <= 0.0001) {
                return -1;
            }
            const l = block.left;
            const tp = block.top;
            const r = l + block.width;
            const b = tp + block.height;
            apply(world, l, tp, corner);
            const ax = corner[0];
            const ay = corner[1];
            apply(world, r, tp, corner);
            const bx = corner[0];
            const by = corner[1];
            apply(world, r, b, corner);
            const cx = corner[0];
            const cy = corner[1];
            apply(world, l, b, corner);
            const dx = corner[0];
            const dy = corner[1];
            pushVert(ax, ay, 0, 0, layerAlpha);
            pushVert(bx, by, 1, 0, layerAlpha);
            pushVert(cx, cy, 1, 1, layerAlpha);
            pushVert(ax, ay, 0, 0, layerAlpha);
            pushVert(cx, cy, 1, 1, layerAlpha);
            pushVert(dx, dy, 0, 1, layerAlpha);
            const token = tokenInd.length;
            tokenInd.push(layer.ind);
            return token;
        },
        flush(ctx: LayerRenderContext) {
            const quads = tokenInd.length;
            ensureVertexBuffer(Math.max(quads, 1));
            device.queue.writeBuffer(globalBuffer, 0, new Float32Array([ctx.screenW, ctx.screenH, 0, 0]));
            if (quads > 0) {
                device.queue.writeBuffer(vertexBuffer!, 0, new Float32Array(verts), 0, quads * VERTS_PER_QUAD * FLOATS_PER_VERT);
            }
        },
        recordLayer(pass: GPURenderPassEncoder, token: number) {
            const ind = tokenInd[token];
            const bindGroup = bindGroups.get(ind);
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
            for (const block of blocks.values()) {
                block.texture.destroy();
            }
        },
    };
}
