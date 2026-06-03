import { describe, expect, it, vi } from "vitest";

import type { GlyphCurves } from "../../packages/babylon-lite/src/text/public-types";
import { createTextData, disposeTextData, updateTextData } from "../../packages/babylon-lite/src/text/text-data";
import { getSharedAtlasForCurves } from "../../packages/babylon-lite/src/text/internal";
import type { SharedAtlas, SharedAtlasGpu } from "../../packages/babylon-lite/src/text/internal";

function makeGlyph(glyphId: number): GlyphCurves {
    return {
        glyphId,
        curves: [
            { p0x: 0, p0y: 0, p1x: 50, p1y: 100, p2x: 100, p2y: 0 },
            { p0x: 100, p0y: 0, p1x: 50, p1y: -20, p2x: 0, p2y: 0 },
        ],
        bounds: { xMin: 0, yMin: -20, xMax: 100, yMax: 100 },
    };
}

function makeInitial(inner: Map<number, GlyphCurves>) {
    return {
        curves: new Map([["f", inner]]),
        runs: [{ curveSet: "f", glyphs: [{ glyphId: 1, x: 0, y: 0 }], pixelsPerFontUnit: 1 }],
    };
}

/** Install a fake GPU resource set on an atlas with spy-able destroy() calls. */
function stubAtlasGpu(atlas: SharedAtlas): { curveDestroy: ReturnType<typeof vi.fn>; bandDestroy: ReturnType<typeof vi.fn> } {
    const curveDestroy = vi.fn();
    const bandDestroy = vi.fn();
    atlas._gpu = {
        device: {} as GPUDevice,
        curveTex: { destroy: curveDestroy } as unknown as GPUTexture,
        bandTex: { destroy: bandDestroy } as unknown as GPUTexture,
        curveTexRows: 1,
        bandTexRows: 1,
        uploadedVersion: 0,
    } satisfies SharedAtlasGpu;
    return { curveDestroy, bandDestroy };
}

describe("text atlas reclamation", () => {
    it("refcounts a shared atlas across TextData blocks and frees GPU textures only on the last dispose", () => {
        const inner = new Map<number, GlyphCurves>([[1, makeGlyph(1)]]);

        const td1 = createTextData(makeInitial(inner));
        const atlas = getSharedAtlasForCurves(inner);
        expect(atlas).toBeDefined();
        expect(atlas!.refCount).toBe(1);

        const td2 = createTextData(makeInitial(inner));
        // Same inner-map identity → same shared atlas, refcount grows.
        expect(getSharedAtlasForCurves(inner)).toBe(atlas);
        expect(atlas!.refCount).toBe(2);

        const { curveDestroy, bandDestroy } = stubAtlasGpu(atlas!);

        disposeTextData(td1);
        expect(atlas!.refCount).toBe(1);
        expect(atlas!._gpu).not.toBeNull();
        expect(curveDestroy).not.toHaveBeenCalled();
        expect(bandDestroy).not.toHaveBeenCalled();

        disposeTextData(td2);
        expect(atlas!.refCount).toBe(0);
        expect(atlas!._gpu).toBeNull();
        expect(curveDestroy).toHaveBeenCalledTimes(1);
        expect(bandDestroy).toHaveBeenCalledTimes(1);
    });

    it("does not double-count the atlas when the same TextData is updated", () => {
        const inner = new Map<number, GlyphCurves>([[1, makeGlyph(1)]]);
        const td = createTextData(makeInitial(inner));
        const atlas = getSharedAtlasForCurves(inner)!;
        expect(atlas.refCount).toBe(1);

        updateTextData(td, { update: "reset", runs: [{ curveSet: "f", glyphs: [{ glyphId: 1, x: 0, y: 0 }], pixelsPerFontUnit: 1 }], curves: new Map([["f", inner]]) });
        expect(atlas.refCount).toBe(1);

        const { curveDestroy } = stubAtlasGpu(atlas);
        disposeTextData(td);
        expect(atlas.refCount).toBe(0);
        expect(curveDestroy).toHaveBeenCalledTimes(1);
    });
});
