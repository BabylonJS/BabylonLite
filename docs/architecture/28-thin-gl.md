# Module: Thin-GL (WebGL2 sibling package)

> Package path: `packages/babylon-thin-gl/src/`
> Package name: `@babylon-lite/thin-gl`
> Status: design / one-shot specification (no code yet).

---

## 0. Pillar reconciliation

`GUIDANCE.md` pillar #1 says *"WebGPU Exclusive — zero WebGL fallback."*
This package is an **explicit, scoped carve-out** of that pillar, justified by:

1. It is a **separate package** (`packages/babylon-thin-gl/`). The `babylon-lite` package itself remains 100% WebGPU. The two packages never import each other.
2. It exists for a **single external consumer** (Microsoft NeonBrush) which is locked to WebGL today and pulls ~120–150 KB of `@babylonjs/core` for a tiny surface. Replacing that with a ~10–12 KB function-only package is the same "slim, not dumb" reduction the Lite pillars exist to deliver — applied to a different backend.
3. Every other pillar still applies, verbatim: pure-state interfaces, free functions, tree-shakable, zero module-level side effects, no class hierarchies, no abstraction over WebGL1, branchless hot paths via cached state, lazy-init caches owned by the context.

If the rule "no WebGL ever" is preferred, do not merge this doc — the scope dies cleanly with zero impact on the WebGPU core.

---

## 1. Purpose

Provide a minimal, function-only, tree-shakable WebGL2 runtime that re-implements the subset of Babylon.js `ThinEngine` + `Effect` + `EffectWrapper` + `EffectRenderer` + `ThinTexture` actually used by the NeonBrush family of fullscreen-quad effects (Cloth, Orb, Scan, InputGlow, Progressive / RockSteady / Magic loading screens, except the magic-particles sprite path).

Non-goals:

- No WebGL1 path.
- No scene graph, no materials, no meshes, no skinning, no PBR.
- No render-to-texture in v1 (NeonBrush always renders to the canvas).
- No `SpriteRenderer` / `ThinSprite` in v1 (deferred; the magic loading screen keeps stock Babylon until v2).
- No runtime shader preprocessor (`attribute`→`in` etc.). Consumers ship GLSL ES 3.00.
- No shader-store, no `#include`, no observables, no engine-level customization extension points.
- No GPU resource pool. The browser owns lifetimes; we own caches.

---

## 2. Pillars (inherited from `babylon-lite`)

- **Pure state interfaces.** `WebGLContext`, `GLEffect`, `GLTexture`, `GLEffectWrapper` are plain data. Behaviour is provided by standalone functions accepting the state as the first argument.
- **No classes.** No `class` keyword anywhere in the package source.
- **Tree-shakable.** Every setter, every loader, every helper is its own `export`. Unused symbols disappear from final bundles.
- **Zero module-level side effects.** No top-level `new Map()`, `new WeakMap()`, `new Set()`. Caches live on `ctx._state`; the single per-package lazy resource (fullscreen quad) is created on first `applyEffectWrapper` and stored on the context, never as a module-scoped allocation. `sideEffects: false` in `package.json`.
- **One-way data ownership.** `WebGLContext` owns `GLState`. `GLEffect`s and `GLTexture`s do not reference the context; functions take both explicitly. Effects do not know about wrappers; wrappers reference effects but only as plain data.
- **Branchless hot path.** Each cached setter has the shape *(equality check → early return)* before any GL call. No `if (option) doExtra()` style branches in per-frame code.
- **No abstraction layers.** WebGL2 directly, no facade pattern, no enums, no constants table — we use `gl.TRIANGLES`, `gl.UNSIGNED_SHORT`, etc. directly.

---

## 3. Public API Surface

All signatures are final. Exhaustive — these are the only exports.

### 3.1 Context

```ts
export interface WebGLContextOptions {
    /** Default: true. */
    alpha?: boolean;
    /** Default: true. */
    premultipliedAlpha?: boolean;
    /** Default: false. */
    antialias?: boolean;
    /** Default: false. */
    preserveDrawingBuffer?: boolean;
    /** Default: false — disabled for fullscreen-quad workloads. */
    depth?: boolean;
    /** Default: false. */
    stencil?: boolean;
    /** Default: "default". */
    powerPreference?: WebGLPowerPreference;
    /** Default: false. */
    failIfMajorPerformanceCaveat?: boolean;
}

export interface WebGLContextCaps {
    readonly maxTextureSize: number;
    readonly maxTextureUnits: number;
    readonly parallelShaderCompile: { COMPLETION_STATUS_KHR: number } | null;
}

/** Pure-state handle. GPU internals (`gl`, `_state`, registries) are reachable
 *  on the type so functions in this package can operate without casts.
 *
 *  INVARIANT: consumers MUST NOT mutate GL state directly through `ctx.gl`.
 *  Doing so silently corrupts the cache in `_state`. The package owns every
 *  GL call. (`ctx.gl` is exposed only so adjacent NeonBrush code that already
 *  has the pattern of poking `engine._gl.getExtension(...)` can do that, but
 *  must NOT call `bindTexture`/`useProgram`/`bindBuffer`/`viewport`/etc.) */
export interface WebGLContext {
    readonly canvas: HTMLCanvasElement;
    readonly gl: WebGL2RenderingContext;
    readonly caps: WebGLContextCaps;
    /** Hardware-scaling-level. width/height = canvas.client* * dpr / _hsl. */
    _hsl: number;
    /** rAF id when a render loop is active, 0 otherwise. */
    _rafId: number;
    /** Active per-frame callbacks. `runRenderLoop` is a no-op if `fn` is already
     *  registered (matches Babylon `AbstractEngine.runRenderLoop`). */
    _loops: ((dt: number) => void)[];
    /** Timestamp of last frame for delta computation. */
    _prevNow: number;
    /** Cached GL state. See §4. */
    _state: GLState;
    /** Live effect registry — populated by `createEffect`, removed by
     *  `disposeEffect`. Used by the context-lost/restored protocol (§4.7)
     *  to rebuild programs. */
    _effects: GLEffect[];
    /** Live texture registry — populated by `createRawTexture` /
     *  `loadTexture2D` / `createHtmlElementTexture`, removed by
     *  `disposeTexture`. Used by the context-restored protocol to replay
     *  uploads. */
    _textures: GLTexture[];
    /** Context-lost / restored callback lists. */
    _onLost: (() => void)[];
    _onRestored: (() => void)[];
    /** True between `webglcontextlost` and `webglcontextrestored`. While true,
     *  every `setEffect*` / `bindTexture` / `drawEffect` is a no-op. */
    _isLost: boolean;
    /** True once the context has been disposed; calls become no-ops. */
    _disposed: boolean;
}

export function createWebGLContext(canvas: HTMLCanvasElement, options?: WebGLContextOptions): WebGLContext;
export function disposeWebGLContext(ctx: WebGLContext): void;

export function resizeWebGLContext(ctx: WebGLContext): void;
export function getRenderWidth(ctx: WebGLContext): number;
export function getRenderHeight(ctx: WebGLContext): number;
export function getHardwareScalingLevel(ctx: WebGLContext): number;
export function setHardwareScalingLevel(ctx: WebGLContext, level: number): void;
export function getRenderingCanvas(ctx: WebGLContext): HTMLCanvasElement;

export function onWebGLContextLost(ctx: WebGLContext, cb: () => void): void;
export function offWebGLContextLost(ctx: WebGLContext, cb: () => void): void;
export function onWebGLContextRestored(ctx: WebGLContext, cb: () => void): void;
export function offWebGLContextRestored(ctx: WebGLContext, cb: () => void): void;
```

