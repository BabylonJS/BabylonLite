// ⚠️ SPEC-VOLATILE — KHR_interactivity is an UNRATIFIED glTF draft. Quarantined
// here so the runtime core never changes when the spec churns. Mirrored against
// Babylon.js commit 8f728b23ea (2026-06-24). Re-sync against BJS PR #18455
// ("KHR_interactivity rework") when it lands.
// See docs/lite/architecture/42-flow-graph.md → glTF KHR_interactivity Loader.
//
// interactivity-parser: walks a `glTF.extensions.KHR_interactivity` graph object
// (types → declarations → variables → nodes/values/flows) and produces a
// spec-agnostic `FgGraph` plus the list of JSON pointers to resolve into
// accessors. Mirrors BJS `interactivityGraphParser.ts`, collapsed for Lite's
// pre-resolved-accessor model (see declaration-mapper.ts).
//
// Unknown ops FAIL LOUDLY (structured error listing every offending op) so a
// KHR_interactivity asset can't silently render a broken interaction.

import { fgInt } from "../custom-types/fg-integer.js";
import { getBlockDef } from "../block-registry.js";
import type { FgBlock, FgDataSocket, FgGraph, FgSignalSocket, FgValue } from "../types.js";
import { FgType } from "../types.js";
import { DEFAULT_FLOW_SOCKET, DEFAULT_VALUE_SOCKET, getOpMapping, type FgOpMapping } from "./declaration-mapper.js";

// ─── glTF wire-format shapes (loose; spec-volatile) ──────────────────────────

interface GltfValueEntry {
    value?: number[];
    type?: number;
    node?: number;
    socket?: string;
}
interface GltfFlowEntry {
    node: number;
    socket?: string;
}
interface GltfNode {
    declaration: number;
    configuration?: Record<string, { value: unknown[] }>;
    values?: Record<string, GltfValueEntry>;
    flows?: Record<string, GltfFlowEntry>;
}
export interface GltfInteractivityGraph {
    types?: { signature: string }[];
    declarations?: { op: string; extension?: string }[];
    variables?: { type: number; value?: number[] }[];
    events?: unknown[];
    nodes?: GltfNode[];
}

/** Result of parsing one interactivity graph. */
export interface FgParseResult {
    readonly graph: FgGraph;
    /** Resolved JSON-pointer strings the loader must turn into accessors
     *  (keyed identically in `block.config.accessor`). */
    readonly pointers: readonly string[];
}

const SIGNATURE_TO_FGTYPE: Readonly<Record<string, FgType>> = {
    bool: FgType.Boolean,
    int: FgType.Integer,
    float: FgType.Number,
    float2: FgType.Vector2,
    float3: FgType.Vector3,
    float4: FgType.Vector4,
    float2x2: FgType.Matrix2D,
    float3x3: FgType.Matrix3D,
    float4x4: FgType.Matrix,
};

/** Coerce a glTF flat value array into an `FgValue` of the given type. */
function arrayToFgValue(arr: number[] | undefined, type: FgType): FgValue {
    const a = arr ?? [];
    switch (type) {
        case FgType.Boolean:
            return !!a[0];
        case FgType.Integer:
            return fgInt(a[0] ?? 0);
        case FgType.Number:
            return a[0] ?? 0;
        case FgType.Vector2:
            return { x: a[0] ?? 0, y: a[1] ?? 0 };
        case FgType.Vector3:
            return { x: a[0] ?? 0, y: a[1] ?? 0, z: a[2] ?? 0 };
        case FgType.Vector4:
        case FgType.Quaternion:
            return { x: a[0] ?? 0, y: a[1] ?? 0, z: a[2] ?? 0, w: a[3] ?? 0 };
        default:
            return a[0] ?? 0;
    }
}

/** Substitute `{segment}` template variables in a pointer with their literal
 *  value-socket values. Returns `null` if a segment is missing or non-literal. */
function resolvePointerTemplate(template: string, node: GltfNode): string | null {
    let ok = true;
    const resolved = template.replace(/\{(\w+)\}/g, (_m, seg: string) => {
        const entry = node.values?.[seg];
        const literal = entry?.value?.[0];
        if (literal === undefined || entry?.node !== undefined) {
            ok = false;
            return _m;
        }
        return String(literal);
    });
    return ok ? resolved : null;
}

/** Compute a node's per-flow-key → Lite signal-output-name map (handles the
 *  dynamic sequence renaming). */
function flowOutputName(mapping: FgOpMapping, flowKeys: string[], key: string): string {
    if (mapping.dynamicSequence) {
        return `out_${flowKeys.indexOf(key)}`;
    }
    return mapping.flowOutputs?.[key] ?? key;
}

