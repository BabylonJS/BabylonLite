# Module: Sprites (Unified Scene)

> Package path: `packages/babylon-lite/src/sprite/`
>
> This document supersedes [26-sprites.md](26-sprites.md). It removes the
> parallel `Scene2DContext` track, collapses `AnchoredSpriteLayer` into
> `Sprite2DLayer`, and recasts the scene model so a pure-2D app, a pure-3D
> app, and a mixed 2D+3D app all use **one** `createSceneContext`,
> **one** `addToScene`, **one** `startEngine`. No back-compat from v26 is
> preserved.

## Purpose

Lite's design rule is "build things on top of previous things." Sprites are
2D quads. World-anchored ("2.5D") labels are 2D quads whose pixel position
is computed each frame from a 3D anchor. Camera-facing world-sized
billboards are different geometry (world-unit size, perspective
foreshortening, depth participation), and so they remain a separate family —
but they register through the **same** scene as everything else.

The module exposes **two** sprite families on a **single, dimension-agnostic
`SceneContext`**:

1. **`Sprite2DLayer`** — the foundation. Pixel-coordinate quads, no view
   matrix, no perspective divide, no required camera. Hosted by either:
    - the `OverlayStage` (no depth attachment, MSAA = 1, swap-chain only) —
      the default; or
    - the `Scene3DStage` (the same MSAA + depth attachment the 3D pass uses)
      — opted into per layer with `depth: "test"`, used when sprites must
      occlude behind 3D geometry (anchored labels, world UI markers, etc.).

    World-anchored sprites are not a separate family. They are
    `Sprite2DLayer` sprites with an opt-in `AnchorSource` adapter that runs
    on the CPU in a per-frame `_beforeRender` hook, projects the world
    anchor through the scene's camera, and writes the resulting layer-space
    `positionPx` (and optionally a derived `layerZ`) directly into the same
    80-byte instance slot a pure-2D sprite uses. The vertex shader,
    per-instance layout, packed buffer, and pipeline are **identical** to a
    pure-2D layer; the only difference is which stage hosts the layer
    (baked at construction, in the pipeline cache key — never branched per
    frame).

2. **`*BillboardSpriteSystem`** — three orientation factories
   (`Facing`, `YawLocked`, `AxisLocked`), each with its own WGSL composer,
   pipeline, and dynamic-import chunk. World-coordinate quads, world-unit
   size, perspective foreshortening, full depth participation. Hosted by
   the `Scene3DStage` only.

`SpriteAtlas`, `SpriteFrame`, `SpriteClip`, `SpriteClipState`, the per-clip
animation tick, the handle/index two-tier API, and parenting are all shared
across both families and orthogonal to family.

### Pillars (front and centre)

- **No `if` on render path.** Family selection, anchor mode, depth mode,
  and stage hosting are all decided at layer/system construction time and
  baked into the pipeline cache key. The per-frame loop walks fixed
  arrays, with no scene-mode branch and no per-sprite mode test.
- **Pay-for-use.** A pure-2D app's static import graph terminates at
  `engine` + `scene-core` + `sprite-2d` (+ atlas/animation helpers). It
  never names `Camera`, `Mesh`, `LightBase`, `Sprite3DSceneUBO`,
  `Scene3DStage`, depth attachment, MSAA targets, billboard variants, or
  anchor projection code. The 3D fields on `SceneContext`
  (`camera?: Camera`, `lights?: LightBase[]`, …) are `import type` only
  — TypeScript erases them at compile time, so pure-2D bundles never
  fetch the `Camera` / `LightBase` / `Mesh` runtime classes.
  Tree-shaking removes them all.
- **Extensions over hardcoding.** Anchoring is a tree-shakable
  `sprite-anchor.ts` add-on. The 3D render stage (`Scene3DStage`) is a
  lazy capability module pulled in only when a 3D entity is added to the
  scene; the stage owns its own internal render-loop state.

## Taxonomy — Two Families on One Scene

| Family                   | Variants                               | Coordinate space                                         | Size unit   | Depth                                   | Hosted by                                                             |
| ------------------------ | -------------------------------------- | -------------------------------------------------------- | ----------- | --------------------------------------- | --------------------------------------------------------------------- |
| `Sprite2DLayer`          | 1 (with optional `AnchorSource`)       | Pixels (layer-space; CPU-projected for anchored sprites) | Pixels      | Configurable per layer (composer-baked) | `OverlayStage` (default) **or** `Scene3DStage` (when `depth: "test"`) |
| `*BillboardSpriteSystem` | 3: `Facing`, `YawLocked`, `AxisLocked` | World                                                    | World units | Read; write configurable                | `Scene3DStage` only                                                   |

### Why anchored is no longer a family

The v26 split between `Sprite2DLayer` and `AnchoredSpriteLayer` was driven
by two real concerns: (a) anchored sprites need a `viewProjection` to
project their world anchor, and (b) anchored sprites that should occlude
behind 3D geometry need a depth attachment. The v26 design solved both by
making "anchored" a separate family with its own WGSL composer, its own
112-byte instance stride (worldPos + offsetPx + depthBias), and its own
GPU vertex-stage projection.

That design is wrong for three concrete reasons:

1. **The actual difference is one CPU operation per anchored sprite per
   frame.** Project a world anchor through `viewProjection`, divide by `w`,
   scale to viewport pixels, write the result into the same `positionPx[2]`
   slot a pure-2D sprite would use. This is one Mat4 × Vec4 (16 FMAs) plus
   2 multiplies and 2 adds. For typical anchored populations (HUD pins,
   nameplates, map markers — dozens to a few hundred) this is microseconds
   per frame. Doing it on the CPU keeps the GPU pipeline, the per-instance
   layout, the packed buffer stride, and the WGSL vertex shader **byte-
   identical** to a pure-2D layer.

2. **Depth participation is a per-render-pass attachment decision, not a
   per-family decision.** Modelling it as a family leaks a pass-level
   constraint into the layer type and forces the public API to choose one
   shape ("anchored") instead of letting any 2D layer opt into depth
   testing. Modelling it per layer (`depth: "none" | "test" | "test-write"`)
   is the correct level of granularity. Each value is a pipeline-cache key
   bit baked once at composition time — never branched at runtime.

3. **The v26 `Sprite3DSceneUBO` (viewProjection + camera basis + viewport)
   was paid for solely to GPU-project anchors.** Once we project on the
   CPU, anchored layers do not need that UBO at all (the camera basis
   appears only as the `viewProjection` matrix consumed by the CPU
   projection helper, and `viewportPx` already lives in the pure-2D scene
   UBO). The 3D scene UBO becomes a billboard-only artefact, which it
   morally always was.

The "anchor" is a small interface:

```typescript
export interface AnchorSource {
    /** Project this anchor for the current frame.
     *  Writes into outPx (length 2) and outZ (length 1, view-space depth).
     *  Returns false to hide the sprite this frame (off-screen, behind camera, parent not yet built). */
    readonly project: (outPx: Float32Array, outZ: Float32Array, scene: SceneContext) => boolean;
}
```

`AnchorSource` lives in `sprite/anchor/sprite-anchor.ts` — a separate
module. A scene that never instantiates an anchor never imports
`sprite-anchor.ts` and pays zero bytes for camera-basis projection code.

### Why billboards remain a separate family

Billboards are not "Sprite2D + a different anchor source." Their
differences are per-vertex, not per-CPU-update:

- **World-unit sizing.** Billboard quads are extruded in world units along
  camera basis vectors **before** projection (`cameraRight * sizeWorld.x +
cameraUp * sizeWorld.y`), which produces correct perspective
  foreshortening. Anchored sprites are extruded in pixel space **after**
  projection. These are opposite contracts (size shrinks with distance vs.
  size invariant under distance) — the entire reason each variant exists.

- **Per-vertex camera basis.** Each billboard variant computes
  `(right, up)` per vertex from the camera (`Facing`), or from world-up
    - camera direction (`YawLocked`), or from a lock axis + camera direction
      (`AxisLocked`). The pure-2D vertex shader has no camera basis input at
      all and ships zero camera-basis code.

- **Depth-write semantics.** Cutout billboards write depth (so they cast/
  receive against opaque meshes); anchored sprites never write depth.

Forcing billboards through the Sprite2D pipeline would either require a
per-vertex `if (isBillboard) { compute world basis } else { compute pixel
offset }` (violating the no-`if`-on-render-path rule), or a CPU "project
four corners" path (O(N×4) Mat4×Vec4 per frame against tree forests, the
exact cost the billboard vertex-shader trick was invented to avoid).
Splitting them is correct.

The three orientation factories remain explicit (`Facing`, `YawLocked`,
`AxisLocked`) — three vertex shaders, three pipelines, three dynamic-
import chunks, no `axisLock?: 'none'|'y'|Vec3` flag.

### Modes deliberately not added

- **World-aligned non-billboard sprite** — use a `Mesh` with a textured
  alpha-blended material.
- **Tile maps (`SpriteMap`-like)** — separate future module.
- **2D-camera scene with pan/zoom** — that is `Sprite2DLayer.view`
  (per-layer pan + zoom + rotation), no additional family.

## Resolution: One `SceneContext`, Composable Stages

