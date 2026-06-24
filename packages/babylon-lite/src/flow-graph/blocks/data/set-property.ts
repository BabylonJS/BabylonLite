// SetProperty (BJS FlowGraphSetPropertyBlock + JsonPointerParser, glTF op
// `pointer/set`). Execution block: writes `value` through a pre-resolved
// accessor, then fires `out` (or `error` when the accessor is missing /
// read-only).
//
// LITE DIVERGENCE: see get-property.ts — pointer resolution happens in the
// loader, not at runtime; the block writes via `env.accessors[config.accessor]`.

import type { FgBlockDef } from "../../block-def.js";
import { FgBlockType } from "../../block-type.js";
import { FgType } from "../../types.js";
import { activateSignal, getDataValue } from "../../runtime.js";
import { sigIn, sigOut, sockIn } from "../../sockets.js";

export const setPropertyDef: FgBlockDef = {
    type: FgBlockType.SetProperty,
    build: () => ({
        dataIn: [sockIn("value", FgType.Any)],
        signalIn: [sigIn("in")],
        signalOut: [sigOut("out"), sigOut("error")],
    }),
    execute(block, ctx, env) {
        const accessor = env.accessors[block.config?.accessor as string];
        if (accessor?.set) {
            accessor.set(getDataValue(ctx, env, block, "value"));
            activateSignal(ctx, env, block, "out");
        } else {
            activateSignal(ctx, env, block, "error");
        }
    },
};
