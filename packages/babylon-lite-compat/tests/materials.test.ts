import { describe, expect, it } from "vitest";

import { StandardMaterial } from "../src/materials/materials";
import type { BaseTexture } from "../src/textures/textures";

/** Minimal stand-in for a resolved compat texture (only `_lite` is read by the setters). */
function fakeTexture(): BaseTexture {
    return { _lite: { id: "tex" } } as unknown as BaseTexture;
}

describe("StandardMaterial texture proxies", () => {
    it("wires emissiveTexture onto the Lite material", () => {
        const mat = new StandardMaterial("dog");
        expect(mat.emissiveTexture).toBeNull();
        expect(mat._lite.emissiveTexture).toBeNull();

        const tex = fakeTexture();
        mat.emissiveTexture = tex;
        expect(mat.emissiveTexture).toBe(tex);
        expect(mat._lite.emissiveTexture).toBe(tex._lite);

        mat.emissiveTexture = null;
        expect(mat.emissiveTexture).toBeNull();
        expect(mat._lite.emissiveTexture).toBeNull();
    });

    it("the same texture can back both diffuse and emissive slots (basis scene 36)", () => {
        const mat = new StandardMaterial("dog");
        const tex = fakeTexture();
        mat.diffuseTexture = tex;
        mat.emissiveTexture = tex;
        expect(mat._lite.diffuseTexture).toBe(tex._lite);
        expect(mat._lite.emissiveTexture).toBe(tex._lite);
    });
});
