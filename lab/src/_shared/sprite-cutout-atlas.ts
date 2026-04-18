/**
 * Procedural atlas for Scene 33 (anchored animated cutout).
 *
 * 128×128 — 2×2 grid of 64×64 cells.
 *  - Frame 0..3: a 4-frame "arrow" animation. Each frame draws an arrow
 *    rotated by 90° on a transparent background. Used for the alpha-blend
 *    animated layer.
 *
 * The cutout layer reuses the same atlas: rendering a frame with `cutout`
 * blend mode discards pixels with alpha < 0.5, leaving a hard-edged cutout
 * silhouette that visibly writes depth.
 */

const W = 128;
const H = 128;
const CELL = 64;

let _cached: string | null = null;

export function getCutoutAtlasDataUrl(): string {
    if (_cached) {
        return _cached;
    }
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < 4; i++) {
        const c = i % 2;
        const r = (i / 2) | 0;
        const cx = c * CELL + CELL / 2;
        const cy = r * CELL + CELL / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((i * Math.PI) / 2);
        // Filled arrow on transparent bg — head triangle + shaft.
        ctx.fillStyle = "#f8c542";
        ctx.beginPath();
        ctx.moveTo(-22, -8);
        ctx.lineTo(8, -8);
        ctx.lineTo(8, -16);
        ctx.lineTo(24, 0);
        ctx.lineTo(8, 16);
        ctx.lineTo(8, 8);
        ctx.lineTo(-22, 8);
        ctx.closePath();
        ctx.fill();
        // Outline so cutout edges are sharp.
        ctx.strokeStyle = "#7c5a16";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    _cached = canvas.toDataURL("image/png");
    return _cached;
}

export const CUTOUT_ATLAS_INFO = {
    widthPx: W,
    heightPx: H,
    cellWidthPx: CELL,
    cellHeightPx: CELL,
    columns: 2,
    rows: 2,
    spinClip: { name: "spin", frames: [0, 1, 2, 3], fps: 8, loop: true },
};
