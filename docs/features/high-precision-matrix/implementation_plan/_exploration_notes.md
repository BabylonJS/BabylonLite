# Exploration Notes: high-precision-matrix M0

Compact reference for the implementation plan. Captures the concrete file paths, function names, and existing patterns that task files will reference.

## Engine + scene seams

- `packages/babylon-lite/src/engine/engine.ts`
    - `EngineContext` interface (line ~13). Currently exposes public boolean `useHighPrecisionMatrix` (line 27).
    - `EngineContextInternal` (line 54) — internal-only fields live here. New internal field `_matrixPolicy: { storageKind: "f32" | "f64"; allocate: () => Mat4 }` will be added here.
    - `EngineOptions` interface (line 110), with `useHighPrecisionMatrix?: boolean` at line 120.
    - `createEngine` (line 124). Engine policy is resolved at line 166 (currently `useHighPrecisionMatrix: options?.useHighPrecisionMatrix === true`). M0 adds the `_matrixPolicy` resolution next to that line, behind a static `if` so the F64 module is the only thing that imports `_mat4-storage-f64.ts`.
- `packages/babylon-lite/src/scene/scene-core.ts`
    - `SceneContextOptions` (line 24): `useFloatingOrigin?: boolean`. M0 does NOT add `useHighPrecisionMatrix` here — it's engine-wide.
    - `SceneContextInternal` (line 76+) already has `_floatingOriginMode`, `_eyePosition`, `_floatingOriginOffset`. Add `_matrixPolicy: ScenePrecisionPolicy` next to those.
    - `createSceneContext` (line 152). Add `resolveScenePrecisionPolicy(eng, options)` call after the existing floating-origin block (line 182 region).
    - `addToScene` (line 291) handles AssetContainer (line 294), mesh (line 319), light (line 339). This is where matrix-owning state gets bound to the captured policy, and where cross-engine reattach must fast-fail.
    - `registerScene` (line 401) calls `buildScene` which runs `_deferredBuilders` (line 383). Loaders that allocate scratch run inside these builders.
- `packages/babylon-lite/src/large-world/floating-origin.ts` already exists; do not change as part of M0.

## Public Mat4 type

- `packages/babylon-lite/src/math/types.ts` line 36–38:

    ```ts
    export type Mat4 = Float32Array & { readonly __brand: "Mat4" };
    ```

    This MUST become an opaque branded interface that does not name `Float32Array` or `Float64Array` in its public type. Internal `Mat4Storage = Float32Array | Float64Array` lives in a new internal module `math/_mat4-storage.ts` (not re-exported from `index.ts`).

## Math kernels (CPU)

All current kernels in `packages/babylon-lite/src/math/`:

- `mat4-identity.ts` (line 5: `new Float32Array(16) as Mat4`) — must allocate from policy.
- `mat4-compose.ts` line 6, `mat4-from-quat.ts` line 6, `mat4-multiply.ts` line 6, `mat4-perspective-lh.ts` line 6, `mat4-scale.ts` line 5, `mat4-invert.ts` line 41 — all have `new Float32Array(16) as Mat4` allocation. These constructors that *allocate output* need to either accept a policy/allocator parameter or be replaced by `*Into` variants where the caller already has an out matrix.
- `mat4-multiply-into.ts`, `mat4-compose-into.ts`, `mat4-perspective-lh-to-ref.ts` — `*Into`-style; signatures take `Float32Array`. Widen parameter types from `Float32Array` to `Mat4Storage` (= `Float32Array | Float64Array`). Body math uses indexed reads/writes already, so widening is type-only.
- `mat4-translation.ts`, `mat4-look-at-lh.ts` — review case-by-case (likely `*Into` style).

## Matrix-owning entity caches (per-engine bind)

Files that allocate `Float32Array(16)` for a precision-bearing cache today:

