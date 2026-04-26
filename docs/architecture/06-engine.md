# Module: Engine

> Package path: `packages/babylon-lite/src/engine/engine.ts`

## Purpose

The Engine module is the lowest layer of Babylon Lite. It acquires a WebGPU
adapter and device, configures the swap chain on a canvas, and drives the
per-frame render loop via `requestAnimationFrame`. It does **not** own any
render targets — those are owned by the **frame graph** (each task owns its
target), which the engine asks to build/execute every frame.

## Public API Surface

```typescript
/** Handle to the WebGPU engine — pure state, no attached methods. */
export interface EngineContext {
    readonly canvas: HTMLCanvasElement;
    readonly msaaSamples: number;          // always 4
    /** Preferred swapchain texture format. Use as the `colorFormat` for
     *  offscreen RTs that are sampled by main-pass materials. */
    readonly format: GPUTextureFormat;

    /** GPU draw calls executed in the last rendered frame. */
    drawCallCount: number;
}

/** Acquire GPU adapter + device, configure swapchain, return engine handle. */
export async function createEngine(canvas: HTMLCanvasElement): Promise<EngineContext>;

/** Start the render loop. Resolves after the first frame has been rendered. */
export function startEngine(engine: EngineContext, scene: SceneContext): Promise<void>;

/** Stop the render loop. */
export function stopEngine(engine: EngineContext): void;

/** Render a single frame outside the rAF loop and await GPU completion.
 *  Useful for tests / one-shot captures. */
export function renderOneFrame(engine: EngineContext, scene: SceneContext): Promise<void>;

/** Release engine + scene GPU resources. */
export function disposeEngine(engine: EngineContext, scene?: SceneContext): void;
```

### Internal types (not exported)

```typescript
/** @internal — GPU internals + frame-graph hooks. */
interface EngineContextInternal extends EngineContext {
    readonly device: GPUDevice;
    readonly context: GPUCanvasContext;
    /** Swapchain view for the current frame. Refreshed at the top of each frame.
     *  Frame graph render-pass tasks bound to the swapchain RT read this. */
    _swapChainView: GPUTextureView | null;
    _animFrameId: number;
    _renderFn: ((now: number) => void) | null;
    /** True when the frame graph needs to be (re)built before next execute().
     *  Initially true; set true on canvas resize and when builders run. */
    _needsBuild: boolean;
}
```

## Initialisation (`createEngine`)

1. Request a high-performance adapter; abort if WebGPU is unavailable.
2. Request a device, opportunistically enabling `float32-filterable` and the
   ASTC / BC / ETC2 texture-compression features when the adapter exposes them.
3. Acquire the canvas WebGPU context; configure with the preferred format
   (`navigator.gpu.getPreferredCanvasFormat()`) and `alphaMode: 'opaque'`.
4. Set `msaaSamples = 4` (hard-coded).
5. Return the `EngineContextInternal` struct. The engine **does not allocate
   any render targets** — the frame graph creates the main MSAA + depth
   target inside `createSceneContext` (see [07-scene.md](./07-scene.md)) and
   any extra RTTs are created by user-authored tasks.

## Resize

`handleResize(eng)` runs at the top of every frame. It compares the canvas's
DPR-scaled client size to the current backing-store size and, on mismatch,
updates `canvas.width`/`canvas.height` and flips `_needsBuild = true`. The
frame graph's `build()` then reallocates any `size: "canvas"` render targets
on the next frame.

## Frame loop

`startEngine(engine, scene)` returns a `Promise<void>` that resolves after the
first frame has been encoded. The render function:

```
renderFn(now):
    delta = firstFrame ? 0
            : sc._fixedDeltaMs > 0 ? sc._fixedDeltaMs
            : (lastTime > 0 ? now - lastTime : 16.667)
    renderFrame(eng, sc, delta).then(() => {
        if (firstFrame) {
            firstFrame = false
            canvas.dataset.loaded = "true"   // hides the lab loader overlay
            resolve()
        }
        _animFrameId = requestAnimationFrame(renderFn)
    })
```

`renderFrame(eng, sc, deltaMs)` is the engine's only per-frame entry point:

