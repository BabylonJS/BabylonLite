import { describe, expect, it } from "vitest";

import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import { captureScreenshot } from "../../../packages/babylon-lite/src/engine/screenshot";
import { createCaptureService } from "../../../packages/babylon-lite/src/engine/screenshot-readback";

interface ConfigureCall {
    usage?: number;
}

interface Harness {
    engine: EngineContext;
    configureCalls: ConfigureCall[];
}

function makeHarness(): Harness {
    const configureCalls: ConfigureCall[] = [];
    const engine = {
        _device: {
            createBuffer: () => ({ destroy: () => undefined }) as unknown as GPUBuffer,
        } as unknown as GPUDevice,
        _context: {
            configure: (descriptor: GPUCanvasConfiguration) => configureCalls.push({ usage: descriptor.usage }),
        } as unknown as GPUCanvasContext,
        format: "bgra8unorm",
        _alphaMode: "opaque",
        scRT: { _colorTexture: {} as GPUTexture, _width: 4, _height: 4 },
    } as unknown as EngineContext;
    return { engine, configureCalls };
}

const encoder = { copyTextureToBuffer: () => undefined } as unknown as GPUCommandEncoder;

describe("screenshot swapchain COPY_SRC", () => {
    it("captureScreenshot queues a request without configuring the swapchain itself", () => {
        const { engine, configureCalls } = makeHarness();

        void captureScreenshot(engine);

        expect(engine._captureQueue).toHaveLength(1);
        expect(configureCalls).toHaveLength(0);
        expect(engine._swapchainCopySrc).toBeFalsy();
    });

    it("first serviced frame reconfigures with COPY_SRC and defers the copy", () => {
        const { engine, configureCalls } = makeHarness();
        engine._captureQueue = [{ resolve: () => undefined, reject: () => undefined }];
        const service = createCaptureService();

        service(engine, encoder);

        expect(engine._swapchainCopySrc).toBe(true);
        expect(configureCalls).toHaveLength(1);
        const usage = configureCalls[0]!.usage ?? 0;
        expect(usage & GPUTextureUsage.COPY_SRC).toBeTruthy();
        expect(usage & GPUTextureUsage.RENDER_ATTACHMENT).toBeTruthy();
        // Copy deferred — the request is still queued for the next frame.
        expect(engine._captureQueue).toHaveLength(1);
    });

    it("copies and clears the queue once the swapchain is already copyable", () => {
        const { engine } = makeHarness();
        engine._swapchainCopySrc = true;
        engine._captureQueue = [{ resolve: () => undefined, reject: () => undefined }];
        let copied = 0;
        const enc = { copyTextureToBuffer: () => copied++ } as unknown as GPUCommandEncoder;
        const service = createCaptureService();

        service(engine, enc);

        expect(copied).toBe(1);
        expect(engine._captureQueue).toBeUndefined();
    });

    it("never reconfigures again on later frames", () => {
        const { engine, configureCalls } = makeHarness();
        engine._swapchainCopySrc = true;
        engine._captureQueue = [{ resolve: () => undefined, reject: () => undefined }];
        const service = createCaptureService();

        service(engine, encoder);

        expect(configureCalls).toHaveLength(0);
    });
});
