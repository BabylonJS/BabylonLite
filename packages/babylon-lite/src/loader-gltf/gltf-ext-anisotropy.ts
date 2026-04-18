/** glTF KHR_materials_anisotropy extension. */
import type { GltfMatExt } from "./gltf-mat-ext.js";

interface AnisoParsed {
    raw: any;
}

export const anisotropyExt: GltfMatExt = {
    id: "KHR_materials_anisotropy",
    parse(rawMat) {
        const ext = (rawMat as any)?.extensions?.KHR_materials_anisotropy;
        if (!ext) {
            return null;
        }
        return { data: { raw: ext } satisfies AnisoParsed, imageRefs: [] };
    },
    build(data) {
        const a = (data as AnisoParsed).raw;
        const rot = a.anisotropyRotation ?? 0;
        return {
            anisotropy: {
                isEnabled: true,
                intensity: a.anisotropyStrength ?? 0,
                direction: [Math.cos(rot), Math.sin(rot)],
            },
        };
    },
};
