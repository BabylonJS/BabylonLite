# Requirements: `high-precision-matrix`

> M0 foundation milestone for Large World Rendering (LWR).
> This document defines the feature requirements for `docs/features/high-precision-matrix/` and should be read together with:
>
> - Goals: [`./goals.md`](./goals.md)
> - Parent architecture: [`../../architecture/27-large-world-rendering.md`](../../architecture/27-large-world-rendering.md)
> - Repo rules: [`../../../GUIDANCE.md`](../../../GUIDANCE.md)
>
> This document defines **M0 requirements only**. It does not restate the full LWR roadmap from the parent architecture doc.

## Scope

`high-precision-matrix` delivers the CPU-side dual-precision matrix substrate behind the existing engine option `useHighPrecisionMatrix`.

The milestone exists to:

- make `useHighPrecisionMatrix` load-bearing rather than dead plumbing;
- preserve matrix precision across CPU world-space math until GPU upload;
- provide Babylon.js migration parity for apps that already rely on this flag; and
- establish the prerequisite substrate that later milestones need for floating-origin rendering.

## Functional Requirements

### Public API and type model

- **REQ-API-1** — `Mat4` MUST remain a typed-array-based public abstraction and MUST NOT become a class in M0. The public surface MUST expose `Mat4` as a single opaque nominal type that does not reveal or require F32-vs-F64 variants. Internal branded or storage-specific variants MAY exist as an implementation detail, but they MUST NOT leak through public APIs. `Mat4` values MUST be able to be backed by either Float32 or Float64 storage.
- **REQ-API-2** — `useHighPrecisionMatrix` MUST remain an engine-constructor option, MUST be engine-wide in effect, and MUST default to `false`.
- **REQ-API-3** — When `useHighPrecisionMatrix` is `false`, existing public matrix-facing APIs MUST preserve current observable behavior for existing callers.
- **REQ-API-4** — Public APIs that accept or return `Mat4` MUST continue to work without requiring callers to know whether storage is Float32 or Float64.
- **REQ-API-5** — Thin-instance APIs MUST support high-precision matrix input when `useHighPrecisionMatrix` is enabled, without requiring the caller to downcast matrix data before passing it to Babylon Lite. Existing Float32-based usage MUST remain supported.

### Precision-preserving CPU behavior

- **REQ-MAT-1** — When `useHighPrecisionMatrix` is `true`, matrix instances participating in world-space computation MUST preserve Float64 backing through their CPU lifecycle, including allocation, composition, inversion, caching, and re-read paths.
- **REQ-MAT-2** — High-precision behavior MUST cover the full M0 matrix surface named in the goals doc. When `useHighPrecisionMatrix` is `true`, Float64 backing MUST apply to: world matrices for meshes, thin instances, lights, and shadow casters; camera view, projection, and view-projection caches; world-view and world-view-projection matrices composed per renderable; and scratch matrices whose outputs feed those surfaces, including uploader scratch matrices, glTF loader scratch matrices, and animation-evaluation scratch matrices that write back into the matrix surface.
- **REQ-MAT-3** — When `useHighPrecisionMatrix` is `false`, the default Float32 path MUST remain the baseline behavior and MUST NOT require high-precision-only state to function correctly.
- **REQ-MAT-4** — Enabling `useHighPrecisionMatrix` MUST produce observable precision-preserving behavior; the option MUST NOT remain a silent no-op. Acceptance MUST include a scene at moderate-but-non-trivial world coordinates (~1e5, per the goals doc) where the legacy Float32 path shows visible translation jitter and the `useHighPrecisionMatrix: true` path eliminates that jitter, while agent-run validation remains green under `pnpm build:bundle-scenes` and `pnpm test:parity`.

### GPU upload boundary

- **REQ-UPL-1** — GPU upload MUST be the only point where Mat4 data may be downcast from Float64 storage to Float32 storage.
- **REQ-UPL-2** — All M0 mat4-to-GPU upload sites MUST route through a shared precision-packing boundary (`packMat4IntoF32(view, mat)`) rather than directly copying matrix storage into Float32 GPU upload views. The required M0 inventory is: mesh world UBO writes, camera view/projection UBO writes, light UBO writes, thin-instance buffer writes, and shadow-matrix writes. Acceptance MUST include an audit script or repository search showing zero direct `Float32Array.set(mat)` writes into GPU-bound buffers outside `packMat4IntoF32`.
- **REQ-UPL-3** — The precision-packing boundary for M0 MUST be precision-only: it MUST pack matrix values for GPU upload, and it MUST NOT perform floating-origin offset subtraction or accept floating-origin-specific parameters such as an offset argument.

### In-scope CPU world-space readers

- **REQ-CPU-1** — The M0 inventory of CPU world-space readers is fixed to the set named in `goals.md`; those readers MUST consume precision-preserving matrix storage directly when `useHighPrecisionMatrix` is enabled.
- **REQ-CPU-2** — The following paths are explicitly in scope for M0 and MUST preserve high-precision behavior where they read or derive world-space matrix data: `scene/world-matrix-state.ts`, `scene/set-parent.ts`, camera matrix caches and `getCameraPosition` consumers, `picking/ray.ts`, `picking/detailed-picking.ts`, frustum/AABB/sort logic in `frame-graph/render-task.ts`, `material/pbr/scene-size.ts`, and thin-instance matrix handling.
- **REQ-CPU-3** — M0 MUST NOT claim blanket coverage for unspecified world-space readers. Readers outside the fixed inventory MAY be addressed only by follow-up work.

