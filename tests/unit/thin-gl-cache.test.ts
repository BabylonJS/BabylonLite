import { describe, expect, it } from "vitest";
import {
    applyEffectWrapper,
    bindTexture,
    createEffect,
    createEffectWrapper,
    createRawTexture,
    createWebGLContext,
    disposeTexture,
    disposeWebGLContext,
    drawEffect,
    executeWhenCompiled,
    isEffectReady,
    setEffectFloat,
    setEffectFloat2,
    setEffectTexture,
    setViewport,
} from "../../packages/babylon-thin-gl/src/index";
import { createMockCanvas, createMockGL, fireLost, fireRestored } from "./_thin-gl-mock";

const VS = "#version 300 es\nin vec2 position;\nvoid main(){ gl_Position = vec4(position,0.0,1.0); }";
const FS = "#version 300 es\nprecision highp float;\nout vec4 glFragColor;\nvoid main(){ glFragColor = vec4(1.0); }";

function makeReadyEffect() {
    const mock = createMockGL();
    const canvas = createMockCanvas(mock);
    const ctx = createWebGLContext(canvas);
    mock.setParallelComplete(true);
    const effect = createEffect(ctx, {
        name: "test",
        vertexSource: VS,
        fragmentSource: FS,
        uniformNames: ["u_a", "u_b"],
        samplerNames: ["s0", "s1"],
    });
    // Drive finalization
    expect(isEffectReady(ctx, effect)).toBe(true);
    return { mock, canvas, ctx, effect };
}

describe("thin-gl cache: uniform setters", () => {
    it("setEffectFloat elides repeat calls with identical value", () => {
        const { mock, ctx, effect } = makeReadyEffect();
        mock.clear();
        setEffectFloat(ctx, effect, "u_a", 0.5);
        setEffectFloat(ctx, effect, "u_a", 0.5);
        setEffectFloat(ctx, effect, "u_a", 0.5);
        expect(mock.count("uniform1f")).toBe(1);
    });

    it("setEffectFloat re-uploads when value changes", () => {
        const { mock, ctx, effect } = makeReadyEffect();
        mock.clear();
        setEffectFloat(ctx, effect, "u_a", 0.5);
        setEffectFloat(ctx, effect, "u_a", 0.6);
        setEffectFloat(ctx, effect, "u_a", 0.5);
        expect(mock.count("uniform1f")).toBe(3);
    });

    it("setEffectFloat with NaN re-uploads every call (NaN !== NaN)", () => {
        const { mock, ctx, effect } = makeReadyEffect();
        mock.clear();
        setEffectFloat(ctx, effect, "u_a", Number.NaN);
        setEffectFloat(ctx, effect, "u_a", Number.NaN);
        expect(mock.count("uniform1f")).toBe(2);
    });

    it("setEffectFloat2 with 0.1 compares equal across frames (number[] not Float32Array)", () => {
        const { mock, ctx, effect } = makeReadyEffect();
        mock.clear();
        setEffectFloat2(ctx, effect, "u_a", 0.1, 0.2);
        setEffectFloat2(ctx, effect, "u_a", 0.1, 0.2);
        setEffectFloat2(ctx, effect, "u_a", 0.1, 0.2);
        expect(mock.count("uniform2f")).toBe(1);
    });

    it("setEffectFloat to an unknown uniform is a silent no-op", () => {
        const { mock, ctx, effect } = makeReadyEffect();
        mock.clear();
        setEffectFloat(ctx, effect, "__missing_x", 1.0);
        expect(mock.count("uniform1f")).toBe(0);
    });

    it("setEffectFloat before isReady is a no-op AND does NOT poison the cache", () => {
        const mock = createMockGL();
        mock.setParallelComplete(false);
        const canvas = createMockCanvas(mock);
        const ctx = createWebGLContext(canvas);
        const effect = createEffect(ctx, {
            name: "test",
            vertexSource: VS,
            fragmentSource: FS,
            uniformNames: ["u_a"],
            samplerNames: [],
        });
        // not ready yet
        setEffectFloat(ctx, effect, "u_a", 1.0);
        expect(mock.count("uniform1f")).toBe(0);
        // becomes ready
        mock.setParallelComplete(true);
        expect(isEffectReady(ctx, effect)).toBe(true);
        mock.clear();
        // The first real call after readiness MUST upload even with the same value
        setEffectFloat(ctx, effect, "u_a", 1.0);
        expect(mock.count("uniform1f")).toBe(1);
    });
});

