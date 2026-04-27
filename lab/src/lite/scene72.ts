// Scene 72: Final D8AK3Z PBR-NME parity. Fetches EPY8BV/6 (the full
// PBR-MR + Reflection + ClearCoat + Sheen + Anisotropy + SubSurface NME
// graph) and renders the 4-light scene from playground D8AK3Z#160.
//
// NOTE: scene 72 currently runs with skipParity:true because anisotropy
// and subsurface are marker-only in the Lite emitter. The scene loads,
// parses the snippet, and renders to validate parser/registry coverage
// of all PBR blocks together. Real anisotropy/subsurface math is future
// work after the agent is freed for a focused pass on those layers.

import {
    addToScene,
    startEngine,
    createEngine,
    createSceneContext,
    createArcRotateCamera,
    createSphere,
    createGround,
    createHemisphericLight,
    createPointLight,
    createSpotLight,
    createDirectionalLight,
    createPcfDirectionalShadowGenerator,
    attachControl,
    registerScene,
    parseNodeMaterialFromSnippet,
    loadEnvironment,
    createSolidTexture2D,
    loadTexture2D,
} from "babylon-lite";
import type { Mesh, Texture2D } from "babylon-lite";
import { fetchScene72Snippet } from "../shared/scene72.js";

function sanitize(name: string): string {
    return name.replace(/[^A-Za-z0-9_]/g, "_");
}

async function loadSnippetTextures(engine: Parameters<typeof loadTexture2D>[0], json: unknown): Promise<Record<string, Texture2D>> {
    const blocks = (json as { blocks?: Array<Record<string, unknown>> }).blocks ?? [];
    const out: Record<string, Texture2D> = {};
    // BJS PBR-NME convention: TextureBlock honors `convertToLinearSpace` /
    // `convertToGammaSpace` flags in the shader, NOT the texture's storage
    // format. The snippet has both false, but BJS samples sRGB-encoded color
    // textures raw and uses them as if linear — which is incorrect physically
    // but matches BJS's behavior. Lite's match is closer when we DO sRGB-decode
    // the color textures, because Lite's gamma-encode path runs once at the
    // end (matching BJS's final pass) and the linear math is more correct.
    const srgbTextureNames = new Set([
        "Albedo texture",
        "Sheen texture",
        "ClearCoat tint texture",
    ]);
    for (const b of blocks) {
        if (b.customType !== "BABYLON.TextureBlock" && b.customType !== "BABYLON.ImageSourceBlock") continue;
        const tex = b.texture as { url?: string; name?: string; gammaSpace?: boolean } | undefined;
        // BJS snippet stores embedded data URIs in texture.name (texture.url is "").
        const url = (tex?.url && tex.url.length > 0) ? tex.url : (tex?.name && tex.name.startsWith("data:") ? tex.name : undefined);
        if (!url) continue;
        const key = sanitize((b.name as string | undefined) || `tex${b.id}`);
        const blockName = b.name as string | undefined;
        const useSrgb = blockName ? srgbTextureNames.has(blockName) : false;
        try {
            out[key] = await loadTexture2D(engine, url, { srgb: useSrgb });
        } catch (e) {
            console.warn("scene72: failed to load", key, e);
        }
    }
    return out;
}

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.6, g: 0.8, b: 1, a: 1 };

    scene.camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2, 7, { x: 0, y: 0, z: 0 });
    scene.camera.nearPlane = 0.1;
    scene.camera.farPlane = 1000;
    attachControl(scene.camera, canvas, scene);

    await loadEnvironment(scene, "https://assets.babylonjs.com/core/environments/environmentSpecular.env", {
        skipSkybox: true,
        skipGround: true,
        brdfUrl: "/brdf-lut.png",
    });

    const hemi = createHemisphericLight([0, 1, 0], 1);
    addToScene(scene, hemi);
    const point = createPointLight([0, 5, -2], 1);
    addToScene(scene, point);
    const spot = createSpotLight([-0.5, 0, -2], [0, 0, 1], Math.PI / 2, 1, 1);
    addToScene(scene, spot);
    const dir = createDirectionalLight([1, -1, 1], 10);
    addToScene(scene, dir);

    const sphere = createSphere(engine, { segments: 32, diameter: 2 });
    const ground = createGround(engine, { width: 6, height: 6, subdivisions: 2 });
    ground.position.set(0, -1, 0);
    ground.receiveShadows = true;
    (ground as Mesh & { layerMask?: number }).layerMask = 1;

    const sg = createPcfDirectionalShadowGenerator(engine, dir, [sphere], { mapSize: 1024, orthoMinZ: -2, orthoMaxZ: 15 });
    dir.shadowGenerator = sg;

    const { json } = await fetchScene72Snippet();

    // Load all textures embedded as data URIs in the snippet (Albedo, MetallicRoughness,
    // AO, Opacity, Bump, Sheen, Anisotropy, ClearCoat, ClearCoat bump, ClearCoat tint,
    // SubSurface thickness). Anything we fail to load falls back to a 1×1 solid.
    const loaded = await loadSnippetTextures(engine, json);
    const white = createSolidTexture2D(engine, 1, 1, 1, 1);
    const flatNormal = createSolidTexture2D(engine, 0.5, 0.5, 1, 1);
    const black = createSolidTexture2D(engine, 0, 0, 0, 1);
    const fallback: Record<string, typeof white> = {
        "Albedo_texture": white,
        "MetallicRoughness_texture": white,
        "AO_texture": white,
        "Opacity_texture": white,
        "Bump_texture": flatNormal,
        "Sheen_texture": white,
        "Anisotropy_texture": black,
        "ClearCoat_texture": white,
        "ClearCoat_bump_texture": flatNormal,
        "ClearCoat_tint_texture": white,
        "SubSurface_thickness_texture": white,
    };
    const textures = { ...fallback, ...loaded };
    const material = await parseNodeMaterialFromSnippet(engine, "", { json, shadowGenerators: [sg], textures });
    (sphere as { material?: unknown }).material = material;
    (ground as { material?: unknown }).material = material;

    addToScene(scene, sphere);
    addToScene(scene, ground);

    await registerScene(engine, scene);
    await startEngine(engine);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

main().catch((err) => {
    console.error(err);
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
    if (canvas) {
        canvas.dataset.error = String(err);
    }
});
