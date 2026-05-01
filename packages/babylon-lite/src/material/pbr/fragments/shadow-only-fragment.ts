/**
 * Shadow-Only Fragment.
 *
 * Mirrors BJS `BackgroundMaterial.shadowOnly`: the surface is invisible except
 * where shadow falls on it. Lit fragments output alpha=0 (fully transparent);
 * shadowed fragments output alpha proportional to the shadow strength, in a
 * caller-chosen `shadowOnlyColor` (defaults to black).
 *
 * Only bundled when at least one mesh in the scene uses `mat.shadowOnly === true`.
 *
 * Implementation notes
 * --------------------
 * The PBR template's multi-light block declares `var shadowFactors: array<f32, MAX_LIGHTS>`
 * with all entries initialized to 1.0 (= no shadow). The shadow fragment writes the
 * actual shadow factor into `shadowFactors[lightIndex]` for each shadow-casting light.
 *
 * In the BC slot (just before the alpha-blend block), we override the final color
 * with `shadowOnlyColor` and override `alpha` with `1 - min(shadowFactors)` so the
 * surface is opaque (where shadow is) and transparent (where it isn't). The
 * existing `luminanceOverAlpha` adjustment in the alpha block contributes only
 * tiny amounts because we forced color to a flat value.
 */ import type { ShaderFragment } from "../../../shader/fragment-types.js";
import type { PbrMaterialProps } from "../pbr-material.js";
import type { PbrExt } from "../pbr-flags.js";
import { PBR2_HAS_SHADOW_ONLY } from "../pbr-flags.js";
import { MAX_LIGHTS } from "../../../light/types.js";

/**
 * Create a shadow-only fragment that overrides color/alpha at the BC injection point.
 *
 * The PBR template's multi-light block declares `var shadowFactors: array<f32, MAX_LIGHTS>`
 * locally inside the fragment main function. We unroll a min() across that array to compute
 * the strongest shadow term, then overwrite `color` and `alpha` with shadow-only outputs.
 */
export function createShadowOnlyFragment(): ShaderFragment {
    const unrolled: string[] = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
        unrolled.push(`    so_shadowMin = min(so_shadowMin, shadowFactors[${i}]);`);
    }
    const bc = `
// shadow-only override: invisible everywhere except where shadow falls.
// alpha = saturate((1 - shadowFactor) * falloff) * opacity
//   - shadowFactor: from the shadow generator's ESM/PCF sample (0 = full shadow, 1 = no shadow)
//   - falloff: steepens the alpha curve at edges (1.0 = natural ESM falloff)
//   - opacity: caps the maximum alpha at the shadow's darkest point (1.0 = fully opaque)
{
    var so_shadowMin = 1.0;
${unrolled.join("\n")}
    color = material.shadowOnlyColor;
    alpha = saturate((1.0 - so_shadowMin) * material.shadowOnlyFalloff) * material.shadowOnlyOpacity;
}
`;

    return {
        id: "shadow-only",
        // No explicit dependency on "pbr-shadow" — slot ordering is template-position-driven
        // (AD slot runs before BC regardless of fragment list order), and we don't want compose
        // to throw if a future caller uses shadowOnly on a non-receiving mesh.
        uboFields: [
            { name: "shadowOnlyColor", type: "vec3<f32>" },
            { name: "shadowOnlyOpacity", type: "f32" },
            { name: "shadowOnlyFalloff", type: "f32" },
        ],
        fragmentSlots: {
            BC: bc,
        },
    };
}

/** Write the shadow-only material-UBO slice. */
export function writeShadowOnlyUBO(data: Float32Array, material: PbrMaterialProps, offsets: ReadonlyMap<string, number>): void {
    if (!material.shadowOnly) {
        return;
    }
    if (offsets.has("shadowOnlyColor")) {
        const off = offsets.get("shadowOnlyColor")! / 4;
        const tint = material.shadowOnlyColor ?? [0, 0, 0];
        data[off] = tint[0]!;
        data[off + 1] = tint[1]!;
        data[off + 2] = tint[2]!;
    }
    if (offsets.has("shadowOnlyOpacity")) {
        data[offsets.get("shadowOnlyOpacity")! / 4] = material.shadowOnlyOpacity ?? 1.0;
    }
    if (offsets.has("shadowOnlyFalloff")) {
        data[offsets.get("shadowOnlyFalloff")! / 4] = material.shadowOnlyFalloff ?? 1.0;
    }
}

export const shadowOnlyExt: PbrExt = {
    id: "shadow-only",
    phase: "fragment",
    detect(mat) {
        return (mat as PbrMaterialProps).shadowOnly ? { f: 0, f2: PBR2_HAS_SHADOW_ONLY } : { f: 0, f2: 0 };
    },
    frag(ctx) {
        if (!(ctx.features2 & PBR2_HAS_SHADOW_ONLY)) {
            return null;
        }
        return createShadowOnlyFragment();
    },
    writeUbo: writeShadowOnlyUBO as PbrExt["writeUbo"],
};
