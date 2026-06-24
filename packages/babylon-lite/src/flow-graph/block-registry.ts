// Tree-shakable, side-effect-free block-def registry. Returns a lazy loader for
// one block def, or `null` for an unknown type. Each `case` dynamic-imports a
// single block module so unused blocks are code-split and never fetched — zero
// bytes for scenes without interactivity. Mirrors BJS `blockFactory` and Lite's
// `gltf-feature-registry`.
//
// Phase 1 ships NO blocks, so every type currently resolves to `null`. As blocks
// land (Phase 2+), add one `case` per block here. The `switch` body stays pure
// (no module-level allocation), keeping this module fully tree-shakable.
//
// Unknown-op policy lives in the CALLER: `createFgEnv` (KHR_interactivity path)
// fails loudly on `null`; a permissive editor path (post-MVP) may substitute a
// no-op. Never silently swallow an unknown op on the KHR path.

import type { FgBlockDef } from "./block-def.js";

export function getBlockDef(type: string): (() => Promise<FgBlockDef>) | null {
    switch (type) {
        // Phase 2 will add e.g.:
        //   case FgBlockType.Branch:
        //       return async () => (await import("./blocks/control-flow/branch.js")).branchDef;
        default:
            return null;
    }
}
