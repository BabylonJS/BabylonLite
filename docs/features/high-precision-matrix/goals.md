# Goals: `high-precision-matrix`

> Foundation milestone (M0) for the Large World Rendering port. Parent
> architecture doc:
> [`docs/architecture/27-large-world-rendering.md`](../../architecture/27-large-world-rendering.md).
> This feature ships the CPU-side dual-precision matrix substrate that LWR
> later builds on, and is also valuable on its own for BJS apps that rely on
> `useHighPrecisionMatrix` without the floating-origin trick.

## Why

In Babylon.js, `useHighPrecisionMatrix` is an engine-wide option that swaps
the `Matrix` class's backing storage from `Float32Array` to `Float64Array`.
This keeps precision alive across:

- Parent-chain world-matrix composition for deep node hierarchies
- Picking inverses (`invert(world)` on world-space rays)
- World-space CPU readers: frustum culling, AABB tests, distance-based LOD
- Any future feature that touches absolute world coordinates

It is also a **prerequisite** for floating-origin / Large World Rendering:
subtracting an F64-accurate eye offset from an already-F32-degraded world
translation recovers nothing — the low bits were lost upstream. So the CPU
substrate must exist before the GPU offset trick can deliver real precision.

Today, `useHighPrecisionMatrix` exists as **dead plumbing** on
`EngineContext` / `EngineOptions` (`packages/babylon-lite/src/engine/engine.ts`
lines 27, 120, 166): the field is plumbed through the constructor but
**nothing reads it**. A user who passes `useHighPrecisionMatrix: true`
expecting precision protection silently gets standard F32. This is a
correctness trap for migrants from BJS and a blocker for LWR.

This feature makes the field load-bearing.

## Goals

1. **Make `useHighPrecisionMatrix` a real, functional engine option** with
   semantics matching BJS:
   - When `true`, **`Mat4` instances are backed by `Float64Array`** (not
     just F64 temporaries) so precision survives across composition,
     inversion, caching, and re-reads.
   - Default remains `false` — opt-in, no behavior change for existing
     scenes.
2. **Cover the full CPU matrix surface, not just world matrices.** When
   the flag is on, F64 backing applies to:
   - World matrices (per-mesh, per-thin-instance, per-light, per-shadow
     caster).
   - View / projection / view-projection / world-view / world-view-projection
     caches (`camera/camera.ts` and any per-renderable composed matrices).
   - Scratch matrices used by uploaders, the glTF loader, and animation
     evaluation that flow into world-space results.

   Out of scope: vector/quaternion math, animation evaluation internals
   that don't write back to the matrix surface.
3. **Provide BJS migration parity.** A BJS app that depends on
   `useHighPrecisionMatrix: true` must be able to migrate to Lite
   without rewriting its precision strategy or accepting silent
   regressions.
