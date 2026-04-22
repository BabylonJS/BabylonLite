/** Lazy-loaded slow path for PBR material assembly.
 *  Only pulled into bundles whose glTF uses features that require per-texture
 *  wrapping (e.g. KHR_texture_transform) or occlusion on UV2 (texCoord=1 with
 *  no shared MR image). Scene1 (BoomBox) and any vanilla-PBR glTF skip this
 *  module entirely. */

import type { EngineContextInternal } from "../engine/engine.js";
import type { Texture2D } from "../texture/texture-2d.js";
import type { PbrMaterialProps, PbrMaterialPropsInternal } from "../material/pbr/pbr-material.js";
import { pbrGroupBuilder } from "../material/pbr/pbr-material.js";
import type { GltfMaterialData } from "./gltf-material.js";
import { linearToSrgbByte } from "../color/color.js";
import type { TextureWrapFn, GenerateMipmapsFn } from "./gltf-pbr-builder.js";
import { uploadTex } from "./gltf-pbr-builder.js";

export interface PbrTexturesExt {
    baseColorTexture: Texture2D;
    ormTexture: Texture2D;
    normalTexture: Texture2D | undefined;
    emissiveTexture: Texture2D | undefined;
    occlusionTexture: Texture2D | undefined;
}

/** Build textures with wrapTex + occlusionOnUv2 support. Mirrors master's
 *  default texture building but honors per-textureInfo wrapping so
 *  KHR_texture_transform can attach per-texture UV state. */
export function buildDefaultPbrTexturesExt(
    engine: EngineContextInternal,
    mat: GltfMaterialData,
    sampler: GPUSampler,
    generateMipmaps: GenerateMipmapsFn,
    getCachedTex: (bitmap: ImageBitmap, srgb: boolean) => Texture2D,
    wrapTex: TextureWrapFn
): PbrTexturesExt {
    const raw = mat._rawMatDef ?? {};
    const pbr = raw.pbrMetallicRoughness ?? {};
    const baseColorTexture = mat.baseColorImage
        ? wrapTex(getCachedTex(mat.baseColorImage, true), pbr.baseColorTexture)
        : (() => {
              const f = mat.baseColorFactor;
              return uploadTex(
                  engine,
                  null,
                  true,
                  sampler,
                  generateMipmaps,
                  new Uint8Array([linearToSrgbByte(f[0]), linearToSrgbByte(f[1]), linearToSrgbByte(f[2]), Math.round(Math.max(0, Math.min(1, f[3])) * 255)])
              );
          })();
    const normalTexture = mat.normalImage ? wrapTex(getCachedTex(mat.normalImage, false), raw.normalTexture) : undefined;
    const emissiveTexture = mat.emissiveImage ? wrapTex(getCachedTex(mat.emissiveImage, true), raw.emissiveTexture) : undefined;

    const occlusionOnUv2 = mat.occlusionTexCoord !== 0 && mat.occlusionImage && !mat.metallicRoughnessImage;
    let occlusionTexture: Texture2D | undefined;
    const single = mat.metallicRoughnessImage ?? (occlusionOnUv2 ? null : mat.occlusionImage);
    let ormTexture: Texture2D;
    if (occlusionOnUv2) {
        const clamp = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
        ormTexture = uploadTex(engine, null, false, sampler, generateMipmaps, new Uint8Array([255, clamp(mat.roughnessFactor), clamp(mat.metallicFactor), 255]));
        occlusionTexture = wrapTex(getCachedTex(mat.occlusionImage!, false), raw.occlusionTexture);
    } else if (single && (!mat.metallicRoughnessImage || !mat.occlusionImage || mat.metallicRoughnessImage === mat.occlusionImage)) {
        const ormTi = mat.metallicRoughnessImage ? pbr.metallicRoughnessTexture : raw.occlusionTexture;
        ormTexture = wrapTex(getCachedTex(single, false), ormTi);
    } else if (!single) {
        const clamp = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
        ormTexture = uploadTex(engine, null, false, sampler, generateMipmaps, new Uint8Array([255, clamp(mat.roughnessFactor), clamp(mat.metallicFactor), 255]));
    } else {
        ormTexture = wrapTex(getCachedTex(mat.metallicRoughnessImage!, false), pbr.metallicRoughnessTexture);
    }
    return { baseColorTexture, ormTexture, normalTexture, emissiveTexture, occlusionTexture };
}

/** Slow-path assembly: adds occlusionTexCoord and occlusionTexture props. */
export function assemblePbrPropsExt(
    mat: GltfMaterialData,
    tex: PbrTexturesExt,
    extLayers: Partial<PbrMaterialProps> | undefined
): PbrMaterialPropsInternal {
    const ef = mat.emissiveFactor;
    const defaultFactor = (ef[0] === 1 && ef[1] === 1 && ef[2] === 1) || (ef[0] === 0 && ef[1] === 0 && ef[2] === 0);
    return {
        baseColorTexture: tex.baseColorTexture,
        normalTexture: tex.normalTexture,
        ormTexture: tex.ormTexture,
        emissiveTexture: tex.emissiveTexture,
        doubleSided: mat.doubleSided,
        occlusionStrength: mat.occlusionImage ? 1.0 : 0,
        ...(mat.occlusionTexCoord ? { occlusionTexCoord: mat.occlusionTexCoord } : undefined),
        ...(tex.occlusionTexture ? { occlusionTexture: tex.occlusionTexture } : undefined),
        ...(mat.normalScale !== 1 ? { normalTextureScale: mat.normalScale } : undefined),
        ...(mat.metallicRoughnessImage ? { metallicFactor: mat.metallicFactor, roughnessFactor: mat.roughnessFactor } : undefined),
        ...(!defaultFactor ? { emissiveColor: [ef[0], ef[1], ef[2]] as [number, number, number] } : undefined),
        enableSpecularAA: true,
        ...(mat.alphaMode === "BLEND" ? { alphaBlend: true, alpha: mat.baseColorFactor[3] } : undefined),
        ...extLayers,
        _buildGroup: pbrGroupBuilder,
    } satisfies PbrMaterialPropsInternal;
}
