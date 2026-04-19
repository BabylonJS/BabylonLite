/**
 * Scene 36 — Billboard Facing parity test (Family 3, spherical billboard).
 *
 * Reference is a BJS textured plane (`MeshBuilder.CreatePlane`) oriented
 * each frame with the SAME basis as Lite's `composeFacingBillboard` WGSL:
 *   right = camera.worldMatrix column 0
 *   up    = camera.worldMatrix column 1
 *
 * This matches the recipe scenes 35 (yaw) and 36 (axis) use and reaches
 * MAD = 0.0000.
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import { attachCompareArtifacts, captureGolden, compareImages, getSceneConfig } from "../compare-utils";

const SEEK_TIME = 1.0;
const sceneConfig = getSceneConfig(36);
const REFERENCE_DIR = path.resolve(__dirname, "../../../reference/scene36-billboard-facing");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

test("Scene 36 — Billboard Facing matches BJS textured-plane golden at seekTime=1.0s", async ({ page }, testInfo) => {
    const browser = page.context().browser()!;
    await captureGolden(browser, { sceneId: 36, seekTime: SEEK_TIME });

    await page.goto(`/scene36.html?seekTime=${SEEK_TIME}`);
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
