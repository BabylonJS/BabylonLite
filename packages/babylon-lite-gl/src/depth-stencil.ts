/**
 * Depth, stencil, color-mask and clear state — the lite-gl counterpart of
 * Babylon's `_depthCullingState` / `_stencilState` / `setColorWrite` / `clear`.
 *
 * Unlike Babylon, which buffers these in dirty-flag state objects and flushes
 * them in `applyStates()` before each draw, lite-gl applies each on the setter
 * call and caches the result in `GLState`, eliding redundant GL calls. Every
 * field is independently cached, so a setter that changes only one sub-state
 * (e.g. just the stencil op triple) issues only that GL call.
 *
 * All setters are no-ops on a lost/disposed context.
 */
import type { GLEngineContext } from "./context.js";

/** GL `gl.DEPTH_TEST`. */
const DEPTH_TEST = 0x0b71;
/** GL `gl.CULL_FACE`. */
const CULL_FACE = 0x0b44;
/** GL `gl.STENCIL_TEST`. */
const STENCIL_TEST = 0x0b90;
/** GL clear bits. */
const COLOR_BUFFER_BIT = 0x4000;
const DEPTH_BUFFER_BIT = 0x0100;
const STENCIL_BUFFER_BIT = 0x0400;

/** Depth-buffer configuration for {@link setDepthState}. Omitted fields are
 *  left unchanged. */
export interface GLDepthState {
    /** Enable/disable the depth test (`gl.enable/disable(DEPTH_TEST)`). */
    test?: boolean;
    /** Enable/disable depth writes (`gl.depthMask`). */
    write?: boolean;
    /** Depth comparison function (`gl.depthFunc`), e.g. `gl.LESS`. */
    func?: GLenum;
}

/** Stencil configuration for {@link setStencilState}. Omitted fields are left
 *  unchanged. The `func`/`ref`/`funcMask` triple and the
 *  `opFail`/`opZFail`/`opZPass` triple are each applied as a unit (any member
 *  present re-issues that GL call, merging the unspecified members from cache). */
export interface GLStencilState {
    /** Enable/disable the stencil test (`gl.enable/disable(STENCIL_TEST)`). */
    test?: boolean;
    /** Stencil write mask (`gl.stencilMask`). */
    mask?: number;
    /** Comparison function (`gl.stencilFunc` arg 1), e.g. `gl.ALWAYS`. */
    func?: GLenum;
    /** Reference value (`gl.stencilFunc` arg 2). */
    ref?: number;
    /** Comparison mask (`gl.stencilFunc` arg 3). */
    funcMask?: number;
    /** Op when the stencil test fails (`gl.stencilOp` arg 1). */
    opFail?: GLenum;
    /** Op when the stencil test passes but depth fails (`gl.stencilOp` arg 2). */
    opZFail?: GLenum;
    /** Op when both stencil and depth pass (`gl.stencilOp` arg 3). */
    opZPass?: GLenum;
}

/** Options for {@link clearEngine}. */
export interface GLClearOptions {
    /** When set, clears the color buffer to this RGBA color (alpha default 1). */
    color?: { r: number; g: number; b: number; a?: number };
    /** Clear the depth buffer (respects the current depth write mask). */
    depth?: boolean;
    /** Clear the stencil buffer (respects the current stencil write mask). */
    stencil?: boolean;
}

/**
 * Apply depth-buffer state (test enable, write mask, comparison function),
 * cached per field. The lite-gl equivalent of mutating Babylon's
 * `engine.depthCullingState.{depthTest,depthMask,depthFunc}`.
 *
 * @param engine - The engine.
 * @param state - The depth fields to change. Omitted fields are untouched.
 */
export function setDepthState(engine: GLEngineContext, state: GLDepthState): void {
    if (engine._isLost || engine._disposed) {
        return;
    }
    const gl = engine.gl;
    const s = engine._state;
    if (state.test !== undefined) {
        const v = state.test ? 1 : 0;
        if (s.depthTest !== v) {
            s.depthTest = v;
            if (v === 1) {
                gl.enable(DEPTH_TEST);
            } else {
                gl.disable(DEPTH_TEST);
            }
        }
    }
    if (state.write !== undefined) {
        const v = state.write ? 1 : 0;
        if (s.depthMask !== v) {
            s.depthMask = v;
            gl.depthMask(state.write);
        }
    }
    if (state.func !== undefined && s.depthFunc !== state.func) {
        s.depthFunc = state.func;
        gl.depthFunc(state.func);
    }
}

/**
 * Enable/disable face culling and (optionally) set the cull face — the lite-gl
 * equivalent of `engine.depthCullingState.cull` + `cullFace`.
 *
 * @param engine - The engine.
 * @param enabled - Enable (`true`) or disable (`false`) `gl.CULL_FACE`.
 * @param face - Optional cull face (`gl.BACK` / `gl.FRONT` / `gl.FRONT_AND_BACK`).
 */
