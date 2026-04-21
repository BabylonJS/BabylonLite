/**
 * `SpriteRenderer` — owns the WGSL, pipeline cache, shared index buffer,
 * and per-layer GPU state required to draw `Sprite2DLayer`s. Implements
 * `RenderingContext` directly, so it plugs into `engine._renderingContexts`
 * the same way a `SceneContext` does.
 *
 * PR 1 scope (intentionally minimal):
 *   - Pure-2D path only — no `SceneContext`, no camera, no lights.
 *   - One pipeline cache per renderer instance, keyed on
 *     `(sampleCount << 8) | (blendMode << 4) | (hasDepth ? 1 : 0)`. PR 1
 *     populates at most two keys (alpha + premultiplied), both with
 *     `hasDepth=0` and the engine's MSAA sample count.
 *   - The renderer draws **into the engine's shared pass**: the
 *     `target` / `depthView` / `resolveTarget` / `loadOp` / `clearValue`
 *     / `sampleCount` options on `SpriteRendererOptions` exist for
 *     future PRs (HUD-to-offscreen rendering) and are accepted but
 *     ignored inside `_record` in PR 1.
 */
import type { EngineContext, EngineContextInternal, RenderingContext } from "../engine/engine.js";
import type { Sprite2DLayer } from "./sprite-2d.js";
import { INSTANCE_FLOATS_PER_SPRITE, INSTANCE_STRIDE_BYTES } from "./sprite-2d.js";
import type { SpriteBlendMode } from "./shared/sprite-atlas.js";

/** Tag used by the engine and by tests to identify a sprite renderer. */
const KIND = "sprite-renderer" as const;

/** Options accepted by `createSpriteRenderer`. */
export interface SpriteRendererOptions {
    /** Layers to draw, in registration order. The renderer also re-sorts internally each frame. */
    layers: Sprite2DLayer[];
    /** Default `{ r: 0, g: 0, b: 0, a: 1 }`. */
    clearValue?: GPUColorDict;
    /** Forward-compat — ignored in PR 1; engine pass owns the color attachment. */
    target?: GPUTextureView | (() => GPUTextureView);
    /** Forward-compat — ignored in PR 1. */
    depthView?: GPUTextureView | (() => GPUTextureView | undefined);
    /** Forward-compat — ignored in PR 1. */
    resolveTarget?: GPUTextureView | (() => GPUTextureView);
    /** Forward-compat — ignored in PR 1. */
    loadOp?: GPULoadOp;
    /** Forward-compat — ignored in PR 1; the renderer always uses the engine's MSAA sample count. */
    sampleCount?: 1 | 4;
}

/** A `SpriteRenderer` — pure data, plugs into `engine._renderingContexts`. */
export interface SpriteRenderer extends RenderingContext {
    readonly _kind: typeof KIND;
    /** Mutable: callers may push / splice layers between frames. */
    layers: Sprite2DLayer[];
    /** Set by the engine's clear pass; reads the value supplied at construction. */
    clearColor: GPUColorDict;
    _drawCallsPre: number;
    _update(encoder: GPUCommandEncoder, deltaMs: number): GPUCommandEncoder;
    _record(pass: GPURenderPassEncoder): number;
}

/** @internal A single cached pipeline + its bind group layout. */
interface PipelineEntry {
    pipeline: GPURenderPipeline;
    bgl: GPUBindGroupLayout;
}

/** @internal Per-layer GPU resources owned by the renderer. */
interface LayerGpu {
    layer: Sprite2DLayer;
    instanceBuffer: GPUBuffer;
    instanceBufferCapacity: number;
    uniformBuffer: GPUBuffer;
    bindGroup: GPUBindGroup | null;
    bindGroupVersion: number;
    uploadedVersion: number;
}

interface SpriteRendererInternal extends SpriteRenderer {
    _engine: EngineContextInternal;
    _device: GPUDevice;
    _format: GPUTextureFormat;
    _msaa: number;
    _shaderModule: GPUShaderModule;
    _indexBuffer: GPUBuffer;
    _pipelineCache: Map<number, PipelineEntry>;
    _layerGpu: Map<Sprite2DLayer, LayerGpu>;
    /** Captured each `_update`, read in `_record`. */
    _targetWidth: number;
    _targetHeight: number;
    _disposed: boolean;
}

const LAYER_UBO_BYTES = 32;
const SHARED_INDEX_DATA: Readonly<Uint16Array> = new Uint16Array([0, 1, 2, 0, 2, 3]);

