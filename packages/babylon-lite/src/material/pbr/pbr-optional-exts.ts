import type { createPbrTemplateExt } from "./pbr-template-ext.js";
import type * as AnisotropyFragment from "./fragments/anisotropy-fragment.js";
import { _registerPbrExt } from "./pbr-flags.js";
import type { PbrOptionalDeps, PbrOptionalFeatureFlags } from "./pbr-optional-flags.js";

export async function loadPbrOptionalExts(flags: PbrOptionalFeatureFlags): Promise<PbrOptionalDeps> {
    if (flags.hasMetallicReflectance) {
        const mod = await import("./fragments/reflectance-fragment.js");
        _registerPbrExt(mod.reflectanceExt);
    }
    if (flags.hasClearcoat) {
        const mod = await import("./fragments/clearcoat-fragment.js");
        _registerPbrExt(mod.clearcoatExt);
    }
    if (flags.hasSheen) {
        const mod = await import("./fragments/sheen-fragment.js");
        _registerPbrExt(mod.sheenExt);
    }
    if (flags.hasAnySubsurface) {
        const mod = await import("./fragments/subsurface-fragment.js");
        _registerPbrExt(mod.subsurfaceExt);
    }
    if (flags.hasRefraction) {
        const mod = await import("./fragments/refraction-fragment.js");
        _registerPbrExt(mod.refractionExt);
    }
    if (flags.hasSomeSkeletons) {
        const mod = await import("./fragments/skeleton-fragment.js");
        _registerPbrExt(mod.skeletonExt);
    }
    if (flags.hasSomeMorphs) {
        const mod = await import("./fragments/morph-fragment.js");
        _registerPbrExt(mod.morphExt);
    }
    if (flags.hasAnyUvTransform) {
        const mod = await import("./fragments/uv-transform-fragment.js");
        _registerPbrExt(mod.uvTransformExt);
    }

    let anisoExt: typeof AnisotropyFragment | null = null;
    if (flags.hasAnyAnisotropy) {
        anisoExt = await import("./fragments/anisotropy-fragment.js");
        _registerPbrExt(anisoExt.anisotropyExt);
    }

    let templateExt: typeof createPbrTemplateExt | null = null;
    if (flags.hasAnyUvTransform || flags.hasAnyVertexColor || flags.hasAnyUv2) {
        const extMod = await import("./pbr-template-ext.js");
        templateExt = extMod.createPbrTemplateExt;
    }

    return {
        anisoExt,
        createPbrTemplateExt: templateExt,
    };
}
