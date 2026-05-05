/**
 * Default 1×1 fallback textures for PBR materials that don't sample the base color or
 * occlusion-roughness-metallic channels (e.g. `mode: "shadowOnly"` or `mode: "skybox"`).
 *
 * The PBR pipeline binding layout requires both `baseColorTexture` and `ormTexture` to
 * be present even when the active mode doesn't read them. `buildPbrRenderables` calls
 * {@link populatePbrDefaultTextures} (via dynamic-import) only for scenes that contain
 * a shadow-only or skybox material, so static-only PBR scenes never load this module
 * and pay zero bundle cost for it.
 *
 * One white-opaque base color and one (occlusion=1, roughness=1, metallic=0) ORM are
 * enough for every fallback case — the modes that fall back here ignore those samples
 * anyway, and the values produce neutral output if any code path inadvertently does
 * sample them.
 *
 * Caches are lazy-initialized per GUIDANCE §4 — module-level `new WeakMap()` would
 * count as a side effect and prevent tree-shaking even when nothing imports this module.
 */

import type { EngineContext } from "../../engine/engine.js";
import type { Texture2D } from "../../texture/texture-2d.js";
import type { Mesh } from "../../mesh/mesh.js";
import type { PbrMaterialPropsInternal } from "./pbr-material.js";
import { createSolidTexture2D } from "../../texture/solid-texture.js";

let _baseColorCache: WeakMap<EngineContext, Texture2D> | null = null;
let _ormCache: WeakMap<EngineContext, Texture2D> | null = null;

/** Lazy 1×1 white-opaque baseColor used when a material doesn't provide one. */
function getDefaultBaseColorTexture(engine: EngineContext): Texture2D {
    const cache = (_baseColorCache ??= new WeakMap());
    let tex = cache.get(engine);
    if (!tex) {
        tex = createSolidTexture2D(engine, 1, 1, 1, 1);
        cache.set(engine, tex);
    }
    return tex;
}

/** Lazy 1×1 (occ=1, rough=1, metal=0) ORM used when a material doesn't provide one. */
function getDefaultOrmTexture(engine: EngineContext): Texture2D {
    const cache = (_ormCache ??= new WeakMap());
    let tex = cache.get(engine);
    if (!tex) {
        tex = createSolidTexture2D(engine, 1, 1, 0, 1);
        cache.set(engine, tex);
    }
    return tex;
}

/** Fill in `baseColorTexture` / `ormTexture` for every shadow-only / skybox mesh that
 *  hasn't supplied its own. The loop lives here (in the dynamic-imported chunk) so the
 *  static `pbr-renderable` bundle only contains the gated dynamic-import call. */
export function populatePbrDefaultTextures(engine: EngineContext, meshes: readonly Mesh[]): void {
    for (const m of meshes) {
        const mat = m.material as PbrMaterialPropsInternal;
        if (mat.mode === "shadowOnly" || mat.mode === "skybox") {
            if (!mat.baseColorTexture) {
                mat.baseColorTexture = getDefaultBaseColorTexture(engine);
            }
            if (!mat.ormTexture) {
                mat.ormTexture = getDefaultOrmTexture(engine);
            }
        }
    }
}
