/**
 * Scene 39 — Sprite2D Handles + 2D Parenting Parity Test (Family 1, Handle API)
 *
 * Captures Babylon Lite's Sprite2D handle-API scene (moving character with a
 * parented health-bar) and compares against the BJS reference rendering of the
 * same layout via SpriteManager + manual per-frame parenting.
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import { attachCompareArtifacts, captureGolden, compareImages, getSceneConfig } from "../compare-utils";

const SEEK_TIME = 1.5;
const sceneConfig = getSceneConfig(39);
const REFERENCE_DIR = path.resolve(__dirname, "../../../reference/scene39-sprite2d-handles");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

test("Scene 39 — Sprite2D Handles + 2D Parenting matches BJS reference at seekTime=1.5s", async ({ page }, testInfo) => {
    const browser = page.context().browser()!;
    await captureGolden(browser, { sceneId: 39, seekTime: SEEK_TIME });

    await page.goto(`/scene39.html?seekTime=${SEEK_TIME}`);
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.ready === "true", { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.animationFrozen === "true", { timeout: 20_000 });
    await page.waitForTimeout(500);

    const screenshotPath = path.join(REFERENCE_DIR, "test-actual.png");
    await page.locator("canvas").screenshot({ path: screenshotPath });

    const full = compareImages(screenshotPath, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, screenshotPath, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Full image (${full.totalPixels} px): MAD=${full.mad.toFixed(3)}`);

    expect(full.mad, `Full image MAD should be ≤ ${sceneConfig.maxMad}`).toBeLessThanOrEqual(sceneConfig.maxMad);
});