- `packages/babylon-lite/src/scene/world-matrix-state.ts:37` — `_ownedWorld` (mesh world matrix cache).
- `packages/babylon-lite/src/camera/camera.ts:45,76,91` — `_viewCache`, `_projCache`, `_vpCache`.
- `packages/babylon-lite/src/camera/free-camera.ts:43` — `_localMat`.
- `packages/babylon-lite/src/light/directional-light.ts:20`, `light/hemispheric.ts:22`, `light/spot-light.ts:26` — `_localMatrix`.
- `packages/babylon-lite/src/light/light-matrix.ts:26` — out param defaults.
- `packages/babylon-lite/src/shadow/shadow-base.ts:125` — output buffer.
- `packages/babylon-lite/src/shadow/shadow-generator.ts:140`, `shadow/pcf-shadow-generator.ts:112`, `shadow/pcf-directional-shadow-generator.ts:145` — `proj` matrices.
- `packages/babylon-lite/src/loader-gltf/gltf-parser.ts:152,164` — `world`, `_localScratch`. Currently module-local; must move to scene/loader-owned scratch.
- `packages/babylon-lite/src/loader-gltf/gltf-animation.ts:95` — `tmp`. Same constraint.
- `packages/babylon-lite/src/loader-gltf/gltf-feature-gpu-instancing.ts:158` — `instWorld`.

These read or feed world-space outputs that must remain in source storage when HPM is on. They MUST allocate via the engine/scene `_matrixPolicy.allocate()` after binding.

## Out-of-scope / deferred uploaders (NOT part of M0)

Per architecture D4 these adjacent mat4 GPU writers stay on direct `Float32Array.set` for M0 and are explicit follow-ups:

- `picking/gpu-picker.ts:16,151` — `_pickVP`.
- `loader-skybox/load-skybox.ts:39` — skybox world.
- `mesh/gaussian-splatting-mesh.ts:158` — `_sortWorldMatrix`.
- `material/pbr/background-*.ts` (background-dds-skybox, background-ground, background-hdr-skybox, background-solid-skybox).

The audit script's allowlist must include these so they are not flagged, but they must be listed in the deferred-followup section of T-05.

## REQ-UPL-2 inventory: where mat4-to-GPU upload lives today

These are the writers that must route through `packMat4IntoF32` in M0:

1. **Mesh world UBO writes**
    - `packages/babylon-lite/src/render/scene-helpers.ts:54` — `device.queue.writeBuffer(p.meshUBO, 0, wm as Float32Array<...>)`.
    - `packages/babylon-lite/src/material/pbr/pbr-renderable.ts:356` — mesh UBO write through `meshUboData` scratch.
    - `packages/babylon-lite/src/material/standard/standard-renderable.ts:164`.
    - `packages/babylon-lite/src/material/node/node-renderable.ts:107,170`.
    - `packages/babylon-lite/src/shadow/shadow-base.ts:59` — `c.worldMatrix` directly.
2. **Camera view / projection / view-projection UBO writes**
    - `packages/babylon-lite/src/frame-graph/render-task.ts:522` — `task._sceneUBO`. The `data` Float32Array is currently composed by upstream code that copies view/proj/vp from the camera caches. The composition path is what must call `packMat4IntoF32` per matrix into the upload scratch.
3. **Light UBO writes**
    - `packages/babylon-lite/src/render/lights-ubo.ts:110` — `state._scratch`. Light matrices are packed into `_scratch` via numeric assignments (no direct `.set(mat)` today). The packing helpers in `lights-ubo` need to use `packMat4IntoF32` for any mat4 fields they pack into `_scratch`.
4. **Thin-instance buffer writes**
    - `packages/babylon-lite/src/mesh/thin-instance-gpu.ts:33` — `device.queue.writeBuffer(ti._gpuBuffer, minByte, ti.matrices.buffer, ...)`. When `ti.matrices` is Float64-backed, the GPU upload path must pack into a per-mesh F32 upload scratch range covering `[minByte..maxByte]` and write that scratch instead. Single source storage stays F64 (or F32) on CPU; the F32 scratch is upload-only.
