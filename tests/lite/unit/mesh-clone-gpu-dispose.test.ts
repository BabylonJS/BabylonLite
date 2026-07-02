import { describe, expect, it, vi } from "vitest";

import { cloneTransformNode } from "../../../packages/babylon-lite/src/scene/transform-node";
import { disposeMeshGpu } from "../../../packages/babylon-lite/src/mesh/mesh-dispose";
import type { Mesh, MeshGPU } from "../../../packages/babylon-lite/src/mesh/mesh";
import { ObservableVec3 } from "../../../packages/babylon-lite/src/math/observable-vec3";
import { ObservableQuat } from "../../../packages/babylon-lite/src/math/observable-quat";

function fakeBuffer(): GPUBuffer {
    return { destroy: vi.fn() } as unknown as GPUBuffer;
}

function makeMesh(gpu: MeshGPU): Mesh {
    return {
        name: "src",
        children: [],
        position: new ObservableVec3(0, 0, 0, () => {}),
        rotationQuaternion: new ObservableQuat(0, 0, 0, 1, () => {}),
        scaling: new ObservableVec3(1, 1, 1, () => {}),
        material: undefined,
        receiveShadows: false,
        _gpu: gpu,
    } as unknown as Mesh;
}

describe("mesh clone GPU buffer ownership", () => {
    it("does not destroy shared buffers when the source mesh is disposed while a clone is still alive", () => {
        const gpu: MeshGPU = {
            positionBuffer: fakeBuffer(),
            normalBuffer: fakeBuffer(),
            uvBuffer: fakeBuffer(),
            indexBuffer: fakeBuffer(),
            indexCount: 3,
            indexFormat: "uint16",
        };
        const src = makeMesh(gpu);
        const clone = cloneTransformNode(src) as Mesh;

        // Clones share the exact same `_gpu` object (buffer-sharing, not a full duplicate).
        expect(clone._gpu).toBe(src._gpu);

        // Disposing the source first must NOT destroy the buffers — the clone still owns them.
        disposeMeshGpu(src);
        expect(gpu.positionBuffer.destroy).not.toHaveBeenCalled();
        expect(gpu.normalBuffer.destroy).not.toHaveBeenCalled();
        expect(gpu.uvBuffer.destroy).not.toHaveBeenCalled();
        expect(gpu.indexBuffer.destroy).not.toHaveBeenCalled();

        // Disposing the clone (the last owner) must destroy them exactly once — no double-free.
        disposeMeshGpu(clone);
        expect(gpu.positionBuffer.destroy).toHaveBeenCalledTimes(1);
        expect(gpu.normalBuffer.destroy).toHaveBeenCalledTimes(1);
        expect(gpu.uvBuffer.destroy).toHaveBeenCalledTimes(1);
        expect(gpu.indexBuffer.destroy).toHaveBeenCalledTimes(1);
    });

    it("destroys buffers immediately for a mesh that was never cloned", () => {
        const gpu: MeshGPU = {
            positionBuffer: fakeBuffer(),
            normalBuffer: fakeBuffer(),
            uvBuffer: fakeBuffer(),
            indexBuffer: fakeBuffer(),
            indexCount: 3,
            indexFormat: "uint16",
        };
        const src = makeMesh(gpu);
        disposeMeshGpu(src);
        expect(gpu.positionBuffer.destroy).toHaveBeenCalledTimes(1);
    });

    it("device-lost recovery reassigning `mesh._gpu` to a fresh object (never mutating the shared object in place) cleanly un-aliases source and clone without corrupting either's disposal", () => {
        // Mirrors device-lost-recovery.ts::rebuildMeshes, which does `mesh._gpu = uploadRetainedMesh(...)` —
        // a whole-object property reassignment, never `Object.assign(mesh._gpu, ...)` on the shared
        // instance. Since `_cpuPositions`/`_cpuNormals`/`_cpuIndices` are shared by reference between a
        // mesh and its clone, both or neither independently qualify for reassignment — this test asserts
        // the "both reassigned" case, which is the one where an in-place-mutation implementation would
        // have corrupted the sibling's buffers.
        const gpu: MeshGPU = {
            positionBuffer: fakeBuffer(),
            normalBuffer: fakeBuffer(),
            uvBuffer: fakeBuffer(),
            indexBuffer: fakeBuffer(),
            indexCount: 3,
            indexFormat: "uint16",
        };
        const src = makeMesh(gpu);
        const clone = cloneTransformNode(src) as Mesh;
        expect(clone._gpu).toBe(src._gpu);

        // Simulate device-lost recovery rebuilding EACH mesh independently (as it does for any mesh
        // with retained CPU geometry — a condition that is always symmetric between clone and source).
        const newSrcGpu: MeshGPU = { ...gpu, positionBuffer: fakeBuffer(), normalBuffer: fakeBuffer(), uvBuffer: fakeBuffer(), indexBuffer: fakeBuffer() };
        const newCloneGpu: MeshGPU = { ...gpu, positionBuffer: fakeBuffer(), normalBuffer: fakeBuffer(), uvBuffer: fakeBuffer(), indexBuffer: fakeBuffer() };
        src._gpu = newSrcGpu;
        clone._gpu = newCloneGpu;

        // The original shared object is now unreferenced by either mesh — its buffers belong to the
        // dead/lost device and are never explicitly destroyed by this path (matches pre-existing
        // behavior; harmless since the whole GPUDevice was already invalidated).
        expect(src._gpu).not.toBe(clone._gpu);

        // Post-recovery, each mesh independently owns its own fresh buffers and disposal must not
        // cross-affect the other.
        disposeMeshGpu(src);
        expect(newSrcGpu.positionBuffer.destroy).toHaveBeenCalledTimes(1);
        expect(newCloneGpu.positionBuffer.destroy).not.toHaveBeenCalled();

        disposeMeshGpu(clone);
        expect(newCloneGpu.positionBuffer.destroy).toHaveBeenCalledTimes(1);
    });
});
