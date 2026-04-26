# Module: Renderable Architecture

> Package path: `packages/babylon-lite/src/render/renderable.ts`

## Purpose

The Renderable module defines the universal draw contract that decouples the
frame graph from all material/entity knowledge. Render-pass tasks iterate
opaque `Renderable` / `DrawBinding` / `PrePassRenderable` / `MeshGroupBuilder`
interfaces — they never import materials, shaders, or pipeline-specific code.
This is the foundation of Babylon Lite's tree-shakability and of multi-pass
authoring (the same `Renderable` can be `bind()`-ed into several passes
producing distinct `DrawBinding`s).

## Public API Surface

```typescript
/** Signature of a render target's attachment set — enough to key a GPURenderPipeline. */
export interface RenderTargetSignature {
    readonly colorFormat: GPUTextureFormat;
    readonly depthStencilFormat?: GPUTextureFormat;
    readonly sampleCount: number;
    /** When true, the projection matrix's Y is flipped (offscreen RTT — see
     *  writePassSceneUBO). Pipelines must invert frontFace to keep back-face
     *  culling correct. */
    readonly flipY?: boolean;
}

/** A drawable scene entity. One Renderable == one logical draw unit
 *  (typically one mesh). Resource sharing (scene UBOs, light UBOs, sceneBG)
 *  is handled at scene/pass level — never by grouping multiple meshes. */
export interface Renderable {
    /** Sort key (lower = drawn first). Skybox=0, opaque=100, transmissive=140, transparent=200. */
    readonly order: number;
    readonly isTransparent: boolean;
    readonly isTransmissive?: boolean;
    /** Source mesh — used by `removeMeshFromTask` to evict on remove / material swap.
     *  Scene-level renderables (skyboxes, backgrounds) omit it. */
    readonly mesh?: Mesh;
    /** Resolve target-specific GPU state (pipeline, sceneBG) and return a
     *  `DrawBinding` whose `draw` closure captures that state. Called by the
     *  render-pass task at build/insert time — once per (renderable, target). */
    bind(engine: EngineContext, target: RenderTargetSignature): DrawBinding;
}

/** Per-pass draw binding produced by `Renderable.bind(engine, target)`. */
export interface DrawBinding {
    readonly renderable: Renderable;
    /** Pipeline used by this binding — exposed so `drawList` can dedup setPipeline calls. */
    readonly pipeline: GPURenderPipeline;
    /** Optional shadow bind group (group 2) — exposed so `drawList` can dedup setBindGroup(2)
     *  calls (usually identical across all draws sharing the same shadowBGL). */
    readonly shadowBG?: GPUBindGroup;
    /** Issue draw commands. Caller has already set pipeline (if changed) and shadowBG (if changed).
     *  The closure handles group(1) [material/mesh BG], vertex/index buffers, drawIndexed.
     *  Returns the number of GPU draw calls. */
    draw(pass: GPURenderPassEncoder | GPURenderBundleEncoder, engine: EngineContext): number;
    /** Update dirty UBOs (world matrix, material UBO) before draw. Called once per binding per
     *  frame. Per-mesh state shared across bindings should be version-guarded to avoid
     *  redundant writes. */
    updateUBOs?(): void;
    /** Scratch slot used by sortTransparents to cache squared distance from camera. */
    _sortDistance?: number;
}

/** Pre-pass entity (shadow depth map, etc.). */
export interface PrePassRenderable {
    /** Returns the number of GPU draw calls issued. */
    execute(encoder: GPUCommandEncoder, engine: EngineContext): number;
}

/** Build result from a mesh group builder. */
export interface MeshGroupBuildResult {
    renderables: Renderable[];
    /** Per-frame callback for refreshing shared GPU buffers (e.g. multi-light UBOs)
     *  not owned by individual renderables. Registered onto `_perFrameCallbacks`. */
    update: () => void;
}

/** A function that builds renderables for a mesh group sharing one material type. */
export type MeshGroupBuilder = (scene: SceneContext, meshes: Mesh[]) => Promise<MeshGroupBuildResult>;
```

## Design principles

### Two-phase contract: `bind()` then `draw()`

`Renderable.bind(engine, target)` is the **slow path**, called once per
`(renderable, target)` when a render-pass task wires up its draw list. It
resolves all target-specific GPU state — looks up or creates the pipeline
keyed by `RenderTargetSignature`, captures `sceneBG` / `materialBG` / mesh
GPU buffers — and returns a `DrawBinding` whose `draw()` closure simply
records the state-setting and `drawIndexed` calls.

`DrawBinding.draw(pass)` is the **fast path**, called once per frame per
binding. It only does the per-draw `setBindGroup(1)` / `setVertexBuffer` /
`setIndexBuffer` / `drawIndexed`. The render pass binds group(0) (sceneBG)
once at the top of the pass; `drawList` dedups `setPipeline` and the
optional `setBindGroup(2)` (shadow BG) across consecutive bindings.

