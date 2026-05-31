/**
 * Atmospheric clouds for the Freeciv demo — two layers of slowly drifting
 * procedural clouds that float over the parchment backdrop, behind the map. All
 * on Lite's own sprite path (no engine changes, no shader passes, no assets).
 *
 * The clouds are procedural: at load we synthesise a seamless fBm cloud texture
 * in plain JS, upload it with `createTexture2DFromPixels`, and draw it as pure-2D
 * HUD sprites *behind* the tilemap (negative `order`). They drift on their own and
 * parallax against the map pan (slower than the terrain → reads as depth); two
 * layers at different scales/speeds hide the texture's tiling and add a second
 * parallax cue. Kept subtle so the map and backdrop stay legible.
 *
 * Texture scrolling on the sprite path has no per-sprite UV offset, so each cloud
 * "layer" is a wrapped grid of full-texture sprites repositioned every frame —
 * cheap (≈100 sprites total) and seamless because the fBm texture tiles.
 */

import {
    addSprite2DIndex,
    addSpriteRendererLayer,
    createGridSpriteAtlas,
    createSprite2DLayer,
    createTexture2DFromPixels,
    removeSpriteRendererLayer,
    updateSprite2DIndex,
    type EngineContext,
    type Sprite2DLayer,
    type SpriteRenderer,
} from "babylon-lite";

/** Just the slice of the demo's view the parallax needs. */
export interface AtmosphereView {
    x: number;
    y: number;
}

export interface Atmosphere {
    /** Advance the drift and reposition the background for the current view/size. */
    update: (view: AtmosphereView) => void;
    /** Remove the background layers from the renderer. */
    dispose: () => void;
}

/** One drifting cloud sheet: a wrapped grid of full-texture sprites. */
interface CloudField {
    layer: Sprite2DLayer;
    sprites: number[];
    tilePx: number; // on-screen tile size in device px
    speed: [number, number]; // drift, device px per ms
    parallax: number; // fraction of map pan applied
    offset: [number, number]; // accumulated drift+parallax phase
}

// ── Procedural texture synthesis ─────────────────────────────────────────────

function smooth(t: number): number {
    return t * t * (3 - 2 * t);
}

/** Hash a lattice point to [0,1), wrapping coords by `period` so the field tiles. */
function latticeHash(ix: number, iy: number, period: number): number {
    const x = ((ix % period) + period) % period;
    const y = ((iy % period) + period) % period;
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}

/** Periodic value noise at `(x, y)` with integer lattice period `period`. */
function valueNoise(x: number, y: number, period: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const v00 = latticeHash(x0, y0, period);
    const v10 = latticeHash(x0 + 1, y0, period);
    const v01 = latticeHash(x0, y0 + 1, period);
    const v11 = latticeHash(x0 + 1, y0 + 1, period);
    const a = v00 + (v10 - v00) * fx;
    const b = v01 + (v11 - v01) * fx;
    return a + (b - a) * fy;
}

/**
 * Seamless fBm in `[0,1)` over a `size`-px texture. Octave frequencies are integer
 * cell counts that divide `size`, and each octave's lattice period equals its
 * frequency, so the field wraps cleanly at the texture border (tileable).
 */
function fbm(px: number, py: number, size: number, baseFreq: number, octaves: number): number {
    let amp = 0.5;
    let freq = baseFreq;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
        sum += amp * valueNoise((px / size) * freq, (py / size) * freq, freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return sum / norm;
}

/**
 * A `size×size` seamless RGBA cloud sheet: cool-white puffs with a soft alpha
 * curve (a low threshold leaves open gaps so the backdrop shows between clouds).
 */
function makeClouds(size: number, baseFreq: number, maxAlpha: number): Uint8Array {
    const px = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const d = fbm(x, y, size, baseFreq, 5);
            // Puffy: nothing below `lo`, ramping to full by `hi`.
            const lo = 0.45;
            const hi = 0.82;
            const a = Math.max(0, Math.min(1, (d - lo) / (hi - lo)));
            const o = (y * size + x) * 4;
            px[o] = 206;
            px[o + 1] = 220;
            px[o + 2] = 240;
            px[o + 3] = Math.round(smooth(a) * maxAlpha * 255);
        }
    }
    return px;
}

