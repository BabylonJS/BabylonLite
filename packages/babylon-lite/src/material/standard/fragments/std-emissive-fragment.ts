/** Standard Emissive Texture Fragment — multiplies emissive contribution by texture sample. */
import type { ShaderFragment } from "../../../shader/fragment-types.js";

const STAGE_FRAGMENT = 0x2;

export function createStdEmissiveFragment(): ShaderFragment {
    return {
        id: "std-emissive",
        bindings: [
            { name: "emissiveTex", type: { kind: "texture", textureType: "texture_2d<f32>" }, visibility: STAGE_FRAGMENT },
            { name: "emissiveSampler", type: { kind: "sampler", samplerType: "sampler" }, visibility: STAGE_FRAGMENT },
        ],
        fragmentSlots: {
            AT: `emissiveContrib = mat.ec * textureSample(emissiveTex, emissiveSampler, input.vUV).rgb * mat.tl;`,
        },
    };
}
