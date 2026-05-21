import { addSpriteAnimation, createSpriteFrameAnimation } from "./sprite-animation.js";
import type { PlaySpriteAnimationOptions, SpriteAnimationManager, SpriteFrameAnimation } from "./sprite-animation.js";
import type { Sprite2DHandle } from "./sprite-2d-handle.js";
import { isSprite2DHandleAlive, removeSprite2D, setSprite2DFrame } from "./sprite-2d-handle.js";

export function playSprite2DAnimation(
    manager: SpriteAnimationManager,
    handle: Sprite2DHandle,
    from: number,
    to: number,
    loop: boolean,
    delayMs: number,
    options?: PlaySpriteAnimationOptions
): SpriteFrameAnimation {
    const animation = createSpriteFrameAnimation(
        {
            kind: "sprite2d-handle",
            setFrame(frame): void {
                setSprite2DFrame(handle, frame);
            },
            remove(): void {
                removeSprite2D(handle);
            },
            isAlive(): boolean {
                return isSprite2DHandleAlive(handle);
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
