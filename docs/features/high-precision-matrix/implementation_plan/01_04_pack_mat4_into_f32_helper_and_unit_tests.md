# Task 1.4: `packMat4IntoF32` helper module and unit tests

## Goal

Introduce the single F64→F32 GPU upload boundary helper, `packMat4IntoF32(view, mat, offset?)`, in a new pure module `packages/babylon-lite/src/math/pack-mat4-into-f32.ts`. The helper packs one `Mat4` (either F32-backed or F64-backed) into a caller-owned `Float32Array` view at an optional float offset. After this task, the helper exists with full unit-test coverage but no GPU uploader uses it yet — Phase 3 wires it into the REQ-UPL-2 inventory.

## Requirements addressed

REQ-UPL-1, REQ-UPL-3.

## Background

Babylon Lite is WebGPU-only and writes matrix data to GPU buffers via `device.queue.writeBuffer(...)` from `Float32Array` upload views. Today many uploaders copy directly from a matrix to a `Float32Array` upload scratch (or use `.set(mat)`), which works only because every matrix is currently F32. M0 must support F64-backed matrices on CPU; the only supported downcast point is this helper. WGSL stays `mat4x4<f32>` on the GPU side — no shader changes are part of M0.

The architecture (D4) names the contract precisely:

- Pure function in `packages/babylon-lite/src/math/pack-mat4-into-f32.ts`.
- Signature: `packMat4IntoF32(view: Float32Array, mat: Mat4, offsetFloats?: number): void`.
- Writes 16 floats starting at `offsetFloats` (default 0) of `view`.
- Does NOT allocate.
- Does NOT subtract floating-origin offsets (REQ-UPL-3 — that is M1).
- Does NOT special-case any matrix kind (e.g., view, projection).

There is precedent in the codebase for pure data-packing helpers: `packages/babylon-lite/src/math/write-vec3.ts` follows the same shape. Use it as the style reference.

## Files to modify / create

- `packages/babylon-lite/src/math/pack-mat4-into-f32.ts` — **NEW**. Exports `packMat4IntoF32`. Internal-only by convention but exported with a normal name (no leading `_`) because it is used widely by uploaders. NOT re-exported from the package's public `index.ts`.
- `tests/unit/pack-mat4-into-f32.test.ts` — **NEW**. Unit tests covering F32 source, F64 source, offset, and edge cases.
- `packages/babylon-lite/src/index.ts` — Verify the helper is NOT re-exported. If a math barrel re-export exists, exclude this filename.

## Implementation details

