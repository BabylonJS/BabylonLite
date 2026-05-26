import type { EngineContext } from "../engine/engine.js";

export interface AnimationTask {
    readonly _entityType: "animation-task";
    active: boolean;
}

export type AnimationTaskUpdate = (manager: AnimationManager, deltaMs: number) => boolean | void;
export type AnimationTaskCategoryHandler = (manager: AnimationManager, deltaMs: number) => boolean;

export interface AnimationTaskOptions {
    readonly category?: string;
    readonly dispose?: (manager: AnimationManager) => void;
}

interface AnimationTaskInternal extends AnimationTask {
    _update: AnimationTaskUpdate;
    _dispose?: (manager: AnimationManager) => void;
    readonly _category?: string;
}

export interface AnimationManagerOptions {
    readonly engine?: EngineContext;
    readonly fixedDeltaMs?: number;
    readonly onUpdate?: (deltaMs: number) => void;
}

export interface AnimationManager {
    animations: AnimationTask[];
    fixedDeltaMs: number;
    running: boolean;
    readonly engine?: EngineContext;
    readonly onUpdate?: (deltaMs: number) => void;
    /** @internal Optional feature updaters installed by category-specific adapters. */
    _categoryHandlers?: Array<{ readonly category: string; handler: AnimationTaskCategoryHandler }>;
    _rafId: number;
    _lastTime: number;
}

let animationTaskOwners: WeakMap<AnimationTask, AnimationManager> | undefined;

function getAnimationTaskOwners(): WeakMap<AnimationTask, AnimationManager> {
    if (!animationTaskOwners) {
        animationTaskOwners = new WeakMap();
    }
    return animationTaskOwners;
}

function asAnimationTaskInternal(task: AnimationTask): AnimationTaskInternal {
    const internal = task as Partial<AnimationTaskInternal>;
    if (typeof internal._update !== "function") {
        throw new Error("AnimationTask must be created by createAnimationTask.");
    }
    return task as AnimationTaskInternal;
}

export function getAnimationTaskOwner(task: AnimationTask): AnimationManager | undefined {
    return animationTaskOwners?.get(task);
}

export function createAnimationTask(update: AnimationTaskUpdate, options?: AnimationTaskOptions): AnimationTask {
    if (typeof update !== "function") {
        throw new Error("createAnimationTask requires an update function.");
    }
    return {
        _entityType: "animation-task",
        active: true,
        _update: update,
        _category: options?.category,
        _dispose: options?.dispose,
    } as AnimationTaskInternal;
}

export function createAnimationManager(options?: AnimationManagerOptions): AnimationManager {
    return {
        animations: [],
        fixedDeltaMs: options?.fixedDeltaMs ?? 0,
        running: false,
        engine: options?.engine,
        onUpdate: options?.onUpdate,
        _rafId: 0,
        _lastTime: 0,
    };
}

export function setAnimationTaskCategoryHandler(manager: AnimationManager, category: string, handler: AnimationTaskCategoryHandler): void {
    if (!category) {
        throw new Error("Animation task category handler requires a non-empty category.");
    }
    const handlers = manager._categoryHandlers ?? (manager._categoryHandlers = []);
    const existing = handlers.find((entry) => entry.category === category);
    if (existing) {
        existing.handler = handler;
        return;
    }
    handlers.push({ category, handler });
}

export function addAnimationTask(manager: AnimationManager, task: AnimationTask): void {
    const internal = asAnimationTaskInternal(task);
    const owner = getAnimationTaskOwner(task);
    if (owner === manager) {
        return;
    }
    if (owner) {
        throw new Error("AnimationTask is already attached to another AnimationManager");
    }
    task.active = true;
    getAnimationTaskOwners().set(task, manager);
    manager.animations.push(internal);
}

export function removeAnimationTask(manager: AnimationManager, task: AnimationTask): void {
    const index = manager.animations.indexOf(task);
    if (index !== -1) {
        removeAnimationTaskAt(manager, index);
    } else if (getAnimationTaskOwner(task) === manager) {
        getAnimationTaskOwners().delete(task);
        task.active = false;
    }
}

export function clearAnimationManager(manager: AnimationManager): void {
    while (manager.animations.length > 0) {
        removeAnimationTaskAt(manager, manager.animations.length - 1);
    }
}

export function updateAnimationManager(manager: AnimationManager, deltaMs: number): void {
    const step = manager.fixedDeltaMs > 0 ? manager.fixedDeltaMs : deltaMs;
    if (!Number.isFinite(step) || step < 0) {
        return;
    }
    const handledCategories = updateTaskCategories(manager, step);
    for (let index = 0; index < manager.animations.length; ) {
        const task = asAnimationTaskInternal(manager.animations[index]!);
        if (!task.active) {
            removeAnimationTaskAt(manager, index);
            continue;
        }
        if (task._category && handledCategories?.includes(task._category)) {
            index++;
            continue;
        }
        const keep = task._update(manager, step);
        if (keep === false || !task.active) {
            removeAnimationTaskAt(manager, index);
            continue;
        }
        index++;
    }
}

export function startAnimationManager(manager: AnimationManager): void {
    if (manager.running) {
        return;
    }
    if (typeof requestAnimationFrame !== "function" || typeof cancelAnimationFrame !== "function") {
        throw new Error("AnimationManager autonomous mode requires requestAnimationFrame");
    }
    manager.running = true;
    manager._lastTime = 0;
    const tick = (now: number): void => {
        if (!manager.running) {
            return;
        }
        const deltaMs = manager._lastTime > 0 ? now - manager._lastTime : 0;
        manager._lastTime = now;
        const step = manager.fixedDeltaMs > 0 ? manager.fixedDeltaMs : deltaMs;
        updateAnimationManager(manager, deltaMs);
        manager.onUpdate?.(step);
        manager._rafId = requestAnimationFrame(tick);
    };
    manager._rafId = requestAnimationFrame(tick);
}

export function stopAnimationManager(manager: AnimationManager): void {
    if (!manager.running) {
        return;
    }
    cancelAnimationFrame(manager._rafId);
    manager._rafId = 0;
    manager._lastTime = 0;
    manager.running = false;
}

function removeAnimationTaskAt(manager: AnimationManager, index: number): void {
    const task = manager.animations[index]!;
    manager.animations.splice(index, 1);
    if (getAnimationTaskOwner(task) === manager) {
        animationTaskOwners?.delete(task);
    }
    task.active = false;
    asAnimationTaskInternal(task)._dispose?.(manager);
}

function updateTaskCategories(manager: AnimationManager, deltaMs: number): string[] | undefined {
    const handlers = manager._categoryHandlers;
    if (!handlers?.length) {
        return undefined;
    }
    let handledCategories: string[] | undefined;
    for (const entry of handlers) {
        if (entry.handler(manager, deltaMs)) {
            handledCategories ??= [];
            handledCategories.push(entry.category);
        }
    }
    return handledCategories;
}
