/**
 * Scene 32 — Sprites Anchored Labels Parity Test (Family 2)
 *
 * 4 boxes with anchored labels (A/B/C/D); labels stay fixed pixel size
 * regardless of camera distance. One label is non-pickable.
 *
 * Reference is Lite-fallback (per docs/architecture/26-sprites.md): no
 * tractable canvas2D analogue exists for projected anchored sprites in a
 * 3D scene, so the captured golden serves as a regression snapshot.
 *
 * Picking smoke-test asserts that pickAnchoredSprite hits the projected
 * anchor center for pickable sprites and misses the non-pickable one.
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import { attachCompareArtifacts, captureGolden, compareImages, getSceneConfig } from "../compare-utils";

const sceneConfig = getSceneConfig(32);
const REFERENCE_DIR = path.resolve(__dirname, "../../../reference/scene32-sprites-anchored-labels");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

interface PickResult {
    i: number;
    pickable: boolean;
    hit: boolean;
}

test("Scene 32 — Sprites Anchored Labels match Lite-fallback golden", async ({ page }, testInfo) => {
    const browser = page.context().browser()!;
    await captureGolden(browser, { sceneId: 32 });

    await page.goto("/scene32.html");
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.ready === "true", { timeout: 20_000 });
    await page.waitForTimeout(500);

    const screenshotPath = path.join(REFERENCE_DIR, "test-actual.png");
    await page.locator("canvas").screenshot({ path: screenshotPath });

    const full = compareImages(screenshotPath, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, screenshotPath, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Full image (${full.totalPixels} px): MAD=${full.mad.toFixed(3)}`);
    expect(full.mad, `Full image MAD should be ≤ ${sceneConfig.maxMad}`).toBeLessThanOrEqual(sceneConfig.maxMad);

    // Picking smoke-test: 4 sprites; index 2 is pickable=false.
    const pickResults: PickResult[] = JSON.parse((await page.locator("canvas").getAttribute("data-pick-results")) ?? "[]");
    expect(pickResults).toHaveLength(4);
    for (const r of pickResults) {
        if (r.pickable) {
            expect(r.hit, `sprite ${r.i} should be pickable and hit`).toBe(true);
        } else {
            expect(r.hit, `sprite ${r.i} should not be hit (pickable=false)`).toBe(false);
        }
    }
});