4. **Establish a single GPU upload boundary** as the only place where
   F64 → F32 downcast happens. The deliverable is a small set of helpers
   (e.g., `packMat4IntoF32(view, mat)`) that **all** mat4 → GPU
   buffer write sites route through. Direct `Float32Array.set(mat)` calls
   on UBO-backed buffers are eliminated.
   (Floating-origin / eye-offset subtraction is **not** part of this
   helper — that's M1 of LWR. The M0 helper is precision-only.)
5. **Cover the explicit inventory of CPU world-space readers.** When the
   flag is on, these readers consume F64 storage directly without a
   downcast round-trip. The M0 in-scope inventory is fixed (not "all
   readers, ever") and is documented in requirements:
   - `scene/world-matrix-state.ts`, `scene/set-parent.ts`
   - `camera/camera.ts` view/proj caches and `getCameraPosition` callers
   - `picking/ray.ts`, `picking/detailed-picking.ts`
   - Frustum / AABB tests and transparent sort in
     `frame-graph/render-task.ts`
   - `material/pbr/scene-size.ts`
   - `mesh/thin-instance.ts` (see goal 6 for API impact)

   Anything not on this list is explicitly out of scope for M0 and lands
   in a follow-up if/when needed.
6. **Resolve the thin-instance public-API mismatch.** `setThinInstances`
   today takes `Float32Array`. When `useHighPrecisionMatrix: true`, it
   must accept (or internally route through) F64-backed input without
   silently downcasting at the call site. The exact API shape (overloads,
   union, separate setter) is a requirements/architecture decision; the
   goal here is to commit to **fixing it**, not to picking the shape.
7. **Land it as an independently shippable milestone.** Value to BJS
   migrants does not require LWR to also ship; LWR M1+ then composes on
   top of this substrate.

## Allocation strategy (must resolve before requirements)

The single biggest design question. Captured here so it's flagged as
blocking for the requirements phase, not deferred indefinitely.

Current state: many sites hardcode `new Float32Array(16)` (e.g.,
`scene/world-matrix-state.ts`, `camera/camera.ts`, `mesh/thin-instance.ts`,
`light/*`, `shadow/*`, glTF loader scratch mats). The pure-function /
data-oriented design (`GUIDANCE.md` §4b/4b′) means most of these creators
do **not** have direct engine access — so "if engine.useHighPrecisionMatrix
is true, allocate F64" isn't a trivial wiring change.

Candidate strategies (to be evaluated in requirements/architecture):

- **Engine-passed allocator.** Pass an `allocateMat4()` factory through
  the existing context plumbing. Pros: explicit, testable, naturally
  per-engine. Cons: touches every creator, threads through code that
  today doesn't take engine.
- **Per-engine factory captured at module entry.** Where engine isn't
  threaded through, callers obtain a small allocator object from the
  engine once (e.g., on registration / scene attach) and use it locally.
  Pros: avoids deep parameter threading. Cons: requires every "deep"
  module to acquire the allocator at a defined lifecycle point.
- **Hybrid.** Allocator threaded explicitly where engine context is
  naturally available; per-engine factory captured at registration time
  in deeper utilities.

> **Rejected:** module-local lazy state set at startup. Conflicts with
> per-engine isolation (multiple engines on one page would clobber each
> other's allocator) and `GUIDANCE.md` §4 ("Zero module-level side
> effects"). Documented here so it's not re-litigated in requirements.

Whichever strategy wins must satisfy `GUIDANCE.md` rules:
- No module-level side effects (no top-level `Map` / `Set` / cache
  allocations).
- Per-engine isolation (multiple engine instances on the same page must
  not share or clobber each other's allocator).
- Auto-invalidate on device change.
- Tree-shakable: F64 paths must not pull in when the flag is off.

## Performance & footprint constraints

- **Hot-path constraint:** When the flag is `false`, the F32 path must
  remain at parity with today's perf. Generic dual-precision kernels are
  acceptable only if benchmarking shows no measurable regression on the
  default path; otherwise prefer specialized F32 + F64 variants.
- **Memory footprint:** Under the flag, mat4 storage roughly doubles
  (16 × F32 → 16 × F64 per mat). Acceptable for the migration use cases
  (hundreds of thousands of matrices is an outlier; thousands is typical).
  Documented as expected, not a regression.
- **Perf validation is user/CI-only.** Per `GUIDANCE.md` §0c, agents
  do not run `pnpm test:perf`. Perf claims in this feature must be
  validated by the user before declaring success.

## Non-Goals

- **Floating-origin / `useFloatingOrigin`** is out of scope here — that's
  LWR M1+ in `docs/architecture/27-large-world-rendering.md`. M0 lays the
  precision substrate; M1 adds the eye-offset upload trick on top.
- **`useLargeWorldRendering` convenience flag** is out of scope here —
  scheduled for LWR M2 (it forces both `useHighPrecisionMatrix: true` and
  per-scene `useFloatingOrigin: true`-default).
- **F64 vector / quaternion / animation math.** The flag's BJS scope is
  matrix-only; we mirror that scope. If a future precision pain shows up
  in animation / IK / skinning, that's a separate feature.
- **Per-scene precision granularity.** `useHighPrecisionMatrix` is
  engine-wide in BJS for a reason: a `Mat4` instance can be passed between
  scenes (shared mesh, shared material), so per-scene tagging would
  require pervasive plumbing that breaks Lite's data-oriented design. We
  keep it engine-wide.
- **CPU readers outside the goal-5 inventory.** Picking/cull/sort/scene-size
  are in scope; everything else (CSG, future physics, NME runtime
  helpers, etc.) is explicitly deferred.

## Success Criteria

- A BJS app using `useHighPrecisionMatrix: true` ports to Lite with the
  same flag and gets equivalent precision behavior — verified by a
  parity scene at moderate-but-non-trivial coordinates (~1e5) where F32
  mode shows visible jitter and F64 mode eliminates it.
- Scenes that don't set the flag (the existing 100+ scenes) show:
  - **No** visual change (existing parity tests stay green at current MAD ceilings).
  - **No** bundle-size ceiling raises for any scene.
  - **No** measurable perf regression on the F32 default path
    (validated by the user via `pnpm test:perf`).
- The dead-plumbing field on `engine.ts` becomes a real implementation —
  no API contract is silently lying to users.
- Allocation strategy is documented and applied uniformly: there are no
  remaining `new Float32Array(16)` hardcoded mat4 allocations on paths
  that participate in world-space math.
- `pnpm test` (build + parity) passes. `pnpm exec vitest run` passes.

## Open Questions (to settle in requirements / architecture)

1. **`Mat4` type shape.** Union (`Float32Array | Float64Array`) vs branded
   variants (`Mat4F32` / `Mat4F64`)? Affects every call-site signature.
   Recommended direction: keep `Mat4` opaque/branded so user code stays
   stable; expose precision only via the engine flag, not via the type.
2. **Dispatch strategy.** Generic-over-view-type (one kernel handles both)
   vs duplicated F32/F64 kernels? Decision must satisfy the hot-path
   perf constraint above; benchmark before committing.
3. **Allocation strategy.** See dedicated section above. Must be
   resolved in requirements.
4. **Thin-instance API shape.** Overload `setThinInstances` to accept
   `Float64Array`, add a sibling setter, or auto-detect from view type?
5. **API exposure.** Should F64 mat4 helpers be part of the public
   surface so power users can opt in per-call (even with the flag off),
   or internal-only with the engine flag as the sole control? Default
   recommendation: internal-only — public surface is the engine flag.

## References

- BJS upstream: `packages/dev/core/src/Maths/math.vector.ts` (Matrix class
  with `_m` typed array storage)
- BJS engine option:
  `packages/dev/core/src/Engines/thinEngine.ts` (`useHighPrecisionMatrix`)
- Lite current dead plumbing:
  `packages/babylon-lite/src/engine/engine.ts:27,120,166`
- Lite Mat4 type:
  `packages/babylon-lite/src/math/types.ts:36-38`
- Lite mat4 ops:
  `packages/babylon-lite/src/math/mat4*.ts`
- Parent architecture (LWR M0–M5):
  `docs/architecture/27-large-world-rendering.md`
