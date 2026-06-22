# Module: Audio Engine

> Package path: `packages/babylon-lite/src/audio/`

> **Status: Specification (one-shot doc) — implementation pending.**
> This is a faithful _behavioral_ port of Babylon.js v2 AudioV2
> (`packages/dev/core/src/AudioV2/`) re-architected to Babylon Lite idioms:
> pure-state interfaces + standalone functions, zero module-level side effects,
> single Web Audio backend (no abstract/concrete split), and opt-in feature
> modules. The **Web Audio API node graph, parameter-ramp math, and spatial
> panner math are preserved 1:1** — only the code _shape_ changes, never the
> audible behavior.

---

## Purpose

The Audio module wraps the browser **Web Audio API** to provide sound playback,
mixing/routing (buses), 3D spatial audio, stereo panning, FFT analysis,
microphone capture, and an optional unmute UI. It is fully decoupled from the
WebGPU render stack: it has **no GPU, scene-graph, or render-loop dependency**.
Spatial audio optionally reads a Lite `Mesh`/transform's world position so a
sound can follow an object, but audio never holds a reference to the scene
(Pillar 4b — one-way data ownership).

The module is **100% opt-in and tree-shakable**. A scene that imports nothing
from `audio/` pays zero bytes. Spatial, streaming, stereo, analyzer, microphone,
and unmute-UI are each separable feature modules pulled in only when their
factory/option is used.

---

## Design Mapping: AudioV2 → Lite

| AudioV2 (Babylon.js)                              | Babylon Lite                                             |
| ------------------------------------------------- | -------------------------------------------------------- |
| `abstract AudioEngineV2` + `_WebAudioEngine`      | one `AudioEngine` state interface + functions            |
| `abstract AbstractSound` + `_WebAudioStaticSound` | one `StaticSound` state interface + functions            |
| 29 abstract classes + 21 `_WebAudio*` concretes   | flat set of pure-state interfaces; no inheritance        |
| Class methods (`sound.play()`)                    | standalone functions (`playSound(sound)`)                |
| `new Observable()` event fields                   | lightweight callback-set (`AudioSignal<T>`) on the state |
| Module-level `Instances[]`, `OnCreatedObservable` | **removed** — caller owns the `AudioEngine` handle       |
| Module-level `new RegExp`, cached `ExpCurve`      | lazy-init inside functions (no module side effects)      |
| `WebRequest.FetchAsync` + custom headers          | plain `fetch()` (matches every other Lite loader)        |
| `Vector3`/`Quaternion` from core Maths            | Lite `math/` vec3/quat                                   |
| `Logger.Warn`                                     | `console.warn`                                           |
| `EngineStore.LastCreatedEngine` (unmute UI)       | explicit `parentElement` option                          |
| `PrecisionDate.Now`                               | `performance.now()`                                      |
| `Node` / `AbstractMesh` (spatial attach)          | Lite `Mesh` / `{ worldMatrix }` transform                |

### Why collapse the abstract layer

AudioV2's abstract/concrete split exists so Babylon can swap audio backends.
Babylon Lite targets one backend (Web Audio) that will ever exist, so the
indirection is pure overhead and conflicts with Pillars 2 and 4b′. We keep a
single implementation. The Web Audio graph construction is copied faithfully;
the class scaffolding is not.

---

## Public API Surface

All public types are **pure state** (no methods). Behavior is in functions.

