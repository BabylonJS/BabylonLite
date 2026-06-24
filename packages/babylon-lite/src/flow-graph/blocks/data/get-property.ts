// GetProperty (BJS FlowGraphGetPropertyBlock + JsonPointerParser, glTF op
// `pointer/get`). Data block (PULL): emits `value` read through a pre-resolved
// accessor.
//
// LITE DIVERGENCE: BJS resolves the JSON pointer at runtime via a separate
// JsonPointerParser block (object + propertyName + getter/setter). Lite's loader
// pre-resolves the pointer to an `FgAccessor` (get/set closures) at load time
// and stores it in `env.accessors`, keyed by `config.accessor`. So a single
// block reads via the accessor — the parser/path-converter owns pointer
// resolution. See flow-graph/gltf/path-converter.ts.

import type { FgBlockDef } from "../../block-def.js";
import { FgBlockType } from "../../block-type.js";
import { FgType } from "../../types.js";
import { setDataValue } from "../../runtime.js";
import { sockOut } from "../../sockets.js";

export const getPropertyDef: FgBlockDef = {
    type: FgBlockType.GetProperty,
    build: () => ({
        dataOut: [sockOut("value", FgType.Any)],
    }),
    updateOutputs(block, ctx, env) {
        const accessor = env.accessors[block.config?.accessor as string];
        setDataValue(ctx, block, "value", accessor ? accessor.get() : undefined);
    },
};
