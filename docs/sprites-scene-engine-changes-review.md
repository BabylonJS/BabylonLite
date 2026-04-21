# Sprites: scene + engine changes — review for the lead

> Audience: David. The full sprite design lives in
> [`docs/architecture/26-sprites.md`](architecture/26-sprites.md). This
> doc isolates **only** the engine-level / scene-level work the sprite
> module requires, so the cross-cutting parts can be reviewed without
> reading the sprite spec end-to-end.
>
> This is the revision that incorporates your "spriteRenderer +
> registerScene + `startEngine(engine)`" proposal from Teams.

## TL;DR

Two new public surfaces and one renaming of a parameter:

1. **`SpriteRenderer`** (in the sprite module) — an engine-registerable
   object that owns a list of `Sprite2DLayer`s and a target descriptor
   (color view, optional depth view, sample count, load op, clear). It
   conforms to a small new `EngineRenderer` interface
   (`{ render(encoder, dt); dispose(); }`).

2. **`registerScene(engine, scene)`** (in `scene-core.ts`) — wraps an
   existing `SceneContext` as an `EngineRenderer` and registers it on
   the engine. Runs the scene's deferred builders (what
   `startEngine(engine, scene)` does today). Replaces the `scene`
   argument on `startEngine`.

3. **`startEngine(engine)`** — drops the `scene` parameter. The engine
   walks `engine._registrations` once per frame in registration order.

The `addToScene` switch gains **one** new branch for
`_entityType === "sprite-2d-layer"`. Everything else in `scene-core.ts`
is untouched. The 3D pass (prepass, opaque, transparent queues, MSAA +
depth attachment) is untouched.

```typescript
// Pure-2D — no SceneContext anywhere
const sr = createSpriteRenderer(engine, { layers: [layer] });
registerSpriteRenderer(engine, sr);
await startEngine(engine);

// Scene-based — same end-of-setup as today, plus the new register call
const scene = createSceneContext(engine);
addToScene(scene /* mesh, light, camera, sprite layers, … */);
await registerScene(engine, scene);
await startEngine(engine);
```

## 1 · The new engine surface

```typescript
// src/engine/engine.ts — additions only.
export interface EngineRenderer {
    /** Called once per frame after the engine has acquired the
     *  swap-chain view and created the per-frame command encoder. */
    render(encoder: GPUCommandEncoder, deltaMs: number): void;
    dispose(): void;
}

/** @internal Inside EngineContextInternal: */
//   _registrations: EngineRenderer[];

// src/engine/start-engine.ts — signature change.
export function startEngine(engine: EngineContext): Promise<void>;
```

`startEngine` no longer takes a scene. It iterates
`engine._registrations` per frame, in order. The first-frame-ready
contract is preserved: `startEngine` resolves on the first frame in
which every registration's `render` completed without throwing.

## 2 · `SpriteRenderer`

```typescript
// src/sprite/sprite-renderer.ts
export interface SpriteRendererOptions {
    /** Layers drawn this frame (mutable; sorted internally). */
    layers: Sprite2DLayer[];
    /** Color attachment. Defaults to the engine's swap-chain view. */
    target?: GPUTextureView | (() => GPUTextureView);
    /** Required for layers with depth: "test" | "test-write". */
    depthView?: GPUTextureView | (() => GPUTextureView | undefined);
    /** Defaults: "clear" if this is the first registration; "load" otherwise. */
    loadOp?: GPULoadOp;
    clearValue?: GPUColorDict;
    /** 1 (default); 4 when drawing into an existing 3D MSAA pass. */
    sampleCount?: 1 | 4;
    resolveTarget?: GPUTextureView | (() => GPUTextureView);
}

export interface SpriteRenderer extends EngineRenderer {
    readonly _kind: "sprite-renderer";
    layers: Sprite2DLayer[];
}

export function createSpriteRenderer(engine: EngineContext, opts: SpriteRendererOptions): SpriteRenderer;
export function registerSpriteRenderer(engine: EngineContext, sr: SpriteRenderer): void;
export function unregisterSpriteRenderer(engine: EngineContext, sr: SpriteRenderer): void;
export function disposeSpriteRenderer(sr: SpriteRenderer): void;
```

Internally, `SpriteRenderer.render` sorts `this.layers` by
`(order, layerZ, insertion)`, uploads dirty per-instance data, begins
one render pass keyed by `(sampleCount, hasDepth)` (max four entries in
its per-renderer pipeline cache), and issues one `drawIndexed(6, count)`
per layer.

## 3 · `registerScene` and the `addToScene` change

```typescript
// src/scene/scene-core.ts — additions only.
export function registerScene(engine: EngineContext, scene: SceneContext): Promise<void>;
export function unregisterScene(engine: EngineContext, scene: SceneContext): void;
```

`registerScene` does what today's `startEngine(engine, scene)` does for
the scene side: runs `_deferredBuilders`, then registers the scene on
the engine. The scene's `render(encoder, dt)` runs the existing 3D pass
unchanged. After deferred builders complete, `registerScene` also
lazily creates an internal HUD `SpriteRenderer` for any
`ctx._hudSpriteLayers` and `registerSpriteRenderer`s it on the engine
**immediately after** the scene, so HUD draws on top of 3D.

