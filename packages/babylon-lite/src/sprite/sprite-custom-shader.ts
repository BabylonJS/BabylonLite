/**
 * Opt-in per-layer custom fragment shader for pure-2D sprite layers.
 *
 * `createSprite2DCustomShader({ fragment })` returns a small descriptor you pass as
 * `customShader` to `createSprite2DLayer`. The engine wraps your WGSL: it samples the atlas
 * for you, hands you the result, and multiplies your return value by the layer opacity. This
 * is the route for animated skies, drifting clouds, water / heat shimmer, twinkling stars,
 * vignettes, and other procedural sprite effects — all driven by a built-in `fx.time` clock
 * and an optional user `fx.params` vec4.
 *
 * **Contract.** Your `fragment` string must define exactly:
 *
 * ```wgsl
 * fn spriteFx(uv: vec2<f32>, tint: vec4<f32>, base: vec4<f32>) -> vec4<f32> {
 *     // `base` is textureSample(atlasTex, atlasSamp, uv) — the atlas already sampled for you.
 *     // `tint` is the per-sprite color. Return the final (pre-opacity) RGBA.
 *     return base * tint;
 * }
 * ```
 *
 * Available to your code:
 *   - `fx.time`   — seconds since the renderer's first frame (`f32`).
 *   - `fx.params` — a `vec4<f32>` you set per frame via `setSprite2DShaderParams(layer, …)`.
 *   - `atlasTex` / `atlasSamp` — the layer's atlas texture + sampler, e.g. to re-sample at a
 *     distorted UV for shimmer.
 *
 * This module is fully tree-shaken from bundles that never call `createSprite2DCustomShader`;
 * the default (non-shader) sprite path is untouched. Custom shaders are supported on pure-2D
 * (`depth: "none"`) layers drawn by a `SpriteRenderer`.
 */
import { makeSpritePrologueWgsl } from "./sprite-pipeline.js";

/** Options for {@link createSprite2DCustomShader}. */
export interface Sprite2DCustomShaderOptions {
    /**
     * WGSL source that defines `fn spriteFx(uv: vec2<f32>, tint: vec4<f32>, base: vec4<f32>) -> vec4<f32>`.
     * May read `fx.time` / `fx.params` and re-sample `atlasTex` / `atlasSamp`. See the module docs.
     */
    readonly fragment: string;
}

/** A compiled-on-demand custom sprite shader. Pure data; pass as `customShader` to `createSprite2DLayer`. */
export interface Sprite2DCustomShader {
    readonly _entityType: "sprite-2d-custom-shader";
    /** @internal Stable identity used to key pipeline + shader-module caches. */
    readonly _id: number;
    /** The user-provided WGSL fragment source. */
    readonly fragment: string;
    /** @internal Compose the full WGSL module for a given layout (`hasDepth` → group index). */
    _makeWgsl(hasDepth: boolean, group: 0 | 1): string;
}

let _nextCustomShaderId = 1;

function fxStructWgsl(group: 0 | 1): string {
    return `struct SpriteFx {
time: f32,
_p0: f32,
_p1: f32,
_p2: f32,
params: vec4<f32>,
};
@group(${group}) @binding(3) var<uniform> fx: SpriteFx;`;
}

const WRAPPER_FS_WGSL = `@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
let base = textureSample(atlasTex, atlasSamp, in.uv);
let c = spriteFx(in.uv, in.tint, base);
return c * L.opacityMul;
}`;

/**
 * Create a custom fragment shader for a pure-2D sprite layer. Pass the result as the
 * `customShader` option of `createSprite2DLayer`. See the module-level docs for the WGSL contract.
 */
export function createSprite2DCustomShader(opts: Sprite2DCustomShaderOptions): Sprite2DCustomShader {
    const fragment = opts.fragment;
    if (typeof fragment !== "string" || fragment.trim().length === 0) {
        throw new Error("createSprite2DCustomShader: `fragment` must be a non-empty WGSL string.");
    }
    return {
        _entityType: "sprite-2d-custom-shader",
        _id: _nextCustomShaderId++,
        fragment,
        _makeWgsl(hasDepth: boolean, group: 0 | 1): string {
            return `${makeSpritePrologueWgsl(hasDepth, group)}
${fxStructWgsl(group)}
${fragment}
${WRAPPER_FS_WGSL}`;
        },
    };
}
