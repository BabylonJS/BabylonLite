// Browser-safe shim for the Node.js built-in `module` (a.k.a. `node:module`).
//
// `manifold-3d`'s Emscripten glue does `await import("module")` to get `createRequire` and
// calls `createRequire(import.meta.url)` — but ONLY inside its `ENVIRONMENT_IS_NODE` branch,
// which never runs in a browser, and which we further sidestep by passing an explicit
// `locateFile` in csg2.ts (so the .wasm is located without `require`). The Node path is dead
// code for our usage; we still import `manifold-3d` the only way it ships (a single entry for
// all environments), so this is not a wrong/misconfigured import.
//
// Why the alias is needed only for the module-granular `lib` build:
//   - In a PREBUNDLED build (the published single-file `dist`, and the older v1.0.x packages
//     that ran directly in the browser), Vite/esbuild inline this externalized builtin as a
//     harmless empty frozen object (`Object.freeze({__proto__:null})`) local to the manifold
//     chunk. It is referenced only by the never-true-in-browser Node branch, so those builds
//     load fine in the browser — which is why older/CDN consumers reported no problem.
//   - In the `lib` build (one file per source module, NOT prebundled) Vite cannot inline it,
//     so it emits a SHARED `_chunks/__vite-browser-external-*.js` chunk. Rollup's chunker then
//     merges an unrelated first-party PUBLIC export into it (observed: `computeAabb`), so the
//     package's own `index.js` ends up doing `export { computeAabb } from
//     "./_chunks/__vite-browser-external-*.js"`. The stub object itself is harmless, but
//     shipping real public API out of a confusingly-named "browser-external" chunk is fragile
//     (the empty-object behaviour is Vite-version-dependent; a throwing-proxy stub would break)
//     and pollutes the module-granular tree.
// Aliasing the builtin to this real module keeps it bundled normally so no stub chunk is ever
// produced and no public export is absorbed into one.

export function createRequire() {
    return () => {
        throw new Error("require() is not available in the browser build of @babylonjs/lite");
    };
}

export default { createRequire };
