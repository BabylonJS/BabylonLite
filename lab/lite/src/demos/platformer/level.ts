/**
 * Level 1-1 layout for the platformer demo, built programmatically on a tile grid.
 *
 * Rather than ship a giant hand-aligned ASCII block, the level is assembled with a
 * few helpers (ground runs, pits, stairs, block rows) into a `Level` describing:
 *  - a `solid` grid for the collider,
 *  - static `terrain` tiles (auto-edged grass/dirt) to draw once,
 *  - interactive `blocks` (?-blocks, bricks) with their hidden contents,
 *  - `coins`, `enemies`, `hazards`, the player spawn, and the flag goal.
 *
 * One cohesive CC0 art style throughout (Kenney "Platformer Pack Remastered").
 */

export type BlockKind = "brick" | "coin-block" | "mushroom-block" | "star-block";
export type EnemyKind = "slime" | "snail";

export interface Cell {
    cx: number;
    cy: number;
}

export interface TerrainTile extends Cell {
    /** Ground-sheet frame name. */
    name: string;
}

export interface BlockSpawn extends Cell {
    kind: BlockKind;
}

export interface EnemySpawn extends Cell {
    kind: EnemyKind;
}

/** A warp pipe linking the overworld to the underground bonus chamber (or back). */
export interface Pipe {
    /** Top-left tile of the pipe sprite + its solid collision footprint. */
    cx: number;
    cy: number;
    /** Footprint size in tiles. */
    w: number;
    h: number;
    /** Tile the player lands on after warping through this pipe. */
    toCx: number;
    toCy: number;
    /** True when this pipe leads into the cave (drives the dark backdrop + HUD label). */
    toCave: boolean;
    /** HUD world label to show after warping (e.g. "1-2"). */
    worldLabel: string;
}

export interface Level {
    cols: number;
    rows: number;
    solid: Uint8Array;
    terrain: TerrainTile[];
    blocks: BlockSpawn[];
    coins: Cell[];
    enemies: EnemySpawn[];
    hazards: Cell[];
    playerSpawn: Cell;
    flag: Cell;
    /** World tile column where falling below the map kills the player. */
    deathRow: number;
    /** Warp pipes linking the overworld and the underground bonus chamber. */
    pipes: Pipe[];
}

const OVERWORLD_COLS = 124;
const ROWS = 14;
/** y of the top ground surface row (shared by the overworld and the cave floor). */
const GROUND_TOP = 12;

// ── Underground bonus chamber (a sealed stone room reached by warp pipes) ──
/** Left / right solid wall columns of the cave; the interior lies between them.
 *  Placed well past the overworld (a wide void gap) so the two areas are never
 *  on screen together — the camera can't show overworld grass from inside the cave. */
const CAVE_X0 = 140;
const CAVE_X1 = 163;
/** Solid ceiling row of the cave. */
const CAVE_CEIL = 3;
/** Where the player lands when warping into the cave. */
const CAVE_ENTRY = { cx: CAVE_X0 + 2, cy: GROUND_TOP - 1 };
/** Where the player lands when warping back out to the overworld. */
const OVERWORLD_RETURN = { cx: 48, cy: GROUND_TOP - 1 };

/** Full grid width: the overworld, a void gap, then the cave chamber + margin. */
const COLS = CAVE_X1 + 3;

type Glyph = " " | "#" | "=" | "B" | "?" | "M" | "S" | "o" | "g" | "n" | "^" | "F" | "p";

