/** Standard Lightmap Fragment — additively blends lightmap into final color. */
import type { ShaderFragment } from "../../../shader/fragment-types.js";

const STAGE_FRAGMENT = 0x2;

export function createStdLightmapFragment(usesUV2: boolean): ShaderFragment {
    const uv = usesUV2 ? "input.vUV2" : "input.vUV";
    return {
        id: "std-lightmap",
        bindings: [
            { name: "lightmapTex", type: { kind: "texture", textureType: "texture_2d<f32>" }, visibility: STAGE_FRAGMENT },
            { name: "lightmapSampler", type: { kind: "sampler", samplerType: "sampler" }, visibility: STAGE_FRAGMENT },
        ],
        fragmentSlots: {
            BC: `color = vec4<f32>(color.rgb + textureSample(lightmapTex, lightmapSampler, ${uv}).rgb * mat.lmLvl, color.a);`,
        },
    };
}
