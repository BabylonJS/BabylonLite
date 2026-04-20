# Module: Lights
> Package path: `packages/babylon-lite/src/light/`

## Purpose

Provides plain-data light definitions for **hemispheric**, **directional**, **point**, and **spot** light types, plus a shared infrastructure layer (`light-base.ts`, `light-matrix.ts`, `types.ts`) and a multi-light UBO packing system (`lights-ubo.ts`). Following Babylon Lite's "pillar 4b" principle, lights are stateless data objects with no scene references.

Factory functions create light objects with sensible defaults; callers add them to scenes or pass them to material setup functions. Each light carries:
- Push-based dirty tracking via `ObservableVec3` for positions/directions
- World-matrix state with parent support (inherited from `light-base.ts`)
- Standard-material UBO writer (`_writeStandardLightUbo`) for the multi-light system
- Lazy PBR extension registration (`_registerPbr`) for tree-shakable PBR support

**PBR light variants** (e.g. `hemispheric-pbr.ts`, `directional-pbr.ts`, `point-pbr.ts`) are dynamically imported only when a light is used with PBR materials. They provide WGSL shader snippets and UBO writers specific to PBR shading, keeping them tree-shakable.

---

## Public API Surface

### Shared Types (`types.ts`)

```typescript
/** Shared base for all light types. Provides pipeline integration callbacks. */
export interface LightBase extends IWorldMatrixProvider, IParentable {
  readonly lightType: string;
  excludedMeshIds?: ReadonlySet<string>;
  includedOnlyMeshIds?: ReadonlySet<string>;
  shadowGenerator?: ShadowGenerator;
  parent: IWorldMatrixProvider | null;
  readonly worldMatrix: Mat4;
  readonly worldMatrixVersion: number;
}

/** @internal */
export interface LightBaseInternal extends LightBase {
  readonly _registerPbr: () => Promise<void>;
  readonly _writeStandardLightUbo?: (data: Float32Array, offset: number) => void;
}

export const MAX_LIGHTS = 4;
export const LIGHT_ENTRY_FLOATS = 16;  // 4 × vec4 = 64 bytes per light

export interface PbrLightExtension {
  readonly tag: string;
  readonly pbrSceneUboFields: readonly { readonly name: string; readonly type: 'f32' | 'vec3<f32>' | 'vec4<f32>' }[];
  emitLightVector(): string;
  emitDirectDiffuse(): string;
  emitGeometricAA(): string;
  writeSceneUbo(data: Float32Array, baseOffset: number, light: LightBase): void;
}
```

### Light Base (`light-base.ts`)

```typescript
/** Create world-matrix state + dirty callback shared by all light types. */
export function createLightBase(getLocalMatrix: () => Mat4): {
  wm: WorldMatrixAccessors;
  onDirty: () => void;
};

/** Mixin world-matrix accessors (parent, worldMatrix, worldMatrixVersion) onto a light object. */
export function applyWorldMatrixAccessors<R>(target: object, wm: WorldMatrixAccessors): R;

export { ObservableVec3 } from '../math/observable-vec3.js';
```

### Light Matrix Helper (`light-matrix.ts`)

```typescript
/** Build a local matrix from a direction vector + optional position.
 *  Column 2 = forward (normalized direction), column 0 = right, column 1 = up. */
export function localMatrixFromDirection(
  dx: number, dy: number, dz: number,
  px?: number, py?: number, pz?: number,
): Mat4;
```

**Algorithm:**
1. Normalize direction: `forward = normalize(dx, dy, dz)`
2. Compute `right = normalize(cross((0,1,0), forward))` (simplified: `right = (-fz, 0, fx)`)
3. Compute `up = cross(forward, right)`
4. Build column-major 4×4 matrix: col0=right, col1=up, col2=forward, col3=position
5. `m[15] = 1`

### Directional Light (`directional-light.ts`)

```typescript
export interface DirectionalLight extends LightBase {
  readonly lightType: 'directional';
  direction: ObservableVec3;
  position: ObservableVec3;
  diffuse: [number, number, number];
  specular: [number, number, number];
  intensity: number;
}

export function createDirectionalLight(
  direction: [number, number, number],
  intensity?: number,   // Default: 1
): DirectionalLight;
```

