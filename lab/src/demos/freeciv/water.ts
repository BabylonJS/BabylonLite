/**
 * "Living water" overlay for the Freeciv demo — a gentle animated caustic
 * shimmer drawn on top of every ocean tile so the sea ripples instead of sitting
 * as a flat dark slab. Pure sprite path, no engine changes, no committed assets.
 *
 * The shimmer is a procedural caustic *flipbook*: at load we synthesise N frames
 * of a diamond-masked caustic pattern (interfering sine waves whose phase loops
 * cleanly over the N frames) into a single atlas row, then drop one sprite on
 * each ocean tile. Each tile is given its own phase offset — part travelling wave
 * (so ripples sweep across the map), part hash (so neighbours never pulse in
 * lock-step) — and we only nudge a tile's frame when the global flipbook index
 * actually advances (~12 fps), keeping the per-frame cost to a cheap throttle.
 *
 * Blending is plain alpha (additive isn't on the sprite path yet), so the caustic
 * veins read as pale light playing over the deep water rather than glare.
 */

import {
    addSprite2DIndex,
    createGridSpriteAtlas,
    createSprite2DLayer,
    createTexture2DFromPixels,
    updateSprite2DIndex,
    type EngineContext,
    type Sprite2DLayer,
} from "babylon-lite";
import { TILE_H, TILE_W, isoCentre } from "./iso.js";
import type { GameMap } from "./worldgen.js";

export interface Water {
    /** The shimmer layer — caller adds it to the panned/zoomed map layers. */
    layer: Sprite2DLayer;
    /** Advance the caustic flipbook (call once per frame). */
    update: () => void;
}

/** Caustic flipbook frame count; phase loops cleanly across these. */
const FRAMES = 24;
/** Milliseconds each flipbook frame is held (~12 fps shimmer). */
const FRAME_MS = 80;
/** Peak overlay opacity in a caustic crest. */
const MAX_ALPHA = 0.32;

function smooth(t: number): number {
    return t * t * (3 - 2 * t);
}

/** Cheap deterministic hash of a tile coord → [0,1). */
function hash2(x: number, y: number): number {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}

/**
 * Render the caustic flipbook into one wide RGBA atlas (`FRAMES` cells of
 * `TILE_W×TILE_H`). Each cell is masked to the iso diamond and fades at its edge
 * so it never bleeds onto neighbouring land.
 */
function makeCausticAtlas(): { data: Uint8Array; width: number; height: number } {
    const w = TILE_W * FRAMES;
    const h = TILE_H;
    const data = new Uint8Array(w * h * 4);
    for (let f = 0; f < FRAMES; f++) {
        const phase = (f / FRAMES) * Math.PI * 2;
        for (let j = 0; j < TILE_H; j++) {
            const v = ((j + 0.5) / TILE_H) * 2 - 1; // [-1,1]
            for (let i = 0; i < TILE_W; i++) {
                const u = ((i + 0.5) / TILE_W) * 2 - 1; // [-1,1]
                // Diamond mask with a soft inner feather (0 at the rim).
                const m = smooth(Math.max(0, Math.min(1, (1 - (Math.abs(u) + Math.abs(v))) / 0.32)));
                let c = 0;
                if (m > 0) {
                    // Three drifting wave fronts; +phase keeps the loop seamless.
                    c += Math.sin((u * 3.1 + v * 1.7) * Math.PI + phase);
                    c += Math.sin((u * -2.3 + v * 2.9) * Math.PI + phase * 1.3 + 1.7);
                    c += Math.sin((u * 1.3 - v * 3.7) * Math.PI - phase * 0.8 + 4.1);
                    c /= 3; // [-1,1]
                }
                // Sharpen into bright veins near the crests.
                const crest = smooth(Math.max(0, Math.min(1, (c - 0.15) / 0.7)));
                const a = crest * m * MAX_ALPHA;
                const o = (f * TILE_W + i + j * w) * 4;
                data[o] = 200;
                data[o + 1] = 226;
                data[o + 2] = 246;
                data[o + 3] = Math.round(a * 255);
            }
        }
    }
    return { data, width: w, height: h };
}

/** Build the {@link Water} shimmer for every ocean tile in `world`. */
export function createWater(engine: EngineContext, world: GameMap): Water {
    const { data, width, height } = makeCausticAtlas();
    const tex = createTexture2DFromPixels(engine, data, width, height);
    const atlas = createGridSpriteAtlas(tex, { cellWidthPx: TILE_W, cellHeightPx: TILE_H });

    // One sprite per ocean tile, sitting just above the ocean base (order 0) and
    // below the coastline foam (order 1).
    const tiles: { x: number; y: number }[] = [];
    for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
            if (world.isOcean(x, y)) tiles.push({ x, y });
        }
    }

    const layer = createSprite2DLayer(atlas, { capacity: tiles.length || 1, order: 0.5 });
    const sprites: number[] = [];
    const phase: number[] = [];
    for (const { x, y } of tiles) {
        const [px, py] = isoCentre(x, y);
        // Travelling wave across the map + per-tile jitter so it never marches in step.
        const p = Math.round((x * 0.7 + y * 0.4) + hash2(x, y) * FRAMES) % FRAMES;
        phase.push(p);
        sprites.push(addSprite2DIndex(layer, { positionPx: [px, py], sizePx: [TILE_W, TILE_H], frame: p }));
    }

    let lastIndex = -1;
    return {
        layer,
        update(): void {
            const index = Math.floor(performance.now() / FRAME_MS);
            if (index === lastIndex) return; // throttle to the flipbook rate
            lastIndex = index;
            for (let i = 0; i < sprites.length; i++) {
                updateSprite2DIndex(layer, sprites[i]!, { frame: (index + phase[i]!) % FRAMES });
            }
        },
    };
}
