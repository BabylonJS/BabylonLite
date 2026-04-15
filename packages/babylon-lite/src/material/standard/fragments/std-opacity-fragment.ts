/** Standard Opacity Texture Fragment — modulates alpha by opacity texture. */
import type { ShaderFragment } from "../../../shader/fragment-types.js";

const STAGE_FRAGMENT = 0x2;

export function createStdOpacityFragment(fromRGB: boolean): ShaderFragment {
    const opacityCalc = fromRGB
        ? `{ let opSample = textureSample(opacityTex, opacitySampler, input.vUV); alpha *= dot(opSample.rgb, vec3<f32>(0.3, 0.59, 0.11)) * mat.opLvl; }`
        : `alpha *= textureSample(opacityTex, opacitySampler, input.vUV).a * mat.opLvl;`;
    return {
        id: "std-opacity",
        bindings: [
            { name: "opacityTex", type: { kind: "texture", textureType: "texture_2d<f32>" }, visibility: STAGE_FRAGMENT },
            { name: "opacitySampler", type: { kind: "sampler", samplerType: "sampler" }, visibility: STAGE_FRAGMENT },
        ],
        fragmentSlots: {
            AT: opacityCalc,
        },
    };
}
