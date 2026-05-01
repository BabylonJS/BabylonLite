/**
 * Default 1×1 fallback textures for PBR materials that don't sample the base color or
 * occlusion-roughness-metallic channels (e.g. `mode: "shadowOnly"` or `mode: "skybox"`).
 *
 * The PBR pipeline binding layout currently requires both `baseColorTexture` and
 * `ormTexture` to be present even when the active mode doesn't read them. Rather than
 * making every consumer provide solid 1×1 textures explicitly, we keep a module-level
 * lazy cache keyed by engine and let the pipeline fall back to these when the material
 * doesn't supply its own.
 *
 * One white-opaque base color and one (occlusion=1, roughness=1, metallic=0) ORM are
 * enough for every fallback case — the modes that fall back here ignore those samples
 * anyway, and the values produce neutral output if any code path inadvertently does
 * sample them.
 */

import type { EngineContext } from "../../engine/engine.js";
import type { Texture2D } from "../../texture/texture-2d.js";
import { createSolidTexture2D } from "../../texture/solid-texture.js";

const _baseColorCache = new WeakMap<EngineContext, Texture2D>();
const _ormCache = new WeakMap<EngineContext, Texture2D>();

/** Lazy 1×1 white-opaque baseColor used when a material doesn't provide one. */
export function getDefaultBaseColorTexture(engine: EngineContext): Texture2D {
    let tex = _baseColorCache.get(engine);
    if (!tex) {
        tex = createSolidTexture2D(engine, 1, 1, 1, 1);
        _baseColorCache.set(engine, tex);
    }
    return tex;
}

/** Lazy 1×1 (occ=1, rough=1, metal=0) ORM used when a material doesn't provide one. */
export function getDefaultOrmTexture(engine: EngineContext): Texture2D {
    let tex = _ormCache.get(engine);
    if (!tex) {
        tex = createSolidTexture2D(engine, 1, 1, 0, 1);
        _ormCache.set(engine, tex);
    }
    return tex;
}
