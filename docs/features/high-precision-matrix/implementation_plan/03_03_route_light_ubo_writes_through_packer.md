# Task 3.3: Route light UBO writes through `packMat4IntoF32`

## Goal

Every mat4 field in a light UBO upload must go through `packMat4IntoF32`. After this task, when light local/world matrices are F64-backed (Task 2.3), the GPU receives a correctly-downcast F32 copy via the shared boundary.

## Requirements addressed

REQ-UPL-1, REQ-UPL-2.

## Background

`packages/babylon-lite/src/math/pack-mat4-into-f32.ts` exports the `packMat4IntoF32` helper (Task 1.4).

Light state and uploads live in:

- `packages/babylon-lite/src/render/lights-ubo.ts` — `state._scratch` is the Float32 scratch used to compose the lights UBO. The actual `writeBuffer` call is at line 110.
- `packages/babylon-lite/src/light/light-matrix.ts` — produces `Mat4` outputs that may be F64-backed after Task 2.3.
- `packages/babylon-lite/src/light/directional-light.ts`, `hemispheric.ts`, `spot-light.ts` — `_localMatrix` storage. After Task 2.3 may be F64.

The light UBO composition writes a small set of mat4 fields per light (typically a world-or-local matrix per light type, plus possibly a view matrix for spot lights' shadow-related fields). The composition is currently performed via numeric assignments to `_scratch` (per the grep evidence — no direct `.set(mat)` calls in `lights-ubo.ts`). Wherever a mat4 is composed into `_scratch` element-by-element, **replace the manual loop with `packMat4IntoF32(state._scratch, mat, offsetFloats)`** so the boundary is centralized and auditable.

## Files to modify

- `packages/babylon-lite/src/render/lights-ubo.ts` — In every spot where a light mat4 is written into `state._scratch` (whether by `.set(mat, off)` or a manual `_scratch[off+i] = mat[i]` loop), replace with `packMat4IntoF32(state._scratch, mat, off)`. The downstream `device.queue.writeBuffer(state._buffer, 0, state._scratch)` at line 110 stays unchanged.

If lights have any other matrix upload path not in `lights-ubo.ts`, also route through the helper. Verify with:

```text
Select-String -Path .\packages\babylon-lite\src\light -Pattern 'writeBuffer|new Float32Array' -Recurse
Select-String -Path .\packages\babylon-lite\src\render\lights-ubo.ts -Pattern '_scratch\['
```

The first command surfaces any direct GPU writes from `light/`; the second shows every `_scratch` write site so you can identify which are mat4 (16 consecutive float assignments) versus per-element scalars (color, intensity, range, etc.).

## Implementation details

1. Import:

   ```ts
   import { packMat4IntoF32 } from "../math/pack-mat4-into-f32.js";
   ```

2. Locate the per-light mat4 composition in `lights-ubo.ts`. It typically sits inside a per-light loop indexed by `lightIndex`, with byte offsets computed as `LIGHT_STRIDE_FLOATS * lightIndex + LIGHT_MATRIX_FIELD_OFFSET`. For each such site:

   ```ts
   // Before (manual loop):
   for (let k = 0; k < 16; k++) state._scratch[off + k] = m[k]!;
   // After:
   packMat4IntoF32(state._scratch, m, off);
   ```

3. Per-element scalar writes (color RGB, intensity, range, attenuation) stay as-is — they are not mat4 and not in REQ-UPL-2 scope.

4. If `lights-ubo.ts` reads matrices from `light._localMatrix` or `light.worldMatrix`, after Task 2.3 those may be F64. Confirm the read pathway uses `Mat4` typing (or `asMat4Storage`) so it is precision-agnostic before being handed to `packMat4IntoF32`.

## Testing suggestions

- Parity scenes that exercise lights: any with directional + spot + hemispheric lights. Run focused first:
    - `npx playwright test tests/parity/scenes/sceneN-<lit-scene>.spec.ts` (locate by inspecting `lab/public/scene-config.json`).
- `pnpm test:parity` — full suite green.
- Add unit test `tests/unit/lights-ubo-pack.test.ts`:
    - Build a stub light with an F64 `_localMatrix` containing precision-sensitive values.
    - Call the (factored-out) UBO composition function with the stub.
    - Assert `_scratch` at the matrix-field offset contains `Math.fround` of the source.

## Gotchas

- Light UBOs are tightly packed; off-by-one in float offsets corrupts later light data. Verify the offset constants you pass to `packMat4IntoF32` exactly match the offsets the original code wrote at.
- Do NOT introduce a new scratch buffer; reuse `state._scratch`. The state object is per-scene-light-system, which is per-scene, which is per-engine — isolation is preserved.
- If a shadow-projection matrix is uploaded as part of the per-light UBO (rather than via `shadow-base.ts`), check carefully: that mat4 also goes through the helper. The audit script in Task 4.1 will fail otherwise.
- Lights without any mat4 in their UBO (a pure point light may upload only position + color + intensity) are unchanged.

## Verification checklist

- [ ] Every mat4 write into `state._scratch` in `lights-ubo.ts` uses `packMat4IntoF32`.
- [ ] No direct `Float32Array.set(mat)` or 16-element manual loops remain for light matrices.
- [ ] Unit test `tests/unit/lights-ubo-pack.test.ts` confirms F64 precision is correctly downcast.
- [ ] `pnpm test:parity` is green.
- [ ] `pnpm exec vitest run` is green.
