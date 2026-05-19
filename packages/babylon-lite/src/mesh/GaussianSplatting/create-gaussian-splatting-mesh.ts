import type { EngineContextInternal } from "../../engine/engine.js";
import type { SceneContext } from "../../scene/scene-core.js";
import type { GaussianSplattingMesh, GsShaderFragment } from "./gaussian-splatting-mesh.js";
import { createGaussianSplattingMesh } from "./gaussian-splatting-mesh.js";
import { buildSplatGeometry, type ParsedSplat } from "../../loader-splat/splat-data.js";
import { attachGaussianSplattingMesh } from "./gaussian-splatting-pipeline.js";
import SplatSortWorker from "../../loader-splat/splat-sort-worker.ts?worker&inline";

export function createProceduralGaussianSplattingMesh(scene: SceneContext, name: string, splatCount: number, fragments?: readonly GsShaderFragment[]): GaussianSplattingMesh {
    const ROW = 32;
    const buffer = new ArrayBuffer(ROW * splatCount);
    const u8 = new Uint8Array(buffer);
    for (let i = 0; i < splatCount; i++) {
        u8[i * ROW + 24 + 3] = 255;
        u8[i * ROW + 28 + 0] = 255;
        u8[i * ROW + 28 + 1] = 128;
        u8[i * ROW + 28 + 2] = 128;
        u8[i * ROW + 28 + 3] = 128;
    }
    const parsed: ParsedSplat = { data: buffer };
    const geom = buildSplatGeometry(parsed.data);
    const worker = new SplatSortWorker({ name: "babylon-lite-splat-sort" });
    const eng = scene.engine as EngineContextInternal;
    const mesh = createGaussianSplattingMesh(eng, name, geom, worker, parsed);
    attachGaussianSplattingMesh(scene, mesh, fragments);
    return mesh;
}
