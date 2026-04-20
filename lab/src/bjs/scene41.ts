// Reference scene 41 — BJS billboard plane following a 3D box.

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import "@babylonjs/core/Materials/standardMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { BILLBOARD_ATLAS_INFO, BILLBOARD_ATLAS_URL } from "../_shared/sprite-billboard-atlas";

(async function () {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: false });
    await engine.initAsync();

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.04, 0.06, 0.1, 1);

    const seekParam = new URLSearchParams(location.search).get("seekTime");
    const seekTime = seekParam !== null ? parseFloat(seekParam) : null;

    const cam = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 9, new Vector3(0, 0.5, 0), scene);
    cam.fov = Math.PI / 4;
    cam.minZ = 0.1;
    cam.maxZ = 100;

    new HemisphericLight("light", new Vector3(0, 1, 0), scene).intensity = 0.95;

    const boxMat = new StandardMaterial("bm", scene);
    boxMat.diffuseColor = new Color3(0.95, 0.5, 0.3);
    const box = MeshBuilder.CreateBox("box", { size: 0.8 }, scene);
    box.material = boxMat;
    box.position.y = 0.5;

    const atlasTex = await new Promise<Texture>((resolve) => {
        const t = new Texture(BILLBOARD_ATLAS_URL, scene, true, false, Texture.LINEAR_LINEAR);
        t.wrapU = Texture.CLAMP_ADDRESSMODE;
        t.wrapV = Texture.CLAMP_ADDRESSMODE;
        t.hasAlpha = true;
        const f = BILLBOARD_ATLAS_INFO.frames.glow;
        t.uScale = BILLBOARD_ATLAS_INFO.cellWidthPx / BILLBOARD_ATLAS_INFO.widthPx;
        t.uOffset = (f * BILLBOARD_ATLAS_INFO.cellWidthPx) / BILLBOARD_ATLAS_INFO.widthPx;
        if (t.isReady()) {
            resolve(t);
        } else {
            t.onLoadObservable.addOnce(() => resolve(t));
        }
    });
    const planeMat = new StandardMaterial("pm", scene);
    planeMat.diffuseTexture = atlasTex;
    planeMat.useAlphaFromDiffuseTexture = true;
    planeMat.transparencyMode = Constants.MATERIAL_ALPHABLEND;
    planeMat.disableLighting = true;
    planeMat.emissiveColor = new Color3(1, 1, 1);
    planeMat.diffuseColor = new Color3(0, 0, 0);
    planeMat.specularColor = new Color3(0, 0, 0);
    planeMat.backFaceCulling = false;

    const plane = MeshBuilder.CreatePlane("glow", { width: 0.8, height: 0.8 }, scene);
    plane.material = planeMat;
    plane.position = new Vector3(0, 1.0, 0);
    plane.parent = box;
    plane.rotationQuaternion = Quaternion.Identity();

    const tmpRight = new Vector3();
    const tmpUp = new Vector3();
    const tmpFwd = new Vector3();
    const basis = new Matrix();

    // Frame-counter-driven animation: matches Lite's fixedDeltaMs=16.667 tick
    // so screenshots agree at the same `seekTime`. First frame's dt is 0.
    let frameCounter = 0;
    const targetFrames = seekTime !== null ? Math.round(seekTime * 60) : 0;
    scene.onBeforeRenderObservable.add(() => {
        let t: number;
        if (seekTime !== null) {
            const advances = Math.min(frameCounter, targetFrames);
            t = (advances * 16.667) / 1000;
            frameCounter++;
            if (frameCounter === targetFrames + 1) {
                canvas.dataset.animationFrozen = "true";
            }
        } else {
            t = (performance.now() - __initStart) / 1000;
        }
        box.position.x = Math.cos(t * 0.6) * 2;
        box.position.z = Math.sin(t * 0.6) * 2;
        const wm = cam.getWorldMatrix().m;
        tmpRight.set(wm[0]!, wm[1]!, wm[2]!);
        tmpUp.set(wm[4]!, wm[5]!, wm[6]!);
        tmpFwd.copyFrom(Vector3.Cross(tmpRight, tmpUp));
        Matrix.FromXYZAxesToRef(tmpRight, tmpUp, tmpFwd, basis);
        Quaternion.FromRotationMatrixToRef(basis, plane.rotationQuaternion!);
    });

    engine.runRenderLoop(() => scene.render());
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
})();
