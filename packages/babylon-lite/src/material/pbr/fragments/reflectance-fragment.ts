/**
 * Metallic Reflectance Fragment
 *
 * Advanced F0 computation with metallicReflectanceTexture and/or reflectanceTexture.
 * Only bundled when a scene uses these textures.
 *
 * Provides: UBO fields (occlusionStrength, metallicF0Factor, metallicReflectanceColor),
 * conditional texture bindings, F0 computation, and occlusion handling.
 */

import type { ShaderFragment, BindingDecl } from "../../../shader/fragment-types.js";

// WebGPU shader stage constants
const STAGE_FRAGMENT = 0x2;

/**
 * Create a metallic reflectance fragment.
 * @param hasMetallicReflectanceMap Whether the material has a metallicReflectanceTexture.
 * @param hasReflectanceMap Whether the material has a reflectanceTexture.
 * @param useAlphaOnlyMR Whether to use only the alpha channel from the metallic reflectance map.
 */
export function createReflectanceFragment(hasMetallicReflectanceMap: boolean, hasReflectanceMap: boolean, useAlphaOnlyMR: boolean): ShaderFragment {
    const bindings: BindingDecl[] = [];
    if (hasMetallicReflectanceMap) {
        bindings.push(
            { name: "metallicReflectanceMap", type: { kind: "texture", textureType: "texture_2d<f32>" }, visibility: STAGE_FRAGMENT },
            { name: "metallicReflectanceMapSampler", type: { kind: "sampler", samplerType: "sampler" }, visibility: STAGE_FRAGMENT }
        );
    }
    if (hasReflectanceMap) {
        bindings.push(
            { name: "reflectanceMap", type: { kind: "texture", textureType: "texture_2d<f32>" }, visibility: STAGE_FRAGMENT },
            { name: "reflectanceMapSampler", type: { kind: "sampler", samplerType: "sampler" }, visibility: STAGE_FRAGMENT }
        );
    }

    // Build F0 computation code
    let f0Code = `var mrFactors = vec4<f32>(material.metallicReflectanceColor, material.metallicF0Factor);`;
    if (hasReflectanceMap) {
        f0Code += `
{ let rSample = textureSample(reflectanceMap, reflectanceMapSampler, input.uv);
  let rLinear = pow(rSample.rgb, vec3<f32>(2.2));
  mrFactors = vec4<f32>(mrFactors.rgb * rLinear, mrFactors.a); }`;
    }
    if (hasMetallicReflectanceMap) {
        if (!useAlphaOnlyMR) {
            f0Code += `
{ let mrSample = textureSample(metallicReflectanceMap, metallicReflectanceMapSampler, input.uv);
  let mrLinear = pow(mrSample.rgb, vec3<f32>(2.2));
  mrFactors = vec4<f32>(mrFactors.rgb * mrLinear, mrFactors.a * mrSample.a); }`;
        } else {
            f0Code += `
{ let mrSample = textureSample(metallicReflectanceMap, metallicReflectanceMapSampler, input.uv);
  mrFactors = vec4<f32>(mrFactors.rgb, mrFactors.a * mrSample.a); }`;
        }
    }
    f0Code += `
let dielectricF0 = material.reflectance * mrFactors.a;
let surfaceReflectivityColor = mrFactors.rgb;
let dielectricColorF0 = vec3<f32>(dielectricF0) * surfaceReflectivityColor;
let metallicColorF0 = baseColor;
var colorF0 = mix(dielectricColorF0, metallicColorF0, metallic);
let colorF90 = vec3<f32>(mrFactors.a);
let surfaceAlbedo = baseColor * (vec3<f32>(1.0) - vec3<f32>(dielectricF0) * surfaceReflectivityColor) * (1.0 - metallic);`;

    return {
        id: "reflectance",

        uboFields: [
            { name: "occlusionStrength", type: "f32" },
            { name: "metallicF0Factor", type: "f32" },
            { name: "_mrPad0", type: "f32" },
            { name: "_mrPad1", type: "f32" },
            { name: "metallicReflectanceColor", type: "vec3<f32>" },
            { name: "_mrPad2", type: "f32" },
        ],

        bindings,

        fragmentSlots: {
            MF: f0Code,
            AT: `let occlusion = mix(1.0, orm.r, material.occlusionStrength);`,
        },
    };
}
