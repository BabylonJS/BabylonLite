import { describe, it, expect, vi } from "vitest";

const G = globalThis as unknown as Record<string, unknown>;
G.GPUTextureUsage ??= { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_DST: 8, COPY_SRC: 1 };

import { appendSpriteAtlasFrames, createSpriteAtlasFromFrames, type SpriteAtlasFrameSource } from "../../../packages/babylon-lite/src/sprite/shared/sprite-atlas-packer";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";

interface MockWriteTextureCall {
    destination: GPUTexelCopyTextureInfo;
    data: Uint8Array;
    dataLayout: GPUTexelCopyBufferLayout;
    size: GPUExtent3DStrict;
}

interface MockWriteFullTextureCall {
    bytesPerRow: number;
    rowsPerImage: number;
    bytes: Uint8Array;
}

interface MockEngineProbe {
    engine: EngineContext;
    createdTextures: { width: number; height: number; texture: GPUTexture }[];
    writeTextureCalls: MockWriteTextureCall[];
    writeFullCalls: MockWriteFullTextureCall[];
}

function makeMockEngine(): MockEngineProbe {
    const createdTextures: MockEngineProbe["createdTextures"] = [];
    const writeTextureCalls: MockWriteTextureCall[] = [];
    const writeFullCalls: MockWriteFullTextureCall[] = [];
    const queue = {
        writeTexture: vi.fn((destination: GPUTexelCopyTextureInfo, data: BufferSource, dataLayout: GPUTexelCopyBufferLayout, size: GPUExtent3DStrict) => {
            const view = data as Uint8Array;
            // Snapshot the slice the GPU would actually read so tests can assert on it.
            const offset = dataLayout.offset ?? 0;
            const bytesPerRow = dataLayout.bytesPerRow!;
            const w = (size as { width: number }).width;
            const h = (size as { height: number }).height;
            const lastByte = offset + (h - 1) * bytesPerRow + w * 4;
            const snapshot = new Uint8Array(view.buffer.slice(view.byteOffset + offset, view.byteOffset + lastByte));
            writeTextureCalls.push({ destination, data: snapshot, dataLayout, size });
        }),
    };
    const device = {
        createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
            const size = descriptor.size as { width: number; height: number };
            const tex = {
                createView: vi.fn(() => ({ _kind: "view" })),
                destroy: vi.fn(),
            } as unknown as GPUTexture;
            createdTextures.push({ width: size.width, height: size.height, texture: tex });
            return tex;
        }),
        createSampler: vi.fn(() => ({ _kind: "sampler" })),
        queue,
    } as unknown as GPUDevice;
    // Wrap writeTexture so the "initial upload" by createTexture2DFromPixels gets recorded
    // separately from the sub-rect appends we want to assert on.
    const originalWriteTexture = queue.writeTexture;
    queue.writeTexture = vi.fn((destination: GPUTexelCopyTextureInfo, data: BufferSource, dataLayout: GPUTexelCopyBufferLayout, size: GPUExtent3DStrict) => {
        const isFullCreate = dataLayout.offset === undefined && (destination as { origin?: unknown }).origin === undefined;
        if (isFullCreate) {
            const view = data as Uint8Array;
            writeFullCalls.push({
                bytesPerRow: dataLayout.bytesPerRow!,
                rowsPerImage: dataLayout.rowsPerImage!,
                bytes: new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)),
            });
            return;
        }
        originalWriteTexture(destination, data, dataLayout, size);
    });

    const engine = {
        _device: device,
    } as unknown as EngineContext;

    return { engine, createdTextures, writeTextureCalls, writeFullCalls };
}

/** Build a 2-pixel-wide solid-color frame at the given color, surrounded by 1 px of zeros on every
 *  side inside a `(w+2) × (h+2)` source buffer. Returns the buffer + the sub-rect that targets the
 *  inner solid region — exercises `srcX` / `srcY` / `srcStrideBytes`. */
function makePaddedFrame(w: number, h: number, color: readonly [number, number, number, number]): SpriteAtlasFrameSource {
    const stride = (w + 2) * 4;
    const pixels = new Uint8Array((h + 2) * stride);
    for (let y = 1; y <= h; y++) {
        for (let x = 1; x <= w; x++) {
            const off = y * stride + x * 4;
            pixels[off] = color[0];
            pixels[off + 1] = color[1];
            pixels[off + 2] = color[2];
            pixels[off + 3] = color[3];
        }
    }
    return { pixels, width: w, height: h, srcX: 1, srcY: 1, srcStrideBytes: stride };
}

