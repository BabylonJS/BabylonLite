/**
 * glTF PBR material assembly:
 * - Extracts material properties from glTF material definitions
 * - Resolves textures (baseColor, normal, ORM, emissive, specGloss)
 * - Handles alpha modes and double-sided flag
 * - Supports KHR_materials_pbrSpecularGlossiness, _clearcoat, _sheen, _anisotropy extensions
 */
import { resolveImage } from "./gltf-parser.js";

/** Parsed PBR material data. */
export interface GltfMaterialData {
    baseColorFactor: [number, number, number, number];
    metallicFactor: number;
    roughnessFactor: number;
    emissiveFactor: [number, number, number];
    baseColorImage: ImageBitmap | null;
    metallicRoughnessImage: ImageBitmap | null;
    normalImage: ImageBitmap | null;
    occlusionImage: ImageBitmap | null;
    emissiveImage: ImageBitmap | null;
    /** KHR_materials_pbrSpecularGlossiness: specular+glossiness texture. */
    specGlossImage: ImageBitmap | null;
    /** Whether material is double-sided. */
    doubleSided: boolean;
    /** glTF alphaMode: "OPAQUE" (default), "BLEND", or "MASK". */
    alphaMode: string;
    /** glTF alphaCutoff for MASK mode (default 0.5). */
    alphaCutoff: number;
    /** KHR_materials_clearcoat intensity map (R channel). */
    clearcoatImage?: ImageBitmap | null;
    /** KHR_materials_clearcoat roughness map (G channel). */
    clearcoatRoughnessImage?: ImageBitmap | null;
    /** KHR_materials_clearcoat normal map (tangent-space). */
    clearcoatNormalImage?: ImageBitmap | null;
    /** Raw KHR_materials_clearcoat extension object (undefined when absent). */
    clearcoat?: any;
    /** Raw KHR_materials_sheen extension object. */
    sheen?: any;
    /** Raw KHR_materials_anisotropy extension object. */
    anisotropy?: any;
    /** Raw glTF material definition. Populated only when the material carries
     *  a layer extension (clearcoat/sheen/anisotropy) or when the asset uses
     *  KHR_texture_transform. Used by dynamic chunks to finish material setup. */
    _rawMatDef?: any;
    /** Per-load image resolver (closure over json/binChunk/baseUrl/imageCache).
     *  Exposed to the dynamic layers chunk so it can fetch sheen textures
     *  without re-importing image-resolution code into the eager loader. */
    _fetchTexImage?: (texInfo: any) => Promise<ImageBitmap | null>;
    /** True when the owning glTF asset's `extensionsUsed` lists
     *  KHR_texture_transform. Gates the dynamic gltf-uv-transform chunk. */
    _usesUvTransform?: boolean;
}

/** Assemble a PBR material from a glTF material definition. */
export async function assembleMaterial(
    json: any,
    binChunk: DataView,
    materialIdx: number,
    baseUrl: string,
    imageCache?: Map<number, Promise<ImageBitmap>>
): Promise<GltfMaterialData> {
    const mat = json.materials?.[materialIdx];
    if (!mat) {
        return {
            baseColorFactor: [1, 1, 1, 1],
            metallicFactor: 1,
            roughnessFactor: 1,
            emissiveFactor: [0, 0, 0],
            baseColorImage: null,
            metallicRoughnessImage: null,
            normalImage: null,
            occlusionImage: null,
            emissiveImage: null,
            specGlossImage: null,
            doubleSided: false,
            alphaMode: "OPAQUE",
            alphaCutoff: 0.5,
        };
    }

    const pbr = mat.pbrMetallicRoughness ?? {};
    const exts = mat.extensions;
    const specGlossExt = exts?.KHR_materials_pbrSpecularGlossiness;
    const ccExt = exts?.KHR_materials_clearcoat;
    const sheenExt = exts?.KHR_materials_sheen;
    const anisoExt = exts?.KHR_materials_anisotropy;

    const getTexImage = (texInfo: any): Promise<ImageBitmap | null> => {
        if (!texInfo) {
            return Promise.resolve(null);
        }
        const tex = json.textures[texInfo.index];
        const imgIdx: number = tex.source;
        if (imageCache) {
            let cached = imageCache.get(imgIdx);
            if (!cached) {
                cached = resolveImage(json, binChunk, imgIdx, baseUrl);
                imageCache.set(imgIdx, cached);
            }
            return cached;
        }
        return resolveImage(json, binChunk, imgIdx, baseUrl);
    };

    // If spec-gloss extension present, use its diffuseTexture as baseColor
    const baseColorTexInfo = specGlossExt?.diffuseTexture ?? pbr.baseColorTexture;
    const specGlossTexInfo = specGlossExt?.specularGlossinessTexture ?? null;

    const [baseColorImg, mrImg, normalImg, occlusionImg, emissiveImg, specGlossImg, ccImg, ccRoughImg, ccNormImg] = await Promise.all([
        getTexImage(baseColorTexInfo),
        getTexImage(pbr.metallicRoughnessTexture),
        getTexImage(mat.normalTexture),
        getTexImage(mat.occlusionTexture),
        getTexImage(mat.emissiveTexture),
        getTexImage(specGlossTexInfo),
        getTexImage(ccExt?.clearcoatTexture),
        getTexImage(ccExt?.clearcoatRoughnessTexture),
        getTexImage(ccExt?.clearcoatNormalTexture),
    ]);

    // Sheen texture fetches + KHR_texture_transform resolution are handled by
    // dynamic chunks (gltf-material-layers.ts, gltf-uv-transform.ts). We pass
    // the raw mat def + image fetcher closure so those chunks can finish the
    // work without any of their code leaking into the eager loader.
    const hasLayer = !!(ccExt || sheenExt || anisoExt);
    const usesUvTransform = json.extensionsUsed?.includes("KHR_texture_transform") === true;
    const needsRawRef = hasLayer || usesUvTransform;

    return {
        baseColorFactor: specGlossExt?.diffuseFactor ?? pbr.baseColorFactor ?? [1, 1, 1, 1],
        metallicFactor: pbr.metallicFactor ?? 1,
        roughnessFactor: pbr.roughnessFactor ?? 1,
        emissiveFactor: mat.emissiveFactor ?? [0, 0, 0],
        baseColorImage: baseColorImg,
        metallicRoughnessImage: mrImg,
        normalImage: normalImg,
        occlusionImage: occlusionImg,
        emissiveImage: emissiveImg,
        specGlossImage: specGlossImg,
        doubleSided: !!mat.doubleSided,
        alphaMode: mat.alphaMode ?? "OPAQUE",
        alphaCutoff: mat.alphaCutoff ?? 0.5,
        clearcoat: ccExt,
        clearcoatImage: ccImg,
        clearcoatRoughnessImage: ccRoughImg,
        clearcoatNormalImage: ccNormImg,
        sheen: sheenExt,
        anisotropy: anisoExt,
        _rawMatDef: needsRawRef ? mat : undefined,
        _fetchTexImage: needsRawRef ? getTexImage : undefined,
        _usesUvTransform: usesUvTransform || undefined,
    };
}

/** Build optional PBR layer props (clearcoat / sheen / anisotropy) from parsed glTF
 *  extension data. Returns a partial PbrMaterialProps to spread onto the built material.
 *  Defined in gltf-material-layers.ts (dynamically imported when needed). */
