# Task 4.3: New parity scene — high-precision jitter (HPM off vs on)

## Goal

Add a new parity scene that visibly exhibits camera-jitter at large world coordinates with HPM **off**, and renders stably with HPM **on**. After this task, every CI run protects M0's load-bearing change end-to-end: regressions that re-break the F64 substrate or upload boundary surface as a parity failure.

## Requirements addressed

REQ-VER-1 (parity coverage), REQ-VER-2, REQ-MAT-* (high-precision substrate exercised).

## Background

The repo's parity infrastructure lives at:

- `lab/public/scene-config.json` — list of scenes (id, label, scene module path, MAD ceiling, optional flags).
- `lab/src/scenes/` — scene modules. Each exports a function that builds a `Scene` for a given `Engine`.
- `tests/parity/scenes/sceneN-<name>.spec.ts` — Playwright spec per scene.
- `reference/sceneN-<name>.png` — golden PNG.

Per `.github/workflow-config.md`, golden references are immutable without explicit user approval. This task creates a *new* golden — that is allowed because the scene is new (no existing reference being changed).

The scene must:

1. Place geometry at coordinates large enough that single-precision floats lose visible precision (e.g., `[1_000_000, 0, 1_000_000]` order of magnitude, well beyond F32's ~7 significant digits at that scale).
2. Have a deterministic camera setup so the rendered frame is reproducible.
3. Be deterministic and headless — no input, no animation, no time-dependent state. The scene captures a single steady frame.

We will create **two scene variants**:

- `sceneN-high-precision-jitter-hpm-off` — `useHighPrecisionMatrix: false`. Visible jitter / shimmer in the rendered frame at large coordinates.
- `sceneN-high-precision-jitter-hpm-on` — `useHighPrecisionMatrix: true`. Stable, crisp render.

Both scenes share the same scene-building function except for the engine flag. Either:

- One scene module file that takes a flag parameter, two scene-config entries.
- Two scene module files (DRY: one delegates to a shared builder).

Choose whichever matches existing patterns in `lab/src/scenes/` (scan two existing scenes for the convention).

The MAD ceilings must reflect reality: HPM-off may have a *higher* MAD vs its own golden because anti-aliased edges of jittered triangles round differently across runs — the goal is *bounded* rendering, not pixel-perfect. Set initial ceilings to a permissive value (e.g., 5.0) and tighten after capturing the goldens. HPM-on should be tight (e.g., 0.5) like every other parity scene.

**Important:** the HPM-off "jitter" is the *expected* behavior we're locking in. The golden for HPM-off captures *what F32 produces at this scale*. If a future change accidentally fixes the HPM-off path (e.g., applies floating-origin without the flag), the HPM-off parity test fails — that's the desired tripwire.

## Files to create

- `lab/src/scenes/high-precision-jitter.ts` — shared scene builder factory exporting a builder function. Or, if matching an existing pattern, two co-located scene files.
- `lab/public/scene-config.json` — append two entries with the next free scene IDs (inspect file to find max id, +1, +2).
- `tests/parity/scenes/sceneN-high-precision-jitter-hpm-off.spec.ts` — parity spec.
- `tests/parity/scenes/sceneM-high-precision-jitter-hpm-on.spec.ts` — parity spec.
- `reference/sceneN-high-precision-jitter-hpm-off.png` — golden (capture via approved flow).
- `reference/sceneM-high-precision-jitter-hpm-on.png` — golden (capture via approved flow).
- `tests/bundle-size.test.ts` — append the two new scenes' size ceilings (set to actual measured size + small headroom; do NOT raise other ceilings).

## Implementation details

1. **Scene content:**
    - One ground plane at origin, one tall textured pillar at `[1_000_000, 0, 1_000_000]`.
    - Camera positioned ~10 m from the pillar, looking at it (so `viewMatrix * worldPos` is a small number, but `worldMatrix` carries the large translation).
    - One directional light, no shadows (keeps the scene minimal).
    - Use a simple Standard or PBR material with a checker or numbered texture so precision loss is visually obvious as shimmering edges.
    - Set a fixed background color.

2. **Engine creation:** scene module accepts `(engine: Engine)` per existing convention. The HPM-on/off flag is set when the test (or scene-config) constructs the engine — match how other scenes wire engine flags. If existing scenes don't set engine flags via scene-config, then set them in the parity spec's `beforeAll` (Playwright fixture).

3. **Scene-config entries:** assign next free numeric IDs. Add the two scenes with appropriate `label`, `module`, `madCeiling`, and a `engineFlags` field if scene-config supports it (verify by reading the JSON). If it doesn't, the parity spec must construct the engine with the flag inline.

4. **Capture goldens** via the approved flow documented in `.github/workflow-config.md` or in the manual-testing skill. Typical:
    - Launch `pnpm dev` (lab).
    - Navigate to the scene URL.
    - Capture a screenshot at the canonical viewport size used by other parity tests.
    - Save under `reference/`.

   If the project has a scripted capture command (e.g., `pnpm capture-reference`), use that instead.

5. **Parity spec structure** — copy an existing simple scene's spec (e.g., `scene1-*.spec.ts`) verbatim, change scene id, name, and golden filename. Follow the existing fixture pattern exactly.

6. **Bundle-size ceilings** — after the bundle build runs once with the new scenes registered, read the produced bundle sizes and set ceilings at `actual + ~5%` headroom. Per the architecture and guardrails: do NOT raise any *existing* ceilings. New ceilings for new scenes are allowed.

7. **HPM-off scene's golden captures the jittered output as the canonical "this is what F32 does at 1e6 m" reference.** If the captured frame doesn't actually exhibit jitter, push the coordinates further out (try `[1e7, 0, 1e7]`) until the difference between HPM-off and HPM-on is unambiguously visible.

## Testing suggestions

- After capturing goldens, run focused: `npx playwright test tests/parity/scenes/sceneN-high-precision-jitter-*.spec.ts`. Both must pass.
- Run `pnpm test:parity` — full suite stays green (existing scenes untouched).
- Run `pnpm test` — bundle-size test recognizes the two new ceilings and passes.

## Gotchas

- **Do not retake or modify existing golden references.** Only the two new ones are created. If any existing parity test fails after this task, the cause is upstream (Phase 1–3 regressed something) — investigate, do NOT touch goldens.
- The HPM-off scene's golden depends on platform-deterministic F32 ULP behavior. WebGPU on different GPUs may produce slightly different jitter patterns. Verify the golden captured on the same machine type as CI runs against. If CI uses a different GPU than your dev box, capture from CI (or a CI-equivalent runner) — there is precedent in the repo for how this is handled; check `.github/workflow-config.md`.
- The HPM-on golden must be visually stable — a flat checker rendering with no shimmer. If the golden shows residual jitter, the F64 substrate isn't actually reaching the GPU upload — go back and verify Phase 2 + Phase 3 wired correctly.
- Choose coordinates far enough out that F32 fails but not so far that they overflow other systems (e.g., depth buffer with a near plane of 0.1 and a 1e6-distance pillar but camera 10m away will be fine). Test interactively first.
- The two scenes share a scene-builder; the *only* difference is the engine flag. Do not let unrelated differences creep in (lighting, material, viewport, etc.).
- `tests/bundle-size.test.ts` is sensitive: only ADD ceilings. Do not modify any existing ceiling line — review your diff carefully.

## Verification checklist

- [ ] Two new scene-config entries exist with sequential next-free IDs.
- [ ] Scene builder produces visibly jittered render with HPM off and stable render with HPM on at large world coordinates.
- [ ] Two new golden PNGs exist under `reference/` and are committed.
- [ ] Two new parity specs exist under `tests/parity/scenes/` and pass.
- [ ] `tests/bundle-size.test.ts` has *only added* (not modified) ceilings for the two new scenes.
- [ ] `pnpm test:parity` green with all scenes.
- [ ] `pnpm test` green end-to-end (build + parity).
- [ ] `git diff reference/` shows only the two NEW files; no existing goldens modified.
- [ ] `git diff tests/bundle-size.test.ts` shows only added lines; no existing ceilings raised.
