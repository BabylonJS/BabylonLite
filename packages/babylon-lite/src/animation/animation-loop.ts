export interface AnimationLoopState {
    fixedDeltaMs: number;
    running: boolean;
    readonly onUpdate?: (deltaMs: number) => void;
    /** 0 is the inactive sentinel; browser RAF handles are non-zero in supported runtimes. */
    _rafId: number;
    _lastTime: number;
}

export function startAnimationLoop(state: AnimationLoopState, update: (deltaMs: number) => void, missingRafMessage: string): void {
    if (state.running) {
        return;
    }
    if (typeof requestAnimationFrame !== "function" || typeof cancelAnimationFrame !== "function") {
        throw new Error(missingRafMessage);
    }
    state.running = true;
    state._lastTime = 0;
    const tick = (now: number): void => {
        if (!state.running) {
            return;
        }
        const deltaMs = state._lastTime > 0 ? now - state._lastTime : 0;
        state._lastTime = now;
        update(deltaMs);
        state.onUpdate?.(state.fixedDeltaMs > 0 ? state.fixedDeltaMs : deltaMs);
        state._rafId = requestAnimationFrame(tick);
    };
    state._rafId = requestAnimationFrame(tick);
}

export function stopAnimationLoop(state: AnimationLoopState): void {
    if (!state.running) {
        return;
    }
    cancelAnimationFrame(state._rafId);
    state._rafId = 0;
    state._lastTime = 0;
    state.running = false;
}
