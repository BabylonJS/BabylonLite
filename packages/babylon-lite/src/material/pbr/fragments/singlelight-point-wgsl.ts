import { SINGLE_LIGHT_SPECULAR_BLOCK } from "./singlelight-common.js";

export { SINGLE_LIGHT_STRUCTS } from "./singlelight-common.js";

export const POINT_LIGHT_BLOCK = `let entry = lights.lights[mli(0u)];
let lightToFrag = entry.vLightData.xyz - input.worldPos;
let lightDist2 = dot(lightToFrag, lightToFrag);
let L = normalize(lightToFrag);
let NdotL = max(dot(N, L), 0.0);
let range = entry.vLightDiffuse.a;
let physicalFalloff = material.lightFalloffMode >= 0.5;
let physicalAtten = 1.0 / max(lightDist2, 0.0001);
let standardAtten = max(0.0, 1.0 - sqrt(lightDist2) / range);
let lightAtten = select(standardAtten, physicalAtten, physicalFalloff);
let lightColor = entry.vLightDiffuse.rgb;
var directDiffuse = surfaceAlbedo * (1.0 / PI) * NdotL * lightColor * lightAtten * material.directIntensity;
${SINGLE_LIGHT_SPECULAR_BLOCK}
/*AD*/`;
