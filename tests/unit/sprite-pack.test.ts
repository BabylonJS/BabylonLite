import { describe, it, expect } from "vitest";
import { createSpriteStorage, ensureCapacity, markDirty, swapRemove } from "../../packages/babylon-lite/src/sprite/shared/sprite-gpu";

describe("createSpriteStorage", () => {
    it("allocates capacity * stride floats with zero count", () => {
        const s = createSpriteStorage(8, 20);
        expect(s.data.length).toBe(160);
        expect(s.count).toBe(0);
        expect(s.capacity).toBe(8);
        expect(s.stride).toBe(20);
    });
});

describe("ensureCapacity", () => {
    it("returns false when the requested capacity already fits", () => {
        const s = createSpriteStorage(8, 4);
        expect(ensureCapacity(s, 8)).toBe(false);
        expect(s.capacity).toBe(8);
    });

    it("doubles capacity until the requested size fits and preserves data", () => {
        const s = createSpriteStorage(2, 2);
        s.data.set([1, 2, 3, 4]);
        s.count = 2;
        const grew = ensureCapacity(s, 5);
        expect(grew).toBe(true);
        expect(s.capacity).toBe(8);
        expect(Array.from(s.data.subarray(0, 4))).toEqual([1, 2, 3, 4]);
    });
});

describe("markDirty", () => {
    it("expands the dirty range and bumps version", () => {
        const s = createSpriteStorage(4, 1);
        const v0 = s.version;
        markDirty(s, 1, 3);
        expect(s.dirtyMin).toBe(1);
        expect(s.dirtyMax).toBe(3);
        markDirty(s, 0, 2);
        expect(s.dirtyMin).toBe(0);
        expect(s.dirtyMax).toBe(3);
        expect(s.version).toBe(v0 + 2);
    });
});

describe("swapRemove", () => {
    it("moves the last slot into the gap and decrements count", () => {
        const stride = 2;
        const s = createSpriteStorage(4, stride);
        s.data.set([10, 11, 20, 21, 30, 31, 40, 41]);
        s.count = 4;
        swapRemove(s, 1);
        expect(s.count).toBe(3);
        // index 1 now holds the former index 3 (the last).
        expect(Array.from(s.data.subarray(2, 4))).toEqual([40, 41]);
        // index 0 and 2 untouched.
        expect(Array.from(s.data.subarray(0, 2))).toEqual([10, 11]);
        expect(Array.from(s.data.subarray(4, 6))).toEqual([30, 31]);
    });

    it("simply pops when removing the last slot", () => {
        const stride = 1;
        const s = createSpriteStorage(2, stride);
        s.data.set([7, 8]);
        s.count = 2;
        swapRemove(s, 1);
        expect(s.count).toBe(1);
        expect(s.data[0]).toBe(7);
    });
});
