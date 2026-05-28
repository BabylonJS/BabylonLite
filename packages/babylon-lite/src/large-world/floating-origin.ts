import type { Vec3 } from "../math/types.js";
import type { SceneContext, SceneContextInternal } from "../scene/scene-core.js";

export type FloatingOriginMode = boolean;

export function getFloatingOriginOffset(scene: SceneContext): Vec3 {
    const ctx = scene as SceneContextInternal;
    if (!ctx._floatingOriginMode) {
        return { x: 0, y: 0, z: 0 };
    }
    return {
        x: ctx._floatingOriginOffset[0],
        y: ctx._floatingOriginOffset[1],
        z: ctx._floatingOriginOffset[2],
    };
}

export function updateFloatingOriginOffset(scene: SceneContextInternal): void {
    const eye = scene._eyePosition;
    const offset = scene._floatingOriginOffset;
    const camera = scene.camera;

    if (!camera) {
        eye[0] = 0;
        eye[1] = 0;
        eye[2] = 0;
        offset[0] = 0;
        offset[1] = 0;
        offset[2] = 0;
        return;
    }

    const wm = camera.worldMatrix;
    eye[0] = wm[12]!;
    eye[1] = wm[13]!;
    eye[2] = wm[14]!;

    if (scene._floatingOriginMode) {
        offset[0] = eye[0];
        offset[1] = eye[1];
        offset[2] = eye[2];
        return;
    }

    offset[0] = 0;
    offset[1] = 0;
    offset[2] = 0;
}
