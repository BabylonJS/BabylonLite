# Task 3.2: Route camera view / projection / view-projection UBO writes through `packMat4IntoF32`

## Goal

Every camera matrix write into a GPU upload buffer (scene UBO, frame-graph SceneUBO, anywhere view/proj/vp travel from camera caches into upload bytes) must go through `packMat4IntoF32`. After this task, the precision preserved by Task 2.3's F64-backed `_viewCache`/`_projCache`/`_vpCache` is correctly downcast at GPU upload time and not before.

## Requirements addressed

REQ-UPL-1, REQ-UPL-2.

## Background

`packages/babylon-lite/src/math/pack-mat4-into-f32.ts` exports `packMat4IntoF32(view, mat, offsetFloats?)` (Task 1.4). It is the single F64→F32 boundary.

Camera matrices are produced in `packages/babylon-lite/src/camera/camera.ts`:

- `getViewMatrix(camera): Mat4` — caches in `camera._viewCache`.
- `getProjectionMatrix(camera, aspect): Mat4` — caches in `camera._projCache`.
- `getViewProjectionMatrix(camera, aspect): Mat4` — caches in `camera._vpCache`.

After Task 2.3 these caches may be `Float64Array(16)` when HPM is on.

The frame-graph code that uploads the scene UBO is in `packages/babylon-lite/src/frame-graph/render-task.ts:522`:

```ts
eng.device.queue.writeBuffer(task._sceneUBO, 0, data as Float32Array<ArrayBuffer>);
```

`data` is a Float32 scratch composed upstream in the same file. The scene UBO contains `viewProj`, `view`, `projection`, plus camera position, fog uniforms, etc. Search upstream of line 522 for the matrix-pack sites — typically `data.set(view, 0); data.set(proj, 16); data.set(vp, 32);` or equivalent — and replace each `.set(mat, off)` with `packMat4IntoF32(data, mat, off)`.

## Files to modify

- `packages/babylon-lite/src/frame-graph/render-task.ts` — Replace direct `data.set(view, ...)`, `data.set(proj, ...)`, `data.set(vp, ...)` (or the equivalent loops) with `packMat4IntoF32(data, mat, offsetFloats)` calls. Keep the downstream `writeBuffer` call unchanged (it already takes a Float32 view).
- Any other file that writes a camera matrix into a GPU buffer. Run:

    ```text
    Select-String -Path .\packages\babylon-lite\src -Pattern '_viewCache|_projCache|_vpCache' -Recurse
    ```

    Audit each consumer. If any consumer copies the cache directly into a GPU buffer or `.set`s it into a Float32 scratch destined for `writeBuffer`, that site must use `packMat4IntoF32`.

## Implementation details

1. Add the import at the top of any modified file:

   ```ts
   import { packMat4IntoF32 } from "../math/pack-mat4-into-f32.js";
   ```

2. In `frame-graph/render-task.ts`, locate the scene UBO composition (upstream of line 522). The matrices written are `viewProj`, `view`, `projection`, and possibly the inverse of `view` for camera position. For each:

    ```ts
    // Before:
    data.set(viewProj, OFFSET_VIEW_PROJ);
    // After:
    packMat4IntoF32(data, viewProj, OFFSET_VIEW_PROJ);
    ```

    Use the existing offset constants the file already defines.

3. If the file also writes camera position (Vec3) or per-frame uniforms, leave those alone — the boundary helper is mat4-only. Vec3 writes are not in REQ-UPL-2 scope.

4. Verify no other file uses `_viewCache`, `_projCache`, or `_vpCache` to write into GPU-bound bytes. Common candidates:
    - `picking/gpu-picker.ts:151` — uses `_pickVP`. **Out of M0 scope** (deferred per architecture D4). Do NOT modify; leave the existing `_pickVP` direct `writeBuffer` in place.
    - Shadow paths (`shadow-base.ts:307,309`, `pcf-directional-shadow-generator.ts:281`) — addressed in Task 3.5, not here.

## Testing suggestions

- Run a parity scene that visibly stresses camera precision: any scene with non-trivial camera distance.
- `pnpm test:parity` — full suite. Camera matrices feed every render, so a regression here surfaces broadly.
- Add a unit test `tests/unit/camera-ubo-pack.test.ts`:
    - Build a fake camera with `_viewCache` as a `Float64Array(16)` containing a translation that loses F32 precision.
    - Call the (factored-out) UBO composition function with a test `data: Float32Array(N)` and the camera.
    - Assert the relevant offset of `data` contains `Math.fround` of the source — i.e., the pack happened.
    - This may require lifting a few internal lines of `render-task.ts` into a small helper. That refactor is fine and improves testability.
- `pnpm exec vitest run` — green.

## Gotchas

- Some camera consumers use the cache as a generic `Float32Array` and feed it to APIs that expect bytes (e.g., `writeBuffer(buf, 0, _viewCache)`). After Task 2.3 widens these caches to `Mat4`, those direct-byte uses break for HPM-on. This task is the place to fix them. If you find a consumer not in `render-task.ts`, audit it — if it's a M0 inventory site, route through the helper; if it's deferred (e.g., gpu-picker), leave the `as Float32Array<...>` cast and tag as deferred.
- The frame-graph composes its scene UBO once per frame per scene. Per-frame allocation of a new `data` scratch is *not* a new requirement — the existing scratch reuse pattern stays. Just change the assignment lines.
- Do not change the layout of the scene UBO. Offsets in WGSL stay byte-identical. Only the host-side packing strategy changes.
- If `getViewProjectionMatrix` exists and is *computed* via `mat4MultiplyInto(_vpCache, view, proj)`, that intermediate is policy-precision (Task 2.3) — confirm that the Phase 2 widening already covers it. The pack happens later, when `_vpCache` is written into `data`.

## Verification checklist

- [ ] `frame-graph/render-task.ts` composes scene UBO mat4 fields via `packMat4IntoF32`.
- [ ] No surviving `data.set(view` / `.set(proj` / `.set(vp` (or any other camera mat4) outside the helper in the M0 inventory.
- [ ] Unit test `tests/unit/camera-ubo-pack.test.ts` confirms F64 precision is downcast at the boundary.
- [ ] `pnpm test:parity` is green.
- [ ] `pnpm exec vitest run` is green.
