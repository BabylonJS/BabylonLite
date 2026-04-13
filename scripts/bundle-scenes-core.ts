/**
 * Shared core for building tree-shaken, minified per-scene bundles.
 *
 * Each scene is built independently (separate Rollup pass) so:
 *  - Bundle sizes reflect true standalone cost (no shared-chunk inflation)
 *
 * After building, a headless browser loads each bundle-sceneN.html page and
 * measures only the JS bytes actually fetched at runtime.  Dynamic-import
 * chunks that are never loaded (e.g. animation for a static model) are
 * correctly excluded from the manifest numbers.
 */
import { resolve, dirname, join, extname } from "path";
import { rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { gzipSync } from "zlib";
import { spawn } from "child_process";

import { createServer, type Server } from "http";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

export const labDir = resolve(ROOT, "apps/manual-lab");
export const outDir = resolve(labDir, "public/bundle");
export const srcDir = resolve(ROOT, "packages/babylon-lite/src");

const sceneConfig: { id: number }[] = JSON.parse(readFileSync(resolve(ROOT, "scene-config.json"), "utf-8"));
const ALL_SCENES = sceneConfig.map((s) => `scene${s.id}`);
const SCENES = process.env.BUNDLE_SCENES ? process.env.BUNDLE_SCENES.split(",") : ALL_SCENES;
const BJS_SCENES = process.env.SKIP_BJS ? [] : SCENES.map((s) => `bjs-${s}`);

const MIME: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".css": "text/css",
};

function startStaticServer(root: string): Promise<{ server: Server; port: number }> {
    const publicDir = join(root, "public");
    return new Promise((res) => {
        const server = createServer((req, resp) => {
            const url = (req.url ?? "/").split("?")[0]!;
            // Try root first (HTML pages), then public/ (bundle JS, assets)
            let filePath = join(root, url === "/" ? "index.html" : url);
            if (!existsSync(filePath)) filePath = join(publicDir, url);
            if (existsSync(filePath) && !filePath.includes("..")) {
                resp.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
                resp.end(readFileSync(filePath));
            } else {
                resp.writeHead(404);
                resp.end();
            }
        });
        server.listen(0, () => {
            const addr = server.address();
            res({ server, port: typeof addr === "object" ? addr!.port : 0 });
        });
    });
}

export async function buildBundleScenes(): Promise<void> {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    // ── 1. Build all scenes in parallel (worker processes) ───────────────
    const allScenes = [...SCENES, ...BJS_SCENES];
    const CONCURRENCY = Math.min(allScenes.length, Math.max(1, (await import("os")).cpus().length));
    const workerScript = resolve(__dirname, "build-scene-worker.ts");

    console.log(`Building ${allScenes.length} scenes (${CONCURRENCY} workers)...`);

    function spawnBuild(scene: string): Promise<void> {
        return new Promise((res, rej) => {
            const child = spawn("npx", ["tsx", workerScript, scene], {
                env: { ...process.env, BUNDLE_OUT_DIR: outDir },
                stdio: "inherit",
                shell: true,
            });
            child.on("exit", (code) => {
                if (code === 0) {
                    res();
                } else {
                    rej(new Error(`Build failed for ${scene} (exit code ${code})`));
                }
            });
            child.on("error", rej);
        });
    }

    // Concurrency pool
    let completed = 0;
    const queue = [...allScenes];
    const errors: Error[] = [];

    async function runWorker(): Promise<void> {
        while (queue.length > 0) {
            const scene = queue.shift()!;
            try {
                await spawnBuild(scene);
                completed++;
                console.log(`[${completed}/${allScenes.length}] ✓ ${scene}`);
            } catch (e) {
                completed++;
                console.error(`[${completed}/${allScenes.length}] ✗ ${scene}`);
                errors.push(e as Error);
            }
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => runWorker()));

    if (errors.length > 0) {
        for (const e of errors) {
            console.error(e.message);
        }
        throw new Error(`${errors.length} scene build(s) failed`);
    }

    // ── 2. Measure real runtime sizes via headless browser ───────────────
    // Manifest is written incrementally so the UI can refresh mid-build.
    const manifest = await measureLiveSizes();

    console.log("\n=== Per-scene bundle sizes (live runtime measurement) ===");
    for (const scene of SCENES) {
        const s = manifest[scene];
        if (s) {
            let line = `  ${scene}: ${s.rawKB} KB raw, ${s.gzipKB} KB gzip`;
            if (s.bjsRawKB != null) line += `  |  BJS: ${s.bjsRawKB} KB raw, ${s.bjsGzipKB} KB gzip`;
            console.log(line);
        }
    }
    console.log(`✓ Bundle scenes + manifest built to ${outDir}`);
}

/**
 * Start a temporary static server, launch a headless browser, load each
 * bundle-sceneN.html, and measure only the /bundle/*.js bytes that are
 * actually fetched at runtime.
 */
async function measureLiveSizes(): Promise<Record<string, { rawKB: number; gzipKB: number; bjsRawKB?: number; bjsGzipKB?: number }>> {
    const { chromium } = await import("@playwright/test");
    const { server, port } = await startStaticServer(labDir);
    const manifestPath = resolve(outDir, "manifest.json");

    // Load existing manifest so we can update incrementally (UI can refresh mid-build)
    let manifest: Record<string, { rawKB: number; gzipKB: number; bjsRawKB?: number; bjsGzipKB?: number }> = {};
    if (existsSync(manifestPath)) {
        try {
            manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        } catch {
            /* start fresh */
        }
    }

    function flush(): void {
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }

    try {
        const browser = await chromium.launch({ channel: "chrome", headless: true });

        // Measure Lite scenes (write after each)
        for (const scene of SCENES) {
            const { rawKB, gzipKB } = await measurePage(browser, port, `bundle-${scene}.html`, "/bundle/");
            manifest[scene] = { ...manifest[scene], rawKB, gzipKB };
            flush();
        }

        // Measure BJS scenes and merge into manifest (write after each)
        for (const bjsScene of BJS_SCENES) {
            const liteScene = bjsScene.replace("bjs-", "");
            const { rawKB, gzipKB } = await measurePage(browser, port, `bundle-${bjsScene}.html`, "/bundle/");
            if (manifest[liteScene]) {
                manifest[liteScene].bjsRawKB = rawKB;
                manifest[liteScene].bjsGzipKB = gzipKB;
                flush();
            }
        }

        await browser.close();
    } finally {
        server.close();
    }

    return manifest;
}

async function measurePage(browser: any, port: number, htmlFile: string, bundlePath: string): Promise<{ rawKB: number; gzipKB: number }> {
    const page = await browser.newPage();
    const jsPayloads: Buffer[] = [];

    page.on("response", async (resp: any) => {
        const url = resp.url();
        if (url.includes(bundlePath) && url.endsWith(".js") && resp.ok()) {
            try {
                jsPayloads.push(await resp.body());
            } catch {
                /* page may close before body resolves */
            }
        }
    });

    await page.goto(`http://localhost:${port}/${htmlFile}`);
    try {
        await page.waitForFunction(() => document.querySelector("canvas")?.dataset.ready === "true", { timeout: 30_000 });
    } catch {
        // BJS pages may not reach ready state without GPU — just measure fetched JS
    }

    let rawTotal = 0;
    let gzipTotal = 0;
    for (const body of jsPayloads) {
        rawTotal += body.length;
        gzipTotal += gzipSync(body, { level: 9 }).length;
    }

    await page.close();
    return {
        rawKB: Math.round((rawTotal / 1024) * 10) / 10,
        gzipKB: Math.round((gzipTotal / 1024) * 10) / 10,
    };
}