const WGSL_SHADER = `struct Layer {
viewPos: vec2<f32>,
viewScale: f32,
viewRot: f32,
screenSize: vec2<f32>,
opacity: f32,
_pad: f32,
};
@group(0) @binding(0) var<uniform> L: Layer;
@group(0) @binding(1) var atlasTex: texture_2d<f32>;
@group(0) @binding(2) var atlasSamp: sampler;
struct VIn {
@builtin(vertex_index) vid: u32,
@location(0) iPos: vec2<f32>,
@location(1) iSize: vec2<f32>,
@location(2) iUvMin: vec2<f32>,
@location(3) iUvMax: vec2<f32>,
@location(4) iRot: f32,
@location(5) iColor: vec4<f32>,
};
struct VOut {
@builtin(position) pos: vec4<f32>,
@location(0) uv: vec2<f32>,
@location(1) tint: vec4<f32>,
};
@vertex
fn vs(in: VIn) -> VOut {
var corners = array<vec2<f32>, 4>(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0));
let c = corners[in.vid];
let local = (c - vec2<f32>(0.5, 0.5)) * in.iSize;
let cr = cos(in.iRot);
let sr = sin(in.iRot);
let rotated = vec2<f32>(local.x * cr - local.y * sr, local.x * sr + local.y * cr);
let worldPx = in.iPos + rotated;
let centered = worldPx - L.viewPos;
let lc = cos(L.viewRot);
let ls = sin(L.viewRot);
let viewRot = vec2<f32>(centered.x * lc - centered.y * ls, centered.x * ls + centered.y * lc);
let screenPx = viewRot * L.viewScale;
let ndc = vec2<f32>(screenPx.x / L.screenSize.x * 2.0 - 1.0, 1.0 - screenPx.y / L.screenSize.y * 2.0);
let uv = mix(in.iUvMin, in.iUvMax, c);
var out: VOut;
out.pos = vec4<f32>(ndc, 0.0, 1.0);
out.uv = uv;
out.tint = in.iColor;
return out;
}
@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
let s = textureSample(atlasTex, atlasSamp, in.uv);
return s * in.tint * vec4<f32>(1.0, 1.0, 1.0, L.opacity);
}`;

function blendModeKey(b: SpriteBlendMode): number {
    // PR 1 supports alpha (0) and premultiplied (1) only; layer factory enforces this.
    return b === "premultiplied" ? 1 : 0;
}

function pipelineKey(sampleCount: number, blendMode: SpriteBlendMode, hasDepth: boolean): number {
    return (sampleCount << 8) | (blendModeKey(blendMode) << 4) | (hasDepth ? 1 : 0);
}

function blendDescriptor(blendMode: SpriteBlendMode): GPUBlendState {
    if (blendMode === "premultiplied") {
        return {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        };
    }
    // "alpha" — straight (non-premultiplied) source.
    return {
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    };
}

function buildPipeline(rr: SpriteRendererInternal, blendMode: SpriteBlendMode, hasDepth: boolean): PipelineEntry {
    const bgl = rr._device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        ],
    });
    const layout = rr._device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const pipeline = rr._device.createRenderPipeline({
        layout,
        vertex: {
            module: rr._shaderModule,
            entryPoint: "vs",
            buffers: [
                {
                    arrayStride: INSTANCE_STRIDE_BYTES,
                    stepMode: "instance",
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: "float32x2" }, // positionPx
                        { shaderLocation: 1, offset: 8, format: "float32x2" }, // sizePx
                        { shaderLocation: 2, offset: 16, format: "float32x2" }, // uvMin
                        { shaderLocation: 3, offset: 24, format: "float32x2" }, // uvMax
                        { shaderLocation: 4, offset: 32, format: "float32" }, // rotation
                        { shaderLocation: 5, offset: 40, format: "unorm8x4" }, // color (RGBA8)
                    ],
                },
            ],
        },
        fragment: {
            module: rr._shaderModule,
            entryPoint: "fs",
            targets: [{ format: rr._format, blend: blendDescriptor(blendMode), writeMask: GPUColorWrite.ALL }],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        // Engine pass always has a depth-stencil attachment; we must declare one even when
        // we don't use it. PR 1 keeps depth disabled for every layer (`depth: "none"`).
        depthStencil: {
            format: "depth24plus-stencil8",
            depthCompare: hasDepth ? "less-equal" : "always",
            depthWriteEnabled: false,
        },
        multisample: { count: rr._msaa },
    });
    return { pipeline, bgl };
}