### Engine, scene, and milestone integration

- **REQ-INT-1** — High-precision matrix mode MUST be represented as real engine state so later milestones can deterministically validate scene-level features against it.
- **REQ-INT-2** — M0 MUST make it possible for a later scene-level `useFloatingOrigin: true` validation to require `useHighPrecisionMatrix: true` without relying on module-global state, heuristics, or inferred behavior.
- **REQ-INT-3** — M0 MUST remain independently shippable and useful even if `useFloatingOrigin` and `useLargeWorldRendering` are not yet implemented.

### Allocation, isolation, and architectural constraints

- **REQ-ARCH-1** — The final allocation approach is architecture work, but any accepted approach MUST ensure per-engine isolation. Multiple engines on one page MUST NOT share allocator state or precision mode through module-level state.
- **REQ-ARCH-2** — The architecture decision MAY choose an engine-passed allocator, a per-engine factory captured at an allowed lifecycle boundary, or a hybrid of those approaches; it MUST NOT choose module-level lazy state.
- **REQ-ARCH-3** — The feature MUST comply with `GUIDANCE.md` tree-shaking and side-effect rules: no module-level allocator state, no top-level caches that make the module non-shakable, and no design that introduces module import side effects.
- **REQ-ARCH-4** — The chosen design MUST allow in-scope matrix creators to allocate storage that matches the owning engine's precision mode.
- **REQ-ARCH-5** — Device lifecycle changes MUST NOT leave stale shared allocation state attached to a different engine/device pair.
- **REQ-ARCH-6** — When `useHighPrecisionMatrix` is `false` and unreachable in a scene's bundle, F64-specialized variants MUST be tree-shaken. Acceptance MUST show that bundle-size ceilings for HPM-off scenes do not increase.

### Migration and compatibility

- **REQ-COMP-1** — Babylon.js applications that already rely on `useHighPrecisionMatrix: true` MUST be able to migrate to Babylon Lite without rewriting their precision strategy. Acceptance MUST include a parity scene at moderate-but-non-trivial world coordinates (~1e5, per the goals doc) that renders within the scene's approved MAD tolerance when run with `useHighPrecisionMatrix: true`, validated via `pnpm build:bundle-scenes` and `pnpm test:parity`.
- **REQ-COMP-2** — Existing scenes that do not enable `useHighPrecisionMatrix` MUST preserve current rendered behavior and existing public API expectations.
- **REQ-COMP-3** — M0 MUST preserve the distinction between engine-wide `useHighPrecisionMatrix`, future per-scene `useFloatingOrigin`, and future engine convenience flag `useLargeWorldRendering`.

### Verification and acceptance guardrails

- **REQ-VER-1** — Agent-executed acceptance for this milestone MUST rely only on repo-approved commands: `pnpm build:bundle-scenes`, `pnpm test:parity`, or `pnpm test`.
- **REQ-VER-2** — Agent-executed acceptance for this milestone MUST NOT require `pnpm test:perf`.
- **REQ-VER-3** — Acceptance MUST preserve current bundle-size ceilings unless the user explicitly approves changes.
- **REQ-VER-4** — Acceptance MUST preserve committed reference images unless the user explicitly approves changes.

## Out of Scope

The following are explicitly out of scope for `high-precision-matrix` M0:

- Scene-level floating-origin behavior (`useFloatingOrigin`), including GPU eye-offset subtraction.
- Engine convenience flag behavior for `useLargeWorldRendering`.
- F64 vector, quaternion, or non-matrix animation math beyond matrix surfaces that feed world-space results.
- Coverage for CPU readers outside the fixed M0 inventory listed in `goals.md`.
- Any requirement to expose a public per-call precision toggle beyond the engine flag.
- Any requirement to resolve the allocator strategy in this document beyond constraining what the later architecture decision is allowed to choose.

## Acceptance Criteria Summary

| Area | Requirement IDs | Acceptance summary |
|---|---|---|
| API shape | REQ-API-1..5 | `Mat4` stays an opaque typed-array abstraction, `useHighPrecisionMatrix` becomes functional, and thin instances admit high-precision-compatible input without breaking Float32 callers. |
| CPU precision | REQ-MAT-1..4 | High-precision mode preserves Float64-backed matrix behavior across the explicitly named M0 matrix surface and must eliminate the documented ~1e5-coordinate jitter case. |
| GPU boundary | REQ-UPL-1..3 | F64-to-F32 downcast happens only at the shared GPU packing boundary, and the named M0 upload inventory must show zero direct matrix writes outside that helper. |
| CPU readers | REQ-CPU-1..3 | The fixed M0 reader inventory consumes precision-preserving storage directly; unspecified readers remain out of scope. |
| Integration | REQ-INT-1..3 | M0 is engine-wide, independently shippable, and leaves a clean basis for later `useFloatingOrigin` validation. |
| Architecture constraints | REQ-ARCH-1..6 | The future allocator decision remains open, but only per-engine, side-effect-free, tree-shakable designs are acceptable, and HPM-off bundle ceilings must not rise. |
| Compatibility | REQ-COMP-1..3 | BJS migration semantics are preserved with parity validation at ~1e5 coordinates, while existing non-HPM scenes keep current behavior. |
| Verification guardrails | REQ-VER-1..4 | Acceptance uses allowed agent commands only, with no perf runs, bundle ceiling changes, or golden updates without approval. |
