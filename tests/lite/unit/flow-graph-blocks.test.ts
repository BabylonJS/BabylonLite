import { describe, expect, it, vi } from "vitest";

import type { AnimationGroup } from "../../../packages/babylon-lite/src/animation/animation-group";
import type { FgAccessor, FgBlock, FgBlockDef, FgGraph, FgValue, FgWiring } from "../../../packages/babylon-lite/src/flow-graph/index";
import { createFgRuntime, fgInt, FgEventType, FgType, getBlockDef, getDataValue, pumpFgEvent, startFlowGraph, tickFlowGraph } from "../../../packages/babylon-lite/src/flow-graph/index";

// ─── graph + runtime builder driven by the REAL registry ────────────────────

interface Edge {
    blockId: string;
    socket: string;
}
interface NodeSpec {
    id: string;
    type: string;
    config?: Record<string, unknown>;
    /** signal output socket name → wired targets */
    signalTargets?: Record<string, Edge[]>;
    /** data input socket name → wired source */
    dataSources?: Record<string, Edge>;
    /** data input socket name → literal fallback (when unwired) */
    dataDefaults?: Record<string, FgValue>;
}

/** Instantiate each node's shape from its def (resolved via the production
 *  `getBlockDef` registry, unless supplied in `defs`), then wire edges. */
async function buildGraph(specs: NodeSpec[], variables: FgGraph["variables"], defs: Record<string, FgBlockDef>): Promise<FgGraph> {
    const blocks: FgBlock[] = [];
    for (const spec of specs) {
        const def = defs[spec.type] ?? (await getBlockDef(spec.type)!());
        const shape = def.build(spec.config);
        blocks.push({
            id: spec.id,
            type: spec.type,
            config: spec.config,
            dataIn: (shape.dataIn ?? []).map((d) => ({
                name: d.name,
                type: d.type,
                source: spec.dataSources?.[d.name],
                defaultValue: spec.dataDefaults?.[d.name] ?? d.defaultValue,
            })),
            dataOut: shape.dataOut ?? [],
            signalIn: shape.signalIn ?? [],
            signalOut: (shape.signalOut ?? []).map((s) => ({ name: s.name, targets: spec.signalTargets?.[s.name] ?? [] })),
            event: shape.event,
        });
    }
    const byId: Record<string, number> = {};
    blocks.forEach((b, i) => (byId[b.id] = i));
    return { blocks, byId, variables };
}

/** Build a graph + runtime, threading test-only `defs` (e.g. the recorder) into
 *  BOTH shape instantiation and the runtime env so blocks under test still
 *  resolve via the production registry. */
async function makeRuntime(specs: NodeSpec[], opts: { variables?: FgGraph["variables"]; wiring?: FgWiring; defs?: Record<string, FgBlockDef> } = {}) {
    const defs = opts.defs ?? {};
    const graph = await buildGraph(specs, opts.variables ?? {}, defs);
    return createFgRuntime(graph, { ...(opts.wiring ?? {}), defs });
}

/** Test-only recorder: logs incoming signal label + the pulled `value` input.
 *  Passed via `defs` so blocks UNDER TEST still resolve via the registry. */
const RECORD = "test/record";
function recorderDef(log: { label: string; value: FgValue }[]): FgBlockDef {
    return {
        type: RECORD,
        build: () => ({ signalIn: [{ name: "in", targets: [] }], dataIn: [{ name: "value", type: FgType.Any }] }),
        execute: (block, ctx, env) => log.push({ label: (block.config?.label as string) ?? "", value: getDataValue(ctx, env, block, "value") }),
    };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("flow-graph blocks — events", () => {
    it("SceneStart fires its out signal once on start", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "rec", socket: "in" }] } },
                { id: "rec", type: RECORD, config: { label: "started" } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        startFlowGraph(rt); // idempotent
        expect(log.map((e) => e.label)).toEqual(["started"]);
    });

    it("SceneTick accumulates timeSinceStart and exposes deltaTime", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "tick", type: "SceneTickEvent", signalTargets: { out: [{ blockId: "rec", socket: "in" }] } },
                { id: "rec", type: RECORD, dataSources: { value: { blockId: "tick", socket: "timeSinceStart" } } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        tickFlowGraph(rt, 1000); // +1s
        tickFlowGraph(rt, 500); // +0.5s
        expect(log.map((e) => e.value)).toEqual([1, 1.5]);
    });

    it("OnSelect fires only when its configured node is picked", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "sel", type: "OnSelect", config: { nodeIndex: 14 }, signalTargets: { out: [{ blockId: "rec", socket: "in" }] } },
                { id: "rec", type: RECORD, dataSources: { value: { blockId: "sel", socket: "selectedNodeIndex" } } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        pumpFgEvent(rt.env.events, FgEventType.Pointer, { nodeIndex: 99 });
        expect(log).toHaveLength(0); // wrong node — inert
        pumpFgEvent(rt.env.events, FgEventType.Pointer, { nodeIndex: 14 });
        expect(log).toHaveLength(1);
        expect(log[0]!.value).toEqual({ value: 14, __fgInt: true });
    });
});

