/**
 * Snapshot Bundle-Size Baseline
 *
 * Reads the production bundle manifest (lab/public/bundle/manifest.json)
 * and writes the sizes to baselines/bundle-size.json.
 *
 * Run this on release to update the baseline.
 *
 * Usage:
 *   pnpm build:bundle-scenes   # build prod bundles first
 *   npx tsx scripts/snapshot-bundle-baseline.ts
 *
 * No dev server or browser needed — reads directly from the build output.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

interface ManifestEntry {
    rawKB: number;
    gzipKB: number;
    bjsRawKB?: number;
    bjsGzipKB?: number;
}

interface BundleSizeEntry {
    rawKB: number;
    gzipKB: number;
}

interface BundleSizeBaseline {
    _comment: string;
    _updated: string;
    scenes: Record<string, BundleSizeEntry>;
}

const MANIFEST_PATH = resolve(__dirname, "../lab/public/bundle/manifest.json");
const BASELINE_PATH = resolve(__dirname, "../baselines/bundle-size.json");

function main(): void {
    if (!existsSync(MANIFEST_PATH)) {
        console.error(`Manifest not found at ${MANIFEST_PATH}`);
        console.error("Run 'pnpm build:bundle-scenes' first.");
        process.exit(1);
    }

    const manifest: Record<string, ManifestEntry> = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));

    const baseline: BundleSizeBaseline = {
        _comment: "Bundle size baseline — updated on each release. Values in KB.",
        _updated: new Date().toISOString(),
        scenes: {},
    };

    for (const [sceneName, entry] of Object.entries(manifest)) {
        baseline.scenes[sceneName] = {
            rawKB: Math.round(entry.rawKB * 10) / 10,
            gzipKB: Math.round(entry.gzipKB * 10) / 10,
        };
        console.log(`  ${sceneName}: ${entry.rawKB} KB raw, ${entry.gzipKB} KB gzip`);
    }

    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 4) + "\n");
    console.log(`\n✓ Wrote baseline to ${BASELINE_PATH}`);
}

main();
