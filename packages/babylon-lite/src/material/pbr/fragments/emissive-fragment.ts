/**
 * Emissive Color Fragment
 *
 * Adds an emissiveColor vec3 uniform to MeshUniforms and uses it
 * in the fragment shader's emissive computation.
 *
 * Zero bytes in bundles for scenes that don't use emissive color.
 */

import type { ShaderFragment } from "../../../shader/fragment-types.js";

/**
 * Create an emissive-color fragment.
 * @param hasEmissiveTexture Whether the material also has an emissive texture.
 */
export function createEmissiveColorFragment(hasEmissiveTexture: boolean): ShaderFragment {
    return {
        id: "emissive-color",

        uboFields: [
            { name: "emissiveColor", type: "vec3<f32>" },
            { name: "_emissiveColorPad", type: "f32" },
        ],

        fragmentSlots: {
            AT: hasEmissiveTexture
                ? `let emissive = material.emissiveColor * textureSample(emissiveTexture, emissiveSampler, input.uv).rgb;`
                : `let emissive = material.emissiveColor;`,
        },
    };
}
