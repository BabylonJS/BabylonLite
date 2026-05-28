# Task 3.1: Route mesh world UBO writes through `packMat4IntoF32`

## Goal

Every mesh world-matrix GPU upload in M0 scope must call `packMat4IntoF32` instead of writing the matrix directly to a Float32 view or upload buffer. After this task, when a mesh's `worldMatrix` is F64-backed, the GPU receives a correctly-downcast F32 copy via the shared boundary; when it is F32-backed, output is byte-identical to today.

## Requirements addressed

REQ-UPL-1, REQ-UPL-2.

## Background

The single F64→F32 GPU upload boundary is `packMat4IntoF32(view: Float32Array, mat: Mat4, offsetFloats?: number): void` defined in `packages/babylon-lite/src/math/pack-mat4-into-f32.ts` (Task 1.4). It does NOT allocate, does NOT subtract floating-origin offsets, and does NOT special-case any matrix.

The mesh-world-UBO uploader inventory in M0 scope (per `docs/features/high-precision-matrix/architecture.md` §D4):

1. `packages/babylon-lite/src/render/scene-helpers.ts:54` — `device.queue.writeBuffer(p.meshUBO, 0, wm as ...)`. `wm` is the mesh's world matrix.
2. `packages/babylon-lite/src/material/standard/standard-renderable.ts:164` — `device.queue.writeBuffer(meshUBO, 0, meshUboData as Float32Array<...>)`. `meshUboData` is a Float32 scratch built upstream that includes the world matrix at offset 0. Find the upstream composition site and pack the world matrix through the helper there.
3. `packages/babylon-lite/src/material/pbr/pbr-renderable.ts:356` — same shape as (2). Pack the mesh world into `meshUboData` via the helper.
4. `packages/babylon-lite/src/material/node/node-renderable.ts:107,170` — node material variants. Same approach.
5. `packages/babylon-lite/src/shadow/shadow-base.ts:59` — shadow caster mesh world matrix written directly to its `meshUBO`. Wrap through helper.

These uploaders all write the mesh world matrix into a Float32 GPU upload view. Today they either pass the matrix directly to `writeBuffer` (case 1, 5) or compose the matrix into a Float32 scratch via `.set(wm)` upstream (cases 2–4). After Task 2.3, when HPM is on, the mesh's `worldMatrix` may be `Float64Array(16)`. Direct `writeBuffer(buf, 0, mat)` with a Float64Array would write 128 bytes to a 64-byte UBO — a runtime data corruption. Routing through `packMat4IntoF32` produces the correct 16 floats every time.

## Files to modify

