// Scene attachment for flow-graph runtimes. Byte-neutral for non-interactivity
// scenes: this module is only pulled into a bundle when something imports it
// (the glTF KHR_interactivity feature, or explicit user code). It drives graphs
// through the scene's generic `onBeforeRender` / `onSceneDispose` seams instead
// of hardcoding a loop in scene-core (GUIDANCE §4c′ — always extensions).

import { onBeforeRender, onSceneDispose, type SceneContext } from "../scene/scene-core.js";
import type { FgRuntime } from "./runtime.js";
import { disposeFlowGraph, startFlowGraph, tickFlowGraph } from "./runtime.js";

/** Attach a flow-graph runtime to a scene. The runtime starts on the first
 *  frame (after which event listeners are live) and ticks every frame. The
 *  runtime is auto-disposed when the scene is disposed. */
export function attachFlowGraph(scene: SceneContext, rt: FgRuntime): void {
    let list = scene._flowGraphs;
    if (!list) {
        list = [];
        scene._flowGraphs = list;
    }
    list.push(rt);

    onBeforeRender(scene, (deltaMs: number) => {
        // Early-out if detached (the closure persists until scene dispose).
        if (!scene._flowGraphs || scene._flowGraphs.indexOf(rt) < 0) {
            return;
        }
        if (!rt.started) {
            startFlowGraph(rt);
        }
        tickFlowGraph(rt, deltaMs);
    });

    onSceneDispose(scene, () => detachFlowGraph(scene, rt));
}

/** Detach and dispose a flow-graph runtime previously attached to `scene`. */
export function detachFlowGraph(scene: SceneContext, rt: FgRuntime): void {
    const list = scene._flowGraphs;
    if (list) {
        const i = list.indexOf(rt);
        if (i >= 0) {
            list.splice(i, 1);
        }
    }
    disposeFlowGraph(rt);
}
