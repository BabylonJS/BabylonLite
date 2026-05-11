import type { SceneContext } from "../scene/scene-core.js";
import { addDeferredSceneRenderables } from "../scene/scene-core.js";
import type { BillboardSpriteSystem } from "./billboard-sprite.js";
import { buildBillboardRenderable } from "./billboard-renderable.js";

function addBillboardSystem(scene: SceneContext, system: BillboardSpriteSystem): void {
    addDeferredSceneRenderables(scene, (engine) => {
        const built = buildBillboardRenderable(engine, system);
        return { renderables: [built.renderable], dispose: built.dispose };
    });
}

export { addBillboardSystem as addFacingBillboardSystem, addBillboardSystem as addAxisLockedBillboardSystem };
