# Task 3.4: Widen thin-instance API and route upload through `packMat4IntoF32`

## Goal

Allow the thin-instance API to accept a packed `Float32Array | Float64Array` slab of N×16 floats, and ensure the GPU upload path packs through `packMat4IntoF32` (per-instance) into a per-mesh F32 upload scratch. After this task, callers can pass F64 thin-instance matrices when HPM is on; the GPU still receives F32. No new public API is added (per architecture D5).

## Requirements addressed

REQ-API-3 (thin-instance widening), REQ-UPL-1, REQ-UPL-2.

## Background

Thin-instance state and upload live in:

- `packages/babylon-lite/src/mesh/thin-instance.ts` — public `setThinInstances(mesh, matrices)` and `ThinInstanceData` shape.
- `packages/babylon-lite/src/mesh/thin-instance-gpu.ts:33` — GPU upload site.

Today `setThinInstances` accepts a `Float32Array` of length `N * 16`. After this task it accepts `Float32Array | Float64Array`. The internal `ThinInstanceData.matrices` field widens to the same union.

Per architecture decision D5: **no second public API**. The same call site accepts either typed array. We do NOT introduce `setThinInstancesF64` or similar.

The GPU upload composes a per-mesh Float32 upload buffer (sized `N * 16 * 4` bytes). For each instance `i`, the upload buffer slot at `i * 16` is filled by calling `packMat4IntoF32(uploadF32, source.subarray(i*16, i*16+16) as unknown as Mat4, i*16)` — except `subarray` of `Float64Array` does not produce a `Mat4` view; instead, pass the whole source slab and the source offset to a slight extension of the helper, OR copy to a small reusable 16-float scratch (less efficient).

**Preferred approach:** extend `packMat4IntoF32` (Task 1.4) to accept an optional `srcOffsetFloats` argument: `packMat4IntoF32(view, mat, offsetFloats?, srcOffsetFloats?)`. If `srcOffsetFloats` is omitted, treat `mat` as a length-16 mat4 starting at index 0 (current behavior). If provided, read 16 floats starting at `mat[srcOffsetFloats]`.

**Fallback approach (if extending the helper feels too invasive):** keep the helper at length-16 only and use `Float32Array.subarray` on the source when it's F32, or a small per-call scratch + manual copy when source is F64.

Pick the preferred approach. Update Task 1.4's helper signature accordingly (this task may amend the helper signature; that's fine — Phase 1 has not been coded yet, this task is part of the same plan).

## Files to modify

