/**
 * `Sprite2DLayer` — pixel-coordinate sprite layer. Pure-data interface +
 * standalone Index API for add / update / remove / setFrame. The layer is
 * owned by a `SpriteRenderer` (pure-2D path) or, in a later PR, by a
 * `SceneContext` (HUD / depth-hosted paths).
 *
 * PR 1 implements the Index API only. Animation, clip playback, and the
 * Handle API land in later PRs.
 */
import type { SpriteAtlas, SpriteBlendMode, SpriteFrameRef } from "./shared/sprite-atlas.js";
import { resolveSpriteFrame } from "./shared/sprite-atlas.js";

/** Depth participation. PR 1 implements `"none"` only. */
export type Sprite2DDepthMode = "none" | "test" | "test-write";

/** Per-layer 2D camera (pan / zoom / rotation). Identity = pixel-perfect HUD. */
export interface Sprite2DView {
    positionPx: [number, number];
    zoom: number;
    rotation: number;
}

/** Options accepted by `createSprite2DLayer`. */
export interface Sprite2DLayerOptions {
    capacity?: number;
    blendMode?: SpriteBlendMode;
    pixelSnap?: boolean;
    opacity?: number;
    visible?: boolean;
    order?: number;
    view?: Partial<Sprite2DView>;
    depth?: Sprite2DDepthMode;
}

/** A `Sprite2DLayer` — pure data, no methods. */
export interface Sprite2DLayer {
    readonly _entityType: "sprite-2d-layer";
    readonly atlas: SpriteAtlas;
    readonly depth: Sprite2DDepthMode;
    blendMode: SpriteBlendMode;
    pixelSnap: boolean;
    opacity: number;
    visible: boolean;
    order: number;
    view: Sprite2DView;
    count: number;

    /** @internal Capacity of the per-instance buffer (in sprites). */
    _capacity: number;
    /** @internal Per-instance CPU staging buffer; layout = INSTANCE_FLOATS_PER_SPRITE per sprite. */
    _instanceData: Float32Array;
    /** @internal Bumped on any structural / per-instance edit; renderer compares. */
    _version: number;
    /** @internal Min dirty index inclusive (for partial uploads). */
    _dirtyMin: number;
    /** @internal Max dirty index exclusive. */
    _dirtyMax: number;
}

/** Per-sprite init record. */
export interface Sprite2DInit {
    positionPx: [number, number];
    sizePx?: [number, number];
    frame?: SpriteFrameRef;
    rotation?: number;
    pivot?: [number, number];
    color?: [number, number, number, number];
    flipX?: boolean;
    flipY?: boolean;
    layerZ?: number;
    visible?: boolean;
    /** Reserved for picking (PR 5). Accepted but unused in PR 1. */
    pickable?: boolean;
    /** Reserved for clip animation (later PR). Accepted but unused in PR 1. */
    clip?: unknown;
}

/**
 * Per-instance vertex layout (12 floats = 48 bytes, std430-style packing):
 *   [0..1]  positionPx.xy
 *   [2..3]  sizePx.xy
 *   [4..5]  uvMin.xy
 *   [6..7]  uvMax.xy
 *   [8]     rotation
 *   [9]     _pad
 *   [10]    colorRGBA packed unorm8x4 (reinterpreted as f32 by upload)
 *   [11]    _pad
 *
 * The renderer treats slot [10] as a `unorm8x4` vertex attribute (4 bytes
 * stored in 4-byte stride slot) — Float32Array is just a convenient
 * homogeneous backing store; the bits are written via a Uint8Array view.
 */
export const INSTANCE_FLOATS_PER_SPRITE = 12;
/** @internal Per-sprite stride in bytes — kept in sync with INSTANCE_FLOATS_PER_SPRITE. */
export const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS_PER_SPRITE * 4;

const DEFAULT_CAPACITY = 16;

function assertDepthSupported(depth: Sprite2DDepthMode): void {
    if (depth === "test" || depth === "test-write") {
        throw new Error(`Sprite2DLayer: depth: "${depth}" lands in PR 3. Use "none" for now.`);
    }
}

function assertBlendSupported(blendMode: SpriteBlendMode): void {
    if (blendMode === "additive" || blendMode === "multiply" || blendMode === "cutout") {
        throw new Error(`Sprite2DLayer: blendMode: "${blendMode}" lands in a later PR. Use "alpha" or "premultiplied".`);
    }
}