**Default values:**
| Property   | Default        |
|------------|----------------|
| lightType  | `'directional'`|
| direction  | *(parameter)*  |
| position   | `(0, 0, 0)` via ObservableVec3 |
| diffuse    | `[1, 1, 1]`   |
| specular   | `[1, 1, 1]`   |
| intensity  | `1`            |

### Point Light (`point-light.ts`)

```typescript
export interface PointLight extends LightBase {
  readonly lightType: 'point';
  position: ObservableVec3;
  diffuse: [number, number, number];
  specular: [number, number, number];
  intensity: number;
  range: number;
}

export function createPointLight(
  position: [number, number, number],
  intensity?: number,   // Default: 1.0
): PointLight;
```

**Default values:**
| Property   | Default              |
|------------|----------------------|
| lightType  | `'point'`            |
| position   | *(parameter)* via ObservableVec3 |
| diffuse    | `[1, 1, 1]`         |
| specular   | `[1, 1, 1]`         |
| intensity  | `1.0`                |
| range      | `Number.MAX_VALUE`   |

**Local matrix:** `mat4Translation(position.x, position.y, position.z)` — position only, no orientation.

### Hemispheric Light (`hemispheric.ts`)

```typescript
export interface HemisphericLight extends LightBase {
  readonly lightType: 'hemispheric';
  direction: ObservableVec3;
  intensity: number;
  diffuseColor: [number, number, number];
  groundColor: [number, number, number];
}

export function createHemisphericLight(
  direction?: [number, number, number],   // Default: [0, 1, 0]
  intensity?: number,                      // Default: 1.0
): HemisphericLight;
```

**Default values:**
| Property     | Default        |
|--------------|----------------|
| lightType    | `'hemispheric'`|
| direction    | `(0, 1, 0)` via ObservableVec3 |
| intensity    | `1.0`          |
| diffuseColor | `[1, 1, 1]`   |
| groundColor  | `[0, 0, 0]`   |

### Spot Light (`spot-light.ts`)

```typescript
export interface SpotLight extends LightBase {
  readonly lightType: 'spot';
  position: ObservableVec3;
  direction: ObservableVec3;
  /** Full cone angle in radians. */
  angle: number;
  /** Falloff exponent — higher = sharper spotlight. */
  exponent: number;
  diffuse: [number, number, number];
  specular: [number, number, number];
  intensity: number;
  range: number;
}

export function createSpotLight(
  position: [number, number, number],
  direction: [number, number, number],
  angle: number,
  exponent: number,
  intensity?: number,   // Default: 1.0
): SpotLight;
```

**Default values:**
| Property   | Default              |
|------------|----------------------|
| lightType  | `'spot'`             |
| position   | *(parameter)* via ObservableVec3 |
| direction  | *(parameter)* via ObservableVec3 |
| angle      | *(parameter)*        |
| exponent   | *(parameter)*        |
| diffuse    | `[1, 1, 1]`         |
| specular   | `[1, 1, 1]`         |
| intensity  | `1.0`                |
| range      | `Number.MAX_VALUE`   |

**Local matrix:** Uses `localMatrixFromDirection(direction, position)` — both orientation and position.

---

## Internal Architecture

### Data Structures

All lights are plain JavaScript objects (POJOs) with `Object.defineProperties`-based world-matrix accessors — no classes, no GPU resources. They are passed to material creation functions which pack them into GPU uniform buffers.

### Light Base Infrastructure (`light-base.ts`)

Every light factory:
1. Calls `createLightBase(getLocalMatrix)` which returns `{ wm, onDirty }`:
   - `wm`: `WorldMatrixAccessors` — provides `getWorldMatrix()`, `getWorldMatrixVersion()`, `markLocalDirty()`, and `parent` get/set
   - `onDirty`: callback that calls `wm.markLocalDirty()` — passed to `ObservableVec3` constructors
2. Builds the light data object with `_registerPbr` and `_writeStandardLightUbo` callbacks
3. Calls `applyWorldMatrixAccessors(target, wm)` which uses `Object.defineProperties` to add `parent`, `worldMatrix`, and `worldMatrixVersion` as getters/setters

This pattern eliminates duplicated world-matrix boilerplate across all light types.

### Light Type Discrimination (Standard Material)