export function setCullState(engine: GLEngineContext, enabled: boolean, face?: GLenum): void {
    if (engine._isLost || engine._disposed) {
        return;
    }
    const gl = engine.gl;
    const s = engine._state;
    const v = enabled ? 1 : 0;
    if (s.cullEnabled !== v) {
        s.cullEnabled = v;
        if (v === 1) {
            gl.enable(CULL_FACE);
        } else {
            gl.disable(CULL_FACE);
        }
    }
    if (face !== undefined && s.cullFace !== face) {
        s.cullFace = face;
        gl.cullFace(face);
    }
}

/**
 * Apply stencil state (test enable, write mask, comparison func triple, op
 * triple), cached per sub-state. The lite-gl equivalent of mutating Babylon's
 * `engine.stencilState.*`.
 *
 * @param engine - The engine.
 * @param state - The stencil fields to change. Omitted fields are untouched.
 */
export function setStencilState(engine: GLEngineContext, state: GLStencilState): void {
    if (engine._isLost || engine._disposed) {
        return;
    }
    const gl = engine.gl;
    const s = engine._state;
    if (state.test !== undefined) {
        const v = state.test ? 1 : 0;
        if (s.stencilTest !== v) {
            s.stencilTest = v;
            if (v === 1) {
                gl.enable(STENCIL_TEST);
            } else {
                gl.disable(STENCIL_TEST);
            }
        }
    }
    if (state.mask !== undefined && s.stencilMask !== state.mask) {
        s.stencilMask = state.mask;
        gl.stencilMask(state.mask);
    }
    if (state.func !== undefined || state.ref !== undefined || state.funcMask !== undefined) {
        const func = state.func ?? s.stencilFuncFunc;
        const ref = state.ref ?? s.stencilFuncRef;
        const funcMask = state.funcMask ?? s.stencilFuncMask;
        if (s.stencilFuncFunc !== func || s.stencilFuncRef !== ref || s.stencilFuncMask !== funcMask) {
            s.stencilFuncFunc = func;
            s.stencilFuncRef = ref;
            s.stencilFuncMask = funcMask;
            gl.stencilFunc(func, ref, funcMask);
        }
    }
    if (state.opFail !== undefined || state.opZFail !== undefined || state.opZPass !== undefined) {
        const fail = state.opFail ?? s.stencilOpFail;
        const zFail = state.opZFail ?? s.stencilOpZFail;
        const zPass = state.opZPass ?? s.stencilOpZPass;
        if (s.stencilOpFail !== fail || s.stencilOpZFail !== zFail || s.stencilOpZPass !== zPass) {
            s.stencilOpFail = fail;
            s.stencilOpZFail = zFail;
            s.stencilOpZPass = zPass;
            gl.stencilOp(fail, zFail, zPass);
        }
    }
}

/**
 * Set the color write mask (`gl.colorMask`), cached — the lite-gl equivalent of
 * Babylon's `setColorWrite` (which passes the same flag to all four channels).
 *
 * @param engine - The engine.
 * @param r - Write red.
 * @param g - Write green.
 * @param b - Write blue.
 * @param a - Write alpha.
 */
export function setColorMask(engine: GLEngineContext, r: boolean, g: boolean, b: boolean, a: boolean): void {
    if (engine._isLost || engine._disposed) {
        return;
    }
    const packed = (r ? 8 : 0) | (g ? 4 : 0) | (b ? 2 : 0) | (a ? 1 : 0);
    const s = engine._state;
    if (s.colorMask === packed) {
        return;
    }
    s.colorMask = packed;
    engine.gl.colorMask(r, g, b, a);
}

/**
 * Clear the currently-bound framebuffer's color / depth / stencil buffers — the
 * lite-gl equivalent of Babylon's `clear(color, backBuffer, depth, stencil)`.
 * Depth/stencil clears respect the current write masks (set them first via
 * {@link setDepthState} / {@link setStencilState}). No-op when nothing is
 * requested or the context is lost/disposed.
 *
 * @param engine - The engine.
 * @param options - Which buffers to clear (and the color value).
 */
export function clearEngine(engine: GLEngineContext, options: GLClearOptions): void {
    if (engine._isLost || engine._disposed) {
        return;
    }
    const gl = engine.gl;
    let mask = 0;
    if (options.color !== undefined) {
        const c = options.color;
        gl.clearColor(c.r, c.g, c.b, c.a ?? 1);
        mask |= COLOR_BUFFER_BIT;
    }
    if (options.depth === true) {
        mask |= DEPTH_BUFFER_BIT;
    }
    if (options.stencil === true) {
        mask |= STENCIL_BUFFER_BIT;
    }
    if (mask !== 0) {
        gl.clear(mask);
    }
}