/** Create a new (empty) `Sprite2DLayer` backed by `atlas`. */
export function createSprite2DLayer(atlas: SpriteAtlas, opts: Sprite2DLayerOptions = {}): Sprite2DLayer {
    const depth = opts.depth ?? "none";
    assertDepthSupported(depth);
    const blendMode = opts.blendMode ?? "alpha";
    assertBlendSupported(blendMode);

    const capacity = Math.max(1, opts.capacity ?? DEFAULT_CAPACITY);
    const view: Sprite2DView = {
        positionPx: [opts.view?.positionPx?.[0] ?? 0, opts.view?.positionPx?.[1] ?? 0],
        zoom: opts.view?.zoom ?? 1,
        rotation: opts.view?.rotation ?? 0,
    };

    return {
        _entityType: "sprite-2d-layer",
        atlas,
        depth,
        blendMode,
        pixelSnap: opts.pixelSnap ?? false,
        opacity: opts.opacity ?? 1,
        visible: opts.visible ?? true,
        order: opts.order ?? 0,
        view,
        count: 0,
        _capacity: capacity,
        _instanceData: new Float32Array(capacity * INSTANCE_FLOATS_PER_SPRITE),
        _version: 0,
        _dirtyMin: 0,
        _dirtyMax: 0,
    };
}

function growCapacity(layer: Sprite2DLayer, minCapacity: number): void {
    let cap = layer._capacity;
    while (cap < minCapacity) {
        cap *= 2;
    }
    const next = new Float32Array(cap * INSTANCE_FLOATS_PER_SPRITE);
    next.set(layer._instanceData);
    layer._instanceData = next;
    layer._capacity = cap;
}

function packColor(r: number, g: number, b: number, a: number): number {
    const ri = Math.max(0, Math.min(255, Math.round(r * 255)));
    const gi = Math.max(0, Math.min(255, Math.round(g * 255)));
    const bi = Math.max(0, Math.min(255, Math.round(b * 255)));
    const ai = Math.max(0, Math.min(255, Math.round(a * 255)));
    // Little-endian: byte 0 = R, byte 1 = G, byte 2 = B, byte 3 = A.
    return (ri | (gi << 8) | (bi << 16) | (ai << 24)) >>> 0;
}

/**
 * Write one sprite's instance data into `layer._instanceData[base..base+12]`.
 * `prev` is the existing 12-float record (or null on add) so that update
 * patches can fall back to existing values.
 */
function writeInstance(layer: Sprite2DLayer, base: number, init: Sprite2DInit, prev: Float32Array | null): void {
    const data = layer._instanceData;
    const atlas = layer.atlas;

    let frameIdx = -1;
    if (init.frame !== undefined) {
        frameIdx = resolveSpriteFrame(atlas, init.frame);
    }
    const frame = frameIdx >= 0 ? atlas.frames[frameIdx]! : null;

    const prevSizeX = prev ? prev[2]! : 0;
    const prevSizeY = prev ? prev[3]! : 0;
    const visible = init.visible ?? (prev ? !(prevSizeX === 0 && prevSizeY === 0) : true);
    const sizeSrc = init.sizePx ?? (frame ? frame.sourceSizePx : ([prevSizeX, prevSizeY] as readonly [number, number]));
    const sizeX = visible ? sizeSrc[0] : 0;
    const sizeY = visible ? sizeSrc[1] : 0;

    let uMin = prev ? prev[4]! : 0;
    let vMin = prev ? prev[5]! : 0;
    let uMax = prev ? prev[6]! : 1;
    let vMax = prev ? prev[7]! : 1;
    if (frame) {
        uMin = frame.uvMin[0];
        vMin = frame.uvMin[1];
        uMax = frame.uvMax[0];
        vMax = frame.uvMax[1];
    }
    if (init.flipX === true) {
        const t = uMin;
        uMin = uMax;
        uMax = t;
    }
    if (init.flipY === true) {
        const t = vMin;
        vMin = vMax;
        vMax = t;
    }

    const color = init.color ?? (prev ? null : [1, 1, 1, 1]);
    const colorPacked = color
        ? packColor(color[0], color[1], color[2], color[3])
        : // re-pack the previous packed bits exactly (already a float-aliased u32 pattern)
          undefined;

    data[base + 0] = init.positionPx[0];
    data[base + 1] = init.positionPx[1];
    data[base + 2] = sizeX;
    data[base + 3] = sizeY;
    data[base + 4] = uMin;
    data[base + 5] = vMin;
    data[base + 6] = uMax;
    data[base + 7] = vMax;
    data[base + 8] = init.rotation ?? (prev ? prev[8]! : 0);
    data[base + 9] = 0;

    if (colorPacked !== undefined) {
        // Aliased write: same 4 bytes, viewed as either u32 or f32.
        new Uint32Array(data.buffer, data.byteOffset + (base + 10) * 4, 1)[0] = colorPacked;
    } else if (prev) {
        data[base + 10] = prev[10]!;
    }
    data[base + 11] = 0;
}

