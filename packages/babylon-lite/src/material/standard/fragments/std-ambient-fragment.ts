/** Standard Ambient Texture Fragment — multiplies final diffuse by ambient occlusion texture. */
import type { ShaderFragment } from "../../../shader/fragment-types.js";

const STAGE_FRAGMENT = 0x2;

export function createStdAmbientFragment(usesUV2: boolean): ShaderFragment {
    const uv = usesUV2 ? "input.vUV2" : "input.vUV";
    return {
        id: "std-ambient",
        bindings: [
            { name: "ambientTex", type: { kind: "texture", textureType: "texture_2d<f32>" }, visibility: STAGE_FRAGMENT },
            { name: "ambientSampler", type: { kind: "sampler", samplerType: "sampler" }, visibility: STAGE_FRAGMENT },
        ],
        fragmentSlots: {
            AD: `baseAmbientColor = textureSample(ambientTex, ambientSampler, ${uv}).rgb * mat.ambTexLvl;`,
        },
    };
}
