// Bundle-size measurement for the tiny Lottie morph player.
//
// Builds two entries with esbuild (minified, ESM):
//   1. player-entry.ts — player + the Babylon Lite engine slice it actually pulls in
//   2. ../src/main.ts   — the full demo (viewer UI + player + engine)
//
// Reports raw + gzip JS bytes and a per-source-area breakdown from the metafile.
// The engine uses `.js` import specifiers that resolve to `.ts` on disk, so a small
// resolve plugin rewrites them (same job Vite's pipeline does in dev).

import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Rewrite relative `*.js` imports to `*.ts` when a sibling .ts exists. */
const jsToTs = {
    name: "js-to-ts",
    setup(b) {
        b.onResolve({ filter: /\.js$/ }, (args) => {
            if (args.kind === "entry-point" || !args.path.startsWith(".")) {
                return undefined;
            }
            const tsPath = resolve(args.resolveDir, args.path.replace(/\.js$/, ".ts"));
            return existsSync(tsPath) ? { path: tsPath } : undefined;
        });
    },
};

// Engine modules reached only via gated `await import()` (HPM / floating-origin). They are
// never executed for this config; a real code-splitting build emits them as separate,
// non-fetched chunks. esbuild inlined them here, so we tag them to subtract them out.
const GATED_ENGINE = ["math/_mat4-storage-f64", "large-world/floating-origin", "large-world/pack-mat4-with-offset"];

function categorize(p) {
    const n = p.replace(/\\/g, "/");
    if (n.includes("prototypes/lottie-morph/measure/")) {
        return "measure-entry";
    }
    if (n.includes("prototypes/lottie-morph/src/")) {
        return "player";
    }
    if (n.includes("packages/babylon-lite/")) {
        return GATED_ENGINE.some((g) => n.includes(g)) ? "engine-dynamic (gated, never runs)" : "engine";
    }
    return "other";
}

async function measure(label, entry) {
    const result = await build({
        entryPoints: [entry],
        bundle: true,
        minify: true,
        format: "esm",
        target: "esnext",
        outfile: resolve(here, "out", label + ".js"),
        metafile: true,
        write: true,
        logLevel: "silent",
        plugins: [jsToTs],
    });

    const outputs = result.metafile.outputs;
    let entryFile = null;
    let totalRaw = 0;
    let totalGzip = 0;
    const dynamicChunks = [];

    // The entry chunk is the one with an `entryPoint`; others are shared/dynamic chunks.
    for (const [file, info] of Object.entries(outputs)) {
        const bytes = readFileSync(file);
        const gz = gzipSync(bytes, { level: 9 }).length;
        if (info.entryPoint) {
            entryFile = file;
            totalRaw += bytes.length;
            totalGzip += gz;
        } else {
            dynamicChunks.push({ file, raw: bytes.length, gzip: gz });
        }
    }

    // Per-area breakdown from the entry chunk's inputs (post-tree-shake contribution).
    const areas = {};
    const engineModules = [];
    const playerModules = [];
    if (entryFile) {
        for (const [inPath, meta] of Object.entries(outputs[entryFile].inputs)) {
            const area = categorize(inPath);
            areas[area] = (areas[area] ?? 0) + meta.bytesInOutput;
            if (area === "engine" || area.startsWith("engine-dynamic")) {
                engineModules.push({ m: inPath.replace(/\\/g, "/").split("packages/babylon-lite/")[1], b: meta.bytesInOutput, gated: area !== "engine" });
            } else if (area === "player") {
                playerModules.push({ m: inPath.replace(/\\/g, "/").split("prototypes/lottie-morph/")[1], b: meta.bytesInOutput });
            }
        }
    }

    return { label, totalRaw, totalGzip, areas, engineModules, playerModules, dynamicChunks };
}

function kb(n) {
    return (n / 1024).toFixed(2) + " KB";
}

function printReport(r) {
    console.log(`\n=== ${r.label} ===`);
    console.log(`  Entry chunk (runtime-fetched):  ${kb(r.totalRaw)} raw   ${kb(r.totalGzip)} gzip`);
    console.log(`  Source-area split (minified bytes in chunk):`);
    for (const [k, v] of Object.entries(r.areas)) {
        if (v > 0) {
            console.log(`     ${k.padEnd(14)} ${kb(v)}`);
        }
    }
    if (r.playerModules.length) {
        console.log(`  Player modules:`);
        r.playerModules.sort((a, b) => b.b - a.b);
        for (const e of r.playerModules) {
            console.log(`     ${kb(e.b).padStart(10)}  ${e.m}`);
        }
    }
    if (r.engineModules.length) {
        console.log(`  Engine modules pulled in:`);
        r.engineModules.sort((a, b) => b.b - a.b);
        for (const e of r.engineModules) {
            console.log(`     ${kb(e.b).padStart(10)}  ${e.m}${e.gated ? "   (gated, never runs)" : ""}`);
        }
    }
    if (r.dynamicChunks.length) {
        console.log(`  Dynamic chunks (built, NOT fetched at runtime for this config):`);
        for (const d of r.dynamicChunks) {
            console.log(`     ${kb(d.raw).padStart(10)} raw  ${kb(d.gzip)} gzip  ${d.file.replace(/\\/g, "/").split("/measure/")[1]}`);
        }
    }
}

const player = await measure("player", resolve(here, "player-entry.ts"));
const demo = await measure("demo", resolve(here, "..", "src", "main.ts"));
printReport(player);
printReport(demo);

// Asset (animation JSON) is content, not code — reported separately for context.
const jsonBytes = readFileSync(resolve(here, "..", "public", "teams.json")).length;
const jsonGz = gzipSync(readFileSync(resolve(here, "..", "public", "teams.json")), { level: 9 }).length;
console.log(`\n=== animation data (content, not player code) ===`);
console.log(`  teams.json:  ${kb(jsonBytes)} raw   ${kb(jsonGz)} gzip`);
console.log("");
