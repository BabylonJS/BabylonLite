# GeospatialCamera (Orbital camera)

Porting plan for BJS 9.0's `GeospatialCamera` (authored upstream by @georgie).
See companion doc [`27-large-world-rendering.md`](./27-large-world-rendering.md)
— the two features are orthogonal but compose well (rendering Earth at 1:1
meters needs floating origin to avoid float32 jitter).

## References

- Upstream class: `packages/dev/core/src/Cameras/geospatialCamera.ts`
- Upstream movement: `packages/dev/core/src/Cameras/geospatialCameraMovement.ts`
- Upstream limits: `packages/dev/core/src/Cameras/Limits/geospatialLimits.ts`
- Upstream inputs: `packages/dev/core/src/Cameras/Inputs/geospatial*.ts`, `orbitCameraPointersInput.ts`
- Upstream tests: `packages/dev/core/test/unit/Cameras/geospatialCamera.test.ts`
- Forum thread: [t/61291](https://forum.babylonjs.com/t/61291) (design context)
- BJS doc: <https://doc.babylonjs.com/features/featuresDeepDive/geospatial/geospatialCamera>
- Reference playground: <https://playground.babylonjs.com/#BNOR48>
- Lite baseline: `packages/babylon-lite/src/camera/{arc-rotate,arc-rotate-controls,camera}.ts`, `picking/`

## Design notes (Lite-shaped)

`GeospatialCamera` in BJS is **not** a lat/lon API — it's a Cartesian orbit
camera around a sphere centered at world origin (ECEF convention: +Z = polar
axis). It is a **sibling** of `ArcRotateCamera`, not a subclass. Both extend
`Camera` directly and share `OrbitCameraPointersInput`.

Public surface: `center: Vector3`, `yaw`, `pitch`, `radius`, `limits`,
`movement`, `inputs`. Three "geo-special" tricks:
1. Yaw/pitch built off a per-frame east/north/up basis at `center` (geocentric
   normal = `center.normalize()`; overridable for non-spheres).
2. Drag pipeline anchors the cursor to the picked surface point on the globe
   (tangent-plane raycasting).
3. Zoom-toward-cursor with raycast + altitude-scaled speed.

In Lite, the BJS `CameraInputsManager` / multi-input architecture is heavier
than the existing single-`attachControl` idiom. Recommendation:
**inline geospatial-specific input math into a Lite-style
`attachGeospatialControl(camera, canvas, scene)`** following the pattern of
`arc-rotate-controls.ts`. Keep `CameraMovement`-style frame-rate-independent
inertia decay (`inertia ^ (dt/16.67)`) since BJS does, but don't port the
`CameraMovement` class verbatim.

A precursor concern: Lite needs a `pick(x, y, predicate?)` / `pickWithRay`
surface for the drag-plane and zoom-to-cursor algorithms. Verify against
`packages/babylon-lite/src/picking/` before scoping the port — if missing,
that becomes Phase 0.

Milestones below are **feature-oriented** — each milestone is independently
shippable and lands with the tests that validate what it added. No standalone
"tests" milestone.

## Milestone 1 — Precursors

- **b1-picking**: Confirm `gpu-picker.ts` + a CPU ray-vs-mesh path exist
  and can be called from camera controls. Drag-plane needs a fast
  ray-vs-plane intersection — that's pure math.

_Validation_: code-only verification, no new tests.

## Milestone 2 — Pure-math foundations

- **b2-local-basis**: Port `ComputeLocalBasisToRefs(worldPos) → {east, north, up}`
  with pole-singularity fallback. Pure function in
  `camera/geospatial-math.ts`.
- **b2-yaw-pitch-fwd**: Port `ComputeLookAtFromYawPitchToRef(center, yaw, pitch, radius) → {position, lookAt}`.
- **b2-yaw-pitch-inv**: Port `ComputeYawPitchFromLookAtToRef(...)` with the
  pitch≈0 singularity preserving previous yaw.
- **b2-pole-clamp**: Port `ClampCenterFromPolesInPlace(center)` enforcing
  `|sin(lat)| ≤ 0.998749218` (~89.91°).

_Validation_: Mirror BJS's `geospatialCamera.test.ts` round-trip and
basis-orthonormality cases as Vitest unit tests under `tests/unit/`.

## Milestone 3 — Camera type, view matrix, limits & static parity scene

First renderable milestone. Lands the camera + a static-pose parity scene
(no input yet).

- **b3-type**: Define `GeospatialCamera` interface in
  `camera/geospatial.ts` mirroring Lite's `ArcRotateCamera` shape:
  plain data, `IWorldMatrixProvider`/`IParentable`, push-based dirty
  tracking on `center` (ObservableVec3), `yaw`, `pitch`, `radius`.
- **b3-factory**: `createGeospatialCamera({ planetRadius, center?, yaw?, pitch?, radius? })`
  returning the camera plus computed initial position. Default ctor places
  camera at `(planetRadius * 4, 0, 0)` looking at `(planetRadius, 0, 0)`,
  matching BJS.
- **b3-world-matrix**: Implement camera world matrix via the yaw/pitch fwd
  helpers and `mat4LookAt`, respecting Lite's left-handed convention.
- **b3-limits**: Add `GeospatialLimits` value object (`radiusMin/Max`,
  `pitchMin/Max`, `yawMin/Max`, `pitchDisabledRadiusScale`,
  `clampZoomDistance`, `getEffectivePitchMax`).
- **b3-zoom-helpers**: `zoomToPoint(camera, target, distance)`,
  `zoomAlongLookAt(camera, distance)` — pure setters, no input needed.

_Validation_:

- Unit tests for world matrix correctness at sample yaw/pitch/radius poses
  (`tests/unit/`).
- BJS reference scene `lab/babylon-ref-sceneN.html` using `GeospatialCamera`
  + sphere planet (PG `#BNOR48`); Lite mirror via `createGeospatialCamera`
  with a static pose (no input).
- Golden capture at `reference/sceneN-geospatial-camera/babylon-ref-golden.png`
  (with user approval).
- `tests/parity/scenes/sceneN-geospatial-camera.spec.ts`.
- Bundle-size ceiling in `scene-config.json`; verify scenes not importing
  `geospatial.ts` pay zero bytes.
- `pnpm test` green.

## Milestone 4 — Inertia / movement pipeline

- **b4-movement-state**: Per-camera accumulators
  (`panAccumulatedPixels: Vec2`, `rotationAccumulatedPixels: Vec2`,
  `zoomAccumulatedPixels: number`) and per-axis `panSpeed`, `zoomSpeed`,
  `rotationXSpeed/YSpeed`, `panInertia`, `zoomInertia`,
  `rotationInertia`. Defaults from BJS:
  `rotationXSpeed=rotationYSpeed=π/500`, `panInertia=0`,
  `rotationInertia=0`, `zoomInertia=0.9`, `zoomSpeed=2`.
- **b4-frame-decay**: Per-frame `computeCurrentFrameDeltas()` with
  frame-rate-independent decay `inertia ^ (dt/16.67)`.
- **b4-latitude-altitude-scaling**: Pan dampening
  `sqrt(cos(lat))` reduced by altitude; zoom multiplier
  `0.01 × distance(camera, zoomTarget)`. Disable zoom while drag in
  progress.

_Validation_: Vitest unit tests for frame-decay over varying `dt` and for
lat/altitude scaling at sample positions.

## Milestone 5 — Drag-plane + mouse/wheel input

First interactive milestone. Implements `attachGeospatialControl` with
mouse-only input.

- **b5-attach**: Skeleton `attachGeospatialControl(camera, canvas, scene)`
  following the `arc-rotate-controls.ts` pattern.
- **b5-drag-plane**: Implement `startDrag` / `_recalculateDragPlaneHitPoint`
  / `handleDrag` / `stopDrag`. On pointer-down, ray-pick the globe and
  remember `hitPointRadius`; build tangent plane; per-move, intersect new
  ray with plane in local east/north/up, take delta, transform back to
  ECEF, feed inverse into `panAccumulatedPixels`. Clamp delta to 10% of
  `hitPointRadius`.
- **b5-pointer-mouse**: Left = drag. Right/middle = tilt (yaw/pitch into
  `rotationAccumulatedPixels`). Wheel = zoom toward cursor (raycast +
  altitude-scaled).
- **b5-recenter-on-drag**: After each `_checkInputs` pass, re-pick
  `center` so it stays anchored on the globe surface.

_Validation_: Plumbing test under `tests/plumbing/` that simulates pointer
events and verifies drag-plane anchor invariants (cursor stays glued to the
picked surface point across pointer-move events).

## Milestone 6 — Touch + keyboard input

- **b6-touch**: Single-touch = drag. Pinch = zoom toward centroid
  (raycast); pinch-to-pan threshold = 20 px.
- **b6-keyboard**: Arrows pan (simulate drag from canvas center),
  Ctrl+arrows tilt, +/- zoom toward look vector.

_Validation_: Plumbing tests simulating touch + keyboard events to verify
the same drag/zoom invariants hold across input modalities.

## Milestone 7 — Optional / later

Defer until concrete demand. Each item, when picked up, lands with its own
unit or parity test.

- `flyToAsync` / `flyToPointAsync` / `updateFlyToDestination` +
  `InterpolatingBehavior` (SLERP center + parabolic hop).
- `GeospatialClippingBehavior` (altitude-based near/far adjustment).
- Collision integration (`checkCollisions`, `perFrameCollisionOffset`).
- `calculateUpVectorFromPointToRef` override hook for non-spherical bodies.

## Out of scope (don't port)

- The BJS `CameraInputsManager` / per-input class architecture
  (`OrbitCameraPointersInput` etc.). Lite's flat `attachControl`-style
  function is cleaner and matches the existing `arc-rotate-controls`.
- Inspector v2 property panel.

## Cross-cutting conventions

- **Tree-shaking**: Module must be importable a la carte. No module-level
  `Map`/`Set`/`WeakMap` allocations. Lazy-init any caches.
- **Pure-state handles + standalone functions**: No classes, no methods.
  Every camera operation is a free function over plain data.
- **No bundle-size ceiling raises** without explicit user approval.
- **No golden-reference changes** without explicit user approval.
- **Validate via `pnpm test`** (build:bundle-scenes + parity). **Never run
  `pnpm test:perf`** — perf is user/CI only.
- **Iteration tip**: during dev on a single new scene, run
  `npx playwright test tests/parity/scenes/<scene>.spec.ts` for fast
  feedback; full `pnpm test` before declaring success.