### 3.2 Render loop

```ts
export function runRenderLoop(ctx: WebGLContext, fn: (dt: number) => void): void;
export function stopRenderLoop(ctx: WebGLContext, fn?: (dt: number) => void): void;
```

- `runRenderLoop(ctx, fn)` is a **no-op when `fn` is already registered** (matches `AbstractEngine.runRenderLoop`). Each unique callback executes once per frame.
- `stopRenderLoop(ctx)` with no callback stops all loops; with a callback removes that one only.

### 3.3 Effects

```ts
export interface GLEffectOptions {
    name: string;
    vertexSource: string;     // GLSL ES 3.00, ready for `gl.shaderSource`
    fragmentSource: string;   // GLSL ES 3.00
    /** Declared uniform names. Locations resolved during readiness finalization
     *  (§4.6). Declaring them up front lets the package allocate the per-uniform
     *  value cache. Setters for names not in this list are legal but allocate
     *  the cache slot lazily on first use. */
    uniformNames: readonly string[];
    /** Declared sampler names, in unit-assignment order. Each gets a fixed
     *  texture unit assigned during readiness finalization (§4.4 / §4.6), and
     *  `gl.uniform1i(loc, unit)` is called exactly once per program lifetime
     *  (re-run after context-restored). */
    samplerNames: readonly string[];
    /** Declared vertex attributes. Default: `["position"]`. The first attribute
     *  is bound to location 0 via `gl.bindAttribLocation(program, 0, name)`
     *  BEFORE link, so the shared fullscreen-quad VAO (§4.5) always feeds the
     *  same location regardless of how the GLSL compiler would have assigned
     *  it. The GLSL conversion (§6) also emits `layout(location = 0)` as
     *  belt-and-suspenders. */
    attributeNames?: readonly string[];
    /** Optional `#define` block inserted between `#version 300 es` (+ precision)
     *  and the user shader body. Example: `"#define LANDSCAPE 1\n#define USE_RAMP 1\n"`.
     *  Each unique `defines` string must be paired with the same vertex/fragment
     *  source via a separate `createEffect` call — the package does NOT cache
     *  compiled variants. Used by `orbEffect` (LANDSCAPE), `clothEffectVNext`,
     *  and `progressiveLoadingScreen` (BACKGROUNDCOLORRAMP). */
    defines?: string;
}

export interface GLEffect {
    readonly name: string;
    readonly options: GLEffectOptions;          // retained for re-compile on context restore
    program: WebGLProgram;                       // mutable — replaced on restore
    _vs: WebGLShader;
    _fs: WebGLShader;
    /** Resolved during readiness finalization (§4.6). Missing names map to
     *  `null` — setters with a `null` location are silent no-ops (matches
     *  Babylon behaviour for misspelled uniform names). */
    uniformLocations: { [name: string]: WebGLUniformLocation | null };
    /** Fixed unit assignment, index into `_state.boundTextures`. Populated
     *  during readiness finalization. */
    samplerUnits: { [name: string]: number };
    /** True once `gl.uniform1i(samplerLoc, unit)` has been issued for every
     *  declared sampler. Cleared on context restore so finalization re-runs. */
    _samplersAssigned: boolean;
    /** Resolved by `getAttribLocation`. -1 means "not found". For the first
     *  declared attribute this is always 0 because of the pre-link `bindAttribLocation`. */
    attributeLocations: { [name: string]: number };
    /** Per-uniform last-UPLOADED value caches. Allocated up front from
     *  `uniformNames` plus lazily on first use for any extra name. Entries are
     *  written ONLY after a successful `gl.uniform*` call — a setter that
     *  skips the upload (effect not ready, location null, context lost) must
     *  NOT update the cache, otherwise a later "real" set with the same value
     *  would incorrectly elide.
     *
     *  Vec slots are plain `number[]` (NOT `Float32Array`) to avoid float32
     *  truncation breaking equality for common values like `0.1`. */
    readonly _lastF1: { [name: string]: number };
    readonly _lastVec: { [name: string]: number[] };
    readonly _lastI1: { [name: string]: number };
    /** Compile/link state machine. */
    isReady: boolean;
    _compileError: string | null;
    _disposed: boolean;
    /** Callbacks registered before isReady=true; fired exactly once on the
     *  first transition to ready. Re-registered listeners after restore wait
     *  for the next finalization. */
    readonly _onCompiled: ((effect: GLEffect) => void)[];
}

export function createEffect(ctx: WebGLContext, options: GLEffectOptions): GLEffect;
export function isEffectReady(ctx: WebGLContext, effect: GLEffect): boolean;
export function executeWhenCompiled(ctx: WebGLContext, effect: GLEffect, cb: (e: GLEffect) => void): void;
export function disposeEffect(ctx: WebGLContext, effect: GLEffect): void;

/** Sets ctx._state.currentProgram and calls gl.useProgram(...) iff changed.
 *  No-op when the effect is not ready. */
export function useEffect(ctx: WebGLContext, effect: GLEffect): void;

// Cached uniform setters — see §4 for the exact cache contract.
export function setEffectFloat(ctx: WebGLContext, effect: GLEffect, name: string, x: number): void;
export function setEffectFloat2(ctx: WebGLContext, effect: GLEffect, name: string, x: number, y: number): void;
export function setEffectFloat3(ctx: WebGLContext, effect: GLEffect, name: string, x: number, y: number, z: number): void;
export function setEffectFloat4(ctx: WebGLContext, effect: GLEffect, name: string, x: number, y: number, z: number, w: number): void;
export function setEffectColor3(ctx: WebGLContext, effect: GLEffect, name: string, c: { r: number; g: number; b: number }): void;
export function setEffectColor4(ctx: WebGLContext, effect: GLEffect, name: string, c: { r: number; g: number; b: number; a: number }): void;
export function setEffectInt(ctx: WebGLContext, effect: GLEffect, name: string, x: number): void;
export function setEffectTexture(ctx: WebGLContext, effect: GLEffect, samplerName: string, tex: GLTexture): void;
```

### 3.4 Textures

```ts
export interface GLTextureOptions {
    /** Default: false. */
    generateMipMaps?: boolean;
    /** Default: false (matches Babylon's default raw-texture behaviour). */
    invertY?: boolean;
    /** WebGL2 sampling mode. Default: gl.LINEAR (mip: NEAREST). Pass gl.NEAREST for nearest. */
    minFilter?: GLenum;
    magFilter?: GLenum;
    /** Default: gl.CLAMP_TO_EDGE for both. */
    wrapS?: GLenum;
    wrapT?: GLenum;
}

export interface GLTexture {
    /** Mutable so the SAME logical texture can survive context restore:
     *  the handle is replaced, but every consumer keeps the same `GLTexture`
     *  object. `loadTexture2D` also uses the same handle for both the 1×1
     *  placeholder upload AND the final image upload — bindings made before
     *  `isReady=true` remain valid. */
    handle: WebGLTexture;
    readonly target: GLenum;          // gl.TEXTURE_2D
    width: number;
    height: number;
    isReady: boolean;
    _disposed: boolean;
    /** Internal ref count for shared textures (HtmlElementTexture wrappers etc.). */
    _refCount: number;
    /** Replay closure for context-restore (§4.7). Captures the original
     *  arguments (raw bytes + format/type, or decoded `ImageBitmap`, or
     *  the source HTML element) and re-issues the `gl.texImage2D` /
     *  `texParameteri` sequence. */
    _upload: (ctx: WebGLContext) => void;
}

