/** Sprite2DHandle — observable, parentable handle for a 2D sprite (Family 1).
 *
 *  Implements `IParentable2D` + `IWorldMatrix2DProvider` so handles can be
 *  parented to other Sprite2D handles (Spine-style 2D skeletal). When parented,
 *  the renderable resolves the world Mat3 lazily and writes pos/sin-cos/scaled-size
 *  into the slot's flat buffer per frame.
 *
 *  Scale lives on the handle (not the flat buffer) — most sprites have scale (1,1).
 *  When parented OR unparented, the world Mat3 is composed from local pos+rot+scale
 *  and the renderable extracts pos/rot/scale from it. */

import { mat3Compose, type Mat3 } from "../math/mat3.js";
import { ObservableVec2 } from "../math/observable-vec2.js";
import { ObservableVec4 } from "../math/observable-vec4.js";
import type { IParentable2D, IWorldMatrix2DProvider } from "../scene/parentable-2d.js";
import { createWorldMatrix2DState } from "../scene/world-matrix-2d-state.js";
import { resolveSpriteFrame, type SpriteFrameRef } from "./shared/sprite-atlas.js";
import { markDirty } from "./shared/sprite-gpu.js";
import { walkParentedSprite2DHandles } from "./sprite-2d-handle-walk.js";
import {
    SPRITE_2D_STRIDE,
    addSprite2DIndex,
    removeSprite2DIndex,
    setSprite2DFrameIndex,
    updateSprite2DIndex,
    _removeSprite2DHandleId,
    type IParentedSprite2DHandle,
    type Sprite2DInit,
    type Sprite2DLayer,
} from "./sprite-2d.js";

export interface Sprite2DHandle extends IParentable2D, IWorldMatrix2DProvider, IParentedSprite2DHandle {
    readonly id: number;
    readonly _layer: Sprite2DLayer;
    /** Position in pixels (layer-space when un-parented; local when parented). */
    readonly position: ObservableVec2;
    readonly sizePx: ObservableVec2;
    readonly pivot: ObservableVec2;
    readonly scale: ObservableVec2;
    readonly color: ObservableVec4;
    rotation: number;
    frame: number;
    visible: boolean;
    pickable: boolean;
    layerZ: number;
}