```typescript
// ─── Engine ──────────────────────────────────────────────────────────
export interface AudioEngineOptions {
    /** Provide an existing context. Pass an `OfflineAudioContext` for deterministic,
     *  headless, faster-than-real-time rendering to PCM (Tier-2/3 tests, parity).
     *  Default: new AudioContext(). */
    audioContext?: BaseAudioContext;
    /** Ramp smoothing for all parameter changes, in seconds. Default 0.01 (10 ms). */
    parameterRampDuration?: number;
    /** Initial master output volume. Default 1. */
    volume?: number;
    /** Resume the context on the first user gesture (click). Default true. */
    resumeOnInteraction?: boolean;
    /** Periodically retry resume() while suspended/interrupted. Default true. */
    resumeOnPause?: boolean;
    /** Retry period for resumeOnPause, in ms. Default 1000. */
    resumeOnPauseRetryInterval?: number;
    /** Spatial listener defaults (position/orientation). */
    listener?: Partial<SpatialListenerOptions>;
}

export type AudioEngineState = "closed" | "interrupted" | "running" | "suspended";

/** Handle to the audio engine. Pure state. GPU-style internals are @internal. */
export interface AudioEngine {
    readonly state: AudioEngineState;
    /** Fires on every state transition. */
    readonly onStateChanged: AudioSignal<AudioEngineState>;
    /** @internal */ readonly _ctx: BaseAudioContext;
    /** @internal */ readonly _mainOut: GainNode;
    /** @internal */ readonly _mainBus: MainBus;
    /** @internal */ readonly _listener: SpatialListener | null;
    /** @internal */ _rampDuration: number;
    /** @internal */ readonly _disposers: Array<() => void>;
}

export function createAudioEngineAsync(options?: AudioEngineOptions): Promise<AudioEngine>;
export function disposeAudioEngine(engine: AudioEngine): void;
/** Resume a suspended/interrupted context (e.g. from a user-gesture handler). */
export function unlockAudioEngineAsync(engine: AudioEngine): Promise<void>;
export function setMasterVolume(engine: AudioEngine, value: number, options?: RampOptions): void;

// ─── Sounds (static) ─────────────────────────────────────────────────
export type SoundSource = string | string[] | ArrayBuffer | AudioBuffer | SoundBuffer;

export interface StaticSoundOptions {
    autoplay?: boolean; // default false
    loop?: boolean; // default false
    startOffset?: number; // seconds, default 0
    maxInstances?: number; // default Infinity
    volume?: number; // default 1
    outBus?: AudioBus | MainBus; // default engine main bus
    // feature opt-ins (presence triggers the sub-node):
    spatial?: Partial<SpatialSoundOptions>;
    stereo?: { pan: number };
    analyzer?: { fftSize: number };
}

export interface StaticSound {
    readonly name: string;
    readonly state: SoundState;
    loop: boolean;
    startOffset: number;
    maxInstances: number;
    readonly onEnded: AudioSignal<StaticSound>;
    /** @internal */ readonly _engine: AudioEngine;
    /** @internal */ readonly _buffer: AudioBuffer;
    /** @internal */ readonly _graph: SoundSubGraph;
    /** @internal */ readonly _instances: Set<StaticSoundInstance>;
    /** @internal */ readonly _options: StaticSoundOptions;
}

export function createSoundAsync(engine: AudioEngine, source: SoundSource, options?: StaticSoundOptions): Promise<StaticSound>;
export function createSoundBufferAsync(engine: AudioEngine, source: SoundSource): Promise<SoundBuffer>;
export function playSound(sound: StaticSound, options?: PlaySoundOptions): void;
export function pauseSound(sound: StaticSound): void;
export function resumeSound(sound: StaticSound, options?: PlaySoundOptions): void;
export function stopSound(sound: StaticSound): void;
export function disposeSound(sound: StaticSound): void;

// ─── Streaming sounds (HTMLAudioElement path) ───────────────────────
export interface StreamingSoundOptions extends Omit<StaticSoundOptions, "maxInstances"> {
    preloadCount?: number; // default 1
}
export interface StreamingSound {
    /* mirrors StaticSound, no loopStart/pitch/playbackRate */
}
export function createStreamingSoundAsync(engine: AudioEngine, source: string | string[] | HTMLAudioElement, options?: StreamingSoundOptions): Promise<StreamingSound>;
export function preloadStreamingInstanceAsync(sound: StreamingSound): Promise<void>;
// play/pause/resume/stop/dispose share the StaticSound functions via a common SoundLike union.

// ─── Buses (routing / mixing) ───────────────────────────────────────
export interface AudioBusOptions {
    volume?: number;
    outBus?: AudioBus | MainBus;
    spatial?: Partial<SpatialSoundOptions>;
    stereo?: { pan: number };
}
export interface AudioBus {
    readonly name: string;
    /** @internal */ _graph: SoundSubGraph;
    /** @internal */ _in: GainNode;
}
export interface MainBus {
    readonly name: string;
    /** @internal */ _gain: GainNode;
}
export function createAudioBusAsync(engine: AudioEngine, name: string, options?: AudioBusOptions): Promise<AudioBus>;
export function createMainBusAsync(engine: AudioEngine, name: string, options?: { volume?: number }): Promise<MainBus>;
export function setBusVolume(bus: AudioBus | MainBus, value: number, options?: RampOptions): void;

// ─── Spatial (3D) ───────────────────────────────────────────────────
export interface SpatialSoundOptions {
    position: Vec3;
    orientation: Vec3;
    rotationQuaternion?: Quat;
    panningEnabled: boolean; // default true
    panningModel: "equalpower" | "HRTF"; // default "equalpower"
    distanceModel: "linear" | "inverse" | "exponential"; // default "inverse"
    minDistance: number;
    maxDistance: number;
    rolloffFactor: number;
    coneInnerAngle: number;
    coneOuterAngle: number;
    coneOuterVolume: number;
    /** Follow a Lite mesh/transform's world position (and optionally rotation). */
    attachedTo?: SpatialTarget;
    attachmentType?: "position" | "rotation" | "positionAndRotation";
    useBoundingBox?: boolean;
}
export interface SpatialListenerOptions {
    position: Vec3;
    orientation: Vec3;
    rotationQuaternion?: Quat;
    attachedTo?: SpatialTarget;
}
/** Anything exposing a world transform — typically a Lite Mesh or camera. */
export interface SpatialTarget {
    readonly worldMatrix: Mat4;
    readonly onDispose?: AudioSignal<unknown>;
}
export function setSpatialPosition(sound: StaticSound | AudioBus, p: Vec3): void;
export function attachSpatialTarget(soundOrListener: StaticSound | AudioBus | AudioEngine, target: SpatialTarget, type?: SpatialSoundOptions["attachmentType"]): void;
export function detachSpatialTarget(soundOrListener: StaticSound | AudioBus | AudioEngine): void;
/** Pump per-frame spatial updates. Call from your render loop OR enable auto-RAF. */
export function updateSpatialAudio(engine: AudioEngine): void;
export function setSpatialAutoUpdate(engine: AudioEngine, enabled: boolean, minUpdateMs?: number): void;

// ─── Analyzer ───────────────────────────────────────────────────────
export interface AudioAnalyzer {
    /** @internal */ _node: AnalyserNode;
}
export function getByteFrequencyData(sound: StaticSound | AudioBus, out: Uint8Array): void;
export function getFloatFrequencyData(sound: StaticSound | AudioBus, out: Float32Array): void;

// ─── Microphone source ──────────────────────────────────────────────
export interface MicrophoneSound {
    readonly name: string;
    /** @internal */ _stream: MediaStream;
}
export function createMicrophoneSoundSourceAsync(engine: AudioEngine, name: string, options?: { outBus?: AudioBus | MainBus }): Promise<MicrophoneSound>;

// ─── Unmute UI ──────────────────────────────────────────────────────
export interface UnmuteUiOptions {
    parentElement?: HTMLElement;
}
export function createUnmuteUi(engine: AudioEngine, options?: UnmuteUiOptions): { dispose(): void };

// ─── Parameter ramps ────────────────────────────────────────────────
export type AudioRampShape = "none" | "linear" | "exponential" | "logarithmic";
export interface RampOptions {
    shape?: AudioRampShape;
    duration?: number;
}

// ─── Shared signal (replaces core Observable) ───────────────────────
export interface AudioSignal<T> {
    add(cb: (v: T) => void): () => void;
    addOnce(cb: (v: T) => void): () => void;
}

// ─── Enums (re-exported, identical semantics) ───────────────────────
export const enum SoundState {
    Stopped,
    Starting,
    Started,
    Stopping,
    Paused,
    FailedToStart,
}
```

