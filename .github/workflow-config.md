# Workflow Configuration

Repo-specific settings consumed by the shared workflow skills (see
`build-feature`, `write-requirements`, `write-architecture`,
`write-implementation-plan`, `execute-implementation-plan`, etc.).

> **Single source of truth for architecture and conventions:** [`GUIDANCE.md`](../GUIDANCE.md).
> Read it first. Anything in this file that contradicts `GUIDANCE.md` is wrong.

## Feature docs directory

Feature/specification documents created by the build-feature workflow live at:

```
docs/features/<feature-name>/
```

Per-feature layout:

- `docs/features/<feature-name>/goals.md`
- `docs/features/<feature-name>/requirements.md`
- `docs/features/<feature-name>/architecture.md`
- `docs/features/<feature-name>/task-board.md`
- `docs/features/<feature-name>/mocks.html` (optional, when applicable)
- `docs/features/<feature-name>/mocks.context.md` (optional)
- `docs/features/<feature-name>/implementation_plan/` (one markdown file per task)

> Note: `docs/architecture/` is reserved for the **per-module one-shot specs**
> described in `GUIDANCE.md` §4 ("Documentation-Driven Architecture"). Those
> are *module* docs (one per package), not *feature* docs. The build-feature
> workflow's `architecture.md` describes a feature; if it produces stable
> module-level docs, they may later graduate into `docs/architecture/NN-*.md`.

## Quality commands

Run these before committing. All required commands must pass.

- **Format**: `pnpm run format:check`
- **Check (lint + typecheck)**: `pnpm run lint`
- **Unit tests**: `pnpm exec vitest run` (one-shot Vitest run)

Optional broader validation:

- **Integration / parity tests**: `pnpm test:parity` (Playwright; full per-scene MAD diff)
- **Visual / screenshot tests**: same as parity — parity *is* visual in this repo
- **Build / package smoke test**: `pnpm build:bundle-scenes`
- **Combined gate**: `pnpm test` (chains build + parity)

> **Agents must never run `pnpm test:perf`.** Performance tests are
> machine-sensitive and reserved for the user / CI (see `GUIDANCE.md` §0c).

> **Iteration tip**: when working on a single scene, run that scene's spec only
> (`npx playwright test tests/parity/scenes/sceneN-<slug>.spec.ts`) during the
> edit/test loop. Run the full `pnpm test` before declaring success.

## Product identity and UI guidance

- **Product or repo name**: Babylon Lite
- **What it ships or publishes**: A WebGPU-exclusive, tree-shakable 3D engine
  (`packages/babylon-lite/`) that produces pixel-identical output to Babylon.js
  in a fraction of the bundle size.
- **Key user-facing surfaces, tools, or pages**:
  - `packages/babylon-lite/` — the published engine
  - `lab/` — interactive scene gallery / parity harness (Vite, port 5174)
  - `tests/parity/` — Playwright per-scene visual parity tests
- **UI, brand, or design-system guidance for mocks**: Not applicable. The lab
  is a developer-facing tool; mocks for engine features are typically scene
  HTML pages, not UI screens.
- **Important reference files or directories to read first**:
  - [`GUIDANCE.md`](../GUIDANCE.md) — immutable architectural rules
  - [`docs/architecture/00-overview.md`](../docs/architecture/00-overview.md) — engine architecture
  - [`docs/porting-guide.md`](../docs/porting-guide.md) — BJS → Lite translation patterns
  - [`CONTRIBUTING.md`](../CONTRIBUTING.md) — how to add scenes/tests
  - [`scene-config.json`](../scene-config.json) — per-scene MAD ceilings

## Manual testing

- **Instructions file**: Not applicable (no dedicated doc; conventions live in `GUIDANCE.md` and the `manual-testing` skill).
- **How to launch the product locally**: `pnpm dev:lab` (builds bundle scenes, launches Vite).
- **Service health checks, ports, URLs, or entry points**:
  - Lab gallery: <http://localhost:5174>
  - Per-scene pages: <http://localhost:5174/sceneN.html>
  - Animated scenes accept `?seekTime=<seconds>` to freeze at a deterministic pose.
- **Rules for reusing existing running processes**: If a dev server is already
  running on 5174, reuse it. Don't spawn a duplicate.

## Test conventions

### Unit tests

- **Location convention**: `tests/unit/<name>.test.ts`
- **Naming convention**: kebab-case feature/module name with `.test.ts` suffix
- **Runner or config**: Vitest (`pnpm exec vitest run` for CI; `pnpm test:watch` for interactive)

### Integration tests (parity + plumbing)

- **When to prefer integration over unit**: Anything that produces or depends
  on rendered pixels, GPU resource lifecycle, picking, or material swaps.