describe("flow-graph blocks — control flow", () => {
    it("Branch routes to onTrue / onFalse by condition", async () => {
        for (const [cond, expected] of [
            [true, "T"],
            [false, "F"],
        ] as const) {
            const log: { label: string; value: FgValue }[] = [];
            const rt = await makeRuntime(
                [
                    { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "br", socket: "in" }] } },
                    {
                        id: "br",
                        type: "Branch",
                        dataDefaults: { condition: cond },
                        signalTargets: { onTrue: [{ blockId: "t", socket: "in" }], onFalse: [{ blockId: "f", socket: "in" }] },
                    },
                    { id: "t", type: RECORD, config: { label: "T" } },
                    { id: "f", type: RECORD, config: { label: "F" } },
                ],
                { defs: { [RECORD]: recorderDef(log) } }
            );
            startFlowGraph(rt);
            expect(log.map((e) => e.label)).toEqual([expected]);
        }
    });

    it("Sequence fires out_0..out_N in order", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "seq", socket: "in" }] } },
                {
                    id: "seq",
                    type: "Sequence",
                    config: { outputSignalCount: 3 },
                    signalTargets: {
                        out_0: [{ blockId: "a", socket: "in" }],
                        out_1: [{ blockId: "b", socket: "in" }],
                        out_2: [{ blockId: "c", socket: "in" }],
                    },
                },
                { id: "a", type: RECORD, config: { label: "0" } },
                { id: "b", type: RECORD, config: { label: "1" } },
                { id: "c", type: RECORD, config: { label: "2" } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(log.map((e) => e.label)).toEqual(["0", "1", "2"]);
    });
});

