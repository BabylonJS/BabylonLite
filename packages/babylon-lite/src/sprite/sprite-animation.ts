/** Optional Babylon.js-style frame animation core for sprite families. */
import type { EngineContext, EngineContextInternal } from "../engine/engine.js";
import type { SceneContextInternal } from "../scene/scene-core.js";
import type { SceneContext } from "../scene/scene.js";
import type { SpriteRenderer } from "./sprite-renderer.js";

export interface SpriteAnimationTarget {
    readonly kind: string;
    readonly setFrame: (frame: number) => void;
    readonly remove?: () => void;
    readonly isAlive?: () => boolean;
}

export interface PlaySpriteAnimationOptions {
    readonly onEnd?: () => void;
    readonly removeWhenFinished?: boolean;
}

export interface SpriteFrameAnimation {
    readonly _entityType: "sprite-frame-animation";
    readonly target: SpriteAnimationTarget;
    from: number;
    to: number;
    current: number;
    loop: boolean;
    delayMs: number;
    accumulatedMs: number;
    animationStarted: boolean;
    onEnd?: () => void;
    removeWhenFinished: boolean;
    _direction: 1 | -1;
}

export interface SpriteAnimationManagerOptions {
    readonly engine?: EngineContext;
    readonly fixedDeltaMs?: number;
    readonly onUpdate?: (deltaMs: number) => void;
}

export interface SpriteAnimationManager {
    readonly _entityType: "sprite-animation-manager";
    animations: SpriteFrameAnimation[];
    fixedDeltaMs: number;
    running: boolean;
    readonly engine?: EngineContext;
    readonly onUpdate?: (deltaMs: number) => void;
    _rafId: number;
    _lastTime: number;
    _binding?: SpriteAnimationBinding;
}

export interface SpriteAnimationBinding {
    readonly _entityType: "sprite-animation-binding";
    active: boolean;
    _dispose: () => void;
}

interface SpriteRendererWithEngine extends SpriteRenderer {
    readonly _engine?: EngineContextInternal;
    _update: () => void;
}

function normalizeDelay(delayMs: number): number {
    return Number.isFinite(delayMs) && delayMs > 1 ? delayMs : 1;
}

export function createSpriteAnimationManager(options?: SpriteAnimationManagerOptions): SpriteAnimationManager {
    return {
        _entityType: "sprite-animation-manager",
        animations: [],
        fixedDeltaMs: options?.fixedDeltaMs ?? 0,
        running: false,
        engine: options?.engine,
        onUpdate: options?.onUpdate,
        _rafId: 0,
        _lastTime: 0,
    };
}

export function createSpriteFrameAnimation(
    target: SpriteAnimationTarget,
    from: number,
    to: number,
    loop: boolean,
    delayMs: number,
    options?: PlaySpriteAnimationOptions
): SpriteFrameAnimation {
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
        throw new Error("Sprite frame animation requires finite from/to frame indices.");
    }
    const fromFrame = Math.trunc(from);
    const toFrame = Math.trunc(to);
    const animation: SpriteFrameAnimation = {
        _entityType: "sprite-frame-animation",
        target,
        from: fromFrame,
        to: toFrame,
        current: fromFrame,
        loop,
        delayMs: normalizeDelay(delayMs),
        accumulatedMs: 0,
        animationStarted: true,
        onEnd: options?.onEnd,
        removeWhenFinished: options?.removeWhenFinished === true,
        _direction: fromFrame > toFrame ? -1 : 1,
    };
    target.setFrame(fromFrame);
    return animation;
}

export function addSpriteAnimation(manager: SpriteAnimationManager, animation: SpriteFrameAnimation): void {
    if (manager.animations.indexOf(animation) === -1) {
        manager.animations.push(animation);
    }
}

export function removeSpriteAnimation(manager: SpriteAnimationManager, animation: SpriteFrameAnimation): void {
    const index = manager.animations.indexOf(animation);
    if (index !== -1) {
        manager.animations.splice(index, 1);
    }
}

export function clearSpriteAnimations(manager: SpriteAnimationManager): void {
    manager.animations.length = 0;
}

export function playSpriteFrameAnimation(animation: SpriteFrameAnimation, from = animation.from, to = animation.to, loop = animation.loop, delayMs = animation.delayMs): void {
    const fromFrame = Math.trunc(from);
    const toFrame = Math.trunc(to);
    animation.from = fromFrame;
    animation.to = toFrame;
    animation.current = fromFrame;
    animation.loop = loop;
    animation.delayMs = normalizeDelay(delayMs);
    animation.accumulatedMs = 0;
    animation.animationStarted = true;
    animation._direction = fromFrame > toFrame ? -1 : 1;
    animation.target.setFrame(fromFrame);
}

export function stopSpriteAnimation(animation: SpriteFrameAnimation): void {
    animation.animationStarted = false;
}

