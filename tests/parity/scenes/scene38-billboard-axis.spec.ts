/**
 * Scene 38 — Billboard Axis-Locked [1,0,0] parity test (Family 3).
 *
 * Reference is BJS textured planes oriented with the same axis-lock basis as
 * Lite's WGSL (up = lockAxis, right = normalize(cross(lockAxis, projected_toCam))).
 * BJS has no SpriteManager equivalent for axis-locked billboards.
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import { attachCompareArtifacts, captureGolden, compareImages, getSceneConfig } from "../compare-utils";

const SEEK_TIME = 1.0;
const sceneConfig = getSceneConfig(38);
const REFERENCE_DIR = path.resolve(__dirname, "../../../reference/scene38-billboard-axis");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

test("Scene 38 — Billboard Axis-Locked matches BJS textured-plane golden at seekTime=1.0s", async ({ page }, testInfo) => {
    const browser = page.context().browser()!;
    await captureGolden(browser, { sceneId: 38, seekTime: SEEK_TIME });

    await page.goto(`/scene38.html?seekTime=${SEEK_TIME}`);
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.ready === "true", { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.animationFrozen === "true", { timeout: 20_000 });
    await page.waitForTimeout(500);

    const screenshotPath = path.join(REFERENCE_DIR, "test-actual.png");
    await page.locator("canvas").screenshot({ path: screenshotPath });

    const full = compareImages(screenshotPath, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, screenshotPath, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Full image (${full.totalPixels} px): MAD=${full.mad.toFixed(4)}`);
    expect(full.mad, `Full image MAD should be ≤ ${sceneConfig.maxMad}`).toBeLessThanOrEqual(sceneConfig.maxMad);
});
