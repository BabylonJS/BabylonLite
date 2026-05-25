import type { EngineContextInternal } from "../../engine/engine.js";
import type { SceneContextInternal } from "../../scene/scene.js";
import type { PbrExt } from "./pbr-flags.js";

export async function registerPbrRefraction(scene: SceneContextInternal, engine: EngineContextInternal, register: (ext: PbrExt) => void, transmissive: boolean): Promise<void> {
    if (transmissive) {
        const mod = await import("./pbr-transmission-ext.js");
        mod.registerPbrTransmission(scene, engine, register);
    } else {
        const mod = await import("./fragments/refraction-fragment.js");
        register(mod.refractionExt);
    }
}
