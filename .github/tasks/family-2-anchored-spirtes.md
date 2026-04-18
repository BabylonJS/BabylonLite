# Einstein Task — Family 2 (Anchored Sprites)

> **Delegated by Gandalf.** Read this file end-to-end before starting. Do not skim.

## Context

You are implementing **Family 2 (Anchored Sprites)** from the sprite spec at [docs/architecture/26-sprites.md](../../docs/architecture/26-sprites.md).

- **Branch**: `lite-2d`
- **Family 1 (Pure 2D)** is already landed:
  - `packages/babylon-lite/src/scene2d/`
  - `packages/babylon-lite/src/sprite/sprite-2d*`
  - `packages/babylon-lite/src/sprite/shared/{sprite-atlas,sprite-animation,sprite-gpu}.ts`
  - `packages/babylon-lite/src/sprite/picking/pick-2d.ts`

  Reuse those shared modules — do **NOT** duplicate. Verify they exist before starting.
- The latest lab scene is **31**. New scenes are **32** and **33**.
- Family 3 (Billboards) is **out of scope** — do not implement billboard files. But the spec's `Sprite3DSceneUBO` will eventually be shared between Family 2 and Family 3, so design it for that future reuse (place it in a file that does not import billboard code).

## Mandatory pre-read

Read these in order before writing code:

1. `GUIDANCE.md` — full file. Non-negotiable rules.
2. `docs/architecture/26-sprites.md` — full spec. Especially:
   - **§ Family 2 — Anchored Sprite Layer** (public API)
   - **§ Internal Architecture → AnchoredSpriteLayer** (96 B / 24 floats layout)
   - **§ Pipeline Configuration** — blend table, per-family differences row, bind groups (`Sprite3DSceneUBO` is a separate UBO bound at `@group(1) @binding(3)`)
   - **§ Shader Logic → Family 2** (vertex shader)
   - **§ Sorting and Transparency** — Anchored row (transparent queue `210 + order` for blended, opaque queue `110 + order` for cutout)
   - **§ Picking** — Anchored row (CPU rotation-aware hit test)
   - **§ Lifecycle** and **§ File Manifest**
3. Walk the existing Family 1 implementation:
   - `packages/babylon-lite/src/sprite/sprite-2d.ts`, `sprite-2d-renderable.ts`, `sprite-2d-shader.ts`
   - `packages/babylon-lite/src/sprite/shared/sprite-{atlas,animation,gpu}.ts`
   - `packages/babylon-lite/src/sprite/picking/pick-2d.ts`
   - `packages/babylon-lite/src/scene2d/scene2d.ts` and the existing 3D scene's renderable plumbing in `packages/babylon-lite/src/scene/scene.ts`

   Mirror Family 1's patterns exactly: deferred-build, dynamic import of renderable, version / sortVersion / gpuVersion tracking, swap-remove, capacity-grow, sparse clip `Map`, `flagsAndPad` float-encoded flip bits.
4. Look at scene 31 (or the latest sprite-2d scene) for the lab/test/scene-config/bundle pattern to mirror.

## Scope

### Engine — `packages/babylon-lite/src/sprite/`

