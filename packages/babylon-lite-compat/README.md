# @babylonjs/lite-compat

An **opt-in Babylon.js-shaped compatibility layer** implemented on top of the
[Babylon Lite](../babylon-lite/) public API. It exists to give Babylon.js apps a
low-friction migration runway to Babylon Lite's WebGPU renderer.

```ts
import { WebGPUEngine, Scene, ArcRotateCamera, HemisphericLight, MeshBuilder, StandardMaterial, Vector3, Color3 } from "@babylonjs/lite-compat";

const engine = new WebGPUEngine(canvas);
await engine.initAsync();

const scene = new Scene(engine);
const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 2.5, 5, new Vector3(0, 0, 0), scene);
camera.attachControl(canvas, true);
new HemisphericLight("light", new Vector3(0, 1, 0), scene);

const box = MeshBuilder.CreateBox("box", { size: 1 }, scene);
const mat = new StandardMaterial("mat", scene);
mat.diffuseColor = new Color3(1, 0, 0);
box.material = mat;

engine.runRenderLoop(() => scene.render());
```

## What it is (and isn't)

- A **class-based, Babylon.js-shaped** surface over Lite's plain-data + factory API.
- **Opt-in:** import it explicitly. It installs no `BABYLON` global and has no
  module-level side effects, so it never bloats consumers that don't use it.
- **Honest:** unsupported Babylon.js APIs throw `LiteCompatError` rather than
  rendering something subtly wrong.
- **Not** a full Babylon.js reimplementation. Particles, GUI, WebXR, audio, decals,
  and other features absent from Babylon Lite are out of scope.

## Status & migration

The per-feature support matrix and the last-synced Babylon.js commit live in
[COMPAT-STATUS.md](./COMPAT-STATUS.md). The intended migration path is:

```
@babylonjs/core  →  @babylonjs/lite-compat  →  babylon-lite (native)
```

## Development

```sh
# Unit tests (GPU-free): math, observables, easing, assets manager
npx vitest run --project compat

# Typecheck the whole package against the linked babylon-lite types
npx tsc -p packages/babylon-lite-compat/tsconfig.json --noEmit
```

Maintenance is automated by the
[`update-compat-layer`](../../.github/copilot/skills/update-compat-layer.md) skill,
which reconciles the layer against new Babylon.js and Babylon Lite changes.
