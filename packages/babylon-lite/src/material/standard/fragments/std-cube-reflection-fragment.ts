/** Cube reflection fragment — dynamically imported for scenes with cube reflection textures. */
import type { ShaderFragment } from "../../../shader/fragment-types.js";

export function createStdCubeReflectionFragment(): ShaderFragment {
    return {
        id: "std-cube-reflection",
        bindings: [
            { name: "cRT", type: { kind: "texture", textureType: "texture_cube<f32>" }, visibility: 0x2 },
            { name: "cRS", type: { kind: "sampler", samplerType: "sampler" }, visibility: 0x2 },
        ],
        fragmentSlots: {
            AD: `{let v=normalize(input.vPositionW-scene.vEyePosition.xyz);reflectionColor=textureSample(cRT,cRS,reflect(v,normalW)).rgb*mat.rLvl;}`,
        },
    };
}
