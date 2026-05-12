# Code Review #1 — Billboards branch (`sprites-billboards`)

Scope: all changes between `upstream/master` and `HEAD` that touch the
billboard implementation. Files reviewed:

- [packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts)
- [packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts)
- [packages/babylon-lite/src/sprite/billboard-renderable.ts](packages/babylon-lite/src/sprite/billboard-renderable.ts)
- [packages/babylon-lite/src/sprite/billboard-scene.ts](packages/babylon-lite/src/sprite/billboard-scene.ts)
- [packages/babylon-lite/src/index.ts](packages/babylon-lite/src/index.ts) (exports)
- [packages/babylon-lite/src/render/renderable.ts](packages/babylon-lite/src/render/renderable.ts) (`DrawUpdateContext.camera`)
- [packages/babylon-lite/src/frame-graph/render-pass-task.ts](packages/babylon-lite/src/frame-graph/render-pass-task.ts) (sort/update reorder, `_updateContext.camera`)
- [tests/unit/billboard-sprite.test.ts](tests/unit/billboard-sprite.test.ts)
- [tests/unit/render-pass-task.test.ts](tests/unit/render-pass-task.test.ts)
- Lab scenes 54‑57 (lite + bjs), parity specs, scene-config additions, bundle-size guards.

Severity legend:

- **🟥 High** – correctness bug, leak, lifetime issue, or guidance violation that
  should block merge until addressed.
- **🟧 Med** – design/clarity concern that will hurt us soon (perf, wrong
  abstraction, fragile API contract). Worth fixing in this PR.
- **🟨 Low** – polish, naming, minor consistency, doc gap.

---

## 🟥 High

### H1. `setBillboardSpriteFrameIndex` ignores the frame's pivot — silent regression vs. atlas data

[packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts#L292-L307)

```ts
export function setBillboardSpriteFrameIndex(system, index, frame): void {
    ...
    system._instanceData[base + 5] = flipX ? spriteFrame.uvMax[0] : spriteFrame.uvMin[0];
    ...
    // pivot slots [10][11] are never touched
    markDirty(system, index, index + 1);
}
```

Atlas frames carry a per-frame `pivot`, but `setBillboardSpriteFrameIndex` only
rewrites the four UV slots and leaves slots `[10][11]` (pivot) alone. The unit
test at line 169 codifies this behaviour. That means an atlas where each frame
declares its own pivot (the typical TexturePacker/spritesheet case the docs
already say is coming in a later PR — but the data shape supports it today)
will silently use the _first frame's_ pivot for every subsequent frame.

This will bite the day someone wires up TexturePacker JSON: animations will
appear to "jump" because the pivot doesn't follow the frame.

Recommendation: at minimum, add an inline comment that says "pivot is sticky
across `setFrame` by design — re-call `updateBillboardSpriteIndex({ pivot })`
to follow per-frame pivots". Better: gate this with an option (e.g. a future
`{ adoptFramePivot: true }`) or rewrite pivot when the call site does not
specify one.

The same applies to `Sprite2DLayer.setSprite2DFrameIndex` if it has the same
shape — worth aligning at the pattern level so we don't ship inconsistent
animation behaviour across the two sprite families.

---

### H2. Setting `system.count = 0` directly leaves dirty/version stale and breaks future uploads

[packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts#L23-L62)

`count: number` on `BillboardSpriteSystem` is exposed as **mutable** in the
public interface. Every other writer (`add`, `update`, `remove`,
`setFrameIndex`) goes through `markDirty` which bumps `_version` and tracks
the dirty range. A user who clears the system with the obvious `system.count = 0`:

- does **not** bump `_version`,
- does **not** reset `_dirtyMin/_dirtyMax`,
- does **not** zero `_savedSize`.

Subsequent `addBillboardSpriteIndex` calls re-populate from index `0`, which
happens to work, but the system can also enter inconsistent intermediate
states (e.g. `_dirtyMax > count`, which the upload paths already half-handle
via `Math.min(_dirtyMax, count)`).

`Sprite2DLayer` has the same shape, so this is also a project-wide concern;
the billboard interface does not need to be the one that introduces the fix
but it should not regress it either.

Recommendation: declare `count: number` as `readonly count: number` and
provide an explicit `clearBillboardSprites(system)` helper that calls
`markDirty(system, 0, system.count); system.count = 0`. That matches the
"pure data + standalone Index API" model in [GUIDANCE.md](Babylon-Lite/GUIDANCE.md)
without exposing footguns.

---

### H3. Shared pipeline cache prevents `clearBillboardPipelineCache` from being effective on device loss

[packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L153-L164)

- [packages/babylon-lite/src/sprite/billboard-renderable.ts](packages/babylon-lite/src/sprite/billboard-renderable.ts#L26-L43)

`BillboardPipelineCache` keeps a `WeakMap<GPUDevice, …>` so old devices clean
up automatically — but it also holds a strong fast-path reference:

```ts
export interface BillboardPipelineCache {
    _devices: WeakMap<GPUDevice, BillboardPipelineDeviceCache>;
    _lastDeviceCache: BillboardPipelineDeviceCache | null;
}
```

`_lastDeviceCache` strongly references the device cache, which strongly
references compiled `GPUShaderModule`/`GPURenderPipeline` objects, which in
turn reference the device. **The whole point of the `WeakMap` is defeated for
the most-recently-used device** — it cannot be GC'd until a different device
becomes "last".

In single-engine apps this is benign (we only ever have one device), but
device-loss recovery (re-creating the engine + device) and multi-engine test
harnesses will leak the previous device. The same pattern exists in
`SpritePipelineCache`; copying it forward isn't a license to keep the bug.

Recommendation: drop `_lastDeviceCache` (the WeakMap fast path is one lookup —
`getOrCreateBillboardPipeline` already calls into it), or null it out from
inside `clearBillboardPipelineCache` and add a `clearLast()` helper that the
engine-disposal path calls.

---

### H4. Transparent billboard re-upload triggers on **any** camera move, even when it cannot change sort order

[packages/babylon-lite/src/sprite/billboard-renderable.ts](packages/babylon-lite/src/sprite/billboard-renderable.ts#L161-L181)

```ts
if (
    !renderable._uploadedSorted ||
    renderable._uploadedVersion !== renderable._system._version ||
    renderable._uploadedCameraViewMatrix !== cameraViewMatrix ||
    renderable._uploadedCameraViewVersion !== camera.worldMatrixVersion
) {
    uploadSortedBillboardInstances(...);
```

Two issues:

1. `cameraViewMatrix !== renderable._uploadedCameraViewMatrix` is structurally
   redundant with `worldMatrixVersion` — `getViewMatrix` returns the same
   `Float32Array` reference for the same camera; only the contents change. The
   ref comparison only fires on **camera swap** (different `Camera` instance),
   which is already implied by a different `worldMatrixVersion`. Drop one of
   the checks or comment why both are intentional.

2. **Every `worldMatrixVersion` bump re-sorts and re-uploads all `N`
   instances.** For static transparent billboards (a UI label set, foliage on a
   non-moving camera) this is fine; for an orbit camera over thousands of
   sprites, this is `O(N log N)` sort + `O(N * stride)` writeBuffer **every
   frame** even when the relative ordering hasn't changed. There's no
   "ordering-actually-changed" check (e.g. compare new sorted depths to last).

    This isn't necessarily a release blocker — sort ordering really does
    change with camera motion in the general case — but the docs call out
    "Maximum Performance & Minimal Footprint" as a non-negotiable pillar
    ([GUIDANCE.md §4](Babylon-Lite/GUIDANCE.md)). At minimum, document the cost
    model in [docs/architecture/26-sprites.md](docs/architecture/26-sprites.md)
    so users know that `N=10k` transparent billboards is going to hurt.

    Cheap mitigation: if the previous and new sort key arrays are
    element-wise equal, skip the data shuffle + upload (still
    `O(N)` for the depth pass, but zero GPU traffic).

---

### H5. `_worldCenter` for billboard systems is the **mean** anchor — wrong proxy for inter-renderable sort

[packages/babylon-lite/src/sprite/billboard-renderable.ts](packages/babylon-lite/src/sprite/billboard-renderable.ts#L191-L221)

`refreshBillboardWorldCenter` averages every sprite anchor and stores the
result in `renderable._worldCenter`. The render pass task then uses this point
to sort transparent renderables back-to-front
([render-pass-task.ts](packages/babylon-lite/src/frame-graph/render-pass-task.ts#L267-L294)).

For a billboard system that's spread across the scene (e.g. a foliage system
covering an entire level), the mean position can be far from any individual
sprite — and worse, can put the billboard system on the wrong side of an
unrelated transparent renderable. The result: the entire billboard system
draws after-or-before something it visually overlaps, in the wrong order.
The internal sort within the system is correct, but the system-vs-other-thing
sort is wrong.

This is a **fundamental limitation of one renderable per billboard system**,
not just a calculation bug, but the average-of-anchors is the worst
representative we can choose. Better choices, in increasing order of cost:

- Bounding-box center (`(min+max)/2`) — same `O(N)` as the mean today, but
  represents the system's _footprint_ center.
- Bounding sphere center.
- Per-sprite participation in the global transparent sort (requires either
  splitting one system into multiple renderables — defeats the purpose — or
  inserting per-sprite "virtual" entries into the task's transparent list).

Document the limitation in [docs/architecture/26-sprites.md](docs/architecture/26-sprites.md)
("multiple overlapping billboard systems may misorder against each other and
against meshes; if you need exact pixel-correct sorting, split into
multiple systems by depth band") and switch the metric to bounding-box center
in this PR — same cost, less wrong.

---

## 🟧 Med

### M1. Pipeline-cache key omits the scene bind-group layout identity

[packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L165-L186)

```ts
const key = `${format}:${sampleCount}:${system._orientation}:${blendEntry.index}:${depthEntry.index}:${depthStencilFormat}`;
```

The cache is shared **across systems**, and the key derives from system
state + target. It does **not** include the `sceneBindGroupLayout` identity
or the device. The device is partitioned via `_devices: WeakMap<GPUDevice>`,
so that's fine. But the scene BGL is taken from `getSceneBindGroupLayout(engine)`
which today returns one stable layout per engine — if that ever changes
(e.g. a future scene supports a different lights count → different BGL), two
caches keyed identically would alias to the wrong pipeline.

This is a "load-bearing assumption" failure mode. Either:

- assert `sceneBindGroupLayout === deviceCache._sceneBgl` and bail out clearly,
  **or**
- include a stable identifier for the scene BGL in the cache key.

Same critique applies to `sprite-pipeline.ts` — fix at the abstraction.

---

### M2. The explicit `billboardBindGroupLayout` is built once per pipeline and immediately thrown away

[packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L376-L388)

- [packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L329-L340)

`buildBillboardPipeline` constructs an explicit `billboardBindGroupLayout`,
uses it in `createPipelineLayout`, and then discards it. Later
`createBillboardSystemBindGroup` uses `pipeline.getBindGroupLayout(1)` to
recover an equivalent layout from the pipeline.

That's two distinct `GPUBindGroupLayout` objects per (pipeline, system) pair
where one would do, plus a pipeline introspection call that some browsers
flag as a slow path. Cache `billboardBindGroupLayout` next to the pipeline in
the device cache (or just on the `GPURenderPipeline` itself via a side map)
and reuse it in `createBillboardSystemBindGroup`. Same applies to
`sprite-pipeline.ts`.

---

### M3. `BillboardSystem.axis.w` overloaded as `alphaCutoff` is a footgun

[packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L115-L120)

- [packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L98-L107)
- [packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L246-L264)

The WGSL UBO is:

```wgsl
struct BillboardSystem {
    opacityMul: vec4<f32>,
    axis: vec4<f32>,
};
```

…and the cutout fragment shader does:

```wgsl
if (sampleColor.a < billboards.axis.w) { discard; }
```

`axis.xyz` is the lock axis; `axis.w` is the alpha cutoff. The two have no
semantic relationship — they were colocated to save 16 bytes. This is the
kind of sub-cleverness that `GUIDANCE.md` §7 ("never hack dumb solution,
always aim for the long-term solution") warns about. Reading the shader, no
one will guess that `.w` is a cutoff threshold without checking the UBO writer.

Recommendation: rename to `axisAndCutoff` in the WGSL struct and add a
single-line WGSL comment, **or** split into two `vec4<f32>` fields and accept
the +16 bytes. The whole UBO is 32 bytes today — there's no real budget
pressure here, and the codebase's "no clever bit-packing" stance argues for
clarity.

---

### M4. Billboard test mocks return `undefined` from `update?.()` then assert side effects

[tests/unit/billboard-sprite.test.ts](tests/unit/billboard-sprite.test.ts#L283-L304)

The test path `binding.update?.({ targetWidth: 512, targetHeight: 256 })`
omits the `camera`. The current implementation tolerates a missing camera by
falling into the unsorted upload path even for transparent systems
([billboard-renderable.ts](packages/babylon-lite/src/sprite/billboard-renderable.ts#L161-L181)).

That's an implicit contract: "transparent + missing camera → fall back to
unsorted, still upload". It's not asserted anywhere in code or docs, and
nothing prevents a future refactor from making this throw. There is one
test that exercises the camera-driven sort path (line 304+), but the
"transparent-without-camera" fallback is exercised only by accident.

Recommendation: either

1. Add an explicit unit test "transparent system without a camera uploads in
   logical order" so the fallback contract is pinned down, **or**
2. Make camera-less transparent uploads `throw` (turn the implicit fallback
   into a hard error) and update the tests to always pass a camera.

The first is safer; the second is cleaner. Pick one.

---

### M5. Frame-graph reorder (`update → sort` instead of `sort → update`) is correct but under-documented

[packages/babylon-lite/src/frame-graph/render-pass-task.ts](packages/babylon-lite/src/frame-graph/render-pass-task.ts#L196-L212)

- [packages/babylon-lite/src/frame-graph/render-pass-task.ts](packages/babylon-lite/src/frame-graph/render-pass-task.ts#L387-L397)

The PR moves `sortTransparentBindings` from before `updateBindings` to after,
because billboard renderables compute `_worldCenter` _during_ `update`
(via `refreshBillboardWorldCenter` in `uploadSystem`). That fix is correct
and necessary — but it changes the contract of the frame graph: previously
"sort happened first, then update could rely on the sort order"; now "update
runs first, sort observes its outputs."

For mesh renderables `_worldCenter` was set at build time so the order
didn't matter. For any **future** renderable that wants to inspect the sort
result inside `update()`, this is now a regression. Worth a one-line comment
in the frame-graph file explaining why update precedes sort, and a matching
note in the `Renderable.update?` JSDoc that says "renderable updates run
before transparent sorting; the sort is allowed to read `_worldCenter`
populated during update."

The existing test ([render-pass-task.test.ts](tests/unit/render-pass-task.test.ts#L122-L131))
proves the order is enforced, but the _why_ lives only in the test and the
PR description.

---

### M6. `_axis` typed `readonly [number, number, number]` but the constructor stores a mutable tuple

[packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts#L33-L38)

- [packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts#L95-L114)

```ts
readonly _axis: [number, number, number];
...
const normalized: [number, number, number] = [axis[0]*invLength, ...];
return createBillboardSystem(atlas, "axis-locked", normalized, opts);
```

`readonly _axis` in TypeScript only freezes the _property reference_, not the
tuple's elements. Anyone with a reference to the system can do
`system._axis[0] = 999`; the next frame will pick up the corrupted value
because `buildBillboardSystemUbo` reads `system._axis` directly. For an
underscore-prefixed internal field this isn't a public-API concern, but the
"normalised axis" invariant is critical for the shader (it assumes
`length(lockAxis) == 1` — not normalising again!).

Recommendation: declare `readonly _axis: readonly [number, number, number]`
to make TS catch element writes, **or** `Object.freeze(normalized)` after
construction, **or** re-normalise inside the shader (cheap — one
`normalize()` per vertex).

---

## 🟨 Low

### L1. `assertBlendSupported` + `getBlendModeEntry` duplicate the same predicate

[packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts#L78-L82)

- [packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L57-L62)

Both files re-implement "blendMode must be one of `alpha | premultiplied | cutout`"
and throw with slightly different wording. The constructor-side check is
correct (catches errors early), the pipeline-side check is defensive — but
they can drift. If we add a fourth supported blend mode, both must change.

Recommendation: lift the predicate into one place — e.g. an exported
`isSupportedBillboardBlendMode(mode): mode is SupportedBillboardBlendMode` —
and call it from both sites. Or make `BLEND_MODE_TABLE` itself the source of
truth (`if (!(mode in BLEND_MODE_TABLE))`).

---

### L2. `writeBillboardSystemUboIfDirty` always returns `true`

[packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L266-L283)

```ts
return true;
```

The function returns the **post-call** state of "is the UBO uploaded" rather
than "did this call upload it". That's intentional (the caller stores it as
`_uboUploaded` to short-circuit the next frame), but the name reads as
"returns dirty?" / "was a write performed?". One reading of the name and a
caller could write `if (writeBillboardSystemUboIfDirty(...)) { /* react to upload */ }`
and silently react every frame.

Recommendation: rename to `markBillboardSystemUboUploaded(...): true` (the
constant return makes the contract obvious), or better, drop the return and
have the function side-effect-update `lastUbo` only — the caller's
`_uboUploaded` flag is then plain dataflow.

---

### L3. `disposeRenderable` casts `_system` to `null` via a structural cheat

[packages/babylon-lite/src/sprite/billboard-renderable.ts](packages/babylon-lite/src/sprite/billboard-renderable.ts#L237-L246)

```ts
(renderable as unknown as { _system: BillboardSpriteSystem | null })._system = null;
```

The `as unknown as { ... }` cast fights the type system because the field is
typed `BillboardSpriteSystem` (non-nullable) on `BillboardRenderableInternal`.
Cleaner: type `_system` as `BillboardSpriteSystem | null` and unify the
nullability check with the existing `_disposed` check (right now both exist —
either is enough).

---

### L4. Lab Lite scenes 54/55 set `clearColor = { r, g, b, a }` but `bjs` references use `Color4(...)`

[lab/src/lite/scene54.ts](lab/src/lite/scene54.ts#L11)

This isn't billboard-specific (it's how `SceneContext.clearColor` is shaped),
but the parity test depends on equal background pixels. A Color4 with
`(0.16, 0.18, 0.22, 1)` should round-trip identically through both stacks;
worth a sanity glance once the parity tests are run, not a code-change ask.

---

### L5. `BillboardSpriteInit.position` / `.sizeWorld` lack mathematical-validity guards

[packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts#L65-L72)

- [packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts#L243-L255)

The constructor validates `axis` for finite + nonzero. The per-sprite write
path validates **nothing**: `position: [NaN, …]` or `sizeWorld: [-Infinity, 0]`
will silently land in the GPU buffer and either render a degenerate quad or
produce NaN screen coords (which on most drivers means the whole pipeline's
output is undefined for that draw).

Recommendation: at the public boundary
(`addBillboardSpriteIndex` / `updateBillboardSpriteIndex`), reject non-finite
position / sizeWorld components with the same `Number.isFinite` check
already used for `alphaCutoff`. Negative `sizeWorld` could be a feature ("flip
via negative size") but more likely it's a typo — explicit decision either
way is better than the current silence.

---

### L6. `index.ts` export block adds 9 named exports without a "since 0.x" / scope note

[packages/babylon-lite/src/index.ts](packages/babylon-lite/src/index.ts#L186-L195)

The new export block is the public API surface for billboards. `index.ts`
elsewhere has section banners (`// ─── Core ───`, etc.) — billboards are
appended into the existing sprite section without their own banner. Tiny
papercut, but `index.ts` is the file maintainers grep when reasoning about
the API; a `// ─── World-space billboards ───` divider helps future readers.

---

### L7. Bundle-size guard for sprites mixes regex literals into a hand-written enum

[tests/parity/bundle-size.spec.ts](tests/parity/bundle-size.spec.ts#L132-L180)

The non-sprite-scene guard is now:

```ts
const offenders = runtimeModules.filter((id) => /\/sprite\/(sprite-(2d|pipeline|renderer|renderable)|billboard-(sprite|scene|pipeline|renderable))\.ts$/.test(id));
```

This regex is now the de facto manifest of "everything in the sprite
folder". If a future PR adds `sprite/sprite-clip.ts`, the guard silently
**stops catching it** for non-sprite scenes — exactly the regression the
guard exists to prevent.

Recommendation: invert the regex to `\/sprite\/.*\.ts$` (catch everything in
the folder) and explicitly allow-list the modules a non-sprite scene **may**
load (probably none today). That way new files are guarded by default.

---

### L8. Scene 56 BJS reference computes the axis-locked basis **once**, but Lite recomputes every frame

[lab/src/bjs/scene56.ts](lab/src/bjs/scene56.ts#L73-L76)

- [packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L82-L96)

The BJS reference materialises real meshes whose vertices are baked from a
basis computed _once_ at scene init. The Lite implementation computes the
basis in the vertex shader every frame from `scene.view`. For a stationary
parity-test camera the outputs match; **the moment the camera moves, BJS
sprites stay frozen and Lite sprites rotate.**

This isn't a Lite bug — Lite's behaviour is more correct (axis-locked
billboards _should_ yaw with the camera). But it does mean
`scene56-axis-locked-billboards` is a parity test only at the captured pose,
not under camera motion. Worth a one-line comment in
[lab/src/bjs/scene56.ts](lab/src/bjs/scene56.ts#L1) explaining "BJS has no
built-in axis-locked billboard primitive; this reference is a static-pose
approximation, not a behavioural reference" so the next person who wants to
animate this scene knows where the discrepancy will appear.

---

### L9. `addBillboardSystem` error message: `"got facing"` reads grammar-wrong

[packages/babylon-lite/src/sprite/billboard-scene.ts](packages/babylon-lite/src/sprite/billboard-scene.ts#L7-L9)

```
expected a axis-locked BillboardSpriteSystem, got facing.
```

Should be `"expected an axis-locked"`. The unit tests assert the regex
`/expected a axis-locked/` so changing the article requires updating the test
too. Polish-only.

---

## What I did NOT find issues with

These were checked and look correct:

- Vertex layout (16 floats / 64 bytes), attribute offsets, instance step mode.
- Per-frame UBO dirty-skip logic (`writeBillboardSystemUboIfDirty` is correct
  given its overloaded contract — see L2).
- `markDirty` + dirty-range upload for the non-transparent (cutout) path.
- Swap-remove logic in `removeBillboardSpriteIndex` (the dirty range is
  intentionally `[index, index+1)` because the new tail data at `last` is
  inaccessible after `count--`).
- Pipeline cache acquire/release ref-counting.
- `getBillboardBasis` math for both `facing` and `axis-locked` (matches
  Babylon.js's view-matrix-derived right/up vectors; fallback when
  `cameraRight ∥ lockAxis` is well-conditioned).
- Cutout discard threshold + depth-write configuration (`less-equal` +
  `depthWriteEnabled: true`).
- Tree-shaking guards added to bundle-size spec for scenes 50/51/52 (modulo
  L7 above).
- Scene-config additions for scenes 54–57 (MAD ceilings + raw-KB ceilings
  follow the existing convention).

---

## Suggested fix order if applying in one PR

1. **H1, H2, H6** — small interface tweaks, no shader/pipeline impact, fix
   contracts that will bite later.
2. **H3, H4, H5** — perf/lifetime; H4+H5 also need a doc paragraph each in
   [docs/architecture/26-sprites.md](docs/architecture/26-sprites.md).
3. **M3** — rename `axis.w` to `axisAndCutoff` while the shaders are still
   small and the call sites are easy to follow.
4. **M5** — frame-graph comment + `Renderable.update` JSDoc.
5. The rest (M1, M2, M4, M6, all L) can land in follow-ups but H/M items
   above belong in this PR.