describe("thin-gl cache: textures + samplers", () => {
    it("sampler uniforms assigned exactly once at finalization (not per setEffectTexture call)", () => {
        const { mock, ctx, effect } = makeReadyEffect();
        // After finalization, there should be exactly 2 uniform1i calls — one per sampler.
        expect(mock.count("uniform1i")).toBe(2);
        mock.clear();
        const tex = createRawTexture(ctx, new Uint8Array(4), 1, 1, ctx.gl.RGBA, ctx.gl.UNSIGNED_BYTE);
        // Repeated setEffectTexture calls must NEVER re-issue uniform1i
        for (let i = 0; i < 50; i++) {
            setEffectTexture(ctx, effect, "s0", tex);
        }
        expect(mock.count("uniform1i")).toBe(0);
    });

    it("bindTexture elides when same texture is already bound on the unit", () => {
        const { mock, ctx } = makeReadyEffect();
        const tex = createRawTexture(ctx, new Uint8Array(4), 1, 1, ctx.gl.RGBA, ctx.gl.UNSIGNED_BYTE);
        mock.clear();
        bindTexture(ctx, 0, tex);
        bindTexture(ctx, 0, tex);
        bindTexture(ctx, 0, tex);
        expect(mock.count("bindTexture")).toBe(0);
        expect(mock.count("activeTexture")).toBe(0);
    });

    it("bindTexture switches handle on same unit (no extra activeTexture)", () => {
        const { mock, ctx } = makeReadyEffect();
        const a = createRawTexture(ctx, new Uint8Array(4), 1, 1, ctx.gl.RGBA, ctx.gl.UNSIGNED_BYTE);
        const b = createRawTexture(ctx, new Uint8Array(4), 1, 1, ctx.gl.RGBA, ctx.gl.UNSIGNED_BYTE);
        // Park unit 0 on `a`
        bindTexture(ctx, 0, a);
        mock.clear();
        bindTexture(ctx, 0, b);
        expect(mock.count("bindTexture")).toBe(1);
        expect(mock.count("activeTexture")).toBe(0); // unit already 0
    });

    it("disposeTexture clears _state.boundTextures (next bind to same unit is NOT elided)", () => {
        const { mock, ctx } = makeReadyEffect();
        const a = createRawTexture(ctx, new Uint8Array(4), 1, 1, ctx.gl.RGBA, ctx.gl.UNSIGNED_BYTE);
        const b = createRawTexture(ctx, new Uint8Array(4), 1, 1, ctx.gl.RGBA, ctx.gl.UNSIGNED_BYTE);
        bindTexture(ctx, 0, a);
        disposeTexture(ctx, a);
        mock.clear();
        bindTexture(ctx, 0, b);
        expect(mock.count("bindTexture")).toBe(1);
    });
});

describe("thin-gl cache: program + viewport + quad", () => {
    it("setViewport elides identical rectangles", () => {
        const { mock, ctx } = makeReadyEffect();
        mock.clear();
        setViewport(ctx, { x: 0, y: 0, w: 64, h: 48 });
        setViewport(ctx, { x: 0, y: 0, w: 64, h: 48 });
        setViewport(ctx, { x: 0, y: 0, w: 64, h: 48 });
        expect(mock.count("viewport")).toBe(1);
    });

    it("applyEffectWrapper builds the quad exactly once", () => {
        const { mock, ctx, effect } = makeReadyEffect();
        const wrapper = createEffectWrapper({ name: "w", effect });
        mock.clear();
        applyEffectWrapper(ctx, wrapper);
        applyEffectWrapper(ctx, wrapper);
        applyEffectWrapper(ctx, wrapper);
        expect(mock.count("createVertexArray")).toBe(1);
        // Subsequent calls also do NOT re-issue useProgram (cached)
        expect(mock.count("useProgram")).toBe(0);
    });

    it("useProgram is cached — same program swap is a no-op", () => {
        const { mock, ctx, effect } = makeReadyEffect();
        const wrapper = createEffectWrapper({ name: "w", effect });
        applyEffectWrapper(ctx, wrapper);
        mock.clear();
        applyEffectWrapper(ctx, wrapper);
        expect(mock.count("useProgram")).toBe(0);
    });
});

