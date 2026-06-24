// OnSelect (glTF op `event/onSelect`, extension `KHR_node_selectability`).
// Event block: fires when its configured node (`config.nodeIndex`) is picked.
// The picking/input layer pumps the Pointer channel with `{ nodeIndex,
// controllerIndex }`; this block fires `out`/`done` only when the payload's
// node matches its own. With no picking wired (e.g. an onStart-only demo) it
// stays inert.
//
// ⚠️ SPEC-VOLATILE — KHR_node_selectability is an UNRATIFIED draft; re-sync the
// output sockets against BJS PR #18455 when it lands. The Calculator sample
// reads none of onSelect's value outputs, so they are best-effort.

import type { FgBlockDef } from "../../block-def.js";
import { FgBlockType } from "../../block-type.js";
import { FgType } from "../../types.js";
import { FgEventType } from "../../event-bus.js";
import { fgInt } from "../../custom-types/fg-integer.js";
import { activateSignal, getExecVar, setDataValue } from "../../runtime.js";
import { sigOut, sockOut } from "../../sockets.js";

interface SelectPayload {
    nodeIndex?: number;
    controllerIndex?: number;
}

export const onSelectDef: FgBlockDef = {
    type: FgBlockType.OnSelect,
    build: () => ({
        dataOut: [sockOut("selectedNodeIndex", FgType.Integer), sockOut("controllerIndex", FgType.Integer)],
        signalOut: [sigOut("out"), sigOut("done")],
        event: FgEventType.Pointer,
    }),
    execute(block, ctx, env) {
        const payload = getExecVar<SelectPayload | undefined>(ctx, block, "lastEvent", undefined);
        const target = block.config?.nodeIndex as number | undefined;
        if (!payload || payload.nodeIndex !== target) {
            return;
        }
        setDataValue(ctx, block, "selectedNodeIndex", fgInt(payload.nodeIndex ?? -1));
        setDataValue(ctx, block, "controllerIndex", fgInt(payload.controllerIndex ?? 0));
        activateSignal(ctx, env, block, "done");
        activateSignal(ctx, env, block, "out");
    },
};
