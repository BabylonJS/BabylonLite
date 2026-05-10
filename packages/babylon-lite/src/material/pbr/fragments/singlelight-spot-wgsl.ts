import { SINGLE_LIGHT_SPECULAR_BLOCK } from "./singlelight-common.js";

export { SINGLE_LIGHT_STRUCTS } from "./singlelight-common.js";

export const SPOT_LIGHT_BLOCK = `let entry = lights.lights[mli(0u)];
let lightToFrag = entry.vLightData.xyz - input.worldPos;
let lightDist = length(lightToFrag);
let L = lightToFrag / max(lightDist, 0.0001);
let NdotL = max(dot(N, L), 0.0);
let spotC = dot(entry.vLightDirection.xyz, -L);
let physicalFalloff = material.lightFalloffMode >= 0.5;
let rangeAtt = select(max(0.0, 1.0 - lightDist / entry.vLightDiffuse.a), 1.0 / max(dot(lightToFrag, lightToFrag), 0.0000001), physicalFalloff);
let standardDirFalloff = select(0.0, max(0.0, pow(max(spotC, 0.0), entry.vLightSpecular.a)), spotC >= entry.vLightDirection.w);
let kappa = 6.64385618977 / max(1.0 - entry.vLightDirection.w, 0.0001);
let physicalDirFalloff = exp2(kappa * (spotC - 1.0));
let lightAtten = rangeAtt * select(standardDirFalloff, physicalDirFalloff, physicalFalloff);
let lightColor = entry.vLightDiffuse.rgb;
var directDiffuse = surfaceAlbedo * (1.0 / PI) * NdotL * lightColor * lightAtten * material.directIntensity;
${SINGLE_LIGHT_SPECULAR_BLOCK}
/*AD*/`;