---

## Internal Architecture

### Sound sub-graph (signal flow)

Faithful reproduction of `_WebAudioBusAndSoundSubGraph`. Each sound/bus owns a
`SoundSubGraph` — a lazily-built chain of Web Audio nodes. Nodes exist only when
their feature is requested:

```
source/instance ─▶ [root Gain (only if spatial+stereo both present)]
                      ├─▶ Spatial (PannerNode [+ attenuation GainNode])
                      └─▶ Stereo  (StereoPannerNode)
                            ▼
                          Volume (GainNode)            ← always present
                            ▼
                          [Analyzer (AnalyserNode)]    ← only if fftSize given
                            ▼
                          out → outBus.in → … → mainBus → mainOut → ctx.destination
```

`SoundSubGraph` is plain state:

```typescript
interface SoundSubGraph {
    readonly _ctx: BaseAudioContext;
    _volume: GainNode; // always
    _stereo: StereoPannerNode | null;
    _spatial: SpatialSubNode | null;
    _analyzer: AnalyserNode | null;
    _root: GainNode | null; // only when spatial+stereo coexist
    _in: AudioNode; // current head of chain (where instances connect)
    _out: AudioNode; // tail (volume or analyzer)
}
```

`rebuildSubGraph(graph)` re-wires connections when a feature node is added or
removed (mirrors `_onSubNodesChanged`). Adding a feature is the _only_ way to
grow the graph — there is no hardcoded `if (spatial)` in core sound code; each
feature module exposes an `ensureXSubNode(graph, opts)` that the option parser
calls (Pillar 4c′ extension pattern, applied to audio sub-nodes).

