// Scene 39: PBR Shadow-Only Receiver
// Demonstrates `mode: "shadowOnly"` on a wide PBR ground plane combined with
// `frustumSize` on the directional shadow generator. The ground is invisible
// except where the sphere's shadow lands on it, producing a soft drop shadow
// over a blue background. Mirrors BJS BackgroundMaterial.shadowOnly +
// DirectionalLight.shadowFrustumSize (autoUpdateExtends=false).

import { addToScene, attachControl, createArcRotateCamera, createDirectionalLight, createEngine, createGround, createPbrMaterial, createSceneContext, createShadowGenerator, createSolidTexture2D, createSphere, registerScene, startEngine } from "babylon-lite";

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.15, g: 0.2, b: 0.35, a: 1.0 };

    const cam = createArcRotateCamera(Math.PI / 2, Math.PI / 3, 12, { x: 0, y: 1, z: 0 });
    cam.nearPlane = 0.1;
    cam.farPlane = 100;
    scene.camera = cam;
    attachControl(cam, canvas, scene);

    // Single directional light from above-front. Orienting along (-1,-2,-1) keeps
    // the shadow firmly inside the ground's footprint.
    const light = createDirectionalLight([-1, -2, -1]);
    light.position.set(8, 16, 8);
    addToScene(scene, light);

    // Shadow caster: a small static sphere with a regular lit PBR material.
    const sphere = createSphere(engine, { segments: 32, diameter: 2 });
    sphere.position.set(0, 2, 0);
    sphere.material = createPbrMaterial({
        baseColorTexture: createSolidTexture2D(engine, 0.85, 0.25, 0.2),
        ormTexture: createSolidTexture2D(engine, 1.0, 0.4, 0.0),
    });
    addToScene(scene, sphere);

    // Wide ground that catches the drop shadow but is otherwise invisible.
    // The PBR material's `mode: "shadowOnly"` makes alpha track the shadow term;
    // `alphaBlend: true` is required so the alpha channel actually drives blending
    // against the clear color (otherwise the ground would render as solid black).
    const ground = createGround(engine, { width: 30, height: 30 });
    ground.material = createPbrMaterial({
        mode: "shadowOnly",
        color: [0, 0, 0],
        falloff: 1.0,
        alphaBlend: true,
    });
    ground.receiveShadows = true;
    addToScene(scene, ground);

    // ESM shadow generator with a fixed-size frustum (`frustumSize`). The sphere is
    // small relative to the desired drop-shadow extent, so without this override the
    // auto-fit ortho frustum would hug the sphere tightly and the ESM blur could not
    // spread the silhouette far enough to look like a soft ground shadow.
    light.shadowGenerator = await createShadowGenerator(engine, light, [sphere], {
        mapSize: 1024,
        depthScale: 50,
        bias: 0.00005,
        blurScale: 2,
        darkness: 0,
        frustumEdgeFalloff: 0,
        orthoMinZ: cam.nearPlane,
        orthoMaxZ: cam.farPlane,
        frustumSize: 8,
    });

    await registerScene(engine, scene);
    await startEngine(engine);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

main().catch(console.error);
