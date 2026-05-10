import type * as AnisotropyFragment from "./fragments/anisotropy-fragment.js";
import type { createPbrTemplateExt } from "./pbr-template-ext.js";

export interface PbrOptionalFeatureFlags {
    readonly hasMetallicReflectance: boolean;
    readonly hasClearcoat: boolean;
    readonly hasSheen: boolean;
    readonly hasAnyAnisotropy: boolean;
    readonly hasAnySubsurface: boolean;
    readonly hasRefraction: boolean;
    readonly hasSomeSkeletons: boolean;
    readonly hasSomeMorphs: boolean;
    readonly hasAnyUvTransform: boolean;
    readonly hasAnyUv2: boolean;
    readonly hasAnyVertexColor: boolean;
}

export interface PbrOptionalDeps {
    readonly anisoExt: typeof AnisotropyFragment | null;
    readonly createPbrTemplateExt: typeof createPbrTemplateExt | null;
}

export function hasPbrOptionalFeature(flags: PbrOptionalFeatureFlags): boolean {
    return (
        flags.hasMetallicReflectance ||
        flags.hasClearcoat ||
        flags.hasSheen ||
        flags.hasAnyAnisotropy ||
        flags.hasAnySubsurface ||
        flags.hasRefraction ||
        flags.hasSomeSkeletons ||
        flags.hasSomeMorphs ||
        flags.hasAnyUvTransform ||
        flags.hasAnyUv2 ||
        flags.hasAnyVertexColor
    );
}
