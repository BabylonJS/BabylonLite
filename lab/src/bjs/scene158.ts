import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";

const POSE_FRAME = 2;

(async function () {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
    await engine.initAsync();

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.2, 0.2, 0.3, 1.0);

    const camera = new ArcRotateCamera("camera", Math.PI / 2, Math.PI / 4, 3, new Vector3(0, 1, 0), scene);
    camera.minZ = 0.1;
    camera.maxZ = 1000;
    camera.attachControl(canvas, true);

    new HemisphericLight("hemi", new Vector3(0, 1, 0), scene).intensity = 0.6;
    new DirectionalLight("dir", new Vector3(0, -0.5, -1), scene).intensity = 0.8;

    await SceneLoader.ImportMeshAsync("", "https://playground.babylonjs.com/scenes/", "Xbot.glb", scene);

    const walk = requireGroup(scene.animationGroups, "walk");
    const sadPose = AnimationGroup.MakeAnimationAdditive(requireGroup(scene.animationGroups, "sad_pose"));
    const sneakPose = AnimationGroup.MakeAnimationAdditive(requireGroup(scene.animationGroups, "sneak_pose"));
    const headShake = AnimationGroup.MakeAnimationAdditive(requireGroup(scene.animationGroups, "headShake"));
    const agree = AnimationGroup.MakeAnimationAdditive(requireGroup(scene.animationGroups, "agree"));

    for (const group of scene.animationGroups) {
        group.stop();
        group.weight = 0;
    }
    const activeGroups = [walk, sadPose, sneakPose, headShake, agree];
    for (const group of activeGroups) {
        group.loopAnimation = true;
        group.play(true);
    }

    walk.weight = 1;
    sadPose.weight = 0.35;
    sneakPose.weight = 0.2;
    headShake.weight = 0.6;
    agree.weight = 0.25;

    sadPose.goToFrame(POSE_FRAME, true);
    sadPose.pause();
    sneakPose.goToFrame(POSE_FRAME, true);
    sneakPose.pause();

    engine.getDeltaTime = function () {
        return 16;
    };
    scene.useConstantAnimationDeltaTime = true;

    const seekTime = parseFloat(new URLSearchParams(window.location.search).get("seekTime") || "");
    if (Number.isFinite(seekTime)) {
        const seekFrame = seekTime * 60;
        for (const group of activeGroups) {
            group.goToFrame(group === sadPose || group === sneakPose ? POSE_FRAME : seekFrame, true);
            group.pause();
        }
        canvas.dataset.animationFrozen = "true";
    }

    const eng = engine as any;
    scene.onBeforeRenderObservable.add(() => {
        if (eng._drawCalls) {
            eng._drawCalls.fetchNewFrame();
        }
    });
    scene.onAfterRenderObservable.add(() => {
        canvas.dataset.drawCalls = String(eng._drawCalls ? eng._drawCalls.current : 0);
    });
    await scene.whenReadyAsync();
    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
    await new Promise<void>((resolve) => scene.onAfterRenderObservable.addOnce(resolve));
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
})().catch(console.error);

function requireGroup(groups: readonly AnimationGroup[], name: string): AnimationGroup {
    const group = groups.find((candidate) => candidate.name === name);
    if (!group) {
        throw new Error(`Xbot animation group "${name}" was not found`);
    }
    return group;
}