Each light writes its type flag at `data[offset + 3]` in `_writeStandardLightUbo`:

| `vLightData.w` | Light Type   | Position/Direction Source |
|-----------------|-------------|--------------------------|
| `0`             | Point       | xyz = world position (worldMatrix col 3) |
| `1`             | Directional | xyz = world direction (worldMatrix col 2) |
| `2`             | Spot        | xyz = world position (worldMatrix col 3) |
| `3`             | Hemispheric | xyz = world direction (worldMatrix col 2) |

### Multi-Light UBO Layout (`lights-ubo.ts`)

The standard material pipeline uses a shared lights UBO supporting up to `MAX_LIGHTS = 4` simultaneous lights.

**Total UBO size:** `LIGHTS_UBO_SIZE = 16 + 4 × 64 = 272 bytes`

**Layout:**

| Offset (bytes) | Size   | Content                          |
|-----------------|--------|----------------------------------|
| 0–3             | 4B     | `count` (u32) — number of active lights |
| 4–15            | 12B    | padding (3 × u32)               |
| 16–79           | 64B    | Light 0 entry (4 × vec4)        |
| 80–143          | 64B    | Light 1 entry (4 × vec4)        |
| 144–207         | 64B    | Light 2 entry (4 × vec4)        |
| 208–271         | 64B    | Light 3 entry (4 × vec4)        |

**Per-light entry layout (LIGHT_ENTRY_FLOATS = 16, 64 bytes):**

| Float Index | Directional (w=1) | Point (w=0) | Spot (w=2) | Hemispheric (w=3) |
|-------------|-------------------|-------------|------------|-------------------|
| [0–2]       | direction (col2)  | position (col3) | position (col3) | direction (col2) |
| [3]         | 1 (type flag)     | 0 (type flag) | 2 (type flag) | 3 (type flag) |
| [4–6]       | diffuse × intensity | diffuse × intensity | diffuse × intensity | diffuseColor × intensity |
| [7]         | MAX_VALUE (range) | range | range | *(unused)* |
| [8–10]      | specular × intensity | specular × intensity | specular × intensity | diffuseColor × intensity |
| [11]        | *(unused)*        | *(unused)* | exponent | *(unused)* |
| [12–14]     | *(unused)*        | *(unused)* | direction (col2) | groundColor × intensity |
| [15]        | *(unused)*        | *(unused)* | cos(angle/2) | *(unused)* |

### UBO Functions (`lights-ubo.ts`)

```typescript
/** Fill a Float32Array with standard light data. */
export function fillLightsData(data: Float32Array, lights: readonly LightBase[]): void;

/** Create a new lights UBO from all standard-compatible lights. */
export function writeLightsUBO(device: GPUDevice, lights: readonly LightBase[]): GPUBuffer;

/** Refresh an existing lights UBO with current light state. */
export function refreshLightsUBO(
  device: GPUDevice,
  buffer: GPUBuffer,
  lights: readonly LightBase[],
  scratch: Float32Array,
): void;
```

**`fillLightsData` algorithm:**
1. Zero the entire Float32Array
2. Iterate lights, skip those without `_writeStandardLightUbo`, stop at `MAX_LIGHTS`
3. Call each light's `_writeStandardLightUbo(data, headerFloats + count * LIGHT_ENTRY_FLOATS)`
4. Write `count` into the first u32 slot via `Uint32Array` view

### PBR Light Extensions

PBR variants are tree-shakable — loaded via dynamic `import()` in each light's `_registerPbr` callback. Each extension implements `PbrLightExtension`:

| Extension | File | Tag | Loaded When |
|-----------|------|-----|-------------|
| Hemispheric PBR | `hemispheric-pbr.ts` | `"hemispheric"` | Hemispheric light used with PBR material |
| Directional PBR | `directional-pbr.ts` | `"directional"` | Directional light used with PBR material |
| Point PBR | `point-pbr.ts` | `"point"` | Point light used with PBR material |
| Spot PBR | *(not yet implemented)* | — | — |

Each extension provides:

1. **`pbrSceneUboFields`** — structured field descriptors for the PBR template composer
2. **`emitLightVector()`** — WGSL code computing L vector, NdotL, and attenuation
3. **`emitDirectDiffuse()`** — WGSL code computing direct diffuse contribution
4. **`emitGeometricAA()`** — WGSL code for geometric anti-aliasing (hemispheric only)
5. **`writeSceneUbo()`** — TypeScript function to pack light data into PBR scene UBO

