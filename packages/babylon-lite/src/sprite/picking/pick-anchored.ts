/**
 * pickAnchoredSprite — CPU sprite picker for AnchoredSpriteLayers in a 3D scene.
 *
 * For each `visible && pickable` sprite (walked in reverse insertion order across
 * reverse-order layers):
 *   1. project the world anchor through `viewProjection`
 *   2. perspective divide → NDC → pixels (screen-space pivot)
 *   3. add `offsetPx`
 *   4. inverse-rotate the screen point into sprite-local space
 *   5. test against the pivot-aware rectangle
 *
 * Skips sprites whose anchor is behind the near plane (clip.w ≤ 0).
 *
 * Tree-shakable: imported only when the application calls `pickAnchoredSprite`.
 */

import type { SceneContext } from "../../scene/scene.js";
import type { AnchoredSpriteLayer } from "../sprite-anchored.js";
import { SPRITE_ANCHORED_STRIDE } from "../sprite-anchored.js";
import { getViewProjectionMatrix } from "../../camera/camera.js";

export interface SpritePickInfo {
    layerOrSystem: AnchoredSpriteLayer;
    spriteIndex: number;
    uv: [number, number];
    screenPx: [number, number];
    worldPosition?: [number, number, number];
}

function inverseRotate(p: [number, number], angle: number): [number, number] {
    const s = Math.sin(-angle);
    const c = Math.cos(-angle);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

/**
 * Pick the topmost anchored sprite under the given canvas pixel.
 * Returns null when no sprite covers the cursor or the scene has no camera.
 */
export function pickAnchoredSprite(scene: SceneContext, xPx: number, yPx: number): SpritePickInfo | null {
    const cam = scene.camera;
    if (!cam) {
        return null;
    }
    const canvas = scene.engine.canvas;
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) {
        return null;
    }
    const aspect = w / h;
    const vp = getViewProjectionMatrix(cam, aspect) as unknown as Float32Array;

    // Collect every anchored layer in the scene (reverse order = topmost first).
    const layers: AnchoredSpriteLayer[] = [];
    // The scene exposes `meshes` and `lights` directly; sprite layers live only inside
    // the scene's deferred builder closures. To find them at pick time we walk the
    // global `_renderables` set (already populated at this point) and reverse-derive
    // via a side-channel — but that requires the layer to register itself somewhere
    // visible. The simplest correct path is to scan the scene's `_disposables` host
    // for layers, but we don't store layers on the scene. So we expose layers
    // through a per-scene weak registry (added below).
    const reg = (scene as unknown as { _anchoredLayers?: AnchoredSpriteLayer[] })._anchoredLayers;
    if (reg) {
        for (let i = reg.length - 1; i >= 0; i--) {
            layers.push(reg[i]!);
        }
    }
    // Sort by descending order so higher `order` layers win.
    layers.sort((a, b) => b.order - a.order);

    for (const layer of layers) {
        if (!layer.visible || layer._storage.count === 0) {
            continue;
        }
        const data = layer._storage.data;
        // Reverse insertion order (top of the same layer wins).
        for (let i = layer._storage.count - 1; i >= 0; i--) {
            const meta = layer._meta[i]!;
            if (!meta.visible || !meta.pickable) {
                continue;
            }
            const off = i * SPRITE_ANCHORED_STRIDE;
            const wx = data[off + 0]!;
            const wy = data[off + 1]!;
            const wz = data[off + 2]!;
            // Project anchor (column-major mat4 × vec4).
            const cx = vp[0]! * wx + vp[4]! * wy + vp[8]! * wz + vp[12]!;
            const cy = vp[1]! * wx + vp[5]! * wy + vp[9]! * wz + vp[13]!;
            // const cz = vp[2]! * wx + vp[6]! * wy + vp[10]! * wz + vp[14]!;  // unused for pick
            const cw = vp[3]! * wx + vp[7]! * wy + vp[11]! * wz + vp[15]!;
            if (cw <= 0) {
                continue;
            }
            const ndcX = cx / cw;
            const ndcY = cy / cw;
            // NDC → canvas pixels (Y flipped, matching the vertex shader).
            const pivotPx: [number, number] = [(ndcX * 0.5 + 0.5) * w, (1 - (ndcY * 0.5 + 0.5)) * h];
            const sx = meta.sizePx[0];
            const sy = meta.sizePx[1];
            if (sx <= 0 || sy <= 0) {
                continue;
            }
            // Inverse-rotate the cursor into sprite-local space (about the projected pivot
            // plus the pixel offset baked into the slot).
            const dx = xPx - pivotPx[0] - meta.offsetPx[0];
            const dy = yPx - pivotPx[1] - meta.offsetPx[1];
            const local = inverseRotate([dx, dy], meta.rotation);
            const minX = -meta.pivot[0] * sx;
            const maxX = (1 - meta.pivot[0]) * sx;
            const minY = -meta.pivot[1] * sy;
            const maxY = (1 - meta.pivot[1]) * sy;
            if (local[0] < minX || local[0] > maxX || local[1] < minY || local[1] > maxY) {
                continue;
            }
            const u = (local[0] - minX) / sx;
            const v = (local[1] - minY) / sy;
            return {
                layerOrSystem: layer,
                spriteIndex: i,
                uv: [u, v],
                screenPx: [xPx, yPx],
                worldPosition: [wx, wy, wz],
            };
        }
    }
    return null;
}
