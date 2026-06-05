import { defineConfig } from "vite";
import { resolve } from "node:path";

// Standalone throwaway prototype. We import the Babylon Lite engine straight from
// workspace source (relative deep imports), so Vite must be allowed to serve files
// from the repo root, not just this folder.
const repoRoot = resolve(__dirname, "..", "..");

export default defineConfig({
    root: __dirname,
    server: {
        port: 5180,
        fs: { allow: [repoRoot] },
    },
    // Engine source uses .js specifiers that resolve to .ts on disk — Vite handles this.
    resolve: {
        extensions: [".ts", ".js", ".json"],
    },
});
