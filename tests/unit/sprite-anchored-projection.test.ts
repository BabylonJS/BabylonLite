/**
 * sprite-anchored-projection.test.ts
 *
 * Verifies the headline contract of Family 2: the screen-space pixel size of
 * an anchored sprite is invariant to camera distance.
 *
 * The vertex shader expands `offsetPx * invViewport * 2 * clip.w` from the
 * projected anchor; perspective divide cancels the `* clip.w` so corner offsets
 * land on identical pixel positions regardless of how far the anchor is from
 * the camera. We replicate that math in TS and check the pixel deltas.
 */

import { describe, it, expect } from "vitest";
import { mat4Multiply, mat4PerspectiveLH } from "../../packages/babylon-lite/src/math/mat4";
import type { Mat4 } from "../../packages/babylon-lite/src/math/types";

function projectPx(vp: Mat4, world: [number, number, number], viewport: [number, number]): [number, number] {
    const [wx, wy, wz] = world;
    const cx = vp[0]! * wx + vp[4]! * wy + vp[8]! * wz + vp[12]!;
    const cy = vp[1]! * wx + vp[5]! * wy + vp[9]! * wz + vp[13]!;
    const cw = vp[3]! * wx + vp[7]! * wy + vp[11]! * wz + vp[15]!;
    return [(cx / cw) * 0.5 * viewport[0] + viewport[0] * 0.5, (1 - ((cy / cw) * 0.5 + 0.5)) * viewport[1]];
}

/** Replicates the vertex shader: anchor → clip → +offsetPx*2/viewport*clip.w → divide. */
function projectCornerPx(vp: Mat4, world: [number, number, number], cornerPx: [number, number], viewport: [number, number]): [number, number] {
    const [wx, wy, wz] = world;
    const cx = vp[0]! * wx + vp[4]! * wy + vp[8]! * wz + vp[12]!;
    const cy = vp[1]! * wx + vp[5]! * wy + vp[9]! * wz + vp[13]!;
    const cw = vp[3]! * wx + vp[7]! * wy + vp[11]! * wz + vp[15]!;
    const ndcOffsetX = cornerPx[0] * (1 / viewport[0]) * 2.0;
    const ndcOffsetY = -cornerPx[1] * (1 / viewport[1]) * 2.0;
    const fx = cx + ndcOffsetX * cw;
    const fy = cy + ndcOffsetY * cw;
    const ndcX = fx / cw;
    const ndcY = fy / cw;
    return [(ndcX * 0.5 + 0.5) * viewport[0], (1 - (ndcY * 0.5 + 0.5)) * viewport[1]];
}

function viewLookAtZ(cz: number): Mat4 {
    // Trivial view: camera at (0, 0, cz) looking down +Z. View matrix = translate(-eye).
    const m = new Float32Array(16);
    m[0] = 1;
    m[5] = 1;
    m[10] = 1;
    m[15] = 1;
    m[14] = -cz;
    return m as unknown as Mat4;
}

describe("Anchored sprite projection — fixed pixel size invariant", () => {
    const viewport: [number, number] = [1280, 720];
    const aspect = viewport[0] / viewport[1];
    const proj = mat4PerspectiveLH(Math.PI / 4, aspect, 0.1, 100) as unknown as Mat4;

    it("emits identical pixel offsets at near vs far camera distance", () => {
        const sizePx: [number, number] = [80, 40];
        const pivot: [number, number] = [0.5, 0.5];

        const cornerNearTL: [number, number] = [-pivot[0] * sizePx[0], -pivot[1] * sizePx[1]];
        const cornerNearBR: [number, number] = [(1 - pivot[0]) * sizePx[0], (1 - pivot[1]) * sizePx[1]];

        // Test: same world anchor at z=2 vs z=10. Camera looks along +Z.
        for (const wz of [2, 10, 50]) {
            const view = viewLookAtZ(-1); // camera at z=-1, looking +Z, so anchor at +wz is in front.
            const vp = mat4Multiply(proj, view) as unknown as Mat4;
            const anchor: [number, number, number] = [0, 0, wz];
            const center = projectPx(vp, anchor, viewport);
            const tl = projectCornerPx(vp, anchor, cornerNearTL, viewport);
            const br = projectCornerPx(vp, anchor, cornerNearBR, viewport);
            const wPx = br[0] - tl[0];
            const hPx = br[1] - tl[1];
            // Pixel size must equal the requested sizePx within float epsilon.
            expect(Math.abs(wPx - sizePx[0])).toBeLessThan(1e-3);
            expect(Math.abs(hPx - sizePx[1])).toBeLessThan(1e-3);
            // Center sanity: anchor on the optical axis should land in viewport center.
            expect(Math.abs(center[0] - viewport[0] / 2)).toBeLessThan(1e-3);
            expect(Math.abs(center[1] - viewport[1] / 2)).toBeLessThan(1e-3);
        }
    });

    it("offsetPx adds an exact pixel translation independent of distance", () => {
        const offset: [number, number] = [12, -8];
        const view = viewLookAtZ(-1);
        const vp = mat4Multiply(proj, view) as unknown as Mat4;
        for (const wz of [2, 10, 50]) {
            const anchor: [number, number, number] = [0, 0, wz];
            const center = projectPx(vp, anchor, viewport);
            const offset3DProj = projectCornerPx(vp, anchor, offset, viewport);
            const dx = offset3DProj[0] - center[0];
            const dy = offset3DProj[1] - center[1];
            expect(Math.abs(dx - offset[0])).toBeLessThan(1e-3);
            expect(Math.abs(dy - offset[1])).toBeLessThan(1e-3);
        }
    });
});