describe("createSpriteAtlasFromFrames — sub-rect sources", () => {
    it("copies only the requested sub-rect into the composited atlas buffer", () => {
        const probe = makeMockEngine();
        // 4x4 atlas built from two 2x2 sub-rects of larger 4x4 source buffers.
        const red = makePaddedFrame(2, 2, [255, 0, 0, 255]);
        const blue = makePaddedFrame(2, 2, [0, 0, 255, 255]);
        const atlas = createSpriteAtlasFromFrames(probe.engine, [red, blue], { paddingPx: 0, maxWidthPx: 4 });

        expect(atlas.textureSizePx).toEqual([4, 2]);
        expect(probe.writeFullCalls).toHaveLength(1);
        const composited = probe.writeFullCalls[0]!.bytes;
        // Atlas is 4x2; red occupies [0,0..2,2), blue occupies [2,0..4,2).
        // Verify the (0,0) red pixel.
        expect(Array.from(composited.subarray(0, 4))).toEqual([255, 0, 0, 255]);
        // Verify the (2,0) blue pixel (right shelf neighbor).
        expect(Array.from(composited.subarray(2 * 4, 3 * 4))).toEqual([0, 0, 255, 255]);
        // Verify row 1, column 3 is blue's bottom-right corner.
        expect(Array.from(composited.subarray(1 * 16 + 3 * 4, 1 * 16 + 4 * 4))).toEqual([0, 0, 255, 255]);
    });

    it("validates srcStrideBytes is at least width * 4", () => {
        const probe = makeMockEngine();
        expect(() => createSpriteAtlasFromFrames(probe.engine, [{ pixels: new Uint8Array(16), width: 2, height: 2, srcStrideBytes: 4 }], { paddingPx: 0 })).toThrow(
            /srcStrideBytes 4 is less than width \* 4/
        );
    });

    it("validates the source buffer covers the requested sub-rect", () => {
        const probe = makeMockEngine();
        expect(() => createSpriteAtlasFromFrames(probe.engine, [{ pixels: new Uint8Array(8), width: 2, height: 2 /* needs 16 bytes */ }], { paddingPx: 0 })).toThrow(
            /pixel buffer too short/
        );
    });

    it("allows empty sources when capacityPx is provided", () => {
        const probe = makeMockEngine();
        const atlas = createSpriteAtlasFromFrames(probe.engine, [], { capacityPx: [64, 64] });
        expect(atlas.frames).toHaveLength(0);
        expect(atlas.textureSizePx).toEqual([64, 64]);
        expect(atlas._packState).toBeDefined();
        expect(atlas._packState!.penX).toBe(0);
        expect(atlas._packState!.penY).toBe(0);
    });

    it("rejects empty sources without capacityPx", () => {
        const probe = makeMockEngine();
        expect(() => createSpriteAtlasFromFrames(probe.engine, [])).toThrow(/at least one frame is required/);
    });

    it("rejects capacityPx smaller than the initial content footprint", () => {
        const probe = makeMockEngine();
        const big = makePaddedFrame(8, 8, [1, 2, 3, 4]);
        expect(() => createSpriteAtlasFromFrames(probe.engine, [big], { capacityPx: [4, 4], paddingPx: 0 })).toThrow(/capacityPx 4x4 too small for initial content/);
    });

    it("sizes existing-frame UVs against capacityPx, not against the content footprint", () => {
        const probe = makeMockEngine();
        const frame = makePaddedFrame(4, 4, [10, 20, 30, 40]);
        const atlas = createSpriteAtlasFromFrames(probe.engine, [frame], { capacityPx: [16, 16], paddingPx: 0 });
        // Frame sits at (0,0) — uvMax should be 4/16 = 0.25, not 4/4 = 1.
        expect(atlas.frames[0]!.uvMin).toEqual([0, 0]);
        expect(atlas.frames[0]!.uvMax).toEqual([0.25, 0.25]);
    });
});

