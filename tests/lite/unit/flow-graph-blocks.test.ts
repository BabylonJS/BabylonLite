import { describe, expect, it, vi } from "vitest";

import type { AnimationGroup } from "../../../packages/babylon-lite/src/animation/animation-group";
import type { FgAccessor, FgBlock, FgBlockDef, FgGraph, FgValue, FgWiring } from "../../../packages/babylon-lite/src/flow-graph/index";
import { createFgRuntime, FgType, getBlockDef, getDataValue, startFlowGraph, tickFlowGraph } from "../../../packages/babylon-lite/src/flow-graph/index";

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
