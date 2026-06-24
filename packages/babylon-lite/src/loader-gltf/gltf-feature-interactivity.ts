// ⚠️ SPEC-VOLATILE — KHR_interactivity is an UNRATIFIED glTF draft. This feature
// is the ONLY loader-side entrypoint for it; all spec-dependent parsing lives
// under flow-graph/gltf/. Mirrored against Babylon.js commit 8f728b23ea. Re-sync
// against BJS PR #18455 ("KHR_interactivity rework") when it lands.
//
// gltf-feature-interactivity: a per-asset glTF feature. At applyAsset time the
// node hierarchy (`ctx._nodeMap`) is built but animation groups are NOT yet
// available, so this feature only does the spec-volatile, node-dependent work —
// parse each graph and pre-resolve its JSON pointers to TRS accessors — and
// hands the result to the AssetContainer. Binding animations + scene capabilities
// and driving the runtime happens later, in addToScene → runFlowGraphs.

import type { GltfFeature, GltfLoadCtx } from "./gltf-feature.js";
import type { Mesh } from "../mesh/mesh.js";
import type { TransformNode } from "../scene/transform-node.js";
import type { AssetContainer } from "../asset-container.js";
import type { FgAccessor, LoadedFlowGraph } from "../flow-graph/context.js";
import type { PointerMaterial } from "./animation-pointer.js";
import { parseInteractivityGraph, type GltfInteractivityGraph } from "../flow-graph/gltf/interactivity-parser.js";
import { resolvePointerAccessor } from "../flow-graph/gltf/path-converter.js";

interface IKHRInteractivity {
    graphs?: GltfInteractivityGraph[];
}

/** Build a glTF-material-index → runtime-material map by walking the node→mesh→
 *  primitive hierarchy in the same order the loader instantiates GPU meshes
 *  (mirrors KHR_animation_pointer's `materialMap`). Lets a `pointer/{get,set}` on
 *  a material's UV transform reach the live PBR material. */
function buildMaterialMap(json: { nodes?: { mesh?: number }[]; meshes?: { primitives?: { material?: number }[] }[] }, meshes: readonly Mesh[]): (PointerMaterial | undefined)[] {
    const map: (PointerMaterial | undefined)[] = [];
    const nodes = json.nodes ?? [];
    let gpuIdx = 0;
    for (let ni = 0; ni < nodes.length; ni++) {
        const meshRef = nodes[ni]?.mesh;
        if (meshRef === undefined) {
            continue;
        }
        const prims = json.meshes?.[meshRef]?.primitives ?? [];
        for (let p = 0; p < prims.length; p++) {
            const matIdx = prims[p]?.material;
            const mesh = meshes[gpuIdx++];
            if (matIdx !== undefined && mesh) {
                map[matIdx] = mesh.material as unknown as PointerMaterial;
            }
        }
    }
    return map;
}

const feature: GltfFeature = {
    id: "KHR_interactivity",
    async applyAsset(_meshes: Mesh[], _root: TransformNode, ctx: GltfLoadCtx): Promise<Partial<AssetContainer>> {
        const ext = ctx._json.extensions?.KHR_interactivity as IKHRInteractivity | undefined;
        const graphs = ext?.graphs ?? [];
        const nodeMap = ctx._nodeMap ?? [];
        const materials = buildMaterialMap(ctx._json, _meshes);
        const resolveCtx = { nodeMap, materials, json: ctx._json };

        const flowGraphs: LoadedFlowGraph[] = [];
        for (const graphJson of graphs) {
            const { graph, pointers } = await parseInteractivityGraph(graphJson);
            const accessors: Record<string, FgAccessor> = {};
            for (const pointer of pointers) {
                const accessor = resolvePointerAccessor(pointer, resolveCtx);
                if (!accessor) {
                    throw new Error(`KHR_interactivity: cannot resolve pointer ${JSON.stringify(pointer)} (unsupported path or unreachable node)`);
                }
                accessors[pointer] = accessor;
            }
            flowGraphs.push({ graph, accessors });
        }

        return flowGraphs.length > 0 ? { flowGraphs } : {};
    },
};

export default feature;
