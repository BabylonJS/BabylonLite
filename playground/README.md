# Babylon Lite Playground

A modern, ES-first playground for [Babylon Lite](../packages/babylon-lite) — edit
TypeScript, run it live on a WebGPU canvas, and (soon) save & share snippets.

It is a workspace package in this monorepo. Run it from the repo root:

```bash
pnpm dev:playground     # http://localhost:5175
pnpm build:playground   # production build into playground/dist
```

(or `pnpm dev` / `pnpm build` from inside `playground/`.)

## How it works

- **Editor** — Monaco, editing TypeScript.
- **Transpile** — `esbuild-wasm` turns the snippet into an ES module in-browser.
- **Runner** — a sandboxed iframe (`public/runner.html`) hosts the WebGPU canvas
  and an import map resolving `@babylonjs/lite` to the self-hosted engine bundle.
- **Engine** — `vite.engine.config.ts` builds the workspace engine source into a
  self-contained ESM under `public/engine/dev/` ("nightly"). This runs
  automatically before `dev`/`build`. Pinned versions (via CDN) come in a later phase.

`public/engine/dev/` and `dist/` are generated and git-ignored.
