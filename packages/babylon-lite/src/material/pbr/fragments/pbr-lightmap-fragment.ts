/**
 * PBR Lightmap Fragment
 *
 * Applies a baked lightmap to the final linear HDR color, just before fog/tonemap
 * (matches BJS `pbrBlockFinalColorComposition`):
 *   - shadowmap (useLightmapAsShadowmap): color = (color - emissive) * lm + emissive
 *   - additive:                           color = color + lm
 * where `lm = pow(textureSample(lightmap, luv).rgb, 2.2) * lightmapLevel`.
 *
 * The .jpg lightmap is uploaded as rgba8unorm (srgb:false) and gamma-decoded in
 * the shader (always-on, matching BJS GAMMALIGHTMAP for the sRGB .jpg case).
 *
 * UVs come from TEXCOORD_1 (input.uv2) when sampling on UV2, with an optional
 * V-flip when the source BJS Texture has uAng === π (uv' = (u, 1 - v)).
 *
 * Dynamically imported + detection-gated — zero bytes for non-lightmap PBR scenes.
 */

import type { ShaderFragment, BindingDecl } from "../../../shader/fragment-types.js";
import type { PbrMaterialProps } from "../pbr-material.js";
import type { PbrExt } from "../pbr-flags.js";
import { PBR2_HAS_LIGHTMAP, PBR2_LIGHTMAP_SHADOWMAP, PBR2_LIGHTMAP_FLIP_V, PBR2_LIGHTMAP_UV2 } from "../pbr-flag-bits.js";

// WebGPU shader stage constant
const STAGE_FRAGMENT = 0x2;

/**
 * Create a lightmap fragment.
 * @param shadowmap - Use the lightmap as a shadowmap (multiply) instead of additive.
 * @param flipV - V-flip the lightmap UVs (BJS uAng === π).
 * @param useUv2 - Sample the lightmap on TEXCOORD_1 (UV2) instead of TEXCOORD_0.
 */
export function createLightmapFragment(shadowmap: boolean, flipV: boolean, useUv2: boolean): ShaderFragment {
    const bindings: BindingDecl[] = [
        { _name: "lightmapTexture_", _type: { _kind: "texture", _textureType: "texture_2d<f32>" }, _visibility: STAGE_FRAGMENT },
        { _name: "lightmapSampler_", _type: { _kind: "sampler", _samplerType: "sampler" }, _visibility: STAGE_FRAGMENT },
    ];

    const baseUv = useUv2 ? "input.uv2" : "input.uv";
    const luv = flipV ? `vec2<f32>(${baseUv}.x, 1.0 - ${baseUv}.y)` : baseUv;
    const apply = shadowmap ? `color = (color - emissive) * lm + emissive;` : `color = color + lm;`;

    return {
        _id: "lightmap",
        _uboFields: [{ _name: "lightmapLevel", _type: "f32" }],
        _bindings: bindings,
        _fragmentSlots: {
            LM: `{
let lm = pow(textureSample(lightmapTexture_, lightmapSampler_, ${luv}).rgb, vec3<f32>(2.2)) * material.lightmapLevel;
${apply}
}`,
        },
    };
}

/** Write the lightmap-extension material-UBO slice (lightmapLevel). */
export function writeLightmapUBO(data: Float32Array, material: PbrMaterialProps, offsets: ReadonlyMap<string, number>): void {
    if (!offsets.has("lightmapLevel")) {
        return;
    }
    data[offsets.get("lightmapLevel")! / 4] = material.lightmapLevel ?? 1.0;
}

/** The lightmap PBR extension (group 1, fragment phase). */
export const pbrExt: PbrExt = {
    id: "lightmap",
    phase: "fragment",
    frag(ctx) {
        if (!(ctx._features2 & PBR2_HAS_LIGHTMAP)) {
            return null;
        }
        return createLightmapFragment((ctx._features2 & PBR2_LIGHTMAP_SHADOWMAP) !== 0, (ctx._features2 & PBR2_LIGHTMAP_FLIP_V) !== 0, (ctx._features2 & PBR2_LIGHTMAP_UV2) !== 0);
    },
    writeUbo: writeLightmapUBO as PbrExt["writeUbo"],
    bind(ctx, entries, b) {
        if ((ctx._features2 & PBR2_HAS_LIGHTMAP) === 0) {
            return b;
        }
        const m = ctx._material as PbrMaterialProps;
        if (m.lightmapTexture) {
            entries.push({ binding: b++, resource: m.lightmapTexture.view });
            entries.push({ binding: b++, resource: m.lightmapTexture.sampler });
        }
        return b;
    },
    textures(mat, t) {
        const m = mat as PbrMaterialProps;
        if (m.lightmapTexture) {
            t.push(m.lightmapTexture);
        }
    },
};
