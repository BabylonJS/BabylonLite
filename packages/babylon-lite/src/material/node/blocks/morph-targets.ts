/** MorphTargetsBlock — applies morph-target deltas to position/normal/tangent.
 *
 *  Inputs: position, normal, tangent, uv.
 *  Outputs: positionOutput, normalOutput, tangentOutput, uvOutput.
 *
 *  The pipeline builder is responsible for sampling the morph-target texture
 *  atlas (if any) and injecting the `_NME_MORPH_APPLY_*` sentinels. We emit a
 *  call per output so the pipeline can substitute.
 */

import type { BlockEmitter, NodeExpr } from "../node-types.js";

export const emitter: BlockEmitter = {
    className: "MorphTargetsBlock",
    stage: "vertex",
    emit(block, outputName, stage, state, ctx) {
        const kind = outputName.replace(/Output$/, ""); // position, normal, tangent, uv
        const inputName = kind;
        const input = block.inputs.get(inputName);
        if (!input?.source) {
            // Pass-through: no source means the attribute isn't connected, so emit zero.
            return { expr: "vec4<f32>(0.0)", type: "vec4f" };
        }
        const v = ctx.resolve(block, inputName, stage, state);
        // Emit a sentinel call — pipeline builder substitutes with either a
        // no-op (no morphs) or a morph accumulation loop.
        return { expr: `_NME_MORPH_APPLY_${kind.toUpperCase()}(${v.expr})`, type: v.type } as NodeExpr;
    },
};
