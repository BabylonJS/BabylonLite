/**
 * Sprite3DSceneUBO — shared per-scene UBO for 3D sprite families (anchored + future billboards).
 *
 * Layout (128 B):
 *   offset   0..63   viewProjection: mat4x4<f32>
 *   offset  64..79   cameraRight:    vec4<f32>   (camera basis vectors pre-extracted from invView)
 *   offset  80..95   cameraUp:       vec4<f32>
 *   offset  96..111  cameraForward:  vec4<f32>
 *   offset 112..119  viewportPx:     vec2<f32>
 *   offset 120..127  invViewportPx:  vec2<f32>
 *
 * Designed for billboard reuse — anchored only consumes viewProjection + viewport,
 * but the camera basis vectors are populated for the future billboard families.
 *
 * Per-scene registration: the first sprite renderable that needs this UBO calls
 * `ensureSprite3DSceneUBO(scene)`. The scene stashes the buffer in `_sprite3dSceneUBO`
 * and pushes a single updater onto `_uniformUpdaters`. Subsequent sprite renderables
 * reuse the same buffer; the updater stays registered for the scene's lifetime.
 *
 * Zero module-level side effects (per GUIDANCE rule 4).
 */

import type { SceneContext, SceneContextInternal } from "../../scene/scene.js";
import type { EngineContextInternal } from "../../engine/engine.js";
import { getViewProjectionMatrix } from "../../camera/camera.js";

/** Total bytes of the Sprite3DSceneUBO layout above. */
export const SPRITE_3D_SCENE_UBO_BYTES = 128;

/** WGSL declaration text — emitted by sprite renderable shader composers. */
export const SPRITE_3D_SCENE_UBO_WGSL = /* wgsl */ `
struct Sprite3DSceneUBO {
    viewProjection: mat4x4<f32>,
    cameraRight: vec4<f32>,
    cameraUp: vec4<f32>,
    cameraForward: vec4<f32>,
    viewportPx: vec2<f32>,
    invViewportPx: vec2<f32>,
};
`;

/**
 * Lazily create the per-scene Sprite3DSceneUBO and register its updater.
 * Returns the GPU buffer (cached on the scene). Idempotent — subsequent calls
 * return the same buffer without registering another updater.
 */
export function ensureSprite3DSceneUBO(scene: SceneContext): GPUBuffer {
    const ctx = scene as SceneContextInternal;
    if (ctx._sprite3dSceneUBO) {
        return ctx._sprite3dSceneUBO;
    }
    const engine = ctx.engine as EngineContextInternal;
    const buf = engine.device.createBuffer({
        label: "sprite-3d-scene-ubo",
        size: SPRITE_3D_SCENE_UBO_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ctx._sprite3dSceneUBO = buf;
    ctx._disposables.push(() => buf.destroy());

    const scratch = new Float32Array(SPRITE_3D_SCENE_UBO_BYTES / 4);
    ctx._uniformUpdaters.push({
        update(): void {
            const cam = ctx.camera;
            if (!cam) {
                return;
            }
            const w = engine.canvas.width;
            const h = engine.canvas.height;
            const aspect = h > 0 ? w / h : 1;
            const vp = getViewProjectionMatrix(cam, aspect);
            scratch.set(vp as unknown as Float32Array, 0);
            // Camera basis from world matrix columns (right, up, forward).
            const wm = cam.worldMatrix;
            scratch[16] = wm[0]!;
            scratch[17] = wm[1]!;
            scratch[18] = wm[2]!;
            scratch[19] = 0;
            scratch[20] = wm[4]!;
            scratch[21] = wm[5]!;
            scratch[22] = wm[6]!;
            scratch[23] = 0;
            scratch[24] = wm[8]!;
            scratch[25] = wm[9]!;
            scratch[26] = wm[10]!;
            scratch[27] = 0;
            scratch[28] = w;
            scratch[29] = h;
            scratch[30] = w > 0 ? 1 / w : 0;
            scratch[31] = h > 0 ? 1 / h : 0;
            engine.device.queue.writeBuffer(buf, 0, scratch.buffer, scratch.byteOffset, SPRITE_3D_SCENE_UBO_BYTES);
        },
    });

    return buf;
}
