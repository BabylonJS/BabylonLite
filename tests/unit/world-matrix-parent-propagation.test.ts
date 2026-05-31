import { describe, it, expect } from "vitest";

import { createSceneNode } from "../../packages/babylon-lite/src/scene/scene-node";

describe("world matrix parent propagation", () => {
    it("bumps a child's worldMatrixVersion when an ancestor's transform changes", () => {
        const parent = createSceneNode("parent");
        const child = createSceneNode("child");
        child.parent = parent;

        // Establish baseline versions (simulates a per-frame consumer that
        // gates UBO uploads on worldMatrixVersion and only reads worldMatrix
        // when the version changed).
        const v0 = child.worldMatrixVersion;

        // Animate ONLY the parent — nothing reads the child's worldMatrix.
        parent.rotation.y = Math.PI / 2;

        const v1 = child.worldMatrixVersion;
        expect(v1).not.toBe(v0);

        // Stable once nothing changes again.
        expect(child.worldMatrixVersion).toBe(v1);
    });

    it("propagates an ancestor change through a multi-level hierarchy", () => {
        const root = createSceneNode("root");
        const mid = createSceneNode("mid");
        const leaf = createSceneNode("leaf");
        mid.parent = root;
        leaf.parent = mid;

        const v0 = leaf.worldMatrixVersion;

        root.position.set(5, 0, 0);

        const v1 = leaf.worldMatrixVersion;
        expect(v1).not.toBe(v0);

        // The leaf's world matrix reflects the ancestor translation.
        expect(leaf.worldMatrix[12]).toBeCloseTo(5);
    });

    it("does not bump the version on repeated reads when nothing changes", () => {
        const parent = createSceneNode("parent");
        const child = createSceneNode("child");
        child.parent = parent;

        const v0 = child.worldMatrixVersion;
        expect(child.worldMatrixVersion).toBe(v0);
        expect(child.worldMatrixVersion).toBe(v0);
    });
});
