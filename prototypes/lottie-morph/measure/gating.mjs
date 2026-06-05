// Gating proof: builds the player with code-splitting and shows that the two renderers
// (fill / image) land in SEPARATE dynamic chunks. Because the player dynamic-imports only
// the renderer a given file needs, the per-file runtime cost is:
//     base (always loaded) + only that file's renderer chunk.
// A shapes file never fetches the image chunk, and an image file never fetches the fill chunk.

import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

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

const result = await build({
    entryPoints: [resolve(here, "player-entry.ts")],
    bundle: true,
    minify: true,
    format: "esm",
    target: "esnext",
    splitting: true,
    outdir: resolve(here, "out-split"),
    metafile: true,
    write: true,
    logLevel: "silent",
    plugins: [jsToTs],
});

function kb(n) {
    return (n / 1024).toFixed(2) + " KB";
}
function sizeOf(file) {
    const bytes = readFileSync(file);
    return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
}

// Classify each output chunk by what it contains.
const GATED_ENGINE = ["_mat4-storage-f64", "floating-origin", "pack-mat4-with-offset"];
const chunks = [];
for (const [file, info] of Object.entries(result.metafile.outputs)) {
    const inputs = Object.keys(info.inputs).map((p) => p.replace(/\\/g, "/"));
    const hasFill = inputs.some((p) => p.endsWith("src/fill-renderer.ts"));
    const hasImage = inputs.some((p) => p.endsWith("src/image-renderer.ts"));
    const hasStroke = inputs.some((p) => p.endsWith("src/stroke-geometry.ts"));
    const hasText = inputs.some((p) => p.endsWith("src/text-renderer.ts"));
    const gatedEngine = inputs.length > 0 && inputs.every((p) => GATED_ENGINE.some((g) => p.includes(g)));
    let role;
    if (hasStroke) {
        role = "stroke-geometry chunk (strokes only)";
    } else if (hasText) {
        role = "text-renderer chunk (text only)";
    } else if (hasFill) {
        role = "fill-renderer chunk (shapes only)";
    } else if (hasImage) {
        role = "image-renderer chunk (images only)";
    } else if (gatedEngine) {
        role = "engine-dynamic (gated, never runs)";
    } else {
        role = "base (always loaded)";
    }
    chunks.push({ file: basename(file), role, ...sizeOf(file), hasFill, hasImage, hasStroke, hasText, gatedEngine });
}

const base = chunks.filter((c) => c.role.startsWith("base"));
const fill = chunks.find((c) => c.hasFill);
const image = chunks.find((c) => c.hasImage);
const stroke = chunks.find((c) => c.hasStroke);
const text = chunks.find((c) => c.hasText);
const baseRaw = base.reduce((s, c) => s + c.raw, 0);
const baseGz = base.reduce((s, c) => s + c.gzip, 0);

console.log(`\n=== Chunks (code-split build) ===`);
for (const c of chunks.sort((a, b) => b.raw - a.raw)) {
    console.log(`  ${kb(c.raw).padStart(10)} raw  ${kb(c.gzip).padStart(9)} gzip   ${c.role}  [${c.file}]`);
}

console.log(`\n=== Per-file runtime cost (base + only the needed renderers) ===`);
if (fill) {
    console.log(`  teams.json (shapes):  ${kb(baseRaw + fill.raw)} raw   ${kb(baseGz + fill.gzip)} gzip   (base + fill, NO image/stroke)`);
}
if (image) {
    console.log(`  fluent.json (images): ${kb(baseRaw + image.raw)} raw   ${kb(baseGz + image.gzip)} gzip   (base + image, NO fill/stroke)`);
}
if (fill && stroke) {
    console.log(`  fre.json (shapes+stroke): ${kb(baseRaw + fill.raw + stroke.raw)} raw   ${kb(baseGz + fill.gzip + stroke.gzip)} gzip   (base + fill + stroke, NO image)`);
}
console.log(`\n  base alone:           ${kb(baseRaw)} raw   ${kb(baseGz)} gzip`);
if (fill) {
    console.log(`  fill-renderer chunk:  ${kb(fill.raw)} raw   ${kb(fill.gzip)} gzip`);
}
if (stroke) {
    console.log(`  stroke-geometry chunk:${kb(stroke.raw)} raw   ${kb(stroke.gzip)} gzip   (saved by a stroke-less file)`);
}
if (image) {
    console.log(`  image-renderer chunk: ${kb(image.raw)} raw   ${kb(image.gzip)} gzip   (saved by a shapes-only file)`);
}
if (text) {
    console.log(`  text-renderer chunk:  ${kb(text.raw)} raw   ${kb(text.gzip)} gzip   (saved by a text-less file)`);
}
console.log("");
