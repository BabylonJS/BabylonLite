import type { SceneContext } from "../scene/scene-core.js";
import { addDeferredSceneRenderables } from "../scene/scene-core.js";
import type { BillboardSpriteSystem } from "./billboard-sprite.js";
import { buildBillboardRenderable } from "./billboard-renderable.js";

export function addFacingBillboardSystem(scene: SceneContext, system: BillboardSpriteSystem): void {
    addDeferredSceneRenderables(scene, (engine) => {
        const built = buildBillboardRenderable(engine, system);
        return { renderables: [built.renderable], dispose: built.dispose };
    });
}

export function addAxisLockedBillboardSystem(scene: SceneContext, system: BillboardSpriteSystem): void {
    addDeferredSceneRenderables(scene, (engine) => {
        const built = buildBillboardRenderable(engine, system);
        return { renderables: [built.renderable], dispose: built.dispose };
    });
}
