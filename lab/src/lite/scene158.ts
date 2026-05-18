import {
    addAnimationGroups,
    addToScene,
    attachControl,
    createAnimationManager,
    createArcRotateCamera,
    createDirectionalLight,
    createEngine,
    createHemisphericLight,
    createSceneContext,
    enableAnimationBlending,
    loadGltf,
    onBeforeRender,
    pauseAnimation,
    playAnimation,
    registerScene,
    setAnimationAdditive,
    setAnimationWeight,
    startEngine,
    updateAnimationManager,
} from "babylon-lite";
import type { AnimationGroup } from "babylon-lite";

const XBOT_URL = "https://playground.babylonjs.com/scenes/Xbot.glb";
const POSE_FRAME = 2;
const POSE_TIME = POSE_FRAME / 60;

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.2, g: 0.2, b: 0.3, a: 1.0 };
    scene.fixedDeltaMs = 16.0;

    scene.camera = createArcRotateCamera(Math.PI / 2, Math.PI / 4, 3, { x: 0, y: 1, z: 0 });
    scene.camera.nearPlane = 0.1;
    scene.camera.farPlane = 1000;
    attachControl(scene.camera, canvas, scene);

    addToScene(scene, createHemisphericLight([0, 1, 0], 0.6));
    addToScene(scene, createDirectionalLight([0, -0.5, -1], 0.8));

    const xbot = await loadGltf(engine, XBOT_URL);
    addToScene(scene, xbot, { registerAnimationGroups: false });

    const manager = createAnimationManager({ engine });
    const groups = xbot.animationGroups ?? [];
    addAnimationGroups(manager, groups);
    for (const group of groups) {
        group.loopAnimation = true;
        playAnimation(group);
        setAnimationWeight(group, 0);
    }

    const idle = requireGroup(groups, "idle");
    const walk = requireGroup(groups, "walk");
    const run = requireGroup(groups, "run");
    const sadPose = requireGroup(groups, "sad_pose");
    const sneakPose = requireGroup(groups, "sneak_pose");
    const headShake = requireGroup(groups, "headShake");
    const agree = requireGroup(groups, "agree");

    setAnimationWeight(idle, 0);
    setAnimationWeight(walk, 1);
    setAnimationWeight(run, 0);

    setAdditivePose(sadPose, 0.35);
    setAdditivePose(sneakPose, 0.2);
    setAdditiveLoop(headShake, 0.6);
    setAdditiveLoop(agree, 0.25);
    enableAnimationBlending(manager);

    const seekTime = parseFloat(new URLSearchParams(window.location.search).get("seekTime") || "");
    if (Number.isFinite(seekTime)) {
        for (const group of groups) {
            group.currentFrame = group === sadPose || group === sneakPose ? POSE_TIME : seekTime;
            pauseAnimation(group);
        }
        updateAnimationManager(manager, 0);
        canvas.dataset.animationFrozen = "true";
    } else {
        onBeforeRender(scene, (deltaMs) => updateAnimationManager(manager, deltaMs));
    }

    await registerScene(engine, scene);
    await startEngine(engine);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

function requireGroup(groups: readonly AnimationGroup[], name: string): AnimationGroup {
    const group = groups.find((candidate) => candidate.name === name);
    if (!group) {
        throw new Error(`Xbot animation group "${name}" was not found`);
    }
    return group;
}

function setAdditivePose(group: AnimationGroup, weight: number): void {
    setAnimationAdditive(group, { referenceFrame: 0 });
    setAnimationWeight(group, weight);
    group.currentFrame = POSE_TIME;
    pauseAnimation(group);
}

function setAdditiveLoop(group: AnimationGroup, weight: number): void {
    setAnimationAdditive(group, { referenceFrame: 0 });
    setAnimationWeight(group, weight);
}

main().catch(console.error);
