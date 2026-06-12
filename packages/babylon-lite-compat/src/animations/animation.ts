/**
 * Babylon.js-compatible `Animation` keyframe model + `AnimationGroup`.
 *
 * `Animation` is a pure-JS keyframe container with CPU evaluation (`evaluate`),
 * the Babylon.js data-type / loop-mode constants, and `setKeys`/`getKeys`. This
 * is fully testable without a GPU. `AnimationGroup` provides the structural
 * grouping/playback-state surface; frame-accurate playback is driven through the
 * native Babylon Lite animation manager when wired to a scene (not modelled here).
 */

export interface IAnimationKey {
    frame: number;
    value: number | number[];
}

export const AnimationTypes = {
    ANIMATIONTYPE_FLOAT: 0,
    ANIMATIONTYPE_VECTOR3: 1,
    ANIMATIONTYPE_QUATERNION: 2,
    ANIMATIONTYPE_MATRIX: 3,
    ANIMATIONTYPE_COLOR3: 4,
    ANIMATIONTYPE_VECTOR2: 5,
    ANIMATIONTYPE_COLOR4: 6,
} as const;

export const AnimationLoopModes = {
    ANIMATIONLOOPMODE_RELATIVE: 0,
    ANIMATIONLOOPMODE_CYCLE: 1,
    ANIMATIONLOOPMODE_CONSTANT: 2,
} as const;

export class Animation {
    public static readonly ANIMATIONTYPE_FLOAT = AnimationTypes.ANIMATIONTYPE_FLOAT;
    public static readonly ANIMATIONTYPE_VECTOR3 = AnimationTypes.ANIMATIONTYPE_VECTOR3;
    public static readonly ANIMATIONTYPE_QUATERNION = AnimationTypes.ANIMATIONTYPE_QUATERNION;
    public static readonly ANIMATIONTYPE_MATRIX = AnimationTypes.ANIMATIONTYPE_MATRIX;
    public static readonly ANIMATIONTYPE_COLOR3 = AnimationTypes.ANIMATIONTYPE_COLOR3;
    public static readonly ANIMATIONLOOPMODE_RELATIVE = AnimationLoopModes.ANIMATIONLOOPMODE_RELATIVE;
    public static readonly ANIMATIONLOOPMODE_CYCLE = AnimationLoopModes.ANIMATIONLOOPMODE_CYCLE;
    public static readonly ANIMATIONLOOPMODE_CONSTANT = AnimationLoopModes.ANIMATIONLOOPMODE_CONSTANT;

    private _keys: IAnimationKey[] = [];

    public constructor(
        public name: string,
        public targetProperty: string,
        public framePerSecond: number,
        public dataType: number = AnimationTypes.ANIMATIONTYPE_FLOAT,
        public loopMode: number = AnimationLoopModes.ANIMATIONLOOPMODE_CYCLE
    ) {}

    public setKeys(keys: IAnimationKey[]): void {
        this._keys = keys.slice().sort((a, b) => a.frame - b.frame);
    }

    public getKeys(): IAnimationKey[] {
        return this._keys;
    }

    public getHighestFrame(): number {
        return this._keys.length > 0 ? this._keys[this._keys.length - 1]!.frame : 0;
    }

    /** Linearly evaluate the animated value at `frame` (clamped to the key range). */
    public evaluate(frame: number): number | number[] {
        const keys = this._keys;
        if (keys.length === 0) {
            return 0;
        }
        if (frame <= keys[0]!.frame) {
            return keys[0]!.value;
        }
        if (frame >= keys[keys.length - 1]!.frame) {
            return keys[keys.length - 1]!.value;
        }
        for (let i = 0; i < keys.length - 1; i++) {
            const a = keys[i]!;
            const b = keys[i + 1]!;
            if (frame >= a.frame && frame <= b.frame) {
                const t = (frame - a.frame) / (b.frame - a.frame);
                return lerpValue(a.value, b.value, t);
            }
        }
        return keys[keys.length - 1]!.value;
    }

    /** Babylon.js helper: build a one-shot float animation between two values. */
    public static CreateAndStartAnimation(name: string, _target: unknown, targetProperty: string, framePerSecond: number, totalFrame: number, from: number, to: number): Animation {
        const anim = new Animation(name, targetProperty, framePerSecond);
        anim.setKeys([
            { frame: 0, value: from },
            { frame: totalFrame, value: to },
        ]);
        return anim;
    }
}

function lerpValue(a: number | number[], b: number | number[], t: number): number | number[] {
    if (typeof a === "number" && typeof b === "number") {
        return a + (b - a) * t;
    }
    const av = a as number[];
    const bv = b as number[];
    return av.map((value, i) => value + ((bv[i] ?? value) - value) * t);
}

export type AnimationGroupState = "init" | "playing" | "paused" | "stopped";

/**
 * Babylon.js `AnimationGroup` — a named collection of animations with playback
 * state. Structural surface (add/play/pause/stop + state + observable-less
 * callbacks); frame stepping is delegated to the native animation manager when
 * the group is bound to a scene.
 */
export class AnimationGroup {
    public readonly targetedAnimations: Array<{ animation: Animation; target: unknown }> = [];
    public from = 0;
    public to = 0;
    public onAnimationGroupEndObservable?: () => void;

    private _state: AnimationGroupState = "init";
    public speedRatio = 1;

    public constructor(public name: string) {}

    public get isPlaying(): boolean {
        return this._state === "playing";
    }

    public get state(): AnimationGroupState {
        return this._state;
    }

    public addTargetedAnimation(animation: Animation, target: unknown): { animation: Animation; target: unknown } {
        const entry = { animation, target };
        this.targetedAnimations.push(entry);
        this.from = Math.min(this.from, 0);
        this.to = Math.max(this.to, animation.getHighestFrame());
        return entry;
    }

    public play(_loop?: boolean): this {
        this._state = "playing";
        return this;
    }

    public pause(): this {
        this._state = "paused";
        return this;
    }

    public stop(): this {
        this._state = "stopped";
        return this;
    }

    public reset(): this {
        this._state = "init";
        return this;
    }
}
