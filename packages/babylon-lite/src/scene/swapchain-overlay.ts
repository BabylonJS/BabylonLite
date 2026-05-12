import type { EngineContextInternal, RenderingContext } from "../engine/engine.js";
import type { RenderTask } from "../frame-graph/render-task.js";
import type { SceneContextInternal } from "./scene-core.js";

function isSceneContext(context: RenderingContext): context is SceneContextInternal {
    return "_frameGraph" in context;
}

function getDefaultSwapchainTask(scene: SceneContextInternal): RenderTask | null {
    const task = scene._frameGraph._tasks[0];
    if (!task || !("_config" in task) || !("_colorAttachment" in task)) {
        return null;
    }
    const renderTask = task as RenderTask;
    return renderTask._config.rt.descriptor.resolveToSwapchain === true ? renderTask : null;
}

/** @internal Configure a later scene to preserve pixels already rendered into the same swapchain. */
export function configureSwapchainOverlayScene(engine: EngineContextInternal, overlay: SceneContextInternal): void {
    const base = engine._renderingContexts[engine._renderingContexts.length - 1];
    if (!base || !isSceneContext(base)) {
        return;
    }
    const baseTask = getDefaultSwapchainTask(base);
    const overlayTask = getDefaultSwapchainTask(overlay);
    if (!baseTask || !overlayTask) {
        return;
    }

    overlayTask._config.clr = false;
    overlay._beforeRender.unshift(() => {
        const view = baseTask._colorAttachment.view;
        if (engine.msaaSamples > 1 && view) {
            overlayTask._colorAttachment.view = view;
        }
    });
}
