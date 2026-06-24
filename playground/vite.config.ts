import { defineConfig } from "vite";

/**
 * The Lite Playground app (editor + runner shell). The self-hosted engine under
 * `public/engine/dev/` is produced separately by `vite.engine.config.ts` (run via
 * the `build:engine` script) and served as a static asset; this build only owns
 * the playground UI.
 */
export default defineConfig({
    server: {
        // Bind both IPv4 and IPv6 loopback. Vite's default `localhost` can bind
        // only one stack (we saw it land on IPv6 ::1 only), so a browser that
        // resolves localhost -> 127.0.0.1 gets a refused connection and a blank
        // page. `host: true` listens on all interfaces, covering both stacks.
        host: true,
        port: 5175,
        // Fail loudly if 5175 is taken instead of silently drifting to another
        // port (which makes the printed URL not match what you opened).
        strictPort: true,
    },
    build: {
        target: "esnext",
        sourcemap: true,
    },
    worker: {
        format: "es",
    },
});
