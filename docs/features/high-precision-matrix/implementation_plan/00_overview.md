# high-precision-matrix — Implementation Plan

> **⚠ HISTORICAL.** This plan describes the M0 substrate as originally
> conceived (per-engine `_matrixPolicy`, `ScenePrecisionPolicy`,
> `addToScene` precision binding, per-loadGltf `LoaderScratch` factory).
> All four were collapsed post-M0 by commits `07be57e` (engine-at-construction
> simplification) and `7569f9b` (process-global lazy-init allocator
> singleton + drop `engine` param from entity factories). The shipped
> substrate is described by `GUIDANCE.md` pillar 4b″ ("Single Matrix
> Precision Per Page"). Individual phase docs below are annotated where
> superseded.

## Summary

Make the existing engine flag `useHighPrecisionMatrix` load-bearing by introducing an opaque dual-precision `Mat4`, an engine-owned matrix-precision policy, a single F64→F32 GPU upload boundary (`packMat4IntoF32`), and a new parity scene that demonstrates the ~1e5-coordinate jitter case. M0 ships only the requirements-named uploader inventory; adjacent uploaders are deferred. Floating-origin and `useLargeWorldRendering` are LWR M1, not M0.

## Phases

- **Phase 1 — Foundation: opaque type, F64 storage module, engine policy, packer.**
  Introduces the type-system widening, the gated F64 allocation module, the new engine-internal `_matrixPolicy`, and the pure `packMat4IntoF32` helper with unit tests. Ends with a buildable engine where the flag still does nothing observable to callers but the substrate is in place.
- **Phase 2 — Per-engine wiring through scene/entity bind.**
  Adds `ScenePrecisionPolicy`, the `resolveScenePrecisionPolicy` seam in `createSceneContext`, the cross-engine fast-fail in `addToScene`, and migrates every M0 matrix-owning cache to allocate through the captured scene policy. After this phase, with HPM on, world/view/projection/light/shadow caches actually hold Float64 storage on CPU.
- **Phase 3 — Reroute uploaders through the packer.**
  Walks the REQ-UPL-2 inventory (mesh world, camera view/proj/vp, light, thin-instance, shadow) and routes every direct mat4 GPU write through `packMat4IntoF32`. Includes thin-instance widening to accept packed F32 *or* F64 matrix slabs. After this phase, GPU output is bit-identical for HPM-off scenes and precision-preserving for HPM-on scenes.
- **Phase 4 — Audit, parity scene, and gates.**
  Adds the source-audit script (uploader allowlist), a bundle-content assertion that F64 modules are absent from HPM-off scene bundles, a new dedicated parity scene at ~1e5 world coordinates with two variants, and a final guardrail run. After this phase the milestone is shippable.

## Phase rationale

Phase 1 is a thin vertical foundation: the public type changes, the gated F64 module, and the packer can all be unit-tested in isolation without touching any uploader. Phase 2 unlocks Phase 3: caches must already allocate through the policy before uploaders can rely on `Mat4Storage` semantics. Phase 3 lands the user-visible precision behavior — but only after caches in Phase 2 actually store F64. Phase 4's audit script and bundle-content assertion guard against silent regressions and complete the parity acceptance.

Each phase ends in a state where `pnpm test` (build + parity, no perf) is expected to pass — so the agent can checkpoint between phases without breaking the build.

## Task index

| File              | Task                                                            | Phase | Requirements                                  |
| ----------------- | --------------------------------------------------------------- | ----- | --------------------------------------------- |
| `01_01_widen_mat4_public_type_and_internal_storage.md` | Widen `Mat4` to opaque; add `Mat4Storage` internal      | 1     | REQ-API-1, REQ-API-4, REQ-ARCH-3              |
| `01_02_add_f64_storage_module_and_allocator.md`        | Add gated `_mat4-storage-f64.ts` allocator              | 1     | REQ-ARCH-1..6                                 |
| `01_03_engine_matrix_precision_policy.md`              | Resolve `_matrixPolicy` in `createEngine`               | 1     | REQ-API-2, REQ-INT-1, REQ-ARCH-1, REQ-ARCH-4  |
| `01_04_pack_mat4_into_f32_helper_and_unit_tests.md`    | Add `packMat4IntoF32` + Vitest coverage                 | 1     | REQ-UPL-1, REQ-UPL-3                          |
| `02_01_scene_precision_policy_resolver.md`             | Add `resolveScenePrecisionPolicy` + `_matrixPolicy` field on scene | 2     | REQ-INT-2, REQ-ARCH-1, REQ-ARCH-4    |
| `02_02_addToScene_bind_and_cross_engine_fastfail.md`   | Bind matrix-owning state at attach; fail cross-engine   | 2     | REQ-ARCH-1, REQ-ARCH-4, REQ-MAT-1, REQ-COMP-3 |
| `02_03_world_camera_light_shadow_caches_to_policy.md`  | Migrate caches to allocate via policy                   | 2     | REQ-MAT-1, REQ-MAT-2, REQ-CPU-1..3, REQ-ARCH-4|
| `02_04_loader_gltf_scene_owned_scratch.md`             | Move glTF scratch from module-local to scene/loader-owned | 2   | REQ-MAT-2, REQ-ARCH-1..3                      |
| `03_01_route_mesh_world_ubo_writes_through_packer.md`  | Mesh UBO writers call `packMat4IntoF32`                 | 3     | REQ-UPL-1, REQ-UPL-2                          |
| `03_02_route_camera_view_proj_writes_through_packer.md`| Camera VP UBO composition uses packer                   | 3     | REQ-UPL-1, REQ-UPL-2                          |
| `03_03_route_light_ubo_writes_through_packer.md`       | Light UBO mat4 fields packed via helper                 | 3     | REQ-UPL-1, REQ-UPL-2                          |
| `03_04_widen_thin_instance_and_route_upload.md`        | Widen `setThinInstances` slab; pack on upload           | 3     | REQ-API-5, REQ-UPL-1, REQ-UPL-2               |
| `03_05_route_shadow_matrix_writes_through_packer.md`   | Shadow UBO writes use packer                            | 3     | REQ-UPL-1, REQ-UPL-2                          |
| `04_01_repository_audit_for_direct_mat4_gpu_writes.md` | Repo audit script + Vitest gate                         | 4     | REQ-UPL-2                                     |
| `04_02_bundle_content_assertion_f64_absent.md`         | Bundle-content test: F64 modules absent in HPM-off bundles | 4 | REQ-ARCH-6, REQ-VER-3                         |
| `04_03_new_parity_scene_high_precision_jitter.md`      | Add new dedicated parity scene at ~1e5                  | 4     | REQ-MAT-4, REQ-COMP-1, REQ-VER-1, REQ-VER-4   |
| `04_04_final_guardrail_run_and_acceptance.md`          | Run `pnpm test`; verify diffs; sign off                 | 4     | REQ-VER-1..4                                  |