**Decision: one `SceneContext` that declares 3D state as plain optional
fields (`camera?: Camera`, `lights?: LightBase[]`, `meshes?: Mesh[]`, …)
typed via `import type` so a pure-2D bundle never fetches the underlying
runtime classes. Internal render-loop state (renderable lists, prepass
list, uniform updaters, billboard systems, depth-hosted sprite layers,
the shared 3D scene UBO) lives on the `Scene3DStage` instance itself,
not on the scene. Render orchestration is a list of `RenderStage`s
registered into `scene._stages` by lazy capability modules. Routing in
`addToScene` is method-on-entity (`entity._addToScene(scene)`), so the
scene core has zero static reference to any concrete entity type.**

### Rejected alternatives

| Alternative                                                                                       | Why rejected                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep `SceneContext` (3D-shaped) and add `Scene2DContext`                                          | Two parallel APIs — the lead's directive explicitly rejects this.                                                                                                                                                                                                      |
| Keep `SceneContext` with 3D fields directly + per-frame `if (is2D)`                               | Violates no-`if`-on-render-path. (3D fields can be present without `if`s — see chosen design.)                                                                                                                                                                         |
| Lazy `scene._3d?: Scene3DState` slot + `getSceneCamera/setSceneCamera` accessors                  | Forces 3D code to write `getSceneCamera(scene)` / `scene._3d!.lights` instead of `scene.camera` / `scene.lights`. Mismatches Babylon.js shape, regresses DX for the engine's primary use case (3D), and adds a hidden indirection in the debugger for negligible gain. |
| `defineProperty` getter/setter on `SceneContext` that lazily allocates a sub-object on assignment | Preserves `scene.camera = cam` ergonomics but ships accessor descriptors in every scene-core bundle (including pure-2D), introduces hidden control flow on a field write, and breaks the codebase's "pure state + free functions, no magic" invariant.                 |
| Central `addToScene` switch over `_entityType`                                                    | Every entity-type branch lives in scene-core, so scene-core statically references every concrete factory module — the exact opposite of pay-for-use.                                                                                                                   |

### Routing — method-on-entity

The scene core declares one interface and one routing thunk. It never
imports concrete entity types.

```typescript
// src/scene/scene-core.ts
export interface SceneEntity {
    /** Routing thunk invoked by addToScene. The entity is responsible for
     *  installing itself into the right capability slot AND for ensuring any
     *  required render stage is registered. */
    readonly _addToScene: (scene: SceneContext) => void;
}

export function addToScene(scene: SceneContext, entity: SceneEntity): void {
    entity._addToScene(scene);
}
```

That's the entire `addToScene` for the unified scene. Every concrete
factory (`createMesh`, `createDirectionalLight`, `createSprite2DLayer`,
`createYawLockedBillboardSystem`, `loadGltf`, …) installs its own
`_addToScene` thunk that calls the appropriate `ensureScene3DStage` /
`ensureSprite2DCapability` / `ensureOverlayStage` helpers, lazy-initialises
the matching optional field on `SceneContext` (e.g.
`(scene.lights ??= []).push(this)`), and pushes any internal renderable
into the stage instance's state.

A pure-2D app never imports any 3D factory, so:

- The 3D stage module (`scene-3d-stage.ts`) is never loaded.
- The 3D scene UBO module (`sprite-3d-scene-ubo.ts`) is never loaded.
- The depth/MSAA target allocator (`render-3d-targets.ts`) is never loaded.
- The shadow / opaque-vs-transparent split / mesh disposal / material-swap
  queue / animation-group walker / fog / image-processing / PBR / Standard
  material modules are all unreachable.
- The optional 3D fields declared on `SceneContext` (`camera?: Camera`,
  `lights?: LightBase[]`, …) are `import type` only, so the `Camera`,
  `LightBase`, and `Mesh` runtime classes never enter the bundle.

### `SceneContext` — the entire public scene API

```typescript
// src/scene/scene-core.ts
import type { EngineContext } from "../engine/engine.js";
// Type-only: TS erases these at compile time. Pure-2D bundles do NOT fetch
// the underlying runtime classes. The optional 3D fields below are pure
// shape declarations — they are `undefined` until a 3D entity registers itself.
import type { Camera } from "../camera/camera.js";
import type { LightBase } from "../light/types.js";
import type { Mesh } from "../mesh/mesh.js";
import type { ShadowGenerator } from "../shadow/shadow-generator.js";
import type { AnimationGroup } from "../animation/animation-group.js";
import type { FogConfig } from "../material/standard/standard-material.js";

export interface SceneOptions {
    clearColor?: GPUColorDict;
    /** Fixed delta time in ms for deterministic capture. 0 = use real rAF delta. */
    fixedDeltaMs?: number;
}

export interface ImageProcessingConfig {
    exposure: number;
    contrast: number;
    toneMappingEnabled: boolean;
    toneMappingType?: "standard" | "aces";
}

export interface SceneContext {
    readonly engine: EngineContext;
    clearColor: GPUColorDict;
    fixedDeltaMs: number;

    // ─── Optional 3D fields ─────────────────────────────────────────────
    // Declared on SceneContext directly so 3D code can write `scene.camera`,
    // `scene.lights`, etc. without an accessor function. All `import type`
    // — none of these names appear at runtime in a pure-2D bundle.
    // Each field is `undefined` until the corresponding 3D factory's
    // `_addToScene` thunk lazy-initialises it (e.g.
    // `(scene.lights ??= []).push(light)`).
    camera?: Camera;
    lights?: LightBase[];
    meshes?: Mesh[];
    animationGroups?: AnimationGroup[];
    fog?: FogConfig;
    shadowGenerators?: ShadowGenerator[];
    imageProcessing?: ImageProcessingConfig;
}

export function createSceneContext(engine: EngineContext, opts?: SceneOptions): SceneContext;
export function addToScene(scene: SceneContext, entity: SceneEntity): void;
export function removeFromScene(scene: SceneContext, entity: SceneEntity): void;
export function onBeforeRender(scene: SceneContext, cb: (deltaMs: number) => void): void;
export function disposeScene(scene: SceneContext): void;
export function startEngine(engine: EngineContext, scene: SceneContext): Promise<void>;
```

`SceneContext` runtime imports stay limited to `EngineContext`. The 3D
shape (`Camera`, `LightBase`, `Mesh`, …) is exposed via `import type`,
which TypeScript erases at compile time — pure-2D bundles never load
those modules. Application code uses the same field-access syntax it
would in Babylon.js: `scene.camera = cam`, `scene.lights?.push(light)`,
`for (const m of scene.meshes ?? [])`. There is no accessor function
layer; there is no `_3d` slot to pierce through.

```typescript
/** @internal — fields used by stages and capability modules only. */
export interface SceneContextInternal extends SceneContext {
    /** Render stages, in canonical execution order (canonicalized once at startEngine). */
    _stages: RenderStage[];
    /** Per-frame callbacks (animation, clip ticks, anchor projection, physics, …). */
    _beforeRender: ((deltaMs: number) => void)[];
    /** Deferred builders run once at startEngine. */
    _deferredBuilders: (() => void | Promise<void>)[];
    /** Cleanup callbacks. */
    _disposables: (() => void)[];
    _disposed: boolean;

    /** Optional Sprite2D capability slot — populated lazily by ensureSprite2DCapability. */
    _sprites?: import("../sprite/sprite-2d-capability.js").Sprite2DState;
}
```

The `import("...")` reference above is **type-only** (TS erases it at
compile time) and a **lazy-import path**. It does not pull the module
into the scene-core chunk.

### `Scene3DStage` owns its own internal state

There is no `Scene3DState` interface and no `_3d` slot on the scene. The
user-facing 3D fields (`scene.camera`, `scene.lights`, …) live directly
on `SceneContext` (above). The internal hot-render-loop state lives on
the `Scene3DStage` instance itself, allocated lazily by
`ensureScene3DStage(scene)`:

```typescript
// src/scene/scene-3d-stage.ts — only imported when a 3D entity is added.
import type { Renderable, PrePassRenderable, SceneUniformUpdater, MeshGroupBuilder } from "../render/renderable.js";
import type { Mesh } from "../mesh/mesh.js";

/** @internal — held inside the Scene3DStage instance, not on the scene. */
export interface Scene3DStageState {
    _opaqueRenderables: Renderable[];
    _transparentRenderables: Renderable[];
    _prePasses: PrePassRenderable[];
    _uniformUpdaters: SceneUniformUpdater[];
    _groups: Map<MeshGroupBuilder, Mesh[]>;
    _meshDisposables: Map<Mesh, (() => void)[]>;
    _materialSwapQueue: Mesh[];
    _renderableVersion: number;

    /** Billboards live here (Scene3DStage hosts them). */
    _billboardSystems: import("../sprite/sprite-billboard-shared.js").BillboardSpriteSystem[];

    /** Sprite2DLayers with depth: "test" | "test-write" live here too. */
    _depthHostedSpriteLayers: import("../sprite/sprite-2d.js").Sprite2DLayer[];

    /** Lazy: the shared sprite 3D scene UBO. Created by the first billboard
     *  system; reused thereafter. Never allocated in scenes with no billboards. */
    _sprite3dSceneUBO?: GPUBuffer;
}

export interface Scene3DStage extends RenderStage {
    readonly name: "scene-3d";
    readonly state: Scene3DStageState;
}

/** Lazy + idempotent. On first call: instantiates Scene3DStage, registers it
 *  into scene._stages, and returns it. Subsequent calls return the same instance. */
export function ensureScene3DStage(scene: SceneContext): Scene3DStage;
```

