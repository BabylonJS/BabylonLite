/**
 * Scene 91 — Skinned Shadow Casting Parity Test
 *
 * Validates that the directional shadow generator can render skinned (animated)
 * caster meshes. Both the golden reference (Babylon.js) and the Babylon Lite
 * scene seek to exactly 2 s of animation time (via ?seekTime=2) so the
 * skeleton pose is identical when the screenshot is taken.
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import { attachCompareArtifacts, captureGolden, compareImages, getSceneConfig } from "../compare-utils";

const sceneConfig = getSceneConfig(91);
const REFERENCE_DIR = path.resolve(__dirname, "../../../reference/scene91-skinned-shadow");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

test.skip(!!sceneConfig.skipParity, "Scene 91 skipped via skipParity in scene-config.json");

test("Scene 91 — Skinned Shadow Casting matches Babylon.js reference", async ({ page }, testInfo) => {
    const browser = page.context().browser()!;
    await captureGolden(browser, { sceneId: 91, seekTime: 2 });

    await page.goto("/scene91.html?seekTime=2");

    // Wait for canvas ready, then for the seek-frame freeze signal.
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.ready === "true", { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.animationFrozen === "true", { timeout: 30_000 });
    // GPU queue flush — animation is frozen so no extra frames advance.
    await page.waitForTimeout(200);

    const screenshotPath = path.join(REFERENCE_DIR, "test-actual.png");
    await page.locator("canvas").screenshot({ path: screenshotPath });

    const full = compareImages(screenshotPath, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, screenshotPath, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Full image (${full.totalPixels} px):`);
    console.log(`  MAD: ${full.mad.toFixed(3)}`);
    console.log(`  Exact: ${((100 * full.exactMatch) / full.totalPixels).toFixed(1)}%`);
    console.log(`  ≤1: ${((100 * full.within1) / full.totalPixels).toFixed(1)}%`);
    console.log(`  ≤5: ${((100 * full.within5) / full.totalPixels).toFixed(1)}%`);

    expect(full.mad, `Full image MAD should be ≤ ${sceneConfig.maxMad}`).toBeLessThanOrEqual(sceneConfig.maxMad);
});
