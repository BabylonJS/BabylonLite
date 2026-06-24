// ⚠️ SPEC-VOLATILE — see object-model-mapping.ts. Mirrored against BJS commit
// 8f728b23ea. Re-sync against BJS PR #18455 when it lands.
//
// path-converter: resolves a (literal-substituted) JSON pointer string such as
// "/nodes/0/translation" to an FgAccessor (get/set closures) over the addressed
// object. The KHR_interactivity loader feeds the glTF node map + runtime material
// map so accessors never hold a scene reference — they close over the resolved
// node/material only.
//
// DRY: material UV-transform and node-visibility WRITES delegate to the shared
// KHR_animation_pointer resolver (`resolveAnimationPointer`), which already owns
// the tricky per-texture isolation (so two materials sharing one atlas texture
// don't clobber each other) and the UBO/visibility-epoch invalidation. Pointer
// GETs read the runtime fields directly (the animation registry is write-only).
//
// LITE DIVERGENCE: BJS resolves pointers at RUNTIME via JsonPointerParser +
// gltfPathToObjectConverter. Lite pre-resolves them here at LOAD time, collapsing
// the JsonPointerParser/GetProperty/SetProperty trio into a single block reading
// a pre-resolved accessor. See blocks/data/{get,set}-property.ts.

import type { FgAccessor } from "../context.js";
import type { FgValue, Vec2 } from "../types.js";
import { FgType } from "../types.js";
import type { TransformNode } from "../../scene/transform-node.js";
import type { Quat, Vec3, Vec4 } from "../../math/types.js";
import { NODE_TRS_PROPS } from "./object-model-mapping.js";
import { resolveAnimationPointer, type PointerContext, type PointerMaterial } from "../../loader-gltf/animation-pointer.js";

/** Loader-supplied resolution context: the glTF node map plus the runtime
 *  material map (glTF material index → PBR material) and raw JSON for reuse of
 *  the KHR_animation_pointer writers. */
export interface PointerResolveContext {
    nodeMap: readonly (TransformNode | undefined)[];
    materials?: readonly (PointerMaterial | undefined)[];
    json?: object;
}

/** Build the PointerContext the animation-pointer registry expects. */
function animCtx(ctx: PointerResolveContext): PointerContext {
    return { nodes: ctx.nodeMap as PointerContext["nodes"], materials: ctx.materials, _json: ctx.json };
}

/** Parse `/nodes/{index}/{prop}` → `{ nodeIndex, prop }`, or `null` when the
 *  pointer is not a supported node-TRS path. */
function parseNodeTrsPointer(pointer: string): { nodeIndex: number; prop: string } | null {
    const m = /^\/nodes\/(\d+)\/(translation|rotation|scale)$/.exec(pointer);
    if (!m) {
        return null;
    }
    return { nodeIndex: Number(m[1]), prop: m[2]! };
}

const MAT_UV_RE =
    /^\/materials\/(\d+)\/(?:pbrMetallicRoughness\/baseColorTexture|emissiveTexture|normalTexture|occlusionTexture)\/extensions\/KHR_texture_transform\/(offset|scale)$/;
const VISIBILITY_RE = /^\/nodes\/(\d+)\/extensions\/KHR_node_visibility\/visible$/;
const SELECTABILITY_RE = /^\/nodes\/(\d+)\/extensions\/KHR_node_selectability\/selectable$/;

/** Resolve a literal-substituted JSON pointer to an `FgAccessor`, or `null` when
 *  it addresses an unsupported path or an unreachable node/material. */
export function resolvePointerAccessor(pointer: string, ctx: PointerResolveContext): FgAccessor | null {
    const trs = parseNodeTrsPointer(pointer);
    if (trs) {
        return resolveNodeTrs(trs.nodeIndex, trs.prop, ctx);
    }

    const uv = MAT_UV_RE.exec(pointer);
    if (uv) {
        return resolveMaterialUvTransform(pointer, Number(uv[1]), uv[2]!, ctx);
    }

    const vis = VISIBILITY_RE.exec(pointer);
    if (vis) {
        return resolveVisibility(pointer, Number(vis[1]), ctx);
    }

    const sel = SELECTABILITY_RE.exec(pointer);
    if (sel) {
        return resolveSelectability(Number(sel[1]), ctx);
    }

    return null;
}

function resolveNodeTrs(nodeIndex: number, prop: string, ctx: PointerResolveContext): FgAccessor | null {
    const node = ctx.nodeMap[nodeIndex];
    if (!node) {
        return null;
    }
    const entry = NODE_TRS_PROPS[prop]!;

    if (prop === "translation") {
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
    if (prop === "scale") {
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

/** Material `KHR_texture_transform` offset/scale (Vec2). WRITES reuse the shared
 *  animation-pointer writer (per-texture isolation + UBO bump); READS sample the
 *  runtime baseColorTexture's UV fields directly. */
function resolveMaterialUvTransform(pointer: string, matIndex: number, kind: string, ctx: PointerResolveContext): FgAccessor | null {
    const mat = ctx.materials?.[matIndex];
    if (!mat) {
        return null;
    }
    const resolved = resolveAnimationPointer(pointer, animCtx(ctx));
    return {
        type: FgType.Vector2,
        target: mat,
        get: () => {
            const tex = mat.baseColorTexture;
            if (kind === "scale") {
                return { x: tex?.uScale ?? 1, y: tex?.vScale ?? 1 };
            }
            return { x: tex?.uOffset ?? 0, y: tex?.vOffset ?? 0 };
        },
        set: resolved
            ? (v) => {
                  const p = toVec2(v);
                  resolved.writer(Float32Array.of(p.x, p.y), 0);
              }
            : undefined,
    };
}

/** `KHR_node_visibility/visible` (boolean). WRITES reuse the shared
 *  animation-pointer writer (subtree cascade + visibility-epoch bump). */
function resolveVisibility(pointer: string, nodeIndex: number, ctx: PointerResolveContext): FgAccessor | null {
    const node = ctx.nodeMap[nodeIndex];
    if (!node) {
        return null;
    }
    const resolved = resolveAnimationPointer(pointer, animCtx(ctx));
    return {
        type: FgType.Boolean,
        target: node,
        get: () => node.visible !== false,
        set: resolved
            ? (v) => {
                  resolved.writer(Float32Array.of(v ? 1 : 0), 0);
              }
            : undefined,
    };
}

/** `KHR_node_selectability/selectable` (boolean). Lite has no picking gate, so
 *  this is a no-op accessor: the value round-trips but has no visual effect. */
function resolveSelectability(nodeIndex: number, ctx: PointerResolveContext): FgAccessor | null {
    const node = ctx.nodeMap[nodeIndex];
    if (!node) {
        return null;
    }
    let selectable = true;
    return {
        type: FgType.Boolean,
        target: node,
        get: () => selectable,
        set: (v) => {
            selectable = !!v;
        },
    };
}

function toVec2(v: FgValue): Vec2 {
    const o = (v ?? {}) as Partial<Vec2>;
    return { x: o.x ?? 0, y: o.y ?? 0 };
}

function toVec3(v: FgValue): Vec3 {
    const o = (v ?? {}) as Partial<Vec3 & Vec2>;
    return { x: o.x ?? 0, y: o.y ?? 0, z: (o as Vec3).z ?? 0 };
}

function toQuat(v: FgValue): Quat {
    const o = (v ?? {}) as Partial<Vec4>;
    return { x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 0, w: o.w ?? 1 };
}