No accessor module. No `getSceneCamera` / `setSceneCamera`. 3D code
reads and writes `scene.camera`, `scene.lights`, `scene.meshes`, etc.
directly — same shape as Babylon.js.

### Render stages

```typescript
// src/scene/render-stage.ts
export interface RenderStage {
    readonly name: "overlay" | "scene-3d";
    /** Render this stage. The first stage in canonical order writes loadOp="clear";
     *  subsequent stages write loadOp="load". The choice is set once at
     *  canonicalization time and stored on the stage. */
    readonly render: (encoder: GPUCommandEncoder, view: GPUTextureView, scene: SceneContext, deltaMs: number) => void;
    _loadOp: GPULoadOp;
}
```

Two stages exist. Each lives in its own module and is dynamic-imported by
its `ensure*Stage` helper — neither is loaded by `scene-core.ts` directly.

- **`OverlayStage`** (`src/scene/overlay-stage.ts`) — single render pass,
  no depth attachment, MSAA = 1, color attachment is the swap-chain view.
  Renders all `scene._sprites?._overlayLayers` in `(order, layerZ,
insertion)` ascending. Owns the `Sprite2DSceneUBO` updater. Allocated by
  `ensureOverlayStage(scene)`.

- **`Scene3DStage`** (`src/scene/scene-3d-stage.ts`) — manages the
  per-engine MSAA + depth attachment, the prepass list (shadow maps), the
  opaque queue (sorted at build time), the transparent queue (sorted
  per-frame back-to-front), and the post-overlay flush of any `Sprite2DLayer
` with `depth !== "none"`. Allocated by `ensureScene3DStage(scene)`.
  Verbatim port of the v26 3D render-loop logic.

### `startEngine` — one entry point, no `if`

```typescript
export async function startEngine(engine: EngineContext, scene: SceneContext): Promise<void> {
    const eng = engine as EngineContextInternal;
    const sc = scene as SceneContextInternal;

    // 1. Run all deferred builders. Each builder dynamic-imports its renderable.
    for (const b of sc._deferredBuilders) await b();
    sc._deferredBuilders.length = 0;

    // 2. Canonicalize stage order: [Scene3DStage?, OverlayStage?].
    //    This runs ONCE here, never per frame.
    canonicalizeStages(sc);

    // 3. Resolve the first-stage clear: first stage gets "clear", rest get "load".
    for (let i = 0; i < sc._stages.length; i++) {
        sc._stages[i]._loadOp = i === 0 ? "clear" : "load";
    }

    let firstFrame = true;
    return new Promise<void>((resolve) => {
        const loop = (now: number, deltaMs: number) => {
            for (const cb of sc._beforeRender) cb(deltaMs);
            const encoder = eng.device.createCommandEncoder();
            const view = eng.context.getCurrentTexture().createView();
            // Hot loop: walk stages in canonical order. No is2D branch.
            for (const stage of sc._stages) stage.render(encoder, view, scene, deltaMs);
            eng.device.queue.submit([encoder.finish()]);
            if (firstFrame) {
                firstFrame = false;
                resolve();
            }
            eng.requestFrame(loop);
        };
        eng.requestFrame(loop);
    });
}
```

There is no `if (is2D)`, no `if (scene.camera)`, no `if (passConfig.hasDepth)`.
The per-frame loop iterates `sc._stages`. A pure-2D scene has exactly one
stage (`OverlayStage`); a pure-3D scene has exactly one stage
(`Scene3DStage`); a mixed scene has both, in canonical order, with the
clear / load load-ops baked at canonicalization. Depth attachment, MSAA
samples, swap-chain clear ownership — all are properties of whichever
stage owns them. None requires a runtime branch.

#### Why canonicalize stages

A user that adds a HUD layer first and a mesh second would otherwise get
`[OverlayStage, Scene3DStage]`, and the 3D content would draw on top of the
HUD. Stage canonicalization runs once at `startEngine` and reorders to
`[Scene3DStage?, OverlayStage?]` regardless of registration order. This is
a single sort outside the hot loop, not a per-frame check.

### Code samples

#### Pure 2D — zero 3D bytes fetched

```typescript
const engine = await createEngine(canvas);
const scene = createSceneContext(engine);
const atlas = await loadSpriteAtlas(engine, "sprites.png", { gridSize: [32, 32] });
const layer = createSprite2DLayer(atlas);
addSprite2D(layer, { positionPx: [100, 200], sizePx: [64, 64], frame: 0 });
addToScene(scene, layer);
await startEngine(engine, scene);
```

Static import graph: `engine` + `scene-core` + `overlay-stage` +
`sprite-2d` + `sprite-atlas` + `sprite-animation` + `sprite-gpu` +
`sprite-2d-renderable` + `sprite-2d-shader`. Nothing else. No `Camera`,
no `Mesh`, no `LightBase`, no `Scene3DStage`, no
depth/MSAA target allocator, no PBR, no Standard, no shadow generator,
no animation group, no anchor projection, no billboard variants.

#### Mixed 3D + anchored labels + HUD overlay — same API

```typescript
const engine = await createEngine(canvas);
const scene = createSceneContext(engine);

addToScene(scene, createDirectionalLight([0, -1, 0]));
addToScene(scene, await loadGltf(engine, "world.glb"));

addToScene(scene, createYawLockedBillboardSystem(treeAtlas)); // Scene3DStage

// Anchored labels: same Sprite2DLayer factory, depth:"test" hosts it in Scene3DStage
const labels = createSprite2DLayer(labelAtlas, { depth: "test" });
addAnchoredSprite2D(labels, {
    anchor: createWorldAnchor([0, 1.8, 0]),
    sizePx: [128, 32],
    frame: "name-bg",
});
addToScene(scene, labels);

// HUD: same Sprite2DLayer factory, default depth:"none" hosts it in OverlayStage
const hud = createSprite2DLayer(hudAtlas);
addSprite2D(hud, { positionPx: [16, 16], sizePx: [200, 32], frame: "score" });
addToScene(scene, hud);

await startEngine(engine, scene);
```

The third snippet is the punch line: **one** `createSprite2DLayer` factory
used twice (once for anchored in-world labels, once for HUD), the same
WGSL, the same per-instance layout, the same packed buffer. The `depth`
option chooses which stage hosts the layer. The `addAnchoredSprite2D`
helper attaches an `AnchorSource` and ensures the per-frame projection hook
is installed for that layer.

---

## Public API Surface

### Shared — Atlas, Frames, Animation

Unchanged from v26. (`sprite/shared/sprite-atlas.ts`,
`sprite/shared/sprite-animation.ts` — same `SpriteAtlas`, `SpriteFrame`,
`SpriteClip`, `SpriteClipState`, `loadSpriteAtlas`, `createGridSpriteAtlas`,
`createNamedSpriteAtlas`, `resolveSpriteFrame`, `createSpriteClipState`,
`evaluateSpriteClip`, `advanceSpriteClip`.)

### Family 1 — `Sprite2DLayer` (foundation)

```typescript
// src/sprite/sprite-2d.ts
import type { SpriteAtlas, SpriteBlendMode, SpriteFrameRef } from "./shared/sprite-atlas.js";
import type { SpriteClipState } from "./shared/sprite-animation.js";
import type { SceneEntity } from "../scene/scene-core.js";

export type Sprite2DDepthMode = "none" | "test" | "test-write";

export interface Sprite2DView {
    positionPx: [number, number];
    zoom: number;
    rotation: number;
}

export interface Sprite2DLayerOptions {
    capacity?: number;
    blendMode?: SpriteBlendMode;
    pixelSnap?: boolean;
    opacity?: number;
    visible?: boolean;
    order?: number;
    view?: Partial<Sprite2DView>;
    /**
     * Depth participation:
     *  - "none"        (default) → hosted by OverlayStage, no depth attachment.
     *  - "test"                  → hosted by Scene3DStage, depthCompare="less-equal", depthWrite=false.
     *                              Required when sprites must occlude behind 3D geometry.
     *  - "test-write"            → hosted by Scene3DStage, depthCompare="less-equal", depthWrite=true.
     *                              Use for cutout sprites that should cast/receive depth in the opaque queue.
     *  Each value is a pipeline-cache key bit, baked at composition time. No runtime branch.
     */
    depth?: Sprite2DDepthMode;
}

export interface Sprite2DLayer extends SceneEntity {
    readonly _entityType: "sprite-2d-layer";
    readonly atlas: SpriteAtlas;
    readonly depth: Sprite2DDepthMode;
    blendMode: SpriteBlendMode;
    pixelSnap: boolean;
    opacity: number;
    visible: boolean;
    order: number;
    view: Sprite2DView;
    count: number;
}

export interface Sprite2DInit {
    positionPx: [number, number];
    sizePx?: [number, number];
    frame?: SpriteFrameRef;
    rotation?: number;
    pivot?: [number, number];
    color?: [number, number, number, number];
    flipX?: boolean;
    flipY?: boolean;
    layerZ?: number;
    visible?: boolean;
    pickable?: boolean;
    clip?: SpriteClipState | null;
}

export function createSprite2DLayer(atlas: SpriteAtlas, opts?: Sprite2DLayerOptions): Sprite2DLayer;

// Index API — low-level, parallels ThinInstance.
export function addSprite2DIndex(layer: Sprite2DLayer, init: Sprite2DInit): number;
export function updateSprite2DIndex(layer: Sprite2DLayer, index: number, patch: Partial<Sprite2DInit>): void;
export function removeSprite2DIndex(layer: Sprite2DLayer, index: number): void;
export function setSprite2DFrameIndex(layer: Sprite2DLayer, index: number, frame: SpriteFrameRef): void;
export function playSprite2DClipIndex(layer: Sprite2DLayer, index: number, clip: string, loop?: boolean): void;
export function stopSprite2DClipIndex(layer: Sprite2DLayer, index: number): void;
```

