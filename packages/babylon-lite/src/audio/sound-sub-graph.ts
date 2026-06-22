/**
 * Per-sound sub-graph.
 *
 * Faithful port of AudioV2 `_WebAudioBaseSubGraph` + `_VolumeWebAudioSubNode`,
 * reduced to the Phase 1 surface: a single volume `GainNode`. Spatial, stereo
 * and analyzer sub-nodes are added in later phases between `_in` and `_out`.
 *
 * `instances` -\> `_in` (the `_volume` GainNode) -\> `_out` -\> `outBus._in`
 */

import { type RampClock, type RampOptions, type RampParam, createRampParam, setRampTarget } from "./audio-param.js";

/** Sound sub-graph state. @internal */
export interface SoundSubGraph {
    /** @internal */ _volume: GainNode;
    /** @internal */ _volumeRamp: RampParam;
    /** Head node — where playing instances connect. @internal */ _in: AudioNode;
    /** Tail node — connects to the output bus. @internal */ _out: AudioNode;
}

/** @internal */
export function createSoundSubGraph(ctx: BaseAudioContext, clock: RampClock, volume = 1): SoundSubGraph {
    const gain = new GainNode(ctx);
    gain.gain.value = volume;
    return {
        _volume: gain,
        _volumeRamp: createRampParam(gain.gain, clock),
        _in: gain,
        _out: gain,
    };
}

/** @internal */
export function setSoundSubGraphVolume(graph: SoundSubGraph, value: number, options?: RampOptions): void {
    setRampTarget(graph._volumeRamp, value, options);
}

/** Connects the sub-graph output to a downstream input node. @internal */
export function connectSoundSubGraph(graph: SoundSubGraph, downstream: AudioNode): void {
    graph._out.connect(downstream);
}

/** Disconnects the sub-graph output from a downstream input node. @internal */
export function disconnectSoundSubGraph(graph: SoundSubGraph, downstream: AudioNode): void {
    graph._out.disconnect(downstream);
}

/** @internal */
export function disposeSoundSubGraph(graph: SoundSubGraph): void {
    graph._volume.disconnect();
}
