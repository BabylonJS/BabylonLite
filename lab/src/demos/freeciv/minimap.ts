/**
 * Overview minimap for the Freeciv demo.
 *
 * A small HTML `<canvas>` parked in the corner that paints the whole world in
 * map-space (a plain `width × height` grid of terrain-coloured pixels, NOT the
 * isometric projection — minimaps read best as a straight top-down rectangle).
 * On top it draws a marker per city and a polygon outlining the slice of the
 * world currently visible on the main canvas. Click or drag inside it to recentre
 * the main view on that tile.
 *
 * Pure overlay: it owns no engine state. The caller (freeciv.ts) supplies two
 * closures so all the view/zoom/snap math stays in one place — `viewportCorners`
 * (the four screen corners expressed in tile space) and `panToTile` (recentre).
 */

import { Terrain, type GameMap } from "./worldgen.js";

/** Minimap display size in CSS pixels (the longer map axis maps to this). */
const MINIMAP_MAX = 180;

/** Per-terrain overview colour (`[r, g, b]`, 0‒255). Indexed by {@link Terrain}. */
const TERRAIN_COLOR: Readonly<Record<Terrain, readonly [number, number, number]>> = {
    [Terrain.Ocean]: [38, 74, 115],
    [Terrain.Grassland]: [96, 152, 64],
    [Terrain.Plains]: [150, 168, 80],
    [Terrain.Desert]: [200, 182, 120],
    [Terrain.Forest]: [56, 104, 56],
    [Terrain.Jungle]: [72, 116, 60],
    [Terrain.Swamp]: [92, 110, 86],
    [Terrain.Hills]: [128, 132, 84],
    [Terrain.Mountains]: [134, 128, 120],
    [Terrain.Tundra]: [150, 156, 140],
    [Terrain.Arctic]: [228, 234, 240],
};

export interface MinimapHooks {
    /** Current main-view rectangle as four tile-space corners (TL, TR, BR, BL). */
    viewportCorners: () => ReadonlyArray<readonly [number, number]>;
    /** Recentre the main view on tile `(tx, ty)` (fractional tile coords allowed). */
    panToTile: (tx: number, ty: number) => void;
}

export interface Minimap {
    /** Redraw the dynamic overlay (viewport box + city dots) over the terrain. */
    update: () => void;
    /** Remove the minimap element. */
    dispose: () => void;
}

/** Build a {@link Minimap}. Renders the static terrain immediately. */
export function createMinimap(world: GameMap, hooks: MinimapHooks): Minimap {
    const aspect = world.width / world.height;
    const cssW = aspect >= 1 ? MINIMAP_MAX : Math.round(MINIMAP_MAX * aspect);
    const cssH = aspect >= 1 ? Math.round(MINIMAP_MAX / aspect) : MINIMAP_MAX;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));

    const canvas = document.createElement("canvas");
    canvas.id = "minimap";
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.cssText =
        `position:fixed;right:12px;bottom:12px;width:${cssW}px;height:${cssH}px;` +
        "z-index:45;border:1px solid rgba(150,190,230,0.55);border-radius:4px;" +
        "box-shadow:0 2px 10px rgba(0,0,0,0.45);cursor:crosshair;" +
        "background:rgba(8,16,28,0.6);image-rendering:pixelated;touch-action:none";
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // ── Static terrain layer: one pixel per tile, rendered once into an offscreen
    //    canvas, then upscaled (nearest) into the visible canvas every frame. ──────
    const terrainCanvas = document.createElement("canvas");
    terrainCanvas.width = world.width;
    terrainCanvas.height = world.height;
    const tctx = terrainCanvas.getContext("2d")!;
    const img = tctx.createImageData(world.width, world.height);
    for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
            const [r, g, b] = TERRAIN_COLOR[world.at(x, y)];
            const o = (y * world.width + x) * 4;
            img.data[o] = r;
            img.data[o + 1] = g;
            img.data[o + 2] = b;
            img.data[o + 3] = 255;
        }
    }
    tctx.putImageData(img, 0, 0);

    const sx = cssW / world.width; // CSS px per tile, X
    const sy = cssH / world.height; // CSS px per tile, Y

    function draw(): void {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS-px space, crisp on HiDPI
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(terrainCanvas, 0, 0, cssW, cssH);

        // City markers.
        ctx.fillStyle = "#ffffff";
        for (const c of world.cities) {
            ctx.fillRect(c.x * sx - 1, c.y * sy - 1, 3, 3);
        }

        // Current viewport outline (a rotated quad, since the main view is iso).
        const corners = hooks.viewportCorners();
        if (corners.length === 4) {
            ctx.beginPath();
            for (let i = 0; i < 4; i++) {
                const [tx, ty] = corners[i]!;
                const px = tx * sx;
                const py = ty * sy;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.stroke();
            ctx.fillStyle = "rgba(150,200,255,0.12)";
            ctx.fill();
        }
    }

    // ── Click / drag to recentre ────────────────────────────────────────────────
    let dragging = false;
    const panFromEvent = (e: PointerEvent): void => {
        const rect = canvas.getBoundingClientRect();
        const tx = ((e.clientX - rect.left) / rect.width) * world.width;
        const ty = ((e.clientY - rect.top) / rect.height) * world.height;
        hooks.panToTile(tx, ty);
    };
    canvas.addEventListener("pointerdown", (e) => {
        dragging = true;
        canvas.setPointerCapture(e.pointerId);
        panFromEvent(e);
    });
    canvas.addEventListener("pointermove", (e) => {
        if (dragging) panFromEvent(e);
    });
    const end = (e: PointerEvent): void => {
        dragging = false;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    draw();

    return {
        update: draw,
        dispose() {
            canvas.remove();
        },
    };
}