/** Uint8 raw upload. `format` and `type` are GL constants; the caller picks
 *  e.g. (gl.RGBA, gl.UNSIGNED_BYTE). Matches NeonBrush's createRawTexture usage. */
export function createRawTexture(
    ctx: WebGLContext,
    data: ArrayBufferView | null,
    width: number,
    height: number,
    format: GLenum,
    type: GLenum,
    options?: GLTextureOptions
): GLTexture;

/** Async image upload. The returned texture is usable immediately (1×1 transparent
 *  placeholder uploaded into the final handle) and becomes `isReady=true` when
 *  the network/decode completes and the real image has been uploaded into the
 *  same `WebGLTexture` handle. `ImageBitmap` is retained on the GLTexture for
 *  context-restore replay. */
export function loadTexture2D(
    ctx: WebGLContext,
    url: string,
    options?: GLTextureOptions,
    onLoad?: (tex: GLTexture) => void,
    onError?: (err: Error) => void
): GLTexture;

/** Cached: skips `gl.activeTexture` and/or `gl.bindTexture` when nothing changes.
 *  No-op when `tex._disposed` or `ctx._isLost`. */
export function bindTexture(ctx: WebGLContext, unit: number, tex: GLTexture | null): void;

/** Sets `tex._disposed=true`, calls `gl.deleteTexture(tex.handle)`, walks
 *  `_state.boundTextures` and clears every unit that still references the
 *  handle (so a later `bindTexture(..., otherTex)` to the same unit is NOT
 *  incorrectly elided). Removes the texture from `ctx._textures`. */
export function disposeTexture(ctx: WebGLContext, tex: GLTexture): void;
```

#### 3.4.1 Sub-entry: HTML element textures (`/html-texture`)

Dynamic-importable so only InputGlow pulls it in:

```ts
export interface GLHtmlElementTextureOptions extends GLTextureOptions {
    /** Default: false. */
    samplingMode?: GLenum;
}

export function createHtmlElementTexture(
    ctx: WebGLContext,
    element: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
    options?: GLHtmlElementTextureOptions
): GLTexture;

/** Re-uploads from the source element. Skips if the element bounds haven't changed
 *  AND the caller didn't pass `force: true`. */
export function updateHtmlElementTexture(ctx: WebGLContext, tex: GLTexture, force?: boolean): void;
```

### 3.5 Effect renderer (fullscreen quad)

```ts
export interface GLEffectWrapperOptions {
    name: string;
    effect: GLEffect;
}

export interface GLEffectWrapper {
    readonly name: string;
    readonly effect: GLEffect;
}

export function createEffectWrapper(opts: GLEffectWrapperOptions): GLEffectWrapper;
export function disposeEffectWrapper(ctx: WebGLContext, wrapper: GLEffectWrapper): void;

export interface GLViewport { x: number; y: number; w: number; h: number; }

/** Defaults to the full canvas in pixel coordinates. */
export function setViewport(ctx: WebGLContext, viewport?: GLViewport): void;

/** Calls `useEffect(ctx, wrapper.effect)`, ensures the shared quad VAO exists
 *  (lazy-init via `ensureQuad`), binds it.
 *
 *  This MUST be called BEFORE any `setEffectFloat*` / `setEffectTexture` call
 *  for this effect in the current frame — WebGL `gl.uniform*` writes target the
 *  currently-bound program, and the setters intentionally do NOT call
 *  `useEffect` themselves (keeping the hot path a single equality check).
 *
 *  No depth/stencil state changes: NeonBrush effects never enable them, and
 *  `createWebGLContext` requested `depth: false, stencil: false`. If a future
 *  consumer needs depth, add a separate `setDepthTest(ctx, on)` cached export. */
export function applyEffectWrapper(ctx: WebGLContext, wrapper: GLEffectWrapper): void;

/** `gl.drawElements(TRIANGLES, 6, UNSIGNED_SHORT, 0)`. No-op when `ctx._isLost`
 *  or when the bound effect is not ready. */
export function drawEffect(ctx: WebGLContext): void;
```

### 3.6 Index export

```ts
// src/index.ts
export * from "./webgl-context.js";
export * from "./render-loop.js";
export * from "./webgl-effect.js";
export * from "./webgl-texture.js";
export * from "./webgl-effect-renderer.js";
// html-texture is NOT re-exported from the index — consumers import it from a
// sub-entry so it stays out of bundles that don't need it.
```

---

## 4. Internal architecture — the cache layer

### 4.1 `GLState` type (owned by `WebGLContext._state`)

```ts
interface GLState {
    currentProgram: WebGLProgram | null;
    activeTextureUnit: number;                       // last gl.activeTexture(...)
    boundTextures: (WebGLTexture | null)[];          // per-unit, length = caps.maxTextureUnits
    boundArrayBuffer: WebGLBuffer | null;
    boundElementBuffer: WebGLBuffer | null;
    boundVao: WebGLVertexArrayObject | null;
    viewportX: number; viewportY: number; viewportW: number; viewportH: number;
    /** Lazy fullscreen quad — built on first applyEffectWrapper, then reused
     *  for the lifetime of the context. Lives here (not in a module-scoped
     *  WeakMap) to satisfy the zero-side-effects rule. Cleared (set to null)
     *  on context-lost and rebuilt on next `applyEffectWrapper`. */
    quadVbo: WebGLBuffer | null;
    quadIbo: WebGLBuffer | null;
    quadVao: WebGLVertexArrayObject | null;
}
```

### 4.1.1 GL-state cache invalidation rules

The cache is the source of truth for **what is currently bound**. It must be
kept in sync with actual GL state. Two protocols enforce that:

- **Disposal:** `disposeTexture` walks `_state.boundTextures` and nulls any unit
  that held the disposed handle; `disposeEffect` clears `_state.currentProgram`
  iff it pointed at the disposed program. This prevents the next-bind to the
  same slot from being elided as a no-op.
- **Context lost:** the `webglcontextlost` handler sets `_isLost=true` and
  clears the entire `_state` (program=null, boundTextures filled with null,
  buffers=null, vao=null, quad* = null, viewport=0). Setters become no-ops
  while `_isLost`. See §4.7.

### 4.2 Cache contract — which GL calls are elided

| Operation                                | Cache key                              | Elided when                                       |
|------------------------------------------|----------------------------------------|---------------------------------------------------|
| `gl.useProgram`                          | `_state.currentProgram`                | Same program already current                      |
| `gl.activeTexture`                       | `_state.activeTextureUnit`             | Already on that unit                              |
| `gl.bindTexture`                         | `_state.boundTextures[unit]`           | Same texture already on that unit                 |
| `gl.uniform1i(samplerLoc, unit)`         | Done **once at link time**             | Always — never re-issued per frame                |
| `gl.uniform1f / 2f / 3f / 4f`            | `effect._lastF1[name]` / `_lastVec`    | Value bit-equal to last                           |
| `gl.uniform1i` (non-sampler)             | `effect._lastI1[name]`                 | Value equal to last                               |
| `gl.bindBuffer(ARRAY_BUFFER, …)`         | `_state.boundArrayBuffer`              | Same buffer                                       |
| `gl.bindBuffer(ELEMENT_ARRAY_BUFFER, …)` | `_state.boundElementBuffer`            | Same buffer                                       |
| `gl.bindVertexArray`                     | `_state.boundVao`                      | Same VAO (the shared quad VAO lives forever)      |
| `gl.viewport`                            | `_state.viewportX/Y/W/H`               | All four match                                    |

For the typical NeonBrush per-frame pattern (one effect, ~5 uniforms, 1–2 textures), after the first frame every steady-state frame issues exactly:

```
gl.uniform*  (only for uniforms whose values actually changed)
gl.drawElements(TRIANGLES, 6, UNSIGNED_SHORT, 0)
```

— and nothing else. Program, VAO, sampler-uniforms, texture units, viewport are all already correct.

### 4.3 Branchless setter shape

The cache stores the **last-uploaded value**, NOT the last-requested value.
A setter that skips the GL call (effect not ready, context lost, missing
location) MUST NOT update the cache — otherwise a later "real" set with the
same value would incorrectly elide and the GPU would keep stale data.

```ts
export function setEffectFloat(ctx: WebGLContext, effect: GLEffect, name: string, x: number): void {
    if (ctx._isLost || !effect.isReady) return;        // skip; do not touch cache
    const loc = effect.uniformLocations[name];
    if (loc === null) return;                           // unknown uniform; do not touch cache
    if (effect._lastF1[name] === x) return;             // hot path — value already on GPU
    effect._lastF1[name] = x;
    ctx.gl.uniform1f(loc, x);
}

