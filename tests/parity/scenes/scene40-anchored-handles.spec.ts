/**
 * Scene 40 — Anchored Sprite Handles + 3D Parenting Parity Test (Family 2, Handle API)
 *
 * Captures Babylon Lite's anchored-sprite handle-API scene (label parented to a
 * moving 3D box) and compares against the BJS reference rendering.
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import { attachCompareArtifacts, captureGolden, compareImages, getSceneConfig } from "../compare-utils";

const sceneConfig = getSceneConfig(40);
const REFERENCE_DIR = path.resolve(__dirname, "../../../reference/scene40-anchored-handles");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

test("Scene 40 — Anchored Sprite Handles + 3D Parenting matches BJS reference", async ({ page }, testInfo) => {
    const browser = page.context().browser()!;
    await captureGolden(browser, { sceneId: 40 });

    await page.goto("/scene40.html");
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.ready === "true", { timeout: 20_000 });
    await page.waitForTimeout(500);

    const screenshotPath = path.join(REFERENCE_DIR, "test-actual.png");
    await page.locator("canvas").screenshot({ path: screenshotPath });

    const full = compareImages(screenshotPath, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, screenshotPath, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Full image (${full.totalPixels} px): MAD=${full.mad.toFixed(3)}`);

    expect(full.mad, `Full image MAD should be ≤ ${sceneConfig.maxMad}`).toBeLessThanOrEqual(sceneConfig.maxMad);
});
