import { addSpriteAnimation, createSpriteFrameAnimation } from "./sprite-animation.js";
import type { PlaySpriteAnimationOptions, SpriteAnimationManager, SpriteFrameAnimation } from "./sprite-animation.js";
import type { BillboardSpriteHandle } from "./billboard-sprite-handle.js";
import { isBillboardSpriteHandleAlive, removeBillboardSprite, setBillboardSpriteFrame } from "./billboard-sprite-handle.js";

export function playBillboardSpriteAnimation(
    manager: SpriteAnimationManager,
    handle: BillboardSpriteHandle,
    from: number,
    to: number,
    loop: boolean,
    delayMs: number,
    options?: PlaySpriteAnimationOptions
): SpriteFrameAnimation {
    const animation = createSpriteFrameAnimation(
        {
            kind: "billboard-handle",
            setFrame(frame): void {
                setBillboardSpriteFrame(handle, frame);
            },
            remove(): void {
                removeBillboardSprite(handle);
            },
            isAlive(): boolean {
                return isBillboardSpriteHandleAlive(handle);
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
