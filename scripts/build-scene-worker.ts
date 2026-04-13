/**
 * Worker script — builds a single scene bundle.
 * Invoked by bundle-scenes-core.ts via child_process.fork().
 *
 * Expects: process.argv[2] = scene name (e.g. "scene1" or "bjs-scene1")
 * Env: BUNDLE_OUT_DIR = output directory
 */
import { build, type Plugin } from "vite";
import { resolve, dirname, join } from "path";
import { rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { initialize as initMiniray, minify as minifyWgslMiniray } from "miniray";
import { minify as terserMinify } from "terser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const labDir = resolve(ROOT, "apps/manual-lab");
const outDir = process.env.BUNDLE_OUT_DIR || resolve(labDir, "public/bundle");

const scene = process.argv[2];
if (!scene) {
    process.exit(1);
}

const NAME_POLYFILL = 'var __name=(fn,name)=>(Object.defineProperty(fn,"name",{value:name,configurable:true}),fn);';

// ── Plugins (same as bundle-scenes-core.ts) ─────────────────────────

function wgslMinifyPlugin(): Plugin {
    return {
        name: "wgsl-minify",
        enforce: "pre",
        async buildStart() {
            await initMiniray();
        },
        transform(code: string, id: string) {
            if (!id.includes(".wgsl")) return null;
            const match = code.match(/^export default "(.*)"$/s);
            if (!match) return null;
            const raw = JSON.parse(`"${match[1]}"`);
            const result = minifyWgslMiniray(raw, { mangle: false });
            const minified = typeof result === "string" ? result : result.code;
            return { code: `export default ${JSON.stringify(minified)}`, map: null };
        },
        renderChunk(code: string) {
            return { code: minifyTemplateWgsl(code), map: null };
        },
    };
}

function minifyTemplateWgsl(code: string): string {
    const out: string[] = [];
    let i = 0;
    const len = code.length;

    while (i < len) {
        const ch = code[i]!;

        // Skip regular string literals
        if (ch === '"' || ch === "'") {
            const q = ch;
            let j = i + 1;
            while (j < len && code[j] !== q) {
                if (code[j] === "\\") j++;
                j++;
            }
            out.push(code.slice(i, j + 1));
            i = j + 1;
            continue;
        }

        // Skip line comments
        if (ch === "/" && i + 1 < len && code[i + 1] === "/") {
            let j = i;
            while (j < len && code[j] !== "\n") j++;
            out.push(code.slice(i, j));
            i = j;
            continue;
        }

        // Template literal — minify WGSL whitespace
        if (ch === "`") {
            out.push("`");
            i++;
            i = processTemplateLiteral(code, i, len, out);
            continue;
        }

        out.push(ch);
        i++;
    }
    return out.join("");
}

function processTemplateLiteral(code: string, i: number, len: number, out: string[]): number {
    while (i < len) {
        const ch = code[i]!;

        if (ch === "\\") {
            out.push(ch, code[i + 1] ?? "");
            i += 2;
            continue;
        }
        if (ch === "`") {
            out.push("`");
            return i + 1;
        }
        if (ch === "$" && i + 1 < len && code[i + 1] === "{") {
            out.push("${");
            i += 2;
            let depth = 1;
            while (i < len && depth > 0) {
                const ec = code[i]!;
                if (ec === "{") depth++;
                else if (ec === "}") {
                    depth--;
                    if (depth === 0) { out.push("}"); i++; break; }
                } else if (ec === "`") {
                    out.push("`"); i++;
                    i = processTemplateLiteral(code, i, len, out);
                    continue;
                } else if (ec === '"' || ec === "'") {
                    const q = ec;
                    let j = i + 1;
                    while (j < len && code[j] !== q) { if (code[j] === "\\") j++; j++; }
                    out.push(code.slice(i, j + 1));
                    i = j + 1;
                    continue;
                }
                out.push(ec);
                i++;
            }
            continue;
        }

        // Strip WGSL line comments
        if (ch === "/" && i + 1 < len && code[i + 1] === "/") {
            i += 2;
            while (i < len && code[i] !== "\n") i++;
            continue;
        }

        // Strip spaces around operators
        if (ch === " ") {
            const prev = out.length > 0 ? out[out.length - 1]! : "";
            const prevCh = prev.length > 0 ? prev[prev.length - 1]! : "";
            const next = i + 1 < len ? code[i + 1]! : "";
            const ops = ":=,+-*/<>(){}[];";
            if (ops.includes(prevCh) || ops.includes(next)) { i++; continue; }
        }

        // Replace newlines with space
        if (ch === "\n") { out.push(" "); i++; continue; }

        out.push(ch);
        i++;
    }
    return i;
}

function terserPropertyManglePlugin(): Plugin {
    return {
        name: "terser-property-mangle",
        async generateBundle(_options, bundle) {
            const nameCache: Record<string, unknown> = {};

            for (const [, chunk] of Object.entries(bundle)) {
                if (chunk.type !== "chunk") {
                    continue;
                }

                const result = await terserMinify(chunk.code, {
                    compress: false,
                    mangle: {
                        properties: {
                            regex: /^_[a-z]/,
                            reserved: ["_pad", "_pad0", "_pad1", "_pad2", "_pad3", "_pad4", "_imgPad0", "_imgPad1"],
                        },
                    },
                    nameCache,
                    sourceMap: false,
                });

                if (result.code) {
                    chunk.code = result.code;
                }
            }
        },
    };
}

const BJS_SIDE_EFFECT_MODULES = ["thinInstanceMesh"];
function isBjsSideEffectModule(id: string): boolean {
    return BJS_SIDE_EFFECT_MODULES.some((m) => id.includes(m));
}

function bjsSideEffectsFalsePlugin(): Plugin {
    return {
        name: "bjs-side-effects-false",
        resolveId: {
            order: "pre" as const,
            async handler(source, importer, options) {
                if (!source.includes("@babylonjs")) return null;
                const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
                if (!resolved) return null;
                if (isBjsSideEffectModule(source)) return { ...resolved, moduleSideEffects: true };
                return { ...resolved, moduleSideEffects: false };
            },
        },
    };
}

// ── Build ───────────────────────────────────────────────────────────

function getAllJsFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) results.push(...getAllJsFiles(fullPath));
        else if (entry.name.endsWith(".js")) results.push(fullPath);
    }
    return results;
}

