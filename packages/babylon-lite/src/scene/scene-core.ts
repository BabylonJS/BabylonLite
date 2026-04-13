import type { Engine } from "../engine/engine.js";
import type { EngineInternal } from "../engine/engine.js";
import type { Camera } from "../camera/camera.js";
import type { LightBase } from "../light/types.js";
import type { Mesh } from "../mesh/mesh.js";
import type { MeshInternal } from "../mesh/mesh.js";
import type { AnimationGroup } from "../animation/animation-group.js";
import type { ShadowGenerator } from "../shadow/shadow-generator.js";
import type { FogConfig } from "../material/standard/standard-material.js";
import type { Renderable, PrePassRenderable, SceneUniformUpdater, MeshGroupBuilder } from "../render/renderable.js";
import type { TransformNode } from "./transform-node.js";
import type { SceneNode } from "./scene-node.js";
import type { SkyboxData } from "../loader-skybox/load-skybox.js";
import type { EnvironmentTextures } from "../loader-env/load-env.js";
import type { ComposedShader } from "../shader/fragment-types.js";
import type { LoaderResult } from "../loader-results.js";

/** Image processing configuration. */
export interface ImageProcessingConfig {
    exposure: number;
    contrast: number;
    toneMappingEnabled: boolean;
}

/** Top-level scene context — flat struct, no deep hierarchy. */
export interface SceneContext {
    readonly engine: Engine;
    clearColor: GPUColorDict;
    camera: Camera | null;
    lights: LightBase[];
    imageProcessing: ImageProcessingConfig;

    /** All meshes added to the scene (standard + PBR). */
    meshes: Mesh[];

    /** Animation groups loaded from glTF or created manually. */
    animationGroups: AnimationGroup[];

    /** Fog configuration. Null = no fog. */
    fog: FogConfig | null;

    /** Shadow generators registered on this scene.
     *  @deprecated — use light.shadowGenerator instead. Kept for backward compat during migration. */
    shadowGenerators: ShadowGenerator[];

    /** Background material primaryColor (linear RGB). Default from Babylon createDefaultEnvironment. */
    environmentPrimaryColor?: [number, number, number];

    /** Environment cubemap Y rotation in radians. */
    envRotationY?: number;

    // ─── Renderable-based rendering (new architecture) ─────────

    /** Sorted list of renderables. Built lazily by engine.start(). */
    _renderables: Renderable[];
    /** Opaque renderables — sorted by order at build time. */
    _opaqueRenderables: Renderable[];
    /** Transparent renderables — sorted per-frame by camera distance (back-to-front). */
    _transparentRenderables: Renderable[];
    /** Pre-pass work (shadow maps, compute, etc.). */
    _prePasses: PrePassRenderable[];
    /** Scene uniform updaters (one per shared UBO). */
    _uniformUpdaters: SceneUniformUpdater[];
    /** Fixed delta time in ms for deterministic animation. 0 = use real rAF delta. */
    fixedDeltaMs: number;

    /** Register a callback to run before each rendered frame. */
    onBeforeRender(cb: (deltaMs: number) => void): void;

    /** Fixed delta time in ms for deterministic animation. 0 = use real rAF delta. */
    _fixedDeltaMs: number;
    /** Per-frame callbacks run before rendering (animation, physics, etc.). */
    _beforeRender: ((deltaMs: number) => void)[];
    /** Deferred builders — registered by loaders/factories, run once at engine.start(). */
    _deferredBuilders: (() => void | Promise<void>)[];
    /** Run all deferred builders (called by engine.start before the render loop). */
    _build(): Promise<void>;

    /** Add an entity (mesh, light, camera, transform node, shadow generator, or loader result) to the scene. */
    add(entity: Mesh | LightBase | Camera | ShadowGenerator | TransformNode | LoaderResult): void;

    // ─── Dispose infrastructure ────────────────────────────────

    /** Shared cleanup callbacks (scene UBOs, lights UBOs, etc.). Registered by builders. */
    _disposables: (() => void)[];
    /** Per-mesh cleanup callbacks (mesh UBOs, bind groups). For material swap + dispose. */
    _meshDisposables: Map<Mesh, (() => void)[]>;
    /** Meshes whose material was changed via setter — drained before each render frame. */
    _materialSwapQueue: Mesh[];
    /** Drain _materialSwapQueue: dispose old resources and rebuild renderables. */
    _processMaterialSwaps(): void;
    /** Whether this scene has been disposed. */
    _disposed: boolean;
    /** Release all GPU resources owned by this scene. */
    dispose(): void;
}

