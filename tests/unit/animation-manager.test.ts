import { describe, expect, it } from "vitest";

import {
    createAnimationManager,
    createPropertyAnimationClip,
    createPropertyAnimationGroup,
    updateAnimationManager,
} from "../../packages/babylon-lite/src/animation/animation-manager";
import { goToFrame } from "../../packages/babylon-lite/src/animation/animation-group";

describe("AnimationManager", () => {
    it("updates a Babylon-style position.x frame animation without a scene or engine", () => {
        const manager = createAnimationManager();
        const target = { position: { x: 2 } };
        const clip = createPropertyAnimationClip("xSlide", [
            {
                path: "position.x",
                frameRate: 10,
                keys: [
                    { frame: 0, value: 2 },
                    { frame: 10, value: -2 },
                    { frame: 20, value: 2 },
                ],
            },
        ]);

        const group = createPropertyAnimationGroup(manager, target, clip, { fromFrame: 0, toFrame: 20, loop: true });

        updateAnimationManager(manager, 0);
        expect(target.position.x).toBe(2);

        updateAnimationManager(manager, 1000);
        expect(target.position.x).toBe(-2);

        goToFrame(group, 10);
        expect(target.position.x).toBe(-2);

        goToFrame(group, 0);
        expect(target.position.x).toBe(2);

        updateAnimationManager(manager, 1000);
        expect(target.position.x).toBe(2);
    });

    it("writes vector tracks through set() bindings", () => {
        const manager = createAnimationManager();
        const target = {
            position: {
                x: 0,
                y: 0,
                z: 0,
                set(x: number, y: number, z: number): void {
                    this.x = x;
                    this.y = y;
                    this.z = z;
                },
            },
        };
        const clip = createPropertyAnimationClip("move", [
            {
                path: "position",
                keys: [
                    { time: 0, value: [0, 0, 0] },
                    { time: 1, value: [2, 4, 6] },
                ],
            },
        ]);

        createPropertyAnimationGroup(manager, target, clip, { loop: false });
        updateAnimationManager(manager, 500);

        expect(target.position.x).toBeCloseTo(1);
        expect(target.position.y).toBeCloseTo(2);
        expect(target.position.z).toBeCloseTo(3);
    });

    it("supports STEP interpolation with second-based keyframes", () => {
        const manager = createAnimationManager();
        const target = { position: { x: -1 } };
        const clip = createPropertyAnimationClip("step", [
            {
                path: "position.x",
                interpolation: "step",
                keys: [
                    { time: 0, value: -1 },
                    { time: 1, value: 1 },
                    { time: 2, value: 3 },
                ],
            },
        ]);

        createPropertyAnimationGroup(manager, target, clip, { loop: false });
        updateAnimationManager(manager, 500);
        expect(target.position.x).toBe(-1);

        updateAnimationManager(manager, 600);
        expect(target.position.x).toBe(1);

        updateAnimationManager(manager, 2000);
        expect(target.position.x).toBe(3);
    });

    it("throws when a property path cannot be resolved", () => {
        const manager = createAnimationManager();
        const clip = createPropertyAnimationClip("bad", [
            {
                path: "position.q",
                keys: [
                    { time: 0, value: 0 },
                    { time: 1, value: 1 },
                ],
            },
        ]);

        expect(() => createPropertyAnimationGroup(manager, { position: { x: 0 } }, clip)).toThrow(/position\.q/);
    });
});
