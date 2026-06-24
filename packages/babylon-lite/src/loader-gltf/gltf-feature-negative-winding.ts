/** Negative-determinant winding feature — dynamically imported.
 *
 *  glTF nodes may carry a negative scale (or a `matrix` with negative
 *  determinant). Combined with the RH→LH root flip (itself a -1 determinant), a
 *  mesh whose net world-matrix determinant is POSITIVE has its triangle winding
 *  reversed relative to a normal mesh, so the default ccw / back-face culling
 *  culls the wrong faces (the mirrored copy renders inside-out / with holes —
 *  glTF-Asset-Generator Node_NegativeScale).
 *
 *  This feature flags such meshes with `_reverseWinding`, which becomes the
 *  `MSH_REVERSE_WINDING` mesh-feature bit; the PBR pipeline then culls "front"
 *  for them (matching BJS, which flips sideOrientation on negative determinant).
 *  The mirrored normal itself needs no correction: for an axis mirror
 *  `finalWorld` already equals the normal matrix (inverse-transpose).
 *
 *  Registered gated on a negative-scale / matrix node, so the common
 *  positive-scale / pure-TRS case never loads this module — zero bundle cost. */
import type { GltfFeature } from "./gltf-feature.js";

const feature: GltfFeature = {
    id: "_negative_winding",
    async applyMesh(meshData, mesh) {
        const wm = meshData._worldMatrix as unknown as ArrayLike<number>;
        const det3 = wm[0]! * (wm[5]! * wm[10]! - wm[6]! * wm[9]!) + wm[1]! * (wm[6]! * wm[8]! - wm[4]! * wm[10]!) + wm[2]! * (wm[4]! * wm[9]! - wm[5]! * wm[8]!);
        if (det3 > 0) {
            (mesh as { _reverseWinding?: boolean })._reverseWinding = true;
        }
    },
};
export default feature;
