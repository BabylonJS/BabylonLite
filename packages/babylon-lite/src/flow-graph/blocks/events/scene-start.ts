// SceneStart (BJS FlowGraphSceneReadyEventBlock, glTF op `event/onStart`).
// Event block: fires once when the graph starts. The runtime's startFlowGraph
// invokes `execute` after all non-start receivers are subscribed.
//
// BJS event blocks fire BOTH `done` (KHR_interactivity graphs wire to this) and
// `out` (editor graphs) — we replicate that so either wiring style works.

import type { FgBlockDef } from "../../block-def.js";
import { FgBlockType } from "../../block-type.js";
import { FgEventType } from "../../event-bus.js";
import { activateSignal } from "../../runtime.js";
import { sigOut } from "../../sockets.js";

export const sceneStartDef: FgBlockDef = {
    type: FgBlockType.SceneStart,
    build: () => ({
        signalOut: [sigOut("out"), sigOut("done")],
        event: FgEventType.Start,
    }),
    execute(block, ctx, env) {
        activateSignal(ctx, env, block, "done");
        activateSignal(ctx, env, block, "out");
    },
};