/** Parse one KHR_interactivity graph object into an `FgGraph` + pointer list. */
export async function parseInteractivityGraph(json: GltfInteractivityGraph): Promise<FgParseResult> {
    const types = (json.types ?? []).map((t) => SIGNATURE_TO_FGTYPE[t.signature] ?? FgType.Any);
    const declarations = json.declarations ?? [];
    const nodes = json.nodes ?? [];

    // Resolve the mapping for every node first, collecting unknown ops.
    const mappings: FgOpMapping[] = [];
    const unsupported: string[] = [];
    for (const node of nodes) {
        const decl = declarations[node.declaration];
        const mapping = decl ? getOpMapping(decl.op, decl.extension) : null;
        if (!mapping) {
            const label = decl ? `${decl.extension ? decl.extension + ":" : ""}${decl.op}` : `declaration#${node.declaration}`;
            if (!unsupported.includes(label)) {
                unsupported.push(label);
            }
        }
        mappings.push(mapping as FgOpMapping);
    }
    if (unsupported.length > 0) {
        throw new Error(`KHR_interactivity: unsupported op(s): ${unsupported.join(", ")}`);
    }

    // Graph variables (keyed by index, mirroring BJS getVariableName(i)).
    const variables: Record<string, { type: FgType; value: FgValue }> = {};
    (json.variables ?? []).forEach((v, i) => {
        const t = types[v.type] ?? FgType.Any;
        variables[String(i)] = { type: t, value: arrayToFgValue(v.value, t) };
    });

    // Pass 1: instantiate each block's socket shape from its def + config.
    const blocks: FgBlock[] = [];
    const pointers: string[] = [];
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        const mapping = mappings[i]!;
        const config: Record<string, unknown> = {};

        if (mapping.dynamicSequence) {
            config.outputSignalCount = Object.keys(node.flows ?? {}).length;
        }
        if (mapping.variableConfigKey) {
            const idx = (node.configuration?.[mapping.variableConfigKey]?.value?.[0] as number) ?? 0;
            config.variable = String(idx);
        }
        if (mapping.pointer) {
            const template = node.configuration?.pointer?.value?.[0] as string | undefined;
            const resolved = template ? resolvePointerTemplate(template, node) : null;
            if (resolved === null) {
                throw new Error(`KHR_interactivity: node ${i} has an unresolvable pointer ${JSON.stringify(template)} (dynamic segments are not yet supported)`);
            }
            config.accessor = resolved;
            if (!pointers.includes(resolved)) {
                pointers.push(resolved);
            }
        }

        const def = await getBlockDef(mapping.block)!();
        const shape = def.build(config);
        blocks.push({
            id: `node_${i}`,
            type: mapping.block,
            config,
            dataIn: [...(shape.dataIn ?? [])],
            dataOut: shape.dataOut ?? [],
            signalIn: shape.signalIn ?? [],
            signalOut: (shape.signalOut ?? []).map((s) => ({ name: s.name, targets: [] as { blockId: string; socket: string }[] })),
            event: shape.event,
        });
    }

    // Pass 2: wire data sources (values) and signal targets (flows).
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        const mapping = mappings[i]!;
        const block = blocks[i]!;

        // Data inputs.
        for (const [gltfKey, entry] of Object.entries(node.values ?? {})) {
            if (mapping.pointer && gltfKey !== "value") {
                continue; // pointer segment — consumed by accessor resolution
            }
            const inputName = mapping.valueInputs?.[gltfKey] ?? gltfKey;
            const socket = block.dataIn.find((d) => d.name === inputName) as (FgDataSocket & { source?: unknown; defaultValue?: FgValue }) | undefined;
            if (!socket) {
                continue;
            }
            if (entry.node !== undefined) {
                const producer = mappings[entry.node]!;
                const gltfSocket = entry.socket ?? DEFAULT_VALUE_SOCKET;
                socket.source = { blockId: `node_${entry.node}`, socket: producer.outputValues?.[gltfSocket] ?? gltfSocket };
            } else {
                const transform = mapping.valueTransform?.[gltfKey];
                const arr = transform ? transform(entry.value ?? []) : entry.value;
                socket.defaultValue = arrayToFgValue(arr, types[entry.type ?? -1] ?? socket.type);
            }
        }

        // Signal outputs (flows).
        const flowKeys = Object.keys(node.flows ?? {});
        for (const key of flowKeys) {
            const flow = node.flows![key]!;
            const outName = flowOutputName(mapping, flowKeys, key);
            const out = block.signalOut.find((s) => s.name === outName) as FgSignalSocket | undefined;
            if (!out) {
                continue;
            }
            (out.targets as { blockId: string; socket: string }[]).push({ blockId: `node_${flow.node}`, socket: flow.socket ?? DEFAULT_FLOW_SOCKET });
        }
    }

    const byId: Record<string, number> = {};
    blocks.forEach((b, i) => (byId[b.id] = i));
    return { graph: { blocks, byId, variables }, pointers };
}
