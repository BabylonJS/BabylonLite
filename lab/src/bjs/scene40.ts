// Reference scene 40 — BJS textured-plane label following a 3D box.
// Mirrors scene40.ts (Lite handle API) for visual eyeball + bundle compare.

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
import { getLabelAtlasDataUrl, LABEL_ATLAS_INFO } from "../_shared/sprite-label-atlas";

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
    boxMat.diffuseColor = new Color3(0.3, 0.6, 0.95);
    const box = MeshBuilder.CreateBox("box", { size: 0.8 }, scene);
    box.material = boxMat;
    box.position.y = 0.5;

    const atlasTex = await new Promise<Texture>((resolve) => {
        // 5th arg `invertY=true` (BJS default): the previous `false` left the
        // atlas upside-down on the textured plane, mirroring the label glyph.
        const t = new Texture(getLabelAtlasDataUrl(), scene, true, true, Texture.LINEAR_LINEAR);
        t.wrapU = Texture.CLAMP_ADDRESSMODE;
        t.wrapV = Texture.CLAMP_ADDRESSMODE;
        t.hasAlpha = true;
        t.uScale = LABEL_ATLAS_INFO.cellWidthPx / LABEL_ATLAS_INFO.widthPx;
        t.vScale = LABEL_ATLAS_INFO.cellHeightPx / LABEL_ATLAS_INFO.heightPx;
        // invertY=true flips V on upload, so the default (vOffset=0) sample
        // hits the original bottom-left tile ("C"). Offset by 0.5 so we sample
        // the original top-left tile ("A") to match Lite's frame=0.
        t.vOffset = 0.5;
        if (t.isReady()) {
            resolve(t);
        } else {
            t.onLoadObservable.addOnce(() => resolve(t));
        }
    });
    const labelMat = new StandardMaterial("lm", scene);
    labelMat.diffuseTexture = atlasTex;
    labelMat.useAlphaFromDiffuseTexture = true;
    labelMat.transparencyMode = Constants.MATERIAL_ALPHABLEND;
    labelMat.disableLighting = true;
    labelMat.emissiveColor = new Color3(1, 1, 1);
    labelMat.diffuseColor = new Color3(0, 0, 0);
    labelMat.specularColor = new Color3(0, 0, 0);
    labelMat.backFaceCulling = false;

    // Label plane "anchored" to box-top with a fixed pixel offset is hard to
    // simulate exactly without per-frame projection math; for this lab demo we
    // just translate it 0.8 units above the box (matches the Lite scene's
    // local position) and parent it to the box.
    const label = MeshBuilder.CreatePlane("label", { width: 0.8, height: 0.8 }, scene);
    label.material = labelMat;
    label.position = new Vector3(0, 0.8, 0);
    label.parent = box;

    // Face the camera (cheap billboard).
    const tmpRight = new Vector3();
    const tmpUp = new Vector3();
    const tmpFwd = new Vector3();
    const basis = new Matrix();
    label.rotationQuaternion = Quaternion.Identity();

    // Frame-counter-driven animation: matches Lite's fixedDeltaMs=16.667
    // tick exactly so screenshots agree at the same `seekTime`. First frame's
    // dt is 0 (engine.ts §_renderFn) so we need (target+1) total frames.
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
        Quaternion.FromRotationMatrixToRef(basis, label.rotationQuaternion!);
    });

    engine.runRenderLoop(() => scene.render());
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
})();
