import type { Mesh } from "../mesh/mesh.js";
import type { Ray } from "./ray.js";

/** Result of a GPU pick operation. */
export interface PickingInfo {
    hit: boolean;
    distance: number;
    pickedPoint: [number, number, number] | null;
    pickedMesh: Mesh | null;
    faceId: number;
    bu: number;
    bv: number;
    subMeshId: number;
    thinInstanceIndex: number;
    ray: Ray | null;
}

/** Create an empty (miss) picking result. */
export function createEmptyPickingInfo(): PickingInfo {
    return {
        hit: false,
        distance: 0,
        pickedPoint: null,
        pickedMesh: null,
        faceId: -1,
        bu: 0,
        bv: 0,
        subMeshId: 0,
        thinInstanceIndex: -1,
        ray: null,
    };
}