export function buildLevel(): Level {
    const grid: Glyph[][] = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => " " as Glyph));
    const set = (cx: number, cy: number, g: Glyph): void => {
        if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) grid[cy]![cx] = g;
    };

    // ── Solid ground floor (rows 12-13), with a few pits ──────────────────────
    const pits = new Set<number>();
    const addPit = (from: number, to: number): void => {
        for (let c = from; c <= to; c++) pits.add(c);
    };
    addPit(28, 29);
    addPit(57, 59);
    addPit(88, 89);
    for (let c = 0; c < OVERWORLD_COLS; c++) {
        if (pits.has(c)) continue;
        set(c, GROUND_TOP, "#");
        set(c, GROUND_TOP + 1, "#");
    }

    // ── Player spawn ──────────────────────────────────────────────────────────
    set(3, GROUND_TOP - 1, "p");

    // ── Floating ?-block / brick rows ─────────────────────────────────────────
    const blockRow = GROUND_TOP - 4;
    set(16, blockRow, "?"); // coin
    set(18, blockRow, "B");
    set(19, blockRow, "M"); // mushroom (grow)
    set(20, blockRow, "B");
    set(22, blockRow, "?");
    // a stacked brick + ?-block above the middle of the first row
    set(19, blockRow - 4, "B");
    set(20, blockRow - 4, "S"); // star (invincibility)
    set(21, blockRow - 4, "B");

    // floating coins arcing over the first pit
    for (let i = 0; i < 4; i++) set(26 + i, GROUND_TOP - 3 - (i === 1 || i === 2 ? 1 : 0), "o");

    // ── Crate-style step blocks (solid) forming little platforms ──────────────
    set(34, GROUND_TOP - 2, "=");
    set(35, GROUND_TOP - 2, "=");
    set(40, GROUND_TOP - 3, "=");
    set(41, GROUND_TOP - 3, "=");
    set(46, GROUND_TOP - 4, "=");
    set(47, GROUND_TOP - 4, "=");
    for (let i = 0; i < 3; i++) set(41 + i, GROUND_TOP - 6, "o");

    // ── Enemies ───────────────────────────────────────────────────────────────
    set(14, GROUND_TOP - 1, "g");
    set(33, GROUND_TOP - 1, "g");
    set(44, GROUND_TOP - 5, "g"); // on the high platform
    set(53, GROUND_TOP - 1, "n"); // snail (shell-kick)
    set(54, GROUND_TOP - 1, "g");
    set(72, GROUND_TOP - 1, "g");
    set(73, GROUND_TOP - 1, "g");
    set(96, GROUND_TOP - 1, "n");

    // ── A spike pit hazard run ────────────────────────────────────────────────
    for (let c = 64; c <= 67; c++) set(c, GROUND_TOP - 1, "^");

    // ── Brick/?-block bridge over second pit ──────────────────────────────────
    set(56, GROUND_TOP - 5, "B");
    set(57, GROUND_TOP - 5, "?");
    set(58, GROUND_TOP - 5, "B");
    set(59, GROUND_TOP - 5, "?");
    set(60, GROUND_TOP - 5, "B");

    // ── Coin cluster ──────────────────────────────────────────────────────────
    for (let i = 0; i < 6; i++) set(76 + i, GROUND_TOP - 3, "o");
    set(78, blockRow, "M"); // a second mushroom for safety

    // ── Ascending staircase before the goal (solid blocks) ────────────────────
    const stairBase = 100;
    for (let s = 0; s < 6; s++) {
        for (let h = 0; h <= s; h++) {
            set(stairBase + s, GROUND_TOP - 1 - h, "=");
        }
    }

    // ── Flag goal on a tall pedestal ──────────────────────────────────────────
    const flagCol = 114;
    for (let h = 0; h < 8; h++) set(flagCol, GROUND_TOP - 1 - h, "="); // pole pedestal column (solid base only at bottom)
    // keep only the base solid; clear the pole cells (flag handled as entity)
    for (let h = 1; h < 8; h++) set(flagCol, GROUND_TOP - 1 - h, " ");
    set(flagCol, GROUND_TOP - 9, "F");

    // ── Compile to Level ──────────────────────────────────────────────────────
    const solid = new Uint8Array(COLS * ROWS);
    const terrain: TerrainTile[] = [];
    const blocks: BlockSpawn[] = [];
    const coins: Cell[] = [];
    const enemies: EnemySpawn[] = [];
    const hazards: Cell[] = [];
    let playerSpawn: Cell = { cx: 3, cy: GROUND_TOP - 1 };
    let flag: Cell = { cx: flagCol, cy: GROUND_TOP - 9 };

    const isGround = (cx: number, cy: number): boolean => {
        if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return false;
        const g = grid[cy]![cx]!;
        return g === "#" || g === "=";
    };

    for (let cy = 0; cy < ROWS; cy++) {
        for (let cx = 0; cx < COLS; cx++) {
            const g = grid[cy]![cx]!;
            switch (g) {
                case "#": {
                    solid[cy * COLS + cx] = 1;
                    terrain.push({ cx, cy, name: groundFrame(cx, cy, isGround) });
                    break;
                }
                case "=": {
                    solid[cy * COLS + cx] = 1;
                    terrain.push({ cx, cy, name: platformFrame(cx, cy, isGround) });
                    break;
                }
                case "B":
                    solid[cy * COLS + cx] = 1;
                    blocks.push({ cx, cy, kind: "brick" });
                    break;
                case "?":
                    solid[cy * COLS + cx] = 1;
                    blocks.push({ cx, cy, kind: "coin-block" });
                    break;
                case "M":
                    solid[cy * COLS + cx] = 1;
                    blocks.push({ cx, cy, kind: "mushroom-block" });
                    break;
                case "S":
                    solid[cy * COLS + cx] = 1;
                    blocks.push({ cx, cy, kind: "star-block" });
                    break;
                case "o":
                    coins.push({ cx, cy });
                    break;
                case "g":
                    enemies.push({ cx, cy, kind: "slime" });
                    break;
                case "n":
                    enemies.push({ cx, cy, kind: "snail" });
                    break;
                case "^":
                    hazards.push({ cx, cy });
                    break;
                case "F":
                    flag = { cx, cy };
                    break;
                case "p":
                    playerSpawn = { cx, cy };
                    break;
                default:
                    break;
            }
        }
    }

    // ── Underground bonus chamber ─────────────────────────────────────────────
    // A sealed stone room appended to the same tile grid (past a void gap), reached
    // only by warp pipe. Built directly into solid/terrain (bypassing the glyph grid)
    // with explicit stone frames; the existing terrain + coin systems draw it as-is.
    const caveSolid = (cx: number, cy: number, name: string): void => {
        solid[cy * COLS + cx] = 1;
        terrain.push({ cx, cy, name });
    };
    for (let cx = CAVE_X0; cx <= CAVE_X1; cx++) {
        caveSolid(cx, GROUND_TOP, "stoneMid"); // floor surface
        caveSolid(cx, GROUND_TOP + 1, "stoneCenter"); // floor body
        caveSolid(cx, CAVE_CEIL, "stoneCenter"); // ceiling
    }
    for (let cy = CAVE_CEIL + 1; cy < GROUND_TOP; cy++) {
        caveSolid(CAVE_X0, cy, "stoneCenter"); // left wall
        caveSolid(CAVE_X1, cy, "stoneCenter"); // right wall
    }
    // Bonus coins: two easy rows the player hops to collect.
    for (const row of [GROUND_TOP - 3, GROUND_TOP - 2]) {
        for (let cx = CAVE_X0 + 4; cx <= CAVE_X1 - 5; cx += 2) {
            coins.push({ cx, cy: row });
        }
    }
    // ── Warp pipes (duck on top to enter) ─────────────────────────────────────
    const pipes: Pipe[] = [];
    const addPipe = (cx: number, cy: number, w: number, h: number, toCx: number, toCy: number, toCave: boolean, worldLabel: string): void => {
        for (let x = cx; x < cx + w; x++) {
            for (let y = cy; y < cy + h; y++) solid[y * COLS + x] = 1;
        }
        pipes.push({ cx, cy, w, h, toCx, toCy, toCave, worldLabel });
    };
    // Overworld pipe on the ground at col 50 → into the cave.
    addPipe(50, GROUND_TOP - 2, 2, 2, CAVE_ENTRY.cx, CAVE_ENTRY.cy, true, "1-2");
    // Cave exit pipe on the cave floor at the right → back to the overworld.
    addPipe(CAVE_X1 - 3, GROUND_TOP - 2, 2, 2, OVERWORLD_RETURN.cx, OVERWORLD_RETURN.cy, false, "1-1");

    return { cols: COLS, rows: ROWS, solid, terrain, blocks, coins, enemies, hazards, playerSpawn, flag, deathRow: ROWS + 1, pipes };
}

/** Pick a grass/dirt ground-sheet frame for a solid ground cell based on neighbours. */
function groundFrame(cx: number, cy: number, isGround: (x: number, y: number) => boolean): string {
    const surface = !isGround(cx, cy - 1);
    if (surface) {
        const openLeft = !isGround(cx - 1, cy);
        const openRight = !isGround(cx + 1, cy);
        if (openLeft && !openRight) return "grassLeft";
        if (openRight && !openLeft) return "grassRight";
        return "grassMid";
    }
    return "dirtCenter";
}

/** Floating solid platforms use stone tiles to read distinctly from the ground. */
function platformFrame(cx: number, cy: number, isGround: (x: number, y: number) => boolean): string {
    const surface = !isGround(cx, cy - 1);
    if (surface) {
        const openLeft = !isGround(cx - 1, cy);
        const openRight = !isGround(cx + 1, cy);
        if (openLeft && !openRight) return "stoneLeft";
        if (openRight && !openLeft) return "stoneRight";
        return "stoneMid";
    }
    return "stoneCenter";
}