- `packages/babylon-lite/src/math/pack-mat4-into-f32.ts` — Add `srcOffsetFloats` parameter. Default 0. Behavior: read source at `[srcOffsetFloats..srcOffsetFloats+15]`, downcast to `Math.fround` (or rely on the implicit F64→F32 conversion when assigning to a Float32Array element), write to dest at `[offsetFloats..offsetFloats+15]`.
- `packages/babylon-lite/src/math/pack-mat4-into-f32.test.ts` (or wherever Task 1.4's test lives) — Add a test for the strided read variant: source is a `Float64Array(32)` with two mat4 slabs; calling with `srcOffsetFloats=16` packs the second slab.
- `packages/babylon-lite/src/mesh/thin-instance.ts` — Widen `ThinInstanceData.matrices: Float32Array` → `Float32Array | Float64Array`. Widen `setThinInstances(mesh, matrices)` parameter type to the union. Widen any helper that returns `matrices`. Internal logic that *reads* per-element values uses index access (precision-agnostic).
- `packages/babylon-lite/src/mesh/thin-instance-gpu.ts:33` — At the upload composition, allocate a per-mesh F32 upload scratch sized `N * 16` once (lazy + grow when N grows). For each instance `i`, call `packMat4IntoF32(uploadF32, matrices, i*16, i*16)`. Then `device.queue.writeBuffer(buf, 0, uploadF32)`.

## Implementation details

1. **Helper signature change** in `math/pack-mat4-into-f32.ts`:

   ```ts
   export function packMat4IntoF32(
       view: Float32Array,
       mat: Mat4 | Float32Array | Float64Array,
       offsetFloats: number = 0,
       srcOffsetFloats: number = 0,
   ): void {
       // 16-element copy with optional source offset
   }
   ```

   Widen `mat` to accept a generic typed-array slab so callers don't need to lie about the brand. The Mat4 brand was an opaque interface (Task 1.1) — the helper is a privileged internal that can take either a single-mat4 view or a packed slab.

2. **`thin-instance.ts`** — change every reference from `Float32Array` to `Float32Array | Float64Array` for the `matrices` field and parameter. Internal validation should check `matrices.length % 16 === 0` (still valid for both). When constructing the entity from a freshly allocated thin-instance buffer (e.g., for animated paths), respect the engine's matrix policy — query `engineCtx._matrixPolicy.allocateMat4Pack(N)` if such a helper exists, else `policy.precision === "f64" ? new Float64Array(N*16) : new Float32Array(N*16)`. The exact policy API surface is from Task 1.2 / 1.3; align with whatever name was chosen there.

3. **`thin-instance-gpu.ts:33`** — current code likely does:

   ```ts
   device.queue.writeBuffer(buf, 0, matrices as unknown as Float32Array<ArrayBuffer>);
   ```

   That works only when `matrices` is `Float32Array`. Replace with:

   ```ts
   const upload = ensureF32Upload(state, N); // lazy alloc, reuse, grow when N grows
   for (let i = 0; i < N; i++) packMat4IntoF32(upload, matrices, i * 16, i * 16);
   device.queue.writeBuffer(buf, 0, upload);
   ```

   `ensureF32Upload` is a small local helper (or inline) tied to the per-mesh thin-instance state object — never module-local.

4. **Fast path optimization (optional but recommended):** if `matrices instanceof Float32Array`, the existing direct upload is byte-equivalent and faster. Branch:

   ```ts
   if (matrices instanceof Float32Array) {
       device.queue.writeBuffer(buf, 0, matrices);
   } else {
       // F64 slab → pack loop above.
   }
   ```

   This keeps the HPM-off path zero-cost.

5. Update any TypeScript types / `.d.ts` outputs (the public-API check from Task 1.1) — `setThinInstances` parameter now accepts `Float32Array | Float64Array`. Confirm the rolled-up `.d.ts` does NOT name `Float64Array` for any `Mat4` symbol; this is a `setThinInstances` parameter, not a `Mat4`, so naming `Float64Array` here is allowed.

## Testing suggestions

- Add unit test `tests/unit/thin-instance-pack.test.ts`:
    - Build a `Float64Array(2 * 16)` with two mat4s where element [12] is precision-sensitive.
    - Call the (factored-out) thin-instance pack-and-upload helper against a fake `device.queue.writeBuffer` capture.
    - Assert the captured F32 buffer has correct `Math.fround` values at both instance offsets.
- A parity scene exercising thin instances exists (search `lab/public/scene-config.json` for "thin"). Run it focused: `npx playwright test tests/parity/scenes/sceneN-thin-*.spec.ts`.
- `pnpm test:parity` — full suite green.
- `pnpm exec vitest run` — green.

## Gotchas

- Do NOT split the public API into `setThinInstances` + `setThinInstancesF64`. The whole architecture decision D5 is one parameter that accepts either. Reviewers will look for two functions and reject.
- Do NOT introduce per-frame allocation. The upload scratch grows when N grows but is reused otherwise. Track `state._uploadCapacity` alongside `state._upload`.
- The fast path `if (matrices instanceof Float32Array) { device.queue.writeBuffer(buf, 0, matrices); }` skips packing entirely. That is fine — F32 → F32 needs no downcast. The audit script (Task 4.1) must allowlist this exact site, or the audit must restrict the rule to mat4-typed writes (not slab-typed). Note this in the audit allowlist.
- `Float64Array.subarray(off, off+16)` returns a Float64 view. It is NOT a `Mat4`. Do not try to brand it. Use the new `srcOffsetFloats` parameter on the helper instead.
- After widening the type, callers that pass `new Float32Array(...)` keep working unchanged. Callers that build from `Float64Array` (M0 pattern under HPM) start working. Confirm via TypeScript: `pnpm exec tsc --noEmit` — no errors.

## Verification checklist

- [ ] `packMat4IntoF32` accepts an optional `srcOffsetFloats` parameter; unit test covers the strided read.
- [ ] `setThinInstances` parameter and `ThinInstanceData.matrices` are `Float32Array | Float64Array`.
- [ ] `thin-instance-gpu.ts` upload path packs every F64 instance through the helper into a per-mesh reused F32 upload scratch; F32 input takes the direct-upload fast path.
- [ ] No public API addition (no `setThinInstancesF64` or similar).
- [ ] Public `.d.ts` does NOT name `Float64Array` for any `Mat4`-typed symbol.
- [ ] Unit test `tests/unit/thin-instance-pack.test.ts` confirms F64 precision is downcast at the boundary.
- [ ] `pnpm test:parity` green; `pnpm exec vitest run` green; `pnpm exec tsc --noEmit` clean.
