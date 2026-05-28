# Task 4.2: Bundle-content assertion — F64 storage absent in HPM-off bundles

## Goal

Add a test that builds the bundle for a scene with HPM **off** and asserts the resulting JS contains zero references to symbols from `_mat4-storage-f64.ts`. After this task, REQ-COMP-3 (zero bundle-size cost when HPM is off) is enforceable in CI: a regression that pulls F64 code into HPM-off bundles fails the build before merge.

## Requirements addressed

REQ-COMP-1, REQ-COMP-3, REQ-VER-2.

## Background

Per architecture D3 (Tree-shaking proof), the F64 storage module `packages/babylon-lite/src/math/_mat4-storage-f64.ts` (Task 1.2) is reachable only behind a static `if (policy.precision === "f64") { ... }` guard. With `policy.precision === "f32"` constant-folded to false, the bundler must drop the F64 module entirely. The contract holds only when:

- `packages/babylon-lite/package.json` has `"sideEffects": false` (or an allowlist that excludes the F64 module).
- All call sites use static `import` (no `await import(...)`).
- `policy` is constructed with a literal precision in HPM-off scenes — not a runtime branch.

The bundle build for parity scenes already runs via `pnpm build:bundle-scenes`. Each scene under `lab/src/scenes/` produces a bundled JS in a known output location (typically `lab/dist/<scene>.js` or under `bundle-output/`). Inspect the existing `pnpm build:bundle-scenes` output during T-04 / earlier infrastructure to identify the exact path.

The size ceiling test in `tests/bundle-size.test.ts` already reads these bundles. Reuse the same lookup helpers if they're exported; otherwise replicate the path resolution.

## Files to create

- `tests/bundle-content-no-f64.test.ts` — Vitest test that:
    1. Locates the bundled JS for one or more HPM-off parity scenes.
    2. Reads the bundle as text.
    3. Asserts none of the F64-only symbol names appear.

## Implementation details

1. Identify F64-only symbol names exported from `packages/babylon-lite/src/math/_mat4-storage-f64.ts`. After Task 1.2, this is likely:
    - `createMat4StorageF64`
    - `MAT4_STORAGE_F64_MARKER` or similar internal marker (Task 1.2 may add a string constant for this exact audit purpose — coordinate with that task).

   **Best practice:** add to `_mat4-storage-f64.ts` a unique non-renamable string constant such as `export const MAT4_STORAGE_F64_BUILD_TAG = "@@MAT4_STORAGE_F64@@";`. Bundlers do NOT rename string contents. The audit asserts this exact string is absent. This is more reliable than asserting on identifier names (which terser may rename).

   If Task 1.2 didn't add such a tag, this task is the place to add it (small amendment to that file).

2. Use the smallest, fastest HPM-off scene as the test target. A typical baseline scene (`scene1` or whatever the existing minimum is) suffices.

3. Read the bundle text and assert:

    ```ts
    expect(bundleText).not.toContain("@@MAT4_STORAGE_F64@@");
    ```

   And, defensively, also assert the F64 module path string is absent:

    ```ts
    expect(bundleText).not.toMatch(/_mat4-storage-f64/);
    ```

4. Add a positive control: also build (or just import for module resolution) a scene with HPM **on** (an HPM-on parity scene exists after Task 4.3). Assert the F64 build tag IS present. This proves the test is meaningful (i.e., the absence in the HPM-off bundle wasn't a false negative from a typo).

   If Task 4.3 hasn't run yet at the time of this task's verification, defer the positive control until 4.3 is complete; mark with a TODO and a comment. Better: order this task after 4.3 in execution.

5. Wire into the existing test command. The bundle-size test already runs as part of `pnpm test:parity` per the workflow config — find how it's wired and follow the same pattern.

## Testing suggestions

- Run `pnpm build:bundle-scenes && pnpm exec vitest run tests/bundle-content-no-f64.test.ts`.
- Sanity-check by temporarily forcing the F64 import to be reachable in the HPM-off path (e.g., remove the `if` guard in a copy). The audit must fail with a clear message. Revert.

## Gotchas

- Minifier renames identifiers but NOT strings. Asserting on a build-tag string is robust; asserting on identifier names is fragile and breaks when minification is enabled.
- Some bundlers inline file paths into source maps. Make sure the test reads the *.js* bundle, not the `.js.map`. The `_mat4-storage-f64` path WILL appear in source maps even when correctly tree-shaken — that is fine and expected.
- If `package.json` has `"sideEffects": true` or omits the field, tree-shaking will not happen and this test will fail. That failure mode is the desired outcome — the test is the enforcement mechanism. Do NOT respond by relaxing the test; respond by fixing `sideEffects`.
- The HPM-on positive control depends on Task 4.3 (parity scene). Sequence Task 4.2 after 4.3 if both are in the same execution batch.

## Verification checklist

- [ ] `_mat4-storage-f64.ts` exports a unique build-tag string (or another tamper-resistant marker).
- [ ] `tests/bundle-content-no-f64.test.ts` asserts the tag is absent in at least one HPM-off bundle.
- [ ] Positive control asserts the tag IS present in the HPM-on parity bundle (Task 4.3 output).
- [ ] Test wires into the existing `pnpm test:parity` pipeline (or `pnpm exec vitest run` if that's the convention used by `tests/bundle-size.test.ts`).
- [ ] Forcing a regression (temporary unguarded import) makes the test fail with a clear message; reverting passes.
- [ ] `pnpm test` is green end-to-end.