function getOrBuildPipeline(rr: SpriteRendererInternal, blendMode: SpriteBlendMode, hasDepth: boolean): PipelineEntry {
    const key = pipelineKey(rr._msaa, blendMode, hasDepth);
    let entry = rr._pipelineCache.get(key);
    if (!entry) {
        entry = buildPipeline(rr, blendMode, hasDepth);
        rr._pipelineCache.set(key, entry);
    }
    return entry;
}

function ensureLayerGpu(rr: SpriteRendererInternal, layer: Sprite2DLayer): LayerGpu {
    let lg = rr._layerGpu.get(layer);
    if (!lg) {
        const cap = layer._capacity;
        const instanceBuffer = rr._device.createBuffer({
            size: Math.max(INSTANCE_STRIDE_BYTES, cap * INSTANCE_STRIDE_BYTES),
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        const uniformBuffer = rr._device.createBuffer({
            size: LAYER_UBO_BYTES,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        lg = {
            layer,
            instanceBuffer,
            instanceBufferCapacity: cap,
            uniformBuffer,
            bindGroup: null,
            bindGroupVersion: -1,
            uploadedVersion: -1,
        };
        rr._layerGpu.set(layer, lg);
    }
    if (lg.instanceBufferCapacity < layer._capacity) {
        lg.instanceBuffer.destroy();
        lg.instanceBuffer = rr._device.createBuffer({
            size: layer._capacity * INSTANCE_STRIDE_BYTES,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        lg.instanceBufferCapacity = layer._capacity;
        lg.uploadedVersion = -1;
    }
    return lg;
}

function uploadLayer(rr: SpriteRendererInternal, lg: LayerGpu): void {
    const layer = lg.layer;
    if (lg.uploadedVersion !== layer._version && layer.count > 0) {
        const bytes = layer.count * INSTANCE_STRIDE_BYTES;
        rr._device.queue.writeBuffer(lg.instanceBuffer, 0, layer._instanceData.buffer, layer._instanceData.byteOffset, bytes);
        layer._dirtyMin = 0;
        layer._dirtyMax = 0;
        lg.uploadedVersion = layer._version;
    }

    // Layer UBO — small + cheap; rewrite each frame so view / opacity / target dims stay in sync.
    const ubo = _scratchUbo;
    ubo[0] = layer.view.positionPx[0];
    ubo[1] = layer.view.positionPx[1];
    ubo[2] = layer.view.zoom;
    ubo[3] = layer.view.rotation;
    ubo[4] = rr._targetWidth;
    ubo[5] = rr._targetHeight;
    ubo[6] = layer.opacity;
    ubo[7] = 0;
    rr._device.queue.writeBuffer(lg.uniformBuffer, 0, ubo.buffer, ubo.byteOffset, LAYER_UBO_BYTES);
}

const _scratchUbo = new Float32Array(LAYER_UBO_BYTES / 4);

function ensureBindGroup(rr: SpriteRendererInternal, lg: LayerGpu, entry: PipelineEntry): GPUBindGroup {
    if (lg.bindGroup && lg.bindGroupVersion === lg.uploadedVersion + 1) {
        return lg.bindGroup;
    }
    const tex = lg.layer.atlas.texture;
    lg.bindGroup = rr._device.createBindGroup({
        layout: entry.bgl,
        entries: [
            { binding: 0, resource: { buffer: lg.uniformBuffer } },
            { binding: 1, resource: tex.view },
            { binding: 2, resource: tex.sampler },
        ],
    });
    lg.bindGroupVersion = lg.uploadedVersion + 1;
    return lg.bindGroup;
}

function compareLayers(a: Sprite2DLayer, b: Sprite2DLayer): number {
    if (a.order !== b.order) {
        return a.order - b.order;
    }
    return 0;
}

/** Create a `SpriteRenderer` for `engine`, pre-warming pipelines for the layers' blend modes. */
export function createSpriteRenderer(engine: EngineContext, opts: SpriteRendererOptions): SpriteRenderer {
    const eng = engine as EngineContextInternal;
    const shaderModule = eng.device.createShaderModule({ code: WGSL_SHADER });
    const indexBuffer = eng.device.createBuffer({
        size: SHARED_INDEX_DATA.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    eng.device.queue.writeBuffer(indexBuffer, 0, SHARED_INDEX_DATA.buffer, SHARED_INDEX_DATA.byteOffset, SHARED_INDEX_DATA.byteLength);

    const rr: SpriteRendererInternal = {
        _kind: KIND,
        _engine: eng,
        _device: eng.device,
        _format: eng.format,
        _msaa: eng.msaaSamples,
        _shaderModule: shaderModule,
        _indexBuffer: indexBuffer,
        _pipelineCache: new Map(),
        _layerGpu: new Map(),
        _targetWidth: eng._targets.width,
        _targetHeight: eng._targets.height,
        _disposed: false,
        layers: opts.layers.slice(),
        clearColor: opts.clearValue ?? { r: 0, g: 0, b: 0, a: 1 },
        _drawCallsPre: 0,
        _update(encoder: GPUCommandEncoder, _deltaMs: number): GPUCommandEncoder {
            spriteRendererUpdate(rr, encoder);
            return encoder;
        },
        _record(pass: GPURenderPassEncoder): number {
            return spriteRendererRecord(rr, pass);
        },
    };

    // Pre-warm a pipeline for every distinct blend mode currently in use, so the
    // first frame doesn't pay the compile cost.
    const seen = new Set<number>();
    for (const layer of rr.layers) {
        const k = pipelineKey(rr._msaa, layer.blendMode, false);
        if (!seen.has(k)) {
            getOrBuildPipeline(rr, layer.blendMode, false);
            seen.add(k);
        }
    }

    return rr;
}

function spriteRendererUpdate(rr: SpriteRendererInternal, _encoder: GPUCommandEncoder): void {
    if (rr._disposed) {
        return;
    }
    rr._targetWidth = rr._engine._targets.width;
    rr._targetHeight = rr._engine._targets.height;

    for (const layer of rr.layers) {
        if (!layer.visible || layer.count === 0) {
            continue;
        }
        const lg = ensureLayerGpu(rr, layer);
        uploadLayer(rr, lg);
    }
}

function spriteRendererRecord(rr: SpriteRendererInternal, pass: GPURenderPassEncoder): number {
    if (rr._disposed) {
        return 0;
    }
    const sorted = rr.layers.slice().sort(compareLayers);
    let drawCalls = 0;
    pass.setIndexBuffer(rr._indexBuffer, "uint16");

    for (const layer of sorted) {
        if (!layer.visible || layer.count === 0) {
            continue;
        }
        const lg = rr._layerGpu.get(layer);
        if (!lg) {
            continue;
        }
        const entry = getOrBuildPipeline(rr, layer.blendMode, false);
        const bg = ensureBindGroup(rr, lg, entry);
        pass.setPipeline(entry.pipeline);
        pass.setBindGroup(0, bg);
        pass.setVertexBuffer(0, lg.instanceBuffer);
        pass.drawIndexed(6, layer.count, 0, 0, 0);
        drawCalls++;
    }

    return drawCalls;
}

/** Push the renderer onto `engine._renderingContexts`. Idempotent — a second call is a no-op. */
export function registerSpriteRenderer(engine: EngineContext, sr: SpriteRenderer): void {
    const list = (engine as EngineContextInternal)._renderingContexts;
    if (list.indexOf(sr) !== -1) {
        return;
    }
    list.push(sr);
}

/** Splice the renderer out of `engine._renderingContexts`. No-op if not present. */
export function unregisterSpriteRenderer(engine: EngineContext, sr: SpriteRenderer): void {
    const list = (engine as EngineContextInternal)._renderingContexts;
    const i = list.indexOf(sr);
    if (i !== -1) {
        list.splice(i, 1);
    }
}

/** Destroy all GPU resources owned by the renderer and clear `layers`. */
export function disposeSpriteRenderer(sr: SpriteRenderer): void {
    const rr = sr as SpriteRendererInternal;
    if (rr._disposed) {
        return;
    }
    rr._disposed = true;
    for (const lg of rr._layerGpu.values()) {
        lg.instanceBuffer.destroy();
        lg.uniformBuffer.destroy();
    }
    rr._layerGpu.clear();
    rr._indexBuffer.destroy();
    rr._pipelineCache.clear();
    rr.layers.length = 0;
}

/** @internal Test-only accessor for pipeline-cache size. */
export function _spriteRendererPipelineCacheSize(sr: SpriteRenderer): number {
    return (sr as SpriteRendererInternal)._pipelineCache.size;
}

/** @internal Re-used by `INSTANCE_FLOATS_PER_SPRITE` consumers (kept for type isolation). */
export const _SPRITE_INSTANCE_FLOATS = INSTANCE_FLOATS_PER_SPRITE;