describe("flow-graph blocks — math/data", () => {
    it("Add sums numbers (pulled through to a recorder)", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "rec", socket: "in" }] } },
                { id: "add", type: "Add", dataDefaults: { a: 1, b: 2 } },
                { id: "rec", type: RECORD, dataSources: { value: { blockId: "add", socket: "value" } } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(log[0]!.value).toBe(3);
    });

    it("Add is component-wise for vectors", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "rec", socket: "in" }] } },
                { id: "add", type: "Add", dataDefaults: { a: { x: 1, y: 2, z: 3 }, b: { x: 4, y: 5, z: 6 } } },
                { id: "rec", type: RECORD, dataSources: { value: { blockId: "add", socket: "value" } } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(log[0]!.value).toEqual({ x: 5, y: 7, z: 9 });
    });

    it.each([
        ["Subtract", 7, 4, 3],
        ["Multiply", 6, 7, 42],
        ["Divide", 20, 5, 4],
        ["Modulo", 17, 5, 2],
    ])("%s computes a∘b on numbers", async (type, a, b, expected) => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "rec", socket: "in" }] } },
                { id: "op", type, dataDefaults: { a, b } },
                { id: "rec", type: RECORD, dataSources: { value: { blockId: "op", socket: "value" } } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(log[0]!.value).toBe(expected);
    });

    it("Subtract/Multiply are component-wise for vectors", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                {
                    id: "start",
                    type: "SceneReadyEvent",
                    signalTargets: {
                        out: [
                            { blockId: "rs", socket: "in" },
                            { blockId: "rm", socket: "in" },
                        ],
                    },
                },
                { id: "sub", type: "Subtract", dataDefaults: { a: { x: 5, y: 7 }, b: { x: 1, y: 2 } } },
                { id: "mul", type: "Multiply", dataDefaults: { a: { x: 2, y: 3 }, b: { x: 4, y: 5 } } },
                { id: "rs", type: RECORD, config: { label: "sub" }, dataSources: { value: { blockId: "sub", socket: "value" } } },
                { id: "rm", type: RECORD, config: { label: "mul" }, dataSources: { value: { blockId: "mul", socket: "value" } } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(log.find((l) => l.label === "sub")!.value).toEqual({ x: 4, y: 5 });
        expect(log.find((l) => l.label === "mul")!.value).toEqual({ x: 8, y: 15 });
    });

    it.each([
        ["Abs", -3.5, 3.5],
        ["Floor", 3.9, 3],
    ])("%s is unary", async (type, a, expected) => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "rec", socket: "in" }] } },
                { id: "op", type, dataDefaults: { a } },
                { id: "rec", type: RECORD, dataSources: { value: { blockId: "op", socket: "value" } } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(log[0]!.value).toBe(expected);
    });

    it.each([
        [1, 2, true],
        [2, 2, false],
        [3, 2, false],
    ])("LessThan(%d, %d) → %s", async (a, b, expected) => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "rec", socket: "in" }] } },
                { id: "op", type: "LessThan", dataDefaults: { a, b } },
                { id: "rec", type: RECORD, dataSources: { value: { blockId: "op", socket: "value" } } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(log[0]!.value).toBe(expected);
    });

    it.each([
        [-5, -3, 7, -3],
        [10, -3, 7, 7],
        [4, -3, 7, 4],
    ])("Clamp(%d, %d, %d) → %d", async (a, b, c, expected) => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "rec", socket: "in" }] } },
                { id: "op", type: "Clamp", dataDefaults: { a, b, c } },
                { id: "rec", type: RECORD, dataSources: { value: { blockId: "op", socket: "value" } } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(log[0]!.value).toBe(expected);
    });

    it("CombineVector2 builds a Vec2 from two scalars", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "rec", socket: "in" }] } },
                { id: "op", type: "CombineVector2", dataDefaults: { a: 0.8, b: 0.1 } },
                { id: "rec", type: RECORD, dataSources: { value: { blockId: "op", socket: "value" } } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(log[0]!.value).toEqual({ x: 0.8, y: 0.1 });
    });

    it("ExtractVector2 splits a Vec2 into x/y outputs", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                {
                    id: "start",
                    type: "SceneReadyEvent",
                    signalTargets: {
                        out: [
                            { blockId: "rx", socket: "in" },
                            { blockId: "ry", socket: "in" },
                        ],
                    },
                },
                { id: "op", type: "ExtractVector2", dataDefaults: { a: { x: 3, y: 4 } } },
                { id: "rx", type: RECORD, config: { label: "x" }, dataSources: { value: { blockId: "op", socket: "x" } } },
                { id: "ry", type: RECORD, config: { label: "y" }, dataSources: { value: { blockId: "op", socket: "y" } } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(log.find((l) => l.label === "x")!.value).toBe(3);
        expect(log.find((l) => l.label === "y")!.value).toBe(4);
    });

    it("Get/SetVariable round-trips a live graph variable", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "set", socket: "in" }] } },
                {
                    id: "set",
                    type: "SetVariable",
                    config: { variable: "score" },
                    dataDefaults: { value: 42 },
                    signalTargets: { out: [{ blockId: "rec", socket: "in" }] },
                },
                { id: "get", type: "GetVariable", config: { variable: "score" } },
                { id: "rec", type: RECORD, dataSources: { value: { blockId: "get", socket: "value" } } },
            ],
            { variables: { score: { type: FgType.Number, value: 0 } }, defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(rt.context.userVariables.score).toBe(42);
        expect(log[0]!.value).toBe(42);
    });
});

