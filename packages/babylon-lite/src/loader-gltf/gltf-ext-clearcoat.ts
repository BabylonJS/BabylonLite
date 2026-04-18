/** glTF KHR_materials_clearcoat extension. */
import type { GltfMatExt } from "./gltf-mat-ext.js";

interface CcParsed {
    raw: any;
}

export const clearcoatExt: GltfMatExt = {
    id: "KHR_materials_clearcoat",
    parse(rawMat) {
        const ext = (rawMat as any)?.extensions?.KHR_materials_clearcoat;
        if (!ext) {
            return null;
        }
        return {
            data: { raw: ext } satisfies CcParsed,
            imageRefs: [
                { key: "cc", texInfo: ext.clearcoatTexture, sRGB: false },
                { key: "ccRough", texInfo: ext.clearcoatRoughnessTexture, sRGB: false },
                { key: "ccNormal", texInfo: ext.clearcoatNormalTexture, sRGB: false },
            ],
        };
    },
    build(data, tex) {
        const c = (data as CcParsed).raw;
        return {
            clearCoat: {
                isEnabled: true,
                intensity: c.clearcoatFactor ?? (c.clearcoatTexture ? 1 : 0),
                roughness: c.clearcoatRoughnessFactor ?? (c.clearcoatRoughnessTexture ? 1 : 0),
                texture: tex.cc,
                roughnessTexture: tex.ccRough,
                bumpTexture: tex.ccNormal,
                bumpTextureScale: c.clearcoatNormalTexture?.scale ?? 1,
                useF0Remap: false,
            },
        };
    },
};
