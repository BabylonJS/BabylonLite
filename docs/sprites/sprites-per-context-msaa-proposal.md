# Proposal: Per-Context MSAA for Sprite Rendering

> **Status**: Proposal · **Scope**: Engine + Sprite Renderer · **Companion docs**: [pr1-pure-2d-sprites-scope.md](pr1-pure-2d-sprites-scope.md), [sprites-implementation-plan.md](sprites-implementation-plan.md)

## Problem

Today the engine hardcodes 4× MSAA for every render pass. That's the right choice for 3D meshes (geometric edges need it), but wasteful for our 2D sprites — they're axis-aligned quads where edges come from texture alpha, not geometry. We're paying ~4× the per-pixel cost of the sprite pass for no visible benefit.

## Proposal

Make MSAA a per-`RenderingContext` setting, defaulting to the engine's MSAA (4) so all current behavior and parity tests are unchanged. Sprite renderers (and other 2D-style contexts) can opt in to MSAA 1 for a meaningful perf win.

```ts
createSpriteRenderer(engine, { layers, sampleCount: 1 }); // perf mode
createSpriteRenderer(engine, { layers });                 // default = engine MSAA, parity-safe
```

## Engine changes (small)

- `RenderingContext` gains an optional `_sampleCount: 1 | 4` field.
- `renderFrame` already runs **one render pass per context**, so each context just gets a pass attached to targets matching its sample count — no architectural rewrite.
- MSAA 4 contexts → existing path (MSAA color target → resolve to swapchain).
- MSAA 1 contexts → render directly into the swapchain texture, separate depth target.

## Lazy allocation (zero cost when unused)

Render targets are allocated on first use, not at engine init:

- MSAA-4 color + depth → allocated when the first MSAA-4 context renders.
- MSAA-1 depth → allocated when the first MSAA-1 context renders.
- Both freed and reallocated on canvas resize.

A pure 2D sprite app at MSAA 1 allocates **zero** MSAA color/depth surfaces (~17 MB saved at 1280×720). A pure 3D scene is unchanged.

## Ordering rule

MSAA-4 contexts must be registered before MSAA-1 contexts (the MSAA-1 pass loads from the swapchain, which must already contain the resolved 3D output). Documented; WebGPU validation catches violations loudly.

## Risks & mitigations

- **Parity**: defaults are unchanged, so all current parity scenes (50, 51, …) keep passing as-is.
- **Bundle size**: tiny change, no new dependencies.
- **Pipeline cache**: already keyed on sample count, so MSAA-1 and MSAA-4 sprite pipelines coexist without collisions.

## Scope

~30 lines in `engine.ts`, ~10 lines in `sprite-renderer.ts`, doc note in `docs/architecture/00-overview.md` §3.2. New test for MSAA-1 sprite rendering. No changes to public APIs other than honoring the existing-but-ignored `sampleCount` option on `SpriteRendererOptions`.
