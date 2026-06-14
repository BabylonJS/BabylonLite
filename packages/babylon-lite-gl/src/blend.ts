/**
 * Blend-mode state — the WebGL counterpart of Babylon's `Engine.setAlphaMode`
 * (presets) and `AlphaState.setAlphaBlendFunctionParameters` /
 * `setAlphaEquationParameters` (the arbitrary separate func + equation path).
 *
 * The numeric {@link GLBlendMode} values intentionally match Babylon's
 * `Constants.ALPHA_*` (`ALPHA_DISABLE = 0`, `ALPHA_ADD = 1`, `ALPHA_COMBINE = 2`,
 * `ALPHA_PREMULTIPLIED = 7`) so a consumer can forward raw Babylon constants
 * without a translation table.
 *
 * Both {@link setBlendMode} and {@link setBlendState} resolve to the same
 * granular blend cache in `GLState`, so the preset and arbitrary paths can never
 * desync — switching between them only emits the GL calls that actually change.
 */
import { type GLEngineContext } from "./context.js";

/**
 * Supported blend presets. Values mirror Babylon's `Constants.ALPHA_*` so the
 * raw Babylon integers can be passed straight through.
 */
export const GLBlendMode = {
    /** No blending — `gl.disable(gl.BLEND)`. (`Constants.ALPHA_DISABLE`) */
    DISABLE: 0,
    /** Additive — `blendFuncSeparate(SRC_ALPHA, ONE, ZERO, ONE)`. (`Constants.ALPHA_ADD`) */
    ADD: 1,
    /** Standard (non-premultiplied) alpha — `blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE)`. (`Constants.ALPHA_COMBINE`) */
    ALPHA: 2,
    /** Premultiplied alpha — `blendFuncSeparate(ONE, ONE_MINUS_SRC_ALPHA, ONE, ONE)`. (`Constants.ALPHA_PREMULTIPLIED`) */
    PREMULTIPLIED: 7,
} as const;

/** One of the {@link GLBlendMode} preset values (`0`, `1`, `2` or `7`). */
export type GLBlendMode = (typeof GLBlendMode)[keyof typeof GLBlendMode];

/**
 * Blend equation presets — the values WebGL2 accepts for
 * `gl.blendEquationSeparate`. Numeric values equal the GL enums so raw GL
 * integers (or Babylon's identical `Constants.GL_ALPHA_EQUATION_*`) pass
 * straight through.
 */
export const GLBlendEquation = {
    /** `src + dst` (the GL default). */
    ADD: 0x8006,
    /** `src - dst`. */
    SUBTRACT: 0x800a,
    /** `dst - src`. */
    REVERSE_SUBTRACT: 0x800b,
    /** `min(src, dst)`. */
    MIN: 0x8007,
    /** `max(src, dst)`. */
    MAX: 0x8008,
} as const;

/** One of the {@link GLBlendEquation} preset values. */
export type GLBlendEquation = (typeof GLBlendEquation)[keyof typeof GLBlendEquation];

/**
 * Arbitrary separate-channel blend configuration — the lite-gl equivalent of
 * Babylon's `AlphaState.setAlphaBlendFunctionParameters` +
 * `setAlphaEquationParameters`. All factor / equation fields are raw WebGL2
 * enums (`gl.ONE`, `gl.SRC_ALPHA`, `gl.MIN`, …); use {@link GLBlendEquation} for
 * the equations if you prefer named presets.
 */
export interface GLBlendState {
    /** RGB source factor (`gl.blendFuncSeparate` arg 1). */
    srcRGB: GLenum;
    /** RGB destination factor (`gl.blendFuncSeparate` arg 2). */
    dstRGB: GLenum;
    /** Alpha source factor (`gl.blendFuncSeparate` arg 3). */
    srcAlpha: GLenum;
    /** Alpha destination factor (`gl.blendFuncSeparate` arg 4). */
    dstAlpha: GLenum;
    /** RGB blend equation. Defaults to `FUNC_ADD`. */
    equationRGB?: GLenum;
    /** Alpha blend equation. Defaults to `FUNC_ADD`. */
    equationAlpha?: GLenum;
}

/** GL `FUNC_ADD` — the implicit equation used by the {@link GLBlendMode}
 *  presets (matching Babylon's `setAlphaMode`, which leaves it at the default). */
const FUNC_ADD = 0x8006;

/**
 * Set the GL blend state to match Babylon's `setAlphaMode(mode)` exactly.
 *
 * | Mode               | `gl.blendFuncSeparate(srcRGB, dstRGB, srcA, dstA)`          |
 * |--------------------|------------------------------------------------------------|
 * | `DISABLE` (0)      | — (`gl.disable(gl.BLEND)`)                                  |
 * | `ADD` (1)          | `SRC_ALPHA, ONE, ZERO, ONE`                                 |
 * | `ALPHA` (2)        | `SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE`                  |
 * | `PREMULTIPLIED` (7)| `ONE, ONE_MINUS_SRC_ALPHA, ONE, ONE`                        |
 *
 * No-op when the context is lost or disposed.
 *
 * @param engine - The engine whose GL blend state is updated.
 * @param mode - The {@link GLBlendMode} preset to apply.
 */
