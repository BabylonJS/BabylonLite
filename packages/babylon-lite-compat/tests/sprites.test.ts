import { describe, expect, it } from "vitest";

import { Sprite, SpriteManager } from "../src/sprites/sprites";

/**
 * GPU-free coverage for the sprite wrappers. `SpriteManager` needs a real engine
 * + atlas load (GPU), so only the `Sprite` value surface and its registration
 * against a manager are unit-tested here; the full billboard render is covered by
 * the lab compat-parity scenes (54/55/59/94/95).
 */
describe("Sprite", () => {
    it("exposes Babylon.js default sprite properties", () => {
        const fakeManager = { _sprites: [] } as unknown as SpriteManager;
        const sprite = new Sprite("s", fakeManager);
        expect(sprite.name).toBe("s");
        expect(sprite.cellIndex).toBe(0);
        expect(sprite.width).toBe(1);
        expect(sprite.height).toBe(1);
        expect(sprite.angle).toBe(0);
        expect(sprite.invertU).toBe(false);
        expect(sprite.invertV).toBe(false);
        expect(sprite.isVisible).toBe(true);
        expect(sprite.color.a).toBe(1);
    });

    it("registers itself with its manager in creation order", () => {
        const fakeManager = { _sprites: [] } as unknown as SpriteManager;
        const a = new Sprite("a", fakeManager);
        const b = new Sprite("b", fakeManager);
        expect(fakeManager._sprites).toEqual([a, b]);
    });

    it("holds mutated world-space props for the deferred billboard build", () => {
        const fakeManager = { _sprites: [] } as unknown as SpriteManager;
        const sprite = new Sprite("s", fakeManager);
        sprite.position.set(1, 2, 3);
        sprite.width = 2;
        sprite.height = 4;
        sprite.cellIndex = 7;
        sprite.invertU = true;
        expect(sprite.position.x).toBe(1);
        expect(sprite.position.z).toBe(3);
        expect(sprite.width).toBe(2);
        expect(sprite.height).toBe(4);
        expect(sprite.cellIndex).toBe(7);
        expect(sprite.invertU).toBe(true);
    });
});
