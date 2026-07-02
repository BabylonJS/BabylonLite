/** Ref-counting for GPU resource objects shared across mesh clones.
 *
 *  `cloneTransformNode`/`cloneMeshNode` intentionally SHARE geometry (mesh._gpu),
 *  skeleton, morph-target, and thin-instance GPU buffers between a source mesh and
 *  its clone (mirrors BJS `Mesh.clone()` — cheap instancing, no duplicate GPU memory).
 *  Each of those resource objects (the `MeshGPU`, `SkeletonData`, `MorphTargetData`,
 *  `ThinInstanceData` instances) may therefore be referenced by more than one `Mesh`.
 *
 *  `disposeMeshGpu` must only actually call `.destroy()` on the underlying GPUBuffers
 *  when the LAST owning mesh releases the resource — otherwise removing/disposing one
 *  mesh frees buffers a sibling clone still renders with (use-after-free), and disposing
 *  the sibling afterwards double-frees the same GPUBuffer.
 *
 *  A resource with no entry in the map is implicitly owned by exactly one mesh (the
 *  common case — no clone was ever made), so creation sites don't need to register
 *  anything up front. `retainGpuResource` is called once per EXTRA owner (i.e. once per
 *  clone); `releaseGpuResource` is called once per owner that goes away and reports
 *  whether it was the last one. Lazily-allocated WeakMap (pillar 4: no module-level
 *  side effects), mirrors the pattern used by `mesh-scene-registry.ts`.
 *
 *  INVARIANT: any code path that reassigns one of these tracked fields away from its
 *  current value (e.g. `mesh.skeleton = null`) OUTSIDE of `disposeMeshGpu` MUST call
 *  `releaseGpuResource` on the OLD value first — otherwise that mesh's claim is silently
 *  dropped without ever being released, permanently pinning the refcount above zero and
 *  leaking the resource forever (no remaining owner can ever be seen as "last"). See
 *  `vat/vat-baker.ts::attachVat`, which drops `mesh.skeleton` when baking a VAT. */
let _gpuRefCounts: WeakMap<object, number> | null = null;

/** @internal Register an additional owner of a shared GPU resource (called when a mesh
 *  clone starts sharing `_gpu`/`skeleton`/`morphTargets`/`thinInstances` with its source). */
export function retainGpuResource(resource: object): void {
    const map = (_gpuRefCounts ??= new WeakMap());
    map.set(resource, (map.get(resource) ?? 1) + 1);
}

/** @internal Release one owner's claim on a shared GPU resource. Returns `true` when this
 *  was the last claim — the caller should now destroy the underlying GPU buffers. A
 *  resource that was never retained (never cloned) also returns `true` on its first (and
 *  only) release, since it has exactly one implicit owner. */
export function releaseGpuResource(resource: object): boolean {
    const map = _gpuRefCounts;
    const count = map?.get(resource);
    if (count === undefined) {
        return true;
    }
    if (count <= 1) {
        map!.delete(resource);
        return true;
    }
    map!.set(resource, count - 1);
    return false;
}
