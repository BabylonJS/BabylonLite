/**
 * Procedural 4-letter label atlas (A, B, C, D), 64×64 cells in a 2×2 grid (128×128).
 * Each tile is a colored square with a black letter, anti-aliased.
 *
 * Used by Scene 32 (anchored labels). Self-contained — generated at scene boot
 * via canvas2D so the lab and tests need no external assets.
 */

const CELL = 64;
const COLS = 2;
const ROWS = 2;
const W = COLS * CELL; // 128
const H = ROWS * CELL; // 128

let _cached: string | null = null;

const TILES: { letter: string; bg: string; fg: string }[] = [
    { letter: "A", bg: "#c2452f", fg: "#ffffff" },
    { letter: "B", bg: "#3aa75c", fg: "#ffffff" },
    { letter: "C", bg: "#3f6fd6", fg: "#ffffff" },
    { letter: "D", bg: "#e0b232", fg: "#1a1a1a" },
];

export function getLabelAtlasDataUrl(): string {
    if (_cached) {
        return _cached;
    }
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    ctx.clearRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const i = r * COLS + c;
            const tile = TILES[i]!;
            const x = c * CELL;
            const y = r * CELL;
            ctx.fillStyle = tile.bg;
            ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
            ctx.fillStyle = tile.fg;
            ctx.font = "bold 44px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(tile.letter, x + CELL / 2, y + CELL / 2 + 2);
        }
    }
    _cached = canvas.toDataURL("image/png");
    return _cached;
}

export const LABEL_ATLAS_INFO = {
    widthPx: W,
    heightPx: H,
    cellWidthPx: CELL,
    cellHeightPx: CELL,
    columns: COLS,
    rows: ROWS,
};
