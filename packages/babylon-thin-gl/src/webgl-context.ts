import type { GLEffect } from "./webgl-effect.js";
import type { GLTexture } from "./webgl-texture.js";
import { createGLState, resetGLState, type GLState } from "./webgl-state.js";

/** Constructor options forwarded to `canvas.getContext('webgl2', …)`. */
export interface WebGLContextOptions {
    /** Default: true. */
    alpha?: boolean;
    /** Default: true. */
    premultipliedAlpha?: boolean;
    /** Default: false. */
    antialias?: boolean;
    /** Default: false. */
    preserveDrawingBuffer?: boolean;
    /** Default: false — disabled for fullscreen-quad workloads. */
    depth?: boolean;
    /** Default: false. */
    stencil?: boolean;
    /** Default: "default". */
    powerPreference?: WebGLPowerPreference;
    /** Default: false. */
    failIfMajorPerformanceCaveat?: boolean;
}

export interface WebGLContextCaps {
    readonly maxTextureSize: number;
    readonly maxTextureUnits: number;
    readonly parallelShaderCompile: { COMPLETION_STATUS_KHR: number } | null;
}

/**
 * Pure-state handle for a WebGL2 canvas + its cached GL state.
 *
 * INVARIANT: consumers MUST NOT mutate GL state directly through `ctx.gl`.
 * Doing so silently corrupts the cache in `_state`. The package owns every
 * GL call. (`ctx.gl` is exposed only so downstream code that already has the
 * pattern of poking `engine._gl.getExtension(...)` can do that, but must NOT
 * call `bindTexture`/`useProgram`/`bindBuffer`/`viewport`/etc.)
 */
export interface WebGLContext {
    readonly canvas: HTMLCanvasElement;
    readonly gl: WebGL2RenderingContext;
    readonly caps: WebGLContextCaps;
    /** Hardware-scaling-level — drawingBufferWidth = clientWidth * dpr / _hsl. */
    _hsl: number;
    /** rAF id when a render loop is active, 0 otherwise. */
    _rafId: number;
    /** Per-frame callbacks. `runRenderLoop` is a no-op if `fn` is already
     *  registered (matches Babylon `AbstractEngine.runRenderLoop`). */
    _loops: ((dt: number) => void)[];
    /** Timestamp of last frame for delta computation. */
    _prevNow: number;
    /** Cached GL state. See §4 of 28-thin-gl.md. */
    _state: GLState;
    /** Live effect registry — populated by `createEffect`, removed by
     *  `disposeEffect`. Used by the context-restored protocol to rebuild
     *  programs. */
    _effects: GLEffect[];
    /** Live texture registry — populated by `createRawTexture` /
     *  `loadTexture2D` / `createHtmlElementTexture`. Used by the
     *  context-restored protocol to replay uploads. */
    _textures: GLTexture[];
    _onLost: (() => void)[];
    _onRestored: (() => void)[];
    /** True between `webglcontextlost` and `webglcontextrestored`. While
     *  true, every `setEffect*` / `bindTexture` / `drawEffect` is a no-op. */
    _isLost: boolean;
    /** True once the context has been disposed; subsequent calls become no-ops. */
    _disposed: boolean;
    /** DOM handlers — retained so dispose can `removeEventListener` them. */
    _lostHandler: (e: Event) => void;
    _restoredHandler: () => void;
    /** True when a render loop was active at the moment of `webglcontextlost`,
     *  so we can resume it from the restored handler. */
    _wasLoopActive: boolean;
    /** Installed by `runRenderLoop` on first call. Lets the context-restored
     *  handler resume a loop without a circular runtime import from render-loop.
     *  Null if the render-loop module is tree-shaken out. */
    _scheduleFrame: ((ctx: WebGLContext) => void) | null;
}

/** Acquire a WebGL2 context on the canvas and build the pure-state handle.
 *  Throws if WebGL2 is unsupported. */