function markDirty(layer: Sprite2DLayer, lo: number, hi: number): void {
    if (layer._dirtyMin >= layer._dirtyMax) {
        layer._dirtyMin = lo;
        layer._dirtyMax = hi;
    } else {
        if (lo < layer._dirtyMin) {
            layer._dirtyMin = lo;
        }
        if (hi > layer._dirtyMax) {
            layer._dirtyMax = hi;
        }
    }
    layer._version = (layer._version + 1) | 0;
}

/** Add one sprite. Returns its index. Grows capacity as needed. */
export function addSprite2DIndex(layer: Sprite2DLayer, init: Sprite2DInit): number {
    if (init.positionPx === undefined) {
        throw new Error("addSprite2DIndex: init.positionPx is required.");
    }
    const idx = layer.count;
    if (idx >= layer._capacity) {
        growCapacity(layer, idx + 1);
    }
    const base = idx * INSTANCE_FLOATS_PER_SPRITE;
    writeInstance(layer, base, init, null);
    layer.count++;
    markDirty(layer, idx, idx + 1);
    return idx;
}

/** Patch one sprite. Unspecified fields are preserved. */
export function updateSprite2DIndex(layer: Sprite2DLayer, index: number, patch: Partial<Sprite2DInit>): void {
    if (index < 0 || index >= layer.count) {
        throw new Error(`updateSprite2DIndex: index ${index} out of range [0, ${layer.count})`);
    }
    const base = index * INSTANCE_FLOATS_PER_SPRITE;
    const prev = layer._instanceData.subarray(base, base + INSTANCE_FLOATS_PER_SPRITE);
    const merged: Sprite2DInit = {
        positionPx: patch.positionPx ?? [prev[0]!, prev[1]!],
        sizePx: patch.sizePx,
        frame: patch.frame,
        rotation: patch.rotation,
        pivot: patch.pivot,
        color: patch.color,
        flipX: patch.flipX,
        flipY: patch.flipY,
        visible: patch.visible,
    };
    writeInstance(layer, base, merged, prev);
    markDirty(layer, index, index + 1);
}

/** Swap-remove a sprite. The last sprite (if any) takes its slot. */
export function removeSprite2DIndex(layer: Sprite2DLayer, index: number): void {
    if (index < 0 || index >= layer.count) {
        throw new Error(`removeSprite2DIndex: index ${index} out of range [0, ${layer.count})`);
    }
    const last = layer.count - 1;
    if (index !== last) {
        layer._instanceData.copyWithin(index * INSTANCE_FLOATS_PER_SPRITE, last * INSTANCE_FLOATS_PER_SPRITE, (last + 1) * INSTANCE_FLOATS_PER_SPRITE);
        markDirty(layer, index, index + 1);
    } else {
        markDirty(layer, index, index + 1);
    }
    layer.count--;
}

/** Update only the frame UVs for one sprite. */
export function setSprite2DFrameIndex(layer: Sprite2DLayer, index: number, frame: SpriteFrameRef): void {
    if (index < 0 || index >= layer.count) {
        throw new Error(`setSprite2DFrameIndex: index ${index} out of range [0, ${layer.count})`);
    }
    const frameIdx = resolveSpriteFrame(layer.atlas, frame);
    const f = layer.atlas.frames[frameIdx]!;
    const base = index * INSTANCE_FLOATS_PER_SPRITE;
    layer._instanceData[base + 4] = f.uvMin[0];
    layer._instanceData[base + 5] = f.uvMin[1];
    layer._instanceData[base + 6] = f.uvMax[0];
    layer._instanceData[base + 7] = f.uvMax[1];
    markDirty(layer, index, index + 1);
}
