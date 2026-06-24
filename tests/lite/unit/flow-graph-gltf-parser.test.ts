import { describe, expect, it, vi } from "vitest";

import type { FgAccessor, FgValue } from "../../../packages/babylon-lite/src/flow-graph/index";
import { createFgRuntime, startFlowGraph } from "../../../packages/babylon-lite/src/flow-graph/index";
import { parseInteractivityGraph, type GltfInteractivityGraph } from "../../../packages/babylon-lite/src/flow-graph/gltf/interactivity-parser";

// Fixtures mirror Babylon.js loaders/test/unit/Interactivity/testData.ts verbatim
// (commit 8f728b23ea) so the Lite parser is validated against the real wire format.

const worldPointerExample: GltfInteractivityGraph = {
    declarations: [{ op: "event/onStart" }, { op: "pointer/set" }, { op: "pointer/get" }, { op: "flow/log", extension: "BABYLON" }],
    nodes: [
        { declaration: 0, flows: { out: { node: 1, socket: "in" } } },
        {
            declaration: 1,
            configuration: { pointer: { value: ["/nodes/0/translation"] } },
            values: { value: { value: [1, 1, 1], type: 4 } },
            flows: { out: { node: 3, socket: "in" } },
        },
        {
            declaration: 2,
            configuration: { pointer: { value: ["/nodes/{nodeIndex}/translation"] } },
            values: { nodeIndex: { value: [0], type: 1 } },
        },
        { declaration: 3, values: { message: { node: 2, socket: "value" } } },
    ],
    variables: [],
    events: [],
    types: [{ signature: "bool" }, { signature: "int" }, { signature: "float" }, { signature: "float2" }, { signature: "float3" }],
};

const loggerExample: GltfInteractivityGraph = {
    declarations: [{ op: "event/onStart" }, { op: "flow/log", extension: "BABYLON" }, { op: "math/add" }],
    nodes: [
        { declaration: 0, flows: { out: { node: 2, socket: "in" } } },
        {
            declaration: 2,
            values: {
                a: { value: [1, 2, 3, 4], type: 0 },
                b: { value: [1, 2, 3, 4], type: 0 },
            },
        },
        { declaration: 1, values: { message: { node: 1, socket: "value" } } },
    ],
    types: [{ signature: "float4" }],
};

describe("KHR_interactivity parser", () => {
    it("parses the worldPointer graph: topology, config, pointers", async () => {
        const { graph, pointers } = await parseInteractivityGraph(worldPointerExample);

        expect(graph.blocks.map((b) => b.type)).toEqual(["SceneReadyEvent", "SetProperty", "GetProperty", "ConsoleLog"]);
        expect(pointers).toEqual(["/nodes/0/translation"]);

        // onStart `out` flow maps to the SceneReadyEvent `done` signal → node_1.in
        const start = graph.blocks[0]!;
        const done = start.signalOut.find((s) => s.name === "done")!;
        expect(done.targets).toEqual([{ blockId: "node_1", socket: "in" }]);

        // pointer/set resolves config.accessor + literal Vector3 value, and wires out→node_3
        const set = graph.blocks[1]!;
        expect(set.config?.accessor).toBe("/nodes/0/translation");
        expect(set.dataIn.find((d) => d.name === "value")!.defaultValue).toEqual({ x: 1, y: 1, z: 1 });
        expect(set.signalOut.find((s) => s.name === "out")!.targets).toEqual([{ blockId: "node_3", socket: "in" }]);

        // pointer/get template `{nodeIndex}` substituted from the literal value socket
        expect(graph.blocks[2]!.config?.accessor).toBe("/nodes/0/translation");

        // ConsoleLog pulls `message` from GetProperty.value
        const log = graph.blocks[3]!;
        expect(log.dataIn.find((d) => d.name === "message")!.source).toEqual({ blockId: "node_2", socket: "value" });
    });

    it("coerces a float4 literal into a Vector4 and wires a data reference", async () => {
        const { graph } = await parseInteractivityGraph(loggerExample);
        const add = graph.blocks[1]!;
        expect(add.type).toBe("Add");
        expect(add.dataIn.find((d) => d.name === "a")!.defaultValue).toEqual({ x: 1, y: 2, z: 3, w: 4 });
        // ConsoleLog message references the add node's default `value` output
        expect(graph.blocks[2]!.dataIn.find((d) => d.name === "message")!.source).toEqual({ blockId: "node_1", socket: "value" });
    });

    it("runs end-to-end: onStart → pointer/set writes through the resolved accessor", async () => {
        const { graph, pointers } = await parseInteractivityGraph(worldPointerExample);
        const box = { v: { x: 0, y: 0, z: 0 } as FgValue };
        const accessor: FgAccessor = {
            type: graph.blocks[1]!.dataIn[0]!.type,
            get: () => box.v,
            set: (value) => {
                box.v = value;
            },
        };
        const accessors = Object.fromEntries(pointers.map((p) => [p, accessor]));
        const rt = await createFgRuntime(graph, { accessors });
        startFlowGraph(rt);
        expect(box.v).toEqual({ x: 1, y: 1, z: 1 });
    });

    it("fails loudly on an unknown op", async () => {
        const bad: GltfInteractivityGraph = {
            declarations: [{ op: "event/onStart" }, { op: "math/teleport" }],
            nodes: [{ declaration: 0, flows: { out: { node: 1, socket: "in" } } }, { declaration: 1 }],
            types: [],
        };
        await expect(parseInteractivityGraph(bad)).rejects.toThrow(/unsupported op\(s\): math\/teleport/);
    });

    it("rejects a pointer with an unresolved dynamic segment", async () => {
        const dyn: GltfInteractivityGraph = {
            declarations: [{ op: "pointer/set" }],
            nodes: [
                {
                    declaration: 0,
                    configuration: { pointer: { value: ["/nodes/{nodeIndex}/translation"] } },
                    // nodeIndex is a node reference (runtime-dynamic), not a literal
                    values: { nodeIndex: { node: 5 }, value: { value: [1, 1, 1], type: 0 } },
                },
            ],
            types: [{ signature: "float3" }],
        };
        await expect(parseInteractivityGraph(dyn)).rejects.toThrow(/unresolvable pointer/);
    });
});

// Silence the ConsoleLog block's console.log in the end-to-end run.
vi.spyOn(console, "log").mockImplementation(() => {});
