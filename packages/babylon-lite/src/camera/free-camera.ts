import type { Camera } from "./camera.js";
import type { Vec3, Mat4 } from "../math/types.js";
import { Vec3Up } from "../math/vec3.js";
import { mat4LookAtLH, mat4PerspectiveLH, mat4Multiply, mat4Identity } from "../math/mat4.js";
import type { IWorldMatrixProvider, IParentable } from "../scene/parentable.js";
import { createWorldMatrixState } from "../scene/world-matrix-state.js";
import { ObservableVec3 } from "../math/observable-vec3.js";
import type { SceneNode } from "../scene/scene-node.js";

/** FreeCamera — positioned in world space, looking at a target point.
 *  Matches Babylon.js FreeCamera: position + target, left-handed.
 *  Plain data + methods. Does NOT know about the scene.
 *
 *  Push-based dirty tracking: position and target use ObservableVec3,
 *  _yaw/_pitch use Object.defineProperty. */
export interface FreeCamera extends Camera, IWorldMatrixProvider, IParentable {
    position: ObservableVec3;
    target: ObservableVec3;
    /** Movement speed. Default 2.0 (matches BJS). */
    speed: number;
    /** Mouse rotation sensitivity (higher = less sensitive). Default 2000 (matches BJS). */
    angularSensitivity: number;
    /** Inertia damping factor (0 = instant stop, 0.9 = smooth). Default 0.9 (matches BJS). */
    inertia: number;
    parent: IWorldMatrixProvider | null;
    readonly worldMatrix: Mat4;
    readonly worldMatrixVersion: number;
}

/** @internal FreeCamera with internal yaw/pitch state. Not re-exported from index.ts. */
export interface FreeCameraInternal extends FreeCamera {
    _yaw: number;
    _pitch: number;
}

/** Create a FreeCamera at the given position looking at target. Pure data, no scene knowledge. */
export function createFreeCamera(position: Vec3, target: Vec3): FreeCamera {
    // Compute initial yaw/pitch from position→target direction
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const dz = target.z - position.z;

    function cameraLocalWorldMatrix(): Mat4 {
        const view = mat4LookAtLH(cam.position, cam.target, Vec3Up);
        // Camera-to-world = transpose upper 3×3 of view + eye position
        const m = mat4Identity();
        m[0] = view[0]!;
        m[1] = view[4]!;
        m[2] = view[8]!;
        m[4] = view[1]!;
        m[5] = view[5]!;
        m[6] = view[9]!;
        m[8] = view[2]!;
        m[9] = view[6]!;
        m[10] = view[10]!;
        m[12] = cam.position.x;
        m[13] = cam.position.y;
        m[14] = cam.position.z;
        return m;
    }

    const wm = createWorldMatrixState(cameraLocalWorldMatrix);
    const onDirty = () => wm.markLocalDirty();

    // Per-frame matrix caching — avoids redundant recomputation + Float32Array allocation
    const _cachedView = new Float32Array(16) as Mat4;
    let _cachedViewVersion = -1;
    const _cachedProj = new Float32Array(16) as Mat4;
    let _cachedProjVersion = -1;
    let _cachedProjAspect = -1;
    const _cachedVP = new Float32Array(16) as Mat4;
    let _cachedVPVersion = -1;
    let _cachedVPAspect = -1;

    let _yaw = Math.atan2(dx, dz);
    let _pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));

    const cam: FreeCamera = {
        position: new ObservableVec3(position.x, position.y, position.z, onDirty),
        target: new ObservableVec3(target.x, target.y, target.z, onDirty),
        fov: 0.8,
        nearPlane: 1,
        farPlane: 10000,
        speed: 2.0,
        angularSensitivity: 2000,
        inertia: 0.9,
        children: [] as SceneNode[],

        get parent() {
            return wm.parent;
        },
        set parent(v) {
            wm.parent = v;
        },
        get worldMatrix() {
            return wm.getWorldMatrix();
        },
        get worldMatrixVersion() {
            return wm.getWorldMatrixVersion();
        },

        getPosition(): Vec3 {
            const w = cam.worldMatrix;
            return { x: w[12]!, y: w[13]!, z: w[14]! };
        },

        getViewMatrix(): Mat4 {
            const ver = cam.worldMatrixVersion;
            if (ver === _cachedViewVersion) {
                return _cachedView;
            }
            const w = cam.worldMatrix;
            _cachedView[0] = w[0]!;
            _cachedView[1] = w[4]!;
            _cachedView[2] = w[8]!;
            _cachedView[3] = 0;
            _cachedView[4] = w[1]!;
            _cachedView[5] = w[5]!;
            _cachedView[6] = w[9]!;
            _cachedView[7] = 0;
            _cachedView[8] = w[2]!;
            _cachedView[9] = w[6]!;
            _cachedView[10] = w[10]!;
            _cachedView[11] = 0;
            _cachedView[12] = -(w[0]! * w[12]! + w[1]! * w[13]! + w[2]! * w[14]!);
            _cachedView[13] = -(w[4]! * w[12]! + w[5]! * w[13]! + w[6]! * w[14]!);
            _cachedView[14] = -(w[8]! * w[12]! + w[9]! * w[13]! + w[10]! * w[14]!);
            _cachedView[15] = 1;
            _cachedViewVersion = ver;
            return _cachedView;
        },

        getProjectionMatrix(aspectRatio: number): Mat4 {
            const ver = cam.worldMatrixVersion;
            if (ver === _cachedProjVersion && aspectRatio === _cachedProjAspect) {
                return _cachedProj;
            }
            const p = mat4PerspectiveLH(cam.fov, aspectRatio, cam.nearPlane, cam.farPlane);
            _cachedProj.set(p);
            _cachedProjVersion = ver;
            _cachedProjAspect = aspectRatio;
            return _cachedProj;
        },

        getViewProjectionMatrix(aspectRatio: number): Mat4 {
            const ver = cam.worldMatrixVersion;
            if (ver === _cachedVPVersion && aspectRatio === _cachedVPAspect) {
                return _cachedVP;
            }
            const vp = mat4Multiply(cam.getProjectionMatrix(aspectRatio), cam.getViewMatrix());
            _cachedVP.set(vp);
            _cachedVPVersion = ver;
            _cachedVPAspect = aspectRatio;
            return _cachedVP;
        },
    } as FreeCamera;

    // Push-based dirty for yaw/pitch
    Object.defineProperty(cam, "_yaw", {
        get() {
            return _yaw;
        },
        set(v: number) {
            if (_yaw !== v) {
                _yaw = v;
                onDirty();
            }
        },
        configurable: true,
        enumerable: true,
    });
    Object.defineProperty(cam, "_pitch", {
        get() {
            return _pitch;
        },
        set(v: number) {
            if (_pitch !== v) {
                _pitch = v;
                onDirty();
            }
        },
        configurable: true,
        enumerable: true,
    });

    return cam;
}
