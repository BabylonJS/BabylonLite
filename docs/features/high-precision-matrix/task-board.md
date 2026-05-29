# Task Board: high-precision-matrix

> **⚠ HISTORICAL.** All tasks below were completed, then several of them
> were collapsed by post-M0 simplification (commits `07be57e` and `7569f9b`).
> The shipped substrate is described by `GUIDANCE.md` pillar 4b″
> ("Single Matrix Precision Per Page") and lives in
> `packages/babylon-lite/src/math/_matrix-allocator.ts` (process-global
> lazy-init singleton). Several "completed" tasks below (`_matrixPolicy`,
> `ScenePrecisionPolicy`, `resolveScenePrecisionPolicy`, per-loadGltf
> `LoaderScratch` factory) no longer exist in the codebase. Reference
> only as historical record of what was built and subsequently inlined.

## Queue

| M | ID | Task | Skill | Notes |
|---|----|------|-------|-------|
| | T-05 | Implementation plan | write-implementation-plan | |

## Completed

| M | ID | Task | Skill | Notes |
|---|----|------|-------|-------|
| | T-01 | Goals — review or create goals.md | review-goals | done 2026-05-20 · goals.md (revised once after first review; reconciled with arch doc 27) |
| | T-02 | Visual mocks (optional) | create-html-mock | skipped — CPU math substrate, no UI |
| | T-03 | Requirements | write-requirements | done 2026-05-21 · requirements.md (revised once after yellow review; addressed 3 must-fix + 2 should-fix) |
| | T-04 | Architecture | write-architecture | done 2026-05-21 · architecture.md |

## Untriaged

- [2026-05-22] Widen public Mat4 to opaque branded interface; introduce internal `_mat4-storage.ts`. Skill: execute-implementation-plan. See implementation_plan/01_01_widen_mat4_public_type_and_internal_storage.md.
- [2026-05-22] Add gated F64 storage module `_mat4-storage-f64.ts` and per-engine `_matrix-allocator.ts`. Skill: execute-implementation-plan. See implementation_plan/01_02_add_f64_storage_module_and_allocator.md.
- [2026-05-22] Resolve engine matrix-precision policy in `createEngine`; expose `_matrixPolicy` on `EngineContextInternal`. Skill: execute-implementation-plan. See implementation_plan/01_03_engine_matrix_precision_policy.md.
- [2026-05-22] Implement `packMat4IntoF32` boundary helper + unit tests. Skill: execute-implementation-plan. See implementation_plan/01_04_pack_mat4_into_f32_helper_and_unit_tests.md.
- [2026-05-22] Add `ScenePrecisionPolicy` + `resolveScenePrecisionPolicy` in `createSceneContext`. Skill: execute-implementation-plan. See implementation_plan/02_01_scene_precision_policy_resolver.md.
- [2026-05-22] Bind entities to scene precision at `addToScene` / `registerScene`; cross-engine reattach throws. Skill: execute-implementation-plan. See implementation_plan/02_02_addToScene_bind_and_cross_engine_fastfail.md.
- [2026-05-22] Migrate world / camera / light / shadow caches to allocator-driven initialization. Skill: execute-implementation-plan. See implementation_plan/02_03_world_camera_light_shadow_caches_to_policy.md.
- [2026-05-22] Replace module-local glTF scratch with loader-owned per-engine scratch. Skill: execute-implementation-plan. See implementation_plan/02_04_loader_gltf_scene_owned_scratch.md.
- [2026-05-22] Route mesh world UBO writes through `packMat4IntoF32`. Skill: execute-implementation-plan. See implementation_plan/03_01_route_mesh_world_ubo_writes_through_packer.md.
- [2026-05-22] Route camera view/proj/vp UBO writes through `packMat4IntoF32`. Skill: execute-implementation-plan. See implementation_plan/03_02_route_camera_view_proj_writes_through_packer.md.
- [2026-05-22] Route light UBO mat4 writes through `packMat4IntoF32`. Skill: execute-implementation-plan. See implementation_plan/03_03_route_light_ubo_writes_through_packer.md.
- [2026-05-22] Widen thin-instance API to F32|F64 slab and route upload through `packMat4IntoF32`. Skill: execute-implementation-plan. See implementation_plan/03_04_widen_thin_instance_and_route_upload.md.
- [2026-05-22] Route shadow matrix writes through `packMat4IntoF32`. Skill: execute-implementation-plan. See implementation_plan/03_05_route_shadow_matrix_writes_through_packer.md.
- [2026-05-22] Repository audit for direct mat4 GPU writes (Vitest). Skill: execute-implementation-plan. See implementation_plan/04_01_repository_audit_for_direct_mat4_gpu_writes.md.
- [2026-05-22] Bundle-content assertion — F64 storage absent in HPM-off bundles. Skill: execute-implementation-plan. See implementation_plan/04_02_bundle_content_assertion_f64_absent.md.
- [2026-05-22] New parity scene — high-precision jitter (HPM off vs on). Skill: execute-implementation-plan. See implementation_plan/04_03_new_parity_scene_high_precision_jitter.md.
- [2026-05-22] Final guardrail run + M0 acceptance. Skill: execute-implementation-plan. See implementation_plan/04_04_final_guardrail_run_and_acceptance.md.