The Handle API (`addSprite2D` / `removeSprite2D`, returning a
`Sprite2DHandle` with observable fields, stable id, and parenting) lives
in `sprite/sprite-2d-handle.ts` — same pattern as v26, separately
importable so Index-only scenes do not pull handle code.

### `AnchorSource` — opt-in 3D bridge for `Sprite2DLayer`

```typescript
// src/sprite/anchor/sprite-anchor.ts — separate module, dynamic-imported on first use.
import type { Sprite2DLayer, Sprite2DInit } from "../sprite-2d.js";
import type { SceneContext } from "../../scene/scene-core.js";
import type { IWorldMatrixProvider } from "../../scene/parenting.js";

export interface AnchorSource {
    readonly project: (outPx: Float32Array, outZ: Float32Array, scene: SceneContext) => boolean;
}

/** Static world-space anchor. */
export function createWorldAnchor(worldPos: [number, number, number]): AnchorSource;

/** World anchor that follows a moving entity (mesh, transform node, sprite handle). */
export function createParentAnchor(parent: IWorldMatrixProvider, localOffset?: [number, number, number]): AnchorSource;

/** Attach an AnchorSource to a sprite. The sprite's positionPx is overwritten each frame
 *  by the projection result. Layer must have depth !== "none" for occlusion against 3D geometry. */
export interface AnchoredSprite2DInit extends Sprite2DInit {
    anchor: AnchorSource;
    offsetPx?: [number, number];
    /** NDC-z bias added after projection (positive = pushed toward camera). Default 0. */
    depthBias?: number;
}

export function addAnchoredSprite2D(layer: Sprite2DLayer, init: AnchoredSprite2DInit): number;
export function setSprite2DAnchor(layer: Sprite2DLayer, index: number, anchor: AnchorSource | null): void;
```

The first call to `addAnchoredSprite2D` (or `setSprite2DAnchor` with a
non-null anchor) on a given layer:

1. Lazy-allocates a sparse `Map<number, AnchoredEntry>` on the layer
   (sprites without an anchor have no entry).
2. Installs a per-frame hook into `scene._beforeRender` (via `unshift`,
   so it runs before user `onBeforeRender` callbacks) that walks the
   layer's anchored map, calls each `anchor.project()`, and writes the
   resulting `positionPx`, optional `layerZ` (mapped from view-Z), and
   `depthBias`-adjusted ordering into the layer's flat storage via the
   same code path `updateSprite2DIndex` uses. Sprites whose `project`
   returns `false` get `sizePx = [0, 0]` written into their slot
   (degenerate quad — same trick as `visible: false`).
3. Registers a single disposable that removes the hook when the layer is
   disposed or its anchored map becomes empty.

```typescript
// In sprite-anchor.ts internal:
interface AnchoredEntry {
    anchor: AnchorSource;
    offsetPx: [number, number];
    depthBias: number;
}
```

A scene that has zero anchored sprites never imports `sprite-anchor.ts`,
never allocates the sparse map, never installs the projection hook, and
never pays for `viewProjection` on the CPU.

### Family 2 — `*BillboardSpriteSystem` (unchanged from v26)

```typescript
// src/sprite/sprite-billboard-shared.ts
import type { SceneEntity } from "../scene/scene-core.js";

export interface BillboardSpriteSystemOptions {
    capacity?: number;
    blendMode?: SpriteBlendMode;
    opacity?: number;
    visible?: boolean;
    order?: number;
    depthWrite?: boolean;
    alphaCutoff?: number;
}

export interface BillboardSpriteSystem extends SceneEntity {
    readonly _entityType: "billboard-sprite-system";
    readonly atlas: SpriteAtlas;
    blendMode: SpriteBlendMode;
    opacity: number;
    visible: boolean;
    order: number;
    depthWrite: boolean;
    alphaCutoff: number;
    count: number;
}

export interface BillboardSpriteInit {
    position: [number, number, number];
    sizeWorld: [number, number];
    frame?: SpriteFrameRef;
    rotation?: number;
    pivot?: [number, number];
    color?: [number, number, number, number];
    flipX?: boolean;
    flipY?: boolean;
    visible?: boolean;
    pickable?: boolean;
    clip?: SpriteClipState | null;
}

export function createFacingBillboardSystem(atlas: SpriteAtlas, opts?: BillboardSpriteSystemOptions): BillboardSpriteSystem;
export function createYawLockedBillboardSystem(atlas: SpriteAtlas, opts?: BillboardSpriteSystemOptions): BillboardSpriteSystem;
export function createAxisLockedBillboardSystem(atlas: SpriteAtlas, axis: [number, number, number], opts?: BillboardSpriteSystemOptions): BillboardSpriteSystem;

// Index + Handle APIs identical in shape to v26.
```

Each billboard factory's `_addToScene` thunk calls
`ensureScene3DStage(scene)`, then pushes `this` into
`stage.state._billboardSystems` and queues the renderable's deferred
build. The first billboard added also lazy-allocates
`stage.state._sprite3dSceneUBO` and registers its updater into
`stage.state._uniformUpdaters`. Pure-2D scenes never load any of this.

### Picking — two pickers, not three

```typescript
// src/sprite/picking/pick-sprite-2d.ts — handles BOTH pure-2D and anchored layers.
export function pickSprite2D(scene: SceneContext, xPx: number, yPx: number): SpritePickInfo | null;

// src/sprite/picking/pick-billboard.ts — GPU contributor (unchanged from v26).
export function pickBillboardSprite(scene: SceneContext, xPx: number, yPx: number): Promise<SpritePickInfo | null>;
```

`pickSprite2D` walks both `scene._sprites?._overlayLayers` and the
active `Scene3DStage`'s `state._depthHostedSpriteLayers` (if a
`Scene3DStage` is registered) in reverse `(order, layerZ,
insertion)`. For anchored layers the picker reads the per-sprite
`positionPx` directly — anchor projection has already been performed CPU-
side this frame, so the picker hits the same screen rectangle the GPU
draws. No GPU pick pass for Sprite2D.

`pickBillboardSprite` is the existing v26 GPU pick contributor design,
unchanged.

### Stage / capability helpers — `@internal`, never re-exported

```typescript
// src/sprite/sprite-2d-capability.ts — only loaded when a Sprite2DLayer is added.
export interface Sprite2DState {
    _overlayLayers: Sprite2DLayer[];
    _pipelines: Map<string, GPURenderPipeline>; // lazy-init on first build
}
export function ensureSprite2DCapability(scene: SceneContext): Sprite2DState;

// src/scene/overlay-stage.ts — only loaded when a Sprite2DLayer with depth: "none" is added.
export function ensureOverlayStage(scene: SceneContext): void;

// src/scene/scene-3d-stage.ts — only loaded when any 3D entity is added.
// Allocates the Scene3DStage instance (with its own internal Scene3DStageState)
// on first call; idempotent thereafter. Returns the stage so callers can push
// renderables into stage.state.
export function ensureScene3DStage(scene: SceneContext): Scene3DStage;
```

---

## Internal Architecture

### Core Rule: No `if` Across Modes (still)

There is still no shared `createSprite()`, no `SpriteMode` enum, no per-
frame `if (sprite.kind === ...)`. The two families have separate composers,
separate renderables, separate WGSL. The unification happens at the
**scene** layer, not at the sprite-shader layer. The `AnchorSource`
projection is a CPU step on a sparse per-layer map; the GPU pipeline and
per-instance layout are byte-identical to a pure-2D layer.

### Per-Instance GPU Layout

`Sprite2DLayer` keeps the v26 80-byte stride for every layer, anchored or
not. Anchor data lives off-instance in a sparse JS map.

#### Sprite2DLayer (80 B = 20 floats)

| Offset (floats) | Field         | Notes                                                              |
| --------------- | ------------- | ------------------------------------------------------------------ |
| 0..1            | `positionPx`  | layer-space pixels; for anchored sprites, written by CPU sync hook |
| 2..3            | `sizePx`      | width/height in pixels                                             |
| 4..5            | `pivot`       | normalized [0,1]                                                   |
| 6..7            | `sinCos`      | precomputed sin/cos of rotation                                    |
| 8..11           | `uvRect`      | uvMin.xy, uvMax.xy                                                 |
| 12..15          | `color`       | RGBA tint                                                          |
| 16              | `layerZ`      | ordering scalar (also depth, for `depth: "test"` layers)           |
| 17..19          | `flagsAndPad` | float-encoded `[flipX, flipY, pickable]`                           |