Registration is done via `_setPbrLightExtension()` from `material/pbr/pbr-flags.js`. Only one PBR light extension is active at a time.

#### Hemispheric PBR UBO Fields

| Offset | Name | Type | Content |
|--------|------|------|---------|
| +0     | `lightDirection` | `vec3<f32>` | direction |
| +3     | `lightIntensity` | `f32` | intensity |
| +4     | `lightDiffuseColor` | `vec3<f32>` | diffuseColor |
| +7     | `_pad1` | `f32` | padding |
| +8     | `lightGroundColor` | `vec3<f32>` | groundColor |

**Hemispheric PBR shading:**
- Light vector: `L = normalize(lightDirection)`, `NdotL = dot(N, L) * 0.5 + 0.5` (wrapped diffuse)
- Diffuse: `mix(groundColor, lightColor, NdotL) * surfaceAlbedo * directIntensity`
- Geometric AA: `directRoughness = max(roughness, pow(saturate(slopeSquare), 0.333))`

#### Directional PBR UBO Fields

Same UBO layout as hemispheric (groundColor present but zeroed).

**Directional PBR shading:**
- Light vector: `L = normalize(-lightDirection)`, `NdotL = max(dot(N, L), 0.0)` (standard Lambertian)
- Diffuse: `surfaceAlbedo * (1/PI) * NdotL * lightColor * directIntensity`
- No geometric AA

#### Point PBR UBO Fields

| Offset | Name | Type | Content |
|--------|------|------|---------|
| +0     | `lightPosition` | `vec3<f32>` | position |
| +3     | `lightIntensity` | `f32` | intensity |
| +4     | `lightDiffuseColor` | `vec3<f32>` | diffuse color |
| +7     | `lightRange` | `f32` | range |
| +8     | `_pointPad` | `vec3<f32>` | padding |

**Point PBR shading:**
- Light vector: `L = normalize(lightPosition - fragPos)`, `lightAtten = 1 / max(distSq, 0.0001)` (inverse-square falloff)
- Diffuse: `surfaceAlbedo * (1/PI) * NdotL * lightColor * lightAtten * directIntensity`
- No geometric AA

### Shader Lighting Math (Standard Material)

(Defined in `standard-textured.fragment.wgsl`, consumed via lights UBO)

**Point light attenuation:**
```
direction = lightPosition - fragmentPosition
attenuation = max(0, 1 - length(direction) / range)
lightVector = normalize(direction)
```

**Directional light:**
```
lightVector = normalize(-lightDirection)
attenuation = 1.0
```

**Spot light attenuation:**
```
lightVector = normalize(lightPosition - fragmentPosition)
attenuation = max(0, 1 - length(lightPosition - fragmentPosition) / range)
cosAngle = dot(normalize(lightDirection), -lightVector)
spotFalloff = max(0, cosAngle - cosHalfAngle) ^ exponent
attenuation *= spotFalloff
```

**Hemispheric light:**
```
lightVector = normalize(lightDirection)
NdotL = dot(normal, lightVector) * 0.5 + 0.5  // wrapped diffuse
diffuse = mix(groundColor, diffuseColor, NdotL) * intensity
```

**Diffuse (Lambertian):**
```
ndl = max(0, dot(normal, lightVector))
diffuse = ndl * lightDiffuseColor * attenuation
```

**Specular (Blinn-Phong):**
```
halfVector = normalize(viewDir + lightVector)
specComp = pow(max(0, dot(normal, halfVector)), max(1, glossiness))
specular = specComp * lightSpecularColor * attenuation
```

---

## Pipeline Configuration

Light modules do not create GPU pipelines. They produce plain data consumed by material pipelines.

The multi-light UBO (`lights-ubo.ts`) creates a single `GPUBuffer` of 272 bytes with `UNIFORM | COPY_DST` usage, refreshed per-frame via `refreshLightsUBO()`.

---

## Shader Logic

Light modules do not contain shaders. The lighting computation lives in the material fragment shaders (`standard-textured.fragment.wgsl`, `standard.fragment.wgsl`). See the shader logic section in [02-standard-textured-material.md](02-standard-textured-material.md).

