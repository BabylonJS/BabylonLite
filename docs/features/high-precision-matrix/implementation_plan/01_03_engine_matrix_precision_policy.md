# Task 1.3: Engine matrix-precision policy resolution

## Goal

Resolve a real `MatrixAllocator` on `EngineContextInternal` at engine creation. When `options.useHighPrecisionMatrix === true`, the engine pulls in the F64 allocator via a static-`if` import; otherwise it uses an inline F32 default. After this task, the engine carries a per-instance allocator that future tasks (Phase 2) will capture onto scenes and entities, but no caller has changed yet — observable behavior is unchanged.

## Requirements addressed

REQ-API-2, REQ-INT-1, REQ-ARCH-1, REQ-ARCH-4.

## Background

Babylon Lite is a functional, tree-shakable WebGPU engine. Engines are constructed by `createEngine(canvas, options)` in `packages/babylon-lite/src/engine/engine.ts:124`. The `EngineContext` interface (line 13) is the public-facing shape; `EngineContextInternal` (line 54) extends it with internal fields like `_animFrameId`, `_renderFn`, `_renderingContexts`, etc.

Today the constructor stores `useHighPrecisionMatrix: options?.useHighPrecisionMatrix === true` on the engine (line 166) but nothing reads the flag. This task adds an internal `_matrixPolicy` field next to it, populated by a small resolver. The F64 allocator was created in Task 1.2 at `packages/babylon-lite/src/math/_mat4-storage-f64.ts` and exports `createF64MatrixAllocator(): MatrixAllocator`. The interface `MatrixAllocator` lives at `packages/babylon-lite/src/math/_matrix-allocator.ts` and has `{ storageKind: "f32" | "f64"; allocate(): Mat4 }`.

The architecture's tree-shaking proof (D3) requires that the F64 module is **only** loaded when HPM is on. Use a **dynamic `await import(...)`** inside `if (useHpm)`. An earlier attempt used a top-level static import + `sideEffects: false`, betting that bundlers would DCE the unused symbol; in practice esbuild/Rollup retained the static import in every bundle because the runtime `useHpm` boolean is not statically provable as false. Since `createEngine` is already `async` (it awaits GPU adapter/device), a dynamic import is the cheapest way to make the F64 module unreachable from HPM-off bundles. Verified in Task 4.2 by grepping emitted chunks for `Float64Array`.

## Files to modify / create

- `packages/babylon-lite/src/engine/engine.ts` — Add `_matrixPolicy: MatrixAllocator` to `EngineContextInternal`, build the F32 default inline, and resolve the F64 path behind a static `if`. Do NOT alter the public `EngineContext` interface.
- (No new files. The F32 default lives inline in `engine.ts` to keep the F64 module the only outbound mat4-storage import dependency.)

## Implementation details

1. In `packages/babylon-lite/src/engine/engine.ts`, add the type-only import at the top of the file:

   ```ts
   import type { MatrixAllocator } from "../math/_matrix-allocator.js";
   ```

   The F64 allocator is loaded via a **dynamic `await import(...)`** inside `createEngine`, NOT as a top-level static import. See step 4 below for rationale.

2. Add a private F32 allocator factory inside `engine.ts`, just above `createEngine`. Keep it local; do NOT export.

   ```ts
   function createF32MatrixAllocator(): MatrixAllocator {
       return {
           storageKind: "f32",
           allocate(): Mat4 {
               return new Float32Array(16) as unknown as Mat4;
           },
       };
   }
   ```

   You will need to add `import type { Mat4 } from "../math/types.js";` at the top of the file.

3. In `EngineContextInternal` (existing interface starting at line 54), add a new field:

   ```ts
   /** @internal Per-engine matrix allocator captured at createEngine. */
   _matrixPolicy: MatrixAllocator;
   ```

