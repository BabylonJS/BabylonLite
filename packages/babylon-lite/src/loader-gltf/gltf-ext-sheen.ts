/** glTF KHR_materials_sheen extension.
 *
 *  Sheen has two textureInfos (sheenColorTexture, sheenRoughnessTexture) which
 *  may share the same image (canonical RGB+A packing). When shared, the loader
 *  fetches the image once via the `shared` ref. */
import type { GltfMatExt } from "./gltf-mat-ext.js";

interface SheenParsed {
    raw: any;
    /** True when sheenColor + sheenRoughness textureInfo reference the same image. */
    sharedImage: boolean;
}

export const sheenExt: GltfMatExt = {
    id: "KHR_materials_sheen",
    parse(rawMat) {
        const ext = (rawMat as any)?.extensions?.KHR_materials_sheen;
        if (!ext) {
            return null;
        }
        const colorTex = ext.sheenColorTexture;
        const roughTex = ext.sheenRoughnessTexture;
        const shared = !!(colorTex && roughTex && colorTex.index === roughTex.index);
        // We only fetch the color image (sRGB). When shared, A channel carries
        // roughness sampled from the same texture. Distinct roughness images
        // are not currently supported by the runtime sheen path.
        return {
            data: { raw: ext, sharedImage: shared } satisfies SheenParsed,
            imageRefs: [{ key: "sheen", texInfo: colorTex, sRGB: true }],
        };
    },
    build(data, tex) {
        const s = (data as SheenParsed).raw;
        return {
            sheen: {
                isEnabled: true,
                color: s.sheenColorFactor ?? [0, 0, 0],
                roughness: s.sheenRoughnessFactor ?? 0,
                intensity: 1,
                texture: tex.sheen,
                albedoScaling: true,
            },
        };
    },
};
