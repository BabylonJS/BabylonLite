/**
 * Babylon.js-compatible gizmos over Babylon Lite's gizmo suite.
 *
 * Babylon.js gizmos take a `UtilityLayerRenderer` and attach to a node via
 * `attachedMesh`/`attachedNode`. Babylon Lite mirrors this with
 * `createUtilityLayer` + `create*Gizmo(engine, layer)` + `attach*ToNode`. These
 * wrappers reproduce the Babylon.js class shape and the `attachedMesh` setter.
 */

import {
    createUtilityLayer,
    registerUtilityLayer,
    disposeUtilityLayer,
    createPositionGizmo,
    attachPositionGizmoToNode,
    disposePositionGizmo,
    createRotationGizmo,
    attachRotationGizmoToNode,
    disposeRotationGizmo,
    createScaleGizmo,
    attachScaleGizmoToNode,
    disposeScaleGizmo,
    createBoundingBoxGizmo,
    attachBoundingBoxGizmoToNode,
    disposeBoundingBoxGizmo,
    createLightGizmo,
    attachLightGizmoToLight,
    disposeLightGizmo,
    createCameraGizmo,
    attachCameraGizmoToCamera,
    disposeCameraGizmo,
} from "babylon-lite";
import type {
    UtilityLayer as LiteUtilityLayer,
    PositionGizmo as LitePositionGizmo,
    RotationGizmo as LiteRotationGizmo,
    ScaleGizmo as LiteScaleGizmo,
    BoundingBoxGizmo as LiteBoundingBoxGizmo,
    LightGizmo as LiteLightGizmo,
    CameraGizmo as LiteCameraGizmo,
    EngineContext,
    SceneNode,
} from "babylon-lite";

import type { Scene } from "../scene/scene.js";
import type { AbstractMesh, Mesh } from "../meshes/meshes.js";
import type { Light } from "../lights/lights.js";
import type { Camera } from "../cameras/cameras.js";

/** Babylon.js `UtilityLayerRenderer` — the overlay scene gizmos render into. */
export class UtilityLayerRenderer {
    /** @internal Underlying Babylon Lite utility layer. */
    public readonly _lite: LiteUtilityLayer;
    /** @internal Lite engine backing the layer (gizmo factories need it explicitly). */
    public readonly _engine: EngineContext;
    private _registered: Promise<void> | undefined;

    public constructor(scene: Scene) {
        this._engine = scene.getEngine()._lite;
        this._lite = createUtilityLayer(this._engine, scene._lite);
    }

    /** @internal Ensure the layer is registered with the engine (idempotent). */
    public _ensureRegistered(): Promise<void> {
        if (!this._registered) {
            this._registered = registerUtilityLayer(this._lite);
        }
        return this._registered;
    }

    public dispose(): void {
        disposeUtilityLayer(this._lite);
    }
}

/** Shared base for compat gizmos (Babylon.js `Gizmo`). */
abstract class GizmoBase {
    /** @internal The utility layer this gizmo renders into. */
    public readonly _layer: UtilityLayerRenderer;

    protected constructor(layer: UtilityLayerRenderer) {
        this._layer = layer;
        void layer._ensureRegistered();
    }

    public abstract get attachedMesh(): AbstractMesh | null;
    public abstract set attachedMesh(value: AbstractMesh | null);

    public abstract dispose(): void;
}

export class PositionGizmo extends GizmoBase {
    /** @internal */
    public readonly _lite: LitePositionGizmo;
    private _attached: AbstractMesh | null = null;

    public constructor(layer: UtilityLayerRenderer) {
        super(layer);
        this._lite = createPositionGizmo(layer._engine, layer._lite);
    }

    public get attachedMesh(): AbstractMesh | null {
        return this._attached;
    }
    public set attachedMesh(value: AbstractMesh | null) {
        this._attached = value;
        attachPositionGizmoToNode(this._lite, (value?._lite as SceneNode | undefined) ?? null);
    }

    public override dispose(): void {
        disposePositionGizmo(this._lite, this._layer._lite);
    }
}

export class RotationGizmo extends GizmoBase {
    /** @internal */
    public readonly _lite: LiteRotationGizmo;
    private _attached: AbstractMesh | null = null;

    public constructor(layer: UtilityLayerRenderer) {
        super(layer);
        this._lite = createRotationGizmo(layer._engine, layer._lite);
    }

    public get attachedMesh(): AbstractMesh | null {
        return this._attached;
    }
    public set attachedMesh(value: AbstractMesh | null) {
        this._attached = value;
        attachRotationGizmoToNode(this._lite, (value?._lite as SceneNode | undefined) ?? null);
    }

    public override dispose(): void {
        disposeRotationGizmo(this._lite, this._layer._lite);
    }
}

export class ScaleGizmo extends GizmoBase {
    /** @internal */
    public readonly _lite: LiteScaleGizmo;
    private _attached: AbstractMesh | null = null;

    public constructor(layer: UtilityLayerRenderer) {
        super(layer);
        this._lite = createScaleGizmo(layer._engine, layer._lite);
    }

    public get attachedMesh(): AbstractMesh | null {
        return this._attached;
    }
    public set attachedMesh(value: AbstractMesh | null) {
        this._attached = value;
        attachScaleGizmoToNode(this._lite, (value?._lite as SceneNode | undefined) ?? null);
    }

