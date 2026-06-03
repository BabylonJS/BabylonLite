/** TextRenderer — a standalone `RenderingContext` that draws one or more
 *  `TextLayer`s directly to the swapchain. Sibling of `SpriteRenderer`:
 *  owns its own render pass, no scene / camera dependency. */

import { getRenderTargetSize, registerRenderingContext, unregisterRenderingContext } from "../engine/engine.js";
import type { EngineContext, EngineContextInternal, RenderingContext } from "../engine/engine.js";
import { createEmptyUniformBuffer } from "../resource/gpu-buffers.js";
import type { TextLayer } from "./text-layer.js";
import { getTextDataInternalsOrThrow, TEXT_INSTANCE_BYTES } from "./text-data.js";
import type { TextDataInternals } from "./internal.js";
import { ensureSharedAtlasGpu } from "./_gpu/slug-textures.js";
import { getOrCreateTextPipeline } from "./_gpu/slug-pipeline.js";

const KIND = "text-renderer" as const;

/** UBO: mat4 mvp (64B) + viewport vec4 (16B) + color vec4 (16B). */
const TEXT_UBO_BYTES = 96;

export interface TextRendererOptions {
    layers: readonly TextLayer[];
    /** Default true. Set false for HUD overlays so the text pass preserves existing scene color. */
    clear?: boolean;
    /** Default `{ r: 0, g: 0, b: 0, a: 1 }`. */
    clearValue?: GPUColorDict;
}

export interface TextRenderer extends RenderingContext {
    readonly _kind: typeof KIND;
    readonly layers: readonly TextLayer[];
}

/** @internal Per-layer GPU resources owned by the renderer. */
interface LayerGpu {
    layer: TextLayer;
    textU: GPUBuffer;
    instanceBuf: GPUBuffer;
    instanceCap: number;
    pipeline: GPURenderPipeline | null;
    /** Per-draw-group bind groups; rebuilt when atlas grows. */
    bindGroups: GPUBindGroup[];
    bindGroupAtlasVersions: number[];
    uploadedDataVersion: number;
    uploadedViewportW: number;
    uploadedViewportH: number;
    /** Snapshot of (posX, posY, rot, scale, W, H) to skip mvp upload when unchanged. */
    lastMvpInputs: Float32Array;
    mvpUploaded: boolean;
}

interface TextRendererInternal extends TextRenderer {
    _engine: EngineContextInternal;
    _layerGpu: Map<TextLayer, LayerGpu>;
    layers: TextLayer[];
    _targetWidth: number;
    _targetHeight: number;
    _disposed: boolean;
    _clear: boolean;
}

const _mvpScratch = new Float32Array(16);

function buildLayerMvp(layer: TextLayer, targetW: number, targetH: number, out: Float32Array): void {
    const s = layer.scale;
    const r = layer.rotationRad;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    const px = layer.positionPx.x;
    const py = layer.positionPx.y;
    // Map glyph-local (font Y-up) coords through (scale, flip-Y) → rotate → translate → ortho(W,H, Y-down).
    // Equivalent compact affine — see plan note for derivation. Column-major.
    const cx = (2 * s) / targetW;
    const cy = (2 * s) / targetH;
    out.fill(0);
    out[0] = cx * cr; // col 0, row 0
    out[1] = -cy * sr; // col 0, row 1
    out[4] = cx * sr; // col 1, row 0
    out[5] = cy * cr; // col 1, row 1
    out[10] = 1; // depth pass-through (we don't write depth)
    out[12] = (2 * px) / targetW - 1;
    out[13] = 1 - (2 * py) / targetH;
    out[15] = 1;
}

function ensureLayerGpu(rr: TextRendererInternal, layer: TextLayer): LayerGpu {
    let lg = rr._layerGpu.get(layer);
    if (lg) {
        return lg;
    }
    const device = rr._engine.device;
    const internals = getTextDataInternalsOrThrow(layer.data);
    const cap = Math.max(internals.instanceCount, 8);
    lg = {
        layer,
        textU: createEmptyUniformBuffer(rr._engine, TEXT_UBO_BYTES, "text-layer-ubo"),
        instanceBuf: device.createBuffer({
            label: "text-layer-instances",
            size: cap * TEXT_INSTANCE_BYTES,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        }),
        instanceCap: cap,
        pipeline: null,
        bindGroups: [],
        bindGroupAtlasVersions: [],
        uploadedDataVersion: -1,
        uploadedViewportW: 0,
        uploadedViewportH: 0,
        lastMvpInputs: new Float32Array(6),
        mvpUploaded: false,
    };
    rr._layerGpu.set(layer, lg);
    return lg;
}

