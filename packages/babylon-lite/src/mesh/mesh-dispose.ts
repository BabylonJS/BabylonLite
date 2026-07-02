import type { Mesh } from "./mesh.js";
import { releaseGpuResource } from "./mesh-gpu-refcount.js";

/** Destroy all GPU resources owned by a mesh (vertex buffers, skeleton, morph targets).
 *  `_gpu`/`skeleton`/`morphTargets`/`thinInstances` may be SHARED with a clone made via
 *  `cloneTransformNode` (see mesh-gpu-refcount.ts) — each resource is only actually
 *  destroyed once its last owning mesh releases it, so a clone's still-in-use buffers
 *  are never freed out from under it (and never double-freed once both are disposed). */
export function disposeMeshGpu(mesh: Mesh): void {
    const g = mesh._gpu;
    if (releaseGpuResource(g)) {
        g.positionBuffer.destroy();
        g.normalBuffer.destroy();
        g.uvBuffer.destroy();
        g.indexBuffer.destroy();
        g.tangentBuffer?.destroy();
        g.uv2Buffer?.destroy();
        g.colorBuffer?.destroy();
    }
    const ti = mesh.thinInstances;
    if (ti && releaseGpuResource(ti)) {
        ti._gpuBuffer?.destroy();
        ti._colorGpuBuffer?.destroy();
    }
    const sk = mesh.skeleton;
    if (sk && releaseGpuResource(sk)) {
        sk.boneTexture.destroy();
        sk.jointsBuffer.destroy();
        sk.weightsBuffer.destroy();
        sk.joints1Buffer?.destroy();
        sk.weights1Buffer?.destroy();
    }
    const mt = mesh.morphTargets;
    if (mt && releaseGpuResource(mt)) {
        mt.deltasBuffer.destroy();
        mt.weightsBuffer.destroy();
    }
}
