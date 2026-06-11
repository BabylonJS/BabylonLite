import type { EngineContext } from "./engine.js";
import type { Screenshot } from "./screenshot.js";
import { BU, TU } from "./gpu-flags.js";

/** @internal Per-frame readback hook driven by `renderFrame` once `captureScreenshot` has
 *  lazily loaded this module and installed it on `engine._captureService`. Records the
 *  swapchain copy for any queued capture requests into the frame's encoder. */
export type CaptureService = (engine: EngineContext, encoder: GPUCommandEncoder) => void;

/** @internal Pre-acquire hook driven by `renderFrame` (installed alongside `_captureService`).
 *  Called before the frame's swapchain texture is acquired; reconfigures the swapchain with
 *  COPY_SRC the first time a capture is queued. */
export type CapturePreFrame = (engine: EngineContext) => void;

/** A single readback in flight: the buffer the frame's copy lands in, plus the dimensions /
 *  padding needed to unpack it, and the requests waiting on this frame. */
interface PendingReadback {
    buffer: GPUBuffer;
    width: number;
    height: number;
    bytesPerRow: number;
    bgra: boolean;
    reqs: ReadonlyArray<{ resolve: (s: Screenshot) => void; reject: (e: unknown) => void }>;
}

/** copyTextureToBuffer requires the per-row stride to be a multiple of 256 bytes. */
function alignBytesPerRow(width: number): number {
    return Math.ceil((width * 4) / 256) * 256;
}

/** Pre-acquire hook. Called by `renderFrame` BEFORE `_refreshScRT` acquires this frame's
 *  swapchain texture. On the first queued capture it reconfigures the swapchain with COPY_SRC
 *  so the just-acquired texture is copyable. Reconfiguring here (not after the scene has
 *  recorded) is mandatory: `configure()` expires the current canvas texture, so doing it
 *  mid-frame would invalidate the recorded texture and fail the submit. */
function preFrame(engine: EngineContext): void {
    const queue = engine._captureQueue;
    if (!queue || queue.length === 0 || engine._swapchainCopySrc) {
        return;
    }
    engine._swapchainCopySrc = true;
    engine._context.configure({ device: engine._device, format: engine.format, alphaMode: engine._alphaMode, usage: TU.RENDER_ATTACHMENT | TU.COPY_SRC });
}

/** The readback hook. Called once per frame after the contexts have recorded (so the swapchain
 *  texture holds this frame) and before the encoder is finished.
 *
 *  By the time this runs the swapchain is already COPY_SRC-capable: `preFrame` reconfigured it
 *  before the frame's texture was acquired, so the copy can be recorded straight into this
 *  frame's encoder. */
function service(engine: EngineContext, encoder: GPUCommandEncoder): void {
    const queue = engine._captureQueue;
    if (!queue || queue.length === 0) {
        return;
    }
    // The swapchain only becomes copyable once `preFrame` has reconfigured it and `renderFrame`
    // has acquired a COPY_SRC texture; until then there is nothing copyable, so wait for the next
    // frame (the request stays queued).
    if (!engine._swapchainCopySrc) {
        return;
    }

    engine._captureQueue = undefined;

    const tex = engine.scRT._colorTexture;
    if (!tex) {
        const err = new Error("captureScreenshot: no swapchain texture available");
        for (const r of queue) {
            r.reject(err);
        }
        return;
    }

    const width = engine.scRT._width;
    const height = engine.scRT._height;
    const bytesPerRow = alignBytesPerRow(width);
    const buffer = engine._device.createBuffer({
        label: "screenshot-readback",
        size: bytesPerRow * height,
        usage: BU.COPY_DST | BU.MAP_READ,
    });
    encoder.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow, rowsPerImage: height }, { width, height, depthOrArrayLayers: 1 });
    void finish({ buffer, width, height, bytesPerRow, bgra: engine.format.startsWith("bgra"), reqs: queue });
}

/** Maps the staging buffer after submit, unpacks it into tightly-packed opaque RGBA8, and
 *  resolves the waiting requests. Fire-and-forget: the map is async and resolves later. */
async function finish(pend: PendingReadback): Promise<void> {
    const { buffer, width, height, bytesPerRow, bgra, reqs } = pend;
    try {
        // Yield one microtask so `renderFrame` submits this frame's encoder (which holds the copy)
        // BEFORE we map the buffer: mapAsync moves the buffer to a pending-map state synchronously,
        // and a buffer pending map cannot be used by a command buffer in a submit — calling it before
        // the submit would invalidate the whole frame and read back an empty (all-black) buffer.
        await Promise.resolve();
        await buffer.mapAsync(GPUMapMode.READ);
        const src = new Uint8Array(buffer.getMappedRange());
        const out = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            const srcRow = y * bytesPerRow;
            const dstRow = y * width * 4;
            for (let x = 0; x < width; x++) {
                const s = srcRow + x * 4;
                const d = dstRow + x * 4;
                if (bgra) {
                    out[d] = src[s + 2]!;
                    out[d + 1] = src[s + 1]!;
                    out[d + 2] = src[s]!;
                } else {
                    out[d] = src[s]!;
                    out[d + 1] = src[s + 1]!;
                    out[d + 2] = src[s + 2]!;
                }
                out[d + 3] = 255;
            }
        }
        buffer.unmap();
        buffer.destroy();
        const shot: Screenshot = { width, height, data: out };
        for (const r of reqs) {
            r.resolve(shot);
        }
    } catch (e) {
        try {
            buffer.destroy();
        } catch {
            /* already destroyed */
        }
        for (const r of reqs) {
            r.reject(e);
        }
    }
}

/** @internal Factory invoked by `captureScreenshot` after this module is dynamically imported.
 *  Returns the per-frame readback hook installed on `engine._captureService`. */
export function createCaptureService(): CaptureService {
    return service;
}

/** @internal Factory invoked by `captureScreenshot` after this module is dynamically imported.
 *  Returns the pre-acquire hook installed on `engine._capturePreFrame`. */
export function createCapturePreFrame(): CapturePreFrame {
    return preFrame;
}
