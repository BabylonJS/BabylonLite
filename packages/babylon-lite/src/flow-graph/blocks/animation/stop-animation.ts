// StopAnimation (BJS FlowGraphStopAnimationBlock, glTF op `animation/stop`).
// Execution block: stops an AnimationGroup resolved by glTF animation index,
// then fires `out` (or `error` when the index/capability is missing).

import type { FgBlockDef } from "../../block-def.js";
import { FgBlockType } from "../../block-type.js";
import { FgType } from "../../types.js";
import { activateSignal, getDataValue } from "../../runtime.js";
import { sigIn, sigOut, sockIn } from "../../sockets.js";

export const stopAnimationDef: FgBlockDef = {
    type: FgBlockType.StopAnimation,
    build: () => ({
        dataIn: [sockIn("animation", FgType.Integer)],
        signalIn: [sigIn("in")],
        signalOut: [sigOut("out"), sigOut("error")],
    }),
    execute(block, ctx, env) {
        const index = toIndex(getDataValue(ctx, env, block, "animation"));
        const group = index === undefined ? undefined : env.animations[index];
        if (group && env.caps.stopAnimation) {
            env.caps.stopAnimation(group);
            activateSignal(ctx, env, block, "out");
        } else {
            activateSignal(ctx, env, block, "error");
        }
    },
};

function toIndex(value: unknown): number | undefined {
    if (typeof value === "number") {
        return value | 0;
    }
    if (typeof value === "object" && value !== null && "value" in value) {
        return (value as { value: number }).value | 0;
    }
    return undefined;
}
