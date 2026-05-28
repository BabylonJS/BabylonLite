# Babylon File System (Smart Assets, Override Persistence, Project Save/Load)

Porting plan for the "Babylon authoring format" / "Babylon File System" work
landing in BJS on the `projectFile` branch (authored upstream by @gehalper).
The umbrella name comes from the eventual project file (today a JSON; later
something like `.babylonedit` / `.babylonauthoring`).

## What this is

Babylon.js has historically lacked a native authoring layer — `.babylon`
and glTF/GLB are last-mile **transmission** formats. The new system adds a
**compositional authoring layer** built from two independent subsystems
that compose via a project file:

| System | Purpose | Standalone value |
|---|---|---|
| **Smart Assets** | Map logical keys → asset URLs; load/unload/reload by key | Decouples app code from concrete files; swap assets without code changes |
| **Override Persistence** | Capture property edits as non-destructive diffs that survive reload | Works on ANY scene object — useful even without smart assets |

A **project file** composes both (asset map + override list + optional
in-tool-created `inlineObjects`). A **portable bundle** (`.babylonzip` style)
packages project + all referenced files for zero-setup sharing.

## References

- BJS branch: `Babylon2` ↳ `projectFile`
- Upstream impl: `packages/dev/core/src/SmartAssets/{smartAssetManager,overrideManager,projectSerializer,smartAssetSerializer,overrideEntry,smartAssetEvents,smartAssetProvenance}.ts`
- Upstream tests: `packages/dev/core/test/unit/SmartAssets/{smartAssetManager,overrideManager,projectSerializer}.test.ts`
- Upstream Inspector wiring: `packages/dev/inspector-v2/src/services/panes/tools/{smartAssetToolsService,assemblyToolsService,overrideCaptureService}.tsx`, `services/smartAssetHandler.ts`, `inspectable.ts`
- Goals/milestones (BJS-side): `babylon-authoring-format-{goals,milestones-v2,decisions,risks,devdoc}.md` and `specs/file-format/{goals,requirements,architecture}.md` on the branch
- Lite baseline: `packages/babylon-lite/src/asset-container.ts`, `loader-gltf/load-gltf.ts`, `loader-babylon/`, `loader-env/`, `texture/texture-2d.ts`, `scene/scene.ts`

## Design notes (Lite-shaped)

The BJS implementation leans on three pieces Lite **does not have**:
1. **Inspector / Inspector-v2** — nothing in Lite. There is no "Inspector
   override capture," no "drag-drop add asset," no "missing asset modal."
2. **Class-registry serialization** (`RegisterClass` / `GetClass(className)`
   + `Serialize`/`Parse` methods on every object). Lite is functional —
   plain data + factory functions, no `serialize()` methods, no class names.
3. **`FileTools` `asset://` protocol hook** that intercepts every loader. Lite
   has no equivalent global file-tools singleton; loaders take URLs directly.

Mapping these to Lite:

- **Smart asset manager** is portable as-is (rewritten as functional API).
  No prototype monkey-patching — instead, smart-asset-aware loader
  wrappers that take a manager + key, e.g. `loadSmartAssetGltf(mgr, key)`
  internally resolves key → URL → calls `loadGltf(scene, url)`.
- **Override manager** is also portable. Override application is just
  property-path traversal + value coercion on plain objects/arrays —
  arguably *easier* in Lite than in BJS because there are no Color3/Vector3
  classes to coerce into.
- **Inline objects in the project file**: BJS uses `className` →
  `RegisterClass` lookup. Lite has no such registry. v1 approach: support
  inline objects only for a small, hand-coded set (`StandardMaterial`,
  `PbrMaterial`, lights, cameras) — each with its own
  `serializeFoo(obj) → JSON` / `deserializeFoo(JSON) → obj` pair. Tree-shaken
  per-type via the existing extension-registry pattern (cf. PBR/Standard
  extension registries).