**Why not 112 bytes for anchored layers?** A 112 B stride buys nothing.
The CPU has to read `worldPos`, `offsetPx`, and `depthBias` once per frame
to project the anchor anyway; storing those values in the GPU buffer adds
upload bandwidth (32 extra bytes per sprite per frame for any change) and
forces a per-layer pipeline specialization on the GPU side. Storing them
in a JS-side `AnchoredEntry` is one cache-line read per anchored sprite per
frame, with the projection result going straight into the existing 80-byte
slot.

**Cost summary for N anchored sprites per frame:**

- CPU: N × (Mat4 × Vec4 + 4 multiplies + 4 adds) ≈ 24 FMAs per sprite.
  At N = 1000, ~24,000 FMAs — single-digit microseconds on any modern CPU.
- GPU: zero extra cost vs. pure-2D — same pipeline, same buffer, same draw.

#### BillboardSpriteSystem (96 B = 24 floats)

Unchanged from v26. Storage-buffer-bound at `@group(1) @binding(3)`.
Sort indirection at `@location(0)` per-instance vertex attribute. See
[26-sprites.md "Sort Indirection + Storage Buffer (3D families)"](26-sprites.md)
for the full layout — the design carries over byte-for-byte.

### Vertexless Quad

Six invocations per instance from `@builtin(vertex_index)` (triangle list).
Identical to v26.

### CPU → GPU Sync (`sprite-gpu.ts`)

Identical to v26: per-layer `Float32Array`, `[dirtyMin, dirtyMax]` range,
single coalesced `writeBuffer`. Anchor projection feeds the dirty-range
mechanism via the same `updateSprite2DIndex` write path it always used.
Anchor sprites whose projected position changes every frame (the common
case) are effectively a full re-upload of the anchored sprites' contiguous
slot range each frame — same cost profile as a per-frame-moving particle
layer in v26. Static anchors (parent never moves, camera never moves) skip
upload via the `_version === _gpuVersion` short-circuit.

### Hook Registration Order

Per-layer animation/clip ticks AND the per-layer anchor-projection hook
both register into `scene._beforeRender` via `unshift`, so they run before
any user `onBeforeRender` callback. Same freeze-flag contract as v26.

---

## Pipeline Configuration

### Shared Across All Layers

| Setting       | Value                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| Topology      | `triangle-list`                                                        |
| Index buffer  | none (vertexless)                                                      |
| Cull mode     | `none`                                                                 |
| Front face    | `ccw`                                                                  |
| Color target  | swap-chain format                                                      |
| MSAA          | per-stage: 1 in OverlayStage, 4 in Scene3DStage                        |
| Atlas sampler | per-atlas (`linear` or `nearest`), `clamp-to-edge`, no mipmaps default |

### Sprite2DLayer per-`depth` Pipeline State

| Layer `depth`  | Stage        | Depth attachment        | Depth compare | Depth write | Sort key                        | Render queue              |
| -------------- | ------------ | ----------------------- | ------------- | ----------- | ------------------------------- | ------------------------- |
| `"none"`       | OverlayStage | absent                  | n/a           | n/a         | `(order, layerZ, insertion)`    | overlay (final)           |
| `"test"`       | Scene3DStage | engine depth attachment | `less-equal`  | `false`     | back-to-front by layer centroid | transparent (210 + order) |
| `"test-write"` | Scene3DStage | engine depth attachment | `less-equal`  | `true`      | front-to-back by layer centroid | opaque (110 + order)      |

`depth` is in the pipeline cache key. The composer emits the matching
`depthStencil` descriptor block (or omits it for `"none"`). **No runtime
depth-state branch.**

### Bind Group Layouts

**`Sprite2DSceneUBO`** (32 B) — `@group(0) @binding(0)` for every
`Sprite2DLayer` regardless of stage. Identical to v26: `viewportPx`,
`invViewportPx`, `viewPositionPx`, `zoom`, `viewRotation`. Allocated and
updated by the **OverlayStage** when present, by the **Scene3DStage**'s
sprite-binding helper when only depth-hosted Sprite2D layers exist. Either
way, the same UBO struct is bound — anchored sprites do not need a
viewProjection in the shader because anchor projection runs CPU-side.

**`SpriteLayerUBO`** (32 B) — `@group(1) @binding(2)`, identical to v26.
Holds per-layer `opacity` (animation-friendly, not in pipeline cache key).

**`Sprite3DSceneUBO`** — billboard-only. Allocated lazily by the first
billboard system added; lives in `sprite/billboard/sprite-3d-scene-ubo.ts`.
Pure-2D + anchored-only scenes never load it.

### Pipeline Cache

Per-device, lazy. Key tuple:

`(family, blendMode, depth, swapChainFormat, msaaSamples, pixelSnap, alphaCutoff*)`

- `family`: `"sprite-2d" | "billboard-facing" | "billboard-yaw" | "billboard-axis"`.
- `depth`: `"none" | "test" | "test-write"` — Sprite2D only; absent for billboards (which always use the Scene3DStage depth state).
- `pixelSnap`: bool — composer rewrites the snap line.
- `alphaCutoff`: bool — present only when `blendMode === "cutout"`.
- `opacity` is **not** in the key (per-layer UBO field, animatable).
- `flipX` / `flipY` are **not** in the key (per-sprite bits in the instance layout).

---

## Shader Logic

Composers (one per family / billboard variant) emit complete WGSL strings.
Five composers total: `composeSprite2D` (covers both pure-2D and anchored
layers — the WGSL is identical), `composeFacingBillboard`,
`composeYawLockedBillboard`, `composeAxisLockedBillboard`.

### Sprite2DLayer Vertex Shader (covers pure 2D AND anchored)

```wgsl
@group(0) @binding(0) var<uniform> scene: Sprite2DSceneUBO;
@group(1) @binding(2) var<uniform> layer: SpriteLayerUBO;

@vertex fn vs(in: VSIn) -> VSOut {
    let corner = cornerOf(in.vid);
    let localPx = (corner - in.pivot) * in.sizePx;
    let rotated = rotate2(localPx, in.sinCos);
    let layerPx = in.positionPx + rotated;
    let sc = vec2<f32>(sin(scene.viewRotation), cos(scene.viewRotation));
    let viewed = rotate2(layerPx - scene.viewPositionPx, sc) * scene.zoom;
    // PIXEL_SNAP: composer emits floor(viewed + 0.5) when pixelSnap is true.
    let snapped = viewed;
    let ndc = vec2<f32>(
         snapped.x * scene.invViewportPx.x * 2.0 - 1.0,
        1.0 - snapped.y * scene.invViewportPx.y * 2.0,
    );
    // For depth: "none" layers, z is ignored. For depth: "test" / "test-write",
    // layerZ ∈ [0,1] is mapped to NDC depth ∈ [1,0]. The CPU anchor sync writes
    // the projected NDC-z (with depthBias applied) into in.layerZ for anchored sprites.
    let z = 1.0 - clamp(in.layerZ, 0.0, 1.0);
    var out: VSOut;
    out.pos = vec4<f32>(ndc, z, 1.0);
    out.uv = cornerUV(corner, in.uvRect, in.flipX > 0.5, in.flipY > 0.5);
    out.color = in.color;
    return out;
}
```

Crucially: `in.positionPx` already carries the **projected** layer-space
pixel for anchored sprites, written by the CPU sync hook before this
frame's GPU upload. The shader has no idea whether the sprite is anchored.
There is no `if (anchored)`, no per-instance world-position field, and no
wasted bytes for non-anchored sprites.

### Billboard Vertex Shaders

Unchanged from v26 (Facing, YawLocked, AxisLocked). See
[26-sprites.md "Family 3 — Billboard Variants"](26-sprites.md).

### Shared Fragment Shader

Unchanged from v26. The layer / system UBO at `@group(1) @binding(2)`
exposes `.opacity` at offset 0 in both `SpriteLayerUBO` and
`AxisLockedBillboardSystemUBO`, so the same fragment WGSL is emitted for
every family.

---

## Sorting and Transparency

| Family / variant                      | Stage        | Queue                     | Sort key                                  | Blend     | Depth write |
| ------------------------------------- | ------------ | ------------------------- | ----------------------------------------- | --------- | ----------- |
| Sprite2DLayer `depth: "none"`         | OverlayStage | overlay (final pass)      | ascending `(order, layerZ, insertion)`    | per-blend | n/a         |
| Sprite2DLayer `depth: "test"` blended | Scene3DStage | transparent (210 + order) | back-to-front by layer centroid           | per-blend | off         |
| Sprite2DLayer `depth: "test"` cutout  | Scene3DStage | opaque (110 + order)      | front-to-back by layer centroid           | none      | off         |
| Sprite2DLayer `depth: "test-write"`   | Scene3DStage | opaque (110 + order)      | front-to-back by layer centroid           | none      | on          |
| Billboard blended                     | Scene3DStage | transparent (210 + order) | back-to-front by sprite view-Z (per-spr.) | per-blend | off         |
| Billboard cutout                      | Scene3DStage | opaque (110 + order)      | front-to-back by sprite view-Z (per-spr.) | none      | on          |