describe("flow-graph blocks — math Phase 3", () => {
    /** Build start→op→recorder, fire start, return the value pulled off `outSocket`. */
    async function evalOp(
        type: string,
        dataDefaults: Record<string, FgValue>,
        opts: { config?: Record<string, unknown>; outSocket?: string } = {}
    ): Promise<FgValue> {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "rec", socket: "in" }] } },
                { id: "op", type, config: opts.config, dataDefaults },
                { id: "rec", type: RECORD, dataSources: { value: { blockId: "op", socket: opts.outSocket ?? "value" } } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        return log[0]!.value;
    }

    it.each([
        ["Negation", -5, 5],
        ["Sign", -2, -1],
        ["Sign", 0, 0],
        ["Ceil", 3.2, 4],
        ["Round", 2.5, 3],
        ["Round", -2.5, -2],
        ["Trunc", -3.9, -3],
        ["Fraction", 3.25, 0.25],
        ["Saturate", 1.5, 1],
        ["Saturate", -0.5, 0],
        ["SquareRoot", 9, 3],
        ["CubeRoot", 27, 3],
        ["Exponential", 0, 1],
        ["Log2", 8, 3],
        ["Log10", 1000, 3],
    ])("%s(%d) → %d", async (type, a, expected) => {
        expect(await evalOp(type, { a })).toBeCloseTo(expected as number, 10);
    });

    it.each([
        ["Sin", 0, 0],
        ["Cos", 0, 1],
        ["Tan", 0, 0],
        ["Asin", 1, Math.PI / 2],
        ["Acos", 1, 0],
        ["Atan", 0, 0],
        ["Sinh", 0, 0],
        ["Cosh", 0, 1],
        ["Tanh", 0, 0],
        ["DegToRad", 180, Math.PI],
        ["RadToDeg", Math.PI, 180],
    ])("%s(%d) trig/conv", async (type, a, expected) => {
        expect(await evalOp(type, { a })).toBeCloseTo(expected as number, 10);
    });

    it.each([
        ["Min", 3, 5, 3],
        ["Max", 3, 5, 5],
        ["Power", 2, 10, 1024],
        ["Atan2", 1, 1, Math.PI / 4],
    ])("%s(%d, %d) → %d", async (type, a, b, expected) => {
        expect(await evalOp(type, { a, b })).toBeCloseTo(expected as number, 10);
    });

    it.each([
        ["Equality", 2, 2, true],
        ["Equality", 2, 3, false],
        ["LessThanOrEqual", 2, 2, true],
        ["LessThanOrEqual", 3, 2, false],
        ["GreaterThan", 3, 2, true],
        ["GreaterThan", 2, 2, false],
        ["GreaterThanOrEqual", 2, 2, true],
        ["GreaterThanOrEqual", 1, 2, false],
    ])("%s(%d, %d) → %s", async (type, a, b, expected) => {
        expect(await evalOp(type, { a, b })).toBe(expected);
    });

    it.each([
        ["IsNaN", NaN, true],
        ["IsNaN", 3, false],
        ["IsInfinity", Infinity, true],
        ["IsInfinity", 3, false],
    ])("%s(%d) → %s", async (type, a, expected) => {
        expect(await evalOp(type, { a })).toBe(expected);
    });

    it.each([
        ["BitwiseAnd", 6, 3, 2],
        ["BitwiseOr", 6, 1, 7],
        ["BitwiseXor", 6, 3, 5],
        ["BitwiseLeftShift", 1, 4, 16],
        ["BitwiseRightShift", 16, 2, 4],
    ])("%s(%d, %d) on numbers → %d", async (type, a, b, expected) => {
        const r = await evalOp(type, { a, b });
        expect(isFgIntResult(r) ? (r as { value: number }).value : r).toBe(expected);
    });

    it.each([
        ["LeadingZeros", 1, 31],
        ["TrailingZeros", 8, 3],
        ["OneBitsCounter", 7, 3],
        ["BitwiseNot", 0, -1],
    ])("%s(%d) on numbers → %d", async (type, a, expected) => {
        const r = await evalOp(type, { a });
        expect(isFgIntResult(r) ? (r as { value: number }).value : r).toBe(expected);
    });

    it("bitwise and/or/not dispatch booleans logically", async () => {
        expect(await evalOp("BitwiseAnd", { a: true, b: false })).toBe(false);
        expect(await evalOp("BitwiseOr", { a: true, b: false })).toBe(true);
        expect(await evalOp("BitwiseNot", { a: true })).toBe(false);
    });

    it("bitwise ops round-trip FlowGraphInteger", async () => {
        const r = await evalOp("BitwiseAnd", { a: fgInt(6), b: fgInt(3) });
        expect(isFgIntResult(r)).toBe(true);
        expect((r as { value: number }).value).toBe(2);
    });

    it.each([
        ["Length", { x: 3, y: 4, z: 0 }, 5],
        ["Dot", undefined, 32],
    ] as const)("vector scalar op %s", async (type) => {
        if (type === "Length") {
            expect(await evalOp("Length", { a: { x: 3, y: 4, z: 0 } })).toBeCloseTo(5, 10);
        } else {
            expect(await evalOp("Dot", { a: { x: 1, y: 2, z: 3 }, b: { x: 4, y: 5, z: 6 } })).toBeCloseTo(32, 10);
        }
    });

    it("Normalize returns a unit vector", async () => {
        const r = (await evalOp("Normalize", { a: { x: 3, y: 4, z: 0 } })) as { x: number; y: number; z: number };
        expect(r.x).toBeCloseTo(0.6, 10);
        expect(r.y).toBeCloseTo(0.8, 10);
        expect(r.z).toBeCloseTo(0, 10);
    });

    it("Cross computes the right-handed cross product", async () => {
        expect(await evalOp("Cross", { a: { x: 1, y: 0, z: 0 }, b: { x: 0, y: 1, z: 0 } })).toEqual({ x: 0, y: 0, z: 1 });
    });

    it("Rotate2D rotates a Vec2 CCW by angle (b)", async () => {
        const r = (await evalOp("Rotate2D", { a: { x: 1, y: 0 }, b: Math.PI / 2 })) as { x: number; y: number };
        expect(r.x).toBeCloseTo(0, 10);
        expect(r.y).toBeCloseTo(1, 10);
    });

    it("Rotate3D by identity quaternion is a no-op", async () => {
        const r = (await evalOp("Rotate3D", { a: { x: 1, y: 2, z: 3 }, b: { x: 0, y: 0, z: 0, w: 1 } })) as { x: number; y: number; z: number };
        expect(r.x).toBeCloseTo(1, 10);
        expect(r.y).toBeCloseTo(2, 10);
        expect(r.z).toBeCloseTo(3, 10);
    });

    it("CombineVector3/4 build vectors from scalars", async () => {
        expect(await evalOp("CombineVector3", { a: 1, b: 2, c: 3 })).toEqual({ x: 1, y: 2, z: 3 });
        expect(await evalOp("CombineVector4", { a: 1, b: 2, c: 3, d: 4 })).toEqual({ x: 1, y: 2, z: 3, w: 4 });
    });

    it("ExtractVector3/4 split vectors into component sockets", async () => {
        expect(await evalOp("ExtractVector3", { a: { x: 7, y: 8, z: 9 } }, { outSocket: "z" })).toBe(9);
        expect(await evalOp("ExtractVector4", { a: { x: 7, y: 8, z: 9, w: 10 } }, { outSocket: "w" })).toBe(10);
    });

    it.each([
        ["E", Math.E],
        ["PI", Math.PI],
    ])("constant %s emits its value", async (type, expected) => {
        expect(await evalOp(type, {})).toBeCloseTo(expected as number, 12);
    });

    it("Inf and NaN constants", async () => {
        expect(await evalOp("Inf", {})).toBe(Infinity);
        expect(Number.isNaN(await evalOp("NaN", {}))).toBe(true);
    });

    it("MathInterpolation mixes a→b by t = (1-t)a + t·b", async () => {
        expect(await evalOp("MathInterpolation", { a: 0, b: 10, c: 0.25 })).toBeCloseTo(2.5, 10);
    });

    it("Conditional (select) picks onTrue/onFalse from condition", async () => {
        expect(await evalOp("Conditional", { condition: true, onTrue: 11, onFalse: 22 })).toBe(11);
        expect(await evalOp("Conditional", { condition: false, onTrue: 11, onFalse: 22 })).toBe(22);
    });

    it("DataSwitch selects the matching case, else default", async () => {
        const config = { cases: [0, 1, 2] };
        expect(await evalOp("DataSwitch", { case: 1, default: -1, in_0: 10, in_1: 20, in_2: 30 }, { config })).toBe(20);
        expect(await evalOp("DataSwitch", { case: 9, default: -1, in_0: 10, in_1: 20, in_2: 30 }, { config })).toBe(-1);
    });

    it.each([
        ["BooleanToFloat", true, 1],
        ["BooleanToInt", false, 0],
        ["FloatToBoolean", 0, false],
        ["FloatToBoolean", 2.5, true],
        ["IntToFloat", 5, 5],
    ])("conversion %s", async (type, a, expected) => {
        const r = await evalOp(type, { a });
        const v = isFgIntResult(r) ? (r as { value: number }).value : r;
        expect(v).toBe(expected);
    });
});