### Parameter ramp component

`audio-param.ts` — pure, side-effect-free. `applyRamp(param, ctx, value, shape, duration, rampDuration)`:

- `"none"`: `param.value = value`.
- `"linear"`: `param.setValueCurveAtTime([from, to], ctx.currentTime, duration)`.
- `"exponential"` / `"logarithmic"`: build a 100-point curve via
  `getRampCurve(shape, from, to)` and `param.setValueCurveAtTime(curve, …)`.
  Below `MIN_RAMP_DURATION = 1e-6` s, fall back to `setValueAtTime`.
- Always `param.cancelScheduledValues(0)` before scheduling.

The exp/log normalized curves are cached via **lazy-init** (`let expCurve: Float32Array | null = null; function getExpCurve() {…}`) — never at module scope. Math copied verbatim from `audioUtils.ts` (`Math.exp(-11.512925464970227 * (1 - x))`, `1 + Math.log10(x)/Math.log10(100)`).

### Instances

A `StaticSound` spawns a `StaticSoundInstance` per `playSound` call, each wrapping
a fresh `AudioBufferSourceNode` (`start(when, offset)` / `stop(when)`), respecting
`loop`, `loopStart`/`loopEnd`, `startOffset`, pitch (cents → `detune`), and
`playbackRate`. `maxInstances` trims oldest started instances. Pause stores the
elapsed time and stops the source; resume creates a new source at the stored
offset. Streaming instances wrap an `HTMLAudioElement` +
`MediaElementAudioSourceNode` and support `preloadCount` look-ahead instances.

---

## State Machine / Lifecycle

### Engine

```
createAudioEngineAsync
  → new AudioContext (or use provided)
  → build mainOut GainNode → ctx.destination
  → build default MainBus → mainOut
  → build SpatialListener (lazy; only if spatial used)
  → wire "statechange" listener → onStateChanged signal
  → if resumeOnInteraction: document.addEventListener("click", resumeOnce)   [disposer registered]
  → if resumeOnPause: setInterval(retryResume, interval) while !running       [disposer registered]
disposeAudioEngine
  → run every fn in engine._disposers (removes listeners, clears interval/RAF)
  → close ctx unless it was provided/offline
```

All global hooks (`document` click listener, `setInterval`, spatial `requestAnimationFrame`) are registered into `engine._disposers` so disposal is leak-free. **Nothing is registered at module load** — the engine handle owns it all.

### Sound

`Stopped → Starting → Started → (Stopping) → Stopped`, with `Paused` and
`FailedToStart` branches — identical to `soundState.ts`. `onEnded` fires when the
last instance ends (non-looping full play, or explicit stop).

---

## Babylon.js Equivalence Map

