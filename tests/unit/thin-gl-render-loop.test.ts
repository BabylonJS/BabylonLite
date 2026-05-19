import { describe, expect, it, beforeAll } from "vitest";
import { createWebGLContext, runRenderLoop, stopRenderLoop } from "../../packages/babylon-thin-gl/src/index";
import { createMockCanvas, createMockGL } from "./_thin-gl-mock";

beforeAll(() => {
    // Node has no rAF — stub it to a deterministic no-op. runRenderLoop calls
    // requestAnimationFrame to schedule the first frame; the dedupe-shape tests
    // never advance the frame, so a no-op is enough.
    const g = globalThis as { requestAnimationFrame?: (cb: FrameRequestCallback) => number; cancelAnimationFrame?: (h: number) => void };
    if (g.requestAnimationFrame === undefined) {
        g.requestAnimationFrame = () => 1;
    }
    if (g.cancelAnimationFrame === undefined) {
        g.cancelAnimationFrame = () => undefined;
    }
});

describe("thin-gl render loop", () => {
    it("runRenderLoop dedupes — registering the same fn twice fires it once per frame", () => {
        const mock = createMockGL();
        const canvas = createMockCanvas(mock);
        const ctx = createWebGLContext(canvas);
        const cb = () => undefined;
        runRenderLoop(ctx, cb);
        runRenderLoop(ctx, cb);
        runRenderLoop(ctx, cb);
        expect(ctx._loops.length).toBe(1);
    });

    it("stopRenderLoop() with no arg removes all loops", () => {
        const mock = createMockGL();
        const canvas = createMockCanvas(mock);
        const ctx = createWebGLContext(canvas);
        runRenderLoop(ctx, () => undefined);
        runRenderLoop(ctx, () => undefined);
        expect(ctx._loops.length).toBe(2);
        stopRenderLoop(ctx);
        expect(ctx._loops.length).toBe(0);
    });

    it("stopRenderLoop(fn) only removes the matching callback", () => {
        const mock = createMockGL();
        const canvas = createMockCanvas(mock);
        const ctx = createWebGLContext(canvas);
        const a = () => undefined;
        const b = () => undefined;
        runRenderLoop(ctx, a);
        runRenderLoop(ctx, b);
        stopRenderLoop(ctx, a);
        expect(ctx._loops.length).toBe(1);
        expect(ctx._loops[0]).toBe(b);
    });
});
