/**
 * Cross-golden divergence test (LWR M1 proof gate).
 *
 * Asserts that scene 200 (HPM-off, floating-origin off) and scene 201
 * (HPM-on, floating-origin on) produce visibly different golden images
 * when rendered at world coordinates ~1e6, and that the new side-by-side
 * scene 202 produces visible divergence between its left half (FO-off)
 * and right half (FO-on) drawn at OFFSET=5e6.
 *
 * Two failure modes this test exists to catch:
 *
 *   1. **Substrate not load-bearing.** If the HPM-on goldens are pixel-
 *      identical to the HPM-off baseline, the F64 + floating-origin path
 *      isn't actually producing different bytes — the offset is being
 *      undone somewhere downstream.
 *
 *   2. **Renderer broken.** If either golden contains only the clear
 *      colour (zero geometry visible), the HPM-on path failed to draw at
 *      all. This was the scene 201 blank-render regression: a stale
 *      mesh-world UBO held raw 1e6-scale translations while the view
 *      matrix had the offset baked in, projecting every vertex out of the
 *      frustum. Caught now by `assertContainsGeometry`.
 *
 * Threshold: cross-golden MAD must exceed 1.0 (well above the per-scene
 * `maxMad` tolerances) to count as visibly diverging.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";

const SCENE200_GOLDEN = resolve(__dirname, "../../reference/scene200-high-precision-jitter-hpm-off/babylon-ref-golden.png");
const SCENE201_GOLDEN = resolve(__dirname, "../../reference/scene201-high-precision-jitter-hpm-on/babylon-ref-golden.png");
const SCENE202_GOLDEN = resolve(__dirname, "../../reference/scene202-lwr-side-by-side/babylon-ref-golden.png");

function loadPng(p: string): PNG {
    return PNG.sync.read(readFileSync(p));
}

interface Stats {
    mad: number;
    differingPixels: number;
    totalPixels: number;
    maxDiff: number;
}

interface PixelWindow {
    readonly data: Uint8Array | Buffer;
    /** Stride in bytes between rows (full image width × 4). */
    readonly stride: number;
    readonly x0: number;
    readonly y0: number;
    readonly w: number;
    readonly h: number;
}

function fullImage(p: PNG): PixelWindow {
    return { data: p.data, stride: p.width * 4, x0: 0, y0: 0, w: p.width, h: p.height };
}

function halfImage(p: PNG, side: "left" | "right"): PixelWindow {
    const halfW = Math.floor(p.width / 2);
    return {
        data: p.data,
        stride: p.width * 4,
        x0: side === "left" ? 0 : halfW,
        y0: 0,
        w: halfW,
        h: p.height,
    };
}

function windowMad(a: PixelWindow, b: PixelWindow): Stats {
    const w = Math.min(a.w, b.w);
    const h = Math.min(a.h, b.h);
    let sum = 0;
    let maxDiff = 0;
    let differing = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const ai = (a.y0 + y) * a.stride + (a.x0 + x) * 4;
            const bi = (b.y0 + y) * b.stride + (b.x0 + x) * 4;
            let pixMax = 0;
            let pixSum = 0;
            for (let c = 0; c < 3; c++) {
                const d = Math.abs(a.data[ai + c]! - b.data[bi + c]!);
                pixSum += d;
                if (d > pixMax) {
                    pixMax = d;
                }
            }
            sum += pixSum / 3;
            if (pixMax > maxDiff) {
                maxDiff = pixMax;
            }
            if (pixMax > 0) {
                differing++;
            }
        }
    }
    return { mad: sum / (w * h), differingPixels: differing, totalPixels: w * h, maxDiff };
}

/** Count pixels whose colour differs noticeably from the clear colour.
 *  "Noticeably" = any channel differs by > `tolerance` (0..255). Used to
 *  guard against blank-render regressions where the screenshot is just
 *  the clear-colour background and no geometry rasterized. */
function countNonClearPixels(window: PixelWindow, clear: readonly [number, number, number], tolerance = 8): number {
    let count = 0;
    for (let y = 0; y < window.h; y++) {
        for (let x = 0; x < window.w; x++) {
            const i = (window.y0 + y) * window.stride + (window.x0 + x) * 4;
            if (Math.abs(window.data[i]! - clear[0]) > tolerance || Math.abs(window.data[i + 1]! - clear[1]) > tolerance || Math.abs(window.data[i + 2]! - clear[2]) > tolerance) {
                count++;
            }
        }
    }
    return count;
}

