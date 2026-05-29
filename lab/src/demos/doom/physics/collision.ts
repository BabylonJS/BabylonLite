// Clean-room DOOM-style player collision, implemented from public descriptions of
// the engine's movement rules (Doom Wiki / Unofficial Doom Specs). No GPL Doom
// source is used or copied.
//
// Movement model (faithful subset):
//   - Player is a circle of radius 16 in the map plane.
//   - One-sided lines and ML_BLOCKING lines are always solid.
//   - Two-sided lines block when the vertical opening is shorter than the player
//     height (56), or when the far floor steps up more than 24 units.
//   - Collisions resolve by pushing the player out of the line along its normal,
//     which preserves tangential motion (wall sliding).

import type { DoomMap } from "../wad/map.js";

export const PLAYER_RADIUS = 16;
export const PLAYER_HEIGHT = 56;
export const MAX_STEP = 24;
export const VIEW_HEIGHT = 41;

const ML_BLOCKING = 0x0001;

export interface CollLine {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    oneSided: boolean;
    blocking: boolean;
    openTop: number;
    openBottom: number;
}

export function buildCollisionLines(map: DoomMap): CollLine[] {
    const lines: CollLine[] = [];
    for (const ld of map.linedefs) {
        if (ld.front < 0) continue;
        const v1 = map.vertices[ld.start];
        const v2 = map.vertices[ld.end];
        if (!v1 || !v2) continue;
        const frontSec = map.sectors[map.sidedefs[ld.front].sector];
        if (!frontSec) continue;
        const oneSided = ld.back < 0;
        const backSec = oneSided ? null : map.sectors[map.sidedefs[ld.back].sector];

        let openTop = 0;
        let openBottom = 0;
        if (backSec) {
            openTop = Math.min(frontSec.ceilHeight, backSec.ceilHeight);
            openBottom = Math.max(frontSec.floorHeight, backSec.floorHeight);
        }

        lines.push({
            x1: v1.x,
            y1: v1.y,
            x2: v2.x,
            y2: v2.y,
            oneSided,
            blocking: (ld.flags & ML_BLOCKING) !== 0,
            openTop,
            openBottom,
        });
    }
    return lines;
}

function lineBlocks(line: CollLine, currentFloor: number): boolean {
    if (line.oneSided || line.blocking) return true;
    if (line.openTop - line.openBottom < PLAYER_HEIGHT) return true;
    if (line.openBottom - currentFloor > MAX_STEP) return true;
    return false;
}

/**
 * Resolves a desired move from (fromX,fromY) by (dx,dy) against blocking lines,
 * sliding along walls. `currentFloor` is the floor height the player stands on.
 */
export function tryMove(lines: CollLine[], fromX: number, fromY: number, dx: number, dy: number, currentFloor: number): { x: number; y: number } {
    let px = fromX + dx;
    let py = fromY + dy;
    const r2 = PLAYER_RADIUS * PLAYER_RADIUS;

    for (let iter = 0; iter < 4; iter++) {
        let moved = false;
        for (const line of lines) {
            if (!lineBlocks(line, currentFloor)) continue;
            // Extent gate: only react if the destination is near this segment.
            const cp = closestPointOnSegment(line, px, py);
            const gx = px - cp.x;
            const gy = py - cp.y;
            if (gx * gx + gy * gy >= r2) continue;

            // Resolve along the infinite line's normal, oriented toward the side the
            // player came FROM, so fast moves can't tunnel to the far side.
            const lx = line.x2 - line.x1;
            const ly = line.y2 - line.y1;
            let nx = -ly;
            let ny = lx;
            const len = Math.hypot(nx, ny) || 1;
            nx /= len;
            ny /= len;
            const sFrom = (fromX - line.x1) * nx + (fromY - line.y1) * ny;
            if (sFrom < 0) {
                nx = -nx;
                ny = -ny;
            }
            const sDest = (px - line.x1) * nx + (py - line.y1) * ny;
            if (sDest < PLAYER_RADIUS) {
                const push = PLAYER_RADIUS - sDest;
                px += nx * push;
                py += ny * push;
                moved = true;
            }
        }
        if (!moved) break;
    }

    return { x: px, y: py };
}

function closestPointOnSegment(line: CollLine, px: number, py: number): { x: number; y: number } {
    const ax = line.x1;
    const ay = line.y1;
    const bx = line.x2;
    const by = line.y2;
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-9) return { x: ax, y: ay };
    let t = ((px - ax) * abx + (py - ay) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    return { x: ax + t * abx, y: ay + t * aby };
}
