/**
 * Minimal Web Audio API mock for Tier-1 (wiring / ramp / lifecycle) audio tests.
 *
 * Node has no Web Audio implementation, so these mocks record graph connections
 * and `AudioParam` scheduling calls so the audio engine's behaviour can be
 * asserted without a real audio backend. Tier-2 (real PCM via OfflineAudioContext)
 * is a separate, browser/native-backed concern.
 */

export class MockAudioParam {
    public value: number;
    public readonly calls: Array<{ method: string; args: unknown[] }> = [];

    public constructor(initial = 0) {
        this.value = initial;
    }

    public cancelScheduledValues(time: number): void {
        this.calls.push({ method: "cancelScheduledValues", args: [time] });
    }

    public setValueAtTime(value: number, time: number): void {
        this.value = value;
        this.calls.push({ method: "setValueAtTime", args: [value, time] });
    }

    public setValueCurveAtTime(curve: Float32Array, time: number, duration: number): void {
        this.value = curve[curve.length - 1]!;
        this.calls.push({ method: "setValueCurveAtTime", args: [curve.slice(), time, duration] });
    }

    public setTargetAtTime(value: number, time: number, constant: number): void {
        this.calls.push({ method: "setTargetAtTime", args: [value, time, constant] });
    }
}

export class MockAudioNode {
    public readonly connections = new Set<MockAudioNode>();

    public connect(node: MockAudioNode): MockAudioNode {
        this.connections.add(node);
        return node;
    }

    public disconnect(node?: MockAudioNode): void {
        if (node) {
            this.connections.delete(node);
        } else {
            this.connections.clear();
        }
    }
}

export class MockGainNode extends MockAudioNode {
    public readonly gain = new MockAudioParam(1);
    public constructor(public readonly context: MockBaseAudioContext) {
        super();
    }
}

export class MockAudioBuffer {
    public constructor(
        public readonly duration = 1,
        public readonly sampleRate = 48000,
        public readonly numberOfChannels = 2,
        public readonly length = 48000
    ) {}

    public getChannelData(): Float32Array {
        return new Float32Array(this.length);
    }
}

export class MockAudioBufferSourceNode extends MockAudioNode {
    public buffer: MockAudioBuffer | null;
    public readonly detune = new MockAudioParam(0);
    public readonly playbackRate = new MockAudioParam(1);
    public loop = false;
    public loopStart = 0;
    public loopEnd = 0;
    public started: { when?: number; offset?: number; duration?: number } | null = null;
    public stopped: { when?: number } | null = null;
    private _listeners: Array<() => void> = [];

    public constructor(
        public readonly context: MockBaseAudioContext,
        options?: { buffer?: MockAudioBuffer }
    ) {
        super();
        this.buffer = options?.buffer ?? null;
    }

    public start(when?: number, offset?: number, duration?: number): void {
        this.started = { when, offset, duration };
    }

    public stop(when?: number): void {
        this.stopped = { when };
    }

    public addEventListener(type: string, cb: () => void): void {
        if (type === "ended") {
            this._listeners.push(cb);
        }
    }

    public removeEventListener(type: string, cb: () => void): void {
        if (type === "ended") {
            this._listeners = this._listeners.filter((l) => l !== cb);
        }
    }

    /** Test helper — fire the "ended" event. */
    public fireEnded(): void {
        for (const cb of this._listeners.slice()) {
            cb();
        }
    }
}

export class MockBaseAudioContext {
    public currentTime = 0;
    public readonly destination = new MockAudioNode();
    public readonly stateListeners: Array<() => void> = [];

    public decodeAudioData(_data: ArrayBuffer): Promise<MockAudioBuffer> {
        return Promise.resolve(new MockAudioBuffer());
    }
}

export class MockAudioContext extends MockBaseAudioContext {
    public state: "running" | "suspended" | "closed" = "running";

    public addEventListener(type: string, cb: () => void): void {
        if (type === "statechange") {
            this.stateListeners.push(cb);
        }
    }

    public removeEventListener(type: string, cb: () => void): void {
        if (type === "statechange") {
            const i = this.stateListeners.indexOf(cb);
            if (i !== -1) {
                this.stateListeners.splice(i, 1);
            }
        }
    }

    public async resume(): Promise<void> {
        this._setState("running");
    }

    public async suspend(): Promise<void> {
        this._setState("suspended");
    }

    public async close(): Promise<void> {
        this._setState("closed");
    }

    /** Test helper — change state and fire statechange listeners. */
    public _setState(state: "running" | "suspended" | "closed"): void {
        this.state = state;
        for (const cb of this.stateListeners.slice()) {
            cb();
        }
    }
}

export class MockOfflineAudioContext extends MockBaseAudioContext {
    public constructor(
        public readonly numberOfChannels = 2,
        public readonly bufferLength = 48000,
        public readonly sampleRate = 48000
    ) {
        super();
    }
}

interface InstalledGlobals {
    [key: string]: unknown;
}

const SAVED: InstalledGlobals = {};
const KEYS = ["AudioContext", "OfflineAudioContext", "GainNode", "AudioBufferSourceNode", "AudioBuffer", "Audio"];

/** Installs the Web Audio mock onto `globalThis`. Call from `beforeEach`. */
export function installWebAudioMock(): void {
    const g = globalThis as unknown as InstalledGlobals;
    for (const key of KEYS) {
        SAVED[key] = g[key];
    }
    g.AudioContext = MockAudioContext;
    g.OfflineAudioContext = MockOfflineAudioContext;
    g.GainNode = MockGainNode;
    g.AudioBufferSourceNode = MockAudioBufferSourceNode;
    g.AudioBuffer = MockAudioBuffer;
    // Leave `Audio` undefined so `isAudioFormatValid` treats formats as valid in tests.
    g.Audio = undefined;
}

/** Restores the globals modified by {@link installWebAudioMock}. Call from `afterEach`. */
export function uninstallWebAudioMock(): void {
    const g = globalThis as unknown as InstalledGlobals;
    for (const key of KEYS) {
        g[key] = SAVED[key];
    }
}