export function setEffectFloat2(ctx: WebGLContext, effect: GLEffect, name: string, x: number, y: number): void {
    if (ctx._isLost || !effect.isReady) return;
    const loc = effect.uniformLocations[name];
    if (loc === null) return;
    let v = effect._lastVec[name];
    if (v !== undefined && v[0] === x && v[1] === y) return;
    if (v === undefined) { v = [0, 0]; effect._lastVec[name] = v; }
    v[0] = x; v[1] = y;
    ctx.gl.uniform2f(loc, x, y);
}
```

The vec cache is a plain `number[]` (not `Float32Array`) so values like `0.1`
compare equal across frames — `Float32Array` would truncate to
`0.10000000149011612` and break the equality check forever.

The cache slot allocation (`v = [0, 0]`) happens **at most once per
(effect × uniform) pair**, on first successful upload. Steady state is
allocation-free.

`NaN` inputs: `NaN !== NaN` so the cache check fails every frame and the
GL upload re-issues every frame. This is acceptable — NaN inputs are a
caller bug, and re-uploading is the safe fallback.

### 4.3.1 Ordering invariant

Uniform setters require `_state.currentProgram === effect.program`. The
canonical per-frame sequence is:

```
setViewport(ctx);                       // cached
applyEffectWrapper(ctx, wrapper);       // useEffect + ensureQuad
setEffectFloat(ctx, effect, ...);       // ← AFTER applyEffectWrapper
setEffectTexture(ctx, effect, ...);
drawEffect(ctx);
```

This matches Babylon's `EffectRenderer` pattern (`applyEffectWrapper` then
`setFloat`/`setTexture` then `draw`). The setters deliberately do NOT call
`useEffect` themselves to keep the hot path a single equality check; if a
caller skips `applyEffectWrapper`, uniforms target the previously bound
program (or none), which is a caller bug.

### 4.4 Sampler-unit assignment

Sampler→unit mapping is fixed for the lifetime of a linked program (re-run
after context restore). It happens during **readiness finalization** (§4.6),
not at `createEffect` time, because with `KHR_parallel_shader_compile` the
program may not yet be linked when `createEffect` returns.

```ts
// Runs once when isEffectReady() observes COMPLETION_STATUS_KHR === true.
function finalizeEffect(ctx: WebGLContext, effect: GLEffect): void {
    const gl = ctx.gl;
    // 1. Check link status; on failure record _compileError and stop.
    // 2. Resolve uniform locations from options.uniformNames.
    // 3. Resolve attribute locations from options.attributeNames.
    // 4. useEffect(ctx, effect)  — updates _state.currentProgram (cached).
    useEffect(ctx, effect);
    // 5. Assign each declared sampler a fixed texture unit and tell the shader once.
    let unit = 0;
    for (const name of effect.options.samplerNames) {
        const loc = gl.getUniformLocation(effect.program, name);
        if (loc !== null) {
            gl.uniform1i(loc, unit);          // ONE-TIME per program lifetime
        }
        effect.samplerUnits[name] = unit;
        unit++;
    }
    effect._samplersAssigned = true;
    effect.isReady = true;
    // 6. Fire _onCompiled callbacks once, then clear the list.
}
```

Then `setEffectTexture(ctx, effect, name, tex)` is:

```ts
const unit = effect.samplerUnits[samplerName];        // O(1) lookup
bindTexture(ctx, unit, tex);                           // cached: maybe-activeTexture + maybe-bindTexture
// NO gl.uniform1i — it's already set for the lifetime of the program.
```

This is the key win over Babylon's `Effect.setTexture` which re-issues
`gl.uniform1i` on every call.

Sampler uniforms ARE program state, so they survive `useProgram` swaps and
texture binds. They are invalidated only by program relink — which only
happens on context restore, where `_samplersAssigned` is reset to false and
finalization re-runs.

The `useEffect` call inside `finalizeEffect` uses the cached helper, so
`_state.currentProgram` stays consistent — no raw `gl.useProgram` is ever
issued outside of `useEffect`.

### 4.5 Lazy quad init

```ts
function ensureQuad(ctx: WebGLContext): void {
    const s = ctx._state;
    if (s.quadVao !== null) return;
    const gl = ctx.gl;
    s.quadVao = gl.createVertexArray();
    gl.bindVertexArray(s.quadVao); s.boundVao = s.quadVao;

    s.quadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, s.quadVbo); s.boundArrayBuffer = s.quadVbo;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 1, -1, 1, -1, -1, 1, -1]), gl.STATIC_DRAW);

    s.quadIbo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.quadIbo); s.boundElementBuffer = s.quadIbo;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    // Enable attribute 0 (position) on this VAO. The location is GUARANTEED to
    // be 0 because every effect calls `gl.bindAttribLocation(program, 0,
    // attributeNames[0])` BEFORE link (and the GLSL conversion emits
    // `layout(location = 0)` as belt-and-suspenders). One VAO, every effect.
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}
```

The geometry matches Babylon's `EffectRenderer` default (positions
`[1,1,-1,1,-1,-1,1,-1]`, indices `[0,1,2,0,2,3]`).

`applyEffectWrapper` calls `ensureQuad(ctx)` then `useEffect(ctx, wrapper.effect)`.
Once the quad VAO is built and bound, attribute state is baked into the VAO;
subsequent frames touch zero buffer/attrib GL calls — only `useProgram` (cached),
the user's `setEffect*` calls, and `drawElements`.

On context lost, `s.quadVao` (and friends) are cleared to `null`, so the
next `applyEffectWrapper` after restore transparently rebuilds the quad.

#### Why bind to location 0 explicitly

WebGL2 assigns attribute locations at link time unless the GLSL declares
`layout(location = N)` or the program calls `gl.bindAttribLocation(prog, N,
name)` BEFORE link. Without one of those, two different programs may put
`position` at different locations, breaking the shared VAO. We do BOTH:

1. `createEffect` calls `gl.bindAttribLocation(program, 0, options.attributeNames?.[0] ?? "position")` between `attachShader` and `linkProgram`.
2. The GLSL conversion (§6) emits `layout(location = 0) in vec2 position;`.

Either alone is sufficient; together they're robust against converter mistakes
and ensure the shared quad VAO is always correct.

### 4.6 Readiness finalization (parallel-compile-safe)

`createEffect` compiles shaders, calls `attachShader` × 2,
`bindAttribLocation(program, 0, attributeNames[0])`, then `linkProgram`.
It does NOT block on link completion — `isReady` starts as `false`,
`_samplersAssigned` as `false`, `uniformLocations` and `samplerUnits` empty.

`isEffectReady(ctx, effect)` is the polling gate:

```
if (effect.isReady) return true;
if (effect._compileError !== null) return false;