const isBjs = scene.startsWith("bjs-");
const sceneOutDir = resolve(outDir, scene);

async function main() {
    await build({
    root: labDir,
    configFile: false,
    publicDir: false,
    logLevel: "warn",
    plugins: isBjs ? [bjsSideEffectsFalsePlugin()] : [wgslMinifyPlugin(), terserPropertyManglePlugin()],
    build: {
        outDir: sceneOutDir,
        emptyOutDir: true,
        minify: "esbuild",
        sourcemap: false,
        modulePreload: false,
        rollupOptions: {
            input: { [scene]: resolve(labDir, isBjs ? `src/bjs/${scene.slice(4)}.ts` : `src/lite/${scene}.ts`) },
            output: {
                format: "es",
                entryFileNames: "[name].js",
                chunkFileNames: `${scene}-[name]-[hash].js`,
                banner: NAME_POLYFILL,
            },
            ...(isBjs && { treeshake: { moduleSideEffects: (id: string) => !id.includes("@babylonjs") || isBjsSideEffectModule(id) } }),
        },
        ...(isBjs && { target: "esnext" }),
    },
});

    // Move files from sceneN/ subdir to parent
    const jsFiles = getAllJsFiles(sceneOutDir);
    for (const f of jsFiles) {
        const name = f.substring(sceneOutDir.length + 1).replace(/\\/g, "/");
        const dest = resolve(outDir, name);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(f));
    }
    rmSync(sceneOutDir, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