export function addSprite2D(layer: Sprite2DLayer, init: Sprite2DInit): Sprite2DHandle {
    if (layer._idToIndex === null) {
        layer._idToIndex = new Map();
        layer._indexToId = new Uint32Array(layer._storage.capacity);
    }
    const idx = addSprite2DIndex(layer, init);
    if (layer._indexToId!.length < layer._storage.capacity) {
        const grown = new Uint32Array(layer._storage.capacity);
        grown.set(layer._indexToId!);
        layer._indexToId = grown;
    }
    const id = layer._nextHandleId++;
    layer._idToIndex.set(id, idx);
    layer._indexToId![idx] = id;

    let _rotation = init.rotation ?? 0;
    let _frame = resolveSpriteFrame(layer.atlas, init.frame ?? 0);
    let _visible = init.visible !== false;
    let _pickable = init.pickable !== false;
    let _layerZ = init.layer ?? 0;

    // Generic per-floats writers — used only when handle is unparented. When
    // parented, the renderable computes pos/rot/scaled-size from the world Mat3
    // and we skip the flat-buffer writes here.
    const writePosition = (): void => {
        wm.markLocalDirty();
        if (wm.parent !== null) {
            return;
        }
        const i = layer._idToIndex!.get(handle.id);
        if (i === undefined) {
            return;
        }
        const off = i * SPRITE_2D_STRIDE;
        const d = layer._storage.data;
        d[off + 0] = handle.position.x;
        d[off + 1] = handle.position.y;
        markDirty(layer._storage, i, i + 1);
    };
    const writeSizePx = (): void => {
        // When parented, the renderable computes packed size from the world
        // Mat3 each frame — skip the flat-buffer write entirely (perf win).
        if (wm.parent !== null) {
            return;
        }
        const i = layer._idToIndex!.get(handle.id);
        if (i === undefined) {
            return;
        }
        const off = i * SPRITE_2D_STRIDE;
        const d = layer._storage.data;
        const sx = handle.scale.x;
        const sy = handle.scale.y;
        d[off + 2] = _visible ? handle.sizePx.x * sx : 0;
        d[off + 3] = _visible ? handle.sizePx.y * sy : 0;
        markDirty(layer._storage, i, i + 1);
    };
    const writePivot = (): void => {
        const i = layer._idToIndex!.get(handle.id);
        if (i === undefined) {
            return;
        }
        const off = i * SPRITE_2D_STRIDE;
        const d = layer._storage.data;
        d[off + 4] = handle.pivot.x;
        d[off + 5] = handle.pivot.y;
        markDirty(layer._storage, i, i + 1);
    };
    const writeScale = (): void => {
        wm.markLocalDirty();
        // Scale also affects packed size for un-parented handles.
        writeSizePx();
    };
    const writeColor = (): void => {
        const i = layer._idToIndex!.get(handle.id);
        if (i === undefined) {
            return;
        }
        const off = i * SPRITE_2D_STRIDE;
        const d = layer._storage.data;
        d[off + 12] = handle.color.x;
        d[off + 13] = handle.color.y;
        d[off + 14] = handle.color.z;
        d[off + 15] = handle.color.w;
        markDirty(layer._storage, i, i + 1);
    };

    const wm = createWorldMatrix2DState((): Mat3 => mat3Compose(handle.position.x, handle.position.y, _rotation, handle.scale.x, handle.scale.y));

    const sizeInit = init.sizePx ?? layer.atlas.frames[_frame]!.sourceSizePx;
    const pivotInit = init.pivot ?? layer.atlas.frames[_frame]!.pivot;
    const colorInit = init.color ?? [1, 1, 1, 1];

    const handle: Sprite2DHandle = {
        id,
        _layer: layer,
        position: new ObservableVec2(init.positionPx[0], init.positionPx[1], writePosition),
        sizePx: new ObservableVec2(sizeInit[0]!, sizeInit[1]!, writeSizePx),
        pivot: new ObservableVec2(pivotInit[0]!, pivotInit[1]!, writePivot),
        scale: new ObservableVec2(1, 1, writeScale),
        color: new ObservableVec4(colorInit[0]!, colorInit[1]!, colorInit[2]!, colorInit[3]!, writeColor),
        get rotation(): number {
            return _rotation;
        },
        set rotation(v: number) {
            _rotation = v;
            wm.markLocalDirty();
            if (wm.parent === null) {
                const i = layer._idToIndex!.get(handle.id);
                if (i !== undefined) {
                    updateSprite2DIndex(layer, i, { rotation: v });
                }
            }
        },
        get frame(): number {
            return _frame;
        },
        set frame(v: SpriteFrameRef) {
            const fi = resolveSpriteFrame(layer.atlas, v);
            _frame = fi;
            const i = layer._idToIndex!.get(handle.id);
            if (i !== undefined) {
                setSprite2DFrameIndex(layer, i, fi);
            }
        },
        get visible(): boolean {
            return _visible;
        },
        set visible(v: boolean) {
            _visible = v;
            writeSizePx();
        },
        get pickable(): boolean {
            return _pickable;
        },
        set pickable(v: boolean) {
            _pickable = v;
            const meta = layer._meta[layer._idToIndex!.get(handle.id)!];
            if (meta) {
                meta.pickable = v;
            }
        },
        get layerZ(): number {
            return _layerZ;
        },
        set layerZ(v: number) {
            _layerZ = Math.max(0, Math.min(1, v));
            const i = layer._idToIndex!.get(handle.id);
            if (i !== undefined) {
                const off = i * SPRITE_2D_STRIDE;
                layer._storage.data[off + 16] = _layerZ;
                markDirty(layer._storage, i, i + 1);
            }
        },
        get parent(): IWorldMatrix2DProvider | null {
            return wm.parent;
        },
        set parent(p: IWorldMatrix2DProvider | null) {
            const wasNull = wm.parent === null;
            wm.parent = p;
            wm.markLocalDirty();
            if (wasNull && p !== null) {
                if (layer._parentedHandles === null) {
                    layer._parentedHandles = new Set();
                    layer._parentedHandlesWalker = walkParentedSprite2DHandles;
                }
                layer._parentedHandles.add(handle);
            } else if (!wasNull && p === null) {
                layer._parentedHandles?.delete(handle);
                // Re-publish CPU local state into the flat buffer now that the
                // renderable will no longer override it each frame.
                writePosition();
                writeSizePx();
                const i = layer._idToIndex!.get(handle.id);
                if (i !== undefined) {
                    updateSprite2DIndex(layer, i, { rotation: _rotation });
                }
            }
        },
        get worldMatrix2D(): Mat3 {
            return wm.getWorldMatrix2D();
        },
        get worldMatrix2DVersion(): number {
            return wm.getWorldMatrix2DVersion();
        },
        // IParentedSprite2DHandle bridge fields read by the renderable when parented.
        get _localSizePx(): [number, number] {
            return [handle.sizePx.x, handle.sizePx.y];
        },
        get _localPivot(): [number, number] {
            return [handle.pivot.x, handle.pivot.y];
        },
        get _localVisible(): boolean {
            return _visible;
        },
    };
    return handle;
}

export function removeSprite2D(handle: Sprite2DHandle): void {
    const layer = handle._layer;
    const i = layer._idToIndex?.get(handle.id);
    if (i === undefined) {
        return;
    }
    layer._parentedHandles?.delete(handle);
    _removeSprite2DHandleId(layer, i);
    removeSprite2DIndex(layer, i);
}
