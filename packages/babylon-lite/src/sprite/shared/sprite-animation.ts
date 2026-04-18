/**
 * Sprite clip animation state and evaluation.
 *
 * A clip is a list of frame indices played at a given fps. Per-sprite state
 * tracks elapsed time and a play/pause flag. The state objects live in a
 * sparse `Map<spriteIndex, SpriteClipState>` on the layer — only sprites
 * with active clips have entries, so static layers pay zero per-frame cost.
 */

import type { SpriteAtlas } from "./sprite-atlas.js";

export interface SpriteClipState {
    clipIndex: number;
    elapsedMs: number;
    speed: number;
    playing: boolean;
    loopOverride: boolean | null;
    onEnd?: () => void;
}

export function createSpriteClipState(opts: Partial<SpriteClipState> = {}): SpriteClipState {
    return {
        clipIndex: opts.clipIndex ?? 0,
        elapsedMs: opts.elapsedMs ?? 0,
        speed: opts.speed ?? 1,
        playing: opts.playing ?? true,
        loopOverride: opts.loopOverride ?? null,
        onEnd: opts.onEnd,
    };
}

/** Return the current frame index implied by `state.elapsedMs` and the clip's fps. */
export function evaluateSpriteClip(atlas: SpriteAtlas, state: SpriteClipState): number {
    const clip = atlas.clips[state.clipIndex];
    if (!clip || clip.frames.length === 0) {
        return 0;
    }
    const loop = state.loopOverride ?? clip.loop;
    const totalFrames = clip.frames.length;
    const frameMs = 1000 / clip.fps;
    const raw = state.elapsedMs / frameMs;
    let i: number;
    if (loop) {
        i = Math.floor(raw) % totalFrames;
        if (i < 0) {
            i += totalFrames;
        }
    } else {
        i = Math.min(Math.floor(raw), totalFrames - 1);
    }
    return clip.frames[i]!;
}

/** Advance the clip by `deltaMs` (scaled by `state.speed`) and return the new frame index.
 *  Fires `onEnd` exactly once when a non-looping clip reaches its last frame. */
export function advanceSpriteClip(atlas: SpriteAtlas, state: SpriteClipState, deltaMs: number): number {
    if (!state.playing) {
        return evaluateSpriteClip(atlas, state);
    }
    const clip = atlas.clips[state.clipIndex];
    if (!clip || clip.frames.length === 0) {
        return 0;
    }
    const loop = state.loopOverride ?? clip.loop;
    state.elapsedMs += deltaMs * state.speed;
    if (!loop) {
        const total = (clip.frames.length * 1000) / clip.fps;
        if (state.elapsedMs >= total) {
            state.elapsedMs = total;
            if (state.playing) {
                state.playing = false;
                if (state.onEnd) {
                    state.onEnd();
                }
            }
        }
    }
    return evaluateSpriteClip(atlas, state);
}
