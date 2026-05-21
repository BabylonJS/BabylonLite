import { addSpriteAnimation, createSpriteFrameAnimation } from "./sprite-animation.js";
import type { PlaySpriteAnimationOptions, SpriteAnimationManager, SpriteFrameAnimation } from "./sprite-animation.js";
import type { Sprite2DLayer } from "./sprite-2d.js";
import { removeSprite2DIndex, setSprite2DFrameIndex } from "./sprite-2d.js";

export function playSprite2DIndexAnimation(
    manager: SpriteAnimationManager,
    layer: Sprite2DLayer,
    index: number,
    from: number,
    to: number,
    loop: boolean,
    delayMs: number,
    options?: PlaySpriteAnimationOptions
): SpriteFrameAnimation {
    const animation = createSpriteFrameAnimation(
        {
            kind: "sprite2d-index",
            setFrame(frame): void {
                setSprite2DFrameIndex(layer, index, frame);
            },
            remove(): void {
                removeSprite2DIndex(layer, index);
            },
            isAlive(): boolean {
                return index >= 0 && index < layer.count;
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
