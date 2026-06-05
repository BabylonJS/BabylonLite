// Shared contract for a per-layer-kind renderer. Each Lottie layer type (shape, image,
// and later text/solid/precomp) is handled by one of these. The player owns the generic
// frame pass and walks layers in z-order, dispatching each to the renderer for its kind.
//
// This is the gating seam: a renderer module is dynamically imported (and thus bundled)
// ONLY when the animation actually contains layers of its kind. See feature-detect.ts.

import type { Mat2D } from "./matrix.js";
import type { ParsedLayer } from "./parse.js";

export interface LayerRenderContext {
    /** Current comp frame. */
    frame: number;
    /** Swapchain backing-store size in pixels. */
    screenW: number;
    screenH: number;
}

/**
 * A renderer for one Lottie layer kind. Lifecycle per frame:
 *   beginFrame() → emitLayer()* (in z-order) → flush() → recordLayer()* (in z-order).
 * `emitLayer` accumulates CPU-side geometry and returns an opaque token; `flush` uploads
 * GPU buffers once; `recordLayer` records that layer's draws into the shared pass.
 */
export interface LayerRenderer {
    /** Lottie layer `ty` this renderer handles. */
    readonly kind: number;
    /** Reset per-frame accumulation. */
    beginFrame(ctx: LayerRenderContext): void;
    /**
     * Accumulate one layer's draws. `world` is the global projection × the layer transform.
     * Returns an opaque token to pass back to `recordLayer`, or `-1` if nothing was emitted.
     */
    emitLayer(layer: ParsedLayer, world: Mat2D, layerAlpha: number, ctx: LayerRenderContext): number;
    /** Upload all accumulated GPU buffers for the frame (called once after all emits). */
    flush(ctx: LayerRenderContext): void;
    /** Record the draws for a previously-emitted layer token into the shared render pass. */
    recordLayer(pass: GPURenderPassEncoder, token: number): void;
    dispose(): void;
}