5. **Shadow matrix writes**
    - `packages/babylon-lite/src/shadow/shadow-base.ts:307,309` — `sg.lightMatrix`, `sharedUboData` (which contains shadow viewProj).
    - `packages/babylon-lite/src/shadow/pcf-directional-shadow-generator.ts:281` — `updated.viewProj`.

## Thin-instance widening

- `packages/babylon-lite/src/mesh/thin-instance.ts` — `ThinInstanceData.matrices` is `Float32Array` today. M0 widens to packed `Float32Array | Float64Array`. The CPU readers (picking) read from this directly.
- `packages/babylon-lite/src/mesh/thin-instance-gpu.ts:33` — needs an upload-time pack into F32 scratch.
- The single bulk public setter `setThinInstances` accepts the widened slab. No second public API.

## Tree-shaking / module isolation

- `packages/babylon-lite/package.json` declares `sideEffects: false` (verify before plan execution; if it has an allowlist, do not add the F64 modules to it).
- New internal modules:
    - `packages/babylon-lite/src/math/_mat4-storage.ts` — public-internal storage-view types only, no F64 allocations.
    - `packages/babylon-lite/src/math/_mat4-storage-f64.ts` — F64 allocation factory ONLY. Imported only by the engine policy resolver in `createEngine`, and only from within a `if (options?.useHighPrecisionMatrix)` static branch.
    - `packages/babylon-lite/src/math/pack-mat4-into-f32.ts` — pure `(view: Float32Array, mat: Mat4, offset?: number) => void`. Imported by every M0 inventory uploader. The F64-aware branch of the function is internal to the module.

## Tests and conventions

- Unit tests: `tests/unit/<name>.test.ts` (Vitest). Run with `pnpm exec vitest run`.
- Parity scenes: `tests/parity/scenes/sceneN-<slug>.spec.ts` plus `lab/public/scene-config.json` MAD ceiling, `lab/src/scenes/sceneN-<slug>.ts` scene module, `reference/sceneN-<slug>/babylon-ref-golden.png` golden.
- Bundle size: `tests/bundle-size.test.ts` enforces ceilings — DO NOT raise without explicit user approval.
- See `lab/public/scene-config.json` for next available scene id (the new HPM parity scene gets the next free id).
- Agent guardrail commands: `pnpm build:bundle-scenes`, `pnpm test:parity`, or `pnpm test` (combined). NEVER `pnpm test:perf`.

## Existing patterns to follow

- `*Into` helpers (e.g. `mat4MultiplyInto`) accept caller-owned out buffers and avoid allocation. Generic-precision kernels follow the same shape.
- `write-vec3.ts` is the precedent style for `pack-mat4-into-f32.ts`: pure data-packing into a caller-owned scratch.
- Internal-only modules conventionally start with `_` (e.g. proposed `_mat4-storage.ts`).

## Key integration point summary

1. `createEngine` (`engine/engine.ts:166`) resolves `_matrixPolicy`.
2. `createSceneContext` (`scene/scene-core.ts:152`) calls `resolveScenePrecisionPolicy` and stores `_matrixPolicy` on the scene.
3. `addToScene` (`scene/scene-core.ts:291`) binds entity matrix caches to the scene's `_matrixPolicy` and fast-fails on cross-engine reattach.
4. `buildScene` (`scene/scene-core.ts:383`) — deferred builders / loaders pull policy from scene at run time.
5. Every uploader in REQ-UPL-2 inventory copies through `packMat4IntoF32` instead of direct `.set` / `writeBuffer(mat)`.
6. CPU readers (world-matrix-state, camera, picking ray, frame-graph render-task, set-parent, scene-size, thin-instance) read source storage directly via `Mat4Storage` indexing.