- `packages/babylon-lite/src/render/scene-helpers.ts` — Replace direct `writeBuffer(meshUBO, 0, wm)` with: pack `wm` into a small per-mesh Float32 scratch (16 floats), then `writeBuffer(meshUBO, 0, scratch)`. The scratch must be reused (not per-frame allocated). Tie its lifetime to the mesh: store `_meshWorldUploadScratch?: Float32Array` on `MeshInternal` (lazy-init on first upload, never grows).
- `packages/babylon-lite/src/material/standard/standard-renderable.ts` — Find where `meshUboData` is built (search upstream of line 164 for `meshUboData.set(wm` or `meshUboData[0] = wm[0]`-style assignments). Replace direct `.set(wm, 0)` with `packMat4IntoF32(meshUboData, wm, 0)`.
- `packages/babylon-lite/src/material/pbr/pbr-renderable.ts` — Same pattern as Standard: locate the world-matrix-into-scratch site and replace with `packMat4IntoF32`.
- `packages/babylon-lite/src/material/node/node-renderable.ts` — Two upload sites (line 107, 170). Find the upstream `meshScratch` composition; replace world-matrix copies with `packMat4IntoF32`.
- `packages/babylon-lite/src/shadow/shadow-base.ts:59` — Replace direct `writeBuffer(c.meshUBO, 0, c.worldMatrix)` with the same pack-into-scratch-then-writeBuffer pattern as case 1. Reuse a per-shadow-caster scratch buffer (`_shadowMeshUploadScratch?: Float32Array` on the caster's record).

## Implementation details

1. Import the helper at the top of each modified file:

   ```ts
   import { packMat4IntoF32 } from "../math/pack-mat4-into-f32.js";
   ```

   (Adjust relative path per directory depth.)

2. **`render/scene-helpers.ts:54`** — replace:

   ```ts
   device.queue.writeBuffer(p.meshUBO, 0, wm as unknown as Float32Array<ArrayBuffer>);
   ```

   with:

   ```ts
   const scratch = (p as unknown as { _meshWorldUploadScratch?: Float32Array })._meshWorldUploadScratch
       ?? ((p as unknown as { _meshWorldUploadScratch?: Float32Array })._meshWorldUploadScratch = new Float32Array(16));
   packMat4IntoF32(scratch, wm, 0);
   device.queue.writeBuffer(p.meshUBO, 0, scratch);
   ```

   If the existing structure of `p` allows cleaner field placement (e.g., a typed internal interface), prefer adding the `_meshWorldUploadScratch` field there explicitly.

3. **Standard / PBR / Node renderables** — search the file for the line that writes the world matrix into `meshUboData` / `meshScratch`. The current pattern is likely either `data.set(wm, 0)` or a manual loop. Replace with `packMat4IntoF32(data, wm, 0)`. The remaining downstream `device.queue.writeBuffer(meshUBO, 0, data)` is already a Float32 view so it stays unchanged.

4. **`shadow/shadow-base.ts:59`** — replace:

   ```ts
   device.queue.writeBuffer(c.meshUBO, 0, c.worldMatrix as Float32Array<ArrayBuffer>);
   ```

   with the pack-into-scratch pattern. Place the scratch on the caster record `c`. The exact field name should follow the existing convention in that file — likely `c._uploadScratch` or similar.

5. After all edits, verify that no remaining mesh-world `writeBuffer` call receives a `Mat4` directly. Run:

    ```text
    Select-String -Path .\packages\babylon-lite\src -Pattern 'writeBuffer\([^,]+,\s*0,\s*\w*[Ww]orld[A-Za-z]*' -Recurse
    ```

    Expected results: zero direct mat4-to-writeBuffer calls in `render/`, `material/standard/`, `material/pbr/`, `material/node/`, `shadow/shadow-base.ts`. (Skybox, gpu-picker, gaussian-splatting, background-* are deferred — not in scope here.)

## Testing suggestions

- Existing parity coverage: every PBR, Standard, Node-material, and shadow-using parity scene exercises these paths. Run a focused subset first:
    - `npx playwright test tests/parity/scenes/scene1-pbr-cube.spec.ts` (or the smallest PBR scene)
    - `npx playwright test tests/parity/scenes/sceneN-standard-*.spec.ts`
    - one shadow-using scene
- Then `pnpm test:parity` — full suite must be green.
- Add a small unit test `tests/unit/mesh-ubo-pack.test.ts`:
    - Build a fake `Float32Array(16)` upload buffer.
    - Build an F64-backed mat4 with values that lose precision in F32 (e.g., element [12] = 100000.000123456789).
    - Call the upstream composition site directly (or factor it out so the test can call it) — the test asserts the upload buffer contains `Math.fround(...)` of the source values, proving the pack happened.
- `pnpm exec vitest run` — green.

## Gotchas

- The scratch buffer **must NOT** be a module-level singleton. That violates REQ-ARCH-1 / REQ-ARCH-3 (two engines on one page would race). Tie scratch lifetime to the per-mesh / per-caster record.
- Do not `Float32Array(16)`-allocate per frame. Lazy-init once per mesh, then reuse. A grep of `new Float32Array(16)` in your modified files should produce only lazy-init-once sites.
- Some uploaders write the world matrix at a non-zero offset within a larger UBO. The `offsetFloats` parameter of `packMat4IntoF32` handles this correctly. Verify the existing offset semantics match.
- Be careful with `meshUboData` scratch reuse across renderables: if multiple meshes share the same scratch buffer reference, packing one mesh's matrix would corrupt another. Confirm the existing code allocates `meshUboData` per renderable, not globally. If not, that is a pre-existing bug — fix it as part of this task because we're already in the upload code path.
- The `node-renderable.ts:170` upload uses `pkt.meshScratch` — `pkt` is per-batch packet state. The pack site is wherever `pkt.meshScratch` gets the world matrix written into it; locate by tracing usage.
- Do not change the WGSL shader side. The GPU continues to expect `mat4x4<f32>` at the same byte offset. We are only changing how host code packs that 16-float chunk.

## Verification checklist

- [ ] `render/scene-helpers.ts:54` writes via `packMat4IntoF32` + reused scratch.
- [ ] `material/standard/standard-renderable.ts`, `material/pbr/pbr-renderable.ts`, `material/node/node-renderable.ts` (both upload sites) compose mesh world via `packMat4IntoF32` into the existing scratch buffers.
- [ ] `shadow/shadow-base.ts:59` writes via the helper.
- [ ] No remaining direct mat4 `writeBuffer` for mesh world matrices in M0 scope.
- [ ] Unit test `tests/unit/mesh-ubo-pack.test.ts` confirms F64 precision survives to the upload buffer (downcast to `Math.fround` value).
- [ ] `pnpm test:parity` is green; `pnpm exec vitest run` is green.
