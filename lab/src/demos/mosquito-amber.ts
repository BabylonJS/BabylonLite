import {
    addToScene, attachControl, createDefaultCamera, createEngine, createSceneContext,
    getFrameGraph, loadEnvironment, loadGltf, onBeforeRender, registerScene, startEngine,
    type RenderTask,
} from "babylon-lite";

const MODEL_URL = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/MosquitoInAmber/glTF/MosquitoInAmber.gltf";
const ENV_URL = "https://assets.babylonjs.com/environments/studio.env";
// Sandbox cameraPosition (world space) used to derive the orbit framing.
const CAM_POS = { x: -0.14, y: 0.005, z: 0.03 };
// Faithful port of Babylon.js AutoRotationBehavior defaults.
const IDLE_ROTATION_SPEED = 0.05; // rad/s at full speed
const IDLE_ROTATION_WAIT_TIME = 2000; // ms idle before rotating again
const IDLE_ROTATION_SPINUP_TIME = 2000; // ms to ramp from 0 to full speed

async function main(): Promise<void> {
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    try {
        const engine = await createEngine(canvas);
        const scene = createSceneContext(engine);
        // Transmissive amber requires the frame-graph scene-texture transmission copy.
        (getFrameGraph(scene)._tasks[0] as RenderTask)._config.transmission = { copyCount: 1 };

        await Promise.all([
            loadGltf(engine, MODEL_URL).then((asset) => addToScene(scene, asset)),
            loadEnvironment(scene, ENV_URL, {
                skyboxUrl: ENV_URL, // reuse the .env cubemap as a visible HDR skybox
                skipGround: true,
                brdfUrl: "/brdf-lut.png",
            }),
        ]);

        // Match the Babylon.js sandbox image processing for this model: linear
        // output (no tone mapping), neutral exposure/contrast. loadEnvironment
        // defaults to tonemap+0.8 exposure/1.2 contrast, which darkens and
        // over-saturates relative to the sandbox reference. Set before
        // registerScene so the deferred skybox build snapshots these values.
        scene.imageProcessing.toneMappingEnabled = false;
        scene.imageProcessing.exposure = 1.0;
        scene.imageProcessing.contrast = 1.0;

        // Auto-frame, then honor the sandbox cameraPosition relative to the framed center.
        const cam = createDefaultCamera(scene);
        const dx = CAM_POS.x - cam.target.x;
        const dy = CAM_POS.y - cam.target.y;
        const dz = CAM_POS.z - cam.target.z;
        const r = Math.hypot(dx, dy, dz);
        if (r > 1e-6) {
            cam.radius = r;
            cam.beta = Math.acos(Math.max(-1, Math.min(1, dy / r)));
            cam.alpha = Math.atan2(dz, dx);
            cam.nearPlane = r * 0.01;
            cam.farPlane = r * 1000;
        }
        attachControl(cam, canvas, scene);

        // AutoRotationBehavior port: rotate when idle, pause on interaction,
        // resume smoothly after an idle delay.
        let isPointerDown = false;
        canvas.addEventListener("pointerdown", () => {
            isPointerDown = true;
        });
        window.addEventListener("pointerup", () => {
            isPointerDown = false;
        });
        canvas.addEventListener("pointercancel", () => {
            isPointerDown = false;
        });

        // -Infinity => begin rotating immediately on load (matches the sandbox).
        let lastInteractionTime = -Infinity;

        onBeforeRender(scene, (dtMs) => {
            const now = performance.now();
            const userIsMoving =
                isPointerDown ||
                cam.inertialAlphaOffset !== 0 ||
                cam.inertialBetaOffset !== 0 ||
                cam.inertialRadiusOffset !== 0 ||
                cam.inertialPanningX !== 0 ||
                cam.inertialPanningY !== 0;
            if (userIsMoving) {
                lastInteractionTime = now;
            }
            const timeToRotation = now - lastInteractionTime - IDLE_ROTATION_WAIT_TIME;
            const scale = Math.max(Math.min(timeToRotation / IDLE_ROTATION_SPINUP_TIME, 1), 0);
            const speed = IDLE_ROTATION_SPEED * scale;
            cam.alpha -= speed * (dtMs / 1000);
        });

        await registerScene(engine, scene);
        await startEngine(engine);
        canvas.dataset.ready = "true";
    } catch (err) {
        canvas.dataset.error = String(err);
        console.error(err);
    }
}

void main();