The new `addToScene` branch (the only modification to the switch body):

```typescript
} else if (entity._entityType === "sprite-2d-layer") {
    const layer = entity as Sprite2DLayer;
    if (layer.depth === "none") {
        (ctx._hudSpriteLayers ??= []).push(layer);
    } else {
        (ctx._depthHostedSpriteLayers ??= []).push(layer);
    }
    if (layer._deferredBuild) {
        ctx._deferredBuilders.push(() => layer._deferredBuild!(scene));
    }
    return;
}
```

Depth-hosted layers are pushed into the existing
`_opaqueRenderables` / `_transparentRenderables` lists by their
`_deferredBuild` (just like meshes), so the existing 3D pass picks them
up. No new code in the 3D pass.

## 4 · What is preserved

- Existing `SceneContext` shape and field set.
- Existing `addToScene` switch body (all current branches unchanged).
- Existing 3D render pass (prepasses, opaque queue, transparent queue,
  MSAA + depth attachment).
- Existing renderable system (`_opaqueRenderables`,
  `_transparentRenderables`, `_prePasses`, `_uniformUpdaters`,
  `_deferredBuilders`).
- Existing `disposeScene`, `_beforeRender`, `_disposables` semantics.
- Lite's load-bearing rules: side-effect-free imports; entities don't
  know scene; no method-on-entity routing.

## 5 · What is new

| Surface                                                                  | Where                       | Why                                                                                         |
| ------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------- |
| `EngineRenderer` interface + `engine._registrations`                     | `engine/engine.ts`          | The engine-side abstraction both `Scene` and `SpriteRenderer` plug into                     |
| `startEngine(engine)` (drops `scene` arg)                                | `engine/start-engine.ts`    | Engine becomes the sole render-loop owner; pure-2D and scene-based use the same entry point |
| `registerScene(engine, scene)` / `unregisterScene`                       | `scene/scene-core.ts`       | Wraps a `SceneContext` as an `EngineRenderer` and runs deferred builders                    |
| New `_entityType: "sprite-2d-layer"` branch in `addToScene`              | `scene/scene-core.ts`       | Routes Sprite2DLayer to either HUD bucket or depth-hosted bucket                            |
| `_hudSpriteLayers`, `_depthHostedSpriteLayers` on `SceneContextInternal` | `scene/scene-core.ts`       | The two scene-level sprite buckets                                                          |
| `SpriteRenderer` + `register*`/`unregister*`/`dispose*` helpers          | `sprite/sprite-renderer.ts` | The engine-registerable sprite primitive — used by pure-2D and by the scene-internal HUD    |

## 6 · Verification

| Check                                       | How                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| All existing parity scenes pass MAD ceiling | `pnpm test:parity` — no diff in 3D rendering, since the scene's `render` body is unchanged                                                        |
| Pure-2D bundle ceiling                      | New ratchet: pure-2D entry point must NOT pull in `scene/scene-core.js`, `mesh/*`, `light/*`, `camera/*`, `material/pbr/*`, `material/standard/*` |
| HUD ordering                                | New parity scene `NN-sprites-mixed` — 3D meshes + anchored labels (depth-hosted) + HUD sprites; verifies HUD draws on top                         |
| Perf                                        | `pnpm test:perf` — engine loop overhead per registration is one virtual call + an `if (this.layers.length)` short-circuit; negligible             |
| Backward compatibility                      | `startEngine(engine, scene)` overload kept as a deprecated 2-arg form during the transition; calls `registerScene` then `startEngine(engine)`     |

## 7 · Recommended landing — single PR

1. Add `EngineRenderer` interface + `_registrations` on
   `EngineContextInternal`. Rewrite `startEngine` to walk the list.
2. Add `registerScene` / `unregisterScene` in `scene-core.ts`. Wrap the
   scene's existing render body as an `EngineRenderer.render` callback.
   Keep `startEngine(engine, scene)` as a deprecated overload that calls
   the new pair.
3. Add `sprite-renderer.ts` with `createSpriteRenderer` /
   `registerSpriteRenderer` / `unregisterSpriteRenderer` /
   `disposeSpriteRenderer`.
4. Add the `"sprite-2d-layer"` branch in `addToScene` and the two
   bucket arrays on `SceneContextInternal`.
5. Add the new tests (`sprite-renderer.test.ts`, `register-scene.test.ts`,
   `addToScene-sprite-2d-branch.test.ts`) and the new
   `NN-sprites-mixed` parity scene.
6. Add the pure-2D bundle-size ratchet.

## 8 · Open questions

1. **Should the deprecated `startEngine(engine, scene)` overload stay
   forever, or only through the next minor?** I lean "next minor only"
   — the new shape is the right one and we should pull users forward.
2. **Should `unregisterSpriteRenderer` flush in-flight GPU work before
   removing the renderer**, or just remove it from the list and let the
   existing pipeline cache live until `dispose`?
3. **Naming**: `EngineRenderer` vs `RenderRegistration` vs `FrameNode`.
   The last is the most frame-graph-honest but premature. I prefer
   `EngineRenderer` for now.