PBR light extensions emit WGSL snippets that are injected into the PBR fragment shader at pipeline build time via the template composer. The snippets are inlined strings in the extension modules, not separate `.wgsl` files.

---

## State Machine / Lifecycle

### Light Creation

```typescript
// Directional
const light = createDirectionalLight([0, -1, 0], 1.5);
light.position.set(10, 20, 10);  // triggers onDirty → markLocalDirty

// Point
const point = createPointLight([5, 3, 0], 2.0);
point.range = 100;

// Hemispheric
const hemi = createHemisphericLight([0, 1, 0], 0.7);
hemi.groundColor = [0.1, 0.1, 0.1];

// Spot
const spot = createSpotLight([0, 10, 0], [0, -1, 0], Math.PI / 3, 2.0, 1.5);
spot.angle = Math.PI / 4;
```

### Mutation & Dirty Tracking

- Setting `direction.x`, `direction.y`, `direction.z` or calling `direction.set(x,y,z)` on any `ObservableVec3` triggers `onDirty()` → `wm.markLocalDirty()` → increments `worldMatrixVersion`
- `worldMatrix` getter lazily recomputes from `getLocalMatrix()` and parent chain when dirty
- `_writeStandardLightUbo` reads from `worldMatrix` (which auto-resolves parent transforms)

### Multi-Light UBO Lifecycle

1. **Creation:** `writeLightsUBO(device, lights)` — allocates 272-byte UBO, fills with current light state
2. **Per-frame refresh:** `refreshLightsUBO(device, buffer, lights, scratch)` — re-fills scratch Float32Array and uploads
3. **Light filtering:** Only lights with `_writeStandardLightUbo` defined are included; up to `MAX_LIGHTS = 4`

### PBR Registration Lifecycle

1. Material build detects light type and calls `light._registerPbr()`
2. Dynamic import loads the PBR extension module (e.g. `hemispheric-pbr.ts`)
3. Extension calls `_setPbrLightExtension(extension)` to register globally
4. PBR shader template uses the extension's emitted WGSL snippets
5. PBR scene UBO writer calls `extension.writeSceneUbo()` per-frame

**No GPU resources are created by light modules.** All GPU work (UBO creation, data packing) happens in the material module or `lights-ubo.ts`.

---

## Babylon.js Equivalence Map

| Babylon Lite                                    | Babylon.js                                  |
|-------------------------------------------------|---------------------------------------------|
| `createDirectionalLight(dir, intensity)`       | `new DirectionalLight(name, dir, scene)`    |
| `DirectionalLight.direction` (ObservableVec3)  | `DirectionalLight.direction` (Vector3)      |
| `DirectionalLight.position` (ObservableVec3)   | `DirectionalLight.position` (Vector3)       |
| `DirectionalLight.diffuse`                      | `DirectionalLight.diffuse`                  |
| `DirectionalLight.specular`                     | `DirectionalLight.specular`                 |
| `DirectionalLight.intensity`                    | `DirectionalLight.intensity`                |
| `createPointLight(pos, intensity)`             | `new PointLight(name, pos, scene)`          |
| `PointLight.range = Number.MAX_VALUE`           | `PointLight.range` (default very large)     |
| `createHemisphericLight(dir, intensity)`       | `new HemisphericLight(name, dir, scene)`    |
| `HemisphericLight.diffuseColor`                | `HemisphericLight.diffuse`                  |
| `HemisphericLight.groundColor`                 | `HemisphericLight.groundColor`              |
| `createSpotLight(pos, dir, angle, exp, int)`   | `new SpotLight(name, pos, dir, angle, exp, scene)` |
| `SpotLight.angle`                              | `SpotLight.angle`                           |
| `SpotLight.exponent`                           | `SpotLight.exponent`                        |
| `SpotLight.range`                              | `SpotLight.range`                           |
| `LightBase.lightType` string discriminator     | Class hierarchy + `getTypeID()` (internal)  |
| `LightBase.excludedMeshIds`                    | `Light.excludedMeshes`                      |
| `LightBase.includedOnlyMeshIds`                | `Light.includedOnlyMeshes`                  |
| `LightBase.shadowGenerator`                    | `Light.getShadowGenerator()`                |
| `LightBase.parent` (IWorldMatrixProvider)      | `Light.parent` (TransformNode)              |
| Plain data objects (no scene ref)              | Class instances with scene reference         |
| `ObservableVec3` with dirty callback           | `Vector3` + `_markAsDirty()` pattern        |
| `localMatrixFromDirection()`                   | `Light._buildUniformLayout()` (internal)    |
| Light type w flag (0/1/2/3)                    | Internal type system (`LIGHTTYPEID_*`)      |
| `MAX_LIGHTS = 4`                               | `maxSimultaneousLights` (default 4)         |
| `fillLightsData()` / `writeLightsUBO()`       | Babylon's internal light UBO building       |
| `refreshLightsUBO()`                           | Per-frame light uniform update              |
| `_registerPbr()` dynamic import               | Static class registration in Babylon.js     |
| `PbrLightExtension` (emitLightVector, etc.)   | PBR shader includes (`pbrDirectLightingSetupFunctions`, etc.) |