// ── Build ─────────────────────────────────────────────────────────────────────

/** Generous per-cloud-layer sprite budget (covers a 4K screen at the smaller tile). */
const CLOUD_CAPACITY = 160;

function buildCloudField(
    engine: EngineContext,
    sr: SpriteRenderer,
    order: number,
    sizePx: number,
    baseFreq: number,
    maxAlpha: number,
    tilePx: number,
    speed: [number, number],
    parallax: number,
): CloudField {
    const tex = createTexture2DFromPixels(engine, makeClouds(sizePx, baseFreq, maxAlpha), sizePx, sizePx);
    const atlas = createGridSpriteAtlas(tex, { cellWidthPx: sizePx, cellHeightPx: sizePx, pivot: [0, 0] });
    const layer = createSprite2DLayer(atlas, { capacity: CLOUD_CAPACITY, order, pivot: [0, 0] });
    addSpriteRendererLayer(sr, layer);
    const sprites: number[] = [];
    for (let i = 0; i < CLOUD_CAPACITY; i++) {
        sprites.push(addSprite2DIndex(layer, { positionPx: [0, 0], sizePx: [tilePx, tilePx], visible: false }));
    }
    return { layer, sprites, tilePx, speed, parallax, offset: [0, 0] };
}

/** Build the {@link Atmosphere}: two layers of subtly drifting clouds. */
export function createAtmosphere(engine: EngineContext, sr: SpriteRenderer): Atmosphere {
    // Two cloud sheets drifting over the parchment backdrop: a big, faint, slow far
    // layer and a smaller, slightly stronger, faster near layer. Different scales +
    // speeds hide the tiling and add depth. Kept subtle so the map reads clearly.
    const far = buildCloudField(engine, sr, -22, 256, 3, 0.16, 560, [0.0045, 0.0022], 0.05);
    const near = buildCloudField(engine, sr, -20, 256, 5, 0.22, 340, [0.011, 0.006], 0.13);

    let last = performance.now();

    function placeField(f: CloudField, view: AtmosphereView, w: number, h: number, dt: number): void {
        // Advance drift; fold the map pan in at a fraction (parallax). Wrap the phase
        // into [0, tile) so the grid can cover the screen with a fixed sprite budget.
        f.offset[0] += f.speed[0] * dt;
        f.offset[1] += f.speed[1] * dt;
        const ox = f.offset[0] + view.x * f.parallax;
        const oy = f.offset[1] + view.y * f.parallax;
        const t = f.tilePx;
        const wrapX = ((ox % t) + t) % t;
        const wrapY = ((oy % t) + t) % t;
        const cols = Math.ceil(w / t) + 1;
        const rows = Math.ceil(h / t) + 1;
        let idx = 0;
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols && idx < f.sprites.length; i++) {
                updateSprite2DIndex(f.layer, f.sprites[idx]!, {
                    positionPx: [i * t - wrapX, j * t - wrapY],
                    visible: true,
                });
                idx++;
            }
        }
        for (; idx < f.sprites.length; idx++) {
            updateSprite2DIndex(f.layer, f.sprites[idx]!, { visible: false });
        }
    }

    return {
        update(view: AtmosphereView): void {
            const now = performance.now();
            const dt = Math.min(100, now - last);
            last = now;
            const w = engine.canvas.width || 1;
            const h = engine.canvas.height || 1;
            placeField(far, view, w, h, dt);
            placeField(near, view, w, h, dt);
        },
        dispose(): void {
            removeSpriteRendererLayer(sr, far.layer);
            removeSpriteRendererLayer(sr, near.layer);
        },
    };
}
