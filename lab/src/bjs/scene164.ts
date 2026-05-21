import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";

interface WebGpuEngineDeviceAccess {
    _device: GPUDevice;
    onContextLostObservable?: { add(callback: () => void): void };
    onContextRestoredObservable?: { add(callback: () => void): void };
}

(async function () {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
    await engine.initAsync();

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.2, 0.2, 0.3, 1.0);

    const light = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
    light.intensity = 0.7;

    await SceneLoader.ImportMeshAsync("", "https://playground.babylonjs.com/scenes/Alien/", "Alien.gltf", scene);

    const _cam = new ArcRotateCamera("cam", Math.PI / 2, Math.PI / 2, 2, new Vector3(0, 0, 0), scene);

    engine.getDeltaTime = function () {
        return 16;
    };
    scene.useConstantAnimationDeltaTime = true;

    const params = new URLSearchParams(window.location.search);
    const seekTimeParam = parseFloat(params.get("seekTime") || "2");
    const eng = engine as unknown as WebGpuEngineDeviceAccess;

    eng.onContextLostObservable?.add(() => {
        canvas.dataset.deviceLost = "true";
    });
    eng.onContextRestoredObservable?.add(() => {
        canvas.dataset.deviceRecovered = "true";
    });
    void eng._device.lost.then(() => {
        canvas.dataset.deviceLost = "true";
    });

    let frameCount = 0;
    let recoveredFrames = 0;
    let frozen = false;
    scene.onBeforeRenderObservable.add(() => {
        frameCount++;
        canvas.dataset.frameCount = String(frameCount);
        if (canvas.dataset.deviceRecovered === "true" && !frozen) {
            recoveredFrames++;
            canvas.dataset.postRecoveryFrames = String(recoveredFrames);
            if (recoveredFrames >= 10) {
                scene.animationGroups.forEach((g) => {
                    const range = g.to - g.from;
                    if (range > 0) {
                        const seekFrame = g.from + (((isNaN(seekTimeParam) ? 2 : seekTimeParam) * 60 - g.from) % range);
                        g.goToFrame(seekFrame);
                    }
                });
                scene.animatables.forEach((a) => a.pause());
                frozen = true;
                canvas.dataset.animationFrozen = "true";
                canvas.dataset.ready = "true";
            }
        }
    });
    scene.onAfterRenderObservable.add(() => {
        canvas.dataset.drawCalls = "1";
    });
    await scene.whenReadyAsync();
    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
    await new Promise<void>((resolve) => scene.onAfterRenderObservable.addOnce(resolve));
    canvas.dataset.loaded = "true";
    canvas.dataset.ready = "true";
    eng._device.destroy();
    canvas.dataset.initMs = String(performance.now() - __initStart);
})().catch(console.error);
