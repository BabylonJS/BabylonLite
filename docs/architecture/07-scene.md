# Module: Scene

> Package path: `packages/babylon-lite/src/scene/scene.ts`

## Purpose

The Scene module defines `SceneContext` — the central, flat data container
for all per-scene state. It follows a strict one-way ownership model: the
scene holds references to engine, camera, lights, and meshes, but none of
those reference the scene back. The scene is material-agnostic — it routes
mesh registration to material-owned `_buildGroup` builders and never branches
on material type.

The scene also **owns its frame graph**. `createSceneContext` constructs a
default `_frameGraph` containing one main render-pass task that targets the
swapchain (MSAA + depth). Multi-pass authoring (RTTs, shadow caster passes,
post-processing) is done by adding more tasks to that graph.

## Public API Surface

```typescript
/** Image processing configuration. */
export interface ImageProcessingConfig {
    exposure: number;
    contrast: number;
    toneMappingEnabled: boolean;
    /** "standard" (BJS TONEMAPPING_STANDARD, default) or "aces" (BJS TONEMAPPING_ACES). */
    toneMappingType?: "standard" | "aces";
}

/** Top-level scene context — pure state, no attached methods. */
export interface SceneContext {
    readonly engine: EngineContext;
    /** Render-pass clear color. Backed by a stable object — assignments mutate it
     *  in place so any task holding a reference (e.g. the main render-pass task)
     *  observes the change without needing rebinding. */
    clearColor: GPUColorDict;
    camera: Camera | null;
    lights: LightBase[];
    imageProcessing: ImageProcessingConfig;
    meshes: Mesh[];
    animationGroups: AnimationGroup[];
    fog: FogConfig | null;
    shadowGenerators: ShadowGenerator[];
    environmentPrimaryColor?: [number, number, number];
    envRotationY?: number;
    /** Fixed delta time (ms) for deterministic animation. 0 = use real rAF delta. */
    fixedDeltaMs: number;
}

/** Create an empty scene bound to an engine; also creates `_frameGraph` with the
 *  default main render-pass task targeting the swapchain. */
export function createSceneContext(engine: EngineContext): SceneContext;

/** Add a mesh / light / camera / transform-node / shadow generator / asset container. */
export function addToScene(scene: SceneContext, entity: Mesh | LightBase | Camera | TransformNode | ShadowGenerator | AssetContainer): void;

/** Register a per-frame user callback `(deltaMs) => void` (animation, physics, …). */
export function onBeforeRender(scene: SceneContext, cb: (deltaMs: number) => void): void;

/** Release all GPU resources owned by this scene. */
export function disposeScene(scene: SceneContext): void;

/** Auto-frame an ArcRotateCamera around currently registered meshes. */
export function createDefaultCamera(scene: SceneContext): ArcRotateCamera;

/** Return the scene's frame graph (for multi-pass authoring). */
export function getFrameGraph(scene: SceneContext): FrameGraph;

/** Remove a mesh / light / shadow generator and dispose its associated resources. */
export function removeFromScene(scene: SceneContext, entity: Mesh | LightBase | ShadowGenerator): void;
```

## Internal architecture

### Default state (from `createSceneContext`)

| Field | Default |
|---|---|
| `clearColor` | `{ r: 0.2, g: 0.2, b: 0.3, a: 1.0 }` (stable object, in-place mutation) |
| `camera` | `null` (set by `createDefaultCamera` or via loader) |
| `lights` / `meshes` / `animationGroups` / `shadowGenerators` | `[]` |
| `fog` | `null` |
| `imageProcessing` | `{ exposure: 1, contrast: 1, toneMappingEnabled: false }` |
| `fixedDeltaMs` | `0` |
| `_frameGraph` | created with one `RenderPassTask("main")` targeting the swapchain |

The main render target is created once via `createRenderTarget({ size: "canvas",
colorFormat: engine.format, depthStencilFormat: "depth24plus-stencil8",
sampleCount: engine.msaaSamples, resolveToSwapchain: true })`. The main task
has `autoFromScene = true`, so its draw list mirrors `scene._renderables` at
record time when its own list is empty.

### Hidden state (`SceneContextInternal`)

