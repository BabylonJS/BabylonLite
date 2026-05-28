# Task 3.5: Route shadow matrix writes through `packMat4IntoF32`

## Goal

Every shadow-related mat4 GPU upload — caster mesh world matrix (already covered in Task 3.1), shadow projection / view matrices, PCF / PCSS shadow map matrices — must go through `packMat4IntoF32`. After this task, with HPM on, shadow maps render with the correct downcast view of high-precision shadow matrices.

## Requirements addressed

REQ-UPL-1, REQ-UPL-2.

## Background

`packages/babylon-lite/src/math/pack-mat4-into-f32.ts` exports `packMat4IntoF32` (Task 1.4, possibly amended by Task 3.4 to accept `srcOffsetFloats`).

Shadow matrix uploads in M0 scope:

- `packages/babylon-lite/src/shadow/shadow-base.ts:307` — first non-mesh-world shadow matrix write.
- `packages/babylon-lite/src/shadow/shadow-base.ts:309` — second.
- `packages/babylon-lite/src/shadow/pcf-directional-shadow-generator.ts:281` — PCF shadow generator matrix write.

The mesh-world matrix in `shadow-base.ts:59` is already covered by Task 3.1.

Each of these sites currently writes a mat4 (likely a shadow-light view, projection, or composite VP matrix) into a Float32 upload scratch or directly to `writeBuffer`. After Task 2.3, the matrices may be F64-backed (e.g., a directional light's view matrix derived from its `_localMatrix` cache, which is now policy-precision).

## Files to modify

- `packages/babylon-lite/src/shadow/shadow-base.ts` (lines 307, 309) — Replace each direct mat4 GPU write or `.set(mat)` into a scratch with `packMat4IntoF32(scratch, mat, offset)`.
- `packages/babylon-lite/src/shadow/pcf-directional-shadow-generator.ts:281` — Same.

Open both files and read ~30 lines around each cited line to determine: (a) what scratch buffer / upload destination is involved, (b) the byte offset, (c) whether the matrix source is per-frame computed or cached on the shadow generator. Adjust your edits accordingly.

## Implementation details

1. Add the helper import at the top of each modified file:

   ```ts
   import { packMat4IntoF32 } from "../math/pack-mat4-into-f32.js";
   ```

2. **`shadow-base.ts:307,309`** — likely composing a shadow UBO (e.g., light-space VP for caster pass). For each:

   ```ts
   // Before:
   data.set(shadowVP, OFFSET);
   // After:
   packMat4IntoF32(data, shadowVP, OFFSET);
   ```

   Or if the call is `device.queue.writeBuffer(buf, byteOffset, mat)` directly, refactor to: pack into a reused per-shadow-generator F32 scratch, then `writeBuffer(buf, byteOffset, scratch)`.

3. **`pcf-directional-shadow-generator.ts:281`** — same pattern. The PCF generator likely has its own per-instance state object; place any new `_uploadScratch` field there (never module-level).

4. If shadow-related state on a shadow generator (e.g., `_shadowVPCache: Mat4`) was widened to policy-precision in Task 2.3, the matrix entering `packMat4IntoF32` here is already the right type. If it was missed in Task 2.3, audit and either (a) widen now and document why, or (b) leave as F32 and document that the shadow generator's internal matrix is intentionally F32-only (a constrained design choice, not a bug).

## Testing suggestions

- Run a shadow-using parity scene focused: `npx playwright test tests/parity/scenes/sceneN-<shadow-scene>.spec.ts` (locate by inspecting `lab/public/scene-config.json`).
- `pnpm test:parity` — full suite green.
- Add unit test `tests/unit/shadow-ubo-pack.test.ts`:
    - Stub a shadow generator with an F64 shadow VP matrix.
    - Capture the upload bytes.
    - Assert F32 contents match `Math.fround` of the F64 source.

## Gotchas

- Shadow caster meshes are uploaded via `shadow-base.ts:59` which Task 3.1 already covers. Do not double-edit that line.
- Some shadow generators allocate per-frame scratch (anti-pattern even pre-HPM). If you spot this while editing, fix it (lazy + reuse on the per-generator state) — it's tightly coupled to the GPU write path you're already touching.
- Do not change WGSL shader bindings, byte offsets, or UBO layout. Only change how host code packs the same 16 floats.
- PCSS variants (if any) of the directional shadow generator follow the same pattern; if a `pcss-*-shadow-generator.ts` file exists in the same directory, audit it too — likely needs the same treatment, in scope here.

## Verification checklist

- [ ] `shadow-base.ts:307` and `:309` use `packMat4IntoF32` for mat4 writes.
- [ ] `pcf-directional-shadow-generator.ts:281` uses `packMat4IntoF32`.
- [ ] No remaining direct `.set(mat)` or direct `writeBuffer(buf, 0, mat)` for shadow mat4 fields.
- [ ] Per-generator upload scratches are reused (no per-frame `new Float32Array(16)`).
- [ ] Unit test `tests/unit/shadow-ubo-pack.test.ts` confirms downcast happens at the boundary.
- [ ] `pnpm test:parity` green; `pnpm exec vitest run` green.
