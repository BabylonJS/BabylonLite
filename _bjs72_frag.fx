
#if defined(LODBASEDMICROSFURACE)
#extension GL_EXT_shader_texture_lod : enable
#endif

#extension GL_OES_standard_derivatives : enable
#if defined(PREPASS)
#extension GL_EXT_draw_buffers : require
layout(location = 0) out highp vec4 glFragData[SCENE_MRT_COUNT];
highp vec4 gl_FragColor;
#endif
#if defined(WEBGL2) || defined(WEBGPU)
precision highp sampler2DArray;
#endif
precision highp float;

uniform mat4 u_World;
uniform mat4 u_view;
uniform mat4 reflectionMatrix;
#ifdef SPHERICAL_HARMONICS
uniform vec3 vSphericalL00;
#endif
#ifdef SPHERICAL_HARMONICS
uniform vec3 vSphericalL1_1;
#endif
#ifdef SPHERICAL_HARMONICS
uniform vec3 vSphericalL10;
#endif
#ifdef SPHERICAL_HARMONICS
uniform vec3 vSphericalL11;
#endif
#ifdef SPHERICAL_HARMONICS
uniform vec3 vSphericalL2_2;
#endif
#ifdef SPHERICAL_HARMONICS
uniform vec3 vSphericalL2_1;
#endif
#ifdef SPHERICAL_HARMONICS
uniform vec3 vSphericalL20;
#endif
#ifdef SPHERICAL_HARMONICS
uniform vec3 vSphericalL21;
#endif
#ifdef SPHERICAL_HARMONICS
uniform vec3 vSphericalL22;
#endif
#ifndef SPHERICAL_HARMONICS
uniform vec3 vSphericalX;
#endif
#ifndef SPHERICAL_HARMONICS
uniform vec3 vSphericalY;
#endif
#ifndef SPHERICAL_HARMONICS
uniform vec3 vSphericalZ;
#endif
#ifndef SPHERICAL_HARMONICS
uniform vec3 vSphericalXX_ZZ;
#endif
#ifndef SPHERICAL_HARMONICS
uniform vec3 vSphericalYY_ZZ;
#endif
#ifndef SPHERICAL_HARMONICS
uniform vec3 vSphericalZZ;
#endif
#ifndef SPHERICAL_HARMONICS
uniform vec3 vSphericalXY;
#endif
#ifndef SPHERICAL_HARMONICS
uniform vec3 vSphericalYZ;
#endif
#ifndef SPHERICAL_HARMONICS
uniform vec3 vSphericalZX;
#endif
uniform mat4 u_ViewProjection;
uniform vec3 u_cameraPosition;
#ifdef UVTRANSFORM0
uniform mat4 textureTransform;
#endif
#ifdef UVTRANSFORM1
uniform mat4 textureTransform1;
#endif
#ifdef UVTRANSFORM2
uniform mat4 textureTransform2;
#endif
#ifdef UVTRANSFORM3
uniform mat4 textureTransform3;
#endif
#ifdef UVTRANSFORM4
uniform mat4 textureTransform4;
#endif
#ifdef UVTRANSFORM5
uniform mat4 textureTransform5;
#endif
#ifdef UVTRANSFORM6
uniform mat4 textureTransform6;
#endif
#ifdef UVTRANSFORM7
uniform mat4 textureTransform7;
#endif
#ifdef UVTRANSFORM8
uniform mat4 textureTransform8;
#endif
#ifdef UVTRANSFORM9
uniform mat4 textureTransform9;
#endif
#ifdef UVTRANSFORM10
uniform mat4 textureTransform10;
#endif
uniform float u_Bumpstrength;
uniform float u_Metallic;
uniform float u_Roughness;
uniform float u_AOintensity;
uniform float u_Refractionior;
uniform vec3 u_Ambientcolor;
uniform vec3 u_Reflectioncolor;
uniform float u_ClearCoatroughness;
uniform float u_ClearCoatior;
uniform float u_ClearCoatatdistance;
uniform float u_ClearCoattintthickness;
uniform float u_Sheenintensity;
uniform float u_Sheenroughness;
uniform float u_SubSurfacemaxthickness;
uniform float u_SubSurfaceminthickness;
uniform vec3 u_SubSurfacetintcolor;
uniform float u_SubSurfacetranslucencyintensity;
uniform vec3 u_SubSurfacetranslucencydiffusiondistance;
uniform float u_Refractionintensity;
uniform float u_Refractiontintatdistance;
uniform vec2 u_Anisotropydirection;
uniform float textureInfoName;
uniform vec2 tangentSpaceParameter0;
uniform float tangentCorrectionFactor0;
uniform mat4 perturbNormalWorldMatrix0;
uniform float textureInfoName1;
uniform float textureInfoName2;
uniform float textureInfoName3;
uniform float textureInfoName4;
uniform float textureInfoName5;
uniform float textureInfoName6;
uniform float textureInfoName7;
uniform float tangentCorrectionFactor1;
uniform float textureInfoName8;
uniform float textureInfoName9;
uniform float textureInfoName10;
uniform float tangentCorrectionFactor2;
#if defined(IGNORE) || DEBUGMODE > 0
uniform vec2 vDebugMode;
#endif
uniform vec3 ambientFromScene;
uniform vec4 vLightingIntensity;
uniform float invertNormal;
uniform vec4 vMetallicReflectanceFactors;
uniform float baseDiffuseRoughness;
uniform vec3 vReflectionPosition;
uniform vec3 vReflectionPosition1;
uniform vec3 vReflectionMicrosurfaceInfos;
uniform vec2 vReflectionFilteringInfo;
uniform float iblIntensity;
uniform vec4 vClearCoatRefractionParams;
uniform vec2 vClearCoatTangentSpaceParams;
uniform mat4 refractionMatrix;
uniform vec4 vRefractionMicrosurfaceInfos;
uniform vec4 vRefractionInfos;
uniform vec2 vRefractionFilteringInfo;
uniform vec3 vRefractionPosition;
uniform vec3 vRefractionSize;


uniform  sampler2D BumptextureTexture; 
uniform  sampler2D AlbedotextureTexture; 
uniform  sampler2D MetallicRoughnesstextureTexture; 
uniform  sampler2D AOtextureTexture; 
uniform  sampler2D OpacitytextureTexture; 
uniform  sampler2D ClearCoattextureTexture; 
uniform  sampler2D ClearCoatbumptextureTexture; 
uniform  sampler2D ClearCoattinttextureTexture; 
uniform  sampler2D SheentextureTexture; 
uniform  sampler2D SubSurfacethicknesstextureTexture; 
uniform  sampler2D AnisotropytextureTexture; 
uniform  sampler2D environmentBrdfSampler; 
#ifdef REFLECTIONMAP_3D0
uniform samplerCube ReflectionCubeSampler;
#else
uniform  sampler2D ReflectionDSampler; 
#endif
#ifdef SS_REFRACTIONMAP_3D0
uniform samplerCube RefractionCubeSampler;
#else
uniform  sampler2D RefractionDSampler; 
#endif


varying vec4 v_output1;
varying vec4 v_output2;
#ifdef REFLECTIONMAP_SKYBOX0
varying vec3 positionUVW;
#endif
#if defined(REFLECTIONMAP_EQUIRECTANGULAR_FIXED0) || defined(REFLECTIONMAP_MIRROREDEQUIRECTANGULAR_FIXED0)
varying vec3 directionW;
#endif
#if defined(USESPHERICALFROMREFLECTIONMAP) && defined(USESPHERICALINVERTEX)
varying vec3 vEnvironmentIrradiance;
#endif
#if defined(IGNORE) || DEBUGMODE > 0
varying vec4 vClipSpacePosition;
#endif
varying float vViewDepth;
#ifdef UVTRANSFORM0
varying vec2 transformedUV;
#endif
#ifdef VMAINUV
varying vec2 vMainuv;
#endif
#ifdef UVTRANSFORM1
varying vec2 transformedUV1;
#endif
#ifdef UVTRANSFORM2
varying vec2 transformedUV2;
#endif
#ifdef UVTRANSFORM3
varying vec2 transformedUV3;
#endif
#ifdef UVTRANSFORM4
varying vec2 transformedUV4;
#endif
#ifdef UVTRANSFORM5
varying vec2 transformedUV5;
#endif
#ifdef UVTRANSFORM6
varying vec2 transformedUV6;
#endif
#ifdef UVTRANSFORM7
varying vec2 transformedUV7;
#endif
#ifdef UVTRANSFORM8
varying vec2 transformedUV8;
#endif
#ifdef UVTRANSFORM9
varying vec2 transformedUV9;
#endif
#ifdef UVTRANSFORM10
varying vec2 transformedUV10;
#endif
varying vec2 v_uv;


#include<helperFunctions>

#if defined(BUMP) || defined(CLEARCOAT_BUMP) || defined(ANISOTROPIC) || defined(DETAIL)
#if defined(IGNORE) && defined(NORMAL) 

#endif
#ifdef OBJECTSPACE_NORMALMAP

#if defined(WEBGL2) || defined(WEBGPU)
mat4 toNormalMatrix(mat4 wMatrix)
{mat4 ret=inverse(wMatrix);ret=transpose(ret);ret[0][3]=0.;ret[1][3]=0.;ret[2][3]=0.;ret[3]=vec4(0.,0.,0.,1.);return ret;}
#else
mat4 toNormalMatrix(mat4 m)
{float
a00=m[0][0],a01=m[0][1],a02=m[0][2],a03=m[0][3],
a10=m[1][0],a11=m[1][1],a12=m[1][2],a13=m[1][3],
a20=m[2][0],a21=m[2][1],a22=m[2][2],a23=m[2][3],
a30=m[3][0],a31=m[3][1],a32=m[3][2],a33=m[3][3],
b00=a00*a11-a01*a10,
b01=a00*a12-a02*a10,
b02=a00*a13-a03*a10,
b03=a01*a12-a02*a11,
b04=a01*a13-a03*a11,
b05=a02*a13-a03*a12,
b06=a20*a31-a21*a30,
b07=a20*a32-a22*a30,
b08=a20*a33-a23*a30,
b09=a21*a32-a22*a31,
b10=a21*a33-a23*a31,
b11=a22*a33-a23*a32,
det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;mat4 mi=mat4(
a11*b11-a12*b10+a13*b09,
a02*b10-a01*b11-a03*b09,
a31*b05-a32*b04+a33*b03,
a22*b04-a21*b05-a23*b03,
a12*b08-a10*b11-a13*b07,
a00*b11-a02*b08+a03*b07,
a32*b02-a30*b05-a33*b01,
a20*b05-a22*b02+a23*b01,
a10*b10-a11*b08+a13*b06,
a01*b08-a00*b10-a03*b06,
a30*b04-a31*b02+a33*b00,
a21*b02-a20*b04-a23*b00,
a11*b07-a10*b09-a12*b06,
a00*b09-a01*b07+a02*b06,
a31*b01-a30*b03-a32*b00,
a20*b03-a21*b01+a22*b00)/det;return mat4(mi[0][0],mi[1][0],mi[2][0],mi[3][0],
mi[0][1],mi[1][1],mi[2][1],mi[3][1],
mi[0][2],mi[1][2],mi[2][2],mi[3][2],
mi[0][3],mi[1][3],mi[2][3],mi[3][3]);}
#endif
#endif
vec3 perturbNormalBase(mat3 cotangentFrame,vec3 normal,float scale)
{
#ifdef NORMALXYSCALE
normal=normalize(normal*vec3(scale,scale,1.0));
#endif
return normalize(cotangentFrame*normal);}
vec3 perturbNormal(mat3 cotangentFrame,vec3 textureSample,float scale)
{return perturbNormalBase(cotangentFrame,textureSample*2.0-1.0,scale);}
mat3 cotangent_frame(vec3 normal,vec3 p,vec2 uv,vec2 tangentSpaceParams)
{vec3 dp1=dFdx(p);vec3 dp2=dFdy(p);vec2 duv1=dFdx(uv);vec2 duv2=dFdy(uv);vec3 dp2perp=cross(dp2,normal);vec3 dp1perp=cross(normal,dp1);vec3 tangent=dp2perp*duv1.x+dp1perp*duv2.x;vec3 bitangent=dp2perp*duv1.y+dp1perp*duv2.y;tangent*=tangentSpaceParams.x;bitangent*=tangentSpaceParams.y;float det=max(dot(tangent,tangent),dot(bitangent,bitangent));float invmax=det==0.0 ? 0.0 : inversesqrt(det);return mat3(tangent*invmax,bitangent*invmax,normal);}
#endif

#if defined(BUMP)

#endif
#if defined(DETAIL)
#include<samplerFragmentDeclaration>(_DEFINENAME_,DETAIL,_VARYINGNAME_,Detail,_SAMPLERNAME_,detail)
#endif
#if defined(BUMP) && defined(PARALLAX)
const float minSamples=4.;const float maxSamples=15.;const int iMaxSamples=15;#define inline
vec2 parallaxOcclusion(vec3 vViewDirCoT, vec3 vNormalCoT, vec2 texCoord, float parallaxScale, sampler2D bumpSampler) {float parallaxLimit=length(vViewDirCoT.xy)/vViewDirCoT.z;parallaxLimit*=parallaxScale;vec2 vOffsetDir=normalize(vViewDirCoT.xy);vec2 vMaxOffset=vOffsetDir*parallaxLimit;float numSamples=maxSamples+(dot(vViewDirCoT,vNormalCoT)*(minSamples-maxSamples));float stepSize=1.0/numSamples;float currRayHeight=1.0;vec2 vCurrOffset=vec2(0,0);vec2 vLastOffset=vec2(0,0);float lastSampledHeight=1.0;float currSampledHeight=1.0;bool keepWorking=true;for (int i=0; i<iMaxSamples; i++)
{currSampledHeight=texture2D(bumpSampler,texCoord+vCurrOffset).w;if (!keepWorking)
{}
else if (currSampledHeight>currRayHeight)
{float delta1=currSampledHeight-currRayHeight;float delta2=(currRayHeight+stepSize)-lastSampledHeight;float ratio=delta1/(delta1+delta2);vCurrOffset=(ratio)* vLastOffset+(1.0-ratio)*vCurrOffset;keepWorking=false;}
else
{currRayHeight-=stepSize;vLastOffset=vCurrOffset;
#ifdef PARALLAX_RHS
vCurrOffset-=stepSize*vMaxOffset;
#else
vCurrOffset+=stepSize*vMaxOffset;
#endif
lastSampledHeight=currSampledHeight;}}
return vCurrOffset;}
vec2 parallaxOffset(vec3 viewDir, float heightScale, float height_)
{float height=height_;vec2 texCoordOffset=heightScale*viewDir.xy*height;
#ifdef PARALLAX_RHS
return texCoordOffset;
#else
return -texCoordOffset;
#endif
}
#endif

#include<lightUboDeclaration>[0..maxSimultaneousLights]

#include<importanceSampling>

#include<pbrHelperFunctions>

#include<imageProcessingDeclaration>

#include<imageProcessingFunctions>

#include<shadowsFragmentFunctions>

#include<pbrDirectLightingSetupFunctions>

#include<pbrDirectLightingFalloffFunctions>

