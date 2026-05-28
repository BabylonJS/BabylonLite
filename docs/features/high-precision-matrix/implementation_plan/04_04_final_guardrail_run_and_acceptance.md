# Task 4.4: Final guardrail run and M0 acceptance

## Goal

Run the full agent-allowed guardrail suite, confirm zero regressions, confirm bundle-size and golden-reference invariants are intact, and declare M0 of `high-precision-matrix` complete.

## Requirements addressed

All M0 REQ-* (final integration gate).

## Background

Per `GUIDANCE.md` and `.github/workflow-config.md`, the agent-allowed guardrail commands are:

- `pnpm build:bundle-scenes` — bundle scenes build successfully.
- `pnpm test:parity` — visual parity (no MAD regression) AND bundle-size ceilings hold.
- These can be chained as `pnpm test`.

**Do NOT run `pnpm test:perf`** — perf tests are machine-sensitive and reserved for the user / CI. If perf validation is desired, ASK the user to run it locally. Do not run it under any circumstances yourself, even if M0 acceptance criteria mention performance.

Also required:

- `pnpm exec vitest run` — unit tests, including the new audit (Task 4.1) and bundle-content assertion (Task 4.2).
- `pnpm exec tsc --noEmit` — TypeScript clean.

## Files to verify (no modifications)

This task makes no source changes. It is purely verification.

## Implementation details

1. From a clean working tree (no uncommitted partial changes), run:

   ```text
   pnpm install
   pnpm exec tsc --noEmit
   pnpm exec vitest run
   pnpm test
   ```

   Each must pass with exit code 0. Capture the tail of each command's output for the final acceptance message.

2. After tests pass, verify the guardrail invariants via diff:

   ```text
   git diff main -- tests/bundle-size.test.ts
   ```

   Expected: only ADDED lines (the two new ceilings from Task 4.3). No existing ceiling raised. If any existing ceiling was modified, M0 is NOT accepted — investigate.

   ```text
   git diff main -- reference/
   ```

   Expected: only two NEW PNG files (from Task 4.3). No existing goldens modified or deleted. If any existing reference moved, M0 is NOT accepted.

3. Verify the public-API surface invariant from REQ-API-1: the rolled-up `.d.ts` for `babylon-lite` must NOT name `Float64Array` for any `Mat4`-typed symbol. Run:

   ```text
   pnpm build  # or whatever produces the public .d.ts
   Select-String -Path .\packages\babylon-lite\dist\**\*.d.ts -Pattern 'Float64Array' -Recurse
   ```

   For every match, confirm it is on a `setThinInstances` parameter (architecture D5 — slab type, allowed) and NOT on a `Mat4` symbol. If any `Mat4`-related declaration leaks `Float64Array`, M0 is NOT accepted — Task 1.1 (opaque `Mat4` interface) was not implemented correctly.

4. Verify the audit (Task 4.1) ran as part of the suite. Inspect the Vitest output for the audit test name. If it's missing, the test wasn't picked up — fix wiring before declaring success.

5. Verify the bundle-content assertion (Task 4.2) ran. Same approach.

6. Verify the new parity scenes (Task 4.3) ran in `pnpm test:parity` output. Both HPM-on and HPM-off variants must appear and pass.

## Testing suggestions

This IS the test step. There is no further testing beyond what's listed above.

## Gotchas

- Do not run `pnpm test:perf`. Ever. Even if you suspect a perf regression — flag it for the user instead.
- A green `pnpm test` does NOT bypass the diff checks. Bundle ceilings and golden references are protected by guardrails *outside* the test runner. Run the diff checks even after green tests.
- If `pnpm test` is green but `pnpm exec tsc --noEmit` has errors, M0 is NOT accepted. The TS check catches API-surface regressions that runtime tests miss.
- If any of the four checks fails, do not declare success. Send Einstein back to the failing phase with the specific failure log (per the two-agent workflow in `GUIDANCE.md`).

## Verification checklist

- [ ] `pnpm install` clean.
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm exec vitest run` green; audit test (Task 4.1) and bundle-content test (Task 4.2) both visible in output and passing.
- [ ] `pnpm test` green; both new parity scenes (Task 4.3) visible in output and passing.
- [ ] `git diff main -- tests/bundle-size.test.ts` shows only added lines (no existing ceilings raised).
- [ ] `git diff main -- reference/` shows only the two new goldens (no existing references modified).
- [ ] No `Float64Array` mentions on any `Mat4`-typed symbol in public `.d.ts` output.
- [ ] `pnpm test:perf` was NOT run by the agent.
- [ ] M0 of `high-precision-matrix` is declared complete and the result reported back to the user with the four log tails as evidence.
