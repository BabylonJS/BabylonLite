import type { EngineContext } from "../engine/engine.js";
import type { AnimationGroup } from "../animation/animation-group.js";
import { addAnimationGroups, clearAnimationManager, createAnimationManager, updateAnimationManager } from "../animation/animation-manager-core.js";
import type { AnimationManager } from "../animation/animation-manager-core.js";

export function createSceneAnimationManager(engine: EngineContext): AnimationManager {
    return createAnimationManager({ engine });
}

export function addSceneAnimationGroups(manager: AnimationManager, groups: readonly AnimationGroup[]): void {
    addAnimationGroups(manager, groups);
}

export function updateSceneAnimationManager(manager: AnimationManager, deltaMs: number): void {
    updateAnimationManager(manager, deltaMs);
}

export function clearSceneAnimationManager(manager: AnimationManager): void {
    clearAnimationManager(manager);
}
