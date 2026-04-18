/**
 * pickSprite2D — CPU sprite picker for Scene2DContext.
 *
 * Walks layers in reverse `order`, then sprites in reverse `(layerZ, insertion)`,
 * skipping `!visible` and `!pickable`. Inverse-transforms the screen point through
 * the layer view (pan/zoom/rotation) and the per-sprite rotation about its pivot,
 * then tests against the pivot-aware local rectangle.
 */

import type { Scene2DContext, Scene2DContextInternal } from "../../scene2d/scene2d.js";
import type { Sprite2DLayer } from "../sprite-2d.js";
import { SPRITE_2D_STRIDE } from "../sprite-2d.js";

export interface SpritePickInfo {
    layerOrSystem: Sprite2DLayer;
    spriteIndex: number;
    uv: [number, number];
    screenPx: [number, number];
}

function inverseRotate(p: [number, number], angle: number): [number, number] {
    const s = Math.sin(-angle);
    const c = Math.cos(-angle);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

export function pickSprite2D(scene: Scene2DContext, xPx: number, yPx: number): SpritePickInfo | null {
    const ctx = scene as Scene2DContextInternal;
    const layers = ctx.layers.slice().sort((a, b) => b.order - a.order);
    for (const layer of layers) {
        if (!layer.visible || layer._storage.count === 0) {
            continue;
        }
        // Inverse layer view: undo translate-by-viewPosition, scale by 1/zoom, rotate by -viewRotation, translate back.
        const view = layer.view;
        const invZoom = view.zoom !== 0 ? 1 / view.zoom : 1;
        const dx = xPx - view.positionPx[0];
        const dy = yPx - view.positionPx[1];
        const unrotated = inverseRotate([dx, dy], view.rotation);
        const layerLocal: [number, number] = [unrotated[0] * invZoom + view.positionPx[0], unrotated[1] * invZoom + view.positionPx[1]];

        const data = layer._storage.data;
        // Walk sprites by descending (layerZ, insertion).
        const order = new Array<number>(layer._storage.count);
        for (let i = 0; i < order.length; i++) {
            order[i] = i;
        }
        order.sort((a, b) => {
            const za = data[a * SPRITE_2D_STRIDE + 16]!;
            const zb = data[b * SPRITE_2D_STRIDE + 16]!;
            if (za !== zb) {
                return zb - za;
            }
            return b - a;
        });

        for (const i of order) {
            const meta = layer._meta[i]!;
            if (!meta.visible || !meta.pickable) {
                continue;
            }
            const off = i * SPRITE_2D_STRIDE;
            const px = data[off + 0]!;
            const py = data[off + 1]!;
            const sx = meta.sizePx[0];
            const sy = meta.sizePx[1];
            if (sx <= 0 || sy <= 0) {
                continue;
            }
            // Inverse sprite rotation around pivot (which is at sprite position).
            const lx = layerLocal[0] - px;
            const ly = layerLocal[1] - py;
            const local = inverseRotate([lx, ly], meta.rotation);
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
            };
        }
    }
    return null;
}
