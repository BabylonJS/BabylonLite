/** Node Material — public API.
 *
 *  This module is the user-facing entry point for NME (Node Material Editor)
 *  snippets. Scenes that never reference these exports tree-shake the entire
 *  `material/node/` subtree to zero bytes (per GUIDANCE §4 and the bundle-size
 *  invariant captured by `tests/parity/bundle-size.spec.ts`).
 *
 *  Phase 1 status: scaffold only. The parser, emitter, and block library land
 *  in subsequent commits (see `plan.md`). The function below throws so that
 *  any premature consumer fails loudly rather than silently rendering garbage.
 */

import type { EngineContext } from "../../engine/engine.js";
import type { Texture2D } from "../../texture/texture-2d.js";
import type { MeshGroupBuilder } from "../../render/renderable.js";

/** Plain-data handle returned by `parseNodeMaterialFromSnippet`. */
export interface NodeMaterial {
    /** Named overridable inputs — colors, vectors, floats, textures — keyed by
     *  the InputBlock's author-provided name. Mutating these between frames
     *  marks the material dirty so the next frame uploads fresh UBO data. */
    readonly inputs: Record<string, NodeInputHandle>;
    /** Internal: scene queries this to dispatch the build. */
    readonly _buildGroup: MeshGroupBuilder;
}

/** A handle to a single named input on a NodeMaterial. */
export interface NodeInputHandle {
    readonly type: "f32" | "vec2f" | "vec3f" | "vec4f" | "texture2d";
    /** Current scalar/vector value. Length matches `type`. Undefined for textures. */
    value?: number | number[];
    /** Current texture (when `type === "texture2d"`). */
    texture?: Texture2D | null;
}

/** Options for `parseNodeMaterialFromSnippet`. */
export interface ParseNodeMaterialOptions {
    /** Snippet host. Defaults to the official Babylon snippet server. */
    readonly snippetServer?: string;
    /** Pre-resolved JSON, used by tests to bypass the network. */
    readonly json?: string;
}

/** Fetch and parse a Babylon NME snippet (e.g. `"AT7YY5#6"`).
 *
 *  Phase 1 stub: throws `Error("not implemented")`. The real implementation
 *  arrives with the `nme-parser` + `nme-emitter-core` milestones.
 */
export async function parseNodeMaterialFromSnippet(_engine: EngineContext, _snippetId: string, _options?: ParseNodeMaterialOptions): Promise<NodeMaterial> {
    throw new Error("parseNodeMaterialFromSnippet: not implemented (NME phase 1 in progress)");
}
