/** InstancesBlock — picks between per-instance and uniform world matrix.
 *
 *  When instancing is enabled the pipeline builder wires `in.world0..world3`
 *  (4x vec4 attribute) and the block's output becomes the reconstructed mat4x4.
 *  Otherwise the output is the scene-provided uniform `_NME_WORLD_MATRIX_`.
 *
 *  The choice is made at pipeline-build time by reading serialized flag
 *  `isThinInstance` or by inspecting mesh metadata; for graph-walk purposes we
 *  always emit the sentinel, and the pipeline builder rewrites it.
 */

import type { BlockEmitter } from "../node-types.js";

export const emitter: BlockEmitter = {
    className: "InstancesBlock",
    stage: "vertex",
    emit(_block, _outputName, _stage, _state, _ctx) {
        return { expr: "_NME_WORLD_MATRIX_", type: "mat4f" };
    },
};
