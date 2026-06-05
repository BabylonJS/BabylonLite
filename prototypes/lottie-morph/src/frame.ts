// Generic per-frame render pass: owns the shared MSAA color + depth/stencil targets and
// the begin/clear/end/resolve lifecycle. Both the vector (stencil-then-cover) and image
// renderers record into the single pass this opens, so layers composite in correct z-order
// with one clear and one MSAA resolve per frame.

import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine.js";

/** Depth+stencil format. The vector renderer needs stencil; image layers ignore it. */
export const DEPTH_STENCIL_FORMAT: GPUTextureFormat = "depth24plus-stencil8";

export interface FrameTargets {
    msaaColor: GPUTexture | null;
    msaaColorView: GPUTextureView | null;
    depthStencil: GPUTexture | null;
    depthStencilView: GPUTextureView | null;
    w: number;
    h: number;
}

export function createFrameTargets(): FrameTargets {
    return { msaaColor: null, msaaColorView: null, depthStencil: null, depthStencilView: null, w: 0, h: 0 };
}

/** (Re)allocate the MSAA color + depth/stencil textures when the canvas size changes. */
export function ensureFrameTargets(engine: EngineContext, t: FrameTargets, w: number, h: number): void {
    if (t.w === w && t.h === h && t.msaaColor && t.depthStencil) {
        return;
    }
    t.msaaColor?.destroy();
    t.depthStencil?.destroy();
    const device = engine._device;
    const sampleCount = engine.msaaSamples;
    t.msaaColor = device.createTexture({
        size: { width: w, height: h },
        format: engine.format,
        sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    t.msaaColorView = t.msaaColor.createView();
    t.depthStencil = device.createTexture({
        size: { width: w, height: h },
        format: DEPTH_STENCIL_FORMAT,
        sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    t.depthStencilView = t.depthStencil.createView();
    t.w = w;
    t.h = h;
}

export interface FramePass {
    encoder: GPUCommandEncoder;
    pass: GPURenderPassEncoder;
}

/** A clip rectangle in framebuffer pixels (the comp bounds). */
export interface ScissorRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Open a render pass that clears to transparent, resolving MSAA into `swapView`.
 *  When `scissor` is given, drawing is clipped to it (the Lottie comp bounds — content
 *  outside the comp is not drawn, matching how lottie-web clips to the composition). */
export function beginFrame(engine: EngineContext, t: FrameTargets, swapView: GPUTextureView, scissor?: ScissorRect): FramePass {
    const encoder = engine._device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: t.msaaColorView!,
                resolveTarget: swapView,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: "clear",
                storeOp: "store",
            },
        ],
        depthStencilAttachment: {
            view: t.depthStencilView!,
            depthClearValue: 1,
            depthLoadOp: "clear",
            depthStoreOp: "discard",
            stencilClearValue: 0,
            stencilLoadOp: "clear",
            stencilStoreOp: "discard",
        },
    });
    if (scissor) {
        pass.setScissorRect(scissor.x, scissor.y, scissor.width, scissor.height);
    }
    return { encoder, pass };
}

export function endFrame(engine: EngineContext, fp: FramePass): void {
    fp.pass.end();
    engine._device.queue.submit([fp.encoder.finish()]);
}
