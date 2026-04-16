/**
 * Skybox-mode IBL calculation (camera→fragment cubemap direction, zero SH irradiance).
 * Kept in a separate module so scenes that don't use PBR skyboxMode don't pay the
 * ~1 KB string cost in their bundle. Dynamic-imported by pbr-renderable.ts when
 * PBR_HAS_SKYBOX is set.
 */

export const IBL_SKYBOX_CALCULATION = `let R_raw = -V;
let R = R_raw;
let N_env = N;
let brdf = textureSample(brdfLUT, brdfSampler_, vec2<f32>(NdotV, roughness));
let environmentBrdf = brdf.rgb;
let specularEnvironmentReflectance = (colorF90 - colorF0) * environmentBrdf.x + colorF0 * environmentBrdf.y;
let seo = clamp((NdotVUnclamped + occlusion) * (NdotVUnclamped + occlusion) - 1.0 + occlusion, 0.0, 1.0);
let eho = 1.0;
let colorSpecularEnvReflectance = specularEnvironmentReflectance * seo * eho;
let energyConservation = getEnergyConservationFactor(colorF0, max(environmentBrdf.y, 0.001));
let environmentIrradiance = vec3<f32>(0.0);
let maxLod = f32(textureNumLevels(iblTexture) - 1);
let cubemapDim = f32(textureDimensions(iblTexture).x);
var specLod = log2(cubemapDim * alphaG) * scene.lodGenerationScale;
var environmentRadiance = textureSampleLevel(iblTexture, iblSampler, R, clamp(specLod, 0.0, maxLod)).rgb * material.environmentIntensity;
environmentRadiance = mix(environmentRadiance, environmentIrradiance, alphaG);
let finalIrradiance = environmentIrradiance * surfaceAlbedo * occlusion;
let finalSpecularScaled = directSpecular * energyConservation;
let finalRadianceScaled = environmentRadiance * colorSpecularEnvReflectance * energyConservation;
color = finalIrradiance + finalRadianceScaled + finalSpecularScaled + directDiffuse + emissive;`;