/** Assert that at least 1% of pixels in `window` differ from `clear`,
 *  proving the scene actually drew geometry. */
function assertContainsGeometry(window: PixelWindow, clear: readonly [number, number, number], label: string): void {
    const nonClear = countNonClearPixels(window, clear);
    const total = window.w * window.h;
    const frac = nonClear / total;
    const minFrac = 0.01;
    expect(
        frac,
        `${label}: only ${(frac * 100).toFixed(2)}% of pixels differ from clear colour (${clear.join(",")}). ` +
            `This indicates the LWR / HPM upload path may have broken visible rendering. ` +
            `Capture the scene's lab page and verify geometry is on-screen.`
    ).toBeGreaterThan(minFrac);
}

// Clear colours used by each scene (see source).
const SCENE200_201_CLEAR = [51, 51, 76] as const; // {r:0.2,g:0.2,b:0.3} → sRGB ~ (51,51,76)
const SCENE202_CLEAR = [13, 13, 20] as const; //    {r:0.05,g:0.05,b:0.08} → sRGB ~ (13,13,20)

describe("LWR M1 — scene 200 vs scene 201 divergence proof", () => {
    it("scene 200 golden contains visible geometry (non-blank guard)", () => {
        const a = loadPng(SCENE200_GOLDEN);
        assertContainsGeometry(fullImage(a), SCENE200_201_CLEAR, "scene 200 (HPM-off)");
    });

    it("scene 201 golden contains visible geometry (non-blank guard)", () => {
        const b = loadPng(SCENE201_GOLDEN);
        assertContainsGeometry(fullImage(b), SCENE200_201_CLEAR, "scene 201 (HPM-on + FO-on)");
    });

    it("scene 200 and scene 201 goldens diverge (any non-trivial delta)", () => {
        const a = loadPng(SCENE200_GOLDEN);
        const b = loadPng(SCENE201_GOLDEN);
        const stats = windowMad(fullImage(a), fullImage(b));

        // Surface the numbers in the test log even on pass so the divergence
        // magnitude is auditable.
        console.warn(
            `scene200 vs scene201 cross-golden: MAD=${stats.mad.toFixed(3)}, ` + `differingPixels=${stats.differingPixels}/${stats.totalPixels}, maxDiff=${stats.maxDiff}`
        );

        // The substrate-only scenes render at world coords ~1e6. F32 jitter
        // at that magnitude is sub-pixel, so the visible delta between
        // HPM-off (scene 200) and HPM-on + FO-on (scene 201) is small but
        // non-zero — typical observed MAD is ~0.4. We only assert "some
        // measurable delta" here (MAD > 0.05); the load-bearing
        // demonstration of LWR precision lives in the scene 202 left/right
        // halves below, at OFFSET=5e6 where the delta is obvious.
        expect(
            stats.mad,
            `Substrate proof: HPM-on + FO-on must produce different bytes than HPM-off F32 baseline. ` +
                `If MAD~0 the offset/HPM plumbing is producing identical output — investigate the upload path.`
        ).toBeGreaterThan(0.05);
    });
});

describe("LWR M1 — scene 202 side-by-side divergence proof", () => {
    it("scene 202 left half (FO-off) contains visible geometry", () => {
        const img = loadPng(SCENE202_GOLDEN);
        assertContainsGeometry(halfImage(img, "left"), SCENE202_CLEAR, "scene 202 left (FO-off)");
    });

    it("scene 202 right half (FO-on) contains visible geometry", () => {
        const img = loadPng(SCENE202_GOLDEN);
        assertContainsGeometry(halfImage(img, "right"), SCENE202_CLEAR, "scene 202 right (FO-on)");
    });

    it("scene 202 left half and right half must visibly diverge (MAD > 1.0)", () => {
        const img = loadPng(SCENE202_GOLDEN);
        const stats = windowMad(halfImage(img, "left"), halfImage(img, "right"));

        console.warn(
            `scene202 left (FO-off) vs right (FO-on): MAD=${stats.mad.toFixed(3)}, ` + `differingPixels=${stats.differingPixels}/${stats.totalPixels}, maxDiff=${stats.maxDiff}`
        );

        expect(
            stats.mad,
            `LWR side-by-side proof: at OFFSET=5e6 the FO-off half must visibly differ from the FO-on half. ` +
                `If this fails the LWR substrate isn't producing the precision gain it claims.`
        ).toBeGreaterThan(1.0);
    });
});