    public override dispose(): void {
        disposeScaleGizmo(this._lite, this._layer._lite);
    }
}

export class BoundingBoxGizmo extends GizmoBase {
    /** @internal */
    public readonly _lite: LiteBoundingBoxGizmo;
    private _attached: AbstractMesh | null = null;

    public constructor(layer: UtilityLayerRenderer) {
        super(layer);
        this._lite = createBoundingBoxGizmo(layer._engine, layer._lite);
    }

    public get attachedMesh(): AbstractMesh | null {
        return this._attached;
    }
    public set attachedMesh(value: AbstractMesh | null) {
        this._attached = value;
        attachBoundingBoxGizmoToNode(this._lite, (value?._lite as SceneNode | undefined) ?? null);
    }

    public override dispose(): void {
        disposeBoundingBoxGizmo(this._lite, this._layer._lite);
    }
}

export class LightGizmo {
    /** @internal */
    public readonly _lite: LiteLightGizmo;
    /** @internal */
    public readonly _layer: UtilityLayerRenderer;
    private _attached: Light | null = null;

    public constructor(layer: UtilityLayerRenderer) {
        this._layer = layer;
        void layer._ensureRegistered();
        this._lite = createLightGizmo(layer._engine, layer._lite);
    }

    public get light(): Light | null {
        return this._attached;
    }
    public set light(value: Light | null) {
        this._attached = value;
        attachLightGizmoToLight(this._lite, value?._lite ?? null);
    }

    public dispose(): void {
        disposeLightGizmo(this._lite, this._layer._lite);
    }
}

export class CameraGizmo {
    /** @internal */
    public readonly _lite: LiteCameraGizmo;
    /** @internal */
    public readonly _layer: UtilityLayerRenderer;
    private _attached: Camera | null = null;

    public constructor(layer: UtilityLayerRenderer) {
        this._layer = layer;
        void layer._ensureRegistered();
        this._lite = createCameraGizmo(layer._engine, layer._lite);
    }

    public get camera(): Camera | null {
        return this._attached;
    }
    public set camera(value: Camera | null) {
        this._attached = value;
        attachCameraGizmoToCamera(this._lite, value?._lite ?? null);
    }

    public dispose(): void {
        disposeCameraGizmo(this._lite, this._layer._lite);
    }
}

/**
 * Babylon.js `GizmoManager` — coordinates the position/rotation/scale/bounding-box
 * gizmos over a shared utility layer and a single attached mesh.
 */
export class GizmoManager {
    public readonly gizmos: {
        positionGizmo: PositionGizmo | null;
        rotationGizmo: RotationGizmo | null;
        scaleGizmo: ScaleGizmo | null;
        boundingBoxGizmo: BoundingBoxGizmo | null;
    } = { positionGizmo: null, rotationGizmo: null, scaleGizmo: null, boundingBoxGizmo: null };

    private readonly _layer: UtilityLayerRenderer;
    private _attached: AbstractMesh | null = null;

    public constructor(scene: Scene) {
        this._layer = new UtilityLayerRenderer(scene);
    }

    public set positionGizmoEnabled(enabled: boolean) {
        this._toggle("positionGizmo", enabled, () => new PositionGizmo(this._layer));
    }
    public set rotationGizmoEnabled(enabled: boolean) {
        this._toggle("rotationGizmo", enabled, () => new RotationGizmo(this._layer));
    }
    public set scaleGizmoEnabled(enabled: boolean) {
        this._toggle("scaleGizmo", enabled, () => new ScaleGizmo(this._layer));
    }
    public set boundingBoxGizmoEnabled(enabled: boolean) {
        this._toggle("boundingBoxGizmo", enabled, () => new BoundingBoxGizmo(this._layer));
    }

    public attachToMesh(mesh: Mesh | null): void {
        this._attached = mesh;
        if (this.gizmos.positionGizmo) {
            this.gizmos.positionGizmo.attachedMesh = mesh;
        }
        if (this.gizmos.rotationGizmo) {
            this.gizmos.rotationGizmo.attachedMesh = mesh;
        }
        if (this.gizmos.scaleGizmo) {
            this.gizmos.scaleGizmo.attachedMesh = mesh;
        }
        if (this.gizmos.boundingBoxGizmo) {
            this.gizmos.boundingBoxGizmo.attachedMesh = mesh;
        }
    }

    public dispose(): void {
        this.gizmos.positionGizmo?.dispose();
        this.gizmos.rotationGizmo?.dispose();
        this.gizmos.scaleGizmo?.dispose();
        this.gizmos.boundingBoxGizmo?.dispose();
        this._layer.dispose();
    }

    private _toggle<K extends "positionGizmo" | "rotationGizmo" | "scaleGizmo" | "boundingBoxGizmo">(
        key: K,
        enabled: boolean,
        make: () => PositionGizmo | RotationGizmo | ScaleGizmo | BoundingBoxGizmo
    ): void {
        if (enabled && !this.gizmos[key]) {
            const gizmo = make() as never;
            this.gizmos[key] = gizmo;
            (this.gizmos[key] as unknown as { attachedMesh: AbstractMesh | null }).attachedMesh = this._attached;
        } else if (!enabled && this.gizmos[key]) {
            this.gizmos[key]!.dispose();
            this.gizmos[key] = null;
        }
    }
}
