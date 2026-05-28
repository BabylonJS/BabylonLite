# Task 1.1: Widen `Mat4` to an opaque branded type and add internal `Mat4Storage`

## Goal

Change the public `Mat4` declaration so it does not name `Float32Array` or `Float64Array`, and add an internal-only union type `Mat4Storage = Float32Array | Float64Array` for use by kernels, allocators, and the upload packer. After this task, `pnpm exec tsc --noEmit` builds clean and the emitted public `.d.ts` for `@babylonjs-lite/...` contains no `Float64Array`-bearing form of `Mat4`.

## Requirements addressed

REQ-API-1, REQ-API-4, REQ-ARCH-3.

## Background

Babylon Lite is a tree-shakable WebGPU 3D engine published from `packages/babylon-lite/`. Public API surface is opaque-by-convention: the engine is functional, not class-based, and types like `Mat4` are exposed as branded typed arrays so callers cannot peek at storage. See `GUIDANCE.md` §4 for the architectural rules.

This task is the entry point of the high-precision-matrix M0 milestone. The flag `useHighPrecisionMatrix` exists on `EngineContext` (`packages/babylon-lite/src/engine/engine.ts:27`) and on `EngineOptions` (line 120) but does nothing observable. M0 makes it load-bearing. Step 1 is widening the public matrix type so internal code can hold a `Float64Array` behind the opaque `Mat4`.

The architecture (`docs/features/high-precision-matrix/architecture.md` D1) requires:

- The public `.d.ts` MUST NOT contain `Mat4F32`, `Mat4F64`, or any `Float32Array | Float64Array` union associated with `Mat4`.
- An internal `Mat4Storage` view exists for kernels and allocators to use behind the brand.

This task ONLY touches the type declarations and the kernel parameter signatures. It does NOT change runtime behavior — every existing call site keeps working because `Float32Array` (the only storage shipped today) still satisfies the new shape.

## Files to modify / create

- `packages/babylon-lite/src/math/types.ts` — Replace the `Mat4 = Float32Array & {...}` declaration with an opaque branded interface. Keep all other types in this file unchanged.
- `packages/babylon-lite/src/math/_mat4-storage.ts` — **NEW** internal-only module exporting `Mat4Storage` and a small set of internal helpers (`asMat4Storage(m: Mat4): Mat4Storage` cast, `isF64Storage(m: Mat4Storage): boolean`). Filename starts with `_` to mark it internal. NOT re-exported from `packages/babylon-lite/src/index.ts`.
- `packages/babylon-lite/src/math/mat4-multiply-into.ts`, `mat4-compose-into.ts`, `mat4-perspective-lh-to-ref.ts` — Widen `Float32Array` parameter types to `Mat4Storage` (= `Float32Array | Float64Array`) where the function reads or writes a mat4. Body is index-arithmetic only, so widening is type-only.
- `packages/babylon-lite/src/math/mat4-identity.ts`, `mat4-compose.ts`, `mat4-from-quat.ts`, `mat4-multiply.ts`, `mat4-perspective-lh.ts`, `mat4-scale.ts`, `mat4-translation.ts`, `mat4-look-at-lh.ts`, `mat4-invert.ts` — These currently allocate `new Float32Array(16) as Mat4`. Leave the allocation as-is for now (Task 1.3 wires the engine policy that flows the choice through). Only widen any parameter typed `Float32Array` to `Mat4Storage` in this task. Tag the allocation site with a `// TODO(M0/01_03): allocate via engine policy` comment so the next task is unambiguous.
- `packages/babylon-lite/src/math/mat4.ts` — If this re-exports anything, ensure no F64 type leaks into the public re-export.

## Implementation details

1. In `packages/babylon-lite/src/math/types.ts`, replace the existing line `export type Mat4 = Float32Array & { readonly __brand: "Mat4" };` with:

   ```ts
   export interface Mat4 {
       readonly __brand: "Mat4";
       readonly length: 16;
       readonly [index: number]: number;
   }
   ```

   Keep the JSDoc comment about WGSL `mat4x4<f32>` memory order. Internal modules cast through `Mat4Storage` from `_mat4-storage.ts` when they need real array semantics.

