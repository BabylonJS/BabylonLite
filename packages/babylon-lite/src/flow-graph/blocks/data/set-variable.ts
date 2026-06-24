// SetVariable (BJS FlowGraphSetVariableBlock, glTF op `variable/set`).
// Execution block: writes `value` into the live graph variable named by
// `config.variable`, then fires `out`.

import type { FgBlockDef } from "../../block-def.js";
import { FgBlockType } from "../../block-type.js";
import { FgType } from "../../types.js";
import { activateSignal, getDataValue } from "../../runtime.js";
import { sigIn, sigOut, sockIn } from "../../sockets.js";

export const setVariableDef: FgBlockDef = {
    type: FgBlockType.SetVariable,
    build: () => ({
        dataIn: [sockIn("value", FgType.Any)],
        signalIn: [sigIn("in")],
        signalOut: [sigOut("out")],
    }),
    execute(block, ctx, env) {
        const name = block.config?.variable as string;
        if (name !== undefined) {
            ctx.userVariables[name] = getDataValue(ctx, env, block, "value");
        }
        activateSignal(ctx, env, block, "out");
    },
};
