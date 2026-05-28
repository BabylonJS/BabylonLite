# Task 1.2: Add gated F64 storage allocator module

## Goal

Create a new internal module `packages/babylon-lite/src/math/_mat4-storage-f64.ts` that owns Float64-backed `Mat4` allocation. The module MUST be the only place in the codebase that names `new Float64Array(16)` for matrices, and it MUST be unreachable by static import from any HPM-off code path. After this task, the F64 storage exists but is not yet wired into any factory — Task 1.3 will resolve the engine policy that pulls it in conditionally.

## Requirements addressed

REQ-ARCH-1, REQ-ARCH-2, REQ-ARCH-3, REQ-ARCH-4, REQ-ARCH-5, REQ-ARCH-6.

## Background

Babylon Lite is a tree-shakable WebGPU engine; bundle size is enforced by `tests/bundle-size.test.ts`. To preserve `REQ-ARCH-6` (HPM-off scenes do not pay for F64 code), all F64 allocation MUST live in a dedicated module that is only imported when `useHighPrecisionMatrix` is true. The architecture document (`docs/features/high-precision-matrix/architecture.md` D3) names this module explicitly.

Task 1.1 introduced `Mat4Storage = Float32Array | Float64Array` and an opaque `Mat4` interface in `packages/babylon-lite/src/math/_mat4-storage.ts`. This task adds the F64 allocator behind a parallel filename. The F32 path stays unchanged for now — every existing `new Float32Array(16) as Mat4` call site continues to work.

The architecture's `MatrixAllocator` shape is:

```ts
{ storageKind: "f32" | "f64"; allocate(): Mat4 }
```

This task creates the F64 implementation only. Task 1.3 builds the F32 default and the engine resolver that picks one.

## Files to modify / create

- `packages/babylon-lite/src/math/_mat4-storage-f64.ts` — **NEW**. Exports `createF64MatrixAllocator(): MatrixAllocator`. The only place in the package that calls `new Float64Array(16)`.
- `packages/babylon-lite/src/math/_matrix-allocator.ts` — **NEW**. Exports the shared `MatrixAllocator` type. (No F32 implementation yet — that lands in 1.3 inside `engine/engine.ts` to keep the F32 default colocated with engine state and avoid an unconditional F64-shaped import dependency.)
- `packages/babylon-lite/package.json` — Verify the `sideEffects` field. If it is `false`, no change needed. If it is an array allowlist, ensure neither new file is added to it. Do not modify any other field.
- `packages/babylon-lite/src/index.ts` — Verify it does NOT re-export `_mat4-storage-f64.ts` or `_matrix-allocator.ts`. If a barrel re-export exists for `math/`, edit it to exclude these two filenames (they are internal).

## Implementation details

1. Create `packages/babylon-lite/src/math/_matrix-allocator.ts`:

   ```ts
   import type { Mat4 } from "./types.js";
   /** @internal Per-engine matrix allocator. M0 has two implementations:
    *  the default F32 allocator (colocated with createEngine for tree-shaking)
    *  and the gated F64 allocator in `_mat4-storage-f64.ts`. */
   export interface MatrixAllocator {
       readonly storageKind: "f32" | "f64";
       /** Allocate a new zero-initialized 16-element Mat4. */
       allocate(): Mat4;
   }
   ```

2. Create `packages/babylon-lite/src/math/_mat4-storage-f64.ts`:

   ```ts
   import type { Mat4 } from "./types.js";
   import type { MatrixAllocator } from "./_matrix-allocator.js";
   /** @internal F64-backed Mat4 allocator. Only imported by createEngine
    *  inside `if (options.useHighPrecisionMatrix)`. Tree-shaken out of HPM-off
    *  bundles via `sideEffects: false` in the package manifest. */
   export function createF64MatrixAllocator(): MatrixAllocator {
       return {
           storageKind: "f64",
           allocate(): Mat4 {
               return new Float64Array(16) as unknown as Mat4;
           },
       };
   }
   ```

3. Verify `packages/babylon-lite/package.json` has `"sideEffects": false`. If it has an allowlist array (e.g. `"sideEffects": ["**/*.css"]`), confirm neither new module appears in it. If `sideEffects` is missing, **stop and ask the user** before proceeding — adding it has cross-cutting bundling implications.

4. Search the codebase for any other `new Float64Array(16)` occurrences. Today there should be zero. If any are found outside this new module, document them in the task report — the audit in Task 4.1 will enforce the rule going forward.

5. Run `Select-String -Path .\packages\babylon-lite\src\index.ts -Pattern '_mat4-storage|_matrix-allocator'` — expect zero matches.

## Testing suggestions

- `pnpm exec tsc --noEmit` — must compile cleanly even though the F64 module is currently dead code (no static importer yet). TypeScript does not flag unused exports.
- `pnpm build:bundle-scenes` — confirm bundle sizes are unchanged (the new module isn't reachable from any scene yet, so it must NOT increase any ceiling). If any ceiling moves, stop — it means the module is being pulled in unintentionally.
- `pnpm exec vitest run` — green.
- `pnpm test:parity` — green.

## Gotchas

- Do **not** add a re-export from `packages/babylon-lite/src/math/index.ts` (if such a barrel exists). The F64 module must remain reachable only through the engine-policy code path.
- Do **not** import `_mat4-storage-f64.ts` from `_matrix-allocator.ts`. The interface module stays free of any F64 reference. The F64 module imports the interface, not the other way around.
- The cast `new Float64Array(16) as unknown as Mat4` is intentional — `Mat4`'s opaque shape (per Task 1.1) accepts any indexable 16-length object, but TypeScript still requires the explicit cast because `Float64Array` doesn't structurally match the `__brand` field.
- If `package.json` has `"sideEffects": ["./dist/some-file.js"]`, do **not** broaden it. The default for new internal modules under `sideEffects: false` is correct.

## Verification checklist

- [ ] `packages/babylon-lite/src/math/_matrix-allocator.ts` exists and exports `MatrixAllocator` only.
- [ ] `packages/babylon-lite/src/math/_mat4-storage-f64.ts` exists and exports `createF64MatrixAllocator`.
- [ ] No file outside `_mat4-storage-f64.ts` calls `new Float64Array(16)` (verified with grep).
- [ ] `packages/babylon-lite/src/index.ts` does not re-export either new file.
- [ ] `packages/babylon-lite/package.json` `sideEffects` value is unchanged from before this task.
- [ ] `pnpm build:bundle-scenes` produces unchanged bundle sizes (no ceiling shift in `tests/bundle-size.test.ts`).
- [ ] `pnpm test:parity` is green.