/** @internal SceneContext with internal rendering state — for renderable/loader code only. Not re-exported from index.ts. */
export interface SceneContextInternal extends SceneContext {
    _renderables: Renderable[];
    _opaqueRenderables: Renderable[];
    _transparentRenderables: Renderable[];
    _prePasses: PrePassRenderable[];
    _uniformUpdaters: SceneUniformUpdater[];
    _fixedDeltaMs: number;
    _beforeRender: ((deltaMs: number) => void)[];
    _deferredBuilders: (() => void | Promise<void>)[];
    _build(): Promise<void>;
    _disposables: (() => void)[];
    _meshDisposables: Map<Mesh, (() => void)[]>;
    _materialSwapQueue: Mesh[];
    _processMaterialSwaps(): void;
    _disposed: boolean;

    // ─── Stashed internal state (typed to avoid `as any` casts) ────
    _skybox?: SkyboxData;
    _envTextures?: EnvironmentTextures;
    _irradianceSH?: Float32Array;
    _pbrSceneBGL?: GPUBindGroupLayout;
    _pbrSceneBG?: GPUBindGroup;
    _composePbr?: (features: number) => ComposedShader;
    _standardSceneUBO?: GPUBuffer;
    _pbrLightsUBO?: GPUBuffer;
    _pbrLightsUBOScratch?: Float32Array;
}

/** Install a property setter on mesh.material that sets _materialDirty
 *  and pushes the mesh into the scene's swap queue for processing. */
function installMaterialSetter(scene: SceneContext, mesh: Mesh): void {
    const mi = mesh as MeshInternal;
    let _mat = mesh.material;
    Object.defineProperty(mesh, "material", {
        get() {
            return _mat;
        },
        set(v) {
            if (v !== _mat) {
                _mat = v;
                if (!mi._materialDirty) {
                    mi._materialDirty = true;
                    scene._materialSwapQueue.push(mesh);
                }
            }
        },
        configurable: true,
        enumerable: true,
    });
}

