import { createLogger, defineConfig } from "vite";
import { resolve } from "path";

// Quiet the benign "Module … has been externalized for browser compatibility"
// warnings emitted while bundling the engine: the wasm glue in manifold-3d /
// recast-navigation references Node built-ins (module/fs/path) that are only
// touched by lazily-imported features, never on the default render path.
const logger = createLogger();
const baseWarn = logger.warn;
logger.warn = (msg, options) => {
    if (typeof msg === "string" && msg.includes("externalized for browser compatibility")) {
        return;
    }
    baseWarn(msg, options);
};

/**
 * Builds the self-hosted "nightly" engine bundle the runner iframe imports as
 * `@babylonjs/lite`. Emits an ES module (with code-split dynamic chunks kept
 * separate, so wasm-backed features stay lazy) into `public/engine/dev/`, which
 * the playground dev server and production build both serve statically.
 *
 * Output: public/engine/dev/index.js (+ chunks). Run via `pnpm build:engine`,
 * which the `dev` and `build` scripts invoke automatically.
 */
export default defineConfig({
    publicDir: false,
    customLogger: logger,
    build: {
        outDir: resolve(__dirname, "public/engine/dev"),
        emptyOutDir: true,
        target: "esnext",
        minify: "esbuild",
        sourcemap: true,
        lib: {
            entry: resolve(__dirname, "src/engine-entry.ts"),
            formats: ["es"],
            fileName: () => "index.js",
        },
        rollupOptions: {
            output: {
                // Keep dynamic-import chunks separate so lazy/wasm features only
                // load when a snippet actually uses them.
                inlineDynamicImports: false,
                chunkFileNames: "_chunks/[name]-[hash].js",
            },
        },
    },
});
