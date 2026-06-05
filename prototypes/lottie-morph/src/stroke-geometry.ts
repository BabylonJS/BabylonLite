// Stroke geometry — expand a flattened polyline into stroke triangles (a thick line).
//
// GATED: the player dynamically imports this module only when the animation has visible
// strokes (see feature-detect.ts), so fill-only files never bundle the stroke path.
//
// Each segment becomes a quad offset ±halfWidth perpendicular to the segment direction.
// Round joins/caps are added as small triangle fans at vertices, which keeps the outline
// gap-free at corners regardless of turn direction. The caller draws these triangles with a
// solid color through a non-stencil pipeline; because the stroke color in practice is opaque,
// overlap at joins blends to the same color and is invisible. (A stencil-union pass would be
// needed for correct semi-transparent strokes — deferred until a file needs it.)

/** Triangle-fan segment count for round joins/caps. */
const JOIN_SEGMENTS = 6;

/**
 * Append stroke triangles (x,y pairs, 3 verts per triangle) to `out`.
 * `poly` holds `count` screen-space points (x,y interleaved). `halfWidth` is in screen px.
 * `closed` adds the wrap-around segment and treats every vertex as a join.
 * Returns the number of vertices appended.
 */
export function buildStrokePoints(poly: number[], count: number, halfWidth: number, closed: boolean, out: number[]): number {
    if (count < 2 || halfWidth <= 0) {
        return 0;
    }
    const start = out.length;
    const segs = closed ? count : count - 1;

    // Segment quads.
    for (let i = 0; i < segs; i++) {
        const i1 = (i + 1) % count;
        const ax = poly[i * 2];
        const ay = poly[i * 2 + 1];
        const bx = poly[i1 * 2];
        const by = poly[i1 * 2 + 1];
        let dx = bx - ax;
        let dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) {
            continue;
        }
        dx /= len;
        dy /= len;
        // Perpendicular, scaled to half width.
        const nx = -dy * halfWidth;
        const ny = dx * halfWidth;
        const p0x = ax + nx;
        const p0y = ay + ny;
        const p1x = bx + nx;
        const p1y = by + ny;
        const p2x = bx - nx;
        const p2y = by - ny;
        const p3x = ax - nx;
        const p3y = ay - ny;
        out.push(p0x, p0y, p1x, p1y, p2x, p2y, p0x, p0y, p2x, p2y, p3x, p3y);
    }

    // Round joins (and, for open paths, round caps) at every vertex.
    for (let i = 0; i < count; i++) {
        const cx = poly[i * 2];
        const cy = poly[i * 2 + 1];
        for (let k = 0; k < JOIN_SEGMENTS; k++) {
            const a0 = (k / JOIN_SEGMENTS) * Math.PI * 2;
            const a1 = ((k + 1) / JOIN_SEGMENTS) * Math.PI * 2;
            out.push(cx, cy, cx + Math.cos(a0) * halfWidth, cy + Math.sin(a0) * halfWidth, cx + Math.cos(a1) * halfWidth, cy + Math.sin(a1) * halfWidth);
        }
    }

    return (out.length - start) / 2;
}
