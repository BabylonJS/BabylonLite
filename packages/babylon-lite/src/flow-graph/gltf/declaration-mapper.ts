// ⚠️ SPEC-VOLATILE — KHR_interactivity is an UNRATIFIED glTF draft. Quarantined
// here so the runtime core never changes when the spec churns. Mirrored against
// Babylon.js commit 8f728b23ea (2026-06-24). Re-sync against BJS PR #18455
// ("KHR_interactivity rework") when it lands.
// See docs/lite/architecture/42-flow-graph.md → glTF KHR_interactivity Loader.
//
// declaration-mapper: maps each glTF interactivity `op` string to the Lite block
// it instantiates, plus the socket/config translation. Mirrors BJS
// `declarationMapper.ts`, but COLLAPSED: BJS expands pointer/animation ops into
// multiple blocks + inter-block connectors (JsonPointerParser, ArrayIndex,
// GLTFDataProvider). Lite pre-resolves pointers to accessors and animations to
// caps in the loader, so each op maps to a SINGLE block.

import { FgBlockType } from "../block-type.js";

/** Default glTF value-output socket name (used when a reference omits `socket`). */
export const DEFAULT_VALUE_SOCKET = "value";
/** Default glTF flow-input socket name (used when a flow omits `socket`). */
export const DEFAULT_FLOW_SOCKET = "in";
/** Frames-per-second used to convert animation seconds → frames (glTF default). */
export const ANIMATION_FPS = 60;

/** Lite-side mapping descriptor for one glTF interactivity op. */
export interface FgOpMapping {
    /** The Lite block this op instantiates. */
    readonly block: FgBlockType;
    /** glTF value-INPUT socket name → Lite data-input name. Unlisted inputs that
     *  are NOT pointer segments are passed through by their glTF name. */
    readonly valueInputs?: Readonly<Record<string, string>>;
    /** Per-input numeric transform applied to a literal value array before
     *  coercion (e.g. animation seconds → frames). Keyed by glTF input name. */
    readonly valueTransform?: Readonly<Record<string, (arr: number[]) => number[]>>;
    /** glTF value-OUTPUT socket name → Lite data-output name (for data references
     *  that read this block). Default output `value` passes through. */
    readonly outputValues?: Readonly<Record<string, string>>;
    /** glTF flow-OUTPUT socket name → Lite signal-output name. */
    readonly flowOutputs?: Readonly<Record<string, string>>;
    /** Pointer op: resolve `config.accessor` from the `pointer` configuration +
     *  literal segment value sockets; segment inputs are NOT block data inputs. */
    readonly pointer?: boolean;
    /** Sequence-style: `outputSignalCount` = number of flow keys; the i-th flow
     *  (sorted) maps to signal `out_i`. */
    readonly dynamicSequence?: boolean;
    /** Variable op: the glTF configuration key holding the variable index/indices
     *  (`variable` for get, `variables` for set). */
    readonly variableConfigKey?: string;
    /** Event op: copy a numeric glTF `configuration` value into `config[key]`
     *  (e.g. `nodeIndex` for `event/onSelect`). */
    readonly nodeConfigKey?: string;
}

const FPS = (arr: number[]): number[] => [(arr[0] ?? 0) * ANIMATION_FPS];

/** Native (no-extension) KHR_interactivity op → Lite block mapping. */
const NATIVE_OPS: Readonly<Record<string, FgOpMapping>> = {
    "event/onStart": { block: FgBlockType.SceneStart, flowOutputs: { out: "done" } },
    "event/onTick": { block: FgBlockType.SceneTick, outputValues: { timeSinceLastTick: "deltaTime" }, flowOutputs: { out: "done" } },

    "flow/branch": { block: FgBlockType.Branch, valueInputs: { condition: "condition" }, flowOutputs: { true: "onTrue", false: "onFalse" } },
    "flow/sequence": { block: FgBlockType.Sequence, dynamicSequence: true },

    "math/add": { block: FgBlockType.Add, valueInputs: { a: "a", b: "b" } },
    "math/sub": { block: FgBlockType.Subtract, valueInputs: { a: "a", b: "b" } },
    "math/mul": { block: FgBlockType.Multiply, valueInputs: { a: "a", b: "b" } },
    "math/div": { block: FgBlockType.Divide, valueInputs: { a: "a", b: "b" } },
    "math/rem": { block: FgBlockType.Modulo, valueInputs: { a: "a", b: "b" } },
    "math/abs": { block: FgBlockType.Abs, valueInputs: { a: "a" } },
    "math/floor": { block: FgBlockType.Floor, valueInputs: { a: "a" } },
    "math/lt": { block: FgBlockType.LessThan, valueInputs: { a: "a", b: "b" } },
    "math/clamp": { block: FgBlockType.Clamp, valueInputs: { a: "a", b: "b", c: "c" } },
    "math/combine2": { block: FgBlockType.CombineVector2, valueInputs: { a: "a", b: "b" } },
    "math/extract2": { block: FgBlockType.ExtractVector2, valueInputs: { a: "a" }, outputValues: { "0": "x", "1": "y" } },

    "variable/get": { block: FgBlockType.GetVariable, variableConfigKey: "variable" },
    "variable/set": { block: FgBlockType.SetVariable, variableConfigKey: "variables", valueInputs: { value: "value" } },

    "pointer/get": { block: FgBlockType.GetProperty, pointer: true },
    "pointer/set": { block: FgBlockType.SetProperty, pointer: true, valueInputs: { value: "value" }, flowOutputs: { err: "error" } },

    "animation/start": {
        block: FgBlockType.PlayAnimation,
        valueInputs: { animation: "animation", speed: "speed", startTime: "from", endTime: "to" },
        valueTransform: { startTime: FPS, endTime: FPS },
        flowOutputs: { err: "error" },
    },
    "animation/stop": { block: FgBlockType.StopAnimation, valueInputs: { animation: "animation" }, flowOutputs: { err: "error" } },
};

/** Babylon-extension ops (`declaration.extension === "BABYLON"`). */
const BABYLON_OPS: Readonly<Record<string, FgOpMapping>> = {
    "flow/log": { block: FgBlockType.ConsoleLog, valueInputs: { message: "message" } },
};

/** KHR_node_selectability ops (`declaration.extension === "KHR_node_selectability"`). */
const KHR_NODE_SELECTABILITY_OPS: Readonly<Record<string, FgOpMapping>> = {
    "event/onSelect": { block: FgBlockType.OnSelect, nodeConfigKey: "nodeIndex" },
};

/** Extension-namespaced op tables, keyed by `declaration.extension`. */
const EXTENSION_OPS: Readonly<Record<string, Readonly<Record<string, FgOpMapping>>>> = {
    BABYLON: BABYLON_OPS,
    KHR_node_selectability: KHR_NODE_SELECTABILITY_OPS,
};

/** Look up the Lite mapping for a glTF op, honoring the declaration `extension`.
 *  Returns `null` for an unknown op so the parser can fail loudly. */
export function getOpMapping(op: string, extension?: string): FgOpMapping | null {
    if (extension) {
        return EXTENSION_OPS[extension]?.[op] ?? null;
    }
    return NATIVE_OPS[op] ?? null;
}
