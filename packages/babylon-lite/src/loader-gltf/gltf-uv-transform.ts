/**
 * KHR_texture_transform material-wide resolver.
 *
 * Dynamically imported by load-gltf.ts ONLY when the asset's `extensionsUsed`
 * lists KHR_texture_transform. Scenes without this extension (e.g. BoomBox,
 * DamagedHelmet) never fetch this chunk.
 */

/** Collapse per-textureInfo KHR_texture_transform into a single material-wide
 *  scale+offset. Returns undefined when absent, inconsistent, or using rotation. */
export function resolveMaterialUvTransform(m: any): [number, number, number, number] | undefined {
    if (!m) {
        return undefined;
    }
    const pbr = m.pbrMetallicRoughness;
    const e = m.extensions;
    const sg = e?.KHR_materials_pbrSpecularGlossiness;
    const cc = e?.KHR_materials_clearcoat;
    const sh = e?.KHR_materials_sheen;
    const texInfos: any[] = [
        sg?.diffuseTexture ?? pbr?.baseColorTexture,
        pbr?.metallicRoughnessTexture,
        m.normalTexture,
        m.occlusionTexture,
        m.emissiveTexture,
        sg?.specularGlossinessTexture,
        cc?.clearcoatTexture,
        cc?.clearcoatRoughnessTexture,
        cc?.clearcoatNormalTexture,
        sh?.sheenColorTexture,
        sh?.sheenRoughnessTexture,
    ];
    let out: [number, number, number, number] | undefined;
    for (const ti of texInfos) {
        const kt = ti?.extensions?.KHR_texture_transform;
        if (!kt || kt.rotation) {
            continue;
        }
        const s = kt.scale ?? [1, 1];
        const o = kt.offset ?? [0, 0];
        if (!out) {
            out = [s[0], s[1], o[0], o[1]];
        } else if (s[0] !== out[0] || s[1] !== out[1] || o[0] !== out[2] || o[1] !== out[3]) {
            return undefined;
        }
    }
    return out;
}
