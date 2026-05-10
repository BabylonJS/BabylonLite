import { SINGLE_LIGHT_SPECULAR_BLOCK } from "./singlelight-common.js";

export { SINGLE_LIGHT_STRUCTS } from "./singlelight-common.js";

export const DIRECTIONAL_LIGHT_BLOCK = `let entry = lights.lights[mli(0u)];
let L = normalize(-entry.vLightData.xyz);
let NdotL = max(dot(N, L), 0.0);
let lightAtten = 1.0;
let lightColor = entry.vLightDiffuse.rgb;
var directDiffuse = surfaceAlbedo * (1.0 / PI) * NdotL * lightColor * material.directIntensity;
${SINGLE_LIGHT_SPECULAR_BLOCK}
/*AD*/`;
