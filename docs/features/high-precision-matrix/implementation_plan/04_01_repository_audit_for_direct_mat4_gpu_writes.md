# Task 4.1: Repository audit for direct mat4 GPU writes

## Goal

Add a Vitest test that fails the suite if any source file outside the explicit allowlist writes a mat4 directly into a Float32Array view destined for GPU upload. After this task, the F64→F32 boundary is enforceable in CI: a future refactor that bypasses `packMat4IntoF32` is caught immediately.

## Requirements addressed

REQ-UPL-1, REQ-VER-3 (audit gate).

## Background

Phase 3 routed every M0-scope mat4 GPU upload through `packages/babylon-lite/src/math/pack-mat4-into-f32.ts`. The audit defends that boundary going forward.

Tests already in the repo follow Vitest conventions per `.github/workflow-config.md`. The audit lives alongside the existing unit/integration tests, not in `tests/parity/` (which is Playwright-only). Likely path: `tests/unit/audit/no-direct-mat4-writes.test.ts` or `packages/babylon-lite/tests/audit/...`. Match the convention used for any pre-existing audit-style test (search `tests/` and `packages/babylon-lite/tests/` for `audit` or repo-grep tests; if none exists, add the test alongside `tests/unit/`).

The audit grep targets these patterns inside `packages/babylon-lite/src/`:

1. `\.set\((\s*)(\w*[Ww]orld\w*|\w*[Mm]atrix\w*|\w*[Mm]at4\w*|wm|m)(\s*),(\s*)\d+\s*\)` — `.set(<matrix-named>, <offset>)` calls into typed arrays.
2. `device\.queue\.writeBuffer\([^,]+,\s*\d+,\s*\w*[Ww]orld\w*\b` and `\w*[Mm]atrix\b` and `\w*[Mm]at4\b` — direct mat4 typed array as the third arg of `writeBuffer`.
3. Manual element-by-element copy loops of length 16 over a typed array (heuristic; may produce false positives — accept those by extending the allowlist with a comment).

Allowlist (must accept these matches):

- `packages/babylon-lite/src/math/pack-mat4-into-f32.ts` — the helper itself.
- `packages/babylon-lite/src/picking/gpu-picker.ts` — deferred per architecture D4. Marked TODO(M0-followup).
- `packages/babylon-lite/src/loader-skybox/**` — deferred per D4.
- `packages/babylon-lite/src/mesh/gaussian-splatting-mesh.ts` — deferred per D4.
- `packages/babylon-lite/src/material/pbr/background-*.ts` — deferred per D4.
- `packages/babylon-lite/src/mesh/thin-instance-gpu.ts` — Task 3.4's fast path `device.queue.writeBuffer(buf, 0, matrices)` (where `matrices` is the F32-input fast path). Allowlist this exact line (or refine the audit regex to ignore slab uploads — the slab is Float32Array, not a single mat4).

Allowlist format: a literal `Set<string>` of `relativePath:lineNumber` entries, OR a `Map<string, RegExp[]>` of file → suppressed pattern regexes. The first is simpler; prefer it unless a deferred file has many lines.

## Files to create

- `tests/unit/audit/no-direct-mat4-writes.test.ts` (or path matching the repo's existing audit test convention) — Vitest test that scans `packages/babylon-lite/src/**/*.ts` and asserts no offending pattern outside the allowlist.

## Implementation details

1. Use `node:fs/promises` + `node:path` + a file walker (the test file can implement a 20-line recursive walker; do NOT add a new dependency).
2. For each `.ts` file under `packages/babylon-lite/src/`:
    - Skip files in the allowlist (by relative path).
    - Read the source.
    - For each line, run each pattern's regex.
    - If a match is found and the `relPath:lineNumber` is not in the allowlist, push a violation.
3. Assert `violations.length === 0`. The failure message must list every violation as `relPath:lineNumber: <line snippet>` so the cause is obvious without re-running the suite.
4. Allowlist the helper itself: `packages/babylon-lite/src/math/pack-mat4-into-f32.ts` — wholesale skip.
5. Allowlist deferred files: skip the file entirely with a comment `// Deferred per architecture D4 (M0-followup).`.
6. Allowlist the thin-instance fast path: a single `relPath:lineNumber` entry with a comment.
7. The test must be deterministic: sort the file list before scanning so a given violation pins to the same line on every run.
8. The audit MUST run as part of `pnpm exec vitest run`. Do not register it under a separate command.

## Testing suggestions

- After adding the audit, intentionally introduce a violation in a copy of `render/scene-helpers.ts` (e.g., re-add a `device.queue.writeBuffer(p.meshUBO, 0, wm)` line). Run the test → must fail with a clear message naming the file and line. Revert.
- Run with no violations → must pass.
- Run alongside the rest of the unit suite: `pnpm exec vitest run`.

## Gotchas

- False positives: a regex on `\.set(` will also match `Set` constructor calls, `Array.prototype.set` for non-typed arrays, etc. Constrain the regex with the surrounding context or skip lines that look like `new Set(`. Iterate until the audit produces exactly the expected violations on a known-bad input and zero on the clean tree.
- The audit must NOT recurse into `dist/`, `node_modules/`, `__generated__/`, or any build output. Filter the walker by extension and exclude `dist`/`build` directories explicitly.
- Do NOT scan `.test.ts` or `.spec.ts` files — tests legitimately construct mat4 contents directly. Skip by extension or path.
- The allowlist is a stop-the-bleeding measure. Each entry should carry a TODO comment with a follow-up task ID (e.g., `// TODO(HPM-followup): route through packMat4IntoF32`). Reviewers will ask why an entry is on the allowlist.
- Keep the audit fast — under 1 second on a clean tree. A line-by-line regex scan over `packages/babylon-lite/src/` is plenty fast at this size; no need for streaming or workers.

## Verification checklist

- [ ] Audit test file exists at the agreed path and is picked up by `pnpm exec vitest run`.
- [ ] Allowlist contains only the helper, deferred files (per D4), and the thin-instance fast path — each with a clarifying comment.
- [ ] Adding a deliberate offending line elsewhere in `src/` causes the audit to fail with a precise file:line message; reverting passes.
- [ ] No false positives on the current clean tree.
- [ ] `pnpm exec vitest run` passes; audit completes in <2 s.