### Key Differences from Babylon.js

1. **No scene reference** — Babylon Lite lights are POJOs with world-matrix accessors; Babylon.js lights are class instances that register with a Scene.
2. **`lightType` string discriminator** — Instead of class hierarchy, each light has a `lightType` string literal (`'directional'`, `'point'`, `'spot'`, `'hemispheric'`).
3. **`ObservableVec3`** — Direction/position use observable vectors with dirty callbacks, replacing Babylon's Vector3 + manual dirty tracking.
4. **Multi-light UBO** — Standard material packs up to 4 lights into a single 272-byte UBO; Babylon.js uses separate per-light uniforms.
5. **Tree-shakable PBR** — PBR light extensions are dynamically imported only when needed; Babylon.js always includes all light-type shaders.
6. **No shadow caster list on lights** — Shadow casters are managed by `ShadowGenerator`, not by the light. Lights reference their shadow generator via `shadowGenerator` property.
7. **Spot light PBR** — Not yet implemented; `_registerPbr` is a no-op for spot lights.

---

## Dependencies

### types.ts
- `../math/types.js` — `Mat4`
- `../scene/parentable.js` — `IWorldMatrixProvider`, `IParentable`
- `../shadow/shadow-generator.js` — `ShadowGenerator` (type-only import)

### light-base.ts
- `../math/types.js` — `Mat4`
- `../scene/parentable.js` — `IWorldMatrixProvider`
- `../scene/world-matrix-state.js` — `createWorldMatrixState`, `WorldMatrixAccessors`
- `../math/observable-vec3.js` — `ObservableVec3` (re-exported)

### light-matrix.ts
- `../math/types.js` — `Mat4`

### directional-light.ts
- `./types.js` — `LightBase`
- `./light-base.js` — `createLightBase`, `applyWorldMatrixAccessors`, `ObservableVec3`
- `./light-matrix.js` — `localMatrixFromDirection`
- `./directional-pbr.js` — dynamic import for `registerDirectionalPbrLight`

### point-light.ts
- `./types.js` — `LightBase`
- `../math/mat4.js` — `mat4Translation`
- `./light-base.js` — `createLightBase`, `applyWorldMatrixAccessors`, `ObservableVec3`
- `./point-pbr.js` — dynamic import for `registerPointPbrLight`

### hemispheric.ts
- `./types.js` — `LightBase`
- `./light-base.js` — `createLightBase`, `applyWorldMatrixAccessors`, `ObservableVec3`
- `./light-matrix.js` — `localMatrixFromDirection`
- `./hemispheric-pbr.js` — dynamic import for `registerHemisphericPbrLight`

### spot-light.ts
- `./types.js` — `LightBase`
- `./light-base.js` — `createLightBase`, `applyWorldMatrixAccessors`, `ObservableVec3`
- `./light-matrix.js` — `localMatrixFromDirection`

### PBR extensions (hemispheric-pbr.ts, directional-pbr.ts, point-pbr.ts)
- `./types.js` — `PbrLightExtension`, `LightBase`
- `../material/pbr/pbr-flags.js` — `_setPbrLightExtension`

### lights-ubo.ts
- `../light/types.js` — `LightBase`, `LightBaseInternal`, `MAX_LIGHTS`, `LIGHT_ENTRY_FLOATS`