linked = (caps.parallelShaderCompile !== null)
    ? gl.getProgramParameter(program, caps.parallelShaderCompile.COMPLETION_STATUS_KHR)
    : true                                  // synchronous link without the extension
if (!linked) return false;

if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    effect._compileError = gl.getProgramInfoLog(program) ?? "link failed";
    return false;
}

finalizeEffect(ctx, effect);                // §4.4
return true;                                 // effect.isReady is now true
```

`executeWhenCompiled(ctx, effect, cb)`:

```
if (isEffectReady(ctx, effect)) { cb(effect); return; }
effect._onCompiled.push(cb);
```

(NeonBrush calls `isEffectReady` every frame via `if (!isReady()) return;` in
the render loop. That same poll drives finalization — there is no separate
"tick" the host must call.)

`_onCompiled[]` is fired and cleared during finalization. Listeners added
*after* readiness fire synchronously from `executeWhenCompiled` itself.

### 4.7 Context lost / restored protocol

The package owns this end-to-end because NeonBrush relies on Babylon's
silent rebuild behaviour today.

#### `webglcontextlost` handler

1. `event.preventDefault()` — opt in to restore.
2. `ctx._isLost = true`.
3. Zero the entire `_state`: `currentProgram=null`, `boundTextures.fill(null)`,
   `boundArrayBuffer/ElementBuffer/Vao=null`, `quadVbo/Ibo/Vao=null`,
   `viewport*=0`, `activeTextureUnit=0`.
4. For each `effect` in `ctx._effects`: `effect.isReady=false`,
   `effect._samplersAssigned=false`, `effect.uniformLocations={}`,
   `effect.attributeLocations={}`, clear `_lastF1`/`_lastVec`/`_lastI1`.
   Old GL handles are already dead per spec; do NOT call `deleteProgram`.
5. For each `tex` in `ctx._textures`: `tex.isReady=false`. Old `tex.handle`
   is dead.
6. Stop the render loop (`cancelAnimationFrame(_rafId)`).
7. Fire every callback in `ctx._onLost`.

While `_isLost`, every public function checks the flag and returns early.
The application's `onContextLost` callback may e.g. hide the canvas.

#### `webglcontextrestored` handler

1. For each `effect` in `ctx._effects`: re-compile vs/fs from
   `effect.options.vertexSource/fragmentSource/defines`, re-attach,
   re-`bindAttribLocation`, re-link, assign new `effect.program`. Leave
   `isReady=false` so the next-frame `isEffectReady` poll runs finalization
   (§4.6) which re-resolves locations and re-assigns sampler units.
2. For each `tex` in `ctx._textures`: allocate a fresh `WebGLTexture`,
   assign to `tex.handle`, call `tex._upload(ctx)` to replay the original
   upload (raw bytes for `createRawTexture`; retained `ImageBitmap` for
   `loadTexture2D`; source HTML element for `createHtmlElementTexture`).
   Set `tex.isReady=true` once the replay completes.
3. `ctx._isLost = false`.
4. Restart the render loop if it was active before loss.
5. Fire every callback in `ctx._onRestored`.

#### Correctness notes

- The same `GLEffect` and `GLTexture` objects are reused; only their internal
  GL handles change. Consumer code holds these handles by reference, so
  rendering resumes transparently after restore.
- Uniform caches are cleared on loss → the first frame after restore re-uploads
  every uniform. That's correct, because the new program object has no uniform
  state.
- Sampler `uniform1i` is re-assigned during the next finalization pass — see §4.4.
- `_upload` for `loadTexture2D` MUST NOT re-fetch the URL: the package retains
  the decoded `ImageBitmap` exactly so restore is offline-safe. (If the
  `ImageBitmap` was already disposed by the caller via `bitmap.close()`, the
  restore falls back to placeholder pixels and re-fetches in the background.)
- This adds ≈ 150 LOC and ≈ 1–2 KB to the bundle, accepted by user §0 decision.

---

## 5. Tree-shaking & packaging

`package.json` (mirrors the `babylon-lite` package shape, with a dual-entry):

```json
{
    "name": "@babylon-lite/thin-gl",
    "version": "0.1.0",
    "type": "module",
    "main": "./src/index.ts",
    "types": "./src/index.ts",
    "sideEffects": false,
    "exports": {
        ".":              { "import": "./src/index.ts",            "types": "./src/index.ts" },
        "./html-texture": { "import": "./src/webgl-html-texture.ts", "types": "./src/webgl-html-texture.ts" }
    },
    "publishConfig": {
        "main": "./dist/index.js",
        "types": "./dist/index.d.ts",
        "exports": {
            ".":              { "import": "./dist/index.js",            "types": "./dist/index.d.ts" },
            "./html-texture": { "import": "./dist/webgl-html-texture.js", "types": "./dist/webgl-html-texture.d.ts" }
        }
    },
    "files": ["dist"],
    "scripts": {
        "build": "vite build",
        "build:prod": "vite build --mode prod"
    },
    "devDependencies": {
        "typescript": "^5.7.0",
        "vite": "^6.0.0",
        "vite-plugin-dts": "^4.5.4"
    }
}
```

Tree-shaking guarantees:

- A consumer that uses only `createWebGLContext`, `createEffect`,
  `setEffectFloat`, `setEffectFloat2`, `setEffectTexture`, `createRawTexture`,
  `loadTexture2D`, `setViewport`, `applyEffectWrapper`, `drawEffect`,
  `createEffectWrapper`, `runRenderLoop` ships those plus their internal
  helpers (cache update, ensureQuad, finalize, loss-restore protocol).
- `setEffectColor4`, `setEffectInt`, `executeWhenCompiled`,
  `setHardwareScalingLevel`, etc. tree-shake out when unused.
- `html-texture` is a separate entry — InputGlow imports
  `from "@babylon-lite/thin-gl/html-texture"`; other consumers don't pull it in.
- No file in `src/` performs work at import time. Top-level constants are limited
  to typed-array literals (the quad geometry) which bundlers treat as pure.
- The loss/restore registries (`_effects`, `_textures`) ARE retained whenever
  `createEffect` or `createRawTexture` is referenced, because the constructors
  push into them. This is unavoidable: it's the cost of context restore. Total
  fixed cost ≈ 1–2 KB.

**Acceptance:** NeonBrush downstream measures its own bundle after migration
and confirms the per-page delta. The 10–12 KB min+gzip estimate in §0 is a
hypothesis; a real measurement is required before declaring v1 success.

---

## 6. Shader convention — GLSL ES 3.00 only

Consumers ship preconverted GLSL ES 3.00 shaders. The runtime does **zero**
preprocessing (no `attribute→in` regex, no `#include` resolution). The only
runtime injection is the optional `defines` string from `GLEffectOptions`,
inserted exactly once between the version declaration and the user shader body.

### 6.1 Required output shape

Every shader the package accepts MUST follow this template:

```glsl
#version 300 es                           // MUST be line 1
precision highp float;                    // (vertex) — or precision mediump for fragment if intentional
precision highp int;
// ← package inserts options.defines here verbatim, if provided
// ← user shader body starts here
```

The fragment shader MUST declare exactly one color output named `glFragColor`:

```glsl
#version 300 es
precision highp float;
out vec4 glFragColor;
// user body here; every former `gl_FragColor = …;` is now `glFragColor = …;`
```

### 6.2 Build-time conversion rules (recommended for NeonBrush)

