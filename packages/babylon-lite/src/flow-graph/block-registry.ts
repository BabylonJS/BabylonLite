// Tree-shakable, side-effect-free block-def registry. Returns a lazy loader for
// one block def, or `null` for an unknown type. Each `case` dynamic-imports a
// single block module so unused blocks are code-split and never fetched — zero
// bytes for scenes without interactivity. Mirrors BJS `blockFactory` and Lite's
// `gltf-feature-registry`.
//
// Phase 2 lands the vertical-slice blocks (events, control-flow, one math op,
// property/variable data, animation). Add one `case` per block as more land
// (Phase 3+). The `switch` body stays pure (no module-level allocation),
// keeping this module fully tree-shakable.
//
// Unknown-op policy lives in the CALLER: `createFgEnv` (KHR_interactivity path)
// fails loudly on `null`; a permissive editor path (post-MVP) may substitute a
// no-op. Never silently swallow an unknown op on the KHR path.

import type { FgBlockDef } from "./block-def.js";
import { FgBlockType } from "./block-type.js";

export function getBlockDef(type: string): (() => Promise<FgBlockDef>) | null {
    switch (type) {
        // ─── Events ───────────────────────────────────────────────
        case FgBlockType.SceneStart:
            return async () => (await import("./blocks/events/scene-start.js")).sceneStartDef;
        case FgBlockType.SceneTick:
            return async () => (await import("./blocks/events/scene-tick.js")).sceneTickDef;

        // ─── Control flow ─────────────────────────────────────────
        case FgBlockType.Branch:
            return async () => (await import("./blocks/control-flow/branch.js")).branchDef;
        case FgBlockType.Sequence:
            return async () => (await import("./blocks/control-flow/sequence.js")).sequenceDef;

        // ─── Math ─────────────────────────────────────────────────
        case FgBlockType.Add:
            return async () => (await import("./blocks/math/add.js")).addDef;

        // ─── Data: property / variable ────────────────────────────
        case FgBlockType.GetProperty:
            return async () => (await import("./blocks/data/get-property.js")).getPropertyDef;
        case FgBlockType.SetProperty:
            return async () => (await import("./blocks/data/set-property.js")).setPropertyDef;
        case FgBlockType.GetVariable:
            return async () => (await import("./blocks/data/get-variable.js")).getVariableDef;
        case FgBlockType.SetVariable:
            return async () => (await import("./blocks/data/set-variable.js")).setVariableDef;

        // ─── Animation ────────────────────────────────────────────
        case FgBlockType.PlayAnimation:
            return async () => (await import("./blocks/animation/play-animation.js")).playAnimationDef;
        case FgBlockType.StopAnimation:
            return async () => (await import("./blocks/animation/stop-animation.js")).stopAnimationDef;

        // ─── Debug ────────────────────────────────────────────────
        case FgBlockType.ConsoleLog:
            return async () => (await import("./blocks/debug/console-log.js")).consoleLogDef;

        default:
            return null;
    }
}
