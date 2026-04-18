import { describe, it, expect, vi } from "vitest";
import { createNamedSpriteAtlas } from "../../packages/babylon-lite/src/sprite/shared/sprite-atlas";
import { advanceSpriteClip, createSpriteClipState, evaluateSpriteClip } from "../../packages/babylon-lite/src/sprite/shared/sprite-animation";
import type { Texture2D } from "../../packages/babylon-lite/src/texture/texture-2d";

function fakeAtlas() {
    const tex: Texture2D = { texture: {} as GPUTexture, view: {} as GPUTextureView, sampler: {} as GPUSampler, width: 64, height: 64 };
    return createNamedSpriteAtlas(
        tex,
        Array.from({ length: 4 }, (_, i) => ({
            name: `f${i}`,
            uvMin: [0, 0] as [number, number],
            uvMax: [1, 1] as [number, number],
            sourceSizePx: [16, 16] as [number, number],
            pivot: [0.5, 0.5] as [number, number],
        })),
        [
            { name: "loop", frames: [0, 1, 2, 3], fps: 10, loop: true },
            { name: "once", frames: [0, 1, 2, 3], fps: 10, loop: false },
        ]
    );
}

describe("evaluateSpriteClip", () => {
    it("returns frame 0 at elapsed 0", () => {
        const atlas = fakeAtlas();
        const state = createSpriteClipState({ clipIndex: 0 });
        expect(evaluateSpriteClip(atlas, state)).toBe(0);
    });

    it("wraps around at the end of a looping clip", () => {
        const atlas = fakeAtlas();
        // 10 fps → 100 ms per frame. After 450 ms loop is at frame index 4 % 4 = 0.
        const state = createSpriteClipState({ clipIndex: 0, elapsedMs: 450 });
        expect(evaluateSpriteClip(atlas, state)).toBe(0);
    });

    it("clamps to the last frame for a non-looping clip", () => {
        const atlas = fakeAtlas();
        const state = createSpriteClipState({ clipIndex: 1, elapsedMs: 10_000 });
        expect(evaluateSpriteClip(atlas, state)).toBe(3);
    });
});

describe("advanceSpriteClip", () => {
    it("advances elapsed time and returns the matching frame", () => {
        const atlas = fakeAtlas();
        const state = createSpriteClipState({ clipIndex: 0 });
        // 100 ms → frame 1
        expect(advanceSpriteClip(atlas, state, 100)).toBe(1);
        expect(advanceSpriteClip(atlas, state, 100)).toBe(2);
    });

    it("fires onEnd exactly once for a non-looping clip", () => {
        const atlas = fakeAtlas();
        const onEnd = vi.fn();
        const state = createSpriteClipState({ clipIndex: 1, onEnd });
        advanceSpriteClip(atlas, state, 1000); // well past end
        advanceSpriteClip(atlas, state, 1000);
        expect(onEnd).toHaveBeenCalledTimes(1);
        expect(state.playing).toBe(false);
    });

    it("respects speed multiplier", () => {
        const atlas = fakeAtlas();
        const state = createSpriteClipState({ clipIndex: 0, speed: 2 });
        // Advance 50 ms at 2× → effective 100 ms → frame 1.
        expect(advanceSpriteClip(atlas, state, 50)).toBe(1);
    });

    it("returns a static frame when paused", () => {
        const atlas = fakeAtlas();
        const state = createSpriteClipState({ clipIndex: 0, playing: false });
        const before = state.elapsedMs;
        expect(advanceSpriteClip(atlas, state, 1000)).toBe(0);
        expect(state.elapsedMs).toBe(before);
    });
});