- **No Inspector** ⇒ override persistence in Lite is **pure
  infrastructure**, not a standalone shippable feature. On its own,
  `addOverride(om, ...)` is just `obj.prop = value` with extra ceremony.
  The value emerges only in composition with **smart-asset reload**
  (auto-reapply tweaks across asset versions), the **project file**
  (portable diff that survives reload + share), or a **future
  editor/inspector**. The plan reflects this by treating overrides as a
  dependency of M3 (project file) rather than as its own user-visible
  milestone. An optional auto-tracking opt-in (analogous to the existing
  `enableMaterialTracking()` API) is included as a sub-feature of M2 for
  hosts that want setter-based diff capture without manual
  `addOverride()` calls.
- **`asset://` URL protocol** — Lite has no FileTools, but the same effect
  is achievable cheaply: loader wrappers detect the `asset://` scheme and
  dispatch through the manager. Tree-shakable: scenes that never import
  the smart-assets module never see this code path.
- **Bundle file format** (zip): Use the standard
  [`@zip.js/zip.js`](https://gildas-lormeau.github.io/zip.js/) library
  (small, pure-JS, browser-friendly, already used elsewhere in the BJS
  ecosystem) — but only loaded when the bundle save/load APIs are used,
  via dynamic `import()` so the zip dependency doesn't bloat scenes that
  don't touch bundles.
- **Browser file I/O** — same constraints as BJS: File System Access API
  (Chrome/Edge) for "save to same file" workflows; `<a download>` blob URL
  fallback for everything else; `<input type=file>` for load. Lite ships
  the helpers but is host-agnostic — embedders supply the trigger UI.

Public API shape (v1 sketch):

```ts
// Smart assets
const sam = createSmartAssetManager(scene);
addSmartAsset(sam, "chair", "https://cdn/chair.glb");
const result = await loadSmartAsset(sam, "chair");   // returns AssetContainer
unloadSmartAsset(sam, "chair");
reloadSmartAsset(sam, "chair");
setSmartAssetUrl(sam, "chair", "https://cdn/chair_v2.glb");
onSmartAssetLoaded(sam, (e) => {...});
onSmartAssetNotFound(sam, async (key, url) => urlOrFileOrNull);

// Overrides
const om = createOverrideManager(scene);
linkOverrideManager(om, sam);
addOverride(om, { key: "chair", targetType: "materials", targetName: "wood", propertyPath: "albedoColor", value: [1,0,0] });
removeOverride(om, entry);
resetToOriginal(om, target, propertyPath);

// Project file
const json = serializeProject(sam, om, { baseUrl });
await deserializeProject(scene, json, { baseUrl });

// Bundle
const blob = await saveProjectBundle(sam, om);   // dynamic-imports zip.js
await loadProjectBundle(scene, blobOrFile);
```

Milestones below are **feature-oriented** — each milestone is independently
shippable and lands with the tests that validate what it added. No standalone
"tests" milestone.

## Milestone 1 — SmartAsset loading (key → URL → load/unload/reload)

The smallest useful surface. No serialization, no overrides, no bundles.
Pure runtime asset management with key-based identity.

- **fs1-types**: Define `SmartAssetManager` handle + provenance + event
  types in `smart-assets/types.ts`. Plain-data state, no methods.
- **fs1-manager**: `createSmartAssetManager(scene)`, `addSmartAsset`,
  `removeSmartAsset`, `setSmartAssetUrl`, `getSmartAssetUrl`,
  `listSmartAssetKeys`. Manager attached to scene metadata for discovery.
- **fs1-load-glb**: `loadSmartAsset(mgr, key)` for GLB/glTF — resolves
  key → URL, calls existing `loadGltf(scene, url)`, tracks resulting
  `AssetContainer` per key, marks each loaded entity with key provenance
  (`WeakMap<object, key>`), fires `onAssetLoaded`.
- **fs1-unload-reload**: `unloadSmartAsset` removes the container's
  entities from the scene and disposes GPU resources;
  `reloadSmartAsset` = unload + load with same key.
- **fs1-load-others**: Extend to standalone textures
  (`loadSmartAssetTexture2D`), env (`loadSmartAssetEnvironment`), and
  `.babylon` (`loadSmartAssetBabylon`). Each is a thin wrapper over the
  existing Lite loader.
- **fs1-not-found**: `onAssetNotFound` callback — when a load fails with
  network error / 404, invoke and retry with the returned URL or `File`.
  Default behavior: skip with console warning (no UI in Lite core).
- **fs1-events**: `onAssetLoaded`, `onUrlChanged`, `onAssetError`,
  `onAssetUnloaded` observables.

_Validation_:

- Vitest unit tests in `tests/unit/smart-assets/` covering the manager
  CRUD, provenance map, key-collision behavior, and event firing. Mirror
  BJS's `smartAssetManager.test.ts` cases that are loader-agnostic
  (use stub loaders).
- Plumbing test in `tests/plumbing/` that drives a real
  `loadSmartAsset` against a fixture GLB, then `unloadSmartAsset`, then
  asserts scene entity count returns to baseline and GPU buffers are freed.
- Bundle-size: verify that scenes which don't import
  `smart-assets/manager` pay zero bytes.

## Milestone 2 — Override persistence (infrastructure for M3)

> **Why this isn't a user-facing milestone.** Without an inspector or
> editor consuming it, a programmatic override API on its own is just
> `obj.prop = value` with extra ceremony. This milestone exists as
> infrastructure that earns its keep when paired with **smart-asset
> reload** (auto-reapply tweaks across asset versions, M1+M2) and with
> the **project file** (portable diff that survives reload + share, M3).
> Ship it together with M3 — don't ship it alone.

Captures and replays property diffs on plain Lite data, matching BJS's
`OverrideManager` shape so project files round-trip between Lite and BJS.

- **fs2-entry-type**: `IOverrideEntry { key?: string; targetType: "materials" | "meshes" | "lights" | "cameras" | "transformNodes" | "scene"; targetName?: string; propertyPath: string; value: OverrideValue }`. Match BJS structure for project-file portability.
- **fs2-manager**: `createOverrideManager(scene)`, `addOverride`,
  `removeOverride`, `listOverrides`, `linkOverrideManager(om, sam)`.
- **fs2-target-resolution**: Resolve `(key, targetType, targetName)` →
  the actual entity in the scene, walking the SAM's loaded containers
  for keyed targets and the scene's top-level lists for unkeyed targets.
- **fs2-property-path**: Dotted-path setter
  (`material.coatLayer.intensity = 0.5`) over plain Lite objects/arrays.
  Coerce array literals to typed arrays as needed (Lite uses plain arrays
  for `Vec3` / `Color3`-equivalents — coercion is mostly identity).
- **fs2-original-snapshot**: At override-add time, capture the current
  value into `_originalValues` so `resetToOriginal(om, ...)` works.
- **fs2-reapply-on-reload**: When SAM reloads a key, the OM
  reapplies all overrides whose `key` matches. **This is the first
  user-visible payoff** of the milestone (smart-asset reload preserves
  code-applied tweaks).
- **fs2-material-dirty**: After applying a material-property override,
  call `markMaterialDirty(material)` so the UBO refreshes.
- **fs2-auto-tracking** _(optional sub-feature)_: Tree-shakable
  `enableOverrideTracking(target, om, key?)` that installs
  `Object.defineProperty` setters to auto-record diffs without manual
  `addOverride()` calls. Mirrors the existing `enableMaterialTracking()`
  pattern (`docs/porting-guide.md`). Include only if a real caller
  exists; otherwise defer to M7 (optional).

_Validation_:

- Vitest unit tests mirroring BJS's `overrideManager.test.ts` — add /
  remove / list, dotted-path setters, value coercion, original snapshot,
  reset-to-original, reapply-on-reload, scene-level overrides
  (clearColor, fog, environment).
- Plumbing test that exercises the **reload-reapply** payoff: load a
  smart-asset GLB, apply an albedoColor override, reload, assert the
  override re-applies to the new material.

## Milestone 3 — Project file save/load (JSON, no bundle)

First fully user-visible milestone. The unified on-disk format combining
smart asset map + overrides + optional inline objects. Versioned schema
matching BJS's `ISerializedProject` so files round-trip between Lite and
BJS where features overlap. Ship M2 + M3 together.

- **fs3-serialize**: `serializeProject(sam, om, opts) → ISerializedProject`.
  Asset map: key → URL, optionally relative to `baseUrl`. Overrides:
  pass through. Inline objects: skip in this milestone (M4).
- **fs3-deserialize**: `deserializeProject(scene, json, opts) → Promise<{sam, om}>`.
  Schema-version check, asset map rebuild, override list rehydration,
  parallel `loadSmartAsset()` for every key, then apply overrides.
- **fs3-relative-urls**: `ResolveAssetUrl(url, baseUrl)` matching BJS so
  shared project files work portably.
- **fs3-not-found-flow**: Wire `onAssetNotFound` from M1 into
  `deserializeProject` so missing files trigger the host-supplied
  callback (e.g., a future inspector picker, or `<input type=file>` in a
  demo page).
- **fs3-host-helpers**: Tiny helpers for browser save/load:
  `downloadProjectJson(json, filename)` (blob URL + `<a download>`),
  `pickProjectJson() → Promise<{json, baseUrl}>`
  (`<input type=file>`). Both are pure browser APIs; tree-shakable.

_Validation_:

- Vitest unit tests mirroring BJS's `projectSerializer.test.ts` —
  round-trip fidelity, schema version, missing-asset error path,
  relative URL resolution.
- Plumbing test: build a 3-asset scene with overrides, serialize,
  reset the scene, deserialize, assert pixel-equal render to the
  original via the parity oracle.

## Milestone 4 — Inline objects (in-tool-created entities)

Lets a project file persist materials/lights/cameras created in code
(not loaded from any smart asset). v1 covers a small fixed set; the
extension registry pattern makes it easy to add types later.

- **fs4-registry**: Lazy `inlineObjectSerializers` registry keyed by
  Lite type tag (e.g. `"PbrMaterial"`, `"StandardMaterial"`,
  `"DirectionalLight"`, `"HemisphericLight"`, `"SpotLight"`,
  `"ArcRotateCamera"`). Per-type `serialize` / `deserialize` pairs
  registered from their owning modules — opt-in, tree-shakable.
- **fs4-collect**: During `serializeProject`, walk the scene's
  materials/lights/cameras lists; for each that is **not** owned by any
  smart asset key (per the SAM provenance map), serialize via the
  registry. Skip silently if no serializer is registered for the type.
- **fs4-restore**: During `deserializeProject`, after assets load, walk
  `inlineObjects` and call the matching deserializer; resolve scene-graph
  references (e.g. material assigned to mesh) by name.

_Validation_:

- Vitest unit tests for registry CRUD, "no serializer registered →
  skip" behavior, and one round-trip per shipped type
  (PbrMaterial + DirectionalLight is enough for v1).
- Plumbing test: scene with one in-tool PbrMaterial assigned to a
  smart-asset mesh; serialize → reset → deserialize; assert material
  reattaches and renders correctly.

## Milestone 5 — Portable project bundle (`.babylonzip`)

Packages the project JSON + all referenced files into a single zip so a
recipient can open the project with zero setup. Dynamic-imports the zip
library so non-bundle scenes pay zero bytes.

- **fs5-save**: `saveProjectBundle(sam, om) → Promise<Blob>`. Dynamic
  `import("@zip.js/zip.js")`. Layout matches BJS:
  ```
  project.json
  assets/<key>/<filename>
  ```
  Rewrite asset URLs to relative `assets/...` paths in the embedded
  project.json. Fetch each referenced URL and inline its bytes.
- **fs5-load**: `loadProjectBundle(scene, blobOrFile) → Promise<{sam, om}>`.
  Dynamic-import zip lib; unpack into a `Map<path, Blob>`; rewrite
  `assets/...` paths to in-memory `blob:` URLs; deserialize the project.
- **fs5-validate**: On load, check schema + assert every referenced
  asset path is present in the zip; return structured errors for
  missing files.
- **fs5-host-helpers**: `downloadProjectBundle(blob, filename)` and
  `pickProjectBundle() → File`.

_Validation_:

- Plumbing test: build → save bundle → unload everything → load bundle →
  pixel-parity assert.
- Bundle-size: verify that scenes not importing
  `smart-assets/bundle` pay zero bytes (the dynamic import means zip
  lib code never lands in static analysis of an unbundled scene).

## Milestone 6 — Loader composition for assembly workflows

Enables the "assemble a scene from individual parts" story: import a
mesh GLB, separate textures, separate animation files, build a material
in code, wire it all together, save as a project. Most of the
infrastructure already exists from M1–M5; this milestone is glue.

- **fs6-loader-coverage**: Confirm Lite can load all atomic types as
  smart assets: GLB (✅ M1), glTF (✅), PNG/JPG/EXR/ENV
  (`loadTexture2D`, `loadEnvironment` — wrap as smart-asset variants),
  `.babylon` (`loadBabylon` — wrap), animation-only files
  (verify what Lite supports — likely glTF animation extraction).
- **fs6-attach-helpers**: Convenience helpers for assembly —
  `assignSmartAssetTexture(mgr, materialKey, slotPath, textureKey)`
  recorded as overrides so they round-trip via the project file.
- **fs6-glb-export**: Verify Lite has (or add) a minimal
  `exportSceneToGlb(scene)` for the "export to GLB" half. If not present
  in Lite, mark as a separate downstream porting task and ship M6
  without it (the project file is sufficient for round-trip authoring;
  GLB export is an additional output channel).

_Validation_:

- Plumbing test: assemble scene from 1 mesh + 2 textures + 1 in-tool
  material; save project; reload; pixel-parity check.

## Milestone 7 — Optional / later

Defer until concrete demand. Each item, when picked up, lands with its
own unit or plumbing test.

- **Lite Inspector / external editor integration** — when a Lite
  inspector emerges (or a partner editor adopts Lite), wire override
  capture, missing-asset modals, and a smart-asset visualization pane.
  Until then the API is host-agnostic.
- **Auto-tracked overrides** — promote the M2 sub-feature
  (`enableOverrideTracking`) into a first-class deliverable once a real
  caller exists (typically the future inspector above).
- **`asset://` URL protocol convenience** — let any Lite loader URL
  string starting with `asset://key` route through the SAM
  automatically. Tiny, but only useful once user code is dense with
  URL handling.
- **Multi-layer overrides** — USD-style opinion stacks. v1 is single-layer
  per the BJS architecture decision; the data model already supports
  per-entry layer ID if added later.
- **Compression in bundles** — Draco geometry / Basis textures embedded
  in the bundle. Lite already has Draco for runtime decode; reusing the
  encoder side is a separate scope.
- **`@zip.js/zip.js` alternative** — if the dynamic import proves
  problematic for some hosts, swap for a smaller hand-rolled
  STORE-only zip writer (no compression, just concatenation + CRC).

## Out of scope (don't port)

- BJS's `RegisterClass` / `GetClass` global class registry. Replaced by
  the per-type inline-object registry pattern (M4).
- BJS Inspector v2 services. Lite has no inspector today; the API is
  designed to be host-agnostic so any future inspector or external
  editor can plug in.
- BJS `FileTools.preprocessUrl` monkey-patching. Loader wrappers serve
  the same role with cleaner tree-shaking.
- BJS Playground integration. Lite has no Playground; if a Lite-aware
  Playground emerges, it consumes the same JSON schema.

## Cross-cutting conventions

- **Tree-shaking**: Every smart-asset and override module must be
  importable a la carte. No module-level `Map`/`Set`/`WeakMap`
  allocations — use lazy init. Dynamic-import the zip dependency.
  Verify zero-byte cost for scenes that don't import the modules.
- **Pure-state handles + standalone functions**: No classes, no methods.
  Match the existing Lite API style (cf. `gpu-picker.ts`, scene API).
- **Schema portability with BJS**: Match `ISerializedProject` /
  `IOverrideEntry` field names so project files round-trip between
  Lite and BJS where features overlap.
- **No bundle-size ceiling raises** without explicit user approval.
- **No golden-reference changes** without explicit user approval.
- **Validate via `pnpm test`** (build:bundle-scenes + parity). **Never run
  `pnpm test:perf`** — perf is user/CI only.
- **Iteration tip**: during dev on a single new scene/test, run
  `npx playwright test tests/plumbing/<spec>.spec.ts` for fast feedback;
  full `pnpm test` before declaring success.