1. **Drain scene builders** — if `sc._builders` is non-empty, await
   `drainSceneBuilders(sc)` (see [07-scene.md](./07-scene.md)). New builders
   may invalidate the frame graph, so this also sets `_needsBuild = true`.
2. **Resize** — see above.
3. **Build frame graph if dirty** — `await sc._frameGraph.build()`.
4. **Acquire swapchain view** — `eng._swapChainView = context.getCurrentTexture().createView()`.
5. **Run user `_beforeRender` callbacks** with `deltaMs`.
6. **Drain `_materialSwapQueue`** via `processMaterialSwaps` (rebuilds any
   renderables whose material was swapped since the last frame).
7. **Run internal `_perFrameCallbacks`** (e.g. light UBO refresh, mesh-group
   GPU updates) — strictly after the user hook so user mutations are visible.
8. **Execute the frame graph** — `sc._frameGraph.execute()` records all task
   passes (shadows → main → any RTT tasks) into a single command encoder and
   submits.

The engine never directly creates render passes or draws meshes — it only
asks the frame graph to execute. See the frame-graph implementation in
`packages/babylon-lite/src/frame-graph/` for task ordering and recording.

### `data-loaded` signal

After the first frame paints, the engine sets
`canvas.dataset.loaded = "true"`. The lab loader overlay
(`lab/public/loader.js`) listens for this attribute and dismisses, so users
see the canvas as soon as content is being rendered — even when scenes
deliberately delay `data-ready` (e.g. scene 40 waits for physics to settle).
Tests still wait for `data-ready`.

### `renderOneFrame`

`renderOneFrame(engine, scene)` runs `renderFrame` once outside the rAF loop
and then awaits `device.queue.onSubmittedWorkDone()`. Stop the loop with
`stopEngine` first if it's running.

## State machine / lifecycle

```
[Created]
   │ startEngine(engine, scene)
   ▼
[Running] —— each frame: renderFrame(engine, scene, delta)
   │            (drain builders → resize → build FG → execute FG)
   │ stopEngine(engine)
   ▼
[Stopped] —— startEngine(engine, scene) → [Running]
   │
   │ disposeEngine(engine, scene?)  →  device.destroy()
   ▼
[Disposed]
```

## Babylon.js equivalence

| Babylon Lite | Babylon.js |
|---|---|
| `createEngine(canvas)` | `new WebGPUEngine(canvas)` + `await engine.initAsync()` |
| `startEngine(engine, scene)` | `engine.runRenderLoop(() => scene.render())` (returned promise ≈ `scene.whenReadyAsync()`) |
| `stopEngine(engine)` | `engine.stopRenderLoop()` |
| `renderOneFrame(engine, scene)` | `scene.render()` outside the loop |
| Swapchain MSAA target | `engine._mainTexture` (managed internally) |
| `_frameGraph.execute()` | `scene.render()`'s render-loop body |

## Dependencies

- **Imports**: `SceneContext`/`SceneContextInternal` from `../scene/scene.js`,
  `processMaterialSwaps`/`drainSceneBuilders` from the same.
- **No render-target / pipeline / material code** — all GPU state belongs to
  the frame graph and the renderables it executes.

## Test specification

| Test | Description |
|---|---|
| `createEngine returns valid handle` | Mock `navigator.gpu`, verify `device`, `context`, `format`, `msaaSamples = 4` |
| `resize flags _needsBuild` | Change canvas client size, verify next frame rebuilds |
| `startEngine resolves after first frame` | Promise resolves only once the first `renderFrame` has completed |
| `data-loaded set after first frame` | `canvas.dataset.loaded === "true"` after `startEngine` resolves |
| `renderFrame drains builders` | Push a builder; verify it ran and `_needsBuild` was set |
| `material swap queue drained per frame` | Assign `mesh.material = X`; verify `processMaterialSwaps` runs |
| `disposeEngine releases device + scene FG` | Spy on `device.destroy()` and `frameGraph.dispose()` |

## File manifest

| File | Purpose |
|---|---|
| `src/engine/engine.ts` | Engine handle, RAF loop, frame-graph driver |
