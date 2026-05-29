/** Floating-origin (Large World Rendering) runtime.
 *
 *  This module is dynamically imported by `createEngine` ONLY when the engine
 *  is created with `useFloatingOrigin: true`. Non-LWR engines never reference
 *  it statically — tree-shakers drop it entirely from non-LWR bundles.
 *
 *  Engine-level FO means `updateFloatingOriginOffset` is only ever invoked
 *  when FO is on; there is no per-scene "mode" check inside this module. */

import type { Vec3 } from "../math/types.js";
import type { SceneContext, SceneContextInternal } from "../scene/scene-core.js";

/** Read the current floating-origin offset from a scene as a `Vec3`. Returns
 *  the live offset (camera world position when FO is on). Returns the
 *  zero vector for scenes whose engine has FO off — but those scenes never
 *  reach this function because `eng._updateFOOffset` is undefined. */
export function getFloatingOriginOffset(scene: SceneContext): Vec3 {
    const ctx = scene as SceneContextInternal;
    return {
        x: ctx._floatingOriginOffset[0],
        y: ctx._floatingOriginOffset[1],
        z: ctx._floatingOriginOffset[2],
    };
}

/** Per-frame: copy the active camera's world position into `scene._eyePosition`
 *  and `scene._floatingOriginOffset`. If the offset changed since last frame,
 *  bump `_floatingOriginVersion` (renderable updaters watch this to re-pack
 *  mesh world UBOs with the new offset) and invalidate the camera's view/vp
 *  caches (they're keyed on worldMatrixVersion only; FO offset can change
 *  without a worldMatrix bump on the very first frame).
 *
 *  Only called when `engine.useFloatingOrigin === true` — `createEngine`
 *  dynamically imports this function only in that case and stores it on
 *  `engine._updateFOOffset`. Scene `_update` does `eng._updateFOOffset?.(ctx)`. */
export function updateFloatingOriginOffset(scene: SceneContextInternal): void {
    const eye = scene._eyePosition;
    const offset = scene._floatingOriginOffset;
    const camera = scene.camera;

    if (!camera) {
        if (eye[0] !== 0 || eye[1] !== 0 || eye[2] !== 0) {
            eye[0] = 0;
            eye[1] = 0;
            eye[2] = 0;
        }
        if (offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0) {
            offset[0] = 0;
            offset[1] = 0;
            offset[2] = 0;
            scene._floatingOriginVersion++;
        }
        return;
    }

    const wm = camera.worldMatrix;
    eye[0] = wm[12]!;
    eye[1] = wm[13]!;
    eye[2] = wm[14]!;

    if (offset[0] !== eye[0] || offset[1] !== eye[1] || offset[2] !== eye[2]) {
        offset[0] = eye[0];
        offset[1] = eye[1];
        offset[2] = eye[2];
        scene._floatingOriginVersion++;
        camera._viewVer = -1;
        camera._vpVer = -1;
    }
}