/** True when a value is a FlowGraphInteger box (re-wrapped by bitwise/int ops). */
function isFgIntResult(v: FgValue): boolean {
    return typeof v === "object" && v !== null && "value" in (v as Record<string, unknown>) && typeof (v as { value: unknown }).value === "number" && !("x" in (v as Record<string, unknown>));
}

describe("flow-graph blocks — property accessors", () => {
    function vec3Accessor(initial: { x: number; y: number; z: number }): { acc: FgAccessor; box: { v: FgValue } } {
        const box = { v: initial as FgValue };
        return {
            box,
            acc: {
                type: FgType.Vector3,
                get: () => box.v,
                set: (value) => {
                    box.v = value;
                },
            },
        };
    }

    it("SetProperty writes through a resolved accessor and fires out", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const { acc, box } = vec3Accessor({ x: 0, y: 0, z: 0 });
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "set", socket: "in" }] } },
                {
                    id: "set",
                    type: "SetProperty",
                    config: { accessor: "/nodes/0/translation" },
                    dataDefaults: { value: { x: 1, y: 1, z: 1 } },
                    signalTargets: { out: [{ blockId: "rec", socket: "in" }] },
                },
                { id: "rec", type: RECORD, config: { label: "ok" } },
            ],
            { wiring: { accessors: { "/nodes/0/translation": acc } }, defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(box.v).toEqual({ x: 1, y: 1, z: 1 });
        expect(log.map((e) => e.label)).toEqual(["ok"]);
    });

    it("SetProperty fires error when the accessor is missing", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "set", socket: "in" }] } },
                {
                    id: "set",
                    type: "SetProperty",
                    config: { accessor: "/missing" },
                    dataDefaults: { value: 1 },
                    signalTargets: { error: [{ blockId: "rec", socket: "in" }] },
                },
                { id: "rec", type: RECORD, config: { label: "err" } },
            ],
            { defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(log.map((e) => e.label)).toEqual(["err"]);
    });

    it("GetProperty reads through a resolved accessor", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const { acc } = vec3Accessor({ x: 7, y: 8, z: 9 });
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "rec", socket: "in" }] } },
                { id: "get", type: "GetProperty", config: { accessor: "p" } },
                { id: "rec", type: RECORD, dataSources: { value: { blockId: "get", socket: "value" } } },
            ],
            { wiring: { accessors: { p: acc } }, defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(log[0]!.value).toEqual({ x: 7, y: 8, z: 9 });
    });
});

