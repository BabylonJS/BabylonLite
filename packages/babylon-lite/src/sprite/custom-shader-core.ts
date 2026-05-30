/**
 * Shared mechanics for the sprite/billboard custom-shader hooks (model A: the engine
 * owns the pipeline, instancing, sorting, and vertex stage; the caller supplies only a
 * WGSL **fragment body** plus optional extra textures).
 *
 * This module deliberately holds **only** the parts that are identical across every
 * sprite-family custom-shader (extra-texture binding emission, WGSL-name validation, and
 * the build-time-mangle normalisation). Each system keeps its own composer that owns its
 * fixed vertex stage and its `VOut` varying contract — those genuinely differ
 * (world-space billboard facing vs. pixel-space 2D layer transform) and are not shared.
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
 * Re-apply the build-time WGSL identifier mangling to a fully composed custom-shader string,
 * mirroring `applyGsFragments` for Gaussian Splatting.
 *
 * Contract identifiers (e.g. `atlasTex`/`atlasSamp`, and for billboards the `worldPos`
 * varying) are mangled at build time inside the engine's WGSL template literals by
 * `scripts/bundle-scenes-core.ts:mangleWgslIdentifiers`, but the caller's `fragment` string
 * is never minified and references the original public names. Running the same map over the
 * whole composed string normalises both halves to the mangled spelling. The substitution is
 * idempotent (single-letter results don't re-match `\bfullName\b`) and harmless in dev mode,
 * where the template is un-mangled so this just normalises everything to the mangled form —
 * WebGPU accepts either spelling.
 *
 * KEEP the per-system `mangles` arrays IN SYNC with the corresponding entries in
 * `scripts/bundle-scenes-core.ts:mangleWgslIdentifiers`.
 */
export function normalizeContractNames(wgsl: string, mangles: readonly (readonly [string, string])[]): string {
    let out = wgsl;
    for (const [from, to] of mangles) {
        out = out.replace(new RegExp(`\\b${from}\\b`, "g"), to);
    }
    return out;
}

let _nextKey = 0;

/** Allocate a process-unique pipeline/shader-module cache key with the given prefix. */
export function nextCustomShaderKey(prefix: string): string {
    return `${prefix}${_nextKey++}`;
}
