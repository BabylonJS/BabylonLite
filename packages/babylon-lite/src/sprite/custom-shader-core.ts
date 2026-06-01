/**
 * Shared mechanics for the sprite-family custom-shader hooks (the engine owns the pipeline,
 * instancing, sorting, and vertex stage; the caller supplies only a WGSL **fragment body**
 * plus optional extra textures).
 *
 * This module holds **only** the parts that are identical across every sprite-family
 * custom-shader: extra-texture binding emission, WGSL-name validation, the always-present
 * `SpriteFx` UBO declaration, and cache-key allocation. Each system keeps its own composer
 * that owns its fixed vertex stage and varying contract — those genuinely differ (world-space
 * billboard facing vs. pixel-space 2D layer transform) and are not shared.
 *
 * Tree-shaking: a scene that never builds a custom shader never imports this module, so it
 * pays zero bytes for any of it.
 */
import type { Texture2D } from "../texture/texture-2d.js";

/** One extra texture bound after the atlas. In WGSL it becomes `<name>Tex` + `<name>Samp`. */
export interface CustomShaderTexture {
    /** Identifier used in WGSL: becomes `<name>Tex` (texture) and `<name>Samp` (sampler). */
    readonly name: string;
    readonly texture: Texture2D;
}

/** Valid WGSL identifier (used to validate extra-texture names before splicing them in). */
const WGSL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Throw if any extra-texture name is not a legal WGSL identifier. `fnName` names the caller for the message. */
export function validateExtraTextureNames(fnName: string, extras: readonly CustomShaderTexture[]): void {
    for (const extra of extras) {
        if (!WGSL_NAME.test(extra.name)) {
            throw new Error(`${fnName}: extra texture name "${extra.name}" is not a valid WGSL identifier.`);
        }
    }
}

/**
 * Emit the `@group(group) @binding(n) var <name>Tex/<name>Samp` pairs for the extra textures,
 * starting at `startBinding` and stepping by 2 (texture, then sampler). The atlas occupies
 * bindings 1/2, so callers pass `startBinding = 3`.
 */
export function makeExtraBindingsWgsl(group: number, startBinding: number, extras: readonly CustomShaderTexture[]): string {
    let out = "";
    for (let i = 0; i < extras.length; i++) {
        const binding = startBinding + i * 2;
        const name = extras[i]!.name;
        out += `@group(${group}) @binding(${binding}) var ${name}Tex: texture_2d<f32>;\n@group(${group}) @binding(${binding + 1}) var ${name}Samp: sampler;\n`;
    }
    return out;
}

/**
 * Emit the always-present `SpriteFx` UBO declaration. The struct layout (32 bytes) matches the
 * CPU writer in `sprite-pipeline.ts:writeSpriteFxUbo`:
 *   [0]    time (seconds since the renderable's first frame)
 *   [1..3] padding (vec4 alignment)
 *   [4..7] params.xyzw (user-set via `setSprite2DShaderParams` / `setBillboardShaderParams`)
 * `binding` is `3 + 2 * extraTextures.length` so the UBO always lands after the extra textures.
 */
export function makeFxStructWgsl(group: number, binding: number): string {
    return `struct SpriteFx {
time: f32,
_p0: f32,
_p1: f32,
_p2: f32,
params: vec4<f32>,
};
@group(${group}) @binding(${binding}) var<uniform> fx: SpriteFx;`;
}

let _nextKey = 0;

/** Allocate a process-unique pipeline/shader-module cache key with the given prefix. */
export function nextCustomShaderKey(prefix: string): string {
    return `${prefix}${_nextKey++}`;
}
