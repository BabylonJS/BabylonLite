import type { ShadowGenerator } from "../../shadow/shadow-generator.js";

export type PbrShadowLight = { readonly lightIndex: number; readonly shadowType: "esm" | "pcf"; readonly gen: ShadowGenerator };

export function getOrCreatePbrShadowBindGroup(
    device: GPUDevice,
    cache: Map<GPUBindGroupLayout, GPUBindGroup>,
    shadowLights: readonly PbrShadowLight[],
    layout: GPUBindGroupLayout
): GPUBindGroup {
    let cached = cache.get(layout);
    if (cached) {
        return cached;
    }

    const entries: GPUBindGroupEntry[] = [];
    let b = 0;
    for (const sl of shadowLights) {
        const sg = sl.gen;
        entries.push({ binding: b++, resource: sg.blurredTexture.createView() });
        entries.push({ binding: b++, resource: sg.blurredSampler });
        entries.push({ binding: b++, resource: { buffer: sg.shadowUBO } });
    }
    cached = device.createBindGroup({ layout, entries });
    cache.set(layout, cached);
    return cached;
}