export function createWebGLContext(canvas: HTMLCanvasElement, options?: WebGLContextOptions): WebGLContext {
    const o = options ?? {};
    const attrs: WebGLContextAttributes = {
        alpha: o.alpha ?? true,
        premultipliedAlpha: o.premultipliedAlpha ?? true,
        antialias: o.antialias ?? false,
        preserveDrawingBuffer: o.preserveDrawingBuffer ?? false,
        depth: o.depth ?? false,
        stencil: o.stencil ?? false,
        powerPreference: o.powerPreference ?? "default",
        failIfMajorPerformanceCaveat: o.failIfMajorPerformanceCaveat ?? false,
    };
    const gl = canvas.getContext("webgl2", attrs);
    if (gl === null) {
        throw new Error("thin-gl: WebGL2 is not supported on this canvas");
    }

    const parallelExt = gl.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
    const caps: WebGLContextCaps = {
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        maxTextureUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number,
        parallelShaderCompile: parallelExt,
    };

    const ctx: WebGLContext = {
        canvas,
        gl,
        caps,
        _hsl: 1,
        _rafId: 0,
        _loops: [],
        _prevNow: 0,
        _state: createGLState(caps.maxTextureUnits),
        _effects: [],
        _textures: [],
        _onLost: [],
        _onRestored: [],
        _isLost: false,
        _disposed: false,
        _lostHandler: () => {},
        _restoredHandler: () => {},
        _wasLoopActive: false,
        _scheduleFrame: null,
    };

    ctx._lostHandler = (e: Event) => handleContextLost(ctx, e);
    ctx._restoredHandler = () => handleContextRestored(ctx);
    canvas.addEventListener("webglcontextlost", ctx._lostHandler as EventListener, false);
    canvas.addEventListener("webglcontextrestored", ctx._restoredHandler, false);

    return ctx;
}

/** Stops the render loop, removes DOM listeners, releases all known effects
 *  and textures, then marks the context disposed. The browser-owned canvas
 *  is left intact. */
export function disposeWebGLContext(ctx: WebGLContext): void {
    if (ctx._disposed) {
        return;
    }
    ctx._disposed = true;
    if (ctx._rafId !== 0) {
        cancelAnimationFrame(ctx._rafId);
        ctx._rafId = 0;
    }
    ctx._loops.length = 0;
    ctx.canvas.removeEventListener("webglcontextlost", ctx._lostHandler as EventListener, false);
    ctx.canvas.removeEventListener("webglcontextrestored", ctx._restoredHandler, false);

    const gl = ctx.gl;
    // Iterate snapshots — the dispose paths splice into the registries.
    const effects = ctx._effects.slice();
    for (const eff of effects) {
        if (!eff._disposed) {
            eff._disposed = true;
            eff.isReady = false;
            gl.deleteProgram(eff.program);
            gl.deleteShader(eff._vs);
            gl.deleteShader(eff._fs);
        }
    }
    ctx._effects.length = 0;
    const textures = ctx._textures.slice();
    for (const tex of textures) {
        if (!tex._disposed) {
            tex._disposed = true;
            gl.deleteTexture(tex.handle);
        }
    }
    ctx._textures.length = 0;

    resetGLState(ctx._state);
    ctx._onLost.length = 0;
    ctx._onRestored.length = 0;
}

/** Match drawing-buffer size to (clientSize × devicePixelRatio / _hsl). No-op
 *  if size already matches. Never touches viewport — `setViewport` owns that. */
export function resizeWebGLContext(ctx: WebGLContext): void {
    if (ctx._disposed || ctx._isLost) {
        return;
    }
    const canvas = ctx.canvas;
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    const w = Math.max(1, Math.floor((canvas.clientWidth * dpr) / ctx._hsl));
    const h = Math.max(1, Math.floor((canvas.clientHeight * dpr) / ctx._hsl));
    if (canvas.width !== w) {
        canvas.width = w;
    }
    if (canvas.height !== h) {
        canvas.height = h;
    }
}