The same `Renderable` can be `bind()`-ed into multiple passes — the main
pass, an offscreen RTT, a shadow caster pass — each producing its own
`DrawBinding` with the right pipeline for that target's signature.

### `RenderTargetSignature.flipY`

Offscreen RTTs (`resolveToSwapchain = false`) use a Y-flipped projection
matrix in `writePassSceneUBO` so their texel-(0,0) corner matches the
swapchain orientation when the result is sampled by another pass. To keep
back-face culling correct under the flipped Y, pipelines created for these
targets must use `frontFace: "cw"` instead of `"ccw"`. The `flipY` flag is
part of the pipeline cache key, so swapchain pipelines and offscreen
pipelines never collide.

PBR (`material/pbr/pbr-pipeline.ts`) and Standard
(`material/standard/standard-pipeline.ts`) implement this as
`frontFace: target.flipY ? "cw" : "ccw"`.

### Entity-owned pipelines — the `_buildGroup` pattern

Each material module exports a `MeshGroupBuilder`. Materials carry a
`_buildGroup: MeshGroupBuilder` reference on their props, so the scene
never branches on material type:

| Module | Builder |
|---|---|
| `material/standard/standard-material.ts` | `standardGroupBuilder` |
| `material/pbr/pbr-material.ts` | `pbrGroupBuilder` |
| `loader-skybox/load-skybox.ts` (cubemap) | scene-level renderable |
| Background (env / HDR / DDS) | `buildBackgroundRenderables` |
| Shadows | `shadow-renderable.ts` → `PrePassRenderable` |

`addToScene` reads `mesh.material._buildGroup` and groups meshes by builder
identity. One deferred builder is registered per unique builder — each
builder receives the full mesh group at scene-build time and returns
`{ renderables, update }`.

### Multi-pass authoring

`addToPass(scene, pass, mesh, { material? })` (defined in
`scene/scene-core.ts`) creates an additional `DrawBinding` for `mesh` in
`pass`. With a `material` override it builds a *distinct* `Renderable`
(separate meshUBO/materialUBO/BG) so the same mesh can render with
different materials in different passes (used by scene 41/50). The
implementation uses a 2-round trampoline on `_builders` to ensure batch
material builders have set up their per-scene contexts before the per-pass
renderable is built.

### Render loop (driven by the frame graph)

The engine never iterates renderables directly. The frame graph executes
its tasks; each render-pass task records:

```
executeRenderPassTask(task, encoder, engine, scene):
    camera = task.camera ?? scene.camera
    1. Update task scene-UBO from this pass's camera + scene state
    2. Run pre-passes / shadow generators
    3. beginRenderPass(target.descriptor)
    4. setBindGroup(0, sceneBG)                                 // once per pass
    5. drawList(opaqueBindings)        // dedups pipeline + shadowBG
    6. drawList(transmissiveBindings)
    7. drawList(transparentBindings)   // sorted by camera distance per frame
    8. pass.end()
```

`drawList`:

```typescript
let lastPipeline = null, lastShadowBG = null;
for (const b of list) {
    if (b.pipeline !== lastPipeline) { enc.setPipeline(b.pipeline); lastPipeline = b.pipeline; }
    if (b.shadowBG && b.shadowBG !== lastShadowBG) { enc.setBindGroup(2, b.shadowBG); lastShadowBG = b.shadowBG; }
    draws += b.draw(enc, engine);
}
```

### Draw order

| `order` | Entity | Depth Write |
|---|---|---|
| 0 | Skybox (env background or cubemap) | true |
| 100 | Opaque meshes (PBR, Standard) | true |
| 140 | Transmissive (refraction sources) | true (after opaque-scene RTT) |
| 150 / 200 | Transparent (alpha-blend) | false |

## Babylon.js equivalence

| Babylon Lite | Babylon.js |
|---|---|
| `Renderable.bind() → DrawBinding` | `SubMesh._getEffect()` + cached `_drawWrapper` per pass |
| `DrawBinding.draw(pass)` | `mesh._draw()` |
| `RenderTargetSignature` (with `flipY`) | `effect._key` includes RT format / sample count / etc. |
| `PrePassRenderable` | `scene._renderTargets` + shadow caster passes |
| `MeshGroupBuilder` | `Material._prepareForSubMesh()` lazy compile |
| `_perFrameCallbacks` | per-material UBO refresh inside `scene.render()` |
| `drawList` dedup of pipeline + shadowBG | BJS engine's effect-state cache |

## Dependencies

- **Imports**: `EngineContext` (type), `Mesh` (type).
- **Depended on by**: every material module (PBR, Standard, Background,
  Skybox, Shadow), `scene/scene-core.ts`, `frame-graph/render-pass-task.ts`.

## File manifest

| File | Purpose |
|---|---|
| `src/render/renderable.ts` | `Renderable`, `DrawBinding`, `PrePassRenderable`, `MeshGroupBuildResult`, `MeshGroupBuilder`, `RenderTargetSignature` |
