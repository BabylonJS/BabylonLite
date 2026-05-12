# Code Review — `sprites-billboards` branch

Scope: billboards work on commits `86a33c3..HEAD` (`Billboards start` → `Removing packed colors`).

Files reviewed:
- [packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts)
- [packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts)
- [packages/babylon-lite/src/sprite/billboard-renderable.ts](packages/babylon-lite/src/sprite/billboard-renderable.ts)
- [packages/babylon-lite/src/sprite/billboard-scene.ts](packages/babylon-lite/src/sprite/billboard-scene.ts)
- [packages/babylon-lite/src/render/renderable.ts](packages/babylon-lite/src/render/renderable.ts)
- [packages/babylon-lite/src/frame-graph/render-pass-task.ts](packages/babylon-lite/src/frame-graph/render-pass-task.ts)
- [packages/babylon-lite/src/index.ts](packages/babylon-lite/src/index.ts)
- [tests/unit/billboard-sprite.test.ts](tests/unit/billboard-sprite.test.ts)

Severity legend: **HIGH** = correctness/leak/perf risk · **MED** = maintainability/contract · **LOW** = style/cleanup.

---

## HIGH

### H1. `removeBillboardSpriteIndex` bumps version with stale `count`
[packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts#L297-L317)

```ts
markDirty(system, index, index + 1);
system.count--;
```

`markDirty` increments `_version`. If a renderable's `update()` runs *between* the version bump and the `count--` (it cannot today, but the API is callable from any code path including async/microtask boundaries that the user may introduce), `uploadBillboardInstances` will read the stale `count`. Even today, the inverted ordering is a footgun for future async edits. Decrement `count` first, then `markDirty`.

Same nit applies symmetrically: `addBillboardSpriteIndex` increments `count` *before* `markDirty`, which is the correct order — keep both consistent.

### H2. Pipeline cache acquire/release refcount is global, not per-engine
[packages/babylon-lite/src/sprite/billboard-renderable.ts](packages/babylon-lite/src/sprite/billboard-renderable.ts#L26-L43)

`_sharedPipelineCache` and `_sharedPipelineCacheRefs` are module-level singletons. Only the WeakMap *inside* the cache is per-device. If two engines (or one engine reset) share the cache, `clearBillboardPipelineCache` (called when refcount hits 0) drops *all* device pipelines, including those still referenced by the other engine's renderables that haven't been disposed yet. That's not crash-causing (WebGPU pipelines stay alive while GPU command buffers retain them), but the next bind from the live engine will silently re-create every pipeline.

Either (a) key the shared cache by device, or (b) drop the refcount and let the WeakMap+GC handle device cleanup (simpler, since device disposal already collects pipelines).

### H3. `_lastDeviceCache` is dead state
[packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L15) — written in `getBillboardPipelineDeviceCache` and `clearBillboardPipelineCache`, never read. Either use it as a fast-path (skip the WeakMap lookup when `engine.device === lastDeviceCache.device`) or remove the field. As-is it's misleading and pads the type surface.

### H4. `writeBillboardSystemUboIfDirty` always returns `true`; `alreadyUploaded` parameter is misleading
[packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L295-L312)

The function returns a constant `true` regardless of whether a write happened. The caller stores it as `_uboUploaded` and passes it back next frame — so the "dirty" detection only works on the *first* call. After that, `alreadyUploaded` is always true, so dirty becomes "did the bytes change?" only, which happens to be what we want — but the API shape is wrong:

- Return value is meaningless (always `true`).
- The `alreadyUploaded` parameter only controls whether to *force* the first write; rename it to `forceWrite` (with inverted meaning) or just track "have we ever written" inside the renderable.

This works today but will be a maintenance trap.

### H5. Transparent sort distance uses average-position centroid
[packages/babylon-lite/src/sprite/billboard-renderable.ts](packages/babylon-lite/src/sprite/billboard-renderable.ts#L188-L218) + [packages/babylon-lite/src/frame-graph/render-pass-task.ts](packages/babylon-lite/src/frame-graph/render-pass-task.ts#L267-L289)

`refreshBillboardWorldCenter` averages all sprite anchors as the system's `_worldCenter`. The pass-level transparent sort (`sortTransparentBindings`) uses that centroid for back-to-front ordering between systems. Two consequences:

1. With a wide-spread system (e.g. trees scattered across a scene), the centroid can land anywhere — sort order vs other transparent renderables becomes effectively random and may flicker between frames as sprites move.
2. The per-instance back-to-front sort (`uploadSortedBillboardInstances`) handles intra-system ordering correctly, so the only hazard is *inter*-renderable. Document this limitation, or pick a less misleading representative (e.g. the bounding-box center, or skip distance entirely and fall back to `order` for billboard systems).

### H6. `disposeRenderable` nulls `_system` via cast and leaves stale `_lastUbo`/`_scratchUbo`
[packages/babylon-lite/src/sprite/billboard-renderable.ts](packages/babylon-lite/src/sprite/billboard-renderable.ts#L242-L252)

```ts
(renderable as unknown as { _system: BillboardSpriteSystem | null })._system = null;
```

The interface declares `_system: BillboardSpriteSystem` (non-nullable). Every code path checks `_disposed` first, so the null-out is defensive only — but the double-cast hides the lie. Either:

- Mark `_system` as `BillboardSpriteSystem | null` in the internal interface and add narrowing, or
- Drop the assignment (the `_disposed` flag is sufficient).

Also: `_bindGroups.clear()` is fine but `_uniformBuffer`/`_indexBuffer` destruction relies on no in-flight GPU work — same convention as the rest of the codebase, so OK, just worth a comment.

---

## MED

### M1. `clearBillboardPipelineCache` is misnamed
It replaces the WeakMap with a fresh empty one rather than iterating and clearing — pipelines in the old WeakMap still exist until GC. Name it `resetBillboardPipelineCache` or actually drain `_pipelines`/`_shaderModules` from each device entry (you'd need a Set of devices since WeakMap isn't iterable).

### M2. `_uploadedCameraViewMatrix` reference compare is redundant
[packages/babylon-lite/src/sprite/billboard-renderable.ts](packages/babylon-lite/src/sprite/billboard-renderable.ts#L155-L172)

`getViewMatrix(camera)` typically returns a stable Float32Array reference per camera. The `_uploadedCameraViewVersion !== camera.worldMatrixVersion` check already covers content changes. The reference check only fires when the *camera object* changes — which deserves an explicit `_uploadedCamera !== camera` check rather than relying on matrix identity. Today this works because matrix identity follows camera identity, but it's fragile.

### M3. Cutout fragment compares raw texture alpha, ignoring `tint.a`
[packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L99-L106)

```wgsl
if (sampleColor.a < billboards.axis.w) { discard; }
return sampleColor * in.tint * billboards.opacityMul;
```

A user fading a cutout sprite via `color.a` or `system.opacity` will see the discard threshold unaffected — sprites won't fade out, they'll just dim. That may be intentional (cutout = binary alpha) but should be documented or the discard should compare against `sampleColor.a * in.tint.a * billboards.opacityMul.a`.

### M4. Index buffer per-renderable instead of per-cache
[packages/babylon-lite/src/sprite/billboard-renderable.ts](packages/babylon-lite/src/sprite/billboard-renderable.ts#L67)

Every billboard system allocates its own 12-byte index buffer with the same six indices. Cheap, but the natural place to share is the device cache (alongside shader modules). Low-priority; flag as a follow-up.

### M5. `uploadBillboardInstances` early-returns on `count === 0` without resetting dirty range
[packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L260-L279)

If a system goes from N→0 sprites and then back to ≥1, the stale `_dirtyMin`/`_dirtyMax` from the original N may still be set when we return early. The next non-empty upload will use them — currently fine because of `Math.min(_dirtyMax, system.count)`, but again a cleaner contract is to clear dirty range on every early return.

### M6. `BillboardSpriteSystem.blendMode` is `SpriteBlendMode` but constructor only allows three values
[packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts#L26) declares `readonly blendMode: SpriteBlendMode` (the full union including `additive`/`multiply`/etc.) even though `assertBlendSupported` rejects them. Tighten the public type to `Extract<SpriteBlendMode, "alpha" | "premultiplied" | "cutout">` (already used internally as `SupportedBillboardBlendMode`) so callers get a compile-time error.

### M7. `_axis: [0,0,0]` for `facing` systems is meaningless but still uploaded
[packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts#L97) + [billboard-pipeline.ts buildBillboardSystemUbo](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L283-L292)

For facing systems `axis.xyz` are unused by the shader. Fine, but the UBO's `axis.w` doubles as `alphaCutoff`. Overloading `axis.w` as the cutoff is undocumented — add a one-line comment in `buildBillboardSystemUbo` explaining the field reuse, since the WGSL reads `billboards.axis.w` in the cutout fragment and a future reader will be confused.

### M8. `addBillboardSystem` helperName branding leaks into error messages
[packages/babylon-lite/src/sprite/billboard-scene.ts](packages/babylon-lite/src/sprite/billboard-scene.ts#L5-L13)

The error `"addAxisLockedBillboardSystem: expected a axis-locked BillboardSpriteSystem, got facing."` reads "a axis-locked" — minor English nit, but the helper-name is also redundantly built from a string literal. Fine to leave; flagging as polish.

---

## LOW

### L1. Magic numbers for instance attribute offsets
[packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L401-L411)

Hard-coded `0, 12, 20, 28, 36, 40, 48` — derive from a single struct definition or at minimum add a comment matching the field order in [billboard-sprite.ts writeInstance](packages/babylon-lite/src/sprite/billboard-sprite.ts#L154-L240). If `BILLBOARD_INSTANCE_FLOATS_PER_SPRITE` ever changes, these silently desync.

### L2. WGSL is built as one giant template string per orientation × depth
[packages/babylon-lite/src/sprite/billboard-pipeline.ts](packages/babylon-lite/src/sprite/billboard-pipeline.ts#L67-L150)

Readable, but the `select(0.0, 1.0, in.vid == 1u || in.vid == 2u)` corner pattern is identical to `sprite-2d`. Consider extracting a shared snippet to keep the two in sync (low pri — they may diverge intentionally).

### L3. Test mock `makeMockEngine` widens types with `as unknown as`
[tests/unit/billboard-sprite.test.ts](tests/unit/billboard-sprite.test.ts#L43-L73) — typical for the codebase, just calling out that adding fields to `EngineContextInternal` will silently break all billboard tests at runtime instead of compile-time.

### L4. `BillboardSpriteSystem` interface mixes public mutables and `_internal` fields without grouping
Public fields (`alphaCutoff`, `opacity`, `visible`, `order`, `count`) are interspersed with `_capacity`, `_orientation` etc. Re-order so public surface comes first; matches `Sprite2DLayer` convention.

### L5. `growCapacity` doubling can over-allocate sharply for one-shot bulk inserts
[packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts#L137-L149) — if a user calls `addBillboardSpriteIndex` 10000 times starting from capacity 16, it grows to 16384. Acceptable, but a `Math.max(capacity * 2, minCapacity)` single jump avoids the loop and matches `sprite-2d` if that's the convention.

### L6. `scene-config.json` and bundle-size manifest changes
Not part of the code review scope, but verify scenes 54-57 thresholds were set with headroom and weren't ratcheted to current size +0.

---

## Notes & non-issues (for the record)

- The `_savedSize` shadow + `visible: false` zero-size trick is correct and round-trips through `updateBillboardSpriteIndex({ visible: true })`.
- The flip-state inference (`prev[5] > prev[7]`) on `setBillboardSpriteFrameIndex` is clever and correct.
- The deferred builder in `billboard-scene.ts` correctly avoids pulling `billboard-renderable.ts` (and thus the pipeline graph) into mesh-only scene bundles — good for tree-shaking.
- The `_updateContext.camera` plumb-through in `render-pass-task.ts` is a clean minimal addition; existing pass tests should still pass since `camera` is optional.
- Cutout depth-write + `discard` ordering is correct in WebGPU: discard prevents depth write for the discarded fragment.