describe("appendSpriteAtlasFrames", () => {
    it("packs new frames into the reserved capacity and returns their indices", () => {
        const probe = makeMockEngine();
        const first = makePaddedFrame(4, 4, [255, 0, 0, 255]);
        const atlas = createSpriteAtlasFromFrames(probe.engine, [first], { capacityPx: [16, 16], paddingPx: 0, maxWidthPx: 16 });

        const second = makePaddedFrame(4, 4, [0, 255, 0, 255]);
        const third = makePaddedFrame(4, 4, [0, 0, 255, 255]);
        const indices = appendSpriteAtlasFrames(probe.engine, atlas, [second, third]);

        expect(indices).toEqual([1, 2]);
        expect(atlas.frames).toHaveLength(3);
        // Second frame should sit at x=4, y=0 (padding=0, max width=16).
        expect(atlas.frames[1]!.uvMin).toEqual([4 / 16, 0]);
        expect(atlas.frames[1]!.uvMax).toEqual([8 / 16, 4 / 16]);
        // Third frame at x=8, y=0.
        expect(atlas.frames[2]!.uvMin).toEqual([8 / 16, 0]);
        expect(atlas.frames[2]!.uvMax).toEqual([12 / 16, 4 / 16]);
    });

    it("uploads each appended frame with one writeTexture targeting its packed origin", () => {
        const probe = makeMockEngine();
        const seed = makePaddedFrame(2, 2, [0, 0, 0, 0]);
        const atlas = createSpriteAtlasFromFrames(probe.engine, [seed], { capacityPx: [16, 16], paddingPx: 0 });

        const red = makePaddedFrame(2, 2, [255, 0, 0, 255]);
        appendSpriteAtlasFrames(probe.engine, atlas, [red]);

        expect(probe.writeTextureCalls).toHaveLength(1);
        const call = probe.writeTextureCalls[0]!;
        // Origin should match the packed position (right after the seed at x=2, y=0).
        expect((call.destination as { origin?: { x: number; y: number } }).origin).toEqual({ x: 2, y: 0 });
        expect((call.size as { width: number; height: number }).width).toBe(2);
        expect((call.size as { width: number; height: number }).height).toBe(2);
        // dataLayout should describe the sub-rect: bytesPerRow = srcStride = (2+2)*4 = 16,
        // offset = srcY * stride + srcX * 4 = 1*16 + 1*4 = 20.
        expect(call.dataLayout.bytesPerRow).toBe(16);
        expect(call.dataLayout.offset).toBe(20);
    });

    it("does not touch existing frames' UV slots when appending (existing sprites stay correct)", () => {
        const probe = makeMockEngine();
        const a = makePaddedFrame(4, 4, [1, 1, 1, 1]);
        const atlas = createSpriteAtlasFromFrames(probe.engine, [a], { capacityPx: [16, 16], paddingPx: 0 });
        const beforeUvMin = atlas.frames[0]!.uvMin;
        const beforeUvMax = atlas.frames[0]!.uvMax;

        appendSpriteAtlasFrames(probe.engine, atlas, [makePaddedFrame(4, 4, [2, 2, 2, 2])]);

        // The frame[0] tuple instances must be the same references with unchanged values.
        expect(atlas.frames[0]!.uvMin).toBe(beforeUvMin);
        expect(atlas.frames[0]!.uvMax).toBe(beforeUvMax);
        expect(atlas.frames[0]!.uvMin).toEqual([0, 0]);
        expect(atlas.frames[0]!.uvMax).toEqual([4 / 16, 4 / 16]);
    });

    it("wraps to a new shelf when the next frame doesn't fit on the current one", () => {
        const probe = makeMockEngine();
        // Capacity = 16x16, maxWidthPx = 8. Two 6x4 frames fit side-by-side won't (6+6=12 > 8) → wrap.
        const seed = makePaddedFrame(6, 4, [1, 1, 1, 1]);
        const atlas = createSpriteAtlasFromFrames(probe.engine, [seed], { capacityPx: [16, 16], maxWidthPx: 8, paddingPx: 0 });
        const next = makePaddedFrame(6, 4, [2, 2, 2, 2]);
        appendSpriteAtlasFrames(probe.engine, atlas, [next]);
        // Wrapped: new shelf starts at y=4.
        expect(atlas.frames[1]!.uvMin).toEqual([0, 4 / 16]);
        expect(atlas.frames[1]!.uvMax).toEqual([6 / 16, 8 / 16]);
    });

    it("throws and leaves the atlas untouched when an appended frame would overflow capacity", () => {
        const probe = makeMockEngine();
        const seed = makePaddedFrame(2, 2, [1, 1, 1, 1]);
        const atlas = createSpriteAtlasFromFrames(probe.engine, [seed], { capacityPx: [4, 4], paddingPx: 0 });
        const before = atlas.frames.length;
        const tall = makePaddedFrame(2, 8, [2, 2, 2, 2]); // 8 > capacity height 4.
        expect(() => appendSpriteAtlasFrames(probe.engine, atlas, [tall])).toThrow(/atlas height capacity 4 exhausted/);
        expect(atlas.frames).toHaveLength(before);
        expect(probe.writeTextureCalls).toHaveLength(0);
    });

    it("throws when the atlas was not built by createSpriteAtlasFromFrames", () => {
        const probe = makeMockEngine();
        const fakeAtlas = {
            texture: { texture: {} as GPUTexture } as never,
            textureSizePx: [64, 64] as const,
            frames: [],
            premultipliedAlpha: false,
            // No _packState — simulates createGridSpriteAtlas / loadSpriteAtlas output.
        };
        expect(() => appendSpriteAtlasFrames(probe.engine, fakeAtlas as never, [makePaddedFrame(2, 2, [0, 0, 0, 0])])).toThrow(/was not built by createSpriteAtlasFromFrames/);
    });

    it("is a no-op when given an empty source list", () => {
        const probe = makeMockEngine();
        const seed = makePaddedFrame(2, 2, [1, 2, 3, 4]);
        const atlas = createSpriteAtlasFromFrames(probe.engine, [seed], { capacityPx: [16, 16] });
        const writesBefore = probe.writeTextureCalls.length;
        const indices = appendSpriteAtlasFrames(probe.engine, atlas, []);
        expect(indices).toEqual([]);
        expect(atlas.frames).toHaveLength(1);
        expect(probe.writeTextureCalls.length).toBe(writesBefore);
    });
});
