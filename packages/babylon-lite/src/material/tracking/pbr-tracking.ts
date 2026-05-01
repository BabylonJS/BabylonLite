/** PBR material auto-dirty tracking. Dynamically imported by enableMaterialTracking(). */

import type { PbrMaterialProps, PbrMaterialPropsInternal, SheenProps } from "../pbr/pbr-material.js";
import { trackScalar, trackSubProps, observableColor3 } from "./tracking-primitives.js";

export function installPbrTracking(matIn: PbrMaterialProps): void {
    const mat = matIn as PbrMaterialPropsInternal;
    for (const key of ["alpha", "environmentIntensity", "directIntensity", "reflectance", "occlusionStrength", "metallicF0Factor"]) {
        if ((mat as any)[key] !== undefined) {
            trackScalar(mat, key);
        }
    }
    if (mat.emissiveColor) {
        mat.emissiveColor = observableColor3(mat.emissiveColor[0], mat.emissiveColor[1], mat.emissiveColor[2], mat as any);
    }
    if (mat.metallicReflectanceColor) {
        mat.metallicReflectanceColor = observableColor3(mat.metallicReflectanceColor[0], mat.metallicReflectanceColor[1], mat.metallicReflectanceColor[2], mat as any);
    }
    if (mat.anisotropy) {
        trackSubProps(mat as any, mat.anisotropy, ["intensity"]);
    }
    if (mat.clearCoat) {
        trackSubProps(mat as any, mat.clearCoat, ["intensity", "roughness", "indexOfRefraction"]);
    }
    if (mat.sheen) {
        const sh = mat.sheen as SheenProps;
        trackSubProps(mat as any, sh, ["intensity", "roughness"]);
        if (sh.color) {
            sh.color = observableColor3(sh.color[0]!, sh.color[1]!, sh.color[2]!, mat as any);
        }
    }
}