NeonBrush's existing `tools/buildShaders.mjs` is extended with the following
verbatim rewrites applied IN ORDER to each `*.glsl` source. Conditional
preprocessor blocks (`#ifdef LANDSCAPE`, etc.) are preserved unchanged.

| # | Rule (regex)                                            | Replacement                                                                                              |
|---|---------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| 1 | (vertex only) `^attribute\s+(\w[\w ]*)\s+(\w+)\s*;`     | `layout(location = <0|1|2|…in order of declaration>) in $1 $2;`                                          |
| 2 | (vertex) `^varying\s+(\w+)\s+(\w+)\s*;`                 | `out $1 $2;`                                                                                             |
| 3 | (fragment) `^varying\s+(\w+)\s+(\w+)\s*;`               | `in $1 $2;`                                                                                              |
| 4 | (both) `\btexture2D\s*\(`                               | `texture(`                                                                                               |
| 5 | (both) `\btextureCube\s*\(`                             | `texture(`                                                                                               |
| 6 | (fragment) every `\bgl_FragColor\b`                     | `glFragColor`. Plus inject `out vec4 glFragColor;` exactly once after the precision qualifier.           |
| 7 | (fragment) every `\bgl_FragData\s*\[\s*N\s*\]`          | UNSUPPORTED — converter throws. (MRT is explicitly out of scope.)                                        |
| 8 | (both) prepend `#version 300 es\n` + appropriate `precision` declarations if not already present. |                                                                                                          |

After conversion, NeonBrush's build emits `*.glsl.ts` modules whose default
export is the converted source string. The runtime concatenates
`source = converted.slice(0, defines_insertion_point) + (options.defines ?? "") + converted.slice(defines_insertion_point)`.
For simplicity, the converter MAY emit a marker comment `// __DEFINES__` and
the runtime splits on that — keeps the runtime regex-free.

### 6.3 What we don't support