```typescript
interface SceneContextInternal extends SceneContext {
    _prePasses: PrePassRenderable[];
    _fixedDeltaMs: number;

    // Per-frame hooks
    _beforeRender: ((deltaMs: number) => void)[];   // user-facing
    _perFrameCallbacks: (() => void)[];             // engine-internal (lights UBO, group GPU updates)

    // Renderables and builders
    _renderables: Renderable[];                     // scene-level draw list (mirrored by autoFromScene tasks)
    _builders: (() => void | Promise<void>)[];      // multi-round async builder queue
    _groups: Map<MeshGroupBuilder, Mesh[]>;         // bucketed meshes per material builder

    // Disposables
    _disposables: (() => void)[];
    _meshDisposables: Map<Mesh, (() => void)[]>;
    _materialSwapQueue: Mesh[];

    // Caches
    _meshRenderable: WeakMap<Mesh, Map<unknown, Renderable>>;  // (mesh, material) → Renderable

    _disposed: boolean;
    _skybox?: SkyboxData;
    _envTextures?: EnvironmentTextures;
    _irradianceSH?: Float32Array;

    /** Optional hook between pre-passes and the main pass — installed by the lazy
     *  refraction module so transmissive materials can build the opaque-scene RTT. */
    _beforeMain?: (engine, scene, encoder) => GPUCommandEncoder;

    _frameGraph: FrameGraph;
}
```

### One-way ownership

```
EngineContext  ←  SceneContext  →  Camera
                              →  Lights[]
                              →  Meshes[]
                              →  AnimationGroups[]
                              →  ShadowGenerators[]
                              →  _frameGraph (owns RenderPassTasks + RenderTargets)
                              →  _renderables[]
                              →  _prePasses[]
                              →  _beforeRender[] / _perFrameCallbacks[]
                              →  _builders[]
```

Children never reference the scene back.

### `addToScene()` — entity routing

Routing is by structural duck-typing:

1. **AssetContainer** (`'entities' in entity`) — recurses into each entity,
   then absorbs the container's `clearColor`, default `camera`, and
   `animationGroups` (which are ticked from `_beforeRender`).
2. **Mesh** (`'_gpu' in entity && 'material' in entity`):
   - Pushed onto `meshes`.
   - `installMaterialSetter` replaces the `material` property with a
     get/set pair that sets `_materialDirty` and pushes the mesh into
     `_materialSwapQueue` on assignment.
   - The mesh's `material._buildGroup` is bucketed in `_groups` (keyed by
     builder identity). The first time a builder sees a mesh, a deferred
     builder is registered via `addDeferredBuilder` to call
     `build(scene, group)` and append `result.renderables` /
     `result.update` to the scene.
3. **Light** (`'lightType' in entity`) — pushed onto `lights`.
4. Then recursion into `entity.children` with parent links wired up.

The scene **never** branches on material type. PBR vs Standard is determined
entirely by which `_buildGroup` is on `mesh.material`.

### `clearColor` is mutated in place

`scene.clearColor = X` does **not** replace the underlying object — the setter
copies `r/g/b/a` into a stable backing object. Tasks that captured the
reference (e.g. the main render-pass task at scene creation) therefore see
user updates without re-binding. The frame graph's `build()` also re-points
`_mainTask.clearColor` at this stable object on every rebuild.

### Builders, mesh-renderable cache, and material swap

#### Multi-round builder queue (`_builders`)

`addDeferredBuilder(scene, fn)` pushes onto `scene._builders`.
`drainSceneBuilders` runs all queued builders to completion, then loops
again if any builder pushed more — supporting "trampoline" ordering. This is
how multi-pass APIs like `addToPass` defer per-pass renderable creation
until *after* the batched material builders have installed their per-scene
contexts (e.g. `_pbrCtxByScene`, `_stdCtxByScene`).

The engine drains builders at the top of every `renderFrame` (see
[06-engine.md](./06-engine.md)).

#### `(mesh, material)` Renderable cache

`getOrBuildMeshRenderable(scene, mesh, material, factory)` returns a cached
`Renderable` for a `(mesh, material)` pair, building it via `factory` on
first miss. Same mesh + same material across N passes → one Renderable
(one mesh UBO + one material UBO/BG). Material override on a per-pass basis
→ a distinct Renderable. Evicted on material swap (`processMaterialSwaps`)
and on `removeFromScene` / `disposeScene`.

#### `processMaterialSwaps`

Drains `_materialSwapQueue` once per frame (called by the engine just before
`_perFrameCallbacks`). For each queued mesh:

- **Fast path** — if `_meshRenderable[mesh]` already contains an entry for
  the *current* material (because `drainSceneBuilders` built it directly for
  the new material before the swap was processed), nothing to do.
- **Slow path** — evict the old renderable from `_renderables` and from
  every render-pass task (`removeMeshFromTask`), run any per-mesh disposers,
  then call `material._buildGroup._rebuildSingle` if available to produce a
  fresh `Renderable` and re-insert it.

### `_beforeRender` vs `_perFrameCallbacks`

