/**
 * Scene 224 — Bounding Box Gizmo parity test.
 *
 * Drives the three core BoundingBoxGizmo manipulations in sequence on both
 * BJS and Lite, then compares the post-drag rendered frame:
 *
 *   1. SCALE  — drag a corner box outward to enlarge the group.
 *   2. ROTATE — drag an edge anchor tangentially to rotate around its axis.
 *   3. TRANSLATE — drag the body to shift the group laterally.
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import type { Page } from "@playwright/test";
import { attachCompareArtifacts, compareImages, getSceneConfig } from "../compare-utils";

const sceneConfig = getSceneConfig(224);
const REFERENCE_DIR = path.resolve(__dirname, "../../../../reference/lite/scene224-bounding-box-gizmo");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

interface DragStep {
    name: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
}

// Coordinates aimed against the static initial frame (1280×720 canvas).
// Tuned against the visible bbox handles; conservative drags exercise the
// gizmo wiring without overshooting the parity budget.
const DRAG_STEPS: DragStep[] = [
    // 1. Scale up — drag a top-front-right corner outward (up + right).
    { name: "scale-corner", start: { x: 765, y: 245 }, end: { x: 850, y: 200 } },
    // 2. Rotate — drag a top-edge midpoint anchor laterally to spin around Z.
    { name: "rotate", start: { x: 605, y: 245 }, end: { x: 615, y: 290 } },
    // 3. Translate — drag the body box (inside the AABB) to shift laterally.
    { name: "translate", start: { x: 640, y: 360 }, end: { x: 580, y: 340 } },
];

test.skip(!!sceneConfig.skipParity, "Scene 224 skipped via skipParity in scene-config.json");

async function performDrags(page: Page): Promise<void> {
    const box = await page.locator("canvas").boundingBox();
    if (!box) {
        throw new Error("canvas has no bounding box");
    }
    for (const step of DRAG_STEPS) {
        const sx = box.x + step.start.x;
        const sy = box.y + step.start.y;
        const ex = box.x + step.end.x;
        const ey = box.y + step.end.y;
        await page.mouse.move(sx, sy);
        await page.waitForTimeout(50);
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        await page.waitForTimeout(100);
        await page.mouse.move(ex, ey, { steps: 8 });
        await page.waitForTimeout(100);
        await page.mouse.up();
        await page.waitForTimeout(160);
    }
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.waitForTimeout(400);
}

async function readRoot(page: Page): Promise<{ px: number; qw: number; sx: number }> {
    return await page.evaluate(() => {
        const s = (
            window as unknown as {
                __scene224?: {
                    rootPos: () => { x: number };
                    rootQuat: () => { w: number };
                    rootScale: () => { x: number };
                };
            }
        ).__scene224;
        if (!s) {
            return { px: NaN, qw: NaN, sx: NaN };
        }
        return { px: s.rootPos().x, qw: s.rootQuat().w, sx: s.rootScale().x };
    });
}

test("Scene 224 — Bounding Box Gizmo matches Babylon.js reference (scale / rotate / translate)", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const browser = page.context().browser()!;

    if (!fs.existsSync(GOLDEN_REF) || process.env.RECAPTURE_GOLDEN) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const bjsPage = await ctx.newPage();
        await bjsPage.goto("/babylon-ref-scene224.html");
        await bjsPage.waitForFunction(() => document.querySelector("canvas")?.dataset.ready === "true", { timeout: 30_000 });
        await bjsPage.waitForFunction(() => !document.getElementById("babylonjsLoadingDiv"), { timeout: 10_000 }).catch(() => undefined);
        await bjsPage.waitForTimeout(500);
        await performDrags(bjsPage);
        await bjsPage.waitForTimeout(300);
        fs.mkdirSync(REFERENCE_DIR, { recursive: true });
        await bjsPage.locator("canvas").screenshot({ path: GOLDEN_REF });
        await bjsPage.close();
        await ctx.close();
    }

    await page.goto("/scene224.html");
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.ready === "true", { timeout: 30_000 });
    await page.waitForTimeout(500);
    const before = await readRoot(page);
    await performDrags(page);
    await page.waitForTimeout(300);
    const after = await readRoot(page);
    console.log(`Lite root.x ${before.px.toFixed(3)} → ${after.px.toFixed(3)} (Δ=${(after.px - before.px).toFixed(3)})`);
    console.log(`Lite root.qw ${before.qw.toFixed(3)} → ${after.qw.toFixed(3)} (Δ=${(after.qw - before.qw).toFixed(3)})`);
    console.log(`Lite root.sx ${before.sx.toFixed(3)} → ${after.sx.toFixed(3)} (Δ=${(after.sx - before.sx).toFixed(3)})`);

    const screenshotPath = path.join(REFERENCE_DIR, "test-actual.png");
    await page.locator("canvas").screenshot({ path: screenshotPath });

    const full = compareImages(screenshotPath, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, screenshotPath, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Full image (${full.totalPixels} px): MAD=${full.mad.toFixed(3)}`);

    expect(full.mad, `Full image MAD should be ≤ ${sceneConfig.maxMad}`).toBeLessThanOrEqual(sceneConfig.maxMad);
});