#define FRESNEL_MAXIMUM_ON_ROUGH 0.25
#define BRDF_DIFFUSE_MODEL_EON 0
#define BRDF_DIFFUSE_MODEL_BURLEY 1
#define BRDF_DIFFUSE_MODEL_LAMBERT 2
#define BRDF_DIFFUSE_MODEL_LEGACY 3
#define DIELECTRIC_SPECULAR_MODEL_GLTF 0
#define DIELECTRIC_SPECULAR_MODEL_OPENPBR 1
#define CONDUCTOR_SPECULAR_MODEL_GLTF 0
#define CONDUCTOR_SPECULAR_MODEL_OPENPBR 1
#if !defined(PBR_VERTEX_SHADER) && !defined(OPENPBR_VERTEX_SHADER)
#ifdef MS_BRDF_ENERGY_CONSERVATION
vec3 getEnergyConservationFactor(const vec3 specularEnvironmentR0,const vec3 environmentBrdf) {return 1.0+specularEnvironmentR0*(1.0/environmentBrdf.y-1.0);}
#endif
#if CONDUCTOR_SPECULAR_MODEL==CONDUCTOR_SPECULAR_MODEL_OPENPBR 
vec3 getF82Specular(float NdotV,vec3 F0,vec3 edgeTint,float roughness) {const float cos_theta_max=0.142857143; 
const float one_minus_cos_theta_max_to_the_fifth=0.462664366; 
const float one_minus_cos_theta_max_to_the_sixth=0.396569457; 
vec3 white_minus_F0=vec3(1.0)-F0;vec3 b_numerator=(F0+white_minus_F0*one_minus_cos_theta_max_to_the_fifth)*(vec3(1.0)-edgeTint);const float b_denominator=cos_theta_max*one_minus_cos_theta_max_to_the_sixth;const float b_denominator_reciprocal=1.0/b_denominator;vec3 b=b_numerator*b_denominator_reciprocal; 
float cos_theta=max(roughness,NdotV);float one_minus_cos_theta=1.0-cos_theta;vec3 offset_from_F0=(white_minus_F0-b*cos_theta*one_minus_cos_theta)*pow(one_minus_cos_theta,5.0);return clamp(F0+offset_from_F0,0.0,1.0);}
#endif
#ifdef FUZZENVIRONMENTBRDF
vec3 getFuzzBRDFLookup(float NdotV,float perceptualRoughness) {vec2 UV=vec2(perceptualRoughness,NdotV);vec4 brdfLookup=texture2D(environmentFuzzBrdfSampler,UV);const vec2 RiRange=vec2(0.0,0.75);const vec2 ARange =vec2(0.005,0.88);const vec2 BRange =vec2(-0.18,0.002);brdfLookup.r=mix(ARange.x, ARange.y, brdfLookup.r);brdfLookup.g=mix(BRange.x, BRange.y, brdfLookup.g);brdfLookup.b=mix(RiRange.x,RiRange.y,brdfLookup.b);return brdfLookup.rgb;}
#endif
#ifdef ENVIRONMENTBRDF
vec3 getBRDFLookup(float NdotV,float perceptualRoughness) {vec2 UV=vec2(NdotV,perceptualRoughness);vec4 brdfLookup=texture2D(environmentBrdfSampler,UV);
#ifdef ENVIRONMENTBRDF_RGBD
brdfLookup.rgb=fromRGBD(brdfLookup.rgba);
#endif
return brdfLookup.rgb;}
vec3 getReflectanceFromBRDFLookup(const vec3 specularEnvironmentR0,const vec3 specularEnvironmentR90,const vec3 environmentBrdf) {
#ifdef BRDF_V_HEIGHT_CORRELATED
vec3 reflectance=(specularEnvironmentR90-specularEnvironmentR0)*environmentBrdf.x+specularEnvironmentR0*environmentBrdf.y;
#else
vec3 reflectance=specularEnvironmentR0*environmentBrdf.x+specularEnvironmentR90*environmentBrdf.y;
#endif
return reflectance;}
vec3 getReflectanceFromBRDFLookup(const vec3 specularEnvironmentR0,const vec3 environmentBrdf) {
#ifdef BRDF_V_HEIGHT_CORRELATED
vec3 reflectance=mix(environmentBrdf.xxx,environmentBrdf.yyy,specularEnvironmentR0);
#else
vec3 reflectance=specularEnvironmentR0*environmentBrdf.x+environmentBrdf.y;
#endif
return reflectance;}
#endif
/* NOT USED
#if defined(SHEEN) && defined(SHEEN_SOFTER)
float getBRDFLookupCharlieSheen(float NdotV,float perceptualRoughness)
{float c=1.0-NdotV;float c3=c*c*c;return 0.65584461*c3+1.0/(4.16526551+exp(-7.97291361*perceptualRoughness+6.33516894));}
#endif
*/
#if !defined(ENVIRONMENTBRDF) || defined(REFLECTIONMAP_SKYBOX0) || defined(ALPHAFRESNEL)
vec3 getReflectanceFromAnalyticalBRDFLookup_Jones(float VdotN,vec3 reflectance0,vec3 reflectance90,float smoothness)
{float weight=mix(FRESNEL_MAXIMUM_ON_ROUGH,1.0,smoothness);return reflectance0+weight*(reflectance90-reflectance0)*pow5(saturate(1.0-VdotN));}
#endif
#if defined(SHEEN) && defined(ENVIRONMENTBRDF)
/**
* The sheen BRDF not containing F can be easily stored in the blue channel of the BRDF texture.
* The blue channel contains DCharlie*VAshikhmin*NdotL as a lokkup table
*/
vec3 getSheenReflectanceFromBRDFLookup(const vec3 reflectance0,const vec3 environmentBrdf) {vec3 sheenEnvironmentReflectance=reflectance0*environmentBrdf.b;return sheenEnvironmentReflectance;}
#endif
vec3 fresnelSchlickGGX(float VdotH,vec3 reflectance0,vec3 reflectance90)
{return reflectance0+(reflectance90-reflectance0)*pow5(1.0-VdotH);}
float fresnelSchlickGGX(float VdotH,float reflectance0,float reflectance90)
{return reflectance0+(reflectance90-reflectance0)*pow5(1.0-VdotH);}
#ifdef CLEARCOAT
vec3 getR0RemappedForClearCoat(vec3 f0) {
#ifdef CLEARCOAT_DEFAULTIOR
#ifdef MOBILE
return saturate(f0*(f0*0.526868+0.529324)-0.0482256);
#else
return saturate(f0*(f0*(0.941892-0.263008*f0)+0.346479)-0.0285998);
#endif
#else
vec3 s=sqrt(f0);vec3 t=(vClearCoatRefractionParams.z+vClearCoatRefractionParams.w*s)/(vClearCoatRefractionParams.w+vClearCoatRefractionParams.z*s);return square(t);
#endif
}
#endif
#ifdef IRIDESCENCE
const mat3 XYZ_TO_REC709=mat3(
3.2404542,-0.9692660, 0.0556434,
-1.5371385, 1.8760108,-0.2040259,
-0.4985314, 0.0415560, 1.0572252
);vec3 getIORTfromAirToSurfaceR0(vec3 f0) {vec3 sqrtF0=sqrt(f0);return (1.+sqrtF0)/(1.-sqrtF0);}
vec3 getR0fromIORs(vec3 iorT,float iorI) {return square((iorT-vec3(iorI))/(iorT+vec3(iorI)));}
float getR0fromIORs(float iorT,float iorI) {return square((iorT-iorI)/(iorT+iorI));}
vec3 evalSensitivity(float opd,vec3 shift) {float phase=2.0*PI*opd*1.0e-9;const vec3 val=vec3(5.4856e-13,4.4201e-13,5.2481e-13);const vec3 pos=vec3(1.6810e+06,1.7953e+06,2.2084e+06);const vec3 var=vec3(4.3278e+09,9.3046e+09,6.6121e+09);vec3 xyz=val*sqrt(2.0*PI*var)*cos(pos*phase+shift)*exp(-square(phase)*var);xyz.x+=9.7470e-14*sqrt(2.0*PI*4.5282e+09)*cos(2.2399e+06*phase+shift[0])*exp(-4.5282e+09*square(phase));xyz/=1.0685e-7;vec3 srgb=XYZ_TO_REC709*xyz;return srgb;}
vec3 evalIridescence(float outsideIOR,float eta2,float cosTheta1,float thinFilmThickness,vec3 baseF0) {vec3 I=vec3(1.0);float iridescenceIOR=mix(outsideIOR,eta2,smoothstep(0.0,0.03,thinFilmThickness));float sinTheta2Sq=square(outsideIOR/iridescenceIOR)*(1.0-square(cosTheta1));float cosTheta2Sq=1.0-sinTheta2Sq;if (cosTheta2Sq<0.0) {return I;}
float cosTheta2=sqrt(cosTheta2Sq);float R0=getR0fromIORs(iridescenceIOR,outsideIOR);float R12=fresnelSchlickGGX(cosTheta1,R0,1.);float R21=R12;float T121=1.0-R12;float phi12=0.0;if (iridescenceIOR<outsideIOR) phi12=PI;float phi21=PI-phi12;vec3 baseIOR=getIORTfromAirToSurfaceR0(clamp(baseF0,0.0,0.9999)); 
vec3 R1=getR0fromIORs(baseIOR,iridescenceIOR);vec3 R23=fresnelSchlickGGX(cosTheta2,R1,vec3(1.));vec3 phi23=vec3(0.0);if (baseIOR[0]<iridescenceIOR) phi23[0]=PI;if (baseIOR[1]<iridescenceIOR) phi23[1]=PI;if (baseIOR[2]<iridescenceIOR) phi23[2]=PI;float opd=2.0*iridescenceIOR*thinFilmThickness*cosTheta2;vec3 phi=vec3(phi21)+phi23;vec3 R123=clamp(R12*R23,1e-5,0.9999);vec3 r123=sqrt(R123);vec3 Rs=square(T121)*R23/(vec3(1.0)-R123);vec3 C0=R12+Rs;I=C0;vec3 Cm=Rs-T121;for (int m=1; m<=2; ++m)
{Cm*=r123;vec3 Sm=2.0*evalSensitivity(float(m)*opd,float(m)*phi);I+=Cm*Sm;}
return max(I,vec3(0.0));}
#endif
float normalDistributionFunction_TrowbridgeReitzGGX(float NdotH,float alphaG)
{float a2=square(alphaG);float d=NdotH*NdotH*(a2-1.0)+1.0;return a2/(PI*d*d);}
#ifdef SHEEN
float normalDistributionFunction_CharlieSheen(float NdotH,float alphaG)
{float invR=1./alphaG;float cos2h=NdotH*NdotH;float sin2h=1.-cos2h;return (2.+invR)*pow(sin2h,invR*.5)/(2.*PI);}
#endif
#ifdef ANISOTROPIC
float normalDistributionFunction_BurleyGGX_Anisotropic(float NdotH,float TdotH,float BdotH,const vec2 alphaTB) {float a2=alphaTB.x*alphaTB.y;vec3 v=vec3(alphaTB.y*TdotH,alphaTB.x *BdotH,a2*NdotH);float v2=dot(v,v);float w2=a2/v2;return a2*w2*w2*RECIPROCAL_PI;}
#endif
#ifdef BRDF_V_HEIGHT_CORRELATED
float smithVisibility_GGXCorrelated(float NdotL,float NdotV,float alphaG) {
#ifdef MOBILE
float GGXV=NdotL*(NdotV*(1.0-alphaG)+alphaG);float GGXL=NdotV*(NdotL*(1.0-alphaG)+alphaG);return 0.5/(GGXV+GGXL);
#else
float a2=alphaG*alphaG;float GGXV=NdotL*sqrt(NdotV*(NdotV-a2*NdotV)+a2);float GGXL=NdotV*sqrt(NdotL*(NdotL-a2*NdotL)+a2);return 0.5/(GGXV+GGXL);
#endif
}
#else
float smithVisibilityG1_TrowbridgeReitzGGXFast(float dot,float alphaG)
{
#ifdef MOBILE
return 1.0/(dot+alphaG+(1.0-alphaG)*dot ));
#else
float alphaSquared=alphaG*alphaG;return 1.0/(dot+sqrt(alphaSquared+(1.0-alphaSquared)*dot*dot));
#endif
}
float smithVisibility_TrowbridgeReitzGGXFast(float NdotL,float NdotV,float alphaG)
{float visibility=smithVisibilityG1_TrowbridgeReitzGGXFast(NdotL,alphaG)*smithVisibilityG1_TrowbridgeReitzGGXFast(NdotV,alphaG);return visibility;}
#endif
#ifdef ANISOTROPIC
float smithVisibility_GGXCorrelated_Anisotropic(float NdotL,float NdotV,float TdotV,float BdotV,float TdotL,float BdotL,const vec2 alphaTB) {float lambdaV=NdotL*length(vec3(alphaTB.x*TdotV,alphaTB.y*BdotV,NdotV));float lambdaL=NdotV*length(vec3(alphaTB.x*TdotL,alphaTB.y*BdotL,NdotL));float v=0.5/(lambdaV+lambdaL);return v;}
#endif
#ifdef CLEARCOAT
float visibility_Kelemen(float VdotH) {return 0.25/(VdotH*VdotH); }
#endif
#ifdef SHEEN
float visibility_Ashikhmin(float NdotL,float NdotV)
{return 1./(4.*(NdotL+NdotV-NdotL*NdotV));}
/* NOT USED
#ifdef SHEEN_SOFTER
float l(float x,float alphaG)
{float oneMinusAlphaSq=(1.0-alphaG)*(1.0-alphaG);float a=mix(21.5473,25.3245,oneMinusAlphaSq);float b=mix(3.82987,3.32435,oneMinusAlphaSq);float c=mix(0.19823,0.16801,oneMinusAlphaSq);float d=mix(-1.97760,-1.27393,oneMinusAlphaSq);float e=mix(-4.32054,-4.85967,oneMinusAlphaSq);return a/(1.0+b*pow(x,c))+d*x+e;}
float lambdaSheen(float cosTheta,float alphaG)
{return abs(cosTheta)<0.5 ? exp(l(cosTheta,alphaG)) : exp(2.0*l(0.5,alphaG)-l(1.0-cosTheta,alphaG));}
float visibility_CharlieSheen(float NdotL,float NdotV,float alphaG)
{float G=1.0/(1.0+lambdaSheen(NdotV,alphaG)+lambdaSheen(NdotL,alphaG));return G/(4.0*NdotV*NdotL);}
#endif
*/
#endif
float diffuseBRDF_Burley(float NdotL,float NdotV,float VdotH,float roughness) {float diffuseFresnelNV=pow5(saturateEps(1.0-NdotL));float diffuseFresnelNL=pow5(saturateEps(1.0-NdotV));float diffuseFresnel90=0.5+2.0*VdotH*VdotH*roughness;float fresnel =
(1.0+(diffuseFresnel90-1.0)*diffuseFresnelNL) *
(1.0+(diffuseFresnel90-1.0)*diffuseFresnelNV);return fresnel/PI;}
const float constant1_FON=0.5-2.0/(3.0*PI);const float constant2_FON=2.0/3.0-28.0/(15.0*PI);float E_FON_approx(float mu,float roughness)
{float sigma=roughness; 
float mucomp=1.0-mu;float mucomp2=mucomp*mucomp;const mat2 Gcoeffs=mat2(0.0571085289,-0.332181442,
0.491881867,0.0714429953);float GoverPi=dot(Gcoeffs*vec2(mucomp,mucomp2),vec2(1.0,mucomp2));return (1.0+sigma*GoverPi)/(1.0+constant1_FON*sigma);}
vec3 diffuseBRDF_EON(vec3 albedo,float roughness,float NdotL,float NdotV,float LdotV)
{vec3 rho=albedo;float sigma=roughness; 
float mu_i=NdotL; 
float mu_o=NdotV; 
float s=LdotV-mu_i*mu_o; 
float sovertF=s>0.0 ? s/max(mu_i,mu_o) : s; 
float AF=1.0/(1.0+constant1_FON*sigma); 
vec3 f_ss=(rho*RECIPROCAL_PI)*AF*(1.0+sigma*sovertF); 
float EFo=E_FON_approx(mu_o,sigma); 
float EFi=E_FON_approx(mu_i,sigma); 
float avgEF=AF*(1.0+constant2_FON*sigma); 
vec3 rho_ms=(rho*rho)*avgEF/(vec3(1.0)-rho*(1.0-avgEF));const float eps=1.0e-7;vec3 f_ms=(rho_ms*RECIPROCAL_PI)*max(eps,1.0-EFo) 
* max(eps,1.0-EFi)
/ max(eps,1.0-avgEF);return (f_ss+f_ms);}
#ifdef SS_TRANSLUCENCY
vec3 transmittanceBRDF_Burley(const vec3 tintColor,const vec3 diffusionDistance,float thickness) {vec3 S=1./maxEps(diffusionDistance);vec3 temp=exp((-0.333333333*thickness)*S);return tintColor.rgb*0.25*(temp*temp*temp+3.0*temp);}
float computeWrappedDiffuseNdotL(float NdotL,float w) {float t=1.0+w;float invt2=1.0/square(t);return saturate((NdotL+w)*invt2);}
#endif
#endif 

#include<hdrFilteringFunctions>

#include<pbrDirectLightingFunctions>

#include<pbrIBLFunctions>

#include<pbrBlockAlbedoOpacity>

#include<pbrBlockReflectivity>

#include<pbrBlockAmbientOcclusion>

#include<pbrBlockAlphaFresnel>

#include<pbrBlockAnisotropic>

#include<pbrClusteredLightingFunctions>

vec3 computeFixedEquirectangularCoords(vec4 worldPos,vec3 worldNormal,vec3 direction)
{float lon=atan(direction.z,direction.x);float lat=acos(direction.y);vec2 sphereCoords=vec2(lon,lat)*RECIPROCAL_PI2*2.0;float s=sphereCoords.x*0.5+0.5;float t=sphereCoords.y;return vec3(s,t,0); }
vec3 computeMirroredFixedEquirectangularCoords(vec4 worldPos,vec3 worldNormal,vec3 direction)
{float lon=atan(direction.z,direction.x);float lat=acos(direction.y);vec2 sphereCoords=vec2(lon,lat)*RECIPROCAL_PI2*2.0;float s=sphereCoords.x*0.5+0.5;float t=sphereCoords.y;return vec3(1.0-s,t,0); }
vec3 computeEquirectangularCoords(vec4 worldPos,vec3 worldNormal,vec3 eyePosition,mat4 reflectionMatrix)
{vec3 cameraToVertex=normalize(worldPos.xyz-eyePosition);vec3 r=normalize(reflect(cameraToVertex,worldNormal));r=vec3(reflectionMatrix*vec4(r,0));float lon=atan(r.z,r.x);float lat=acos(r.y);vec2 sphereCoords=vec2(lon,lat)*RECIPROCAL_PI2*2.0;float s=sphereCoords.x*0.5+0.5;float t=sphereCoords.y;return vec3(s,t,0);}
vec3 computeSphericalCoords(vec4 worldPos,vec3 worldNormal,mat4 view,mat4 reflectionMatrix)
{vec3 viewDir=normalize(vec3(view*worldPos));vec3 viewNormal=normalize(vec3(view*vec4(worldNormal,0.0)));vec3 r=reflect(viewDir,viewNormal);r=vec3(reflectionMatrix*vec4(r,0));r.z=r.z-1.0;float m=2.0*length(r);return vec3(r.x/m+0.5,1.0-r.y/m-0.5,0);}
vec3 computePlanarCoords(vec4 worldPos,vec3 worldNormal,vec3 eyePosition,mat4 reflectionMatrix)
{vec3 viewDir=worldPos.xyz-eyePosition;vec3 coords=normalize(reflect(viewDir,worldNormal));return vec3(reflectionMatrix*vec4(coords,1));}
vec3 computeCubicCoords(vec4 worldPos,vec3 worldNormal,vec3 eyePosition,mat4 reflectionMatrix)
{vec3 viewDir=normalize(worldPos.xyz-eyePosition);vec3 coords=reflect(viewDir,worldNormal);coords=vec3(reflectionMatrix*vec4(coords,0));
#ifdef INVERTCUBICMAP
coords.y*=-1.0;
#endif
return coords;}
vec3 computeCubicLocalCoords(vec4 worldPos,vec3 worldNormal,vec3 eyePosition,mat4 reflectionMatrix,vec3 reflectionSize,vec3 reflectionPosition)
{vec3 viewDir=normalize(worldPos.xyz-eyePosition);vec3 coords=reflect(viewDir,worldNormal);coords=parallaxCorrectNormal(worldPos.xyz,coords,reflectionSize,reflectionPosition);coords=vec3(reflectionMatrix*vec4(coords,0));
#ifdef INVERTCUBICMAP
coords.y*=-1.0;
#endif
return coords;}
vec3 computeProjectionCoords(vec4 worldPos,mat4 view,mat4 reflectionMatrix)
{return vec3(reflectionMatrix*(view*worldPos));}
vec3 computeSkyBoxCoords(vec3 positionW,mat4 reflectionMatrix)
{return vec3(reflectionMatrix*vec4(positionW,1.));}
#ifdef REFLECTION
void DUMMYFUNC(vec4 worldPos,vec3 worldNormal)
{
#ifdef REFLECTIONMAP_MIRROREDEQUIRECTANGULAR_FIXED
vec3 direction=normalize(vDirectionW);return computeMirroredFixedEquirectangularCoords(worldPos,worldNormal,direction);
#endif
#ifdef REFLECTIONMAP_EQUIRECTANGULAR_FIXED
vec3 direction=normalize(vDirectionW);return computeFixedEquirectangularCoords(worldPos,worldNormal,direction);
#endif
#ifdef REFLECTIONMAP_EQUIRECTANGULAR
return computeEquirectangularCoords(worldPos,worldNormal,vEyePosition.xyz,reflectionMatrix);
#endif
#ifdef REFLECTIONMAP_SPHERICAL
return computeSphericalCoords(worldPos,worldNormal,view,reflectionMatrix);
#endif
#ifdef REFLECTIONMAP_PLANAR
return computePlanarCoords(worldPos,worldNormal,vEyePosition.xyz,reflectionMatrix);
#endif
#ifdef REFLECTIONMAP_CUBIC
#ifdef USE_LOCAL_REFLECTIONMAP_CUBIC
return computeCubicLocalCoords(worldPos,worldNormal,vEyePosition.xyz,reflectionMatrix,vReflectionSize,vReflectionPosition);
#else
return computeCubicCoords(worldPos,worldNormal,vEyePosition.xyz,reflectionMatrix);
#endif
#endif
#ifdef REFLECTIONMAP_PROJECTION
return computeProjectionCoords(worldPos,view,reflectionMatrix);
#endif
#ifdef REFLECTIONMAP_SKYBOX
return computeSkyBoxCoords(vPositionUVW,reflectionMatrix);
#endif
#ifdef REFLECTIONMAP_EXPLICIT
return vec3(0,0,0);
#endif
}
#endif

