// Scene 52: Skinned Shadow Casting
// Demonstrates that the directional shadow generator can render skinned
// (animated) caster meshes. The Alien.gltf model from scene 5 provides a
// skinned glTF mesh; a flat ground beneath it receives the cast shadow.
// Animation is deterministic via `?seekTime=…` (matches scene 5 / scene 11).

import { addToScene, attachControl, createArcRotateCamera, createDirectionalLight, createEngine, createGround, createPbrMaterial, createSceneContext, createShadowGenerator, createSolidTexture2D, goToFrame, loadGltf, onBeforeRender, pauseAnimation, registerScene, startEngine } from "babylon-lite";
import type { Mesh, TransformNode } from "babylon-lite";

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.2, g: 0.2, b: 0.3, a: 1.0 };

    const cam = createArcRotateCamera(Math.PI / 2, Math.PI / 2.6, 2.5, { x: 0, y: 0.4, z: 0 });
    cam.nearPlane = 0.1;
    cam.farPlane = 100;
    scene.camera = cam;
    attachControl(cam, canvas, scene);

    // Directional light from above-front. Add it FIRST so it registers as the PBR
    // single-light extension before any other light type — the multi-light
    // writeSceneUbo path expects scene.lights[0] to match the registered ext.
    const light = createDirectionalLight([-0.5, -1, -0.5]);
    light.position.set(2, 4, 2);
    light.intensity = 1.0;
    addToScene(scene, light);

    // Load the same Alien.gltf used by scene 5 — already proven skinned + animated.
    // The model's local origin sits at chest height (boundMin.y ≈ -0.66, boundMax.y ≈ +0.19),
    // so without a translation the alien would be mostly buried by the ground plane below.
    // glTF asset containers always put the root TransformNode at entities[0] (see
    // packages/babylon-lite/src/loader-gltf/load-gltf.ts).
    const alien = await loadGltf(engine, "https://playground.babylonjs.com/scenes/Alien/Alien.gltf");
    // Lift the asset so its feet sit just above the ground plane at y=0.
    (alien.entities[0] as TransformNode).position.y = 0.7;
    addToScene(scene, alien);

    // Find the skinned mesh in the loaded asset so we can register it as a shadow caster.
    const skinnedCasters: Mesh[] = scene.meshes.filter((m) => !!m.skeleton);

    // Flat ground that receives the alien's shadow.
    const ground = createGround(engine, { width: 6, height: 6 });
    ground.material = createPbrMaterial({
        baseColorTexture: createSolidTexture2D(engine, 0.6, 0.55, 0.5),
        ormTexture: createSolidTexture2D(engine, 1.0, 0.9, 0.0),
    });
    ground.receiveShadows = true;
    addToScene(scene, ground);

    // Shadow generator with skinned casters — exercises the new skinning depth path.
    light.shadowGenerator = await createShadowGenerator(engine, light, skinnedCasters, {
        mapSize: 1024,
        depthScale: 30,
        bias: 0.00005,
        blurScale: 2,
        darkness: 0,
        orthoMinZ: cam.nearPlane,
        orthoMaxZ: cam.farPlane,
        frustumSize: 1.5,
    });

    // Fixed timestep for deterministic animation (matches BJS useConstantAnimationDeltaTime).
    scene.fixedDeltaMs = 16.0;

    // Freeze at frame 300 only for parity tests (triggered by ?freeze) — same pattern as scene 5.
    const params = new URLSearchParams(window.location.search);
    const shouldFreeze = params.has("freeze");
    const seekTimeParam = parseFloat(params.get("seekTime") || "");
    let frameCount = 0;
    let seekDone = false;
    onBeforeRender(scene, () => {
        frameCount++;
        canvas.dataset.frameCount = String(frameCount);

        if (!isNaN(seekTimeParam) && seekTimeParam > 0 && frameCount === 10 && !seekDone) {
            const seekFrame = seekTimeParam * 60;
            for (const g of scene.animationGroups) {
                goToFrame(g, seekFrame);
            }
            seekDone = true;
            canvas.dataset.animationFrozen = "true";
        }

        if (shouldFreeze && !seekDone && frameCount === 300) {
            for (const g of scene.animationGroups) {
                pauseAnimation(g);
            }
            canvas.dataset.animationFrozen = "true";
        }
    });

    await registerScene(engine, scene);
    await startEngine(engine);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

main().catch(console.error);