- `#include` directives (NeonBrush doesn't use them).
- MRT (`gl_FragData[N]`, multiple `out` colors).
- WebGL1 conditional paths (`#ifdef WEBGL2` blocks).
- Implicit precision for `int` / `bool` — converter inserts `precision highp int;`
  alongside the float precision when missing.
- Shader includes / shader-store lookup.

---

## 7. State machine / lifecycle

```
[create]   createWebGLContext(canvas, opts)
              acquires WebGL2 context, builds caps, allocates GLState,
              registers webglcontextlost / webglcontextrestored handlers.
   ↓
[idle]     no rAF active.
   ↓
runRenderLoop(ctx, fn)
   ↓
[running]  rAF → resizeWebGLContext(ctx) → for each _loops: fn(dt)
   ↓
stopRenderLoop(ctx[, fn])
   ↓
[idle]
   ↓
disposeWebGLContext(ctx)
   ↓
[disposed] all subsequent calls are no-ops. WebGLTexture/Buffer/Program
            handles released; canvas left intact.
```

Effect lifecycle:

```
[created]      createEffect: shaders compiled, program linked (parallel if available).
[compiling]    isEffectReady=false. setEffectXxx is legal and updates the value
                cache but skips the gl.uniform* call (loc lookup returns null).
[ready]        isEffectReady=true. _onCompiled fires once. useEffect works.
[disposed]     disposeEffect — gl.deleteProgram / deleteShader.
```

Texture lifecycle: `createRawTexture` / `loadTexture2D` returns immediately; for `loadTexture2D` `isReady` flips true after Image decode + first `gl.texImage2D` call.

---

## 8. Babylon.js equivalence map

| Babylon.js (used by NeonBrush)                                  | thin-gl                                                                                     |
|-----------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| `new ThinEngine(canvas, antialias, opts)`                       | `createWebGLContext(canvas, opts)`                                                          |
| `engine.dispose()`                                              | `disposeWebGLContext(ctx)`                                                                  |
| `engine.resize()`                                               | `resizeWebGLContext(ctx)`                                                                   |
| `engine.getRenderWidth/Height()`                                | `getRenderWidth/Height(ctx)`                                                                |
| `engine.getHardwareScalingLevel()` / `setHardwareScalingLevel`  | `getHardwareScalingLevel(ctx)` / `setHardwareScalingLevel(ctx, lv)`                         |
| `engine.getRenderingCanvas()`                                   | `getRenderingCanvas(ctx)`                                                                   |
| `engine.runRenderLoop(fn)` / `stopRenderLoop([fn])`             | `runRenderLoop(ctx, fn)` / `stopRenderLoop(ctx[, fn])`                                      |
| `engine.onContextLostObservable.add(cb)`                        | `onWebGLContextLost(ctx, cb)`                                                               |
| `engine.onContextRestoredObservable.add(cb)`                    | `onWebGLContextRestored(ctx, cb)`                                                           |
| `engine.createRawTexture(data, w, h, format, mip, invY, samp)`  | `createRawTexture(ctx, data, w, h, format, type, opts)`                                     |
| `engine.createTexture(url, noMip, invY, …)`                     | `loadTexture2D(ctx, url, opts, onLoad?, onError?)`                                          |
| `new EffectWrapper({ engine, vertexShader, fragmentShader, … })`| `createEffect(ctx, opts)` + `createEffectWrapper({ name, effect })`                         |
| `effect.executeWhenCompiled(cb)`                                | `executeWhenCompiled(ctx, effect, cb)`                                                      |
| `effect.isReady()`                                              | `isEffectReady(ctx, effect)`                                                                |
| `effect.setFloat/2/3/4/Color3(name, …)`                         | `setEffectFloat/2/3/4(ctx, effect, name, …)` / `setEffectColor3(ctx, effect, name, c)`      |
| `effect.setTexture(name, thinTexture)`                          | `setEffectTexture(ctx, effect, name, glTexture)`                                            |
| `new EffectRenderer(engine)`                                    | (no equivalent — quad is a context-owned lazy resource)                                     |
| `effectRenderer.setViewport()`                                  | `setViewport(ctx)`                                                                          |
| `effectRenderer.applyEffectWrapper(wrapper)`                    | `applyEffectWrapper(ctx, wrapper)`                                                          |
| `effectRenderer.draw()`                                         | `drawEffect(ctx)`                                                                           |
| `new ThinTexture(internalTexture)`                              | (no wrapper — `GLTexture` is the public type, no two-layer split)                           |
| `new HtmlElementTexture(name, el, opts)`                        | `createHtmlElementTexture(ctx, el, opts)`  *(sub-entry import)*                             |

Not implemented (NeonBrush doesn't need them): `Effect.setMatrix`, `Effect.setMatrices`, `Effect.setArray*`, `Effect.setIntArray`, shader-store / `useShaderStore: true`, `#include` resolution, dynamic vertex buffers, GLSL ES 1.00 path, RTT/framebuffer APIs, depth/stencil/blend state setters, observable infrastructure.

---

## 9. Dependencies

- **External (npm):** none. The package depends only on the browser's WebGL2 + DOM types (`@types/web` via `lib: ["DOM", "ESNext"]`).
- **Workspace:** none. The package does not import from `babylon-lite`.
- **Peer (downstream):** `@babylon-lite/thin-gl` becomes a dependency of NeonBrush. NeonBrush's `@babylonjs/core` peer can be dropped once the magic loading screen is also ported (v2).

---

## 10. Out of scope / explicit limitations

1. No WebGL1 fallback.
2. No RTT. (Add `webgl-render-target.ts` later if a consumer needs offscreen passes — design slot reserved.)
3. No `SpriteRenderer` / `ThinSprite`. The magic loading screen keeps stock Babylon for now.
4. No shader-store, no `#include`, no runtime preprocessor beyond `options.defines` injection.
5. No observable / event emitter abstraction. Context-lost/restored use plain `cb[]`.
6. No `Effect.setMatrix*` / `setArray*` / `setInt*Array` — add them if a future consumer requires them, each as its own `export function` (tree-shakable).
7. No depth/stencil/blend state setters. NeonBrush effects never touch these. If they ever need to, add `setBlendMode(ctx, mode)` etc., each as its own cached export.
8. No texture compression, no KTX, no DDS, no Basis.
9. No anisotropic filtering knobs (NeonBrush doesn't use them).
10. No MRT — `gl_FragData[N]` is a converter error (§6.3).
11. No matrix uniforms (`gl.uniformMatrix4fv`). NeonBrush effects never use them; add `setEffectMatrix(ctx, effect, name, m)` when a future consumer needs it.

---

## 11. NeonBrush migration guide (mechanical)

### 11.1 `engine/thinEngineFactory.ts`

```ts
// Before
import { ThinEngine } from "@babylonjs/core/Engines/thinEngine";
export function createThinEngine(canvas, antialias=false) {
    return new ThinEngine(canvas, antialias, { antialias, premultipliedAlpha: true, alpha: true, depth: false, stencil: false, preserveDrawingBuffer: false });
}

// After
import { createWebGLContext, type WebGLContext } from "@babylon-lite/thin-gl";
export function createNeonContext(canvas: HTMLCanvasElement, antialias = false): WebGLContext {
    return createWebGLContext(canvas, { antialias, premultipliedAlpha: true, alpha: true, depth: false, stencil: false, preserveDrawingBuffer: false });
}
```

### 11.2 `engine/baseEffect.ts` — class → pure state + free functions

```ts
import { createWebGLContext, disposeWebGLContext, resizeWebGLContext, runRenderLoop, stopRenderLoop, getRenderingCanvas, type WebGLContext } from "@babylon-lite/thin-gl";

export interface BaseEffectState {
    ctx: WebGLContext;
    canvas: HTMLCanvasElement | null;
    ownsContext: boolean;
}

export function createBaseEffectState(canvasOrCtx: HTMLCanvasElement | WebGLContext): BaseEffectState {
    if ("gl" in canvasOrCtx) {
        return { ctx: canvasOrCtx, canvas: getRenderingCanvas(canvasOrCtx), ownsContext: false };
    }
    return { ctx: createWebGLContext(canvasOrCtx, { /* defaults */ }), canvas: canvasOrCtx, ownsContext: true };
}

export function startBaseEffect(state: BaseEffectState, render: () => void, onError: (e: unknown) => void): void {
    runRenderLoop(state.ctx, () => { try { render(); } catch (e) { onError(e); stopBaseEffect(state); } });
}
export function stopBaseEffect(state: BaseEffectState): void { stopRenderLoop(state.ctx); }
export function resizeBaseEffect(state: BaseEffectState): void { resizeWebGLContext(state.ctx); }
export function disposeBaseEffect(state: BaseEffectState, onDispose: () => void): void {
    stopBaseEffect(state); onDispose();
    if (state.ownsContext) { disposeWebGLContext(state.ctx); }
}
```

### 11.3 Per-effect rewrite (`ScanEffect` shown; others identical)

```ts
// Before
this._effectWrapper = new EffectWrapper({ engine: this.engine, useShaderStore: false, vertexShader: scanVertex, fragmentShader: scanFragment, samplerNames: [...], uniformNames: [...] });
// inside render():
effectRenderer.setViewport();
effectRenderer.applyEffectWrapper(this._effectWrapper);
effect.setFloat("u_Progress", this.progress);
effect.setTexture("overlaySampler", this._overlayTexture);
effectRenderer.draw();

// After (state + free functions). NOTE THE ORDER: applyEffectWrapper FIRST,
// then setters — uniforms target the currently-bound program (§4.3.1).
this._effect = createEffect(ctx, {
    name: "scanEffect",
    vertexSource: scanVertexGLSL3,         // pre-converted GLSL ES 3.00, see §6
    fragmentSource: scanFragmentGLSL3,
    uniformNames: ["u_Progress", "u_Resolution", "u_backgroundSet"],
    samplerNames: ["overlaySampler", "backgroundSampler"],   // unit 0 + unit 1
    // optional: defines: "#define USE_RAMP 1\n",
});
this._wrapper = createEffectWrapper({ name: "scanEffect", effect: this._effect });
…
// inside render():
setViewport(ctx);                                      // cached
applyEffectWrapper(ctx, this._wrapper);                // useProgram (cached) + ensureQuad
setEffectFloat(ctx, this._effect, "u_Progress", this.progress);
setEffectFloat2(ctx, this._effect, "u_Resolution", rx, ry);
setEffectTexture(ctx, this._effect, "overlaySampler", this._overlayTex);
setEffectTexture(ctx, this._effect, "backgroundSampler", this._backgroundTex);
drawEffect(ctx);                                       // gl.drawElements
```

All ten effect files migrate the same way. No GL behaviour changes; uniform-cache behaviour either matches Babylon (per-uniform last-value check) or improves on it (sampler-uniform set once, not every frame).

### 11.4 Babylon → GL constants mapping (for `createRawTexture` migration)

NeonBrush's current calls use Babylon `Constants.*` integer values. The new API
takes WebGL2 constants directly. The build step or a small inline adapter maps:

| Babylon Constants                              | Value | WebGL2 constant       |
|------------------------------------------------|------:|-----------------------|
| `TEXTUREFORMAT_RGBA`                           |   `5` | `gl.RGBA`             |
| `TEXTUREFORMAT_RGB`                            |   `4` | `gl.RGB`              |
| `TEXTUREFORMAT_LUMINANCE`                      |   `1` | `gl.LUMINANCE`        |
| `TEXTURETYPE_UNSIGNED_BYTE`                    |   `0` | `gl.UNSIGNED_BYTE`    |
| `TEXTURETYPE_FLOAT`                            |   `1` | `gl.FLOAT`            |
| `TEXTURETYPE_HALF_FLOAT`                       |   `2` | `gl.HALF_FLOAT`       |
| `TEXTURE_NEAREST_SAMPLINGMODE`                 |   `1` | `minFilter/magFilter = gl.NEAREST`         |
| `TEXTURE_BILINEAR_SAMPLINGMODE`                |   `2` | `gl.LINEAR` (mip `gl.NEAREST`)             |
| `TEXTURE_TRILINEAR_SAMPLINGMODE`               |   `3` | `gl.LINEAR_MIPMAP_LINEAR`                  |

Example:

```ts
// Before
this.engine.createRawTexture(new Uint8Array(4), 1, 1, 5, false, false, 1, null, 0);
// After
createRawTexture(ctx, new Uint8Array(4), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE,
    { generateMipMaps: false, invertY: false, minFilter: gl.NEAREST, magFilter: gl.NEAREST });
```

---

## 12. Test specification

This package is exercised in two ways. Detailed bundle-size accounting is owned by NeonBrush, not by the Lite parity harness, because thin-gl is a sibling package.

### 12.1 Unit tests (vitest, in-package)

| Test                                                       | Description                                                                                          |
|------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| `createWebGLContext rejects non-WebGL2`                    | Mocked canvas returning null → throws clearly.                                                       |
| `setEffectFloat elides repeat calls`                       | Spy on `gl.uniform1f`. Two identical calls = one GL call.                                            |
| `setEffectFloat with NaN re-uploads every call`            | NaN !== NaN — cache fails closed, safe behaviour.                                                    |
| `setEffectFloat2 cache uses plain number[]`                | Set (0.1, 0.2) twice → one `gl.uniform2f` call (Float32Array truncation regression guard).           |
| `setEffectTexture skips activeTexture / bind`              | Bind tex A unit 0, bind A again → zero extra GL calls.                                               |
| `setEffectTexture switches unit when needed`               | Bind A unit 0, then B unit 0 → one `bindTexture`, no `activeTexture` reassignment.                   |
| `setEffectTexture skips uniform1i after first frame`       | After finalization, repeated `setEffectTexture` produces zero `uniform1i` calls.                     |
| `setViewport elides no-op`                                 | Same rect → zero `gl.viewport` calls.                                                                |
| `applyEffectWrapper builds quad once`                      | First call creates VAO; second call doesn't touch `createVertexArray`.                               |
| `applyEffectWrapper before setters is required`            | Calling setters with a different effect bound writes to the wrong program (regression guard).        |
| `executeWhenCompiled fires once on success`                | Mock parallel-shader-compile to flip ready on frame 3; callback fires exactly once.                  |
| `setEffectFloat before isReady does NOT poison the cache`  | setEffectFloat("u",1) → not-ready, skipped; flip ready; setEffectFloat("u",1) → uploads exactly 1.   |
| `sampler uniforms assigned exactly once at finalization`   | Spy on `uniform1i` between createEffect and frame 100 → exactly one call per sampler.                |
| `loadTexture2D placeholder is sampleable`                  | Returned texture has `isReady=false` but binding it doesn't error.                                   |
| `loadTexture2D reuses the same handle for image upload`    | `tex.handle` value pre- and post-load is identical (cached bindings stay valid).                     |
| `disposeTexture invalidates _state.boundTextures`          | Bind A unit 0; disposeTexture(A); bind B unit 0 → `gl.bindTexture` IS called (not elided).          |
| `disposeWebGLContext makes later calls no-ops`             | After dispose, `setEffectFloat` etc. return without throwing.                                        |
| `context lost: setters become no-ops`                      | Simulate webglcontextlost → `setEffectFloat` skips upload AND skips cache write.                     |
| `context restored: quad VAO rebuilt`                       | Simulate lost+restored → next `applyEffectWrapper` creates a fresh VAO.                              |
| `context restored: programs re-linked, samplers re-bound`  | Simulate restore → effects re-linked, sampler `uniform1i` re-issued exactly once per sampler.        |
| `context restored: raw texture upload replayed`            | Simulate restore → `_upload(ctx)` called, texture handle replaced, isReady=true.                     |
| `context restored: loadTexture2D replays from ImageBitmap` | No re-fetch of the URL; the retained `ImageBitmap` is re-uploaded.                                   |
| `runRenderLoop dedupes identical callbacks`                | Registering the same fn twice → fired once per frame (matches `AbstractEngine`).                     |
| `stopRenderLoop() removes all loops`                       | After no-arg stop, no callbacks fire.                                                                |

### 12.2 Visual parity (one Lite-harness scene)

A single Babylon-Lite parity scene — `sceneN-thin-gl-fullscreen` — renders the same fullscreen-procedural shader through (a) stock Babylon ThinEngine/EffectRenderer and (b) the thin-gl package, into two canvases. The parity harness diffs them with MAD ≤ 0.5/255. This proves that thin-gl produces byte-identical pixels for the NeonBrush-shaped workload.

(The scene is the ONLY way thin-gl appears in the Lite harness — the package itself is not part of the WebGPU bundle-size ceilings.)

### 12.3 NeonBrush downstream tests

NeonBrush's existing Jest + Playwright suites are the ultimate validation: when NeonBrush flips its `engine/` adapter to thin-gl, all `test:unit` and `test:interaction` runs must stay green with no MAD regression on the existing interaction screenshots.

### 12.4 Bundle-size acceptance

NeonBrush measures its production webpack bundle before and after migration.
Acceptance: the swap drops the per-page `@babylonjs/core` footprint by **at
least 10×** for the smallest consumer (e.g. ScanEffect or a single loading
screen). The 10–12 KB min+gzip estimate in §0 is a hypothesis; if the real
number is materially worse, investigate before merging the NeonBrush PR.

---

## 13. File manifest

New package skeleton:

```
packages/babylon-thin-gl/
    package.json
    tsconfig.json
    vite.config.ts
    src/
        index.ts                     re-exports
        webgl-context.ts             ~180 LOC (createWebGLContext, lost/restored handlers, registries)
        webgl-state.ts               ~ 50 LOC (types only)
        render-loop.ts               ~ 60 LOC (runRenderLoop with dedupe, stopRenderLoop)
        webgl-shader.ts              ~140 LOC (compile, link, parallel-poll, bindAttribLocation)
        webgl-effect.ts              ~280 LOC (createEffect, useEffect, finalize, cached setters)
        webgl-texture.ts             ~230 LOC (createRaw + _upload closure, loadTexture2D + ImageBitmap retention, bindTexture, dispose)
        webgl-html-texture.ts        ~ 90 LOC (sub-entry, with _upload closure)
        webgl-effect-renderer.ts     ~110 LOC (ensureQuad, setViewport, apply, draw)
    test/
        webgl-effect.spec.ts
        webgl-texture.spec.ts
        webgl-effect-renderer.spec.ts
        webgl-cache.spec.ts
        webgl-context-loss.spec.ts
docs/
    architecture/28-thin-gl.md       (this file)
lab/
    sceneN-thin-gl-fullscreen.html
    src/bjs/sceneN.ts                (Babylon.js reference)
    src/lite/sceneN.ts               (thin-gl side-by-side via a thin-gl canvas)
tests/parity/scenes/sceneN-thin-gl-fullscreen.spec.ts
reference/sceneN-thin-gl-fullscreen/babylon-ref-golden.png
```

NeonBrush side (downstream PR):

```
packages/NeonBrush/
    package.json                                  add @babylon-lite/thin-gl, drop @babylonjs/core (after v2)
    src/engine/thinEngineFactory.ts               → createNeonContext
    src/engine/baseEffect.ts                      → free functions
    src/engine/baseInteractiveEffect.ts           → free functions
    src/generativeEffects/scanEffect.ts           mechanical rewrite
    src/embodiement/cloth/clothEffect.ts          mechanical rewrite
    src/embodiement/clothVNext/clothEffectVNext.ts mechanical rewrite (uses defines)
    src/embodiement/orb/orbEffect.ts              mechanical rewrite (LANDSCAPE define variant)
    src/inputs/inputGlow.ts                       mechanical rewrite (uses /html-texture sub-entry)
    src/loadingScreen/progressive/…               mechanical rewrite (BACKGROUNDCOLORRAMP define)
    src/loadingScreen/progressiveVNext/…          mechanical rewrite
    src/loadingScreen/rocksteady/…                mechanical rewrite
    src/loadingScreen/core/tiles.ts               mechanical rewrite
    src/loadingScreen/magic/background.ts         mechanical rewrite
    src/loadingScreen/magic/particles.ts          UNCHANGED (still uses stock SpriteRenderer)
    src/loadingScreen/magic/magicLoadingScreen.ts UNCHANGED
    tools/buildShaders.mjs                        extend with GLSL 1.00 → 3.00 pre-conversion (§6.2)
```

Estimated package source: **~1.15–1.45 K LOC** (incremented from the original
estimate to account for the loss/restore protocol added in §4.7).
Estimated bundle delta for NeonBrush (minified + gzipped, what the page actually
downloads): **~120–150 KB → ~11–14 KB** (≈ 10× smaller — see §12.4 for the
acceptance criterion).