Create these files (per the spec's File Manifest):

- **`sprite-anchored.ts`** — `createAnchoredSpriteLayer`, `addAnchoredSprite`, `updateAnchoredSprite`, `removeAnchoredSprite`, `setAnchoredSpriteFrame`, `playAnchoredSpriteClip`, `stopAnchoredSpriteClip`. Public types per spec.
- **`sprite-anchored-renderable.ts`** — Renderable builder (dynamic-imported from `sprite-anchored.ts`). Owns the bind group layouts and the WebGPU pipeline (cached per `(blendMode, depthTest, depthWrite, swapChainFormat, msaaSamples, pixelSnap, alphaCutoff)`). Pipeline cache must follow GUIDANCE rule 4 (lazy-init, no module-level `Map`; auto-invalidate on device change).
- **`sprite-anchored-shader.ts`** — `composeAnchoredSprite()` WGSL emitter. Inline TS template strings (small/parameterized, per spec composition convention). Bake `pixelSnap` into shader text (it's in the cache key); bake `alphaCutoff` literal for cutout; opacity stays in per-layer UBO.
- **`shared/sprite-3d-scene-ubo.ts`** — `Sprite3DSceneUBO` struct + updater factory. Lives in a separate file so a future billboard family reuses it without code change. The updater is registered into the scene's `_uniformUpdaters` exactly **once per scene** the first time any anchored (or future billboard) family is built (use a per-scene "already-registered" sentinel — do **NOT** use a module-level `Map`). Camera-basis vectors `cameraRight`/`Up`/`Forward` are pre-extracted from the active camera's invView each frame.
- **`picking/pick-anchored.ts`** — `pickAnchoredSprite(scene, xPx, yPx)`. CPU-only. Walk reverse-order layers, then sprites in reverse insertion order (Anchored has no `layerZ`; insertion order is fine). For each `visible && pickable` sprite:
  1. project anchor through `viewProjection`
  2. NDC → pixels
  3. apply `offsetPx`
  4. transform the screen point into sprite-local space (inverse rotation around the projected pivot)
  5. test against the pivot-aware rectangle `[-pivot.x · sizePx.x, (1 - pivot.x) · sizePx.x] × [-pivot.y · sizePx.y, (1 - pivot.y) · sizePx.y]`

  Return `SpritePickInfo`. No hit if anchor is behind near plane. Skip `!visible` and `!pickable`.

### Per-instance layout — Anchored (96 B = 24 floats)

Match the spec exactly:

| float idx | field |
|---|---|
| 0..2 | `worldPos` |
| 3 | `depthBias` |
| 4..5 | `offsetPx` |
| 6..7 | `sizePx` |
| 8..9 | `pivot` |
| 10..11 | `sinCos` |
| 12..15 | `uvRect` |
| 16..19 | `color` |
| 20..23 | `flagsAndPad` (`[0]=flipX 0/1`, `[1]=flipY 0/1`, `[2..3]=reserved 0`) |

Use the shared `sprite-gpu.ts` helpers if they're stride-agnostic; otherwise add a parallel anchored-specific pack helper in `sprite/shared/` (do **NOT** add an `if family === 'anchored'` branch to existing 2D pack code).

### Sorting

- **Blended anchored** (`alpha`/`premultiplied`/`additive`/`multiply`): registers as a transparent renderable at priority `210 + layer.order`, sort key = anchor view-Z (back-to-front). Use the engine's existing transparent-sort hook the same way meshes do.
- **Cutout anchored**: registers as opaque at `110 + layer.order`, `depthWrite=on` by default (overridable via `depthTest`), discard `< alphaCutoff` in fragment.
- Use a `_sortVersion` counter bumped on add/remove/position-change; recompute the indirection `Uint32Array` only when camera moved or `_sortVersion` advanced. Do **NOT** reorder the packed instance buffer.

### Public API exports — `packages/babylon-lite/src/index.ts`

Add the exports listed in the spec's "Public-API additions" section, **anchored block only**:

```ts
export {
    createAnchoredSpriteLayer,
    addAnchoredSprite,
    updateAnchoredSprite,
    removeAnchoredSprite,
    setAnchoredSpriteFrame,
    playAnchoredSpriteClip,
    stopAnchoredSpriteClip,
} from "./sprite/sprite-anchored.js";
export type { AnchoredSpriteLayer, AnchoredSpriteLayerOptions, AnchoredSpriteInit } from "./sprite/sprite-anchored.js";
export { pickAnchoredSprite } from "./sprite/picking/pick-anchored.js";
```

(Do **NOT** add billboard exports.)

### Lab scenes — IDs 32 and 33

For each scene, create:

- `lab/scene{ID}.html` — copy structure from a recent scene's HTML
- `lab/src/lite/scene{ID}.ts` — Lite implementation
- `lab/src/bjs/scene{ID}.ts` — BJS reference (uses `BABYLON.SpriteManager` + `Sprite` for anchored equivalents — Babylon's sprites are world-billboarded by default, but an anchored equivalent in BJS is best produced via `Sprite` with `playAnimation` and small world-quad config; if pixel-perfect parity vs BJS sprites isn't reachable for anchored semantics, use a deterministic procedural reference that matches the Lite output exactly — see "Goldens" below)
- `lab/babylon-ref-scene{ID}.html` — entry for BJS reference
- `lab/bundle-scene{ID}.html` and `lab/bundle-bjs-scene{ID}.html` — bundle scaffolds
- Add inputs to `lab/vite.config.ts` rollup inputs for all four HTML entries
- Add a card to `lab/index.html` (gallery)
- Thumbnail `lab/public/thumbnails/scene{ID}.png` (copy of golden after capture)

#### Scene 32 — `scene32-sprites-anchored-labels`

- Arc-rotate camera at fixed deterministic alpha/beta/radius.
- 3–4 procedural meshes in a row on a ground plane (e.g. boxes of varying height, distinct colors so picking is verifiable).
- One anchored label sprite per mesh, anchored at `mesh.position + [0, height/2 + 0.1, 0]`, with `offsetPx: [0, -8]` so the label sits just above the mesh top.
- **Vary camera distance via mesh placement**: position meshes at varying distances (e.g. z = 0, 2, 4, 6) so the golden visibly demonstrates labels are the **same pixel size** regardless of distance — this is the headline contract.
- One sprite has `pickable: false` (verify via picking unit test or in the parity spec via a programmatic call).
- Atlas: a small procedurally-generated atlas (e.g. 4 colored letter-tiles in a 2×2 grid, drawn into a canvas at scene boot) so the scene is fully self-contained — no external asset.
- BlendMode: `alpha` (default).

#### Scene 33 — `scene33-sprites-anchored-animated-cutout`

- Static camera, 1–2 simple meshes + ground.
- An anchored layer with **`alpha` blend** sprites running a 4-frame **named clip** at 8 fps. Use `?seekTime=` to deterministically freeze the animation (see GUIDANCE § 2c). Both the BJS reference HTML and the Lite scene must seek to `seekTime * 60` frames, freeze, set `canvas.dataset.animationFrozen = 'true'`. Default `seekTime` should land the clip on a non-trivial frame.
- A second anchored layer with **`cutout` blend** sprites (`alphaCutoff = 0.5`) covering the same atlas — proves cutout's depth-write-on contract by placing some cutout sprites that visibly occlude geometry and other anchored sprites behind them.
- Include rotated sprites (e.g. one with `rotation: π/4`) to exercise the pivot-aware rotation path.
- Atlas: procedural again (4 frames of an animated arrow), one named clip `"spin"`.
- Picking smoke-test: in the lite scene, after first frame, programmatically call `pickAnchoredSprite(scene, knownX, knownY)` for one sprite (visible) and one with `pickable: false`, log results to `canvas.dataset.pickResults` so the parity spec can read & assert via a Playwright `evaluate`.

### Tests

**Unit tests** (`tests/unit/`):

- `sprite-anchored-projection.test.ts` — pixel size invariant under camera distance: project the same anchor at two distances, assert the pixel-space quad corners are within ε of the same pixel size.
- `sprite-pick-anchored.test.ts` — rotation-aware hit test (rotated sprite, pick a corner that is inside before rotation but outside after, or vice versa); reverse-order topmost selection; honors `pickable: false` and `visible: false`.
- (Recommended) `sprite-anchored-pack.test.ts` — verifies the 24-float layout offsets and `flagsAndPad` encoding.

**Parity tests** (`tests/parity/`):

- `tests/parity/scene32-sprites-anchored-labels.spec.ts`
- `tests/parity/scene33-sprites-anchored-animated-cutout.spec.ts`

Mirror an existing parity spec exactly (e.g. the spec for scene 31). Use `REFERENCE_DIR = path.resolve(__dirname, '../../reference/scene{ID}-<slug>')` and `getSceneConfig(id).maxMad`. Animated scene uses the `?seekTime=` frozen-frame pattern.

### Goldens

For each new scene, capture `reference/scene{ID}-<slug>/babylon-ref-golden.png`:

- **Scene 32**: try BJS first (use `SpriteManager` with a tiny world-space quad approximation if anchored has no direct BJS equivalent). If you cannot get a pixel-stable BJS reference for anchored semantics, capture the golden from the **Lite implementation itself** after carefully verifying it matches expected values (label centered above each mesh, same pixel size at all distances). Document the choice in a one-line comment in the parity spec.
- **Scene 33**: capture at the deterministic `?seekTime=`. Same fallback rule — Lite golden if BJS can't reproduce.

Copy goldens to `lab/public/thumbnails/scene{ID}.png` for the gallery.

### scene-config.json

Add entries for both scenes with `id`, `slug`, `name`, `maxMad`, `description`, `tags: ["sprites","anchored", ...]`. Pick conservative `maxMad` thresholds that the golden actually meets (start tight, e.g. `0.01–0.05`; if the parity test fails, fix rendering — do **NOT** loosen the threshold without justification).

### Bundle ceilings — `tests/bundle-size.test.ts`

Add entries for scene 32 and scene 33 using **measured sizes** after `pnpm build:bundle-scenes`. Do **NOT** inflate. Run the build, read the actual rawKB/gzipKB from `lab/public/bundle/manifest.json` or `bundle-info/scene{ID}.json`, and use those values verbatim. Also include the bundle-ratchet contract from the spec § 14: the scene 32/33 bundle must **NOT** pull in any `sprite-billboard-*` or `scene2d` chunks. Express that as part of the bundle-size test if the existing pattern supports it; otherwise as a separate assertion in the same test file.

## Mandatory pre-completion checklist

You **must** run and report results for ALL of these. Do not skip any.

1. `pnpm run lint:fix && pnpm run lint` — must pass with zero errors.
2. `pnpm test` — all unit + bundle-size tests pass.
3. `pnpm build:bundle-scenes` — scene 32 and scene 33 bundles build successfully.
4. `pnpm test:parity` — all parity tests pass (including new scenes 32, 33). No MAD regressions on existing scenes.
5. `git diff tests/bundle-size.test.ts` — confirm you did **NOT** modify any **existing** ceiling values; you only ADDED new entries for scenes 32 and 33 with measured values.
6. `git diff reference/` — confirm you did **NOT** modify any existing `babylon-ref-golden.png`. New goldens for scene 32 and 33 are additions, which is allowed for new scenes only.

## Hard rules (from GUIDANCE.md, repeated for emphasis)

- **WebGPU only.** No WebGL, no fallback wrappers.
- **Zero module-level side effects.** No `new Map()`, `new WeakMap()`, `new Set()`, no `register*()` at module top level. Use lazy-init with device-change invalidation. Typed-array consts are OK.
- **Pure state interfaces, no methods.** `AnchoredSpriteLayer` is plain data. All behaviour is standalone functions taking the layer as first arg.
- **One-way ownership.** Layer holds the atlas reference; layer never references the scene. Scene holds layers.
- **No GPU internals in public API.** No `GPUBuffer`, `GPUTextureView` etc. on the public types. Atlas exposes `Texture2D` only.
- **Materials own shaders → here, the renderable owns its pipeline + shader.** No central shader registry.
- **Tree-shakable.** Picking, renderable, and shared 3D-scene UBO must be dynamic-imported by their callers so a sprite-free scene fetches zero anchored bytes.
- **No `if (mode === ...)` branches.** Anchored is its own family. Do not introduce a shared sprite-mode enum or branching pack helpers.
- **Never raise existing bundle-size ceilings or modify existing goldens** without explicit user approval (you do not have it).

## Questions

If anything is ambiguous, **stop and ask** rather than guess. Likely candidates:

- BJS reference parity for anchored — if it's not achievable, document the Lite-golden fallback per scene.
- `Sprite3DSceneUBO` registration mechanism — if the scene's `_uniformUpdaters` API doesn't have a clean per-scene sentinel, add one (don't use a module-level `Map`).

When you finish, report:

- Files added/modified (paths only, no diffs).
- Output of each of the 6 checklist commands.
- Any deviations from this prompt and why.
