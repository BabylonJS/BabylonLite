import { describe, expect, it } from "vitest";

import { Animation, AnimationGroup } from "../src/animations/animation";

describe("Animation", () => {
    it("exposes Babylon.js data-type and loop-mode constants", () => {
        expect(Animation.ANIMATIONTYPE_FLOAT).toBe(0);
        expect(Animation.ANIMATIONTYPE_VECTOR3).toBe(1);
        expect(Animation.ANIMATIONLOOPMODE_CYCLE).toBe(1);
    });

    it("sorts keys and reports the highest frame", () => {
        const anim = new Animation("a", "position.x", 60);
        anim.setKeys([
            { frame: 30, value: 5 },
            { frame: 0, value: 0 },
        ]);
        expect(anim.getKeys()[0]!.frame).toBe(0);
        expect(anim.getHighestFrame()).toBe(30);
    });

    it("evaluates float keys with linear interpolation and clamping", () => {
        const anim = new Animation("a", "position.x", 60);
        anim.setKeys([
            { frame: 0, value: 0 },
            { frame: 10, value: 10 },
        ]);
        expect(anim.evaluate(-5)).toBe(0);
        expect(anim.evaluate(5)).toBe(5);
        expect(anim.evaluate(10)).toBe(10);
        expect(anim.evaluate(20)).toBe(10);
    });

    it("evaluates vector (array) keys componentwise", () => {
        const anim = new Animation("a", "position", 60, Animation.ANIMATIONTYPE_VECTOR3);
        anim.setKeys([
            { frame: 0, value: [0, 0, 0] },
            { frame: 10, value: [10, 20, 30] },
        ]);
        expect(anim.evaluate(5)).toEqual([5, 10, 15]);
    });

    it("builds a one-shot animation via CreateAndStartAnimation", () => {
        const anim = Animation.CreateAndStartAnimation("spin", {}, "rotation.y", 60, 60, 0, Math.PI);
        expect(anim.getHighestFrame()).toBe(60);
        expect(anim.evaluate(60)).toBeCloseTo(Math.PI, 6);
    });
});

describe("AnimationGroup", () => {
    it("tracks targeted animations and playback state", () => {
        const group = new AnimationGroup("group");
        const anim = new Animation("a", "position.x", 60);
        anim.setKeys([
            { frame: 0, value: 0 },
            { frame: 40, value: 1 },
        ]);
        group.addTargetedAnimation(anim, {});
        expect(group.to).toBe(40);
        expect(group.isPlaying).toBe(false);
        group.play();
        expect(group.isPlaying).toBe(true);
        expect(group.state).toBe("playing");
        group.pause();
        expect(group.state).toBe("paused");
        group.stop();
        expect(group.state).toBe("stopped");
    });
});