- **Location convention**:
  - Visual parity: `tests/parity/scenes/sceneN-<slug>.spec.ts`
  - Plumbing (picking, memory, disposal, material swap): `tests/plumbing/<name>.spec.ts`
- **Naming convention**: `sceneN-<slug>.spec.ts` for parity (N matches `scene-config.json` id);
  kebab-case `<name>.spec.ts` for plumbing.
- **How to run a focused test**: `npx playwright test tests/parity/scenes/sceneN-<slug>.spec.ts`

### Visual / screenshot tests

- **When required**: Any change that affects rendered output (materials,
  shaders, lights, camera, post-processing, glTF feature support, etc.).
- **Source-of-truth instructions**:
  - [`docs/architecture/16-animation-parity-testing.md`](../docs/architecture/16-animation-parity-testing.md) — animated-scene golden capture
  - [`GUIDANCE.md`](../GUIDANCE.md) §2, §2b, §2b′, §2c — reference image conventions and MAD thresholds
- **Key config, fixture, and reference image paths**:
  - Goldens: `reference/sceneN-<slug>/babylon-ref-golden.png` (immutable without user approval)
  - Test actuals: `reference/sceneN-<slug>/test-actual.png` (written by tests)
  - Live refs: `reference/sceneN-<slug>/live-ref.png` (optional runtime BJS capture)
  - Per-scene MAD ceilings: [`scene-config.json`](../scene-config.json)
  - Lab thumbnails: `lab/public/thumbnails/sceneN.png`
- **Commands**:
  - Full suite: `pnpm test:parity`
  - Single scene: `npx playwright test tests/parity/scenes/sceneN-<slug>.spec.ts`
- **Supported browsers, engines, or environments**: Chromium WebGPU only
  (Playwright with WebGPU enabled). Local runs use the in-tree Playwright;
  cloud runs go through `pnpm test:parity-cloud` (BrowserStack).

> **Never raise a `maxMad` ceiling, raise a bundle-size ceiling, or modify a
> golden reference without explicit user approval.** Fix the rendering or the
> regression instead.

## Database migrations

Not applicable.

## Bug fixing

- **Issue tracker or repository to read from**:
  - GitHub issues on `georginahalpern/Babylon-Lite`
  - <https://forum.babylonjs.com/> for upstream-reported bugs (forum URLs feed `fix-forum-bug`)
- **Expected bug report sections or repro information**: A failing scene id +
  description, or a forum URL with playground link, or an explicit minimal
  repro snippet.
- **Detailed bug-fix instructions**:
  - General: `fix-bug` skill (TDD: write regression test first, confirm it fails, then fix)
  - Forum: `fix-forum-bug` skill (scrape post → analyze playground → classify → draft reply)

## Related skills

Available in this environment:

- **Manual testing / screenshots**: `manual-testing`
- **Browser automation**: `playwright-cli`
- **Visual regression testing**: `visual-testing`
- **Bug fixing**: `fix-bug`, `fix-forum-bug`
- **Experiment tracking**: `babylon-lab-manager` (BabylonExperimentsLab GitHub Issues ledger)
- **Build feature lifecycle**: `build-feature` (orchestrates the full design + impl flow)
- **Design phase skills**: `review-goals`, `create-html-mock`, `extract-requirements-from-mock`,
  `write-requirements`, `write-architecture`, `write-implementation-plan`,
  `execute-implementation-plan`

Not available in this repo:

- "Write integration test" / "Debug integration test" specialty skills — use
  the patterns in existing `tests/parity/scenes/*.spec.ts` and the
  `visual-testing` skill instead.

## Two-agent workflow (custom)

This repo uses Gandalf (orchestrator) + Einstein (coder) chat modes — see
[`GUIDANCE.md`](../GUIDANCE.md) "Two-Agent Workflow" and
`.github/chatmodes/`. Agents invoking implementation skills should respect:

- Gandalf verifies guardrails independently (does not trust Einstein's word).
- Required guardrail commands before declaring success: `pnpm build:bundle-scenes`,
  `pnpm test:parity`, plus a clean diff on `tests/bundle-size.test.ts` and
  `reference/`. Chained as `pnpm test`.
- `pnpm test:perf` is **never** run by agents.

## Additional references

- **Product inventory or architecture overview**: [`docs/architecture/00-overview.md`](../docs/architecture/00-overview.md)
- **Launch, task, or dev-server config**: [`package.json`](../package.json) scripts; Vite configs in `lab/vite.config.ts` and `playwright.*.config.ts`
- **Other instructions agents should read first**:
  - [`GUIDANCE.md`](../GUIDANCE.md) (immutable, every session)
  - [`.github/copilot/instructions.md`](copilot/instructions.md) if relevant to the task
