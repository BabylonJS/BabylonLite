import type { WebGLContext } from "./webgl-context.js";
import { type GLEffect, useEffect } from "./webgl-effect.js";

export interface GLEffectWrapperOptions {
    name: string;
    effect: GLEffect;
}

/** Thin pairing of a named alias with its `GLEffect`. The wrapper has no
 *  GPU lifetime — disposing it does NOT dispose the underlying effect.
 *  (Matches Babylon `EffectWrapper` ownership semantics.) */
export interface GLEffectWrapper {
    readonly name: string;
    readonly effect: GLEffect;
}

export function createEffectWrapper(opts: GLEffectWrapperOptions): GLEffectWrapper {
    return { name: opts.name, effect: opts.effect };
}

/** Wrapper disposal is a no-op for now — kept for API parity and future use. */
export function disposeEffectWrapper(_ctx: WebGLContext, _wrapper: GLEffectWrapper): void {
    /* intentional no-op — the underlying GLEffect's lifetime is the caller's responsibility */
}

export interface GLViewport {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Cached `gl.viewport`. Defaults to the full canvas in pixel coordinates. */
export function setViewport(ctx: WebGLContext, viewport?: GLViewport): void {
    if (ctx._isLost || ctx._disposed) {
        return;
    }
    const x = viewport?.x ?? 0;
    const y = viewport?.y ?? 0;
    const w = viewport?.w ?? ctx.canvas.width;
    const h = viewport?.h ?? ctx.canvas.height;
    const s = ctx._state;
    if (s.viewportX === x && s.viewportY === y && s.viewportW === w && s.viewportH === h) {
        return;
    }
    s.viewportX = x;
    s.viewportY = y;
    s.viewportW = w;
    s.viewportH = h;
    ctx.gl.viewport(x, y, w, h);
}

/** Make `wrapper.effect` current and ensure the shared fullscreen quad VAO
 *  is bound. This MUST be called BEFORE any `setEffect*` call for the same
 *  effect in the current frame (uniform setters write to the currently bound
 *  program). */
export function applyEffectWrapper(ctx: WebGLContext, wrapper: GLEffectWrapper): void {
    if (ctx._isLost || ctx._disposed) {
        return;
    }
    ensureQuad(ctx);
    useEffect(ctx, wrapper.effect);
}

/** `gl.drawElements(TRIANGLES, 6, UNSIGNED_SHORT, 0)`. No-op when the
 *  context is lost or there is no current program. */
export function drawEffect(ctx: WebGLContext): void {
    if (ctx._isLost || ctx._disposed) {
        return;
    }
    if (ctx._state.currentProgram === null) {
        return;
    }
    ctx.gl.drawElements(ctx.gl.TRIANGLES, 6, ctx.gl.UNSIGNED_SHORT, 0);
}

/** Lazy fullscreen quad. Built on first call; thereafter the VAO is cached on
 *  `_state.quadVao` and rebinding is a single cached call. Cleared by
 *  `webglcontextlost` and transparently rebuilt by the next
 *  `applyEffectWrapper` after restore.
 *
 *  Position attribute is enabled at location 0 — every effect's
 *  `createEffect` calls `gl.bindAttribLocation(program, 0, attributeNames[0])`
 *  BEFORE link, so the shared VAO is correct across all programs. */
function ensureQuad(ctx: WebGLContext): void {
    const s = ctx._state;
    const gl = ctx.gl;
    if (s.quadVao !== null) {
        if (s.boundVao !== s.quadVao) {
            gl.bindVertexArray(s.quadVao);
            s.boundVao = s.quadVao;
        }
        return;
    }
    const vao = gl.createVertexArray();
    if (vao === null) {
        throw new Error("thin-gl: gl.createVertexArray returned null");
    }
    s.quadVao = vao;
    gl.bindVertexArray(vao);
    s.boundVao = vao;

    const vbo = gl.createBuffer();
    if (vbo === null) {
        throw new Error("thin-gl: gl.createBuffer returned null (VBO)");
    }
    s.quadVbo = vbo;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    s.boundArrayBuffer = vbo;
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_POSITIONS, gl.STATIC_DRAW);

    const ibo = gl.createBuffer();
    if (ibo === null) {
        throw new Error("thin-gl: gl.createBuffer returned null (IBO)");
    }
    s.quadIbo = ibo;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    s.boundElementBuffer = ibo;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, QUAD_INDICES, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

/** Typed-array literal — pure per bundler convention. Matches Babylon's
 *  `EffectRenderer` default geometry exactly. */
const QUAD_POSITIONS = new Float32Array([1, 1, -1, 1, -1, -1, 1, -1]);
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);
