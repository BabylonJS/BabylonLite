/**
 * Babylon Lite audio engine — public surface (engine + static sounds + buses).
 *
 * Side-effect-free re-exports only, so unused audio code is fully tree-shaken.
 */

export { createAudioEngineAsync, disposeAudioEngine, unlockAudioEngineAsync, setMasterVolume, getMasterVolume } from "./audio-engine.js";
export type { AudioEngine, AudioEngineOptions, AudioEngineState } from "./audio-engine.js";

export { createSoundAsync, playSound, pauseSound, resumeSound, stopSound, disposeSound, setSoundVolume, SoundState } from "./static-sound.js";
export type { StaticSound, StaticSoundOptions, StaticSoundPlayOptions, StaticSoundStopOptions } from "./static-sound.js";

export { createAudioBusAsync, disposeAudioBus, setBusVolume } from "./audio-bus.js";
export type { AudioBus, AudioBusOptions, PrimaryAudioBus } from "./audio-bus.js";
export type { MainBus } from "./bus.js";

export { createSoundBufferAsync } from "./sound-buffer.js";
export type { SoundBuffer, SoundSource, SoundBufferOptions } from "./sound-buffer.js";

export type { AudioSignal } from "./audio-signal.js";
export type { AudioRampShape, RampOptions } from "./audio-param.js";
