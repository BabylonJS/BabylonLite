/** KHR_animation_pointer — JSON-pointer resolver registry.
 *  Handlers are registered incrementally (one per parity scene). Unknown
 *  pointers return null and warn once. */
import type { SceneNode } from "../scene/scene-node.js";
import { setSubtreeVisible } from "../scene/visibility.js";

export interface ResolvedPointer {
    writer: (output: Float32Array, offset: number) => void;
    arity: number;
}

/** Minimal mutable view of a UV-transform texture slot the pointer writers drive.
 *  Mirrors the fields `material/pbr/fragments/uv-transform-fragment.ts` reads. */
export interface PointerUvTexture {
    uScale?: number;
    vScale?: number;
    uOffset?: number;
    vOffset?: number;
}

/** Minimal mutable view of a runtime material a pointer can animate. Bumping
 *  `_uboVersion` makes the renderable re-upload the material UBO next frame. */
export interface PointerMaterial {
    /** @internal */
    _uboVersion: number;
    baseColorTexture?: PointerUvTexture;
    emissiveTexture?: PointerUvTexture;
    normalTexture?: PointerUvTexture;
    ormTexture?: PointerUvTexture;
    specGlossTexture?: PointerUvTexture;
}

export interface PointerContext {
    nodes: readonly (SceneNode | undefined)[];
    /** Runtime materials indexed by glTF material index (built by the pointer feature). */
    materials?: readonly (PointerMaterial | undefined)[];
}

type PointerFactory = (match: RegExpExecArray, ctx: PointerContext) => ResolvedPointer | null;

// Maps a KHR_texture_transform pointer's texture-slot segment to the material field.
const TX_SLOT: Record<string, keyof PointerMaterial> = {
    "pbrMetallicRoughness/baseColorTexture": "baseColorTexture",
    emissiveTexture: "emissiveTexture",
    normalTexture: "normalTexture",
    occlusionTexture: "ormTexture",
    "pbrMetallicRoughness/metallicRoughnessTexture": "ormTexture",
};

const _registry: [RegExp, PointerFactory][] = [
    // /nodes/{n}/extensions/KHR_node_visibility/visible — scalar (0 = hidden).
    // The setter cascade handles descendants per the KHR_node_visibility spec
    // and bumps the module-scoped visibility epoch so the engine invalidates
    // its cached render bundle.
    [
        /^\/nodes\/(\d+)\/extensions\/KHR_node_visibility\/visible$/,
        (m, ctx) => {
            const n = ctx.nodes[+m[1]!];
            if (!n) {
                return null;
            }
            return {
                arity: 1,
                writer: (out, off) => {
                    setSubtreeVisible(n, out[off]! !== 0);
                },
            };
        },
    ],
    // /materials/{m}/.../KHR_texture_transform/{offset|scale} — animated UV scroll
    // (vec2). Mutates the slot texture's uOffset/vOffset (or uScale/vScale) and
    // bumps the material's UBO version so the renderable re-uploads the UV matrix.
    [
        /^\/materials\/(\d+)\/(pbrMetallicRoughness\/baseColorTexture|pbrMetallicRoughness\/metallicRoughnessTexture|emissiveTexture|normalTexture|occlusionTexture)\/extensions\/KHR_texture_transform\/(offset|scale)$/,
        (m, ctx) => {
            const mat = ctx.materials?.[+m[1]!];
            const tex = mat?.[TX_SLOT[m[2]!]!] as PointerUvTexture | undefined;
            if (!mat || !tex) {
                return null;
            }
            const isScale = m[3] === "scale";
            return {
                arity: 2,
                writer: (out, off) => {
                    if (isScale) {
                        tex.uScale = out[off]!;
                        tex.vScale = out[off + 1]!;
                    } else {
                        tex.uOffset = out[off]!;
                        tex.vOffset = out[off + 1]!;
                    }
                    mat._uboVersion++;
                },
            };
        },
    ],
];

const _warned = new Set<string>();

export function resolveAnimationPointer(pointer: string, ctx: PointerContext): ResolvedPointer | null {
    for (const [rx, make] of _registry) {
        const m = rx.exec(pointer);
        if (m) {
            return make(m, ctx);
        }
    }
    if (!_warned.has(pointer)) {
        _warned.add(pointer);

        console.warn(`[babylon-lite] KHR_animation_pointer: no handler for "${pointer}"`);
    }
    return null;
}
