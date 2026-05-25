import type { EngineContext, EngineContextInternal } from "../../engine/engine.js";
import type { AssetContainer } from "../../asset-container.js";
import type { Renderable } from "../../render/renderable.js";
import type { SceneContext } from "../../scene/scene.js";
import type { SceneContextInternal } from "../../scene/scene.js";
import type { Texture2D } from "../../texture/texture-2d.js";
import { addTaskAtStart } from "../../frame-graph/frame-graph-actions.js";
import { createRenderTask } from "../../frame-graph/render-task.js";
import type { Pass } from "../../frame-graph/pass.js";
import type { Task } from "../../frame-graph/task.js";
import { createMipRenderTargetTexture } from "../../texture/rtt-mip.js";
import { recordMipmaps } from "../../texture/generate-mipmaps.js";
import { biasedMipLevelCount } from "../../texture/mip-count.js";
import { _registerPbrExt } from "./pbr-flags.js";
import { refractionRttExt, setOpaqueSceneRefractionTexture, useOpaqueSceneRefraction } from "./fragments/refraction-rtt-fragment.js";

const REFRACTION_TEXTURE_SIZE = 1024;
// The refraction RTT shader samples `log2(textureSize * alphaG) - 4.0`, so the
// highest four mips are unreachable and don't need to be allocated/generated.
const REFRACTION_LOD_BIAS = 4;

export function enablePbrOpaqueRefraction(scene: SceneContext, engine: EngineContext): void {
    setOpaqueSceneRefractionTexture(setupPbrRefraction(scene, engine as EngineContextInternal));
    _registerPbrExt(refractionRttExt);
}

export function usePbrOpaqueRefraction(container: AssetContainer): void {
    useOpaqueSceneRefraction(container);
}

export function selectOpaqueSceneRefractionRenderables(renderables: readonly Renderable[]): Renderable[] {
    return renderables.filter((r) => !r._transmissive && ((r.mesh?.material as { _opaqueRefractionIntensity?: number } | undefined)?._opaqueRefractionIntensity ?? 0) <= 0);
}

function setupPbrRefraction(scene: SceneContext, engine: EngineContextInternal): Texture2D {
    const rtt = createMipRenderTargetTexture(engine, {
        label: "opaqueSceneTexture",
        colorFormat: "rgba16float",
        depthStencilFormat: "depth24plus-stencil8",
        mipLevelCount: biasedMipLevelCount(REFRACTION_TEXTURE_SIZE, REFRACTION_TEXTURE_SIZE, REFRACTION_LOD_BIAS),
        size: { width: REFRACTION_TEXTURE_SIZE, height: REFRACTION_TEXTURE_SIZE },
    });
    const sc = scene as SceneContextInternal;
    const pass = createRenderTask(
        {
            name: "opaqueSceneTexture",
            rt: rtt.rt,
            clrColor: sc.clearColor,
            cs: true,
        },
        engine,
        scene
    );
    const execute = pass.execute!;
    pass.execute = () => {
        const imageProcessing = sc.imageProcessing as { toneMappingEnabled: boolean | number };
        const toneMappingEnabled = imageProcessing.toneMappingEnabled;
        imageProcessing.toneMappingEnabled = -1;
        try {
            return execute();
        } finally {
            imageProcessing.toneMappingEnabled = toneMappingEnabled;
        }
    };
    const mips: Task = {
        name: "opaqueSceneTexture-mips",
        engine,
        scene: sc,
        _passes: [],
        record(): void {
            const mipPass: Pass = {
                name: `${mips.name}-pass`,
                _parentTask: mips,
                _dependencies: new Set([rtt.rt]),
                _executeFunc: null,
                _beforeExecute: null,
                _initialize(): void {
                    return;
                },
                _execute(): number {
                    recordMipmaps(engine, rtt.texture.texture, engine._currentEncoder);
                    return 0;
                },
                _dispose(): void {
                    return;
                },
            };
            mips._passes.push(mipPass);
        },
        dispose(): void {
            this._passes.length = 0;
        },
    };
    addTaskAtStart(scene, mips);
    addTaskAtStart(scene, pass);
    sc._deferredBuilders.push(() => {
        sc._deferredBuilders.push(() => {
            pass._renderables.length = 0;
            pass._renderables.push(...selectOpaqueSceneRefractionRenderables(sc._renderables));
            sc._frameGraph.build();
        });
    });
    return rtt.texture;
}