4. In `createEngine`, immediately before constructing the `engine` literal, resolve the policy using a **dynamic import** inside `if (useHpm)`:

   ```ts
   const useHpm = options?.useHighPrecisionMatrix === true;
   let matrixPolicy: MatrixAllocator;
   if (useHpm) {
       const { createF64MatrixAllocator } = await import("../math/_mat4-storage-f64.js");
       matrixPolicy = createF64MatrixAllocator();
   } else {
       matrixPolicy = createF32MatrixAllocator();
   }
   ```

   Then add `_matrixPolicy: matrixPolicy,` to the `engine` object literal next to `useHighPrecisionMatrix:`.

   **Why dynamic import and not a static-import + `if`-guarded ternary?** We originally tried the static-import pattern, paired with `sideEffects: false`, expecting bundlers to drop the F64 symbol when the truthy branch of a runtime ternary is "unreachable". That bet did **not** hold in practice: esbuild/Rollup (Vite) cannot prove a value-level boolean (`useHpm`) is `false` at the call site, so the static import of `_mat4-storage-f64.js` was retained in every HPM-off bundle. We verified this by grepping built bundles for `Float64Array` — every scene chunk contained it under the static-import variant. Switching to a dynamic `await import(...)` inside `if (useHpm)` makes the F64 module statically unreachable from the HPM-off path, and bundlers split it into its own chunk that is only fetched at runtime when HPM is enabled. `createEngine` is already `async` (it awaits `requestAdapter` / `requestDevice`), so this incurs no API change.

5. Verify the `useHighPrecisionMatrix` public field still mirrors the resolved policy:

   ```ts
   useHighPrecisionMatrix: useHpm,
   ```

6. Do not change any caller. No other file should import `_matrix-allocator.ts` or `_mat4-storage-f64.ts` in this task — wiring through scenes is Task 2.1.

## Testing suggestions

- `pnpm exec tsc --noEmit` — clean.
- `pnpm exec vitest run` — green. Existing engine unit tests in `tests/unit/engine-resize.test.ts` and `tests/unit/rendering-context-registration.test.ts` should not be affected.
- Add a small unit test at `tests/unit/engine-matrix-policy.test.ts` covering:
    - With `useHighPrecisionMatrix: false` (default), `engine._matrixPolicy.storageKind === "f32"` and `engine._matrixPolicy.allocate() instanceof Float32Array`.
    - With `useHighPrecisionMatrix: true`, `engine._matrixPolicy.storageKind === "f64"` and `engine._matrixPolicy.allocate() instanceof Float64Array`.
    - Two engines created with different flags do not share allocator state.
- `pnpm test:parity` — green (no rendered output should change yet).
- `pnpm build:bundle-scenes` — bundle sizes for HPM-off scenes should be unchanged or near-unchanged (the F32 closure is small; if `tests/bundle-size.test.ts` flags a delta, investigate before adjusting any ceiling).

## Gotchas

- Do **not** declare `_matrixPolicy` on the public `EngineContext` interface — it is internal. Add it to `EngineContextInternal` only.
- Use a **dynamic `await import(...)`** for `_mat4-storage-f64.ts`, not a static import. The original plan used static-import + `if`-guarded call, but bundlers retained the F64 module in every HPM-off bundle because the `useHpm` boolean is not statically dead. Dynamic import behind `if (useHpm)` is the only way to make the F64 module truly unreachable from HPM-off code paths.
- Two engines on one page MUST NOT share allocator state. Because the F32 path returns a new closure object on every `createEngine` call, isolation is automatic — but do not be tempted to "optimize" by hoisting a singleton allocator. That would violate REQ-ARCH-1.
- `EngineContextInternal` may already have a particular ordering or grouping convention for its fields; place `_matrixPolicy` in a position that keeps the interface scannable (e.g. near `useHighPrecisionMatrix` on the public side, or with the other `_*` fields on the internal side — whichever the existing file pattern suggests).
- Do not raise the bundle-size ceiling in `tests/bundle-size.test.ts`. If the F32 closure cost is too large to fit, simplify the closure (the smallest correct form is a frozen object literal returning a new typed array), but do not modify the ceiling.

## Verification checklist

- [ ] `EngineContextInternal` has `_matrixPolicy: MatrixAllocator` field.
- [ ] `createEngine` populates `_matrixPolicy` based on `options?.useHighPrecisionMatrix`.
- [ ] Public `EngineContext` is unchanged (no new fields visible to callers).
- [ ] New unit test `tests/unit/engine-matrix-policy.test.ts` covers both branches and engine isolation.
- [ ] `pnpm exec vitest run` is green.
- [ ] `pnpm test:parity` is green.
- [ ] `pnpm build:bundle-scenes` produces no ceiling regression in `tests/bundle-size.test.ts` for HPM-off scenes.
