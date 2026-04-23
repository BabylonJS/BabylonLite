/** Node Material — internal graph + emitter types.
 *
 *  All types here are pure data. Block emitters are pure functions imported lazily
 *  from `./blocks/*` via the registry. No module-level state lives here.
 */

import type { Texture2D } from "../../texture/texture-2d.js";
import type { UboField, BindingDecl, VertexAttribute, Varying } from "../../shader/fragment-types.js";

// ─── Graph (parser output) ───────────────────────────────────────────

/** A single connection point on a block — either input (incoming) or output (outgoing). */
export interface NodeConnection {
    /** Connection name on the owning block (e.g. "rgb", "uv", "color"). */
    readonly name: string;
    /** WGSL-friendly type name. */
    readonly type: NodeValueType;
    /** For inputs only: the upstream block id + output name. Null if unconnected. */
    readonly source: NodeConnectionRef | null;
    /** For inputs only: a literal default value used when `source` is null. */
    readonly defaultValue?: number | readonly number[];
}

export interface NodeConnectionRef {
    readonly blockId: number;
    readonly outputName: string;
}

/** Parsed block in the graph. */
export interface NodeBlock {
    readonly id: number;
    /** BJS class name (e.g. "InputBlock", "TransformBlock", "FragmentOutputBlock"). */
    readonly className: string;
    /** Author-provided block name. */
    readonly name: string;
    /** Inputs by name. */
    readonly inputs: ReadonlyMap<string, NodeConnection>;
    /** Output names + types. */
    readonly outputs: ReadonlyMap<string, NodeValueType>;
    /** Original serialized JSON for emitters that need extra fields (mode, value, etc.). */
    readonly serialized: Readonly<Record<string, unknown>>;
}

/** Parsed graph. Roots are FragmentOutputBlock + VertexOutputBlock (located by className). */
export interface NodeGraph {
    readonly blocks: ReadonlyMap<number, NodeBlock>;
    /** Named overridable inputs (InputBlocks in mode=Uniform with `visibleInInspector` or just any uniform). */
    readonly namedInputs: ReadonlyMap<string, number>;
}

// ─── WGSL value types ───────────────────────────────────────────────

export type NodeValueType = "f32" | "vec2f" | "vec3f" | "vec4f" | "mat4f" | "texture2d" | "textureCube";

// ─── Emitter API ────────────────────────────────────────────────────

/** Build state mutated as the topological walk emits blocks. */
export interface NodeBuildState {
    // Vertex stage accumulators.
    readonly vertexAttributes: VertexAttribute[];
    readonly vertexUboFields: UboField[];
    readonly vertexBody: string[];
    // Fragment stage accumulators.
    readonly fragmentBody: string[];
    // Cross-stage.
    readonly varyings: Varying[];
    readonly nodeUboFields: UboField[];
    readonly bindings: BindingDecl[];
    readonly textures: NodeTextureBinding[];
    readonly helpers: Map<string, string>;
    // Memoization: blockId|outputName -> WGSL lvalue/expression already emitted.
    readonly memo: Map<string, string>;
    /** Monotonic counter for SSA-style temp names. */
    nextTemp: number;
}

export interface NodeTextureBinding {
    readonly name: string;
    readonly kind: "texture2d" | "textureCube";
    readonly texture: Texture2D | null;
}

/** A block emitter — pure functions, no per-instance state. */
export interface BlockEmitter {
    /** Class name this emitter handles (e.g. "InputBlock"). */
    readonly className: string;
    /** Emit the value of `outputName` for `block`, returning a WGSL expression. */
    emit(block: NodeBlock, outputName: string, state: NodeBuildState, ctx: NodeEmitContext): string;
}

export interface NodeEmitContext {
    /** Recursively resolve an input → WGSL expression (handles default values + memoization). */
    readonly resolve: (block: NodeBlock, inputName: string, state: NodeBuildState) => string;
    /** Mint a fresh SSA temp name. */
    readonly temp: (state: NodeBuildState, prefix?: string) => string;
}
