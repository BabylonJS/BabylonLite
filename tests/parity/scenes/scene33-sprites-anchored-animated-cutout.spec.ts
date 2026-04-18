/**
 * Scene 33 — Sprites Anchored Animated + Cutout Parity Test (Family 2)
 *
 * Two anchored layers in a 3D scene with a static camera:
 *   - Alpha-blend layer: animated `spin` clip frozen at seekTime.
 *   - Cutout layer: depth-writing silhouettes with alphaCutoff=0.5.
 *
 * Reference is Lite-fallback (per docs/architecture/26-sprites.md): no
 * tractable canvas2D analogue exists for the cutout depth-write contract
 * in a 3D scene, so the captured golden serves as a regression snapshot.
 *
 * Picking smoke-test asserts pickable vs non-pickable cutout sprites.
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import { attachCompareArtifacts, captureGolden, compareImages, getSceneConfig } from "../compare-utils";

const SEEK_TIME = 0.5;
const sceneConfig = getSceneConfig(33);
const REFERENCE_DIR = path.resolve(__dirname, "../../../reference/scene33-sprites-anchored-animated-cutout");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

interface PickResult {
    label: string;
    expectedHit: boolean;
    hit: boolean;
}

test("Scene 33 — Sprites Anchored Animated Cutout matches Lite-fallback golden at seekTime=0.5s", async ({ page }, testInfo) => {
    const browser = page.context().browser()!;
    await captureGolden(browser, { sceneId: 33, seekTime: SEEK_TIME });

    await page.goto(`/scene33.html?seekTime=${SEEK_TIME}`);
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.ready === "true", { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.animationFrozen === "true", { timeout: 20_000 });
    await page.waitForTimeout(500);

    const screenshotPath = path.join(REFERENCE_DIR, "test-actual.png");
    await page.locator("canvas").screenshot({ path: screenshotPath });

    const full = compareImages(screenshotPath, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, screenshotPath, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Full image (${full.totalPixels} px): MAD=${full.mad.toFixed(3)}`);
    expect(full.mad, `Full image MAD should be ≤ ${sceneConfig.maxMad}`).toBeLessThanOrEqual(sceneConfig.maxMad);

    const pickResults: PickResult[] = JSON.parse((await page.locator("canvas").getAttribute("data-pick-results")) ?? "[]");
    expect(pickResults).toHaveLength(2);
    for (const r of pickResults) {
        expect(r.hit, `${r.label}: expected hit=${r.expectedHit}`).toBe(r.expectedHit);
    }
});