describe("flow-graph blocks — animation", () => {
    function mockGroup(): AnimationGroup {
        return {
            name: "anim",
            duration: 1,
            isPlaying: false,
            currentTime: 0,
            targetedAnimations: [],
            speedRatio: 1,
            loopAnimation: false,
            weight: 1,
            _stopped: false,
        } as AnimationGroup;
    }

    it("PlayAnimation invokes the play capability and fires out, then done on end", async () => {
        const log: { label: string; value: FgValue }[] = [];
        const group = mockGroup();
        let endCb: (() => void) | undefined;
        const wiring: FgWiring = {
            animations: [group],
            caps: {
                playAnimation: vi.fn((g, opts) => {
                    g.isPlaying = true;
                    if (opts?.speed !== undefined) {
                        g.speedRatio = opts.speed;
                    }
                }),
                onAnimationEnd: (_g, cb) => {
                    endCb = cb;
                    return () => {
                        endCb = undefined;
                    };
                },
            },
        };
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "play", socket: "in" }] } },
                {
                    id: "play",
                    type: "PlayAnimation",
                    dataDefaults: { animation: 0, speed: 2 },
                    signalTargets: { out: [{ blockId: "o", socket: "in" }], done: [{ blockId: "d", socket: "in" }] },
                },
                { id: "o", type: RECORD, config: { label: "out" } },
                { id: "d", type: RECORD, config: { label: "done" } },
            ],
            { wiring, defs: { [RECORD]: recorderDef(log) } }
        );
        startFlowGraph(rt);
        expect(wiring.caps!.playAnimation).toHaveBeenCalledTimes(1);
        expect(group.speedRatio).toBe(2);
        expect(log.map((e) => e.label)).toEqual(["out"]);
        endCb?.(); // simulate the animation ending
        expect(log.map((e) => e.label)).toEqual(["out", "done"]);
    });

    it("StopAnimation invokes the stop capability", async () => {
        const group = mockGroup();
        const stop = vi.fn();
        const rt = await makeRuntime(
            [
                { id: "start", type: "SceneReadyEvent", signalTargets: { out: [{ blockId: "stop", socket: "in" }] } },
                { id: "stop", type: "StopAnimation", dataDefaults: { animation: 0 } },
            ],
            { wiring: { animations: [group], caps: { stopAnimation: stop } } }
        );
        startFlowGraph(rt);
        expect(stop).toHaveBeenCalledWith(group);
    });
});