function ensureInstanceCapacity(device: GPUDevice, lg: LayerGpu, needed: number): void {
    if (needed <= lg.instanceCap) {
        return;
    }
    let cap = lg.instanceCap;
    while (cap < needed) {
        cap *= 2;
    }
    lg.instanceBuf.destroy();
    lg.instanceBuf = device.createBuffer({
        label: "text-layer-instances",
        size: cap * TEXT_INSTANCE_BYTES,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    lg.instanceCap = cap;
    lg.uploadedDataVersion = -1;
}

function uploadLayer(rr: TextRendererInternal, lg: LayerGpu, bgl0: GPUBindGroupLayout): void {
    const device = rr._engine.device;
    const layer = lg.layer;
    const internals = getTextDataInternalsOrThrow(layer.data);

    // Atlas + bind groups per draw group.
    for (let i = 0; i < internals.groups.length; i++) {
        const g = internals.groups[i]!;
        const { rebuilt, gpu: atlasGpu } = ensureSharedAtlasGpu(device, g.atlas);
        const current = lg.bindGroups[i];
        const currentVer = lg.bindGroupAtlasVersions[i] ?? -1;
        if (!current || rebuilt || currentVer !== atlasGpu.uploadedVersion) {
            lg.bindGroups[i] = device.createBindGroup({
                label: "text-renderer-bg0-" + g.curveSetId,
                layout: bgl0,
                entries: [
                    { binding: 0, resource: { buffer: lg.textU } },
                    { binding: 1, resource: atlasGpu.curveTex.createView() },
                    { binding: 2, resource: atlasGpu.bandTex.createView() },
                ],
            });
            lg.bindGroupAtlasVersions[i] = atlasGpu.uploadedVersion;
        }
    }
    if (lg.bindGroups.length > internals.groups.length) {
        lg.bindGroups.length = internals.groups.length;
        lg.bindGroupAtlasVersions.length = internals.groups.length;
    }

    // Instance buffer.
    ensureInstanceCapacity(device, lg, internals.instanceCount);
    if (lg.uploadedDataVersion !== internals.version && internals.instanceCount > 0) {
        const dirtyValid = lg.uploadedDataVersion !== -1 && internals.dirtyEnd > internals.dirtyStart;
        if (dirtyValid) {
            const startFloats = internals.dirtyStart * (TEXT_INSTANCE_BYTES / 4);
            const endFloats = internals.dirtyEnd * (TEXT_INSTANCE_BYTES / 4);
            const view = internals.instances.subarray(startFloats, endFloats);
            device.queue.writeBuffer(lg.instanceBuf, internals.dirtyStart * TEXT_INSTANCE_BYTES, view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
        } else {
            const view = internals.instances.subarray(0, internals.instanceCount * (TEXT_INSTANCE_BYTES / 4));
            device.queue.writeBuffer(lg.instanceBuf, 0, view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
        }
        lg.uploadedDataVersion = internals.version;
        internals.dirtyStart = 0;
        internals.dirtyEnd = 0;
    }

    // MVP — skip upload when nothing relevant changed.
    const W = rr._targetWidth;
    const H = rr._targetHeight;
    const mi = lg.lastMvpInputs;
    if (!lg.mvpUploaded || mi[0] !== layer.positionPx.x || mi[1] !== layer.positionPx.y || mi[2] !== layer.rotationRad || mi[3] !== layer.scale || mi[4] !== W || mi[5] !== H) {
        buildLayerMvp(layer, W, H, _mvpScratch);
        device.queue.writeBuffer(lg.textU, 0, _mvpScratch.buffer as ArrayBuffer, _mvpScratch.byteOffset, 64);
        mi[0] = layer.positionPx.x;
        mi[1] = layer.positionPx.y;
        mi[2] = layer.rotationRad;
        mi[3] = layer.scale;
        mi[4] = W;
        mi[5] = H;
        lg.mvpUploaded = true;
    }

    // Viewport (only used by Slug dilation; pixel reciprocal is fine to refresh on resize).
    if (lg.uploadedViewportW !== W || lg.uploadedViewportH !== H) {
        const vp = new Float32Array([W, H, 0, 0]);
        device.queue.writeBuffer(lg.textU, 64, vp.buffer as ArrayBuffer, vp.byteOffset, 16);
        lg.uploadedViewportW = W;
        lg.uploadedViewportH = H;
    }

    // Color uniform carries the whole-layer opacity as alpha (RGB = white). Per-glyph/per-run
    // color comes from the instance `slugColor` attribute and is multiplied by this in the shader.
    const col = new Float32Array([1, 1, 1, layer.opacity]);
    device.queue.writeBuffer(lg.textU, 80, col.buffer as ArrayBuffer, col.byteOffset, 16);
}

function disposeLayerGpu(lg: LayerGpu): void {
    lg.textU.destroy();
    lg.instanceBuf.destroy();
}

function compareLayers(a: TextLayer, b: TextLayer): number {
    return a.order - b.order;
}

export function createTextRenderer(engine: EngineContext, opts: TextRendererOptions): TextRenderer {
    const eng = engine as EngineContextInternal;
    const targetSize = getRenderTargetSize(eng);

    const rr: TextRendererInternal = {
        _kind: KIND,
        _engine: eng,
        _layerGpu: new Map(),
        _targetWidth: targetSize.width,
        _targetHeight: targetSize.height,
        _disposed: false,
        _clear: opts.clear ?? true,
        layers: opts.layers.slice(),
        clearColor: opts.clearValue ?? { r: 0, g: 0, b: 0, a: 1 },
        _drawCallsPre: 0,
        _update(): void {
            textRendererUpdate(rr);
        },
        _record(): number {
            return textRendererRecord(rr);
        },
    };
    return rr;
}

function textRendererUpdate(rr: TextRendererInternal): void {
    if (rr._disposed) {
        return;
    }
    const size = getRenderTargetSize(rr._engine);
    rr._targetWidth = size.width;
    rr._targetHeight = size.height;

    if (rr.layers.length > 1) {
        rr.layers.sort(compareLayers);
    }

    // Pipeline: depth-less, sampleCount=1, swapchain format. (One cached pipeline for the renderer.)
    const { cache } = getOrCreateTextPipeline(rr._engine, rr._engine.format, 1, null, false, false);

    for (const layer of rr.layers) {
        if (!layer.visible) {
            continue;
        }
        const lg = ensureLayerGpu(rr, layer);
        const { pipeline } = getOrCreateTextPipeline(rr._engine, rr._engine.format, 1, null, false, false);
        if (lg.pipeline !== pipeline) {
            lg.pipeline = pipeline;
            // Pipeline change → bind groups must be rebuilt against new bgl0.
            lg.bindGroups.length = 0;
            lg.bindGroupAtlasVersions.length = 0;
        }
        uploadLayer(rr, lg, cache.bgl0);
    }
}

function textRendererRecord(rr: TextRendererInternal): number {
    if (rr._disposed) {
        return 0;
    }
    const eng = rr._engine;
    const encoder = eng._currentEncoder;
    const swapView = eng._swapchainView;

    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: swapView,
                clearValue: rr.clearColor,
                loadOp: rr._clear ? "clear" : "load",
                storeOp: "store",
            },
        ],
    });

    let drawCalls = 0;
    let lastPipeline: GPURenderPipeline | null = null;
    const { cache } = getOrCreateTextPipeline(rr._engine, rr._engine.format, 1, null, false, false);
    const quadVertex = cache.quadVertexBuffer;
    pass.setVertexBuffer(0, quadVertex);

    for (const layer of rr.layers) {
        if (!layer.visible) {
            continue;
        }
        const lg = rr._layerGpu.get(layer);
        if (!lg || !lg.pipeline) {
            continue;
        }
        const internals = getTextDataInternalsOrThrow(layer.data) as TextDataInternals;
        if (internals.instanceCount === 0) {
            continue;
        }
        if (lastPipeline !== lg.pipeline) {
            pass.setPipeline(lg.pipeline);
            lastPipeline = lg.pipeline;
        }
        pass.setVertexBuffer(1, lg.instanceBuf);
        for (let i = 0; i < internals.groups.length; i++) {
            const g = internals.groups[i]!;
            const bg = lg.bindGroups[i];
            if (g.slotCount === 0 || !bg) {
                continue;
            }
            pass.setBindGroup(0, bg);
            pass.draw(6, g.slotCount, 0, g.slotStart);
            drawCalls++;
        }
    }

    pass.end();
    return drawCalls;
}