export function updateSpriteAnimationManager(manager: SpriteAnimationManager, deltaMs: number): void {
    const stepMs = manager.fixedDeltaMs > 0 ? manager.fixedDeltaMs : deltaMs;
    if (!Number.isFinite(stepMs) || stepMs < 0) {
        return;
    }
    const animations = manager.animations;
    for (let index = animations.length - 1; index >= 0; index--) {
        const animation = animations[index]!;
        if (!advanceSpriteAnimation(animation, stepMs)) {
            animations.splice(index, 1);
        }
    }
}

function advanceSpriteAnimation(animation: SpriteFrameAnimation, deltaMs: number): boolean {
    if (animation.target.isAlive?.() === false) {
        animation.animationStarted = false;
        return false;
    }
    if (!animation.animationStarted) {
        return true;
    }

    animation.accumulatedMs += deltaMs;
    if (animation.accumulatedMs <= animation.delayMs) {
        return true;
    }

    animation.accumulatedMs = animation.accumulatedMs % animation.delayMs;
    const next = animation.current + animation._direction;
    const passedEnd = animation._direction > 0 ? next > animation.to : next < animation.to;
    if (!passedEnd) {
        animation.current = next;
        animation.target.setFrame(next);
        return true;
    }

    if (animation.loop) {
        animation.current = animation.from;
        animation.target.setFrame(animation.from);
        return true;
    }

    animation.current = animation.to;
    animation.target.setFrame(animation.to);
    animation.animationStarted = false;
    animation.onEnd?.();
    if (animation.removeWhenFinished) {
        animation.target.remove?.();
    }
    return false;
}

export function startSpriteAnimationManager(manager: SpriteAnimationManager): void {
    if (manager.running) {
        return;
    }
    if (typeof requestAnimationFrame !== "function" || typeof cancelAnimationFrame !== "function") {
        throw new Error("SpriteAnimationManager autonomous mode requires requestAnimationFrame.");
    }
    manager.running = true;
    manager._lastTime = 0;
    const tick = (now: number): void => {
        if (!manager.running) {
            return;
        }
        const deltaMs = manager._lastTime > 0 ? now - manager._lastTime : 0;
        manager._lastTime = now;
        updateSpriteAnimationManager(manager, deltaMs);
        manager.onUpdate?.(manager.fixedDeltaMs > 0 ? manager.fixedDeltaMs : deltaMs);
        manager._rafId = requestAnimationFrame(tick);
    };
    manager._rafId = requestAnimationFrame(tick);
}

export function stopSpriteAnimationManager(manager: SpriteAnimationManager): void {
    if (!manager.running) {
        return;
    }
    cancelAnimationFrame(manager._rafId);
    manager._rafId = 0;
    manager._lastTime = 0;
    manager.running = false;
}

export function attachSpriteAnimationsToScene(scene: SceneContext, manager: SpriteAnimationManager): SpriteAnimationBinding {
    assertNoActiveBinding(manager);
    const sceneInternal = scene as SceneContextInternal;
    const hook = (deltaMs: number): void => {
        updateSpriteAnimationManager(manager, deltaMs);
    };
    sceneInternal._beforeRender.unshift(hook);

    const binding: SpriteAnimationBinding = {
        _entityType: "sprite-animation-binding",
        active: true,
        _dispose: () => {
            const index = sceneInternal._beforeRender.indexOf(hook);
            if (index !== -1) {
                sceneInternal._beforeRender.splice(index, 1);
            }
        },
    };
    manager._binding = binding;
    return binding;
}

export function attachSpriteAnimationsToRenderer(renderer: SpriteRenderer, manager: SpriteAnimationManager): SpriteAnimationBinding {
    assertNoActiveBinding(manager);
    const rendererInternal = renderer as SpriteRendererWithEngine;
    const originalUpdate = rendererInternal._update;
    const wrappedUpdate = (): void => {
        updateSpriteAnimationManager(manager, rendererInternal._engine?._currentDelta ?? 0);
        originalUpdate.call(renderer);
    };
    rendererInternal._update = wrappedUpdate;

    const binding: SpriteAnimationBinding = {
        _entityType: "sprite-animation-binding",
        active: true,
        _dispose: () => {
            if (rendererInternal._update === wrappedUpdate) {
                rendererInternal._update = originalUpdate;
            }
        },
    };
    manager._binding = binding;
    return binding;
}

export function disposeSpriteAnimationBinding(binding: SpriteAnimationBinding): void {
    if (!binding.active) {
        return;
    }
    binding.active = false;
    binding._dispose();
}

function assertNoActiveBinding(manager: SpriteAnimationManager): void {
    if (manager._binding?.active) {
        throw new Error("SpriteAnimationManager is already attached to a render loop.");
    }
}
