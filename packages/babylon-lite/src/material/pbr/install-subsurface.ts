/** Install PBR subsurface extension.
 *  Import this module in scene code BEFORE building PBR renderables.
 *  Registers the subsurface feature detection, shader fragment, UBO writer,
 *  bind group entries, and texture tracking with the PBR pipeline.
 *
 *  Tree-shakable: zero bytes if never imported. */

import type { PbrMaterialProps, SubSurfaceProps } from "./pbr-material.js";
import type { Texture2D } from "../../texture/texture-2d.js";
import { _setSubsurfaceExt, PBR_HAS_SUBSURFACE, PBR_HAS_THICKNESS_MAP } from "./pbr-flags.js";
import { createSubsurfaceFragment, writeSubsurfaceUBO } from "./fragments/subsurface-fragment.js";

_setSubsurfaceExt({
    detect(mat: unknown): number {
        const m = mat as PbrMaterialProps;
        if (!m.subsurface?.translucency) {
            return 0;
        }
        let f = PBR_HAS_SUBSURFACE;
        if (m.subsurface.thickness?.texture) {
            f |= PBR_HAS_THICKNESS_MAP;
        }
        return f;
    },
    frag(features: number, hasIbl: boolean): unknown {
        if (!(features & PBR_HAS_SUBSURFACE)) {
            return null;
        }
        return createSubsurfaceFragment(!!(features & PBR_HAS_THICKNESS_MAP), hasIbl);
    },
    ubo(d: Float32Array, m: unknown, o: ReadonlyMap<string, number>): void {
        const mat = m as PbrMaterialProps;
        if (mat.subsurface?.translucency && o.has("subsurfaceParams")) {
            writeSubsurfaceUBO(d, mat.subsurface as SubSurfaceProps, o);
        }
    },
    bind(f: number, m: unknown, e: GPUBindGroupEntry[], b: number): void {
        if ((f & PBR_HAS_THICKNESS_MAP) !== 0) {
            const tex = (m as PbrMaterialProps).subsurface?.thickness?.texture as Texture2D | undefined;
            if (tex) {
                e.push({ binding: b++, resource: tex.view });
                e.push({ binding: b, resource: tex.sampler });
            }
        }
    },
    textures(m: unknown, t: unknown[]): void {
        const mat = m as PbrMaterialProps;
        if (mat.subsurface?.thickness?.texture) {
            t.push(mat.subsurface.thickness.texture);
        }
    },
});