#ifdef USESPHERICALFROMREFLECTIONMAP
#ifdef SPHERICAL_HARMONICS
vec3 computeEnvironmentIrradiance(vec3 normal) {return vSphericalL00
+ vSphericalL1_1*(normal.y)
+ vSphericalL10*(normal.z)
+ vSphericalL11*(normal.x)
+ vSphericalL2_2*(normal.y*normal.x)
+ vSphericalL2_1*(normal.y*normal.z)
+ vSphericalL20*((3.0*normal.z*normal.z)-1.0)
+ vSphericalL21*(normal.z*normal.x)
+ vSphericalL22*(normal.x*normal.x-(normal.y*normal.y));}
#else
vec3 computeEnvironmentIrradiance(vec3 normal) {float Nx=normal.x;float Ny=normal.y;float Nz=normal.z;vec3 C1=vSphericalZZ.rgb;vec3 Cx=vSphericalX.rgb;vec3 Cy=vSphericalY.rgb;vec3 Cz=vSphericalZ.rgb;vec3 Cxx_zz=vSphericalXX_ZZ.rgb;vec3 Cyy_zz=vSphericalYY_ZZ.rgb;vec3 Cxy=vSphericalXY.rgb;vec3 Cyz=vSphericalYZ.rgb;vec3 Czx=vSphericalZX.rgb;vec3 a1=Cyy_zz*Ny+Cy;vec3 a2=Cyz*Nz+a1;vec3 b1=Czx*Nz+Cx;vec3 b2=Cxy*Ny+b1;vec3 b3=Cxx_zz*Nx+b2;vec3 t1=Cz *Nz+C1;vec3 t2=a2 *Ny+t1;vec3 t3=b3 *Nx+t2;return t3;}
#endif
#endif


                #ifdef REFLECTIONMAP_3D0
                    #define sampleReflection(s, c) textureCube(s, c)
                #else
                    #define sampleReflection(s, c) texture2D(s, c)
                #endif


                #ifdef REFLECTIONMAP_3D0
                    #define sampleReflectionLod(s, c, l) textureCubeLodEXT(s, c, l)
                #else
                    #define sampleReflectionLod(s, c, l) texture2DLodEXT(s, c, l)
                #endif


            vec3 computeReflectionCoordsPBR(vec4 worldPos, vec3 worldNormal) {
                
            #ifdef REFLECTIONMAP_MIRROREDEQUIRECTANGULAR_FIXED0
               vec3 reflectionUVW = computeMirroredFixedEquirectangularCoords(worldPos, worldNormal.xyz, normalize(directionW));
            #endif

            #ifdef REFLECTIONMAP_EQUIRECTANGULAR_FIXED0
                vec3 reflectionUVW = computeFixedEquirectangularCoords(worldPos, worldNormal.xyz, normalize(directionW));
            #endif

            #ifdef REFLECTIONMAP_EQUIRECTANGULAR0
                vec3 reflectionUVW = computeEquirectangularCoords(worldPos, worldNormal.xyz, u_cameraPosition.xyz, reflectionMatrix);
            #endif

            #ifdef REFLECTIONMAP_SPHERICAL0
                vec3 reflectionUVW = computeSphericalCoords(worldPos, worldNormal.xyz, u_view, reflectionMatrix);
            #endif

            #ifdef REFLECTIONMAP_PLANAR0
                vec3 reflectionUVW = computePlanarCoords(worldPos, worldNormal.xyz, u_cameraPosition.xyz, reflectionMatrix);
            #endif

            #ifdef REFLECTIONMAP_CUBIC0
                #ifdef USE_LOCAL_REFLECTIONMAP_CUBIC0
                    vec3 reflectionUVW = computeCubicLocalCoords(worldPos, worldNormal.xyz, u_cameraPosition.xyz, reflectionMatrix, vReflectionPosition1, vReflectionPosition);
                #else
                vec3 reflectionUVW = computeCubicCoords(worldPos, worldNormal.xyz, u_cameraPosition.xyz, reflectionMatrix);
                #endif
            #endif

            #ifdef REFLECTIONMAP_PROJECTION0
                vec3 reflectionUVW = computeProjectionCoords(worldPos, u_view, reflectionMatrix);
            #endif

            #ifdef REFLECTIONMAP_SKYBOX0
                vec3 reflectionUVW = computeSkyBoxCoords(positionUVW, reflectionMatrix);
            #endif

            #ifdef REFLECTIONMAP_EXPLICIT0
                vec3 reflectionUVW = vec3(0, 0, 0);
            #endif

                return reflectionUVW;
            }

#ifdef REFLECTION
struct reflectionOutParams
{vec4 environmentRadiance;vec3 environmentIrradiance;
#ifdef REFLECTIONMAP_3D0
vec3 reflectionCoords;
#else
vec2 reflectionCoords;
#endif
#ifdef SS_TRANSLUCENCY
#ifdef USESPHERICALFROMREFLECTIONMAP
#if !defined(NORMAL) || !defined(USESPHERICALINVERTEX)
vec3 irradianceVector;
#endif
#endif
#endif
};
#define pbr_inline
void createReflectionCoords(
in vec3 vPositionW,
in vec3 normalW,
#ifdef ANISOTROPIC
in anisotropicOutParams anisotropicOut,
#endif
#ifdef REFLECTIONMAP_3D0
out vec3 reflectionCoords
#else
out vec2 reflectionCoords
#endif
)
{
#ifdef ANISOTROPIC
vec3 reflectionVector=computeReflectionCoordsPBR(vec4(vPositionW,1.0),anisotropicOut.anisotropicNormal);
#else
vec3 reflectionVector=computeReflectionCoordsPBR(vec4(vPositionW,1.0),normalW);
#endif
#ifdef REFLECTIONMAP_OPPOSITEZ0
reflectionVector.z*=-1.0;
#endif
#ifdef REFLECTIONMAP_3D0
reflectionCoords=reflectionVector;
#else
reflectionCoords=reflectionVector.xy;
#ifdef REFLECTIONMAP_PROJECTION0
reflectionCoords/=reflectionVector.z;
#endif
reflectionCoords.y=1.0-reflectionCoords.y;
#endif
}
#define pbr_inline
#define inline
void sampleReflectionTexture(
in float alphaG,
in vec3 vReflectionMicrosurfaceInfos,
in vec2 vReflectionInfos,
in vec3 vReflectionColor,
#if defined(LODINREFLECTIONALPHA0) && !defined(REFLECTIONMAP_SKYBOX0)
in float NdotVUnclamped,
#endif
#ifdef LINEARSPECULARREFLECTION0
in float roughness,
#endif
#ifdef REFLECTIONMAP_3D0
in samplerCube reflectionSampler,
const vec3 reflectionCoords,
#else
in sampler2D reflectionSampler,
const vec2 reflectionCoords,
#endif
#ifndef LODBASEDMICROSFURACE
#ifdef REFLECTIONMAP_3D0
in samplerCube reflectionSamplerLow,
in samplerCube reflectionSamplerHigh,
#else
in sampler2D reflectionSamplerLow,
in sampler2D reflectionSamplerHigh,
#endif
#endif
#ifdef REALTIME_FILTERING
in vec2 vReflectionFilteringInfo,
#endif
out vec4 environmentRadiance
)
{
#if defined(LODINREFLECTIONALPHA0) && !defined(REFLECTIONMAP_SKYBOX0)
float reflectionLOD=getLodFromAlphaG(vReflectionMicrosurfaceInfos.x,alphaG,NdotVUnclamped);
#elif defined(LINEARSPECULARREFLECTION0)
float reflectionLOD=getLinearLodFromRoughness(vReflectionMicrosurfaceInfos.x,roughness);
#else
float reflectionLOD=getLodFromAlphaG(vReflectionMicrosurfaceInfos.x,alphaG);
#endif
#ifdef LODBASEDMICROSFURACE
reflectionLOD=reflectionLOD*vReflectionMicrosurfaceInfos.y+vReflectionMicrosurfaceInfos.z;
#ifdef LODINREFLECTIONALPHA0
float automaticReflectionLOD=UNPACK_LOD(sampleReflection(reflectionSampler,reflectionCoords).a);float requestedReflectionLOD=max(automaticReflectionLOD,reflectionLOD);
#else
float requestedReflectionLOD=reflectionLOD;
#endif
#ifdef REALTIME_FILTERING
environmentRadiance=vec4(radiance(alphaG,reflectionSampler,reflectionCoords,vReflectionFilteringInfo),1.0);
#else
environmentRadiance=sampleReflectionLod(reflectionSampler,reflectionCoords,reflectionLOD);
#endif
#else
float lodReflectionNormalized=saturate(reflectionLOD/log2(vReflectionMicrosurfaceInfos.x));float lodReflectionNormalizedDoubled=lodReflectionNormalized*2.0;vec4 environmentMid=sampleReflection(reflectionSampler,reflectionCoords);if (lodReflectionNormalizedDoubled<1.0){environmentRadiance=mix(
sampleReflection(reflectionSamplerHigh,reflectionCoords),
environmentMid,
lodReflectionNormalizedDoubled
);} else {environmentRadiance=mix(
environmentMid,
sampleReflection(reflectionSamplerLow,reflectionCoords),
lodReflectionNormalizedDoubled-1.0
);}
#endif
#ifdef RGBDREFLECTION
environmentRadiance.rgb=fromRGBD(environmentRadiance);
#endif
#ifdef GAMMAREFLECTION
environmentRadiance.rgb=toLinearSpace(environmentRadiance.rgb);
#endif
environmentRadiance.rgb*=vReflectionInfos.x;environmentRadiance.rgb*=vReflectionColor.rgb;}
#define pbr_inline
#define inline
reflectionOutParams reflectionBlock(
in vec3 vPositionW
,in vec3 normalW
,in float alphaG
,in vec3 vReflectionMicrosurfaceInfos
,in vec2 vReflectionInfos
,in vec3 vReflectionColor
#ifdef ANISOTROPIC
,in anisotropicOutParams anisotropicOut
#endif
#if defined(LODINREFLECTIONALPHA0) && !defined(REFLECTIONMAP_SKYBOX0)
,in float NdotVUnclamped
#endif
#ifdef LINEARSPECULARREFLECTION0
,in float roughness
#endif
#ifdef REFLECTIONMAP_3D0
,in samplerCube reflectionSampler
#else
,in sampler2D reflectionSampler
#endif
#if defined(NORMAL) && defined(USESPHERICALINVERTEX)
,in vec3 vEnvironmentIrradiance
#endif
#if (defined(USESPHERICALFROMREFLECTIONMAP) && (!defined(NORMAL) || !defined(USESPHERICALINVERTEX))) || (defined(USEIRRADIANCEMAP) && defined(REFLECTIONMAP_3D0))
,in mat4 reflectionMatrix
#endif
#ifdef USEIRRADIANCEMAP
#ifdef REFLECTIONMAP_3D0
,in samplerCube irradianceSampler
#else
,in sampler2D irradianceSampler
#endif
#ifdef USE_IRRADIANCE_DOMINANT_DIRECTION
,in vec3 reflectionDominantDirection
#endif
#endif
#ifndef LODBASEDMICROSFURACE
#ifdef REFLECTIONMAP_3D0
,in samplerCube reflectionSamplerLow
,in samplerCube reflectionSamplerHigh
#else
,in sampler2D reflectionSamplerLow
,in sampler2D reflectionSamplerHigh
#endif
#endif
#ifdef REALTIME_FILTERING
,in vec2 vReflectionFilteringInfo
#ifdef IBL_CDF_FILTERING
,in sampler2D icdfSampler
#endif
#endif
,in vec3 viewDirectionW
,in float diffuseRoughness
,in vec3 surfaceAlbedo
)
{reflectionOutParams outParams;vec4 environmentRadiance=vec4(0.,0.,0.,0.);
#ifdef REFLECTIONMAP_3D0
vec3 reflectionCoords=vec3(0.);
#else
vec2 reflectionCoords=vec2(0.);
#endif
createReflectionCoords(
vPositionW,
normalW,
#ifdef ANISOTROPIC
anisotropicOut,
#endif
reflectionCoords
);sampleReflectionTexture(
alphaG,
vReflectionMicrosurfaceInfos,
vReflectionInfos,
vReflectionColor,
#if defined(LODINREFLECTIONALPHA0) && !defined(REFLECTIONMAP_SKYBOX0)
NdotVUnclamped,
#endif
#ifdef LINEARSPECULARREFLECTION0
roughness,
#endif
#ifdef REFLECTIONMAP_3D0
reflectionSampler,
reflectionCoords,
#else
reflectionSampler,
reflectionCoords,
#endif
#ifndef LODBASEDMICROSFURACE
reflectionSamplerLow,
reflectionSamplerHigh,
#endif
#ifdef REALTIME_FILTERING
vReflectionFilteringInfo,
#endif
environmentRadiance
);vec3 environmentIrradiance=vec3(0.,0.,0.);
#if (defined(USESPHERICALFROMREFLECTIONMAP) && (!defined(NORMAL) || !defined(USESPHERICALINVERTEX))) || (defined(USEIRRADIANCEMAP) && defined(REFLECTIONMAP_3D0))
#ifdef ANISOTROPIC
vec3 irradianceVector=vec3(reflectionMatrix*vec4(anisotropicOut.anisotropicNormal,0)).xyz;
#else
vec3 irradianceVector=vec3(reflectionMatrix*vec4(normalW,0)).xyz;
#endif
vec3 irradianceView=vec3(reflectionMatrix*vec4(viewDirectionW,0)).xyz;
#if !defined(USE_IRRADIANCE_DOMINANT_DIRECTION) && !defined(REALTIME_FILTERING)
#if BASE_DIFFUSE_MODEL != BRDF_DIFFUSE_MODEL_LAMBERT && BASE_DIFFUSE_MODEL != BRDF_DIFFUSE_MODEL_LEGACY
float NdotV=max(dot(normalW,viewDirectionW),0.0);irradianceVector=mix(irradianceVector,irradianceView,(0.5*(1.0-NdotV))*diffuseRoughness);
#endif
#endif
#ifdef REFLECTIONMAP_OPPOSITEZ0
irradianceVector.z*=-1.0;
#endif
#ifdef INVERTCUBICMAP
irradianceVector.y*=-1.0;
#endif
#endif
#ifdef USESPHERICALFROMREFLECTIONMAP
#if defined(NORMAL) && defined(USESPHERICALINVERTEX)
environmentIrradiance=vEnvironmentIrradiance;
#else
#if defined(REALTIME_FILTERING)
environmentIrradiance=irradiance(reflectionSampler,irradianceVector,vReflectionFilteringInfo,diffuseRoughness,surfaceAlbedo,irradianceView
#ifdef IBL_CDF_FILTERING
,icdfSampler
#endif
);
#else
environmentIrradiance=computeEnvironmentIrradiance(irradianceVector);
#endif
#ifdef SS_TRANSLUCENCY
outParams.irradianceVector=irradianceVector;
#endif
#endif
#elif defined(USEIRRADIANCEMAP)
#ifdef REFLECTIONMAP_3D0
vec4 environmentIrradiance4=sampleReflection(irradianceSampler,irradianceVector);
#else
vec4 environmentIrradiance4=sampleReflection(irradianceSampler,reflectionCoords);
#endif
environmentIrradiance=environmentIrradiance4.rgb;
#ifdef RGBDREFLECTION
environmentIrradiance.rgb=fromRGBD(environmentIrradiance4);
#endif
#ifdef GAMMAREFLECTION
environmentIrradiance.rgb=toLinearSpace(environmentIrradiance.rgb);
#endif
#ifdef USE_IRRADIANCE_DOMINANT_DIRECTION
vec3 Ls=normalize(reflectionDominantDirection);float NoL=dot(irradianceVector,Ls);float NoV=dot(irradianceVector,irradianceView);vec3 diffuseRoughnessTerm=vec3(1.0);
#if BASE_DIFFUSE_MODEL==BRDF_DIFFUSE_MODEL_EON
float LoV=dot (Ls,irradianceView);float mag=length(reflectionDominantDirection)*2.0;vec3 clampedAlbedo=clamp(surfaceAlbedo,vec3(0.1),vec3(1.0));diffuseRoughnessTerm=diffuseBRDF_EON(clampedAlbedo,diffuseRoughness,NoL,NoV,LoV)*PI;diffuseRoughnessTerm=diffuseRoughnessTerm/clampedAlbedo;diffuseRoughnessTerm=mix(vec3(1.0),diffuseRoughnessTerm,sqrt(clamp(mag*NoV,0.0,1.0)));
#elif BASE_DIFFUSE_MODEL==BRDF_DIFFUSE_MODEL_BURLEY
vec3 H=(irradianceView+Ls)*0.5;float VoH=dot(irradianceView,H);diffuseRoughnessTerm=vec3(diffuseBRDF_Burley(NoL,NoV,VoH,diffuseRoughness)*PI);
#endif
environmentIrradiance=environmentIrradiance.rgb*diffuseRoughnessTerm;
#endif
#endif
environmentIrradiance*=vReflectionColor.rgb*vReflectionInfos.x;
#ifdef MIX_IBL_RADIANCE_WITH_IRRADIANCE
outParams.environmentRadiance=vec4(mix(environmentRadiance.rgb,environmentIrradiance,alphaG),environmentRadiance.a);
#else
outParams.environmentRadiance=environmentRadiance;
#endif
outParams.environmentIrradiance=environmentIrradiance;outParams.reflectionCoords=reflectionCoords;return outParams;}
#endif