Depth-hosted Sprite2D layers do **not** sort sprites individually — their
layer-centroid view-Z (mean of `positionPx` un-projected via the camera, or
mean view-Z written by the anchor sync) is fed to the engine-wide
transparent sort, and within the layer sprites draw in `(layerZ,
insertion)` order. Billboards retain v26's per-sprite sort indirection
buffer.

---

## Picking

`pickSprite2D(scene, xPx, yPx)` walks both overlay and depth-hosted
Sprite2D layers in reverse `(order, layerZ, insertion)` and rotates the
screen point into each candidate sprite's pivot-aware local rectangle.
Anchored sprites are read at their already-projected `positionPx` — no
extra projection at pick time.

`pickBillboardSprite(scene, xPx, yPx)` is the v26 GPU pick-contributor
design (per-system contributor, 80 B pick UBO, per-(variant, isCutout)
pipeline cache, UV inverse-projection via `system._basisFn` at resolve
time). Unchanged.

The `PickContributor` interface and `picking-contributors.ts` registry
helper are also unchanged from v26.

---

## State Machine / Lifecycle

### Atlas + Layer Creation

```
loadSpriteAtlas(engine, url, opts) → SpriteAtlas

createSprite2DLayer(atlas, { depth })
  └─> { atlas, depth, capacity, _data (Float32Array), _animations,
        _anchored: null,                                      // sparse map; null until first anchor
        _addToScene: sprite2DAddToScene,                      // method-on-entity routing
        _deferredBuild,
        _version, _gpuVersion, _entityType: "sprite-2d-layer" }

createYawLockedBillboardSystem(atlas, opts)
  └─> { ..., _addToScene: yawBillboardAddToScene, ... }
```

### Routing on `addToScene`

```
addToScene(scene, layer)
  └─> layer._addToScene(scene)                                // method dispatch
      └─> sprite2DAddToScene(this, scene):
            const caps = ensureSprite2DCapability(scene);     // dynamic-imports sprite-2d-capability.ts
            if (this.depth === "none") {
                ensureOverlayStage(scene);                     // dynamic-imports overlay-stage.ts
                caps._overlayLayers.push(this);
            } else {
                const stage = ensureScene3DStage(scene);       // dynamic-imports scene-3d-stage.ts
                stage.state._depthHostedSpriteLayers.push(this);
            }
            scene._deferredBuilders.push(this._deferredBuild);
```

Pure-2D-only apps never call `ensureScene3DStage` and never load any `scene-3d-*`
module.

### Build (at `startEngine`)

Each `_deferredBuild` dynamic-imports `sprite-2d-renderable.ts`, builds the
pipeline (cache-keyed), allocates GPU buffers, creates bind groups, and
pushes the renderable into the right list (`caps._overlayLayers` for
overlay; `stage.state._opaqueRenderables` / `_transparentRenderables` for
depth-hosted). Identical pattern to v26, just routed via the stage owning
the layer.

### Per-Frame Render

```
1. Run scene._beforeRender hooks: clip ticks; anchor projection writes positionPx.
2. For each updater in scene3DStage?.state._uniformUpdaters || []: write camera basis / VP / etc.
3. For each stage in scene._stages (canonical order):
     stage.render(encoder, view, scene, deltaMs)
       OverlayStage:
         - Begin pass with no depth, MSAA=1, loadOp=stage._loadOp
         - For each Sprite2D layer in caps._overlayLayers (sorted by order):
             dirty-range writeBuffer; bind pipeline + groups; pass.draw(6, count)
         - End pass.
       Scene3DStage:
         - Run prepasses (shadow maps, etc.)
         - Begin opaque pass with MSAA + depth, loadOp=stage._loadOp
         - Draw _opaqueRenderables (meshes + cutout sprites + cutout billboards)
         - End opaque pass.
         - Begin transparent pass loading depth, loadOp=load
         - Re-sort _transparentRenderables by camera-distance once if camera moved
         - Draw _transparentRenderables (transparent meshes + blended sprites + blended billboards)
         - End transparent pass.
4. Submit command buffer.
```

No `if (is2D)` anywhere. Stage list determines what runs. Empty lists
inside a stage are a no-op cost equal to one `for` over zero entries.

### Disposal

`disposeScene(scene)` invokes every callback in `scene._disposables`,
including the per-renderable GPU buffer / bind group / pipeline cleanups,
the per-layer anchor hook removal, the OverlayStage's UBO disposal, and
the Scene3DStage's depth/MSAA target releases.

---

## Handles, Identity, and Parenting

Unchanged from v26 in shape, but anchored sprites get one new convenience.

The `Sprite2DHandle` field table keeps its v26 set (`position`, `sizePx`,
`pivot`, `scale`, `color`, `rotation`, `frame`, `visible`, `pickable`,
`layerZ`, `parent` for `IParentable2D`). Handle routing for anchored
sprites adds a single new optional field on the handle:

```typescript
export interface Sprite2DHandle {
    // ... v26 fields ...
    /** Optional world anchor. Setting this attaches the AnchorSource;
     *  setting null removes it. Setting it to a different AnchorSource
     *  swaps the projection target without recreating the handle. */
    anchor: AnchorSource | null;
}
```

The `anchor` setter delegates to `setSprite2DAnchor(layer, slot, src)` —
which is in `sprite-anchor.ts`, dynamic-imported on the first anchor
assignment. Handles never used as anchored sprites pay zero bytes for
anchor code.

`IWorldMatrixProvider` parenting (anchored sprite parented to a moving
mesh via `createParentAnchor(mesh)`) replaces the v26
`AnchoredSpriteHandle.parent` setter — the anchor itself encodes the
parent relationship, which keeps the handle's parenting story uniform with
3D-tracking handles.

`Sprite2D` 2D parenting (Spine-style child handles inheriting parent
rotation/scale through `Mat3`) is unchanged.

The walker modules (`sprite-2d-handle-walk.ts`, `sprite-billboard-handle-
walk.ts`) and the function-pointer hook on the layer
(`layer._parentedHandlesWalker`) are unchanged. Two-tier (Index / Handle)
API and tree-shake boundary unchanged.

---

## Babylon.js Equivalence Map

| Babylon.js                                        | Babylon Lite                                                          | Notes                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `SpriteManager` (2D usage)                        | `Sprite2DLayer` (any scene)                                           | No separate 2D scene type                                                         |
| `SpriteManager` (3D usage, world-sized)           | `*BillboardSpriteSystem`                                              | Always world-space, perspective-correct                                           |
| `SpritePackedManager`                             | `createNamedSpriteAtlas` + family factory                             | Atlas is a separate, reusable type                                                |
| `Sprite`                                          | `*Init` interfaces + per-family helpers                               | Functional, returns index or handle                                               |
| `sprite.cellIndex` / `cellRef`                    | `setSprite*Frame(layer, idx, frame)`                                  | `frame` is `number \| string`                                                     |
| `sprite.playAnimation(from, to, loop, delay, cb)` | `playSprite*Clip(layer, idx, clipName, loop)`                         | Named clips on the atlas                                                          |
| `sprite.invertU` / `invertV`                      | `init.flipX` / `init.flipY`                                           |                                                                                   |
| `sprite.angle`                                    | `init.rotation` (radians)                                             |                                                                                   |
| `sprite.position`                                 | `init.positionPx` (pure 2D) / `AnchorSource` for world-anchored       | Anchoring is opt-in via `addAnchoredSprite2D`; same layer                         |
| `sprite.size` / `width` / `height`                | `init.sizePx` (Sprite2D) / `init.sizeWorld` (Billboard)               | Type encodes pixel-space vs. world-space                                          |
| `sprite.color`                                    | `init.color` / `update*({ color: [r,g,b,a] })`                        | Per-sprite tint                                                                   |
| `mesh.billboardMode = BILLBOARDMODE_ALL`          | `createFacingBillboardSystem`                                         | Explicit factory                                                                  |
| `mesh.billboardMode = BILLBOARDMODE_Y`            | `createYawLockedBillboardSystem`                                      | Explicit factory                                                                  |
| `mesh.billboardMode = BILLBOARDMODE_X/Z`          | `createAxisLockedBillboardSystem(atlas, [1,0,0])`                     | One factory covers all axes                                                       |
| `SpriteManager.disableDepthWrite`                 | `Sprite2DLayer.depth` (`"test"` / `"test-write"`) + `SpriteBlendMode` | Composer-baked per layer                                                          |
| `AdvancedDynamicTexture` + `Image`                | `Sprite2DLayer` overlay on a 3D `SceneContext`                        | Different scope — no GUI tree                                                     |
| `scene.pickSprite(x, y)`                          | `pickSprite2D` / `pickBillboardSprite`                                | Two pickers, one per family                                                       |
| `SpriteMap` (tile maps)                           | Out of scope                                                          | Future module                                                                     |
| `SpriteManager` `epsilon` arg                     | _no equivalent_                                                       | Atlases must have transparent border / NPOT / padded sub-rects when bleed matters |
| Quad VBO                                          | Vertexless (`vertex_index`)                                           | Eliminates the static quad buffer                                                 |

