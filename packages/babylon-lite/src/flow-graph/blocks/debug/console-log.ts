// ConsoleLog (BJS FlowGraphConsoleLogBlock, glTF op `flow/log` in the BABYLON
// extension). Execution block: logs `message` to the console, then fires `out`.

import type { FgBlockDef } from "../../block-def.js";
import { FgBlockType } from "../../block-type.js";
import { FgType } from "../../types.js";
import { activateSignal, getDataValue } from "../../runtime.js";
import { sigIn, sigOut, sockIn } from "../../sockets.js";

export const consoleLogDef: FgBlockDef = {
    type: FgBlockType.ConsoleLog,
    build: () => ({
        dataIn: [sockIn("message", FgType.Any)],
        signalIn: [sigIn("in")],
        signalOut: [sigOut("out")],
    }),
    execute(block, ctx, env) {
        // eslint-disable-next-line no-console
        console.log(getDataValue(ctx, env, block, "message"));
        activateSignal(ctx, env, block, "out");
    },
};
