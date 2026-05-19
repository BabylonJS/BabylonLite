/**
 * Build Perf Baseline — builds bundle scenes from the last release tag (or master)
 * into lab/public/bundle-baseline/ and generates matching HTML loader pages.
 *
 * Uses git worktree to checkout the baseline ref without disturbing the working tree.
 *
 * Env:  PERF_BASELINE_REF — override the git ref to use (default: latest tag or upstream/master, then origin/master)
 *
 * Usage: tsx scripts/build-perf-baseline.ts
 */
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const WORKTREE_DIR = resolve(ROOT, ".perf-baseline-worktree");
const BASELINE_OUT = resolve(ROOT, "lab/public/bundle-baseline");
const BASELINE_HTML_DIR = resolve(ROOT, "lab");

interface SceneConfigEntry {
    id: number;
    slug: string;
    name: string;
}

function run(cmd: string, opts?: { cwd?: string; env?: Record<string, string> }): string {
    return execSync(cmd, {
        encoding: "utf-8",
        cwd: opts?.cwd ?? ROOT,
        env: opts?.env ? { ...process.env, ...opts.env } : undefined,
    }).trim();
}

// ── 1. Determine baseline ref ──────────────────────────────────────

function getBaselineRef(): string {
    const override = process.env.PERF_BASELINE_REF;
    if (override) {
        console.log(`Using override ref: ${override}`);
        return override;
    }

    // Find the latest semver tag reachable from HEAD
    try {
        const tag = run("git describe --tags --abbrev=0 --match 'v*'");
        if (tag) {
            console.log(`Found latest release tag: ${tag}`);
            return tag;
        }
    } catch {
        // No tags found
    }

    console.log("No release tags found, falling back to default branch");

    // Try common remote branch names. In fork checkouts, `origin/master` can lag
    // BabylonJS master, so prefer `upstream/*` when that remote exists.
    for (const ref of ["upstream/master", "upstream/main", "origin/master", "origin/main"]) {
        try {
            run(`git rev-parse ${ref}`);
            console.log(`Using fallback ref: ${ref}`);
            return ref;
        } catch {
            // not available
        }
    }

    // Last resort: previous commit
    console.log("No remote branches found, using HEAD~1");
    return "HEAD~1";
}

const baselineRef = getBaselineRef();

// If we're already on the baseline ref, skip the build
const currentSha = run("git rev-parse HEAD");
let baselineSha: string;
try {
    baselineSha = run(`git rev-parse ${baselineRef}`);
} catch {
    console.error(`Error: could not resolve ref '${baselineRef}'. Make sure the tag or branch exists.`);
    process.exit(1);
}

if (currentSha === baselineSha) {
    console.log("Current HEAD is the baseline ref — nothing to compare against. Skipping.");
    process.exit(0);
}

// ── 2. Create git worktree for baseline ref ────────────────────────

console.log(`\nChecking out ${baselineRef} (${baselineSha.slice(0, 8)}) into worktree...`);

// Clean up any previous worktree
if (existsSync(WORKTREE_DIR)) {
    try {
        run(`git worktree remove --force "${WORKTREE_DIR}"`);
    } catch {
        rmSync(WORKTREE_DIR, { recursive: true, force: true });
        try {
            run("git worktree prune");
        } catch {
            /* ignore */
        }
    }
}

run(`git worktree add --detach "${WORKTREE_DIR}" ${baselineRef}`);

// ── 3. Install deps & build bundle scenes in worktree ──────────────

console.log("\nInstalling dependencies in worktree...");
try {
    run("pnpm install --frozen-lockfile", { cwd: WORKTREE_DIR });
} catch {
    // lockfile might differ between versions — allow unfrozen
    run("pnpm install", { cwd: WORKTREE_DIR });
}

// Use the current bundle builder for baseline generation. This keeps perf
// comparisons focused on runtime source changes, not historical bundler bugs.
cpSync(resolve(ROOT, "scripts/bundle-scenes-core.ts"), resolve(WORKTREE_DIR, "scripts/bundle-scenes-core.ts"));