### Anchored sizing — porting notes (unchanged from v26)

The CPU projection code in `sprite-anchor.ts` follows the same contract
v26's anchored vertex shader did: `clipPos.w = cz` (camera-space depth,
not 3D distance), screen-up = camera up. The v26 "common porting
pitfalls" guidance in [26-sprites.md "Anchored sizing — common porting
pitfalls"](26-sprites.md) carries over verbatim — it now applies to the
CPU projection helper rather than the GPU shader.

---

## Dependencies

Imports:

- `Texture2D`, `loadTexture2D` from `../texture/texture-2d.js`
- `EngineContext` from `../engine/engine.js`
- `SceneContext`, `SceneEntity`, `addToScene` from `../scene/scene-core.js`
- `Renderable`, `SceneUniformUpdater` from `../render/renderable.js` (type-only)
- `createPipelineCache` from `../material/pipeline-cache.js`

Lazy / dynamic-imported (never on the static graph of `sprite-2d.ts`):

- `ensureScene3DStage` from `../scene/scene-3d-stage.js` — pulled in by depth-hosted Sprite2D layers and by every billboard factory. The stage owns its own internal renderable lists, billboard systems, and shared 3D scene UBO.
- `ensureOverlayStage` from `../scene/overlay-stage.js` — pulled in by `depth: "none"` Sprite2D layers.
- `AnchorSource`, `addAnchoredSprite2D` from `../sprite/anchor/sprite-anchor.js` — pulled in only when the app uses anchored sprites.
- `Sprite3DSceneUBO` from `../sprite/billboard/sprite-3d-scene-ubo.js` — pulled in only by the first billboard system.
- `gpu-picker.ts`, `picking-contributors.ts`, `billboard-pick-contributor.ts`, `billboard-pick-pipeline.ts` — pulled in only when `pickBillboardSprite` is called.

Depended on by:

- `lab/src/lite/sceneN.ts` — sprite reference scenes (2D, mixed, anchored, billboard).
- Future Particles module — reuses `SpriteAtlas`, `SpriteClip`, vertexless-quad pattern, and packed-instance-buffer helpers.

NOT depended on:

- PBR / Standard / Background materials, ShaderComposer, Mesh, Skeleton, Morph, Shadow modules — sprites use standalone WGSL with no fragment composition.

---

## Test Specification

### Unit (vitest)

Mostly the v26 set; differences called out:

- `sprite-atlas.test.ts` — unchanged.
- `sprite-animation.test.ts` — unchanged.
- `sprite-pack.test.ts` — capacity grow, swap-remove, dirty-range bounds. **One test deleted**: the v26 test for the 112 B anchored stride is gone — there is only one Sprite2D stride now (80 B).
- `sprite-2d-projection.test.ts` — pixel (0,0) → top-left NDC; pan + zoom + rotation correctness. Same as v26.
- `sprite-anchor-projection.test.ts` — **NEW**. Replaces v26's `sprite-anchored-projection.test.ts`. Asserts that a static `createWorldAnchor([wx,wy,wz])` on a `Sprite2DLayer { depth: "test" }` produces the exact pixel position the v26 GPU vertex shader produced (golden test against the v26 anchored shader's CPU-equivalent maths).
- `sprite-anchor-hook.test.ts` — **NEW**. Verifies the per-frame projection hook is installed exactly once per layer, runs before user `onBeforeRender` callbacks, and drops to a no-op when the anchored map empties.
- `sprite-billboard-basis.test.ts` — unchanged.
- `sprite-sort.test.ts` — billboard-only now (Sprite2D no longer participates in per-sprite sort indirection).
- `sprite-pick-2d.test.ts` — covers both overlay and depth-hosted layers. Anchored hit-test uses already-projected `positionPx`.
- `sprite-pick-billboard-uv.test.ts` — unchanged.
- `pick-contributor-registry.test.ts` — unchanged.
- `mat3.test.ts` — unchanged.
- `sprite-handle-stable-id.test.ts` — unchanged.
- `sprite-handle-observable-write.test.ts` — unchanged.
- `sprite-handle-parent-2d.test.ts` — unchanged.
- `sprite-handle-anchor.test.ts` — **NEW**. `handle.anchor = createWorldAnchor([…])` lazy-imports `sprite-anchor.ts` and installs the projection.
- `scene-routing.test.ts` — **NEW**. `addToScene(scene, layer)` calls `layer._addToScene(scene)` exactly once and the scene-core has zero static reference to `Sprite2DLayer`'s symbol (verified by source-map / dependency-graph inspection).
- `scene-stages-canonical-order.test.ts` — **NEW**. Adding a HUD layer first, then a mesh, results in `[Scene3DStage, OverlayStage]` after `startEngine` regardless of registration order.

### Visualization (Playwright)

Existing scene families port across (the goldens are pixel-equivalent
because the projection math is the same):

- **Scene NN-sprites-2d** — pure `Sprite2DLayer` in a no-camera scene.
- **Scene NN-sprites-overlay** — `Sprite2DLayer` HUD over a 3D PBR scene.
- **Scene NN-sprites-anchored** — `Sprite2DLayer { depth: "test" }` with `createWorldAnchor` labels pinned to mesh anchors. Identical golden to v26's anchored scene.
- **Scene NN-sprites-billboard-yaw** — unchanged.
- **Scene NN-sprites-billboard-facing** — unchanged.
- **Scene NN-sprites-cutout-vs-blend** — unchanged.
- **Scene NN-sprites-animated** — unchanged.
- **Scene NN-sprites-mixed-stages** — **NEW**. One scene with depth-hosted anchored labels behind 3D occluders AND an overlay HUD on top — verifies the canonical stage order and the swap-chain clear/load handshake.

### Bundle Size Ceilings

The v26 ratchets are reorganized:

- **NEW: pure-2D ceiling.** A scene that imports only `createSceneContext`, `addToScene`, `startEngine`, `loadSpriteAtlas`, `createSprite2DLayer`, `addSprite2D` must NOT fetch any of: `scene-3d-stage.js`, `sprite-anchor.js`, `sprite-3d-scene-ubo.js`, `sprite-billboard-*.js`, `camera/*`, `light/*`, `mesh/*`, `shadow/*`, `material/pbr/*`, `material/standard/*`, `picking/*`. The optional 3D fields on `SceneContext` (`camera?`, `lights?`, `meshes?`, …) are `import type` only — the corresponding runtime classes must NOT appear in the bundle. This is the single most important new ceiling — it exists to defend the lead's directive.
- **PRESERVED: anchored-only-no-billboard ceiling.** A scene with depth-hosted Sprite2D layers but no billboards must NOT fetch `sprite-3d-scene-ubo.js`, billboard renderables, or the GPU picker.
- **PRESERVED: each billboard variant ceiling** — each variant must NOT include the other two.
- **PRESERVED: mesh-only no-sprite ceiling** — must NOT fetch `sprite-2d.js`, `overlay-stage.js`, `picking-contributors.js` body.
- **REMOVED: the v26 "AnchoredSpriteLayer separate from Sprite2DLayer" ceiling** — that family no longer exists.

---

## File Manifest

```
packages/babylon-lite/src/

  scene/
    scene-core.ts                                # SceneContext (incl. optional 3D fields, type-only) + addToScene + startEngine + onBeforeRender + disposeScene + RenderStage type
    scene-3d-stage.ts                            # Scene3DStage + Scene3DStageState + ensureScene3DStage (lazy; verbatim port of v26 3D render loop; owns its own internal renderable / billboard / sprite3DSceneUBO state)
    overlay-stage.ts                             # OverlayStage + ensureOverlayStage + Sprite2DSceneUBO updater
    render-stage.ts                              # RenderStage interface + canonicalizeStages

  sprite/
    shared/
      sprite-atlas.ts                            # SpriteAtlas, createGrid/Named/loadSpriteAtlas, resolveSpriteFrame
      sprite-animation.ts                        # SpriteClipState, evaluate/advanceSpriteClip
      sprite-gpu.ts                              # CPU→GPU dirty-range writeBuffer, capacity grow (dynamic-imported)
      sprite-pack-2d.ts                          # 80-byte pack helper for Sprite2DLayer
      sprite-pack-billboard.ts                   # 96-byte pack helper for billboards
      sprite-3d-instance-wgsl.ts                 # Shared SPRITE_3D_DATA_WGSL + SPRITE_3D_VS_IN_WGSL helpers (billboards only)
      sprite-billboard-handle-walk.ts            # walkParentedBillboardHandles

    sprite-2d.ts                                 # createSprite2DLayer + Index API (no anchor code; foundation only)
    sprite-2d-handle.ts                          # Sprite2DHandle + addSprite2D / removeSprite2D (Handle API)
    sprite-2d-handle-walk.ts                     # walkParentedSprite2DHandles
    sprite-2d-renderable.ts                     # Renderable builder for Sprite2DLayer (dynamic-imported)
    sprite-2d-shader.ts                         # composeSprite2D WGSL emitter (covers pure 2D AND anchored)
    sprite-2d-capability.ts                      # Sprite2DState + ensureSprite2DCapability

    anchor/
      sprite-anchor.ts                           # AnchorSource + createWorldAnchor + createParentAnchor + addAnchoredSprite2D + setSprite2DAnchor + per-frame projection hook

    billboard/
      sprite-billboard-shared.ts                 # BillboardSpriteSystem common helpers + Index API
      sprite-billboard-handle.ts                 # BillboardSpriteHandle + addBillboardSprite / removeBillboardSprite
      sprite-billboard-facing.ts                 # createFacingBillboardSystem
      sprite-billboard-facing-renderable.ts
      sprite-billboard-facing-shader.ts
      sprite-billboard-yaw.ts                    # createYawLockedBillboardSystem
      sprite-billboard-yaw-renderable.ts
      sprite-billboard-yaw-shader.ts
      sprite-billboard-axis.ts                   # createAxisLockedBillboardSystem
      sprite-billboard-axis-renderable.ts
      sprite-billboard-axis-shader.ts
      sprite-3d-scene-ubo.ts                     # Sprite3DSceneUBO + updater (lazy; first billboard allocates)

    picking/
      pick-sprite-2d.ts                          # pickSprite2D — covers both overlay and depth-hosted layers
      pick-billboard.ts                          # pickBillboardSprite — dynamic-imports gpu-picker.ts
      billboard-pick-contributor.ts              # PickContributor implementation
      billboard-pick-pipeline.ts                 # Per-(variant, isCutout) pick pipeline cache

  picking/
    picking-contributors.ts                      # Generic PickContributor interface + getOrCreatePickContributors / getPickContributors
```

