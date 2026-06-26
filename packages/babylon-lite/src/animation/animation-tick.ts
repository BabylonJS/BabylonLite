// Per-frame animation stepping, split into its own leaf module (type-only imports) so the
// always-loaded scene-core chunk can statically import tickAnimation without pulling in the
// rest of animation-group.ts (createAnimationGroups + glTF binding helpers). Importing
// tickAnimation from animation-group.js would drag that whole module into every scene's
// always-loaded chunk, adding dead weight to non-animated scenes.

import type { EngineContext } from "../engine/engine.js";
import type { AnimationGroup } from "./animation-group.js";
import type { AnimationController } from "../skeleton/skeleton-updater.js";

/** @internal Push the group's public playback state into its controller. */
export function syncControllerFromGroup(group: AnimationGroup, ctrl: AnimationController): void {
    ctrl.time = group.currentTime;
    ctrl.playing = group.isPlaying;
    ctrl.speedRatio = group.speedRatio;
    ctrl.loop = group.loopAnimation;
    ctrl._setMask?.(group.mask ?? null);
}

/** @internal Advance animation by deltaMs. Called by the engine each frame. */
export function tickAnimation(group: AnimationGroup, deltaMs: number, engine?: EngineContext): void {
    if (!group._stopped && group._ctrl) {
        syncControllerFromGroup(group, group._ctrl);
        group._ctrl.tick(deltaMs, engine);
        group.currentTime = group._ctrl.time;
    }
}
