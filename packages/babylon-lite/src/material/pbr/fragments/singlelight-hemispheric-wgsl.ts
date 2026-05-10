import { SINGLE_LIGHT_SPECULAR_BLOCK } from "./singlelight-common.js";

export { SINGLE_LIGHT_STRUCTS } from "./singlelight-common.js";

export const HEMISPHERIC_LIGHT_BLOCK = `let entry = lights.lights[mli(0u)];
let L = normalize(entry.vLightData.xyz);
let NdotL = dot(N, L) * 0.5 + 0.5;
let lightAtten = 1.0;
let lightColor = entry.vLightDiffuse.rgb;
let hemiDiffuse = mix(entry.vLightDirection.xyz, lightColor, NdotL);
var directDiffuse = hemiDiffuse * surfaceAlbedo * material.directIntensity;
${SINGLE_LIGHT_SPECULAR_BLOCK}
/*AD*/`;