/** Create an empty scene context bound to the given engine. */
export function createSceneContext(engine: Engine): SceneContext {
    // Collect meshes per builder (Map doubles as "already registered" check)
    const _groups = new Map<MeshGroupBuilder, Mesh[]>();

    const ctx: SceneContext = {
        engine,
        clearColor: { r: 0.2, g: 0.2, b: 0.3, a: 1.0 },
        camera: null,
        lights: [],
        meshes: [],
        animationGroups: [],
        fog: null,
        shadowGenerators: [],
        imageProcessing: { exposure: 1.0, contrast: 1.0, toneMappingEnabled: false },
        _renderables: [],
        _opaqueRenderables: [],
        _transparentRenderables: [],
        _prePasses: [],
        _uniformUpdaters: [],
        _fixedDeltaMs: 0,
        get fixedDeltaMs(): number {
            return ctx._fixedDeltaMs;
        },
        set fixedDeltaMs(v: number) {
            ctx._fixedDeltaMs = v;
        },
        onBeforeRender(cb: (deltaMs: number) => void): void {
            ctx._beforeRender.unshift(cb);
        },
        _beforeRender: [],
        _deferredBuilders: [],
        _disposables: [],
        _meshDisposables: new Map(),
        _materialSwapQueue: [],
        _processMaterialSwaps() {
            const q = ctx._materialSwapQueue;
            for (const mesh of q) {
                (mesh as MeshInternal)._materialDirty = false;
                const old = ctx._meshDisposables.get(mesh);
                if (old) {
                    for (const fn of old) {
                        fn();
                    }
                    ctx._meshDisposables.delete(mesh);
                }

                const mat = mesh.material;
                const builder = mat ? (mat as any)._buildGroup : undefined;
                if (!builder) {
                    continue;
                }
                const rebuild = builder._rebuildSingle;
                if (rebuild) {
                    const renderable = rebuild(ctx, mesh);
                    if (renderable.isTransparent) {
                        ctx._transparentRenderables.push(renderable);
                    } else {
                        const arr = ctx._opaqueRenderables;
                        let i = arr.length;
                        while (i > 0 && arr[i - 1]!.order > renderable.order) {
                            i--;
                        }
                        arr.splice(i, 0, renderable);
                    }
                } else if (builder._loadRebuildSingle) {
                    builder._loadRebuildSingle().then((mod: any) => {
                        builder._rebuildSingle = mod.buildSinglePbrRenderable ?? mod.buildSingleStandardRenderable;
                        (mesh as MeshInternal)._materialDirty = true;
                        ctx._materialSwapQueue.push(mesh);
                    });
                }
            }
            q.length = 0;
        },
        _disposed: false,
        async _build() {
            // Run in passes — builders may re-register to run after dependencies are ready
            while (ctx._deferredBuilders.length > 0) {
                const builders = [...ctx._deferredBuilders];
                ctx._deferredBuilders = [];
                await Promise.all(builders.map(async (b) => b()));
            }
            for (const mesh of ctx._materialSwapQueue) {
                (mesh as MeshInternal)._materialDirty = false;
            }
            ctx._materialSwapQueue.length = 0;
        },
        dispose() {
            if (ctx._disposed) {
                return;
            }
            ctx._disposed = true;
            for (const fn of ctx._disposables) {
                fn();
            }
            for (const fns of ctx._meshDisposables.values()) {
                for (const fn of fns) {
                    fn();
                }
            }
            ctx._meshDisposables.clear();
            for (const mesh of ctx.meshes) {
                const g = (mesh as MeshInternal)._gpu;
                g.positionBuffer.destroy();
                g.normalBuffer.destroy();
                g.uvBuffer.destroy();
                g.indexBuffer.destroy();
                g.tangentBuffer?.destroy();
                g.uv2Buffer?.destroy();
                const sk = mesh.skeleton;
                if (sk) {
                    sk.boneTexture.destroy();
                    sk.jointsBuffer.destroy();
                    sk.weightsBuffer.destroy();
                    sk.joints1Buffer?.destroy();
                    sk.weights1Buffer?.destroy();
                }
                if (mesh.morphTargets) {
                    mesh.morphTargets.texture.destroy();
                    mesh.morphTargets.weightsBuffer.destroy();
                }
            }
            ctx.meshes.length = 0;
            ctx._renderables.length = 0;
            ctx._opaqueRenderables.length = 0;
            ctx._transparentRenderables.length = 0;
            ctx._prePasses.length = 0;
            ctx._uniformUpdaters.length = 0;
            ctx._beforeRender.length = 0;
            ctx._deferredBuilders.length = 0;
            ctx._disposables.length = 0;
            ctx._materialSwapQueue.length = 0;
            ctx.lights.length = 0;
            ctx.animationGroups.length = 0;
            ctx.shadowGenerators.length = 0;
            ctx.camera = null;
        },
        add(entity: Mesh | LightBase | Camera | ShadowGenerator | TransformNode | LoaderResult) {
            // LoaderResult from loadGltf / loadBabylon — process each field present
            if ("entities" in entity) {
                const result = entity as LoaderResult;
                for (const e of result.entities) {
                    ctx.add(e);
                }
                if (result.clearColor) {
                    ctx.clearColor = result.clearColor;
                }
                if (result.animationGroups?.length) {
                    const device = (ctx.engine as EngineInternal).device;
                    const groups = result.animationGroups;
                    ctx.animationGroups.push(...groups);
                    ctx._beforeRender.push((deltaMs: number) => {
                        for (const g of groups) {
                            g._tick(deltaMs, device);
                        }
                    });
                }
                return;
            }
            if ("_gpu" in entity && "material" in entity) {
                const mesh = entity as unknown as Mesh;
                ctx.meshes.push(mesh);
                installMaterialSetter(ctx, mesh);
                const build = mesh.material ? ((mesh.material as any)._buildGroup as MeshGroupBuilder | undefined) : undefined;
                if (build) {
                    let group = _groups.get(build);
                    if (!group) {
                        group = [];
                        _groups.set(build, group);
                        ctx._deferredBuilders.push(async () => {
                            const result = await build(ctx, group!);
                            ctx._renderables.push(...result.renderables);
                            ctx._uniformUpdaters.push(result.updater);
                        });
                    }
                    group.push(mesh);
                }
            } else if ("lightType" in entity) {
                ctx.lights.push(entity as LightBase);
            }
            // Recurse into children of meshes, lights, cameras — set parent links
            const kids = (entity as unknown as SceneNode).children;
            if (kids?.length) {
                for (const child of kids) {
                    (child as unknown as SceneNode).parent = entity as unknown as SceneNode;
                    ctx.add(child);
                }
            }
        },
    };
    return ctx;
}