2. Create `packages/babylon-lite/src/math/_mat4-storage.ts`:

   ```ts
   import type { Mat4 } from "./types.js";
   /** @internal Storage view used by kernels, allocators, and the upload packer.
    *  This module MUST NOT be re-exported from packages/babylon-lite/src/index.ts. */
   export type Mat4Storage = Float32Array | Float64Array;
   /** @internal Reinterpret an opaque Mat4 as its concrete storage view. */
   export function asMat4Storage(m: Mat4): Mat4Storage {
       return m as unknown as Mat4Storage;
   }
   /** @internal True iff the storage is Float64Array. */
   export function isF64Storage(m: Mat4Storage): boolean {
       return m.BYTES_PER_ELEMENT === 8;
   }
   ```

3. In every kernel that currently takes `Float32Array` as a mat4 in/out parameter, widen the parameter type to `Float32Array | Float64Array` (you may either inline the union, or import `Mat4Storage` from `_mat4-storage.ts` — pick one and use it consistently). Do NOT change runtime semantics. Existing callers pass `Float32Array`, which still matches.

4. For functions that currently accept `Mat4` and immediately type-assert to `Float32Array` (search for `as Float32Array`), replace the cast with `asMat4Storage(m)` so storage code paths stay honest. There should be zero `as Float32Array` casts on something originally typed `Mat4` after this task.

5. Search the math/ directory for `Mat4F32` or `Mat4F64` — these names MUST NOT appear in any source file shipped from `packages/babylon-lite/`. If you encounter them in this task or any subsequent one, rename to `Mat4Storage` (internal) or remove (public).

6. Verify no public re-export leaks the union: `packages/babylon-lite/src/index.ts` and `packages/babylon-lite/src/math/index.ts` (if any) MUST NOT re-export from `_mat4-storage.ts`.

## Testing suggestions

- `pnpm exec tsc --noEmit` in the repo root — must build clean.
- Build the package: `pnpm build:bundle-scenes` should still succeed unchanged.
- Inspect emitted declaration: `pnpm --filter @babylonjs-lite/... build` (or whatever the package's build emits) and `Select-String -Path .\packages\babylon-lite\dist\**\*.d.ts -Pattern 'Float64Array|Mat4F32|Mat4F64'` — expect zero hits associated with `Mat4`.
- Unit tests: `pnpm exec vitest run` — existing tests in `tests/unit/` continue to pass (this task is type-only).
- Visual baseline: `pnpm test:parity` should remain green — type-only change.

## Gotchas

- TypeScript `interface` is structurally equivalent to `Float32Array` for index access, so existing call sites still work without casts; you only need casts where the function is *consuming* a `Mat4` and needs Float32Array-specific methods like `.set()`. In those cases use `asMat4Storage(m)` from the new internal module.
- Do NOT add any side-effectful import or top-level statement to `_mat4-storage.ts`. It is a pure type module.
- The interface form `interface Mat4 extends Float32Array {}` is **wrong** here because it leaks `Float32Array` back into the public type. Use the structural shape exactly as shown.
- Some existing helpers may be typed to return `Mat4` and be called as if they were a `Float32Array` (e.g. used directly in `device.queue.writeBuffer`). Those upload sites are in scope for Phase 3 and not this task — the new opaque `Mat4` is still indexable, but `writeBuffer` callers will need to either pass through the packer (Phase 3) or temporarily cast via `asMat4Storage` to keep the build green. Use the temporary cast and tag with `// TODO(M0/03_*): pack through packMat4IntoF32`.

## Verification checklist

- [ ] `packages/babylon-lite/src/math/types.ts` declares `Mat4` as an opaque interface with `__brand`, `length: 16`, and `[index: number]: number` only.
- [ ] `packages/babylon-lite/src/math/_mat4-storage.ts` exists and exports `Mat4Storage`, `asMat4Storage`, `isF64Storage`.
- [ ] Neither `Mat4F32`, `Mat4F64`, nor `Float32Array | Float64Array` literally tied to `Mat4` appears in `packages/babylon-lite/dist/**/*.d.ts`.
- [ ] `packages/babylon-lite/src/index.ts` does not re-export `_mat4-storage.ts`.
- [ ] `pnpm exec tsc --noEmit` is clean.
- [ ] `pnpm exec vitest run` is green.
- [ ] `pnpm test:parity` is green (no rendered output should change).