### Files removed vs v26

```
packages/babylon-lite/src/
  scene2d/                                       # ENTIRE FOLDER REMOVED
    scene2d.ts
    scene2d-render-loop.ts
    scene2d-camera-ubo.ts

  sprite/
    sprite-anchored.ts                           # REMOVED (collapsed into sprite-2d.ts + anchor/)
    sprite-anchored-handle.ts                    # REMOVED (Sprite2DHandle now carries `anchor: AnchorSource | null`)
    sprite-anchored-handle-walk.ts               # REMOVED
    sprite-anchored-renderable.ts                # REMOVED (sprite-2d-renderable.ts handles depth: "test"/"test-write")
    sprite-anchored-shader.ts                    # REMOVED
    picking/pick-2d.ts                           # RENAMED → pick-sprite-2d.ts (now covers both layer kinds)
    picking/pick-anchored.ts                     # REMOVED (folded into pick-sprite-2d.ts)
```

### Files added vs v26

```
packages/babylon-lite/src/
  scene/
    scene-3d-stage.ts                            # 3D render stage (extracted from v26 startEngine; owns internal Scene3DStageState)
    overlay-stage.ts                             # 2D render stage
    render-stage.ts                              # RenderStage interface + canonicalizer

  sprite/
    sprite-2d-capability.ts                      # Sprite2DState slot + ensureSprite2DCapability
    anchor/sprite-anchor.ts                      # AnchorSource + createWorldAnchor + createParentAnchor + addAnchoredSprite2D
```

### Public-API additions to `packages/babylon-lite/src/index.ts`

```typescript
// ─── Scene (UNIFIED) ─────────────────────────────────────────────────
export { createSceneContext, addToScene, removeFromScene, onBeforeRender, disposeScene, startEngine } from "./scene/scene-core.js";
export type { SceneContext, SceneOptions, SceneEntity, ImageProcessingConfig } from "./scene/scene-core.js";

// 3D fields (camera, lights, meshes, animationGroups, fog, shadowGenerators,
// imageProcessing) are plain optional fields on SceneContext — read and write
// them directly: `scene.camera = cam`, `scene.lights?.push(light)`, etc.
// They are typed via `import type`, so a pure-2D bundle never fetches the
// underlying runtime classes.

// ─── Sprites ─────────────────────────────────────────────────────────
export { loadSpriteAtlas, createGridSpriteAtlas, createNamedSpriteAtlas, resolveSpriteFrame } from "./sprite/shared/sprite-atlas.js";
export { createSpriteClipState } from "./sprite/shared/sprite-animation.js";
export type { SpriteAtlas, SpriteFrame, SpriteClip, SpriteSampling, SpriteBlendMode, SpriteFrameRef, SpriteClipState } from "./sprite/shared/sprite-atlas.js";

export { createSprite2DLayer, addSprite2D, removeSprite2D, updateSprite2D, setSprite2DFrame, playSprite2DClip, stopSprite2DClip } from "./sprite/sprite-2d.js";
export { addSprite2DIndex, updateSprite2DIndex, removeSprite2DIndex, setSprite2DFrameIndex, playSprite2DClipIndex, stopSprite2DClipIndex } from "./sprite/sprite-2d.js";
export type { Sprite2DLayer, Sprite2DLayerOptions, Sprite2DInit, Sprite2DView, Sprite2DDepthMode } from "./sprite/sprite-2d.js";
export type { Sprite2DHandle } from "./sprite/sprite-2d-handle.js";

// Anchoring — separate import path; tree-shaken if unused.
export { createWorldAnchor, createParentAnchor, addAnchoredSprite2D, setSprite2DAnchor } from "./sprite/anchor/sprite-anchor.js";
export type { AnchorSource, AnchoredSprite2DInit } from "./sprite/anchor/sprite-anchor.js";

// Billboards.
export { createFacingBillboardSystem } from "./sprite/billboard/sprite-billboard-facing.js";
export { createYawLockedBillboardSystem } from "./sprite/billboard/sprite-billboard-yaw.js";
export { createAxisLockedBillboardSystem } from "./sprite/billboard/sprite-billboard-axis.js";
export {
    addBillboardSprite,
    updateBillboardSprite,
    removeBillboardSprite,
    setBillboardSpriteFrame,
    playBillboardSpriteClip,
    stopBillboardSpriteClip,
} from "./sprite/billboard/sprite-billboard-shared.js";
export type { BillboardSpriteSystem, BillboardSpriteSystemOptions, BillboardSpriteInit } from "./sprite/billboard/sprite-billboard-shared.js";

// Picking.
export { pickSprite2D } from "./sprite/picking/pick-sprite-2d.js";
export { pickBillboardSprite } from "./sprite/picking/pick-billboard.js";
export type { SpritePickInfo } from "./sprite/picking/pick-sprite-2d.js";
```

---

## Summary of changes vs 26-sprites.md

| Concern                    | v26                                                                            | v27                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scene types                | `SceneContext` (3D) + `Scene2DContext` (2D) — parallel                         | `SceneContext` only; 3D state as plain optional fields (`camera?`, `lights?`, …) typed via `import type`                                                                    |
| Engine entry points        | `startEngine` + `startEngine2D`                                                | `startEngine` only                                                                                                                                                          |
| `addToScene`               | `addToScene` (3D) + `addToScene2D` (2D)                                        | `addToScene` only; method-on-entity routing                                                                                                                                 |
| Sprite families            | 3 (`Sprite2DLayer`, `AnchoredSpriteLayer`, `*BillboardSpriteSystem`)           | 2 (`Sprite2DLayer`, `*BillboardSpriteSystem`)                                                                                                                               |
| Anchored sprites           | Separate family with own WGSL, 112 B stride, GPU vertex projection             | `Sprite2DLayer` + opt-in `AnchorSource`; CPU-projected each frame; same WGSL, same 80 B stride                                                                              |
| Sprite vertex shaders      | 5 (`composeSprite2D`, `composeAnchoredSprite`, 3 billboard composers)          | 4 (`composeSprite2D`, 3 billboard composers)                                                                                                                                |
| Render stages              | Implicit, two render-loop functions                                            | Explicit `RenderStage[]` (`OverlayStage`, `Scene3DStage`), canonicalized once at `startEngine`, stage-iteration hot loop                                                    |
| Pure-2D bundle ceiling     | "no anchored / no billboard" — but still loaded `SceneContext` 3D type symbols | "no `Camera`, no `Mesh`, no `Light`, no `Scene3DStage`, no anchor, no billboard" runtime classes — verified by ratchet (3D fields on `SceneContext` are `import type` only) |
| `Sprite3DSceneUBO`         | Shared by anchored + billboard                                                 | Billboard-only; lazy-allocated by first billboard system                                                                                                                    |
| Per-frame branch on `is2D` | Implicit (different `startEngine`)                                             | None — single `startEngine`, single stage loop, no branch                                                                                                                   |

---

## Confidence notes

- The CPU-projection-for-anchors choice is the design's primary lever. It
  trades a few microseconds of CPU per frame (in the realistic anchored-
  sprite-count regime) for a much smaller surface area: one Sprite2D
  WGSL composer, one stride, one packed-buffer upload path, no
  `anchorMode` pipeline-cache key. If a future workload genuinely needs
  10 000+ anchored sprites, a GPU-projection variant can be added without
  changing the public API (a `projectOnGpu: boolean` option on the
  layer; the composer would emit a second WGSL specialization). It would
  not be a separate family.

- The method-on-entity routing makes "scene-core stays free of entity
  imports" a structural property of the design rather than a coding
  convention. Every regression of pay-for-use becomes a build-failing
  bundle-size ratchet rather than a code-review judgement call.

- Stage canonicalization runs once at `startEngine`, so registration
  order is irrelevant. This avoids the most likely user-error class
  ("HUD added before mesh, mesh draws over HUD").