export function getRenderWidth(ctx: WebGLContext): number {
    return ctx.canvas.width;
}

export function getRenderHeight(ctx: WebGLContext): number {
    return ctx.canvas.height;
}

export function getHardwareScalingLevel(ctx: WebGLContext): number {
    return ctx._hsl;
}

/** Updates the hardware-scaling factor and triggers a resize. */
export function setHardwareScalingLevel(ctx: WebGLContext, level: number): void {
    if (level <= 0 || !isFinite(level)) {
        return;
    }
    ctx._hsl = level;
    resizeWebGLContext(ctx);
}

export function getRenderingCanvas(ctx: WebGLContext): HTMLCanvasElement {
    return ctx.canvas;
}

export function onWebGLContextLost(ctx: WebGLContext, cb: () => void): void {
    if (ctx._onLost.indexOf(cb) === -1) {
        ctx._onLost.push(cb);
    }
}

export function offWebGLContextLost(ctx: WebGLContext, cb: () => void): void {
    const i = ctx._onLost.indexOf(cb);
    if (i !== -1) {
        ctx._onLost.splice(i, 1);
    }
}

export function onWebGLContextRestored(ctx: WebGLContext, cb: () => void): void {
    if (ctx._onRestored.indexOf(cb) === -1) {
        ctx._onRestored.push(cb);
    }
}

export function offWebGLContextRestored(ctx: WebGLContext, cb: () => void): void {
    const i = ctx._onRestored.indexOf(cb);
    if (i !== -1) {
        ctx._onRestored.splice(i, 1);
    }
}

/* ─────────────────────────  internal: loss / restore  ───────────────────── */

function handleContextLost(ctx: WebGLContext, e: Event): void {
    // Opt-in to restore. Without preventDefault() the browser will NOT fire
    // webglcontextrestored later.
    e.preventDefault();
    if (ctx._isLost || ctx._disposed) {
        return;
    }
    ctx._isLost = true;
    ctx._wasLoopActive = ctx._rafId !== 0;
    if (ctx._rafId !== 0) {
        cancelAnimationFrame(ctx._rafId);
        ctx._rafId = 0;
    }
    resetGLState(ctx._state);
    for (const eff of ctx._effects) {
        eff.isReady = false;
        eff._samplersAssigned = false;
        eff.uniformLocations = {};
        eff.attributeLocations = {};
        // Clear value caches so the first frame after restore re-uploads
        // every uniform into the freshly-linked program.
        clearObject(eff._lastF1);
        clearObject(eff._lastVec);
        clearObject(eff._lastI1);
        // Do NOT gl.deleteProgram — handle is already dead per WebGL spec.
    }
    for (const tex of ctx._textures) {
        tex._wasReady = tex.isReady;
        tex.isReady = false;
    }
    const cbs = ctx._onLost.slice();
    for (const cb of cbs) {
        try {
            cb();
        } catch (err) {
            console.error("thin-gl: onLost callback threw", err);
        }
    }
}

function handleContextRestored(ctx: WebGLContext): void {
    if (ctx._disposed) {
        return;
    }
    for (const eff of ctx._effects) {
        if (!eff._disposed) {
            eff._restore(ctx);
        }
    }
    for (const tex of ctx._textures) {
        if (!tex._disposed) {
            const newHandle = ctx.gl.createTexture();
            if (newHandle !== null) {
                tex.handle = newHandle;
                tex._upload(ctx);
                tex.isReady = tex._wasReady;
            }
        }
    }
    ctx._isLost = false;
    if (ctx._wasLoopActive && ctx._loops.length > 0 && ctx._scheduleFrame !== null) {
        ctx._scheduleFrame(ctx);
    }
    const cbs = ctx._onRestored.slice();
    for (const cb of cbs) {
        try {
            cb();
        } catch (err) {
            console.error("thin-gl: onRestored callback threw", err);
        }
    }
}

function clearObject(o: { [k: string]: unknown }): void {
    for (const key in o) {
        delete o[key];
    }
}