| Lite function/type                 | AudioV2 origin                                               |
| ---------------------------------- | ------------------------------------------------------------ |
| `createAudioEngineAsync`           | `CreateAudioEngineAsync` + `_WebAudioEngine` ctor/init       |
| `AudioEngine.state`                | `AudioEngineV2.state` (maps `ctx.state`)                     |
| `unlockAudioEngineAsync`           | `_WebAudioEngine.unlockAsync` / `resumeAsync`                |
| `createSoundAsync`                 | `CreateSoundAsync` + `_WebAudioStaticSound._initAsync`       |
| `createSoundBufferAsync`           | `CreateSoundBufferAsync` (`decodeAudioData`)                 |
| `playSound`/`stopSound`/…          | `AbstractSound.play/stop/pause/resume`                       |
| `SoundSubGraph` + rebuild          | `_WebAudioBusAndSoundSubGraph` + `_onSubNodesChanged`        |
| `applyRamp` / `getRampCurve`       | `_WebAudioParameterComponent` + `_GetAudioParamCurveValues`  |
| `SpatialSubNode` / panner          | `_SpatialWebAudioSubNode` (PannerNode config)                |
| `SpatialListener`                  | `_SpatialWebAudioListener(+Fallback)`                        |
| `attachSpatialTarget`              | `_SpatialAudioAttacherComponent.attach`                      |
| `updateSpatialAudio` / RAF         | `_SpatialWebAudioUpdaterComponent`                           |
| `createStreamingSoundAsync`        | `CreateStreamingSoundAsync` + `_WebAudioStreamingSound`      |
| `createMicrophoneSoundSourceAsync` | `_WebAudioSoundSource` (getUserMedia)                        |
| `createUnmuteUi`                   | `_WebAudioUnmuteUI` (parentElement injected, no EngineStore) |

Behavior (node types, parameter mappings, ramp curves, panner/listener math)
is identical. Only ownership, side-effect timing, and call syntax change.

---

## Dependencies

- **Web Audio API** (`AudioContext`, `GainNode`, `PannerNode`,
  `StereoPannerNode`, `AnalyserNode`, `AudioBufferSourceNode`,
  `MediaElementAudioSourceNode`, `MediaStreamAudioSourceNode`).
- **Lite `math/`** — `Vec3`, `Quat`, `Mat4` (spatial only; static/streaming/bus
  pull no math).
- **`fetch()`** — same plain pattern as every other Lite loader (no WebRequest).
- No GPU, no scene, no render-loop dependency.

---

## Tree-Shaking / Bundle Strategy

- `audio/index.ts` re-exports only side-effect-free modules; nothing runs at import.
- Feature modules (`spatial/`, `streaming/`, `analyzer/`, `microphone/`,
  `unmute-ui/`) are reachable only through their own factory functions, so an
  app using just `createSoundAsync` + `playSound` drops every other module.
- The sub-node `ensureXSubNode` registration is wired through the option parser,
  not a global registry — unused sub-nodes are eliminated.
- Lazy-init for all caches (ramp curves, file-extension regex). **No
  module-level `new` of `Map`/`Set`/`Observable`/`RegExp`.**

---

## Test Specification

Audio produces **no pixels**, so the Playwright screenshot/MAD parity harness
does **not** apply directly. Instead, audio is tested in **four tiers**, three of
which are fully deterministic CI gates. The cornerstone is **`OfflineAudioContext`**:
the entire Web Audio graph can be rendered faster-than-real-time, with **no user
gesture and no speakers**, into a reproducible `AudioBuffer`. This lets us assert
on the _actual rendered PCM_ — a stronger guarantee than any screenshot — and,
optionally, draw that PCM to a canvas for a deterministic _visual_ gate.

> The `createAudioEngineAsync` `audioContext` option already accepts a
> `BaseAudioContext`, so passing an `OfflineAudioContext` is the supported entry
> point for offline rendering. The engine detects offline contexts and skips
> `close()`/gesture-unlock paths on them (mirrors AudioV2's
> `_isUsingOfflineAudioContext`).

### Tier 1 — Unit / behavioral (mocked Web Audio API), deterministic

1. **Graph wiring** — assert the correct `connect()` topology for every feature
   combination (volume only; +stereo; +spatial; +spatial+stereo with root gain;
   +analyzer). Verify rebuild on add/remove.
2. **Ramps** — assert `setValueCurveAtTime` is called with the exact 2-point
   linear array and the 100-point exp/log curves (snapshot the curve values
   against the verbatim BJS math); assert `cancelScheduledValues(0)` precedes.
3. **Lifecycle** — state transitions; `onEnded` fires once on last-instance end;
   `maxInstances` trims oldest; pause/resume offset correctness.
4. **Spatial wiring** — panner `positionX/Y/Z`, `orientationX/Y/Z`, distance/cone
   params set from a fake `SpatialTarget.worldMatrix`; listener 9-param path +
   legacy `setPosition`/`setOrientation` fallback; `updateSpatialAudio` throttling.
5. **No side effects** — import every `audio/` module and assert no global
   mutation, no `document`/`setInterval`/`new AudioContext` at import time
   (guards the zero-side-effect pillar).