export function setBlendMode(engine: GLEngineContext, mode: GLBlendMode): void {
    if (engine._isLost || engine._disposed) {
        return;
    }
    const gl = engine.gl;
    switch (mode) {
        case GLBlendMode.DISABLE:
            disableBlend(engine);
            return;
        case GLBlendMode.ADD:
            applyBlend(engine, gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE, FUNC_ADD, FUNC_ADD);
            return;
        case GLBlendMode.ALPHA:
            applyBlend(engine, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE, FUNC_ADD, FUNC_ADD);
            return;
        case GLBlendMode.PREMULTIPLIED:
            applyBlend(engine, gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE, FUNC_ADD, FUNC_ADD);
            return;
    }
}

/**
 * Enable blending with an arbitrary separate-channel function and equation —
 * the lite-gl equivalent of Babylon's `AlphaState` with
 * `setAlphaBlendFunctionParameters` + `setAlphaEquationParameters`.
 *
 * Supports every WebGL2 blend equation, including `MIN`, `MAX`,
 * `FUNC_SUBTRACT` and `FUNC_REVERSE_SUBTRACT` (used by ShapeBuilder's darken /
 * cutout blend modes). The result is cached: a redundant call with the same
 * parameters is fully elided, and switching only the func (not the equation) or
 * vice-versa re-issues just the call that changed — mirroring Babylon's
 * `AlphaState` dirty-flag behaviour. The disabled→enabled transition always
 * re-issues both `blendEquationSeparate` and `blendFuncSeparate`.
 *
 * No-op when the context is lost or disposed.
 *
 * @param engine - The engine whose GL blend state is updated.
 * @param state - The separate-channel blend factors + equations to apply.
 */
export function setBlendState(engine: GLEngineContext, state: GLBlendState): void {
    if (engine._isLost || engine._disposed) {
        return;
    }
    applyBlend(engine, state.srcRGB, state.dstRGB, state.srcAlpha, state.dstAlpha, state.equationRGB ?? FUNC_ADD, state.equationAlpha ?? FUNC_ADD);
}

/**
 * Disable blending (`gl.disable(gl.BLEND)`), the equivalent of Babylon's
 * `AlphaState.alphaBlend = false`. Cached — repeated calls after the first are
 * elided. No-op when the context is lost or disposed.
 *
 * @param engine - The engine whose GL blend state is updated.
 */
export function disableBlend(engine: GLEngineContext): void {
    if (engine._isLost || engine._disposed) {
        return;
    }
    const s = engine._state;
    if (s.blendEnabled === 0) {
        return;
    }
    s.blendEnabled = 0;
    engine.gl.disable(engine.gl.BLEND);
}

/* ────────────────────────────  internal apply  ──────────────────────────── */

/** Apply a granular blend config through the cache. On the disabled/unset →
 *  enabled transition, force-issues both equation and func (Babylon's
 *  `AlphaState` does not track them while blending is off). Once enabled, the
 *  equation and func are elided independently when unchanged. */
function applyBlend(engine: GLEngineContext, srcRGB: number, dstRGB: number, srcAlpha: number, dstAlpha: number, eqRGB: number, eqAlpha: number): void {
    const s = engine._state;
    const gl = engine.gl;
    if (s.blendEnabled !== 1) {
        s.blendEnabled = 1;
        gl.enable(gl.BLEND);
        gl.blendEquationSeparate(eqRGB, eqAlpha);
        s.blendEqRGB = eqRGB;
        s.blendEqAlpha = eqAlpha;
        gl.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);
        s.blendSrcRGB = srcRGB;
        s.blendDstRGB = dstRGB;
        s.blendSrcAlpha = srcAlpha;
        s.blendDstAlpha = dstAlpha;
        return;
    }
    if (s.blendEqRGB !== eqRGB || s.blendEqAlpha !== eqAlpha) {
        gl.blendEquationSeparate(eqRGB, eqAlpha);
        s.blendEqRGB = eqRGB;
        s.blendEqAlpha = eqAlpha;
    }
    if (s.blendSrcRGB !== srcRGB || s.blendDstRGB !== dstRGB || s.blendSrcAlpha !== srcAlpha || s.blendDstAlpha !== dstAlpha) {
        gl.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);
        s.blendSrcRGB = srcRGB;
        s.blendDstRGB = dstRGB;
        s.blendSrcAlpha = srcAlpha;
        s.blendDstAlpha = dstAlpha;
    }
}