#ifdef SHEEN
struct sheenOutParams
{float sheenIntensity;vec3 sheenColor;float sheenRoughness;
#ifdef SHEEN_LINKWITHALBEDO
vec3 surfaceAlbedo;
#endif
#if defined(ENVIRONMENTBRDF) && defined(SHEEN_ALBEDOSCALING)
float sheenAlbedoScaling;
#endif
#if defined(REFLECTION) && defined(ENVIRONMENTBRDF)
vec3 finalSheenRadianceScaled;
#endif
#if DEBUGMODE>0
#ifdef SHEEN_TEXTURE
vec4 sheenMapData;
#endif
#if defined(REFLECTION) && defined(ENVIRONMENTBRDF)
vec3 sheenEnvironmentReflectance;
#endif
#endif
};
#define pbr_inline
#define inline
sheenOutParams sheenBlock(
in vec4 vSheenColor
#ifdef SHEEN_ROUGHNESS
,in float vSheenRoughness
#if defined(SHEEN_TEXTURE_ROUGHNESS) && !defined(SHEEN_USE_ROUGHNESS_FROM_MAINTEXTURE)
,in vec4 sheenMapRoughnessData
#endif
#endif
,in float roughness
#ifdef SHEEN_TEXTURE
,in vec4 sheenMapData
,in float sheenMapLevel
#endif
,in float reflectance
#ifdef SHEEN_LINKWITHALBEDO
,in vec3 baseColor
,in vec3 surfaceAlbedo
#endif
#ifdef ENVIRONMENTBRDF
,in float NdotV
,in vec3 environmentBrdf
#endif
#if defined(REFLECTION) && defined(ENVIRONMENTBRDF)
,in vec2 AARoughnessFactors
,in vec3 vReflectionMicrosurfaceInfos
,in vec2 vReflectionInfos
,in vec3 vReflectionColor
,in vec4 vLightingIntensity
#ifdef REFLECTIONMAP_3D0
,in samplerCube reflectionSampler
,in vec3 reflectionCoords
#else
,in sampler2D reflectionSampler
,in vec2 reflectionCoords
#endif
,in float NdotVUnclamped
#ifndef LODBASEDMICROSFURACE
#ifdef REFLECTIONMAP_3D0
,in samplerCube reflectionSamplerLow
,in samplerCube reflectionSamplerHigh
#else
,in sampler2D reflectionSamplerLow
,in sampler2D reflectionSamplerHigh
#endif
#endif
#ifdef REALTIME_FILTERING
,in vec2 vReflectionFilteringInfo
#endif
#if !defined(REFLECTIONMAP_SKYBOX0) && defined(RADIANCEOCCLUSION)
,in float seo
#endif
#if !defined(REFLECTIONMAP_SKYBOX0) && defined(HORIZONOCCLUSION) && defined(BUMP) && defined(REFLECTIONMAP_3D0)
,in float eho
#endif
#endif
)
{sheenOutParams outParams;float sheenIntensity=vSheenColor.a;
#ifdef SHEEN_TEXTURE
#if DEBUGMODE>0
outParams.sheenMapData=sheenMapData;
#endif
#endif
#ifdef SHEEN_LINKWITHALBEDO
float sheenFactor=pow5(1.0-sheenIntensity);vec3 sheenColor=baseColor.rgb*(1.0-sheenFactor);float sheenRoughness=sheenIntensity;outParams.surfaceAlbedo=surfaceAlbedo*sheenFactor;
#ifdef SHEEN_TEXTURE
sheenIntensity*=sheenMapData.a;
#endif
#else
vec3 sheenColor=vSheenColor.rgb;
#ifdef SHEEN_TEXTURE
#ifdef SHEEN_GAMMATEXTURE
sheenColor.rgb*=toLinearSpace(sheenMapData.rgb);
#else
sheenColor.rgb*=sheenMapData.rgb;
#endif
sheenColor.rgb*=sheenMapLevel;
#endif
#ifdef SHEEN_ROUGHNESS
float sheenRoughness=vSheenRoughness;
#ifdef SHEEN_USE_ROUGHNESS_FROM_MAINTEXTURE
#if defined(SHEEN_TEXTURE)
sheenRoughness*=sheenMapData.a;
#endif
#elif defined(SHEEN_TEXTURE_ROUGHNESS)
sheenRoughness*=sheenMapRoughnessData.a;
#endif
#else
float sheenRoughness=roughness;
#ifdef SHEEN_TEXTURE
sheenIntensity*=sheenMapData.a;
#endif
#endif
#if !defined(SHEEN_ALBEDOSCALING)
sheenIntensity*=(1.-reflectance);
#endif
sheenColor*=sheenIntensity;
#endif
#ifdef ENVIRONMENTBRDF
/*#ifdef SHEEN_SOFTER
vec3 environmentSheenBrdf=vec3(0.,0.,getBRDFLookupCharlieSheen(NdotV,sheenRoughness));
#else*/
#ifdef SHEEN_ROUGHNESS
vec3 environmentSheenBrdf=getBRDFLookup(NdotV,sheenRoughness);
#else
vec3 environmentSheenBrdf=environmentBrdf;
#endif
/*#endif*/
#endif
#if defined(REFLECTION) && defined(ENVIRONMENTBRDF)
float sheenAlphaG=convertRoughnessToAverageSlope(sheenRoughness);
#ifdef SPECULARAA
sheenAlphaG+=AARoughnessFactors.y;
#endif
vec4 environmentSheenRadiance=vec4(0.,0.,0.,0.);sampleReflectionTexture(
sheenAlphaG,
vReflectionMicrosurfaceInfos,
vReflectionInfos,
vReflectionColor,
#if defined(LODINREFLECTIONALPHA0) && !defined(REFLECTIONMAP_SKYBOX0)
NdotVUnclamped,
#endif
#ifdef LINEARSPECULARREFLECTION0
sheenRoughness,
#endif
reflectionSampler,
reflectionCoords,
#ifndef LODBASEDMICROSFURACE
reflectionSamplerLow,
reflectionSamplerHigh,
#endif
#ifdef REALTIME_FILTERING
vReflectionFilteringInfo,
#endif
environmentSheenRadiance
);vec3 sheenEnvironmentReflectance=getSheenReflectanceFromBRDFLookup(sheenColor,environmentSheenBrdf);
#if !defined(REFLECTIONMAP_SKYBOX0) && defined(RADIANCEOCCLUSION)
sheenEnvironmentReflectance*=seo;
#endif
#if !defined(REFLECTIONMAP_SKYBOX0) && defined(HORIZONOCCLUSION) && defined(BUMP) && defined(REFLECTIONMAP_3D0)
sheenEnvironmentReflectance*=eho;
#endif
#if DEBUGMODE>0
outParams.sheenEnvironmentReflectance=sheenEnvironmentReflectance;
#endif
outParams.finalSheenRadianceScaled=
environmentSheenRadiance.rgb *
sheenEnvironmentReflectance *
vLightingIntensity.z;
#endif
#if defined(ENVIRONMENTBRDF) && defined(SHEEN_ALBEDOSCALING)
outParams.sheenAlbedoScaling=1.0-sheenIntensity*max(max(sheenColor.r,sheenColor.g),sheenColor.b)*environmentSheenBrdf.b;
#endif
outParams.sheenIntensity=sheenIntensity;outParams.sheenColor=sheenColor;outParams.sheenRoughness=sheenRoughness;return outParams;}
#endif

struct iridescenceOutParams
{float iridescenceIntensity;float iridescenceIOR;float iridescenceThickness;vec3 specularEnvironmentR0;};
#ifdef IRIDESCENCE
#define pbr_inline
#define inline
iridescenceOutParams iridescenceBlock(
in vec4 vIridescenceParams
,in float viewAngle
,in vec3 specularEnvironmentR0
#ifdef IRIDESCENCE_TEXTURE
,in vec2 iridescenceMapData
#endif
#ifdef IRIDESCENCE_THICKNESS_TEXTURE
,in vec2 iridescenceThicknessMapData
#endif
#ifdef CLEARCOAT
,in float NdotVUnclamped
,in vec2 vClearCoatParams
#ifdef CLEARCOAT_TEXTURE
,in vec2 clearCoatMapData
#endif
#endif
)
{iridescenceOutParams outParams;float iridescenceIntensity=vIridescenceParams.x;float iridescenceIOR=vIridescenceParams.y;float iridescenceThicknessMin=vIridescenceParams.z;float iridescenceThicknessMax=vIridescenceParams.w;float iridescenceThicknessWeight=1.;
#ifdef IRIDESCENCE_TEXTURE
iridescenceIntensity*=iridescenceMapData.x;
#endif
#if defined(IRIDESCENCE_THICKNESS_TEXTURE)
iridescenceThicknessWeight=iridescenceThicknessMapData.g;
#endif
float iridescenceThickness=mix(iridescenceThicknessMin,iridescenceThicknessMax,iridescenceThicknessWeight);float topIor=1.; 
#ifdef CLEARCOAT
float clearCoatIntensity=vClearCoatParams.x;
#ifdef CLEARCOAT_TEXTURE
clearCoatIntensity*=clearCoatMapData.x;
#endif
topIor=mix(1.0,vClearCoatRefractionParams.w-1.,clearCoatIntensity);viewAngle=sqrt(1.0+square(1.0/topIor)*(square(NdotVUnclamped)-1.0));
#endif
vec3 iridescenceFresnel=evalIridescence(topIor,iridescenceIOR,viewAngle,iridescenceThickness,specularEnvironmentR0);outParams.specularEnvironmentR0=mix(specularEnvironmentR0,iridescenceFresnel,iridescenceIntensity);outParams.iridescenceIntensity=iridescenceIntensity;outParams.iridescenceThickness=iridescenceThickness;outParams.iridescenceIOR=iridescenceIOR;return outParams;}
#endif

struct clearcoatOutParams
{vec3 specularEnvironmentR0;float conservationFactor;vec3 clearCoatNormalW;vec2 clearCoatAARoughnessFactors;float clearCoatIntensity;float clearCoatRoughness;
#ifdef REFLECTION
vec3 finalClearCoatRadianceScaled;
#endif
#ifdef CLEARCOAT_TINT
vec3 absorption;float clearCoatNdotVRefract;vec3 clearCoatColor;float clearCoatThickness;
#endif
#if defined(ENVIRONMENTBRDF) && defined(MS_BRDF_ENERGY_CONSERVATION)
vec3 energyConservationFactorClearCoat;
#endif
#if DEBUGMODE>0
#ifdef CLEARCOAT_BUMP
mat3 TBNClearCoat;
#endif
#ifdef CLEARCOAT_TEXTURE
vec2 clearCoatMapData;
#endif
#if defined(CLEARCOAT_TINT) && defined(CLEARCOAT_TINT_TEXTURE)
vec4 clearCoatTintMapData;
#endif
#ifdef REFLECTION
vec4 environmentClearCoatRadiance;vec3 clearCoatEnvironmentReflectance;
#endif
float clearCoatNdotV;
#endif
};
#ifdef CLEARCOAT
#define pbr_inline
#define inline
clearcoatOutParams clearcoatBlock(
in vec3 vPositionW
,in vec3 geometricNormalW
,in vec3 viewDirectionW
,in vec2 vClearCoatParams
#if defined(CLEARCOAT_TEXTURE_ROUGHNESS) && !defined(CLEARCOAT_TEXTURE_ROUGHNESS_IDENTICAL) && !defined(CLEARCOAT_USE_ROUGHNESS_FROM_MAINTEXTURE)
,in vec4 clearCoatMapRoughnessData
#endif
,in vec3 specularEnvironmentR0
#ifdef CLEARCOAT_TEXTURE
,in vec2 clearCoatMapData
#endif
#ifdef CLEARCOAT_TINT
,in vec4 vClearCoatTintParams
,in float clearCoatColorAtDistance
,in vec4 vClearCoatRefractionParams
#ifdef CLEARCOAT_TINT_TEXTURE
,in vec4 clearCoatTintMapData
#endif
#endif
#ifdef CLEARCOAT_BUMP
,in vec2 vClearCoatBumpInfos
,in vec4 clearCoatBumpMapData
,in vec2 vClearCoatBumpUV
#if defined(IGNORE) && defined(NORMAL)
,in mat3 vTBN
#else
,in vec2 vClearCoatTangentSpaceParams
#endif
#ifdef OBJECTSPACE_NORMALMAP
,in mat4 normalMatrix
#endif
#endif
#if defined(FORCENORMALFORWARD) && defined(NORMAL)
,in vec3 faceNormal
#endif
#ifdef REFLECTION
,in vec3 vReflectionMicrosurfaceInfos
,in vec2 vReflectionInfos
,in vec3 vReflectionColor
,in vec4 vLightingIntensity
#ifdef REFLECTIONMAP_3D0
,in samplerCube reflectionSampler
#else
,in sampler2D reflectionSampler
#endif
#ifndef LODBASEDMICROSFURACE
#ifdef REFLECTIONMAP_3D0
,in samplerCube reflectionSamplerLow
,in samplerCube reflectionSamplerHigh
#else
,in sampler2D reflectionSamplerLow
,in sampler2D reflectionSamplerHigh
#endif
#endif
#ifdef REALTIME_FILTERING
,in vec2 vReflectionFilteringInfo
#endif
#endif
#if defined(CLEARCOAT_BUMP) || defined(TWOSIDEDLIGHTING)
,in float frontFacingMultiplier
#endif
)
{clearcoatOutParams outParams;float clearCoatIntensity=vClearCoatParams.x;float clearCoatRoughness=vClearCoatParams.y;
#ifdef CLEARCOAT_TEXTURE
clearCoatIntensity*=clearCoatMapData.x;
#ifdef CLEARCOAT_USE_ROUGHNESS_FROM_MAINTEXTURE
clearCoatRoughness*=clearCoatMapData.y;
#endif
#if DEBUGMODE>0
outParams.clearCoatMapData=clearCoatMapData;
#endif
#endif
#if defined(CLEARCOAT_TEXTURE_ROUGHNESS) && !defined(CLEARCOAT_USE_ROUGHNESS_FROM_MAINTEXTURE)
clearCoatRoughness*=clearCoatMapRoughnessData.y;
#endif
outParams.clearCoatIntensity=clearCoatIntensity;outParams.clearCoatRoughness=clearCoatRoughness;
#ifdef CLEARCOAT_TINT
vec3 clearCoatColor=vClearCoatTintParams.rgb;float clearCoatThickness=vClearCoatTintParams.a;
#ifdef CLEARCOAT_TINT_TEXTURE
#ifdef CLEARCOAT_TINT_GAMMATEXTURE
clearCoatColor*=toLinearSpace(clearCoatTintMapData.rgb);
#else
clearCoatColor*=clearCoatTintMapData.rgb;
#endif
clearCoatThickness*=clearCoatTintMapData.a;
#if DEBUGMODE>0
outParams.clearCoatTintMapData=clearCoatTintMapData;
#endif
#endif
outParams.clearCoatColor=computeColorAtDistanceInMedia(clearCoatColor,clearCoatColorAtDistance);outParams.clearCoatThickness=clearCoatThickness;
#endif
#ifdef CLEARCOAT_REMAP_F0
vec3 specularEnvironmentR0Updated=getR0RemappedForClearCoat(specularEnvironmentR0);
#else
vec3 specularEnvironmentR0Updated=specularEnvironmentR0;
#endif
outParams.specularEnvironmentR0=mix(specularEnvironmentR0,specularEnvironmentR0Updated,clearCoatIntensity);vec3 clearCoatNormalW=geometricNormalW;
#ifdef CLEARCOAT_BUMP
#ifdef NORMALXYSCALE
float clearCoatNormalScale=1.0;
#else
float clearCoatNormalScale=vClearCoatBumpInfos.y;
#endif
#if defined(IGNORE) && defined(NORMAL)
mat3 TBNClearCoat=vTBN;
#else
vec2 TBNClearCoatUV=vClearCoatBumpUV*frontFacingMultiplier;mat3 TBNClearCoat=cotangent_frame(clearCoatNormalW*clearCoatNormalScale,vPositionW,TBNClearCoatUV,vClearCoatTangentSpaceParams);
#endif
#if DEBUGMODE>0
outParams.TBNClearCoat=TBNClearCoat;
#endif
#ifdef OBJECTSPACE_NORMALMAP
clearCoatNormalW=normalize(clearCoatBumpMapData.xyz *2.0-1.0);clearCoatNormalW=normalize(mat3(normalMatrix)*clearCoatNormalW);
#else
clearCoatNormalW=perturbNormal(TBNClearCoat,clearCoatBumpMapData.xyz,vClearCoatBumpInfos.y);
#endif
#endif
#if defined(FORCENORMALFORWARD) && defined(NORMAL)
clearCoatNormalW*=sign(dot(clearCoatNormalW,faceNormal));
#endif
#if defined(TWOSIDEDLIGHTING) && defined(NORMAL)
clearCoatNormalW=clearCoatNormalW*frontFacingMultiplier;
#endif
outParams.clearCoatNormalW=clearCoatNormalW;outParams.clearCoatAARoughnessFactors=getAARoughnessFactors(clearCoatNormalW.xyz);float clearCoatNdotVUnclamped=dot(clearCoatNormalW,viewDirectionW);float clearCoatNdotV=absEps(clearCoatNdotVUnclamped);
#if DEBUGMODE>0
outParams.clearCoatNdotV=clearCoatNdotV;
#endif
#ifdef CLEARCOAT_TINT
vec3 clearCoatVRefract=refract(-viewDirectionW,clearCoatNormalW,vClearCoatRefractionParams.y);outParams.clearCoatNdotVRefract=absEps(dot(clearCoatNormalW,clearCoatVRefract));
#endif
#if defined(ENVIRONMENTBRDF) && (!defined(REFLECTIONMAP_SKYBOX0) || defined(MS_BRDF_ENERGY_CONSERVATION))
vec3 environmentClearCoatBrdf=getBRDFLookup(clearCoatNdotV,clearCoatRoughness);
#endif
#if defined(REFLECTION)
float clearCoatAlphaG=convertRoughnessToAverageSlope(clearCoatRoughness);
#ifdef SPECULARAA
clearCoatAlphaG+=outParams.clearCoatAARoughnessFactors.y;
#endif
vec4 environmentClearCoatRadiance=vec4(0.,0.,0.,0.);vec3 clearCoatReflectionVector=computeReflectionCoordsPBR(vec4(vPositionW,1.0),clearCoatNormalW);
#ifdef REFLECTIONMAP_OPPOSITEZ0
clearCoatReflectionVector.z*=-1.0;
#endif
#ifdef REFLECTIONMAP_3D0
vec3 clearCoatReflectionCoords=clearCoatReflectionVector;
#else
vec2 clearCoatReflectionCoords=clearCoatReflectionVector.xy;
#ifdef REFLECTIONMAP_PROJECTION0
clearCoatReflectionCoords/=clearCoatReflectionVector.z;
#endif
clearCoatReflectionCoords.y=1.0-clearCoatReflectionCoords.y;
#endif
sampleReflectionTexture(
clearCoatAlphaG,
vReflectionMicrosurfaceInfos,
vReflectionInfos,
vReflectionColor,
#if defined(LODINREFLECTIONALPHA0) && !defined(REFLECTIONMAP_SKYBOX0)
clearCoatNdotVUnclamped,
#endif
#ifdef LINEARSPECULARREFLECTION0
clearCoatRoughness,
#endif
reflectionSampler,
clearCoatReflectionCoords,
#ifndef LODBASEDMICROSFURACE
reflectionSamplerLow,
reflectionSamplerHigh,
#endif
#ifdef REALTIME_FILTERING
vReflectionFilteringInfo,
#endif
environmentClearCoatRadiance
);
#if DEBUGMODE>0
outParams.environmentClearCoatRadiance=environmentClearCoatRadiance;
#endif
#if defined(ENVIRONMENTBRDF) && !defined(REFLECTIONMAP_SKYBOX0)
vec3 clearCoatEnvironmentReflectance=getReflectanceFromBRDFLookup(vec3(vClearCoatRefractionParams.x),environmentClearCoatBrdf);
#ifdef HORIZONOCCLUSION
#ifdef BUMP
#ifdef REFLECTIONMAP_3D0
float clearCoatEho=environmentHorizonOcclusion(-viewDirectionW,clearCoatNormalW,geometricNormalW);clearCoatEnvironmentReflectance*=clearCoatEho;
#endif
#endif
#endif
#else
vec3 clearCoatEnvironmentReflectance=getReflectanceFromAnalyticalBRDFLookup_Jones(clearCoatNdotV,vec3(1.),vec3(1.),sqrt(1.-clearCoatRoughness));
#endif
clearCoatEnvironmentReflectance*=clearCoatIntensity;
#if DEBUGMODE>0
outParams.clearCoatEnvironmentReflectance=clearCoatEnvironmentReflectance;
#endif
outParams.finalClearCoatRadianceScaled=
environmentClearCoatRadiance.rgb *
clearCoatEnvironmentReflectance *
vLightingIntensity.z;
#endif
#if defined(CLEARCOAT_TINT)
outParams.absorption=computeClearCoatAbsorption(outParams.clearCoatNdotVRefract,outParams.clearCoatNdotVRefract,outParams.clearCoatColor,clearCoatThickness,clearCoatIntensity);
#endif
float fresnelIBLClearCoat=fresnelSchlickGGX(clearCoatNdotV,vClearCoatRefractionParams.x,CLEARCOATREFLECTANCE90);fresnelIBLClearCoat*=clearCoatIntensity;outParams.conservationFactor=(1.-fresnelIBLClearCoat);
#if defined(ENVIRONMENTBRDF) && defined(MS_BRDF_ENERGY_CONSERVATION)
outParams.energyConservationFactorClearCoat=getEnergyConservationFactor(outParams.specularEnvironmentR0,environmentClearCoatBrdf);
#endif
return outParams;}
#endif


                #ifdef SS_REFRACTIONMAP_3D0
                    #define sampleRefraction(s, c) textureCube(s, c)
                #else
                    #define sampleRefraction(s, c) texture2D(s, c)
                #endif


                #ifdef SS_REFRACTIONMAP_3D0
                    #define sampleRefractionLod(s, c, l) textureCubeLodEXT(s, c, l)
                #else
                    #define sampleRefractionLod(s, c, l) texture2DLodEXT(s, c, l)
                #endif