const baselineScenes: SceneConfigEntry[] = JSON.parse(readFileSync(resolve(WORKTREE_DIR, "scene-config.json"), "utf-8"));
const baselineSceneKeys = new Set(baselineScenes.map((scene) => `scene${scene.id}`));
const requestedBundleScenes = process.env.BUNDLE_SCENES?.split(",")
    .map((scene) => scene.trim())
    .filter(Boolean);
const baselineBundleScenes = requestedBundleScenes?.filter(
    (scene) => baselineSceneKeys.has(scene) && existsSync(resolve(WORKTREE_DIR, `lab/src/lite/${scene}.ts`))
);

if (requestedBundleScenes) {
    const skippedScenes = requestedBundleScenes.filter((scene) => !baselineBundleScenes!.includes(scene));
    if (skippedScenes.length) {
        console.log(`Skipping ${skippedScenes.length} scene(s) missing from baseline ${baselineRef}: ${skippedScenes.join(", ")}`);
    }
}

const builtBaselineSceneIds = new Set(
    (baselineBundleScenes ?? baselineScenes.map((scene) => `scene${scene.id}`)).map((scene) => Number(scene.replace(/^scene/, ""))).filter(Number.isFinite)
);

if (builtBaselineSceneIds.size > 0) {
    const buildEnv: Record<string, string> = { SKIP_BJS: "true", SKIP_MEASURE: "true" };
    if (baselineBundleScenes) {
        buildEnv.BUNDLE_SCENES = baselineBundleScenes.join(",");
    }

    console.log("\nBuilding bundle scenes from baseline (Lite only, skip measurement)...");
    run("pnpm build:bundle-scenes", {
        cwd: WORKTREE_DIR,
        env: buildEnv,
    });
} else {
    console.log(`\nNo requested scenes exist in baseline ${baselineRef}; baseline build skipped.`);
}

// ── 4. Copy baseline bundles to lab/public/bundle-baseline/ ────────

console.log("\nCopying baseline bundles...");
const worktreeBundleDir = resolve(WORKTREE_DIR, "lab/public/bundle");

if (builtBaselineSceneIds.size > 0 && !existsSync(worktreeBundleDir)) {
    console.error("Error: baseline bundle build did not produce lab/public/bundle/");
    process.exit(1);
}

// Clean and copy
if (existsSync(BASELINE_OUT)) {
    rmSync(BASELINE_OUT, { recursive: true });
}
mkdirSync(BASELINE_OUT, { recursive: true });
if (builtBaselineSceneIds.size > 0) {
    cpSync(worktreeBundleDir, BASELINE_OUT, { recursive: true });
}

// ── 5. Generate HTML loader pages ──────────────────────────────────

console.log("Generating baseline HTML pages...");
const scenes: SceneConfigEntry[] = JSON.parse(readFileSync(resolve(ROOT, "scene-config.json"), "utf-8"));

const htmlScenes = scenes.filter((scene) => builtBaselineSceneIds.has(scene.id));
for (const scene of htmlScenes) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Babylon Lite — ${scene.name} (Baseline Bundle)</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
    canvas { width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>
  <canvas id="renderCanvas"></canvas>
  <script src="/loader.js"></script>
  <script type="module" src="/bundle-baseline/scene${scene.id}.js"></script>
</body>
</html>`;
    writeFileSync(resolve(BASELINE_HTML_DIR, `bundle-baseline-scene${scene.id}.html`), html);
}

// ── 6. Clean up worktree ───────────────────────────────────────────

console.log("\nCleaning up worktree...");
try {
    run(`git worktree remove --force "${WORKTREE_DIR}"`);
} catch {
    rmSync(WORKTREE_DIR, { recursive: true, force: true });
    try {
        run("git worktree prune");
    } catch {
        /* ignore */
    }
}

console.log(`\n✓ Baseline bundles from ${baselineRef} (${baselineSha.slice(0, 8)}) ready at ${BASELINE_OUT}`);
console.log(`✓ HTML pages generated for ${htmlScenes.length} baseline scene(s)`);
