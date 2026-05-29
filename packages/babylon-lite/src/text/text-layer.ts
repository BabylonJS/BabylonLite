/** TextLayer — a 2D pixel-space text placement driven by a `TextRenderer`.
 *
 *  Sibling to {@link TextRenderable} but scoped to a standalone `TextRenderer`
 *  (no scene / camera). Lays out a `TextData` at pixel coords on the canvas with
 *  optional uniform scale and z-axis rotation. Per-run color is reserved for a
 *  future addition to `GlyphRun`; the renderer currently emits white. A scalar
 *  `opacity` provides whole-layer fade. */

import type { TextData } from "./internal.js";

export interface TextLayerOptions {
    /** Top-left origin (in canvas pixels) for the layer's local coordinate frame. Default (0, 0). */
    readonly positionPx?: { readonly x: number; readonly y: number };
    /** Z-axis rotation about `positionPx`, in radians. Default 0. */
    readonly rotationRad?: number;
    /** Uniform scale applied to the laid-out text. Default 1. */
    readonly scale?: number;
    /** Sort order within a renderer (lower draws first). Default 0. */
    readonly order?: number;
    /** Alpha multiplier in [0, 1]. Default 1. */
    readonly opacity?: number;
    /** Default true. */
    readonly visible?: boolean;
}

/** Pure-data 2D text layer. Mutate fields directly between frames. */
export interface TextLayer {
    readonly _kind: "text-layer";
    readonly data: TextData;
    positionPx: { x: number; y: number };
    rotationRad: number;
    scale: number;
    order: number;
    opacity: number;
    visible: boolean;
    /** @internal Monotonic version bumped by helpers that mutate placement. */
    _version: number;
}

export function createTextLayer(data: TextData, options?: TextLayerOptions): TextLayer {
    return {
        _kind: "text-layer",
        data,
        positionPx: { x: options?.positionPx?.x ?? 0, y: options?.positionPx?.y ?? 0 },
        rotationRad: options?.rotationRad ?? 0,
        scale: options?.scale ?? 1,
        order: options?.order ?? 0,
        opacity: options?.opacity ?? 1,
        visible: options?.visible ?? true,
        _version: 0,
    };
}

/** Update the layer's pixel position. Convenience wrapper. */
export function setTextLayerPosition(layer: TextLayer, x: number, y: number): void {
    layer.positionPx.x = x;
    layer.positionPx.y = y;
    layer._version++;
}