struct subSurfaceOutParams
{vec3 specularEnvironmentReflectance;
#ifdef SS_REFRACTION
vec3 finalRefraction;vec3 surfaceAlbedo;
#ifdef SS_LINKREFRACTIONTOTRANSPARENCY
float alpha;
#endif
float refractionOpacity;
#endif
#ifdef SS_TRANSLUCENCY
vec3 transmittance;float translucencyIntensity;
#ifdef REFLECTION
vec3 refractionIrradiance;
#endif
#endif
#if DEBUGMODE>0
#ifdef SS_THICKNESSANDMASK_TEXTURE
vec4 thicknessMap;
#endif
#ifdef SS_REFRACTION
vec4 environmentRefraction;vec3 refractionTransmittance;
#endif
#endif
};
#ifdef SUBSURFACE
#ifdef SS_REFRACTION
#define pbr_inline
#define inline
vec4 sampleEnvironmentRefraction(
in float ior
,in float thickness
,in float refractionLOD
,in vec3 normalW
,in vec3 vPositionW
,in vec3 viewDirectionW
,in mat4 view
,in vec4 vRefractionInfos
,in mat4 refractionMatrix
,in vec4 vRefractionMicrosurfaceInfos
,in float alphaG
#ifdef SS_REFRACTIONMAP_3D0
,in samplerCube refractionSampler
#ifndef LODBASEDMICROSFURACE
,in samplerCube refractionSamplerLow
,in samplerCube refractionSamplerHigh
#endif
#else
,in sampler2D refractionSampler
#ifndef LODBASEDMICROSFURACE
,in sampler2D refractionSamplerLow
,in sampler2D refractionSamplerHigh
#endif
#endif
#ifdef ANISOTROPIC
,in anisotropicOutParams anisotropicOut
#endif
#ifdef REALTIME_FILTERING
,in vec2 vRefractionFilteringInfo
#endif
#ifdef SS_USE_LOCAL_REFRACTIONMAP_CUBIC
,in vec3 refractionPosition
,in vec3 refractionSize
#endif
) {vec4 environmentRefraction=vec4(0.,0.,0.,0.);
#ifdef ANISOTROPIC
vec3 refractionVector=refract(-viewDirectionW,anisotropicOut.anisotropicNormal,ior);
#else
vec3 refractionVector=refract(-viewDirectionW,normalW,ior);
#endif
#ifdef SS_REFRACTIONMAP_OPPOSITEZ0
refractionVector.z*=-1.0;
#endif
#ifdef SS_REFRACTIONMAP_3D0
#ifdef SS_USE_LOCAL_REFRACTIONMAP_CUBIC
refractionVector=parallaxCorrectNormal(vPositionW,refractionVector,refractionSize,refractionPosition);
#endif
refractionVector.y=refractionVector.y*vRefractionInfos.w;vec3 refractionCoords=refractionVector;refractionCoords=vec3(refractionMatrix*vec4(refractionCoords,0));
#else
#ifdef SS_USE_THICKNESS_AS_DEPTH
vec3 vRefractionUVW=vec3(refractionMatrix*(view*vec4(vPositionW+refractionVector*thickness,1.0)));
#else
vec3 vRefractionUVW=vec3(refractionMatrix*(view*vec4(vPositionW+refractionVector*vRefractionInfos.z,1.0)));
#endif
vec2 refractionCoords=vRefractionUVW.xy/vRefractionUVW.z;refractionCoords.y=1.0-refractionCoords.y;
#endif
#ifdef LODBASEDMICROSFURACE
refractionLOD=refractionLOD*vRefractionMicrosurfaceInfos.y+vRefractionMicrosurfaceInfos.z;
#ifdef SS_LODINREFRACTIONALPHA0
float automaticRefractionLOD=UNPACK_LOD(sampleRefraction(refractionSampler,refractionCoords).a);float requestedRefractionLOD=max(automaticRefractionLOD,refractionLOD);
#else
float requestedRefractionLOD=refractionLOD;
#endif
#if defined(REALTIME_FILTERING) && defined(SS_REFRACTIONMAP_3D0)
environmentRefraction=vec4(radiance(alphaG,refractionSampler,refractionCoords,vRefractionFilteringInfo),1.0);
#else
environmentRefraction=sampleRefractionLod(refractionSampler,refractionCoords,requestedRefractionLOD);
#endif
#else
float lodRefractionNormalized=saturate(refractionLOD/log2(vRefractionMicrosurfaceInfos.x));float lodRefractionNormalizedDoubled=lodRefractionNormalized*2.0;vec4 environmentRefractionMid=sampleRefraction(refractionSampler,refractionCoords);if (lodRefractionNormalizedDoubled<1.0){environmentRefraction=mix(
sampleRefraction(refractionSamplerHigh,refractionCoords),
environmentRefractionMid,
lodRefractionNormalizedDoubled
);} else {environmentRefraction=mix(
environmentRefractionMid,
sampleRefraction(refractionSamplerLow,refractionCoords),
lodRefractionNormalizedDoubled-1.0
);}
#endif
#ifdef SS_RGBDREFRACTION
environmentRefraction.rgb=fromRGBD(environmentRefraction);
#endif
#ifdef SS_GAMMAREFRACTION
environmentRefraction.rgb=toLinearSpace(environmentRefraction.rgb);
#endif
return environmentRefraction;}
#endif
#define pbr_inline
#define inline
subSurfaceOutParams subSurfaceBlock(
in vec3 vSubSurfaceIntensity
,in vec2 vThicknessParam
,in vec4 vTintColor
,in vec3 normalW
,in vec3 vSpecularEnvironmentReflectance
#ifdef SS_THICKNESSANDMASK_TEXTURE
,in vec4 thicknessMap
#endif
#ifdef SS_REFRACTIONINTENSITY_TEXTURE
,in vec4 refractionIntensityMap
#endif
#ifdef SS_TRANSLUCENCYINTENSITY_TEXTURE
,in vec4 translucencyIntensityMap
#endif
#ifdef REFLECTION
#ifdef SS_TRANSLUCENCY
,in mat4 reflectionMatrix
#ifdef USESPHERICALFROMREFLECTIONMAP
#if !defined(NORMAL) || !defined(USESPHERICALINVERTEX)
,in vec3 irradianceVector_
#endif
#if defined(REALTIME_FILTERING)
,in samplerCube reflectionSampler
,in vec2 vReflectionFilteringInfo
#ifdef IBL_CDF_FILTERING
,in sampler2D icdfSampler
#endif
#endif
#endif
#ifdef USEIRRADIANCEMAP
#ifdef REFLECTIONMAP_3D0
,in samplerCube irradianceSampler
#else
,in sampler2D irradianceSampler
#endif
#endif
#endif
#endif
#if defined(SS_REFRACTION) || defined(SS_TRANSLUCENCY)
,in vec3 surfaceAlbedo
#endif
#ifdef SS_REFRACTION
,in vec3 vPositionW
,in vec3 viewDirectionW
,in mat4 view
,in vec4 vRefractionInfos
,in mat4 refractionMatrix
,in vec4 vRefractionMicrosurfaceInfos
,in vec4 vLightingIntensity
#ifdef SS_LINKREFRACTIONTOTRANSPARENCY
,in float alpha
#endif
#ifdef SS_LODINREFRACTIONALPHA0
,in float NdotVUnclamped
#endif
#ifdef SS_LINEARSPECULARREFRACTION0
,in float roughness
#endif
,in float alphaG
#ifdef SS_REFRACTIONMAP_3D0
,in samplerCube refractionSampler
#ifndef LODBASEDMICROSFURACE
,in samplerCube refractionSamplerLow
,in samplerCube refractionSamplerHigh
#endif
#else
,in sampler2D refractionSampler
#ifndef LODBASEDMICROSFURACE
,in sampler2D refractionSamplerLow
,in sampler2D refractionSamplerHigh
#endif
#endif
#ifdef ANISOTROPIC
,in anisotropicOutParams anisotropicOut
#endif
#ifdef REALTIME_FILTERING
,in vec2 vRefractionFilteringInfo
#endif
#ifdef SS_USE_LOCAL_REFRACTIONMAP_CUBIC
,in vec3 refractionPosition
,in vec3 refractionSize
#endif
#ifdef SS_DISPERSION
,in float dispersion
#endif
#endif
#ifdef SS_TRANSLUCENCY
,in vec3 vDiffusionDistance
,in vec4 vTranslucencyColor
#ifdef SS_TRANSLUCENCYCOLOR_TEXTURE
,in vec4 translucencyColorMap
#endif
#endif
)
{subSurfaceOutParams outParams;outParams.specularEnvironmentReflectance=vSpecularEnvironmentReflectance;
#ifdef SS_REFRACTION
float refractionIntensity=vSubSurfaceIntensity.x;
#ifdef SS_LINKREFRACTIONTOTRANSPARENCY
refractionIntensity*=(1.0-alpha);outParams.alpha=1.0;
#endif
#endif
#ifdef SS_TRANSLUCENCY
float translucencyIntensity=vSubSurfaceIntensity.y;
#endif
#ifdef SS_THICKNESSANDMASK_TEXTURE
#ifdef SS_USE_GLTF_TEXTURES
float thickness=thicknessMap.g*vThicknessParam.y+vThicknessParam.x;
#else
float thickness=thicknessMap.r*vThicknessParam.y+vThicknessParam.x;
#endif
#if DEBUGMODE>0
outParams.thicknessMap=thicknessMap;
#endif
#if defined(SS_REFRACTION) && defined(SS_REFRACTION_USE_INTENSITY_FROM_THICKNESS)
#ifdef SS_USE_GLTF_TEXTURES
refractionIntensity*=thicknessMap.r;
#else
refractionIntensity*=thicknessMap.g;
#endif
#endif
#if defined(SS_TRANSLUCENCY) && defined(SS_TRANSLUCENCY_USE_INTENSITY_FROM_THICKNESS)
#ifdef SS_USE_GLTF_TEXTURES
translucencyIntensity*=thicknessMap.a;
#else
translucencyIntensity*=thicknessMap.b;
#endif
#endif
#else
float thickness=vThicknessParam.y;
#endif
#if defined(SS_REFRACTION) && defined(SS_REFRACTIONINTENSITY_TEXTURE)
#ifdef SS_USE_GLTF_TEXTURES
refractionIntensity*=refractionIntensityMap.r;
#else
refractionIntensity*=refractionIntensityMap.g;
#endif
#endif
#if defined(SS_TRANSLUCENCY) && defined(SS_TRANSLUCENCYINTENSITY_TEXTURE)
#ifdef SS_USE_GLTF_TEXTURES
translucencyIntensity*=translucencyIntensityMap.a;
#else
translucencyIntensity*=translucencyIntensityMap.b;
#endif
#endif
#ifdef SS_TRANSLUCENCY
thickness=maxEps(thickness);vec4 translucencyColor=vTranslucencyColor;
#ifdef SS_TRANSLUCENCYCOLOR_TEXTURE
translucencyColor*=translucencyColorMap;
#endif
vec3 transmittance=transmittanceBRDF_Burley(translucencyColor.rgb,vDiffusionDistance,thickness);transmittance*=translucencyIntensity;outParams.transmittance=transmittance;outParams.translucencyIntensity=translucencyIntensity;
#endif
#ifdef SS_REFRACTION
vec4 environmentRefraction=vec4(0.,0.,0.,0.);
#ifdef SS_HAS_THICKNESS
float ior=vRefractionInfos.y;
#else
float ior=vRefractionMicrosurfaceInfos.w;
#endif
#ifdef SS_LODINREFRACTIONALPHA0
float refractionAlphaG=alphaG;refractionAlphaG=mix(alphaG,0.0,clamp(ior*3.0-2.0,0.0,1.0));float refractionLOD=getLodFromAlphaG(vRefractionMicrosurfaceInfos.x,refractionAlphaG,NdotVUnclamped);
#elif defined(SS_LINEARSPECULARREFRACTION0)
float refractionRoughness=alphaG;refractionRoughness=mix(alphaG,0.0,clamp(ior*3.0-2.0,0.0,1.0));float refractionLOD=getLinearLodFromRoughness(vRefractionMicrosurfaceInfos.x,refractionRoughness);
#else
float refractionAlphaG=alphaG;refractionAlphaG=mix(alphaG,0.0,clamp(ior*3.0-2.0,0.0,1.0));float refractionLOD=getLodFromAlphaG(vRefractionMicrosurfaceInfos.x,refractionAlphaG);
#endif
float refraction_ior=vRefractionInfos.y;
#ifdef SS_DISPERSION
float realIOR=1.0/refraction_ior;float iorDispersionSpread=0.04*dispersion*(realIOR-1.0);vec3 iors=vec3(1.0/(realIOR-iorDispersionSpread),refraction_ior,1.0/(realIOR+iorDispersionSpread));for (int i=0; i<3; i++) {refraction_ior=iors[i];
#endif
vec4 envSample=sampleEnvironmentRefraction(refraction_ior,thickness,refractionLOD,normalW,vPositionW,viewDirectionW,view,vRefractionInfos,refractionMatrix,vRefractionMicrosurfaceInfos,alphaG
#ifdef SS_REFRACTIONMAP_3D0
,refractionSampler
#ifndef LODBASEDMICROSFURACE
,refractionSamplerLow
,refractionSamplerHigh
#endif
#else
,refractionSampler
#ifndef LODBASEDMICROSFURACE
,refractionSamplerLow
,refractionSamplerHigh
#endif
#endif
#ifdef ANISOTROPIC
,anisotropicOut
#endif
#ifdef REALTIME_FILTERING
,vRefractionFilteringInfo
#endif
#ifdef SS_USE_LOCAL_REFRACTIONMAP_CUBIC
,refractionPosition
,refractionSize
#endif
);
#ifdef SS_DISPERSION
environmentRefraction[i]=envSample[i];}
#else
environmentRefraction=envSample;
#endif
environmentRefraction.rgb*=vRefractionInfos.x;
#endif
#ifdef SS_REFRACTION
vec3 refractionTransmittance=vec3(refractionIntensity);
#ifdef SS_THICKNESSANDMASK_TEXTURE
vec3 volumeAlbedo=computeColorAtDistanceInMedia(vTintColor.rgb,vTintColor.w);refractionTransmittance*=cocaLambert(volumeAlbedo,thickness);
#elif defined(SS_LINKREFRACTIONTOTRANSPARENCY)
float maxChannel=max(max(surfaceAlbedo.r,surfaceAlbedo.g),surfaceAlbedo.b);vec3 volumeAlbedo=saturate(maxChannel*surfaceAlbedo);environmentRefraction.rgb*=volumeAlbedo;
#else
vec3 volumeAlbedo=computeColorAtDistanceInMedia(vTintColor.rgb,vTintColor.w);refractionTransmittance*=cocaLambert(volumeAlbedo,vThicknessParam.y);
#endif
#ifdef SS_ALBEDOFORREFRACTIONTINT
environmentRefraction.rgb*=surfaceAlbedo.rgb;
#endif
outParams.surfaceAlbedo=surfaceAlbedo;outParams.refractionOpacity=1.-refractionIntensity;
#ifdef LEGACY_SPECULAR_ENERGY_CONSERVATION
outParams.surfaceAlbedo*=outParams.refractionOpacity;
#endif
#ifdef UNUSED_MULTIPLEBOUNCES
vec3 bounceSpecularEnvironmentReflectance=(2.0*vSpecularEnvironmentReflectance)/(1.0+vSpecularEnvironmentReflectance);outParams.specularEnvironmentReflectance=mix(bounceSpecularEnvironmentReflectance,vSpecularEnvironmentReflectance,refractionIntensity);
#endif
#if DEBUGMODE>0
outParams.refractionTransmittance=refractionTransmittance;
#endif
outParams.finalRefraction=environmentRefraction.rgb*refractionTransmittance*vLightingIntensity.z;outParams.finalRefraction*=vec3(1.0)-vSpecularEnvironmentReflectance;
#if DEBUGMODE>0
outParams.environmentRefraction=environmentRefraction;
#endif
#endif
#if defined(REFLECTION) && defined(SS_TRANSLUCENCY)
#if defined(NORMAL) && defined(USESPHERICALINVERTEX) || !defined(USESPHERICALFROMREFLECTIONMAP)
vec3 irradianceVector=vec3(reflectionMatrix*vec4(normalW,0)).xyz;
#ifdef REFLECTIONMAP_OPPOSITEZ0
irradianceVector.z*=-1.0;
#endif
#ifdef INVERTCUBICMAP
irradianceVector.y*=-1.0;
#endif
#else
vec3 irradianceVector=irradianceVector_;
#endif
#if defined(USESPHERICALFROMREFLECTIONMAP)
#if defined(REALTIME_FILTERING)
vec3 refractionIrradiance=irradiance(reflectionSampler,-irradianceVector,vReflectionFilteringInfo,0.0,surfaceAlbedo,irradianceVector
#ifdef IBL_CDF_FILTERING
,icdfSampler
#endif
);
#else
vec3 refractionIrradiance=computeEnvironmentIrradiance(-irradianceVector);
#endif
#elif defined(USEIRRADIANCEMAP)
#ifdef REFLECTIONMAP_3D0
vec3 irradianceCoords=irradianceVector;
#else
vec2 irradianceCoords=irradianceVector.xy;
#ifdef REFLECTIONMAP_PROJECTION0
irradianceCoords/=irradianceVector.z;
#endif
irradianceCoords.y=1.0-irradianceCoords.y;
#endif
vec4 refractionIrradiance=sampleReflection(irradianceSampler,-irradianceCoords);
#ifdef RGBDREFLECTION
refractionIrradiance.rgb=fromRGBD(refractionIrradiance);
#endif
#ifdef GAMMAREFLECTION
refractionIrradiance.rgb=toLinearSpace(refractionIrradiance.rgb);
#endif
#else
vec4 refractionIrradiance=vec4(0.);
#endif
refractionIrradiance.rgb*=transmittance;
#ifdef SS_ALBEDOFORTRANSLUCENCYTINT
refractionIrradiance.rgb*=surfaceAlbedo.rgb;
#endif
outParams.refractionIrradiance=refractionIrradiance.rgb;
#endif
return outParams;}
#endif



