import { addSpriteAnimation, createSpriteFrameAnimation } from "./sprite-animation.js";
import type { PlaySpriteAnimationOptions, SpriteAnimationManager, SpriteFrameAnimation } from "./sprite-animation.js";
import type { BillboardSpriteSystem } from "./billboard-sprite.js";
import { removeBillboardSpriteIndex, setBillboardSpriteFrameIndex } from "./billboard-sprite.js";

export function playBillboardSpriteIndexAnimation(
    manager: SpriteAnimationManager,
    system: BillboardSpriteSystem,
    index: number,
    from: number,
    to: number,
    loop: boolean,
    delayMs: number,
    options?: PlaySpriteAnimationOptions
): SpriteFrameAnimation {
    const animation = createSpriteFrameAnimation(
        {
            kind: "billboard-index",
            setFrame(frame): void {
                setBillboardSpriteFrameIndex(system, index, frame);
            },
            remove(): void {
                removeBillboardSpriteIndex(system, index);
            },
            isAlive(): boolean {
                return index >= 0 && index < system.count;
            },
        },
        from,
        to,
        loop,
        delayMs,
        options
    );
    addSpriteAnimation(manager, animation);
    return animation;
}
