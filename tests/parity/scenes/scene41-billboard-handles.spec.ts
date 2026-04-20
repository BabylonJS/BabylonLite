/**
 * Scene 41 — Billboard Sprite Handles + 3D Parenting Parity Test (Family 3, Handle API)
 *
 * Captures Babylon Lite's billboard-sprite handle-API scene (camera-facing
 * sprite parented to a moving 3D box) and compares against the BJS reference.
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import { attachCompareArtifacts, captureGolden, compareImages, getSceneConfig } from "../compare-utils";

const sceneConfig = getSceneConfig(41);
const REFERENCE_DIR = path.resolve(__dirname, "../../../reference/scene41-billboard-handles");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

test("Scene 41 — Billboard Sprite Handles + 3D Parenting matches BJS reference", async ({ page }, testInfo) => {
    const browser = page.context().browser()!;
    await captureGolden(browser, { sceneId: 41 });

    await page.goto("/scene41.html");
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.ready === "true", { timeout: 20_000 });
    await page.waitForTimeout(500);

    const screenshotPath = path.join(REFERENCE_DIR, "test-actual.png");
    await page.locator("canvas").screenshot({ path: screenshotPath });

    const full = compareImages(screenshotPath, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, screenshotPath, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Full image (${full.totalPixels} px): MAD=${full.mad.toFixed(3)}`);

    expect(full.mad, `Full image MAD should be ≤ ${sceneConfig.maxMad}`).toBeLessThanOrEqual(sceneConfig.maxMad);
});