const float u_Float = 1.0;
const vec2 u_Vector = vec2(0.5, 0.5);


void main(void) {
#ifdef UVTRANSFORM0
vec4 tempTextureRead11 = texture2D(BumptextureTexture, transformedUV);
#elif defined(VMAINUV)
vec4 tempTextureRead11 = texture2D(BumptextureTexture, vMainuv);
#endif
vec3 rgb = tempTextureRead11.rgb * textureInfoName;
#ifdef ISGAMMA11
                rgb = toLinearSpace(rgb);
                #endif
            vec3 tempOutput = vec3(0.);
vec2 uvOffset=vec2(0.0,0.0);
#if defined(BUMP) || defined(PARALLAX) || defined(DETAIL)
#ifdef NORMALXYSCALE
float normalScale=1.0;
#elif defined(BUMP)
float normalScale=
#if !defined(NORMALXYSCALE)
1.0/
#endif
u_Bumpstrength;
#else
float normalScale=1.0;
#endif
#if defined(IGNORE) && defined(NORMAL)
mat3 TBN=vTBN;
#elif defined(BUMP)
vec2 TBNUV=gl_FrontFacing ? v_uv : -v_uv;mat3 TBN=cotangent_frame(v_output2.xyz*normalScale,v_output1.xyz,TBNUV,tangentSpaceParameter0);
#else
vec2 TBNUV=gl_FrontFacing ? vDetailUV : -vDetailUV;mat3 TBN=cotangent_frame(v_output2.xyz*normalScale,v_output1.xyz,TBNUV,vec2(1.,1.));
#endif
#elif defined(ANISOTROPIC)
#if defined(IGNORE) && defined(NORMAL)
mat3 TBN=vTBN;
#else
vec2 TBNUV=gl_FrontFacing ? vMainUV1 : -vMainUV1;mat3 TBN=cotangent_frame(v_output2.xyz,v_output1.xyz,TBNUV,vec2(1.,1.));
#endif
#endif
#ifdef PARALLAX
mat3 invTBN=transposeMat3(TBN);
#ifdef PARALLAXOCCLUSION
uvOffset=parallaxOcclusion((invTBN * -vec3(0.)), (invTBN * v_output2.xyz), v_uv, 0.05, bumpSampler);
#else
uvOffset=parallaxOffset(invTBN * vec3(0.), 0.05, 0.);
#endif
#endif
#ifdef DETAIL
vec4 detailColor=texture2D(detailSampler,vDetailUV+uvOffset);vec2 detailNormalRG=detailColor.wy*2.0-1.0;float detailNormalB=sqrt(1.-saturate(dot(detailNormalRG,detailNormalRG)));vec3 detailNormal=vec3(detailNormalRG,detailNormalB);
#endif
#ifdef BUMP
#ifdef OBJECTSPACE_NORMALMAP
mat4 normalMatrix = toNormalMatrix(perturbNormalWorldMatrix0);
tempOutput = normalize(rgb.xyz *2.0-1.0);tempOutput = normalize(mat3(normalMatrix) * tempOutput);
#elif !defined(DETAIL)
tempOutput = perturbNormal(TBN, rgb, 
#if !defined(NORMALXYSCALE)
1.0/
#endif
u_Bumpstrength);
#else
vec3 bumpNormal=texture2D(bumpSampler,v_uv+uvOffset).xyz*2.0-1.0;
#if DETAIL_NORMALBLENDMETHOD==0 
detailNormal.xy*=vDetailInfos.z;vec3 blendedNormal=normalize(vec3(bumpNormal.xy+detailNormal.xy,bumpNormal.z*detailNormal.z));
#elif DETAIL_NORMALBLENDMETHOD==1 
detailNormal.xy*=vDetailInfos.z;bumpNormal+=vec3(0.0,0.0,1.0);detailNormal*=vec3(-1.0,-1.0,1.0);vec3 blendedNormal=bumpNormal*dot(bumpNormal,detailNormal)/bumpNormal.z-detailNormal;
#endif
tempOutput = perturbNormalBase(TBN,blendedNormal,
#if !defined(NORMALXYSCALE)
1.0/
#endif
u_Bumpstrength);
#endif
#elif defined(DETAIL)
detailNormal.xy*=vDetailInfos.z;tempOutput = perturbNormalBase(TBN,detailNormal,vDetailInfos.z);
#endif

vec4 output3 = vec4(tempOutput, 0.);
#ifdef UVTRANSFORM1
vec4 tempTextureRead12 = texture2D(AlbedotextureTexture, transformedUV1);
#elif defined(VMAINUV)
vec4 tempTextureRead12 = texture2D(AlbedotextureTexture, vMainuv);
#endif
vec3 rgb1 = tempTextureRead12.rgb * textureInfoName1;
#ifdef ISGAMMA12
                rgb1 = toLinearSpace(rgb1);
                #endif
            #ifdef UVTRANSFORM2
vec4 tempTextureRead13 = texture2D(MetallicRoughnesstextureTexture, transformedUV2);
#elif defined(VMAINUV)
vec4 tempTextureRead13 = texture2D(MetallicRoughnesstextureTexture, vMainuv);
#endif
float g2 = tempTextureRead13.g * textureInfoName2;
#ifdef ISGAMMA13
                g2 = toLinearSpace(g2);
                #endif
            float output4 = u_Roughness * g2;
#ifdef UVTRANSFORM3
vec4 tempTextureRead14 = texture2D(AOtextureTexture, transformedUV3);
#elif defined(VMAINUV)
vec4 tempTextureRead14 = texture2D(AOtextureTexture, vMainuv);
#endif
float r3 = tempTextureRead14.r * textureInfoName3;
#ifdef ISGAMMA14
                r3 = toLinearSpace(r3);
                #endif
            float output5 = mix(u_Float , r3, u_AOintensity);
#ifdef UVTRANSFORM4
vec4 tempTextureRead15 = texture2D(OpacitytextureTexture, transformedUV4);
#elif defined(VMAINUV)
vec4 tempTextureRead15 = texture2D(OpacitytextureTexture, vMainuv);
#endif
float a4 = tempTextureRead15.a * textureInfoName4;
#ifdef UVTRANSFORM5
vec4 tempTextureRead16 = texture2D(ClearCoattextureTexture, transformedUV5);
#elif defined(VMAINUV)
vec4 tempTextureRead16 = texture2D(ClearCoattextureTexture, vMainuv);
#endif
float r5 = tempTextureRead16.r * textureInfoName5;
#ifdef ISGAMMA16
                r5 = toLinearSpace(r5);
                #endif
            float g5 = tempTextureRead16.g * textureInfoName5;
#ifdef ISGAMMA16
                g5 = toLinearSpace(g5);
                #endif
            float output6 = u_ClearCoatroughness * g5;
#ifdef UVTRANSFORM6
vec4 tempTextureRead17 = texture2D(ClearCoatbumptextureTexture, transformedUV6);
#elif defined(VMAINUV)
vec4 tempTextureRead17 = texture2D(ClearCoatbumptextureTexture, vMainuv);
#endif
vec3 rgb6 = tempTextureRead17.rgb * textureInfoName6;
#ifdef ISGAMMA17
                rgb6 = toLinearSpace(rgb6);
                #endif
            #ifdef UVTRANSFORM7
vec4 tempTextureRead18 = texture2D(ClearCoattinttextureTexture, transformedUV7);
#elif defined(VMAINUV)
vec4 tempTextureRead18 = texture2D(ClearCoattinttextureTexture, vMainuv);
#endif
vec3 rgb7 = tempTextureRead18.rgb * textureInfoName7;
#ifdef ISGAMMA18
                rgb7 = toLinearSpace(rgb7);
                #endif
            #ifdef UVTRANSFORM8
vec4 tempTextureRead19 = texture2D(SheentextureTexture, transformedUV8);
#elif defined(VMAINUV)
vec4 tempTextureRead19 = texture2D(SheentextureTexture, vMainuv);
#endif
vec3 rgb8 = tempTextureRead19.rgb * textureInfoName8;
#ifdef ISGAMMA19
                rgb8 = toLinearSpace(rgb8);
                #endif
            float output9 = u_SubSurfacemaxthickness - u_SubSurfaceminthickness;
#ifdef UVTRANSFORM9
vec4 tempTextureRead20 = texture2D(SubSurfacethicknesstextureTexture, transformedUV9);
#elif defined(VMAINUV)
vec4 tempTextureRead20 = texture2D(SubSurfacethicknesstextureTexture, vMainuv);
#endif
float r9 = tempTextureRead20.r * textureInfoName9;
#ifdef ISGAMMA20
                r9 = toLinearSpace(r9);
                #endif
            float output8 = output9 * r9;
float output7 = output8 + u_SubSurfaceminthickness;
#ifdef UVTRANSFORM10
vec4 tempTextureRead21 = texture2D(AnisotropytextureTexture, transformedUV10);
#elif defined(VMAINUV)
vec4 tempTextureRead21 = texture2D(AnisotropytextureTexture, vMainuv);
#endif
vec3 rgb10 = tempTextureRead21.rgb * textureInfoName10;
#ifdef ISGAMMA21
                rgb10 = toLinearSpace(rgb10);
                #endif
            float b10 = tempTextureRead21.b * textureInfoName10;
#ifdef ISGAMMA21
                b10 = toLinearSpace(b10);
                #endif
            vec2 xy = rgb10.xy;
vec2 output11 = xy - u_Vector;
vec2 output10 = output11 * u_Anisotropydirection;
vec4 vNormalW = normalize(v_output2);
vec3 viewDirectionW = normalize(u_cameraPosition - v_output1.xyz);
vec3 geometricNormalW = vNormalW.xyz;
vec3 normalW = normalize(output3.xyz);
#if defined(FORCENORMALFORWARD) && defined(NORMAL)
vec3 faceNormal=normalize(cross(dFdx(v_output1.xyz),dFdy(v_output1.xyz)))*invertNormal;
#if defined(TWOSIDEDLIGHTING)
faceNormal=gl_FrontFacing ? faceNormal : -faceNormal;
#endif
normalW*=sign(dot(normalW,faceNormal));
#endif
#if defined(TWOSIDEDLIGHTING) && defined(NORMAL)
#if defined(MIRRORED)
normalW=gl_FrontFacing ? -normalW : normalW;
#else
normalW=gl_FrontFacing ? normalW : -normalW;
#endif
#endif

albedoOpacityOutParams albedoOpacityOut;
albedoOpacityOut = albedoOpacityBlock(
                vec4(rgb1, 1.)
            #ifdef ALBEDO
                ,vec4(1.)
                ,vec2(1., 1.)
            #endif
                ,1. /* Base Weight */
            #ifdef OPACITY
                ,vec4(a4)
                ,vec2(1., 1.)
            #endif
            );

            vec3 surfaceAlbedo = albedoOpacityOut.surfaceAlbedo;
            float alpha = albedoOpacityOut.alpha;
#ifdef DEPTHPREPASS
gl_FragColor=vec4(0.,0.,0.,1.0);return;
#endif

ambientOcclusionOutParams aoOut;
aoOut = ambientOcclusionBlock(
            #ifdef AMBIENT
                vec3(output5),
                vec4(0., 1.0, 1.0, 0.)
            #endif
            );
#ifdef LIGHTMAP
vec4 lightmapColor=texture2D(lightmapSampler,vLightmapUV+uvOffset);
#ifdef RGBDLIGHTMAP
lightmapColor.rgb=fromRGBD(lightmapColor);
#endif
#ifdef GAMMALIGHTMAP
lightmapColor.rgb=toLinearSpace(lightmapColor.rgb);
#endif
lightmapColor.rgb*=vLightmapInfos.y;
#endif

#ifdef UNLIT
                vec3 diffuseBase = vec3(1., 1., 1.);
            #else
reflectivityOutParams reflectivityOut;
vec3 baseColor = surfaceAlbedo;
            vec4 vReflectivityColor = vec4(u_Metallic, output4, u_Refractionior, 0.018009407619797232);
            reflectivityOut = reflectivityBlock(
                vReflectivityColor
            #ifdef METALLICWORKFLOW
                , surfaceAlbedo
                , vMetallicReflectanceFactors
            #endif
                , baseDiffuseRoughness
            #ifdef BASE_DIFFUSE_ROUGHNESS
                , 0.
                , vec2(0., 0.)
            #endif
            #ifdef REFLECTIVITY
                , vec3(0., 0., 1.)
                , vec4(1.)
            #endif
            #if defined(METALLICWORKFLOW) && defined(REFLECTIVITY)  && defined(AOSTOREINMETALMAPRED)
                , aoOut.ambientOcclusionColor
            #endif
            #ifdef MICROSURFACEMAP
                , microSurfaceTexel <== not handled!
            #endif
            );

            float microSurface = reflectivityOut.microSurface;
            float roughness = reflectivityOut.roughness;
            float diffuseRoughness = reflectivityOut.diffuseRoughness;

            #ifdef METALLICWORKFLOW
                surfaceAlbedo = reflectivityOut.surfaceAlbedo;
            #endif
            #if defined(METALLICWORKFLOW) && defined(REFLECTIVITY) && defined(AOSTOREINMETALMAPRED)
                aoOut.ambientOcclusionColor = reflectivityOut.ambientOcclusionColor;
            #endif
float NdotVUnclamped=dot(normalW,viewDirectionW);float NdotV=absEps(NdotVUnclamped);float alphaG=convertRoughnessToAverageSlope(roughness);vec2 AARoughnessFactors=getAARoughnessFactors(normalW.xyz);
#ifdef SPECULARAA
alphaG+=AARoughnessFactors.y;
#endif
#if defined(ENVIRONMENTBRDF)
vec3 environmentBrdf=getBRDFLookup(NdotV,roughness);
#endif
#if defined(ENVIRONMENTBRDF) && !defined(REFLECTIONMAP_SKYBOX0)
#ifdef RADIANCEOCCLUSION
#ifdef AMBIENTINGRAYSCALE
float ambientMonochrome=aoOut.ambientOcclusionColor.r;
#else
float ambientMonochrome=getLuminance(aoOut.ambientOcclusionColor);
#endif
float seo=environmentRadianceOcclusion(ambientMonochrome,NdotVUnclamped);
#endif
#ifdef HORIZONOCCLUSION
#ifdef BUMP
#ifdef REFLECTIONMAP_3D0
float eho=environmentHorizonOcclusion(-viewDirectionW,normalW,geometricNormalW);
#endif
#endif
#endif
#endif

anisotropicOutParams anisotropicOut;
            anisotropicOut = anisotropicBlock(
                vec3(output10, b10),
                0.,
            #ifdef ANISOTROPIC_TEXTURE
                vec3(0.),
            #endif
                TBN,
                normalW,
                viewDirectionW
            );
#ifdef REFLECTION
            vec2 vReflectionInfos = vec2(iblIntensity, 0.);

            reflectionOutParams reflectionOut;

            reflectionOut = reflectionBlock(
                v_output1.xyz
                , anisotropicOut.anisotropicNormal
                , alphaG
                , vReflectionMicrosurfaceInfos
                , vReflectionInfos
                , u_Reflectioncolor
            #ifdef ANISOTROPIC
                ,anisotropicOut
            #endif
            #if defined(LODINREFLECTIONALPHA0) && !defined(REFLECTIONMAP_SKYBOX0)
                ,NdotVUnclamped
            #endif
            #ifdef LINEARSPECULARREFLECTION0
                , roughness
            #endif
            #ifdef REFLECTIONMAP_3D0
                , ReflectionCubeSampler
                
            #else
                , ReflectionDSampler
                
            #endif
            #if defined(NORMAL) && defined(USESPHERICALINVERTEX)
                , vEnvironmentIrradiance
            #endif
            #if (defined(USESPHERICALFROMREFLECTIONMAP) && (!defined(NORMAL) || !defined(USESPHERICALINVERTEX))) || (defined(USEIRRADIANCEMAP) && defined(REFLECTIONMAP_3D))
                    , reflectionMatrix
            #endif
            #ifdef USEIRRADIANCEMAP
                , irradianceSampler         // ** not handled **
                
                #ifdef USE_IRRADIANCE_DOMINANT_DIRECTION
                , vReflectionDominantDirection
                #endif
            #endif
            #ifndef LODBASEDMICROSFURACE
                #ifdef REFLECTIONMAP_3D0
                    , ReflectionCubeSampler
                    
                    , ReflectionCubeSampler
                    
                #else
                    , ReflectionDSampler
                    
                    , ReflectionDSampler                    
                    
                #endif
            #endif
            #ifdef REALTIME_FILTERING
                , vReflectionFilteringInfo
                #ifdef IBL_CDF_FILTERING
                    , icdfSampler         // ** not handled **
                    
                #endif
            #endif
            , viewDirectionW
            , diffuseRoughness
            , surfaceAlbedo
            );
        #endif
float reflectanceF0=reflectivityOut.reflectanceF0;vec3 specularEnvironmentR0=reflectivityOut.colorReflectanceF0;vec3 specularEnvironmentR90=reflectivityOut.colorReflectanceF90;
#ifdef ALPHAFRESNEL
float reflectance90=fresnelGrazingReflectance(reflectanceF0);specularEnvironmentR90=specularEnvironmentR90*reflectance90;
#endif

#ifdef SHEEN
            sheenOutParams sheenOut;

            vec4 vSheenColor = vec4(rgb8, u_Sheenintensity);

            sheenOut = sheenBlock(
                vSheenColor
            #ifdef SHEEN_ROUGHNESS
                , u_Sheenroughness
            #endif
                , roughness
            #ifdef SHEEN_TEXTURE
                , vec4(0.)
                
                , 1.0
            #endif
                , reflectanceF0
            #ifdef SHEEN_LINKWITHALBEDO
                , baseColor
                , surfaceAlbedo
            #endif
            #ifdef ENVIRONMENTBRDF
                , NdotV
                , environmentBrdf
            #endif
            #if defined(REFLECTION) && defined(ENVIRONMENTBRDF)
                , AARoughnessFactors
                , vReflectionMicrosurfaceInfos
                , vReflectionInfos
                , u_Reflectioncolor
                , vLightingIntensity
                #ifdef REFLECTIONMAP_3D0
                    , ReflectionCubeSampler                                      
                    
                #else
                    , ReflectionDSampler
                    
                #endif
                , reflectionOut.reflectionCoords
                , NdotVUnclamped
                #ifndef LODBASEDMICROSFURACE
                    #ifdef REFLECTIONMAP_3D0
                        , ReflectionCubeSampler                        
                        
                        , ReflectionCubeSampler
                        
                    #else
                        , ReflectionDSampler
                        
                        , ReflectionDSampler
                        
                    #endif
                #endif
                #if !defined(REFLECTIONMAP_SKYBOX0) && defined(RADIANCEOCCLUSION)
                    , seo
                #endif
                #if !defined(REFLECTIONMAP_SKYBOX0) && defined(HORIZONOCCLUSION) && defined(BUMP) && defined(REFLECTIONMAP_3D0)
                    , eho
                #endif
            #endif
            );

            #ifdef SHEEN_LINKWITHALBEDO
                surfaceAlbedo = sheenOut.surfaceAlbedo;
            #endif
        #endif

            #ifdef CLEARCOAT
                vec2 vClearCoatParams = vec2(r5, output6);
                vec4 vClearCoatTintParams = vec4(rgb7, u_ClearCoattintthickness);
            #endif
iridescenceOutParams iridescenceOut;

        #ifdef IRIDESCENCE
            iridescenceOut = iridescenceBlock(
                vec4(1., 1.3, 1., 400)
                , NdotV
                , specularEnvironmentR0
                #ifdef CLEARCOAT
                    , NdotVUnclamped
                    , vClearCoatParams
                #endif                
            );

            float iridescenceIntensity = iridescenceOut.iridescenceIntensity;
            specularEnvironmentR0 = iridescenceOut.specularEnvironmentR0;
        #endif
vec3 vGeometricNormaClearCoatW = geometricNormalW;
clearcoatOutParams clearcoatOut;

        #ifdef CLEARCOAT
            clearcoatOut = clearcoatBlock(
                v_output1.xyz
                , vGeometricNormaClearCoatW
                , viewDirectionW
                , vClearCoatParams
                , specularEnvironmentR0
            #ifdef CLEARCOAT_TEXTURE
                , vec2(0.)
            #endif
            #ifdef CLEARCOAT_TINT
                , vClearCoatTintParams
                , u_ClearCoatatdistance
                , vClearCoatRefractionParams
                #ifdef CLEARCOAT_TINT_TEXTURE
                    , vec4(0.)
                #endif
            #endif
            #ifdef CLEARCOAT_BUMP
                , vec2(0., 1.)
                , vec4(rgb6, 0.)
                , v_uv
                #if defined(IGNORE) && defined(NORMAL)
                    , vTBN
                #else
                    , vClearCoatTangentSpaceParams
                #endif
                #ifdef OBJECTSPACE_NORMALMAP
                    , normalMatrix
                #endif
            #endif
            #if defined(FORCENORMALFORWARD) && defined(NORMAL)
                , faceNormal
            #endif
            #ifdef REFLECTION
                , vReflectionMicrosurfaceInfos
                , vReflectionInfos
                , u_Reflectioncolor
                , vLightingIntensity
                #ifdef REFLECTIONMAP_3D0
                    , ReflectionCubeSampler       
                    
                #else
                    , ReflectionDSampler       
                    
                #endif
                #ifndef LODBASEDMICROSFURACE
                    #ifdef REFLECTIONMAP_3D0
                        , ReflectionCubeSampler       
                        
                        , ReflectionCubeSampler
                        
                    #else
                        , ReflectionDSampler
                        
                        , ReflectionDSampler
                                                
                    #endif
                #endif
            #endif
            #if defined(CLEARCOAT_BUMP) || defined(TWOSIDEDLIGHTING)
                , ((gl_FrontFacing) ? 1. : -1.)
            #endif
            );
        #else
            clearcoatOut.specularEnvironmentR0 = specularEnvironmentR0;
        #endif
#if defined(ENVIRONMENTBRDF) && !defined(REFLECTIONMAP_SKYBOX0)
vec3 baseSpecularEnvironmentReflectance=getReflectanceFromBRDFLookup(vec3(reflectanceF0),reflectivityOut.reflectanceF90,environmentBrdf);
#if (CONDUCTOR_SPECULAR_MODEL==CONDUCTOR_SPECULAR_MODEL_OPENPBR)
vec3 metalEnvironmentReflectance=reflectivityOut.specularWeight*getF82Specular(NdotV,clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90,reflectivityOut.roughness);vec3 dielectricEnvironmentReflectance=getReflectanceFromBRDFLookup(reflectivityOut.dielectricColorF0,reflectivityOut.colorReflectanceF90,environmentBrdf);vec3 colorSpecularEnvironmentReflectance=mix(dielectricEnvironmentReflectance,metalEnvironmentReflectance,reflectivityOut.metallic);
#else
vec3 colorSpecularEnvironmentReflectance=getReflectanceFromBRDFLookup(clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90,environmentBrdf);
#endif
#ifdef RADIANCEOCCLUSION
colorSpecularEnvironmentReflectance*=seo;
#endif
#ifdef HORIZONOCCLUSION
#ifdef BUMP
#ifdef REFLECTIONMAP_3D0
colorSpecularEnvironmentReflectance*=eho;
#endif
#endif
#endif
#else
vec3 colorSpecularEnvironmentReflectance=getReflectanceFromAnalyticalBRDFLookup_Jones(NdotV,clearcoatOut.specularEnvironmentR0,specularEnvironmentR90,sqrt(microSurface));vec3 baseSpecularEnvironmentReflectance=getReflectanceFromAnalyticalBRDFLookup_Jones(NdotV,vec3(reflectanceF0),reflectivityOut.reflectanceF90,sqrt(microSurface));
#endif
#ifdef CLEARCOAT
colorSpecularEnvironmentReflectance*=clearcoatOut.conservationFactor;
#if defined(CLEARCOAT_TINT)
colorSpecularEnvironmentReflectance*=clearcoatOut.absorption;
#endif
#endif

subSurfaceOutParams subSurfaceOut;

        #ifdef SUBSURFACE
            vec2 vThicknessParam = vec2(0., output7);
            vec4 vTintColor = vec4(u_SubSurfacetintcolor, u_Refractiontintatdistance);
            vec3 vSubSurfaceIntensity = vec3(u_Refractionintensity, u_SubSurfacetranslucencyintensity, 0.);
            float dispersion = 0.0;
            subSurfaceOut = subSurfaceBlock(
                vSubSurfaceIntensity
                , vThicknessParam
                , vTintColor
                , normalW
            #ifdef LEGACY_SPECULAR_ENERGY_CONSERVATION
        , vec3(max(colorSpecularEnvironmentReflectance.r, max(colorSpecularEnvironmentReflectance.g, colorSpecularEnvironmentReflectance.b)))/n#else
                , baseSpecularEnvironmentReflectance
            #endif
            #ifdef SS_THICKNESSANDMASK_TEXTURE
                , vec4(0.)
            #endif
            #ifdef REFLECTION
                #ifdef SS_TRANSLUCENCY
                    , reflectionMatrix
                    #ifdef USESPHERICALFROMREFLECTIONMAP
                        #if !defined(NORMAL) || !defined(USESPHERICALINVERTEX)
                            , reflectionOut.irradianceVector
                        #endif
                        #if defined(REALTIME_FILTERING)
                            , ReflectionCubeSampler
                            
                            , vReflectionFilteringInfo
                        #endif
                        #endif
                    #ifdef USEIRRADIANCEMAP
                        , irradianceSampler
                        
                    #endif
                #endif
            #endif
            #if defined(SS_REFRACTION) || defined(SS_TRANSLUCENCY)
                , surfaceAlbedo
            #endif
            #ifdef SS_REFRACTION
                , v_output1.xyz
                , viewDirectionW
                , u_view
                , vRefractionInfos
                , refractionMatrix
                , vRefractionMicrosurfaceInfos
                , vLightingIntensity
                #ifdef SS_LINKREFRACTIONTOTRANSPARENCY
                    , alpha
                #endif
                #ifdef SS_LODINREFRACTIONALPHA0
                    , NdotVUnclamped
                #endif
                #ifdef SS_LINEARSPECULARREFRACTION0
                    , roughness
                #endif
                , alphaG
                #ifdef SS_REFRACTIONMAP_3D0
                    , RefractionCubeSampler
                    
                #else
                    , RefractionDSampler
                    
                #endif
                #ifndef LODBASEDMICROSFURACE
                    #ifdef SS_REFRACTIONMAP_3D0
                        , RefractionCubeSampler                        
                        
                        , RefractionCubeSampler                        
                        
                    #else
                        , RefractionDSampler
                        
                        , RefractionDSampler
                        
                    #endif
                #endif
                #ifdef ANISOTROPIC
                    , anisotropicOut
                #endif
                #ifdef REALTIME_FILTERING
                    , vRefractionFilteringInfo
                #endif
                #ifdef SS_USE_LOCAL_REFRACTIONMAP_CUBIC
                    , vRefractionPosition
                    , vRefractionSize
                #endif
                #ifdef SS_DISPERSION
                    , dispersion
                #endif
            #endif
            #ifdef SS_TRANSLUCENCY
                , u_SubSurfacetranslucencydiffusiondistance
                , vTintColor
                #ifdef SS_TRANSLUCENCYCOLOR_TEXTURE
                    , vec4(0.)
                #endif
            #endif                
            );

            #ifdef SS_REFRACTION
                surfaceAlbedo = subSurfaceOut.surfaceAlbedo;
                #ifdef SS_LINKREFRACTIONTOTRANSPARENCY
                    alpha = subSurfaceOut.alpha;
                #endif
            #endif
        #else
            subSurfaceOut.specularEnvironmentReflectance = colorSpecularEnvironmentReflectance;
        #endif
vec3 diffuseBase=vec3(0.,0.,0.);
#ifdef SS_TRANSLUCENCY
vec3 diffuseTransmissionBase=vec3(0.,0.,0.);
#endif
#ifdef SPECULARTERM
vec3 specularBase=vec3(0.,0.,0.);
#endif
#ifdef CLEARCOAT
vec3 clearCoatBase=vec3(0.,0.,0.);
#endif
#ifdef SHEEN
vec3 sheenBase=vec3(0.,0.,0.);
#endif
#if defined(SPECULARTERM) && defined(LIGHT0)
vec3 coloredFresnel;
#endif
preLightingInfo preInfo;lightingInfo info;float shadow=1.; 
float aggShadow=0.;float numLights=0.;
#if defined(CLEARCOAT) && defined(CLEARCOAT_TINT)
vec3 absorption=vec3(0.);
#endif

#include<lightFragment>(vPositionW,v_output1.xyz,uniforms.vReflectivityColor,vReflectivityColor)[0..maxSimultaneousLights]
aggShadow=aggShadow/numLights;
#if defined(ENVIRONMENTBRDF)
#ifdef MS_BRDF_ENERGY_CONSERVATION
vec3 baseSpecularEnergyConservationFactor=getEnergyConservationFactor(vec3(reflectanceF0),environmentBrdf);vec3 coloredEnergyConservationFactor=getEnergyConservationFactor(clearcoatOut.specularEnvironmentR0,environmentBrdf);
#endif
#endif
#if defined(SHEEN) && defined(SHEEN_ALBEDOSCALING) && defined(ENVIRONMENTBRDF)
surfaceAlbedo.rgb=sheenOut.sheenAlbedoScaling*surfaceAlbedo.rgb;
#endif
#ifdef LEGACY_SPECULAR_ENERGY_CONSERVATION
#ifndef METALLICWORKFLOW
#ifdef SPECULAR_GLOSSINESS_ENERGY_CONSERVATION
surfaceAlbedo.rgb=(1.-reflectanceF0)*surfaceAlbedo.rgb;
#endif
#endif
#endif
#ifdef REFLECTION
vec3 finalIrradiance=reflectionOut.environmentIrradiance;
#ifndef LEGACY_SPECULAR_ENERGY_CONSERVATION
#if defined(METALLICWORKFLOW) || defined(SPECULAR_GLOSSINESS_ENERGY_CONSERVATION)
vec3 baseSpecularEnergy=vec3(baseSpecularEnvironmentReflectance);
#if defined(ENVIRONMENTBRDF)
#ifdef MS_BRDF_ENERGY_CONSERVATION
baseSpecularEnergy*=baseSpecularEnergyConservationFactor;
#endif
#endif
finalIrradiance*=clamp(vec3(1.0)-baseSpecularEnergy,0.0,1.0);
#endif
#endif
#if defined(CLEARCOAT)
finalIrradiance*=clearcoatOut.conservationFactor;
#if defined(CLEARCOAT_TINT)
finalIrradiance*=clearcoatOut.absorption;
#endif
#endif
#ifndef SS_APPLY_ALBEDO_AFTER_SUBSURFACE
finalIrradiance*=surfaceAlbedo.rgb;
#endif
#if defined(SS_REFRACTION)
finalIrradiance*=subSurfaceOut.refractionOpacity;
#endif
#if defined(SS_TRANSLUCENCY)
finalIrradiance*=(1.0-subSurfaceOut.translucencyIntensity);finalIrradiance+=subSurfaceOut.refractionIrradiance;
#endif
#ifdef SS_APPLY_ALBEDO_AFTER_SUBSURFACE
finalIrradiance*=surfaceAlbedo.rgb;
#endif
finalIrradiance*=vLightingIntensity.z;finalIrradiance*=aoOut.ambientOcclusionColor;
#endif
#ifdef SPECULARTERM
vec3 finalSpecular=specularBase;finalSpecular=max(finalSpecular,0.0);vec3 finalSpecularScaled=finalSpecular*vLightingIntensity.x*vLightingIntensity.w;
#if defined(ENVIRONMENTBRDF) && defined(MS_BRDF_ENERGY_CONSERVATION)
finalSpecularScaled*=coloredEnergyConservationFactor;
#endif
#if defined(SHEEN) && defined(ENVIRONMENTBRDF) && defined(SHEEN_ALBEDOSCALING)
finalSpecularScaled*=sheenOut.sheenAlbedoScaling;
#endif
#endif
#ifdef REFLECTION
vec3 finalRadiance=reflectionOut.environmentRadiance.rgb;finalRadiance*=colorSpecularEnvironmentReflectance;vec3 finalRadianceScaled=finalRadiance*vLightingIntensity.z;
#if defined(ENVIRONMENTBRDF) && defined(MS_BRDF_ENERGY_CONSERVATION)
finalRadianceScaled*=coloredEnergyConservationFactor;
#endif
#if defined(SHEEN) && defined(ENVIRONMENTBRDF) && defined(SHEEN_ALBEDOSCALING)
finalRadianceScaled*=sheenOut.sheenAlbedoScaling;
#endif
#endif
#ifdef SHEEN
vec3 finalSheen=sheenBase*sheenOut.sheenColor;finalSheen=max(finalSheen,0.0);vec3 finalSheenScaled=finalSheen*vLightingIntensity.x*vLightingIntensity.w;
#if defined(CLEARCOAT) && defined(REFLECTION) && defined(ENVIRONMENTBRDF)
sheenOut.finalSheenRadianceScaled*=clearcoatOut.conservationFactor;
#if defined(CLEARCOAT_TINT)
sheenOut.finalSheenRadianceScaled*=clearcoatOut.absorption;
#endif
#endif
#endif
#ifdef CLEARCOAT
vec3 finalClearCoat=clearCoatBase;finalClearCoat=max(finalClearCoat,0.0);vec3 finalClearCoatScaled=finalClearCoat*vLightingIntensity.x*vLightingIntensity.w;
#if defined(ENVIRONMENTBRDF) && defined(MS_BRDF_ENERGY_CONSERVATION)
finalClearCoatScaled*=clearcoatOut.energyConservationFactorClearCoat;
#endif
#ifdef SS_REFRACTION
subSurfaceOut.finalRefraction*=clearcoatOut.conservationFactor;
#ifdef CLEARCOAT_TINT
subSurfaceOut.finalRefraction*=clearcoatOut.absorption;
#endif
#endif
#endif
#ifdef ALPHABLEND
float luminanceOverAlpha=0.0;
#if defined(REFLECTION) && defined(RADIANCEOVERALPHA)
luminanceOverAlpha+=getLuminance(finalRadianceScaled);
#if defined(CLEARCOAT)
luminanceOverAlpha+=getLuminance(clearcoatOut.finalClearCoatRadianceScaled);
#endif
#endif
#if defined(SPECULARTERM) && defined(SPECULAROVERALPHA)
luminanceOverAlpha+=getLuminance(finalSpecularScaled);
#endif
#if defined(CLEARCOAT) && defined(CLEARCOATOVERALPHA)
luminanceOverAlpha+=getLuminance(finalClearCoatScaled);
#endif
#if defined(RADIANCEOVERALPHA) || defined(SPECULAROVERALPHA) || defined(CLEARCOATOVERALPHA)
alpha=saturate(alpha+luminanceOverAlpha*luminanceOverAlpha);
#endif
#endif

#endif
vec3 finalDiffuse=diffuseBase;finalDiffuse*=surfaceAlbedo;
#if defined(SS_REFRACTION) && !defined(UNLIT) && !defined(LEGACY_SPECULAR_ENERGY_CONSERVATION)
finalDiffuse*=subSurfaceOut.refractionOpacity;
#endif
#if defined(SS_TRANSLUCENCY) && !defined(UNLIT)
finalDiffuse+=diffuseTransmissionBase;
#endif
finalDiffuse=max(finalDiffuse,0.0);finalDiffuse*=vLightingIntensity.x;vec3 finalAmbient=u_Ambientcolor * ambientFromScene;finalAmbient*=surfaceAlbedo.rgb;
#ifdef AMBIENT
vec3 ambientOcclusionForDirectDiffuse=mix(vec3(1.),aoOut.ambientOcclusionColor,0.);
#else
vec3 ambientOcclusionForDirectDiffuse=aoOut.ambientOcclusionColor;
#endif
finalAmbient*=aoOut.ambientOcclusionColor;finalDiffuse*=ambientOcclusionForDirectDiffuse;

vec4 finalColor=vec4(
#ifndef UNLIT
#ifdef REFLECTION
finalIrradiance +
#endif
#ifdef SPECULARTERM
finalSpecularScaled +
#endif
#ifdef SHEEN
finalSheenScaled +
#endif
#ifdef CLEARCOAT
finalClearCoatScaled +
#endif
#ifdef REFLECTION
finalRadianceScaled +
#if defined(SHEEN) && defined(ENVIRONMENTBRDF)
sheenOut.finalSheenRadianceScaled +
#endif
#ifdef CLEARCOAT
clearcoatOut.finalClearCoatRadianceScaled +
#endif
#endif
#ifdef SS_REFRACTION
subSurfaceOut.finalRefraction +
#endif
#endif
finalAmbient +
finalDiffuse,
alpha);
#ifdef LIGHTMAP
#ifndef LIGHTMAPEXCLUDED
#ifdef USELIGHTMAPASSHADOWMAP
finalColor.rgb*=lightmapColor.rgb;
#else
finalColor.rgb+=lightmapColor.rgb;
#endif
#endif
#endif
finalColor.rgb+=vec3(0.);
#define CUSTOM_FRAGMENT_BEFORE_FOG
finalColor=max(finalColor,0.0);

#if defined(IMAGEPROCESSINGPOSTPROCESS) || defined(SS_SCATTERING)
#if !defined(SKIPFINALCOLORCLAMP)
finalColor.rgb=clamp(finalColor.rgb,0.,30.0);
#endif
#else
finalColor=applyImageProcessing(finalColor);
#endif
finalColor.a*=1.;
#ifdef PREMULTIPLYALPHA
finalColor.rgb*=finalColor.a;
#endif

#if DEBUGMODE>0
if (vClipSpacePosition.x/vClipSpacePosition.w>=vDebugMode.x) {
#if DEBUGMODE==1
gl_FragColor.rgb=v_output1.rgb;
#define DEBUGMODE_NORMALIZE
#elif DEBUGMODE==2 && defined(NORMAL)
gl_FragColor.rgb=vNormalW.rgb;
#define DEBUGMODE_NORMALIZE
#elif DEBUGMODE==3 && defined(BUMP) || DEBUGMODE==3 && defined(PARALLAX) || DEBUGMODE==3 && defined(ANISOTROPIC)
gl_FragColor.rgb=TBN[0];
#define DEBUGMODE_NORMALIZE
#elif DEBUGMODE==4 && defined(BUMP) || DEBUGMODE==4 && defined(PARALLAX) || DEBUGMODE==4 && defined(ANISOTROPIC)
gl_FragColor.rgb=TBN[1];
#define DEBUGMODE_NORMALIZE
#elif DEBUGMODE==5
gl_FragColor.rgb=normalW;
#define DEBUGMODE_NORMALIZE
#elif DEBUGMODE==6 && defined(MAINUV1)
gl_FragColor.rgb=vec3(vMainUV1,0.0);
#elif DEBUGMODE==7 && defined(MAINUV2)
gl_FragColor.rgb=vec3(vMainUV2,0.0);
#elif DEBUGMODE==8 && defined(CLEARCOAT) && defined(CLEARCOAT_BUMP)
gl_FragColor.rgb=clearcoatOut.TBNClearCoat[0];
#define DEBUGMODE_NORMALIZE
#elif DEBUGMODE==9 && defined(CLEARCOAT) && defined(CLEARCOAT_BUMP)
gl_FragColor.rgb=clearcoatOut.TBNClearCoat[1];
#define DEBUGMODE_NORMALIZE
#elif DEBUGMODE==10 && defined(CLEARCOAT)
gl_FragColor.rgb=clearcoatOut.clearCoatNormalW;
#define DEBUGMODE_NORMALIZE
#elif DEBUGMODE==11 && defined(ANISOTROPIC)
gl_FragColor.rgb=anisotropicOut.anisotropicNormal;
#define DEBUGMODE_NORMALIZE
#elif DEBUGMODE==12 && defined(ANISOTROPIC)
gl_FragColor.rgb=anisotropicOut.anisotropicTangent;
#define DEBUGMODE_NORMALIZE
#elif DEBUGMODE==13 && defined(ANISOTROPIC)
gl_FragColor.rgb=anisotropicOut.anisotropicBitangent;
#define DEBUGMODE_NORMALIZE
#elif DEBUGMODE==20 && defined(ALBEDO)
gl_FragColor.rgb=vec3(1.);
gl_FragColor.rgb = toGammaSpace(gl_FragColor.rgb);

#ifndef GAMMAALBEDO
#define DEBUGMODE_GAMMA
#endif
#elif DEBUGMODE==21 && defined(AMBIENT)
gl_FragColor.rgb=aoOut.ambientOcclusionColorMap.rgb;
#elif DEBUGMODE==22 && defined(OPACITY)
gl_FragColor.rgb=opacityMap.rgb;
#elif DEBUGMODE==23 && defined(EMISSIVE)
gl_FragColor.rgb=emissiveColorTex.rgb;
#ifndef GAMMAEMISSIVE
#define DEBUGMODE_GAMMA
#endif
#elif DEBUGMODE==24 && defined(LIGHTMAP)
gl_FragColor.rgb=lightmapColor.rgb;
#ifndef GAMMALIGHTMAP
#define DEBUGMODE_GAMMA
#endif
#elif DEBUGMODE==25 && defined(REFLECTIVITY) && defined(METALLICWORKFLOW)
gl_FragColor.rgb=reflectivityOut.surfaceMetallicColorMap.rgb;
#elif DEBUGMODE==26 && defined(REFLECTIVITY) && !defined(METALLICWORKFLOW)
gl_FragColor.rgb=reflectivityOut.surfaceReflectivityColorMap.rgb;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==27 && defined(CLEARCOAT) && defined(CLEARCOAT_TEXTURE)
gl_FragColor.rgb=vec3(clearcoatOut.clearCoatMapData.rg,0.0);
#elif DEBUGMODE==28 && defined(CLEARCOAT) && defined(CLEARCOAT_TINT) && defined(CLEARCOAT_TINT_TEXTURE)
gl_FragColor.rgb=clearcoatOut.clearCoatTintMapData.rgb;
#elif DEBUGMODE==29 && defined(SHEEN) && defined(SHEEN_TEXTURE)
gl_FragColor.rgb=sheenOut.sheenMapData.rgb;
#elif DEBUGMODE==30 && defined(ANISOTROPIC) && defined(ANISOTROPIC_TEXTURE)
gl_FragColor.rgb=anisotropicOut.anisotropyMapData.rgb;
#elif DEBUGMODE==31 && defined(SUBSURFACE) && defined(SS_THICKNESSANDMASK_TEXTURE)
gl_FragColor.rgb=subSurfaceOut.thicknessMap.rgb;
#elif DEBUGMODE==32 && defined(BUMP)
gl_FragColor.rgb=texture2D(bumpSampler,vBumpUV).rgb;
#elif DEBUGMODE==40 && defined(SS_REFRACTION)
gl_FragColor.rgb=subSurfaceOut.environmentRefraction.rgb;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==41 && defined(REFLECTION)
gl_FragColor.rgb=reflectionOut.environmentRadiance.rgb;
#ifndef GAMMAREFLECTION
#define DEBUGMODE_GAMMA
#endif
#elif DEBUGMODE==42 && defined(CLEARCOAT) && defined(REFLECTION)
gl_FragColor.rgb=clearcoatOut.environmentClearCoatRadiance.rgb;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==50
gl_FragColor.rgb=diffuseBase.rgb;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==51 && defined(SPECULARTERM)
gl_FragColor.rgb=specularBase.rgb;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==52 && defined(CLEARCOAT)
gl_FragColor.rgb=clearCoatBase.rgb;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==53 && defined(SHEEN)
gl_FragColor.rgb=sheenBase.rgb;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==54 && defined(REFLECTION)
gl_FragColor.rgb=reflectionOut.environmentIrradiance.rgb;
#ifndef GAMMAREFLECTION
#define DEBUGMODE_GAMMA
#endif
#elif DEBUGMODE==60
gl_FragColor.rgb=surfaceAlbedo.rgb;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==61
gl_FragColor.rgb=clearcoatOut.specularEnvironmentR0;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==62 && defined(METALLICWORKFLOW)
gl_FragColor.rgb=vec3(reflectivityOut.metallic);
#elif DEBUGMODE==71 && defined(METALLICWORKFLOW)
gl_FragColor.rgb=reflectivityOut.metallicF0;
#elif DEBUGMODE==63
gl_FragColor.rgb=vec3(roughness);
#elif DEBUGMODE==64
gl_FragColor.rgb=vec3(alphaG);
#elif DEBUGMODE==65
gl_FragColor.rgb=vec3(NdotV);
#elif DEBUGMODE==66 && defined(CLEARCOAT) && defined(CLEARCOAT_TINT)
gl_FragColor.rgb=clearcoatOut.clearCoatColor.rgb;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==67 && defined(CLEARCOAT)
gl_FragColor.rgb=vec3(clearcoatOut.clearCoatRoughness);
#elif DEBUGMODE==68 && defined(CLEARCOAT)
gl_FragColor.rgb=vec3(clearcoatOut.clearCoatNdotV);
#elif DEBUGMODE==69 && defined(SUBSURFACE) && defined(SS_TRANSLUCENCY)
gl_FragColor.rgb=subSurfaceOut.transmittance;
#elif DEBUGMODE==70 && defined(SUBSURFACE) && defined(SS_REFRACTION)
gl_FragColor.rgb=subSurfaceOut.refractionTransmittance;
#elif DEBUGMODE==72
gl_FragColor.rgb=vec3(microSurface);
#elif DEBUGMODE==73
gl_FragColor.rgb=vAlbedoColor.rgb;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==74 && !defined(METALLICWORKFLOW)
gl_FragColor.rgb=vReflectivityColor.rgb;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==75
gl_FragColor.rgb=vEmissiveColor.rgb;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==80 && defined(RADIANCEOCCLUSION)
gl_FragColor.rgb=vec3(seo);
#elif DEBUGMODE==81 && defined(HORIZONOCCLUSION) && defined(BUMP) && defined(REFLECTIONMAP_3D)
gl_FragColor.rgb=vec3(eho);
#elif DEBUGMODE==82 && defined(MS_BRDF_ENERGY_CONSERVATION)
gl_FragColor.rgb=vec3(energyConservationFactor);
#elif DEBUGMODE==83 && defined(ENVIRONMENTBRDF) && !defined(REFLECTIONMAP_SKYBOX)
gl_FragColor.rgb=baseSpecularEnvironmentReflectance;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==84 && defined(CLEARCOAT) && defined(ENVIRONMENTBRDF) && !defined(REFLECTIONMAP_SKYBOX)
gl_FragColor.rgb=clearcoatOut.clearCoatEnvironmentReflectance;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==85 && defined(SHEEN) && defined(REFLECTION)
gl_FragColor.rgb=sheenOut.sheenEnvironmentReflectance;
#define DEBUGMODE_GAMMA
#elif DEBUGMODE==86 && defined(ALPHABLEND)
gl_FragColor.rgb=vec3(luminanceOverAlpha);
#elif DEBUGMODE==87
gl_FragColor.rgb=vec3(alpha);
#elif DEBUGMODE==88 && defined(ALBEDO)
gl_FragColor.rgb=vec3(albedoTexture.a);
#elif DEBUGMODE==89
gl_FragColor.rgb=aoOut.ambientOcclusionColor.rgb;
#else
float stripeWidth=30.;float stripePos=floor(gl_FragCoord.x/stripeWidth);float whichColor=mod(stripePos,2.);vec3 color1=vec3(.6,.2,.2);vec3 color2=vec3(.3,.1,.1);gl_FragColor.rgb=mix(color1,color2,whichColor);
#endif
gl_FragColor.rgb*=vDebugMode.y;
#ifdef DEBUGMODE_NORMALIZE
gl_FragColor.rgb=normalize(gl_FragColor.rgb)*0.5+0.5;
#endif
#ifdef DEBUGMODE_GAMMA
gl_FragColor.rgb=toGammaSpace(gl_FragColor.rgb);
#endif
gl_FragColor.a=1.0;
#ifdef PREPASS
gl_FragData[0]=toLinearSpace(gl_FragColor); 
gl_FragData[1]=vec4(0.,0.,0.,0.); 
#endif
#ifdef DEBUGMODE_FORCERETURN
return;
#endif
}
#endif

vec3 lighting = finalColor.rgb;
float alpha1 = alpha;
gl_FragColor  = vec4(lighting, alpha1);
#ifdef CONVERTTOLINEAR0
gl_FragColor  = toLinearSpace(gl_FragColor);
#endif
#ifdef CONVERTTOGAMMA0
gl_FragColor  = toGammaSpace(gl_FragColor);
#endif
#if defined(PREPASS)
gl_FragData[0] = gl_FragColor;
#endif

}