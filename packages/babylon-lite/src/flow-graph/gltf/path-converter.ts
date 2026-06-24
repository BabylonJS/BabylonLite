// ⚠️ SPEC-VOLATILE — see object-model-mapping.ts. Mirrored against BJS commit
// 8f728b23ea. Re-sync against BJS PR #18455 when it lands.
//
// path-converter: resolves a (literal-substituted) JSON pointer string such as
// "/nodes/0/translation" to an FgAccessor (get/set closures) over the addressed
// scene node's TRS. The KHR_interactivity loader feeds the glTF `_nodeMap`
// (glTF-node-index → TransformNode) so accessors never hold a scene reference —
// they close over the resolved node only.
//
// LITE DIVERGENCE: BJS resolves pointers at RUNTIME via JsonPointerParser +
// gltfPathToObjectConverter. Lite pre-resolves them here at LOAD time, collapsing
// the JsonPointerParser/GetProperty/SetProperty trio into a single block reading
// a pre-resolved accessor. See blocks/data/{get,set}-property.ts.

import type { FgAccessor } from "../context.js";
import type { FgValue, Vec2 } from "../types.js";
import type { TransformNode } from "../../scene/transform-node.js";
import type { Quat, Vec3, Vec4 } from "../../math/types.js";
import { NODE_TRS_PROPS } from "./object-model-mapping.js";

/** Parse `/nodes/{index}/{prop}` → `{ nodeIndex, prop }`, or `null` when the
 *  pointer is not a supported node-TRS path. */
function parseNodeTrsPointer(pointer: string): { nodeIndex: number; prop: string } | null {
    const m = /^\/nodes\/(\d+)\/(translation|rotation|scale)$/.exec(pointer);
    if (!m) {
        return null;
    }
    return { nodeIndex: Number(m[1]), prop: m[2]! };
}

/** Resolve a literal-substituted JSON pointer to an `FgAccessor`, or `null` when
 *  it addresses an unsupported path or an unreachable node. */
export function resolvePointerAccessor(pointer: string, nodeMap: readonly (TransformNode | undefined)[]): FgAccessor | null {
    const parsed = parseNodeTrsPointer(pointer);
    if (!parsed) {
        return null;
    }
    const node = nodeMap[parsed.nodeIndex];
    if (!node) {
        return null;
    }
    const entry = NODE_TRS_PROPS[parsed.prop]!;

    if (parsed.prop === "translation") {
        return {
            type: entry.type,
            target: node,
            get: () => ({ x: node.position.x, y: node.position.y, z: node.position.z }),
            set: (v) => {
                const p = toVec3(v);
                node.position.set(p.x, p.y, p.z);
            },
        };
    }
    if (parsed.prop === "scale") {
        return {
            type: entry.type,
            target: node,
            get: () => ({ x: node.scaling.x, y: node.scaling.y, z: node.scaling.z }),
            set: (v) => {
                const p = toVec3(v);
                node.scaling.set(p.x, p.y, p.z);
            },
        };
    }
    // rotation (quaternion)
    return {
        type: entry.type,
        target: node,
        get: () => ({ x: node.rotationQuaternion.x, y: node.rotationQuaternion.y, z: node.rotationQuaternion.z, w: node.rotationQuaternion.w }),
        set: (v) => {
            const q = toQuat(v);
            node.rotationQuaternion.set(q.x, q.y, q.z, q.w);
        },
    };
}

function toVec3(v: FgValue): Vec3 {
    const o = (v ?? {}) as Partial<Vec3 & Vec2>;
    return { x: o.x ?? 0, y: o.y ?? 0, z: (o as Vec3).z ?? 0 };
}

function toQuat(v: FgValue): Quat {
    const o = (v ?? {}) as Partial<Vec4>;
    return { x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 0, w: o.w ?? 1 };
}
