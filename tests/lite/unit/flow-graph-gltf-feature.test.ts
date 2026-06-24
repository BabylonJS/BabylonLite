import { describe, expect, it, vi } from "vitest";

import { createTransformNode } from "../../../packages/babylon-lite/src/scene/transform-node";
import type { TransformNode } from "../../../packages/babylon-lite/src/scene/transform-node";
import { resolvePointerAccessor } from "../../../packages/babylon-lite/src/flow-graph/gltf/path-converter";
import interactivityFeature from "../../../packages/babylon-lite/src/loader-gltf/gltf-feature-interactivity";
import { createFgRuntime, startFlowGraph } from "../../../packages/babylon-lite/src/flow-graph/index";
import type { GltfLoadCtx } from "../../../packages/babylon-lite/src/loader-gltf/gltf-feature";

const worldPointerExtension = {
    graphs: [
        {
            declarations: [{ op: "event/onStart" }, { op: "pointer/set" }],
            nodes: [
                { declaration: 0, flows: { out: { node: 1, socket: "in" } } },
                {
                    declaration: 1,
                    configuration: { pointer: { value: ["/nodes/0/translation"] } },
                    values: { value: { value: [1, 2, 3], type: 0 } },
                },
            ],
            types: [{ signature: "float3" }],
        },
    ],
};

describe("path-converter resolvePointerAccessor", () => {
    it("reads + writes a node's translation through the TRS accessor", () => {
        const node = createTransformNode("n0");
        const accessor = resolvePointerAccessor("/nodes/0/translation", { nodeMap: [node] });
        expect(accessor).not.toBeNull();
        expect(accessor!.get()).toEqual({ x: 0, y: 0, z: 0 });
        accessor!.set!({ x: 4, y: 5, z: 6 });
        expect(node.position.x).toBe(4);
        expect(node.position.y).toBe(5);
        expect(node.position.z).toBe(6);
    });

    it("reads + writes a node's scale", () => {
        const node = createTransformNode("n0");
        const accessor = resolvePointerAccessor("/nodes/0/scale", { nodeMap: [node] })!;
        accessor.set!({ x: 2, y: 2, z: 2 });
        expect(node.scaling.x).toBe(2);
    });

    it("returns null for unsupported paths and unreachable nodes", () => {
        expect(resolvePointerAccessor("/materials/0/baseColor", { nodeMap: [createTransformNode("n0")] })).toBeNull();
        expect(resolvePointerAccessor("/nodes/3/translation", { nodeMap: [createTransformNode("n0")] })).toBeNull();
    });

    it("reads a material's baseColorTexture UV scale (pointer/get)", () => {
        const mat = { _uboVersion: 0, baseColorTexture: { uScale: 0.1, vScale: 1, uOffset: 0.8, vOffset: 0 } };
        const ptr = "/materials/4/pbrMetallicRoughness/baseColorTexture/extensions/KHR_texture_transform/scale";
        const accessor = resolvePointerAccessor(ptr, { nodeMap: [], materials: [undefined, undefined, undefined, undefined, mat] })!;
        expect(accessor.get()).toEqual({ x: 0.1, y: 1 });
    });

    it("writes a material's UV offset and isolates the shared texture (pointer/set)", () => {
        const shared = { uScale: 0.1, vScale: 1, uOffset: 0.8, vOffset: 0 };
        const matA = { _uboVersion: 0, baseColorTexture: shared };
        const matB = { _uboVersion: 0, baseColorTexture: shared };
        const ptr = "/materials/0/pbrMetallicRoughness/baseColorTexture/extensions/KHR_texture_transform/offset";
        const accessor = resolvePointerAccessor(ptr, { nodeMap: [], materials: [matA, matB] })!;
        accessor.set!({ x: 0, y: 0 });
        expect(matA.baseColorTexture.uOffset).toBe(0);
        expect(matA._uboVersion).toBe(1);
        // matB still references the original shared wrapper — untouched (per-texture isolation).
        expect(matB.baseColorTexture).toBe(shared);
        expect(shared.uOffset).toBe(0.8);
    });

    it("toggles node visibility through the KHR_node_visibility accessor", () => {
        const node = createTransformNode("n0");
        const accessor = resolvePointerAccessor("/nodes/0/extensions/KHR_node_visibility/visible", { nodeMap: [node] })!;
        expect(accessor.get()).toBe(true);
        accessor.set!(false);
        expect(node.visible).toBe(false);
        accessor.set!(true);
        expect(node.visible).toBe(true);
    });

    it("treats node selectability as a no-op value round-trip", () => {
        const node = createTransformNode("n0");
        const accessor = resolvePointerAccessor("/nodes/0/extensions/KHR_node_selectability/selectable", { nodeMap: [node] })!;
        expect(accessor.get()).toBe(true);
        accessor.set!(false);
        expect(accessor.get()).toBe(false);
        expect(node.visible).toBeUndefined(); // selectability never touches visibility
    });
});

describe("gltf-feature-interactivity applyAsset", () => {
    it("parses graphs and resolves pointers into the container", async () => {
        const node = createTransformNode("n0");
        const ctx = { _json: { extensions: { KHR_interactivity: worldPointerExtension } }, _nodeMap: [node] as (TransformNode | undefined)[] } as unknown as GltfLoadCtx;

        const result = await interactivityFeature.applyAsset!([], node, ctx);
        expect(result.flowGraphs).toHaveLength(1);
        const lg = result.flowGraphs![0]!;
        expect(Object.keys(lg.accessors)).toEqual(["/nodes/0/translation"]);

        // Run it: onStart → pointer/set writes (1,2,3) into the real node.
        const rt = await createFgRuntime(lg.graph, { accessors: lg.accessors }, { rightHanded: true });
        startFlowGraph(rt);
        expect(node.position.x).toBe(1);
        expect(node.position.y).toBe(2);
        expect(node.position.z).toBe(3);
    });

    it("throws when a pointer cannot be resolved against the node map", async () => {
        const ctx = { _json: { extensions: { KHR_interactivity: worldPointerExtension } }, _nodeMap: [] as (TransformNode | undefined)[] } as unknown as GltfLoadCtx;
        await expect(interactivityFeature.applyAsset!([], createTransformNode("x"), ctx)).rejects.toThrow(/cannot resolve pointer/);
    });

    it("returns an empty fragment when the asset has no interactivity extension", async () => {
        const ctx = { _json: { extensions: {} }, _nodeMap: [] as (TransformNode | undefined)[] } as unknown as GltfLoadCtx;
        const result = await interactivityFeature.applyAsset!([], createTransformNode("x"), ctx);
        expect(result.flowGraphs).toBeUndefined();
    });
});

vi.spyOn(console, "log").mockImplementation(() => {});