---

## Test Specification

1. **Directional light defaults** — `createDirectionalLight([0, -1, 0])` returns `lightType: 'directional'`, direction `(0,-1,0)`, position `(0,0,0)`, diffuse `[1,1,1]`, specular `[1,1,1]`, intensity `1`.
2. **Point light defaults** — `createPointLight([5, 3, 0])` returns `lightType: 'point'`, position `(5,3,0)`, diffuse `[1,1,1]`, specular `[1,1,1]`, intensity `1`, range `Number.MAX_VALUE`.
3. **Hemispheric light defaults** — `createHemisphericLight()` returns `lightType: 'hemispheric'`, direction `(0,1,0)`, intensity `1`, diffuseColor `[1,1,1]`, groundColor `[0,0,0]`.
4. **Spot light defaults** — `createSpotLight([0,10,0], [0,-1,0], PI/3, 2)` returns `lightType: 'spot'`, diffuse `[1,1,1]`, specular `[1,1,1]`, intensity `1`, range `Number.MAX_VALUE`.
5. **Custom intensity** — `createDirectionalLight([1,0,0], 2.5).intensity` should be `2.5`.
6. **Mutability** — All properties should be directly assignable. ObservableVec3 properties support `.x`, `.y`, `.z` setters and `.set(x,y,z)`.
7. **Dirty tracking** — Setting `direction.x = 5` should increment `worldMatrixVersion`.
8. **World matrix** — Directional light's worldMatrix column 2 should match normalized direction.
9. **Parent support** — Setting `light.parent` should affect `worldMatrix` computation.
10. **Light type flags** — `_writeStandardLightUbo` should set w=0 (point), w=1 (directional), w=2 (spot), w=3 (hemispheric).
11. **Spot UBO packing** — Spot light writes exponent at [11], direction at [12–14], cos(angle/2) at [15].
12. **Light UBO packing** — For directional light: `lightData.w = 1`, colors premultiplied by intensity.
13. **Light UBO packing** — For point light: `lightData.w = 0`, `lightDiffuse.a = range`.
14. **Multi-light UBO size** — `LIGHTS_UBO_SIZE = 272` bytes (16 header + 4 × 64).
15. **fillLightsData count** — With 6 lights, only first 4 with `_writeStandardLightUbo` are packed.
16. **localMatrixFromDirection** — Verify column 2 = normalized direction, column 0 = right, column 1 = up.
17. **PBR extension registration** — `_registerPbr()` for hemispheric should dynamically import and call `registerHemisphericPbrLight()`.
18. **PBR UBO writing** — Hemispheric PBR `writeSceneUbo` packs direction, intensity, diffuseColor, groundColor in expected layout.

---

## File Manifest

| File | Role |
|------|------|
| `src/light/types.ts` | `LightBase`, `LightBaseInternal`, `PbrLightExtension` interfaces; `MAX_LIGHTS`, `LIGHT_ENTRY_FLOATS` constants |
| `src/light/light-base.ts` | `createLightBase()`, `applyWorldMatrixAccessors()` — shared world-matrix state factory; re-exports `ObservableVec3` |
| `src/light/light-matrix.ts` | `localMatrixFromDirection()` — builds local 4×4 matrix from direction + position |
| `src/light/directional-light.ts` | `DirectionalLight` interface + `createDirectionalLight()` factory |
| `src/light/point-light.ts` | `PointLight` interface + `createPointLight()` factory |
| `src/light/hemispheric.ts` | `HemisphericLight` interface + `createHemisphericLight()` factory |
| `src/light/spot-light.ts` | `SpotLight` interface + `createSpotLight()` factory |
| `src/light/hemispheric-pbr.ts` | PBR extension for hemispheric light — WGSL snippets + UBO writer; tree-shakable |
| `src/light/directional-pbr.ts` | PBR extension for directional light — WGSL snippets + UBO writer; tree-shakable |
| `src/light/point-pbr.ts` | PBR extension for point light — WGSL snippets + UBO writer; tree-shakable |
| `src/render/lights-ubo.ts` | Multi-light UBO system — `fillLightsData()`, `writeLightsUBO()`, `refreshLightsUBO()`; packs up to 4 lights into 272-byte UBO |
