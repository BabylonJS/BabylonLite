/**
 * Sprite atlas — UV rects per frame, optional named clips.
 *
 * Atlases are shared resources: the same atlas may back multiple layers/systems.
 * The `Texture2D` is uploaded once at `loadSpriteAtlas`. Layers hold a reference;
 * the atlas's texture is released only when no layer holds it (regular Texture2D
 * lifetime via the gpu-pool ref-counter).
 */

import type { EngineContext } from "../../engine/engine.js";
import type { Texture2D, Texture2DOptions } from "../../texture/texture-2d.js";
import { loadTexture2D } from "../../texture/texture-2d.js";

export type SpriteSampling = "linear" | "nearest";
export type SpriteBlendMode = "alpha" | "premultiplied" | "additive" | "multiply" | "cutout";
export type SpriteFrameRef = number | string;

/** A single frame in an atlas. UVs in [0,1]; pivot in [0,1] of the frame. */
export interface SpriteFrame {
    readonly name?: string;
    readonly uvMin: [number, number];
    readonly uvMax: [number, number];
    readonly sourceSizePx: [number, number];
    readonly pivot: [number, number];
}

export interface SpriteClip {
    readonly name: string;
    readonly frames: readonly number[];
    readonly fps: number;
    readonly loop: boolean;
}

export interface SpriteAtlas {
    readonly texture: Texture2D;
    readonly textureSizePx: [number, number];
    readonly frames: readonly SpriteFrame[];
    readonly clips: readonly SpriteClip[];
    readonly sampling: SpriteSampling;
    readonly premultipliedAlpha: boolean;
    /** @internal name -> frame index lookup */
    readonly _frameByName: ReadonlyMap<string, number>;
    /** @internal name -> clip index lookup */
    readonly _clipByName: ReadonlyMap<string, number>;
}

export interface GridAtlasOptions {
    cellWidthPx: number;
    cellHeightPx: number;
    columns?: number;
    rows?: number;
    marginPx?: number;
    spacingPx?: number;
    pivot?: [number, number];
    sampling?: SpriteSampling;
    premultipliedAlpha?: boolean;
    clips?: readonly SpriteClip[];
}

export interface NamedAtlasOptions {
    sampling?: SpriteSampling;
    premultipliedAlpha?: boolean;
}

export interface LoadAtlasOptions extends NamedAtlasOptions {
    /** Inline grid spec — required for now (no JSON parsing in the slim path). */
    cellWidthPx?: number;
    cellHeightPx?: number;
    columns?: number;
    rows?: number;
    marginPx?: number;
    spacingPx?: number;
    pivot?: [number, number];
    textureOptions?: Texture2DOptions;
    clips?: readonly SpriteClip[];
}

function buildLookups(frames: readonly SpriteFrame[], clips: readonly SpriteClip[]): { f: Map<string, number>; c: Map<string, number> } {
    const f = new Map<string, number>();
    for (let i = 0; i < frames.length; i++) {
        const n = frames[i]!.name;
        if (n !== undefined) {
            f.set(n, i);
        }
    }
    const c = new Map<string, number>();
    for (let i = 0; i < clips.length; i++) {
        c.set(clips[i]!.name, i);
    }
    return { f, c };
}

function gridFrames(textureWidth: number, textureHeight: number, opts: GridAtlasOptions): SpriteFrame[] {
    const margin = opts.marginPx ?? 0;
    const spacing = opts.spacingPx ?? 0;
    const cols = opts.columns ?? Math.floor((textureWidth - 2 * margin + spacing) / (opts.cellWidthPx + spacing));
    const rows = opts.rows ?? Math.floor((textureHeight - 2 * margin + spacing) / (opts.cellHeightPx + spacing));
    const pivot = opts.pivot ?? ([0.5, 0.5] as [number, number]);
    const frames: SpriteFrame[] = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x0 = margin + c * (opts.cellWidthPx + spacing);
            const y0 = margin + r * (opts.cellHeightPx + spacing);
            const x1 = x0 + opts.cellWidthPx;
            const y1 = y0 + opts.cellHeightPx;
            frames.push({
                uvMin: [x0 / textureWidth, y0 / textureHeight],
                uvMax: [x1 / textureWidth, y1 / textureHeight],
                sourceSizePx: [opts.cellWidthPx, opts.cellHeightPx],
                pivot,
            });
        }
    }
    return frames;
}

/** Create an atlas whose frames are arranged as a regular grid in the texture. */
export function createGridSpriteAtlas(texture: Texture2D, options: GridAtlasOptions): SpriteAtlas {
    const frames = gridFrames(texture.width, texture.height, options);
    const clips = options.clips ?? [];
    const { f, c } = buildLookups(frames, clips);
    return {
        texture,
        textureSizePx: [texture.width, texture.height],
        frames,
        clips,
        sampling: options.sampling ?? "linear",
        premultipliedAlpha: options.premultipliedAlpha ?? false,
        _frameByName: f,
        _clipByName: c,
    };
}

/** Create an atlas from an explicit list of named/positioned frames. */
export function createNamedSpriteAtlas(texture: Texture2D, frames: readonly SpriteFrame[], clips: readonly SpriteClip[] = [], options: NamedAtlasOptions = {}): SpriteAtlas {
    const { f, c } = buildLookups(frames, clips);
    return {
        texture,
        textureSizePx: [texture.width, texture.height],
        frames,
        clips,
        sampling: options.sampling ?? "linear",
        premultipliedAlpha: options.premultipliedAlpha ?? false,
        _frameByName: f,
        _clipByName: c,
    };
}

/** Load a texture from URL and wrap it as a grid sprite atlas. */
export async function loadSpriteAtlas(engine: EngineContext, textureUrl: string, options: LoadAtlasOptions = {}): Promise<SpriteAtlas> {
    if (options.cellWidthPx === undefined || options.cellHeightPx === undefined) {
        throw new Error("loadSpriteAtlas: cellWidthPx and cellHeightPx are required (JSON metadata not yet supported).");
    }
    const sampling = options.sampling ?? "linear";
    const filter: GPUFilterMode = sampling === "linear" ? "linear" : "nearest";
    const texture = await loadTexture2D(engine, textureUrl, {
        mipMaps: false,
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        minFilter: filter,
        magFilter: filter,
        invertY: false,
        ...options.textureOptions,
    });
    return createGridSpriteAtlas(texture, {
        cellWidthPx: options.cellWidthPx,
        cellHeightPx: options.cellHeightPx,
        columns: options.columns,
        rows: options.rows,
        marginPx: options.marginPx,
        spacingPx: options.spacingPx,
        pivot: options.pivot,
        sampling,
        premultipliedAlpha: options.premultipliedAlpha,
        clips: options.clips,
    });
}

/** Resolve a frame reference (index or name) to a frame index. Throws on miss. */
export function resolveSpriteFrame(atlas: SpriteAtlas, frame: SpriteFrameRef): number {
    if (typeof frame === "number") {
        if (frame < 0 || frame >= atlas.frames.length) {
            throw new Error(`Sprite frame index ${frame} out of range (atlas has ${atlas.frames.length} frames)`);
        }
        return frame;
    }
    const idx = atlas._frameByName.get(frame);
    if (idx === undefined) {
        throw new Error(`Sprite frame '${frame}' not found in atlas`);
    }
    return idx;
}
