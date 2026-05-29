# Task 4.2: Bundle-content assertion — F64 storage absent in HPM-off bundles

## Goal

Add a test that asserts no HPM-off scene fetches the F64 storage chunk at runtime. After this task, REQ-COMP-3 (zero bundle-size cost when HPM is off) is enforceable in CI: a regression that pulls F64 code into HPM-off bundles fails the build before merge.

## Requirements addressed

REQ-COMP-1, REQ-COMP-3, REQ-VER-2.

## Background

Per architecture D3 (Tree-shaking proof), the F64 storage module `packages/babylon-lite/src/math/_mat4-storage-f64.ts` (Task 1.2) is loaded via a **dynamic `await import(...)` inside `if (useHpm)`** in `createEngine` (see Task 1.3). Vite/Rollup splits that dynamic-import target into its own runtime chunk (e.g. `_mat4-storage-f64-<hash>.js`). HPM-off scenes never reach the `if (useHpm)` truthy branch, so the chunk file exists on disk but is never fetched at runtime.

The bundle build for parity scenes runs via `pnpm build:bundle-scenes`. It writes per-scene chunks under `lab/public/bundle/` and a `manifest.json` whose top-level keys are scene IDs and whose `runtimeChunks` array enumerates exactly the JS files fetched at runtime for that scene (recorded via Playwright network interception during a probe load). This is the authoritative ground truth for "what bytes does scene N pay".

## Files to create

- `tests/bundle-content-no-f64.test.ts` — Vitest test that:
    1. Reads `lab/public/bundle/manifest.json`.
    2. For every HPM-off scene, asserts `runtimeChunks` contains no entry matching `_mat4-storage-f64`.
    3. Confirms the F64 chunk file IS emitted on disk and DOES contain the build tag (positive control — guards against the absence assertion becoming vacuous because the sentinel was DCE'd).
    4. Whitelists HPM-on scenes (`scene200`, `scene201`, added in Task 4.3) which legitimately fetch the chunk.

## Implementation details

1. **Build-tag sentinel.** Add to `_mat4-storage-f64.ts` a unique non-renamable string constant such as `const BUILD_TAG = "@@MAT4_STORAGE_F64@@";` and reference it from inside `createF64MatrixAllocator` (e.g. as a computed-key property or a `void BUILD_TAG;` no-op) so the minifier cannot eliminate it. Bundlers do not rename string literals. The audit asserts this exact string is absent from every chunk fetched by HPM-off scenes.

2. **Manifest-based assertion (primary).** The assertion reads `manifest.json` and, for every scene whose ID is not in `HPM_ON_SLUGS`, filters `runtimeChunks` for filenames matching `/_mat4-storage-f64/`. The expectation is the empty array.

3. **Chunk-text assertion (defensive).** For one canonical HPM-off scene (e.g. `scene2`), open every file listed in its `runtimeChunks` and assert the BUILD_TAG string is not present. This catches the pathological case where the chunk is referenced under a different filename (e.g. inlined or renamed).

4. **Positive control.** Read `lab/public/bundle/` directly, find all `*_mat4-storage-f64*.js` files, and assert (a) at least one exists and (b) every such file contains the BUILD_TAG verbatim. This proves the sentinel survived minification.

5. **Whitelist HPM-on scenes.** `scene200` and `scene201` (parity divergence-prover pair from Task 4.3) intentionally fetch the F64 chunk. Their slugs go into `HPM_ON_SLUGS`.

6. Wire into the existing `pnpm test` (Vitest) invocation — no separate command. The test requires a prior `pnpm build:bundle-scenes` run; if `manifest.json` is missing, the first assertion fails with a clear "run `pnpm build:bundle-scenes` first" message.

## Testing suggestions

- Run `pnpm build:bundle-scenes && pnpm exec vitest run tests/bundle-content-no-f64.test.ts`.
- Sanity-check by temporarily converting the F64 dynamic import in `engine.ts` to a static import and rebuilding. The audit must fail with a clear list of HPM-off scenes that now pull the chunk into `runtimeChunks`. Revert.

## Gotchas

- The F64 chunk file always exists on disk after `build:bundle-scenes` because Vite emits dynamic-import targets unconditionally. The test asserts on **what scenes fetch at runtime** (via `manifest.runtimeChunks`), NOT on whether the file is present in `lab/public/bundle/`. Asserting on file presence would be wrong.
- Minifier renames identifiers but NOT strings. Asserting on the BUILD_TAG string is robust; asserting on identifier names is fragile under terser/esbuild minification.
- The HPM-on positive control depends on Task 4.3 (parity scenes). Sequence Task 4.2 after 4.3 if both are in the same execution batch — otherwise the whitelist matches nothing and the defensive sweep can be considered trivially passing.
- `_mat4-storage-f64` will also appear in source maps (`.js.map`) — that is fine and expected. The test reads `.js` files only.

## Verification checklist

- [ ] `_mat4-storage-f64.ts` embeds a unique build-tag string in a code path the minifier cannot DCE.
- [ ] `tests/bundle-content-no-f64.test.ts` reads `manifest.json` and asserts no HPM-off scene's `runtimeChunks` references the F64 chunk.
- [ ] Positive control asserts the F64 chunk file exists on disk and contains the build tag.
- [ ] HPM-on scenes (`scene200`, `scene201`) are whitelisted.
- [ ] Forcing a regression (temporary static import of `_mat4-storage-f64.ts` in `engine.ts`) makes the test fail with a clear list of offenders; reverting passes.
- [ ] `pnpm test` is green end-to-end.

