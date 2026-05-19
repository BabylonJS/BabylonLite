import { type WebGLContext } from "./webgl-context.js";

/** Register a per-frame callback. **No-op if `fn` is already registered**
 *  (matches Babylon `AbstractEngine.runRenderLoop`). Starts the rAF if this is
 *  the first registration. */
export function runRenderLoop(ctx: WebGLContext, fn: (dt: number) => void): void {
    if (ctx._disposed) {
        return;
    }
    // Install the resume hook on the context (no module-level side effects).
    if (ctx._scheduleFrame === null) {
        ctx._scheduleFrame = scheduleFrame;
    }
    if (ctx._loops.indexOf(fn) !== -1) {
        return;
    }
    ctx._loops.push(fn);
    if (ctx._rafId === 0 && !ctx._isLost) {
        scheduleFrame(ctx);
    }
}

/** Stop one (or all when omitted) registered callbacks. Cancels the rAF if
 *  no callbacks remain. */
export function stopRenderLoop(ctx: WebGLContext, fn?: (dt: number) => void): void {
    if (fn === undefined) {
        ctx._loops.length = 0;
    } else {
        const i = ctx._loops.indexOf(fn);
        if (i !== -1) {
            ctx._loops.splice(i, 1);
        }
    }
    if (ctx._loops.length === 0 && ctx._rafId !== 0) {
        cancelAnimationFrame(ctx._rafId);
        ctx._rafId = 0;
    }
}

function scheduleFrame(ctx: WebGLContext): void {
    ctx._prevNow = performance.now();
    ctx._rafId = requestAnimationFrame((now) => tick(ctx, now));
}

function tick(ctx: WebGLContext, now: number): void {
    ctx._rafId = 0;
    if (ctx._disposed || ctx._isLost || ctx._loops.length === 0) {
        return;
    }
    const dt = now - ctx._prevNow;
    ctx._prevNow = now;
    // Snapshot — a callback may call stopRenderLoop on itself or others.
    const loops = ctx._loops.slice();
    for (const cb of loops) {
        try {
            cb(dt);
        } catch (err) {
            console.error("thin-gl: render loop callback threw", err);
        }
    }
    if (ctx._loops.length > 0 && !ctx._disposed && !ctx._isLost) {
        ctx._rafId = requestAnimationFrame((nextNow) => tick(ctx, nextNow));
    }
}