export function addTextRendererLayer(tr: TextRenderer, layer: TextLayer): void {
    const rr = tr as TextRendererInternal;
    if (rr._disposed) {
        throw new Error("TextRenderer has been disposed.");
    }
    if (rr.layers.includes(layer)) {
        return;
    }
    rr.layers.push(layer);
}

export function removeTextRendererLayer(tr: TextRenderer, layer: TextLayer): boolean {
    const rr = tr as TextRendererInternal;
    const i = rr.layers.indexOf(layer);
    if (i < 0) {
        return false;
    }
    rr.layers.splice(i, 1);
    const lg = rr._layerGpu.get(layer);
    if (lg) {
        disposeLayerGpu(lg);
        rr._layerGpu.delete(layer);
    }
    return true;
}

export function registerTextRenderer(tr: TextRenderer): void {
    registerRenderingContext((tr as TextRendererInternal)._engine, tr);
}

export function unregisterTextRenderer(tr: TextRenderer): void {
    unregisterRenderingContext((tr as TextRendererInternal)._engine, tr);
}

export function disposeTextRenderer(tr: TextRenderer): void {
    const rr = tr as TextRendererInternal;
    if (rr._disposed) {
        return;
    }
    unregisterTextRenderer(rr);
    rr._disposed = true;
    for (const lg of rr._layerGpu.values()) {
        disposeLayerGpu(lg);
    }
    rr._layerGpu.clear();
    rr.layers.length = 0;
}