6. **Disposal** — `disposeAudioEngine` removes the click listener, clears the
   resume interval/RAF, and closes only contexts it created.

### Tier 2 — Output correctness (`OfflineAudioContext` → PCM), deterministic ★ primary gate

Render real sounds through a real (offline) Web Audio graph and assert on the
returned samples. This validates audible behavior, not just node wiring.

7. **Playback** — render a known buffer (e.g. a 440 Hz sine) and assert peak/RMS,
   sample-at-time, and total duration. Looping renders the expected repeats;
   `startOffset` shifts the first non-zero sample.
8. **Volume / ramps** — render a master/bus/sound volume ramp and assert the PCM
   envelope follows the linear/exp/log curve within tolerance.
9. **Stereo** — assert left/right channel energy split matches the pan value.
10. **Spatial** — render with the source panned hard left/right/behind the
    listener and assert the inter-channel level/delay and distance attenuation
    (per `distanceModel`/`rolloffFactor`) match expected values.
11. **Bus routing** — sum/attenuation through a bus chain matches direct output.

### Tier 3 — Visual parity (offline PCM → waveform/spectrogram canvas), deterministic (optional)

12. Draw the Tier-2 rendered PCM to a canvas (waveform or FFT spectrogram) and
    pixel-diff against a committed golden image. Because offline rendering is
    reproducible, the image is deterministic — this is the "show the waves" gate
    and reuses the existing golden-comparison tooling. Goldens live under
    `reference/lite/audio-<case>/` and are regenerated only on explicit request.

### Tier 4 — Live demo visualizer, NOT a gate

13. The interactive demo uses a real-time `AnalyserNode` to draw a waveform +
    frequency-bar visualizer. It requires a user gesture to unlock the context
    and is non-deterministic, so it is a **manual showcase only** — never a CI
    check.

### Behavioral parity against Babylon.js (optional, deterministic)

Render the same sound through BJS AudioV2 and through Lite, both on an
`OfflineAudioContext`, then diff the PCM. True behavioral parity, no ears
required. Useful for validating the spatial/ramp math during the port; not a
standing CI gate.

---

## File Manifest

```
packages/babylon-lite/src/audio/
  index.ts                  # pure barrel
  audio-engine.ts           # createAudioEngineAsync, dispose, unlock, master volume
  audio-signal.ts           # AudioSignal<T> (Observable replacement)
  audio-param.ts            # ramp shapes + curve math (lazy-init caches)
  audio-fetch.ts            # decode helpers over plain fetch()
  sound-buffer.ts           # createSoundBufferAsync (decodeAudioData)
  static-sound.ts           # StaticSound + instance lifecycle
  sound-sub-graph.ts        # SoundSubGraph build/rebuild (core chain)
  bus.ts                    # AudioBus + MainBus
  streaming/streaming-sound.ts
  spatial/spatial-sub-node.ts        # PannerNode
  spatial/spatial-listener.ts        # listener (+ legacy fallback)
  spatial/spatial-attach.ts          # attach to Lite transform + RAF updater
  analyzer/analyzer.ts               # AnalyserNode
  microphone/microphone-source.ts    # getUserMedia
  unmute-ui/unmute-ui.ts             # DOM button (parentElement injected)
  viz/waveform.ts                    # PCM/AnalyserNode → canvas (demo + Tier-3 golden render)
docs/lite/architecture/41-audio-engine.md   # this doc
tests/lite/audio/*.spec.ts                   # Tier-1 vitest (mocked Web Audio)
tests/lite/audio/offline/*.spec.ts           # Tier-2 vitest (OfflineAudioContext → PCM asserts)
tests/lite/audio/visual/*.spec.ts            # Tier-3 (offline PCM → waveform canvas → golden diff)
reference/lite/audio-<case>/                 # Tier-3 golden waveform/spectrogram images
lab/lite/src/demos/audio-demo.ts             # Tier-4 interactive showcase (real-time visualizer)
lab/lite/audio-demo.html                     # demo page (gesture-unlock required)
```

Tier-2 offline tests run headless in vitest via a JS `OfflineAudioContext`
polyfill (or the real one under a browser test runner); Tier-3/Tier-4 use a
canvas (offscreen for Tier-3, on-screen for the demo).
