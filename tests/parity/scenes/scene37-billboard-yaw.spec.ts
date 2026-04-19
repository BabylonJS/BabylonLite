/**
 * Scene 37 — Billboard Yaw-Locked parity test (Family 3, cylindrical billboard).
 *
 * Reference is BJS textured planes oriented with the same yaw-lock basis as
 * Lite's WGSL (up = worldY, right = cross(worldY, toCam)). See bjs/scene37.ts
 * for why we don't use BJS SpriteManager here.
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import { attachCompareArtifacts, captureGolden, compareImages, getSceneConfig } from "../compare-utils";

const SEEK_TIME = 1.0;
const sceneConfig = getSceneConfig(37);
const REFERENCE_DIR = path.resolve(__dirname, "../../../reference/scene37-billboard-yaw");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

test("Scene 37 — Billboard Yaw-Locked matches BJS textured-plane golden at seekTime=1.0s", async ({ page }, testInfo) => {
    const browser = page.context().browser()!;
    await captureGolden(browser, { sceneId: 37, seekTime: SEEK_TIME });

    await page.goto(`/scene37.html?seekTime=${SEEK_TIME}`);
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
