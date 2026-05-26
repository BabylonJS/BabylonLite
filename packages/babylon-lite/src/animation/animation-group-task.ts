import { tickAnimation } from "./animation-group.js";
import type { AnimationGroup } from "./animation-group.js";
import { addAnimationTask, createAnimationTask, getAnimationTaskOwner, removeAnimationTask } from "./animation-manager.js";
import type { AnimationManager, AnimationTask } from "./animation-manager.js";

export const ANIMATION_GROUP_TASK_CATEGORY = "animation-group";

let animationGroupOwners: WeakMap<AnimationGroup, AnimationManager> | undefined;
let animationGroupTasks: WeakMap<AnimationGroup, AnimationTask> | undefined;
let animationGroupsByManager: WeakMap<AnimationManager, AnimationGroup[]> | undefined;

function getAnimationGroupOwners(): WeakMap<AnimationGroup, AnimationManager> {
    if (!animationGroupOwners) {
        animationGroupOwners = new WeakMap();
    }
    return animationGroupOwners;
}

function getAnimationGroupTasks(): WeakMap<AnimationGroup, AnimationTask> {
    if (!animationGroupTasks) {
        animationGroupTasks = new WeakMap();
    }
    return animationGroupTasks;
}

function getAnimationGroupsByManager(): WeakMap<AnimationManager, AnimationGroup[]> {
    if (!animationGroupsByManager) {
        animationGroupsByManager = new WeakMap();
    }
    return animationGroupsByManager;
}

function getMutableAnimationGroups(manager: AnimationManager): AnimationGroup[] {
    const groupsByManager = getAnimationGroupsByManager();
    let groups = groupsByManager.get(manager);
    if (!groups) {
        groups = [];
        groupsByManager.set(manager, groups);
    }
    return groups;
}

export function getAnimationGroups(manager: AnimationManager): readonly AnimationGroup[] {
    return animationGroupsByManager?.get(manager) ?? [];
}

export function getAnimationGroupOwner(group: AnimationGroup): AnimationManager | undefined {
    return animationGroupOwners?.get(group);
}

export function addAnimationGroup(manager: AnimationManager, group: AnimationGroup): void {
    const owner = getAnimationGroupOwner(group);
    if (owner && owner !== manager) {
        throw new Error(`AnimationGroup "${group.name}" is already attached to another AnimationManager`);
    }
    if (owner === manager) {
        return;
    }
    const task = createAnimationTask(
        (taskManager, deltaMs) => {
            tickAnimation(group, deltaMs, taskManager.engine);
        },
        {
            category: ANIMATION_GROUP_TASK_CATEGORY,
            dispose: (ownerManager) => {
                const groups = animationGroupsByManager?.get(ownerManager);
                const index = groups?.indexOf(group) ?? -1;
                if (groups && index !== -1) {
                    groups.splice(index, 1);
                    if (groups.length === 0) {
                        animationGroupsByManager?.delete(ownerManager);
                    }
                }
                if (getAnimationGroupOwner(group) === ownerManager) {
                    animationGroupOwners?.delete(group);
                }
                if (animationGroupTasks?.get(group) === task) {
                    animationGroupTasks.delete(group);
                }
            },
        }
    );
    getMutableAnimationGroups(manager).push(group);
    getAnimationGroupOwners().set(group, manager);
    getAnimationGroupTasks().set(group, task);
    addAnimationTask(manager, task);
}

export function addAnimationGroups(manager: AnimationManager, groups: readonly AnimationGroup[]): void {
    for (const group of groups) {
        addAnimationGroup(manager, group);
    }
}

export function removeAnimationGroup(manager: AnimationManager, group: AnimationGroup): void {
    const task = animationGroupTasks?.get(group);
    if (task && getAnimationTaskOwner(task) === manager) {
        removeAnimationTask(manager, task);
        return;
    }
    const groups = animationGroupsByManager?.get(manager);
    const index = groups?.indexOf(group) ?? -1;
    if (groups && index !== -1) {
        groups.splice(index, 1);
        if (groups.length === 0) {
            animationGroupsByManager?.delete(manager);
        }
    }
    if (getAnimationGroupOwner(group) === manager) {
        animationGroupOwners?.delete(group);
    }
}
