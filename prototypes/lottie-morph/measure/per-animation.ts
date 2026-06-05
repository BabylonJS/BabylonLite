// Per-animation bundle size: for each animation in public/, run the REAL parse +
// feature-detection to learn which gated chunks it loads, then sum base + those chunks.
//
//   npx tsx prototypes/lottie-morph/measure/per-animation.ts
//
// "Bundle to play X" = base (always loaded) + only the renderer chunks X actually triggers.
// Engine-dynamic chunks (HPM / floating-origin) never run and are excluded. The animation
// JSON itself is reported separately as the content payload (not player code).

import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAnimation } from "../src/parse.js";
import { detectFeatures } from "../src/feature-detect.js";
import type { LottieFile } from "../src/lottie-raw.js";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

const jsToTs = {
    name: "js-to-ts",
    setup(b: { onResolve: (o: object, cb: (a: { path: string; kind: string; resolveDir: string }) => unknown) => void }) {
        b.onResolve({ filter: /\.js$/ }, (args) => {
            if (args.kind === "entry-point" || !args.path.startsWith(".")) {
                return undefined;
            }
            const tsPath = resolve(args.resolveDir, args.path.replace(/\.js$/, ".ts"));
            return existsSync(tsPath) ? { path: tsPath } : undefined;
        });
    },
};

// 1. Code-split build → chunk sizes by role.
const result = await build({
    entryPoints: [resolve(here, "player-entry.ts")],
    bundle: true,
    minify: true,
    format: "esm",
    target: "esnext",
    splitting: true,
    outdir: resolve(here, "out-per-anim"),
    metafile: true,
    write: true,
    logLevel: "silent",
    plugins: [jsToTs],
});

const GATED_ENGINE = ["_mat4-storage-f64", "floating-origin", "pack-mat4-with-offset"];

interface Chunk {
    raw: number;
    gzip: number;
}
const roleSize: Record<string, Chunk> = {};
let baseRaw = 0;
let baseGz = 0;

for (const [file, info] of Object.entries(result.metafile.outputs)) {
    const bytes = readFileSync(file);
    const gzip = gzipSync(bytes, { level: 9 }).length;
    const inputs = Object.keys(info.inputs).map((p) => p.replace(/\\/g, "/"));
    const has = (suffix: string) => inputs.some((p) => p.endsWith(suffix));
    const gatedEngine = inputs.length > 0 && inputs.every((p) => GATED_ENGINE.some((g) => p.includes(g)));

    if (has("src/fill-renderer.ts")) {
        roleSize.fill = { raw: bytes.length, gzip };
    } else if (has("src/stroke-geometry.ts")) {
        roleSize.stroke = { raw: bytes.length, gzip };
    } else if (has("src/image-renderer.ts")) {
        roleSize.image = { raw: bytes.length, gzip };
    } else if (has("src/text-renderer.ts")) {
        roleSize.text = { raw: bytes.length, gzip };
    } else if (gatedEngine) {
        // excluded — never fetched at runtime
    } else {
        // entry + shared chunks = base
        baseRaw += bytes.length;
        baseGz += gzip;
    }
}

function kb(n: number): string {
    return (n / 1024).toFixed(2);
}

// 2. For each animation, detect features → which chunks it loads.
const files = readdirSync(publicDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

console.log(`\nBase (always loaded): ${kb(baseRaw)} KB raw / ${kb(baseGz)} KB gzip`);
console.log(`Feature chunks: fill ${kb(roleSize.fill.gzip)} · stroke ${kb(roleSize.stroke.gzip)} · image ${kb(roleSize.image.gzip)} · text ${kb(roleSize.text.gzip)} (KB gzip)\n`);

const rows: string[][] = [];
rows.push(["animation", "features", "player raw", "player gzip", "+ JSON gzip"]);

for (const f of files) {
    const json = JSON.parse(readFileSync(resolve(publicDir, f), "utf8")) as LottieFile;
    const anim = parseAnimation(json);
    const feat = detectFeatures(anim);

    let raw = baseRaw;
    let gz = baseGz;
    const used: string[] = [];
    if (feat.shapes) {
        raw += roleSize.fill.raw;
        gz += roleSize.fill.gzip;
        used.push("shapes");
    }
    if (feat.strokes) {
        raw += roleSize.stroke.raw;
        gz += roleSize.stroke.gzip;
        used.push("strokes");
    }
    if (feat.images) {
        raw += roleSize.image.raw;
        gz += roleSize.image.gzip;
        used.push("images");
    }
    if (feat.text) {
        raw += roleSize.text.raw;
        gz += roleSize.text.gzip;
        used.push("text");
    }

    const jsonGz = gzipSync(readFileSync(resolve(publicDir, f)), { level: 9 }).length;
    rows.push([f, used.join("+") || "none", `${kb(raw)} KB`, `${kb(gz)} KB`, `${kb(jsonGz)} KB`]);
}

// Pretty-print table.
const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
for (let i = 0; i < rows.length; i++) {
    const line = rows[i].map((cell, c) => cell.padEnd(widths[c])).join("  ");
    console.log("  " + line);
    if (i === 0) {
        console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
    }
}
console.log("");
