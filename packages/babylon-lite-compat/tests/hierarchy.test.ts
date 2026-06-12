import { describe, expect, it } from "vitest";

import { Node } from "../src/node/node";
import { Mesh, AbstractMesh, TransformNode } from "../src/meshes/meshes";

/**
 * The compat layer reproduces the Babylon.js scene-graph inheritance chain
 * (`Mesh → AbstractMesh → TransformNode → Node`). These tests assert the chain
 * and the placement of inherited members without needing a GPU device.
 */
describe("Scene-graph class hierarchy", () => {
    it("reproduces Mesh → AbstractMesh → TransformNode → Node", () => {
        // Prototype-chain assertions don't require a constructed (GPU-backed) mesh.
        expect(Object.getPrototypeOf(Mesh)).toBe(AbstractMesh);
        expect(Object.getPrototypeOf(AbstractMesh)).toBe(TransformNode);
        expect(Object.getPrototypeOf(TransformNode)).toBe(Node);
    });

    it("places getScene on Node (inherited by the whole chain)", () => {
        expect(typeof Node.prototype.getScene).toBe("function");
        // Mesh inherits getScene from Node rather than redefining it.
        expect(Mesh.prototype.getScene).toBe(Node.prototype.getScene);
        expect(AbstractMesh.prototype.getScene).toBe(Node.prototype.getScene);
    });

    it("places transform accessors on TransformNode", () => {
        const descriptor = Object.getOwnPropertyDescriptor(TransformNode.prototype, "position");
        expect(descriptor?.get).toBeTypeOf("function");
        expect(descriptor?.set).toBeTypeOf("function");
    });

    it("reports the Babylon.js class names via getClassName", () => {
        // getClassName is overridden per level; check via prototype invocation.
        expect(Node.prototype.getClassName.call({})).toBe("Node");
        expect(TransformNode.prototype.getClassName.call({})).toBe("TransformNode");
        expect(AbstractMesh.prototype.getClassName.call({})).toBe("AbstractMesh");
        expect(Mesh.prototype.getClassName.call({})).toBe("Mesh");
    });

    it("an adopted instance is instanceof the whole chain", () => {
        // Build a minimal Mesh via the prototype to exercise instanceof wiring
        // without a GPU-backed Lite mesh.
        const mesh = Object.create(Mesh.prototype) as Mesh;
        expect(mesh).toBeInstanceOf(Mesh);
        expect(mesh).toBeInstanceOf(AbstractMesh);
        expect(mesh).toBeInstanceOf(TransformNode);
        expect(mesh).toBeInstanceOf(Node);
    });
});
