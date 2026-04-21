/**
 * Scene 50 — Pure 2D Sprites Parity Test
 *
 * No BJS oracle: this scene is owned end-to-end by Lite. The golden
 * reference is captured from our own scene50 the first time the spec
 * runs and committed to `reference/scene50-pure-2d-sprites/babylon-ref-golden.png`.
 * Re-capture only if explicitly requested via `RECAPTURE_GOLDEN=1`.
 *
 * Compares full-image MAD only (no region — the entire scene is sprite content).
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { attachCompareArtifacts, compareImages, getSceneConfig } from "../compare-utils";

const sceneConfig = getSceneConfig(50);
const REFERENCE_DIR = path.resolve(__dirname, "../../../reference/scene50-pure-2d-sprites");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

test.skip(!!sceneConfig.skipParity, "Scene 50 skipped via skipParity in scene-config.json");

test("Scene 50 — Pure 2D Sprites matches golden", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/scene50.html");
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.ready === "true", { timeout: 20_000 });
    await page.waitForTimeout(500);

    const screenshotPath = path.join(REFERENCE_DIR, "test-actual.png");
    fs.mkdirSync(REFERENCE_DIR, { recursive: true });
    await page.locator("canvas").screenshot({ path: screenshotPath });

    // First-run / explicit recapture: seed the golden from our own render.
    if (!fs.existsSync(GOLDEN_REF) || process.env.RECAPTURE_GOLDEN) {
        fs.copyFileSync(screenshotPath, GOLDEN_REF);
    }

    const full = compareImages(screenshotPath, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, screenshotPath, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Full image (${full.totalPixels} px): MAD=${full.mad.toFixed(2)}`);

    expect(full.mad, `Full image MAD should be ≤ ${sceneConfig.maxMad}`).toBeLessThanOrEqual(sceneConfig.maxMad);
});