Two distinct queues with strict ordering:

| Queue | Audience | Signature | When |
|---|---|---|---|
| `_beforeRender` | user code (animation, physics, camera control) | `(deltaMs) => void` | engine.renderFrame, **before** material swap drain |
| `_perFrameCallbacks` | engine-internal (lights UBO refresh, mesh-group GPU update) | `() => void` | engine.renderFrame, **after** swaps |

This ordering matters: user code may move/rotate meshes or change lights, and
the internal callbacks must observe those mutations before the GPU sees the
draw.

### Auto-framing camera (`createDefaultCamera`)

1. Compute world AABB across `scene.meshes` from each `mesh.boundMin` / `boundMax`.
2. `radius = diag * 1.5` where `diag = √(sx² + sy² + sz²)`. If 0 / non-finite,
   fall back to `radius = 1`, `center = (0, 0, 0)`.
3. Build an ArcRotateCamera at `alpha = -π/2`, `beta = π/2`, looking at
   `center`, with `minZ = radius * 0.01`, `maxZ = radius * 1000`.
4. Assign `scene.camera = cam`.

## Babylon.js equivalence

| Babylon Lite | Babylon.js |
|---|---|
| `createSceneContext(engine)` | `new BABYLON.Scene(engine)` |
| `scene.clearColor` (in-place mutation) | `scene.clearColor` (Color4 instance, also mutated) |
| `scene.camera` | `scene.activeCamera` |
| `addToScene(scene, entity)` | `scene.addMesh()` / `scene.addLight()` / `scene.addCamera()` |
| `onBeforeRender(scene, cb)` | `scene.onBeforeRenderObservable.add(cb)` |
| `scene._frameGraph` | `scene.frameGraph` (when used) or implicit render manager |
| `scene._renderables` (mirrored by `autoFromScene` tasks) | `scene._renderingManager._renderingGroups` |
| `scene._builders` (multi-round) | `scene._prepareFrame()` lazy compilation |
| `scene._materialSwapQueue` | `scene._markAllMaterialsAsDirty` propagation |
| `getFrameGraph(scene)` | `scene.frameGraph` accessor |
| `createDefaultCamera(scene)` | `scene.createDefaultCameraOrLight(true, true, true)` |

## Dependencies

- **Imports**: `EngineContext` (type), `Camera` (type), `LightBase` (type),
  `Mesh`, `disposeMeshGpu`, `AnimationGroup`/`ShadowGenerator`/`FogConfig`/
  `Renderable`/`MeshGroupBuilder`/`AssetContainer` (types), and
  `frame-graph/frame-graph` + `frame-graph/render-pass-task` to construct
  the default graph.
- **Depended on by**: `engine.ts`, all material builders, all loaders.

## Test specification

| Test | Description |
|---|---|
| `createSceneContext defaults` | Verify all field defaults; `_frameGraph` has one main task |
| `addToScene routes mesh` | `meshes` updated, `_buildGroup` bucketed, deferred builder registered |
| `addToScene routes light` | `lights` updated |
| `addToScene routes asset container` | recurses into entities, absorbs clearColor/camera/animationGroups |
| `addToScene deduplicates builders` | two meshes with same builder → one deferred builder |
| `clearColor mutates in place` | `scene.clearColor = {…}` keeps the same object reference (task sees update) |
| `drainSceneBuilders multi-round` | builder pushes another builder → both run before drain returns |
| `processMaterialSwaps fast path` | renderable already exists for new material → no rebuild |
| `processMaterialSwaps slow path` | swap → evict + rebuild via `_rebuildSingle` |
| `getOrBuildMeshRenderable` | same (mesh, material) returns cached; different material → new |
| `createDefaultCamera with meshes` | `radius = diag * 1.5`, camera at correct alpha/beta |
| `createDefaultCamera empty scene` | `radius = 1`, `center = (0, 0, 0)` |

## File manifest

| File | Purpose |
|---|---|
| `src/scene/scene.ts` | Public re-exports |
| `src/scene/scene-core.ts` | `SceneContext`, factory, `addToScene`, builders, swap queue, mesh-renderable cache |
| `src/scene/scene-camera.ts` | `createDefaultCamera` |
| `src/scene/scene-remove.ts` | `removeFromScene` |
| `src/scene/scene-ubo.ts` | `writePassSceneUBO` (camera + Y-flip + canvas-aspect projection for offscreen RTTs) |
| `src/scene/scene-node.ts`, `parentable.ts`, `set-parent.ts`, `transform-node.ts`, `world-matrix-state.ts` | Transform-graph plumbing |
