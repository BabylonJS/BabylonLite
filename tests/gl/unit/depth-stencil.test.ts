import { describe, expect, it } from "vitest";
import { createGLEngine } from "../../../packages/babylon-lite-gl/src/context";
import { setDepthState, setCullState, setStencilState, setColorMask, clearEngine } from "../../../packages/babylon-lite-gl/src/depth-stencil";
import { createMockCanvas, createMockGL, fireLost, type MockCall, type MockGL } from "./_lite-gl-mock";

function makeEngine() {
    const mock = createMockGL();
    const canvas = createMockCanvas(mock);
    const engine = createGLEngine(canvas);
    return { mock, canvas, engine };
}

function callsNamed(mock: MockGL, name: string): MockCall[] {
    return mock.log.filter((c) => c.name === name);
}

describe("lite-gl depth state", () => {
    it("enables/disables DEPTH_TEST, sets mask + func, all cached", () => {
        const { mock, engine } = makeEngine();
        setDepthState(engine, { test: true, write: true, func: engine.gl.LESS });
        expect(callsNamed(mock, "enable").some((c) => c.args[0] === engine.gl.DEPTH_TEST)).toBe(true);
        expect(callsNamed(mock, "depthMask")[0]?.args).toEqual([true]);
        expect(callsNamed(mock, "depthFunc")[0]?.args).toEqual([engine.gl.LESS]);
        mock.clear();
        setDepthState(engine, { test: true, write: true, func: engine.gl.LESS });
        expect(callsNamed(mock, "enable")).toHaveLength(0);
        expect(callsNamed(mock, "depthMask")).toHaveLength(0);
        expect(callsNamed(mock, "depthFunc")).toHaveLength(0);
    });

    it("only re-issues the field that changed", () => {
        const { mock, engine } = makeEngine();
        setDepthState(engine, { test: true, write: true });
        mock.clear();
        setDepthState(engine, { write: false });
        expect(callsNamed(mock, "depthMask")[0]?.args).toEqual([false]);
        expect(callsNamed(mock, "enable")).toHaveLength(0);
        expect(callsNamed(mock, "disable")).toHaveLength(0);
    });

    it("omitted fields are untouched", () => {
        const { mock, engine } = makeEngine();
        setDepthState(engine, { func: engine.gl.LESS });
        expect(callsNamed(mock, "depthMask")).toHaveLength(0);
        expect(callsNamed(mock, "enable")).toHaveLength(0);
    });
});

describe("lite-gl cull state", () => {
    it("enables CULL_FACE + sets cullFace, cached", () => {
        const { mock, engine } = makeEngine();
        setCullState(engine, true, engine.gl.BACK);
        expect(callsNamed(mock, "enable").some((c) => c.args[0] === engine.gl.CULL_FACE)).toBe(true);
        expect(callsNamed(mock, "cullFace")[0]?.args).toEqual([engine.gl.BACK]);
        mock.clear();
        setCullState(engine, true, engine.gl.BACK);
        expect(callsNamed(mock, "enable")).toHaveLength(0);
        expect(callsNamed(mock, "cullFace")).toHaveLength(0);
    });
});

describe("lite-gl stencil state", () => {
    it("applies the func triple as a unit and caches it", () => {
        const { mock, engine } = makeEngine();
        setStencilState(engine, { test: true, mask: 0xff, func: engine.gl.ALWAYS, ref: 1, funcMask: 0xff });
        expect(callsNamed(mock, "enable").some((c) => c.args[0] === engine.gl.STENCIL_TEST)).toBe(true);
        expect(callsNamed(mock, "stencilMask")[0]?.args).toEqual([0xff]);
        expect(callsNamed(mock, "stencilFunc")[0]?.args).toEqual([engine.gl.ALWAYS, 1, 0xff]);
        mock.clear();
        setStencilState(engine, { func: engine.gl.ALWAYS, ref: 1, funcMask: 0xff });
        expect(callsNamed(mock, "stencilFunc")).toHaveLength(0);
    });

    it("applies the op triple independently of the func triple", () => {
        const { mock, engine } = makeEngine();
        setStencilState(engine, { opFail: engine.gl.INCR_WRAP, opZFail: engine.gl.INCR_WRAP, opZPass: engine.gl.INCR_WRAP });
        expect(callsNamed(mock, "stencilOp")[0]?.args).toEqual([engine.gl.INCR_WRAP, engine.gl.INCR_WRAP, engine.gl.INCR_WRAP]);
        expect(callsNamed(mock, "stencilFunc")).toHaveLength(0);
    });

    it("partial func update merges unspecified members from cache", () => {
        const { mock, engine } = makeEngine();
        setStencilState(engine, { func: engine.gl.ALWAYS, ref: 0, funcMask: 0x3 });
        mock.clear();
        setStencilState(engine, { func: engine.gl.NOTEQUAL });
        expect(callsNamed(mock, "stencilFunc")[0]?.args).toEqual([engine.gl.NOTEQUAL, 0, 0x3]);
    });
});

describe("lite-gl color mask", () => {
    it("issues colorMask and caches the packed value", () => {
        const { mock, engine } = makeEngine();
        setColorMask(engine, true, true, true, true);
        expect(callsNamed(mock, "colorMask")[0]?.args).toEqual([true, true, true, true]);
        mock.clear();
        setColorMask(engine, true, true, true, true);
        expect(callsNamed(mock, "colorMask")).toHaveLength(0);
        setColorMask(engine, false, false, false, false);
        expect(callsNamed(mock, "colorMask")[0]?.args).toEqual([false, false, false, false]);
    });
});

describe("lite-gl clearEngine", () => {
    it("clears color with the right bit + clearColor", () => {
        const { mock, engine } = makeEngine();
        clearEngine(engine, { color: { r: 0.1, g: 0.2, b: 0.3 } });
        expect(callsNamed(mock, "clearColor")[0]?.args).toEqual([0.1, 0.2, 0.3, 1]);
        expect(callsNamed(mock, "clear")[0]?.args).toEqual([engine.gl.COLOR_BUFFER_BIT]);
    });

    it("ORs depth + stencil bits", () => {
        const { mock, engine } = makeEngine();
        clearEngine(engine, { depth: true, stencil: true });
        expect(callsNamed(mock, "clear")[0]?.args[0]).toBe(engine.gl.DEPTH_BUFFER_BIT | engine.gl.STENCIL_BUFFER_BIT);
    });

    it("is a no-op when nothing is requested", () => {
        const { mock, engine } = makeEngine();
        clearEngine(engine, {});
        expect(callsNamed(mock, "clear")).toHaveLength(0);
    });
});

describe("lite-gl depth/stencil: lost-context safety", () => {
    it("all setters are no-ops on a lost context", () => {
        const { mock, canvas, engine } = makeEngine();
        fireLost(canvas);
        mock.clear();
        expect(() => {
            setDepthState(engine, { test: true });
            setStencilState(engine, { test: true });
            setColorMask(engine, true, false, true, false);
            clearEngine(engine, { color: { r: 0, g: 0, b: 0 } });
        }).not.toThrow();
        expect(mock.log).toHaveLength(0);
    });
});