1. Create `packages/babylon-lite/src/math/pack-mat4-into-f32.ts`:

   ```ts
   import type { Mat4 } from "./types.js";
   import { asMat4Storage } from "./_mat4-storage.js";

   /** @internal Pack one Mat4 into a Float32Array upload view at the given float
    *  offset. Source storage may be F32 or F64; this is the only place in the
    *  package where F64→F32 downcast happens for GPU upload. Does not allocate.
    *  Does not perform floating-origin offset subtraction (REQ-UPL-3). */
   export function packMat4IntoF32(view: Float32Array, mat: Mat4, offsetFloats: number = 0): void {
       const src = asMat4Storage(mat);
       view[offsetFloats + 0] = src[0]!;
       view[offsetFloats + 1] = src[1]!;
       view[offsetFloats + 2] = src[2]!;
       view[offsetFloats + 3] = src[3]!;
       view[offsetFloats + 4] = src[4]!;
       view[offsetFloats + 5] = src[5]!;
       view[offsetFloats + 6] = src[6]!;
       view[offsetFloats + 7] = src[7]!;
       view[offsetFloats + 8] = src[8]!;
       view[offsetFloats + 9] = src[9]!;
       view[offsetFloats + 10] = src[10]!;
       view[offsetFloats + 11] = src[11]!;
       view[offsetFloats + 12] = src[12]!;
       view[offsetFloats + 13] = src[13]!;
       view[offsetFloats + 14] = src[14]!;
       view[offsetFloats + 15] = src[15]!;
   }
   ```

   Unrolling 16 element copies is intentional and matches the style of mat4 kernels (`mat4-multiply-into.ts`, `mat4-compose-into.ts`). Do NOT use `view.set(src, offsetFloats)` — that path is the one we are explicitly auditing OUT in Task 4.1, and it does not perform F64→F32 conversion correctly when `src` is `Float64Array` (V8's `set` will downcast each element, which actually is correct numerically; we still avoid the path because it is what the audit script is forbidding outside this file).

2. Create `tests/unit/pack-mat4-into-f32.test.ts` covering:

    - **F32 source** — pack a Float32Array-backed `Mat4` at offset 0, verify all 16 elements equal source.
    - **F64 source with values representable in F32** — pack a Float64Array-backed `Mat4`, verify exact equality.
    - **F64 source with values that lose precision in F32** — pack a Float64Array containing `100000.000123456789` at index 12 (a translation-like value), verify the destination contains `Math.fround(100000.000123456789)` exactly. This test documents the downcast contract.
    - **Offset > 0** — pack into a 32-float view at offset 16; assert offsets 0..15 are untouched and offsets 16..31 contain the matrix.
    - **No allocation** — verify the function's return value is `undefined` and the `view` argument is the only output (this is implicit from signature, but assert via `expect(packMat4IntoF32(...)).toBeUndefined()`).
    - **Identity preservation** — pack `mat4Identity()` (F32) into a fresh view, assert the upload-view bytes match the original Float32Array byte-for-byte.

3. Confirm `packages/babylon-lite/src/index.ts` does NOT export `pack-mat4-into-f32.ts`. The helper is internal-package; its consumers in Phase 3 will import it directly via relative path.

## Testing suggestions

- `pnpm exec vitest run tests/unit/pack-mat4-into-f32.test.ts` — all cases pass.
- `pnpm exec tsc --noEmit` — clean.
- `pnpm build:bundle-scenes` — confirm no bundle-size ceiling moves. The new module is unreachable from any scene yet; expect zero delta.
- `pnpm test:parity` — green.

## Gotchas

- The function deliberately accepts `Mat4` (the opaque public type from Task 1.1), not `Mat4Storage` directly. Callers always have a `Mat4` in hand at upload time. Internally we convert via `asMat4Storage`.
- Do not add an early-return based on storage kind ("if F32, just `view.set(src, off)`"). Branching adds cost, and inlined unrolled writes are uniformly fast across both source types.
- The `view` argument is a `Float32Array`, NOT a generic typed array. GPU upload buffers in this codebase are always `Float32Array<ArrayBuffer>` (see e.g. `frame-graph/render-task.ts:522`). Do not generalize the parameter.
- The `offsetFloats` argument is in **floats**, not bytes. This matches `write-vec3.ts` (line ~10 of that file) and the existing convention.
- Do NOT add an `offset` parameter for floating-origin eye-position subtraction. That is M1 (LWR floating-origin) and would violate REQ-UPL-3.
- Do not export the helper from the package barrel. It is internal — Phase 3 consumers import it via direct relative path.

## Verification checklist

- [ ] `packages/babylon-lite/src/math/pack-mat4-into-f32.ts` exists and matches the contract above.
- [ ] `tests/unit/pack-mat4-into-f32.test.ts` covers F32 source, F64 source (representable + lossy), offset > 0, identity round-trip, and no-allocation.
- [ ] All new unit tests pass under `pnpm exec vitest run`.
- [ ] `packages/babylon-lite/src/index.ts` does not re-export the helper.
- [ ] `pnpm test:parity` is green.
- [ ] `pnpm build:bundle-scenes` produces no ceiling regression.
- [ ] Searching the codebase for `view.set(mat` or `data.set(mat` outside this helper turns up only the legacy direct uploaders that Phase 3 will rewrite (record this list — it becomes input for Task 4.1).