describe("thin-gl: executeWhenCompiled", () => {
    it("fires synchronously when already ready", () => {
        const { ctx, effect } = makeReadyEffect();
        let fired = 0;
        executeWhenCompiled(ctx, effect, () => {
            fired++;
        });
        expect(fired).toBe(1);
    });

    it("fires exactly once on first transition to ready", () => {
        const mock = createMockGL();
        mock.setParallelComplete(false);
        const canvas = createMockCanvas(mock);
        const ctx = createWebGLContext(canvas);
        const effect = createEffect(ctx, {
            name: "test",
            vertexSource: VS,
            fragmentSource: FS,
            uniformNames: [],
            samplerNames: [],
        });
        let fired = 0;
        executeWhenCompiled(ctx, effect, () => {
            fired++;
        });
        // Not ready yet — callback queued, not fired
        expect(fired).toBe(0);
        // Still not ready after polling
        expect(isEffectReady(ctx, effect)).toBe(false);
        expect(fired).toBe(0);
        // Flip ready
        mock.setParallelComplete(true);
        expect(isEffectReady(ctx, effect)).toBe(true);
        expect(fired).toBe(1);
        // Subsequent polls don't re-fire
        expect(isEffectReady(ctx, effect)).toBe(true);
        expect(fired).toBe(1);
    });
});

describe("thin-gl: disposal", () => {
    it("disposeWebGLContext makes later setters no-ops without throwing", () => {
        const { mock, ctx, effect } = makeReadyEffect();
        disposeWebGLContext(ctx);
        mock.clear();
        expect(() => setEffectFloat(ctx, effect, "u_a", 1.0)).not.toThrow();
        expect(() => drawEffect(ctx)).not.toThrow();
        expect(mock.count("uniform1f")).toBe(0);
        expect(mock.count("drawElements")).toBe(0);
    });
});

describe("thin-gl: context loss / restore", () => {
    it("context lost → setters become no-ops and do not poison the cache", () => {
        const { mock, canvas, ctx, effect } = makeReadyEffect();
        // First, prove the value cache is poppulated.
        setEffectFloat(ctx, effect, "u_a", 0.5);
        mock.clear();
        fireLost(canvas);
        expect(ctx._isLost).toBe(true);
        setEffectFloat(ctx, effect, "u_a", 0.7);
        expect(mock.count("uniform1f")).toBe(0);
        // Effect should have been marked not-ready
        expect(effect.isReady).toBe(false);
    });

    it("context restored → quad VAO rebuilt and samplers re-bound exactly once each", () => {
        const { mock, canvas, ctx, effect } = makeReadyEffect();
        const wrapper = createEffectWrapper({ name: "w", effect });
        applyEffectWrapper(ctx, wrapper);
        const vaosBefore = mock.count("createVertexArray");
        fireLost(canvas);
        fireRestored(canvas);
        mock.clear();
        // Restart the cycle
        expect(isEffectReady(ctx, effect)).toBe(true);
        applyEffectWrapper(ctx, wrapper);
        const vaosAfter = vaosBefore + mock.count("createVertexArray");
        expect(vaosAfter).toBe(vaosBefore + 1); // exactly one new VAO
        // sampler1i should have been re-issued exactly once per declared sampler
        expect(mock.count("uniform1i")).toBe(2);
    });

    it("context restored → raw texture upload replayed via _upload closure", () => {
        const { mock, canvas, ctx } = makeReadyEffect();
        const tex = createRawTexture(ctx, new Uint8Array([255, 0, 0, 255]), 1, 1, ctx.gl.RGBA, ctx.gl.UNSIGNED_BYTE);
        const handleBefore = tex.handle;
        fireLost(canvas);
        mock.clear();
        fireRestored(canvas);
        // texImage2D should have been replayed
        expect(mock.count("texImage2D")).toBeGreaterThan(0);
        // The handle is a fresh WebGLTexture — same reference IS allowed if the
        // mock returns identical objects, but the new texture has been registered.
        expect(tex.handle).not.toBe(handleBefore);
        expect(tex.isReady).toBe(true);
    });
});
