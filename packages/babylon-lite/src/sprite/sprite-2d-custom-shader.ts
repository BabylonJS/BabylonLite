/**
 * Optional, tree-shakable custom-shader hook for `Sprite2DLayer` (model A: the engine owns
 * the layer transform, instancing, sorting, and depth; the caller supplies only a WGSL
 * **fragment body** plus optional extra textures).
 *
 * This mirrors `billboard-custom-shader.ts` for the 2D / HUD sprite path. The billboard and
 * sprite composers share their *mechanics* via `custom-shader-core.ts` (extra-texture
 * bindings, name validation, build-time-mangle normalisation, key allocation) but keep their
 * own vertex stage and varying contract, which genuinely differ: billboards transform in
 * world space and expose `viewDist`/`worldPos`; a 2D layer transforms in pixel space and
 * exposes only `uv`/`tint`.
 *
 * Tree-shaking contract: the default sprite path never imports this module. `sprite-pipeline.ts`
 * only reaches the custom composer through the opaque object a caller builds here via
 * `createSprite2DCustomShader`, so a layer that uses the stock shader pays zero bytes for it.
 *
 * WGSL contract for the supplied `fragment` body:
 *   - Receives `in: VOut` with: `uv: vec2<f32>` and `tint: vec4<f32>` (the per-sprite `color`).
 *   - Has access to `atlasTex` / `atlasSamp` (the layer atlas at bindings 1/2) and each extra
 *     texture as `<name>Tex` / `<name>Samp`.
 *   - Must `return vec4<f32>(...)` (and may `discard`). The body owns all alpha handling; no
 *     per-layer `opacity` is applied automatically.
 */
import type { CustomShaderTexture } from "./custom-shader-core.js";
import { makeExtraBindingsWgsl, nextCustomShaderKey, normalizeContractNames, validateExtraTextureNames } from "./custom-shader-core.js";

/** One extra texture bound after the atlas. In WGSL it becomes `<name>Tex` + `<name>Samp`. */
export type Sprite2DCustomTexture = CustomShaderTexture;

/** Options for `createSprite2DCustomShader`. */
export interface Sprite2DCustomShaderOptions {
    /** WGSL fragment body. See module header for the in-scope identifiers. */
    readonly fragment: string;
    /** Extra textures, in binding order. Each contributes a `texture_2d` + `sampler`. */
    readonly extraTextures?: readonly Sprite2DCustomTexture[];
}

/** Opaque custom-shader descriptor produced by `createSprite2DCustomShader`. */
export interface Sprite2DCustomShader {
    readonly _entityType: "sprite-2d-custom-shader";
    /** @internal Extra textures bound after the atlas. */
    readonly _extraTextures: readonly Sprite2DCustomTexture[];
    /** @internal Pipeline/shader-module cache discriminator. */
    readonly _key: string;
    /** @internal Builds the full WGSL for the given depth mode / group index. */
    readonly _composeWgsl: (hasDepth: boolean, spriteGroupIndex: 0 | 1) => string;
}

/**
 * Build-time mangle pairs the sprite custom-shader contract relies on. The 2D `VOut` exposes
 * only `uv`/`tint` (neither mangled), so the contract reduces to the atlas binding names.
 * KEEP IN SYNC with the matching entries in `scripts/bundle-scenes-core.ts:mangleWgslIdentifiers`.
 */
const SPRITE_CONTRACT_MANGLE: readonly (readonly [string, string])[] = [
    ["atlasTex", "atx"],
    ["atlasSamp", "asp"],
];

function makeCustomSpriteWgsl(hasDepth: boolean, spriteGroupIndex: 0 | 1, extraTextures: readonly Sprite2DCustomTexture[], fragment: string): string {
    const group = `@group(${spriteGroupIndex})`;
    const zAttribute = hasDepth ? `,\n@location(6) iZ: f32` : "";
    const zPosition = hasDepth ? "1.0 - in.iZ" : "0.0";
    const composed = `struct Layer {
viewPos: vec2<f32>,
viewScale: f32,
viewRot: f32,
screenSize: vec2<f32>,
pivot: vec2<f32>,
opacityMul: vec4<f32>,
};
${group} @binding(0) var<uniform> L: Layer;
${group} @binding(1) var atlasTex: texture_2d<f32>;
${group} @binding(2) var atlasSamp: sampler;
${makeExtraBindingsWgsl(spriteGroupIndex, 3, extraTextures)}struct VIn {
@builtin(vertex_index) vid: u32,
@location(0) iPos: vec2<f32>,
@location(1) iSize: vec2<f32>,
@location(2) iUvMin: vec2<f32>,
@location(3) iUvMax: vec2<f32>,
@location(4) iRot: f32,
@location(5) iColor: vec4<f32>${zAttribute}
};
struct VOut {
@builtin(position) pos: vec4<f32>,
@location(0) uv: vec2<f32>,
@location(1) tint: vec4<f32>,
};
@vertex
fn vs(in: VIn) -> VOut {
var corners = array<vec2<f32>, 4>(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0));
let c = corners[in.vid];
let local = (c - L.pivot) * in.iSize;
let cr = cos(in.iRot);
let sr = sin(in.iRot);
let rotated = vec2<f32>(local.x * cr - local.y * sr, local.x * sr + local.y * cr);
let layerPx = in.iPos + rotated;
let centered = layerPx - L.viewPos;
let lc = cos(L.viewRot);
let ls = sin(L.viewRot);
let viewRot = vec2<f32>(centered.x * lc - centered.y * ls, centered.x * ls + centered.y * lc);
let screenPx = viewRot * L.viewScale;
let ndc = vec2<f32>(screenPx.x / L.screenSize.x * 2.0 - 1.0, 1.0 - screenPx.y / L.screenSize.y * 2.0);
let uv = mix(in.iUvMin, in.iUvMax, c);
var out: VOut;
out.pos = vec4<f32>(ndc, ${zPosition}, 1.0);
out.uv = uv;
out.tint = in.iColor;
return out;
}
@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
${fragment}
}`;
    return normalizeContractNames(composed, SPRITE_CONTRACT_MANGLE);
}

/**
 * Build a custom-shader descriptor to pass as `customShader` when creating a `Sprite2DLayer`.
 * The descriptor is opaque; the sprite pipeline consumes it lazily.
 */
export function createSprite2DCustomShader(options: Sprite2DCustomShaderOptions): Sprite2DCustomShader {
    const extraTextures = options.extraTextures ?? [];
    validateExtraTextureNames("createSprite2DCustomShader", extraTextures);
    const fragment = options.fragment;
    const key = nextCustomShaderKey("s");
    return {
        _entityType: "sprite-2d-custom-shader",
        _extraTextures: extraTextures,
        _key: key,
        _composeWgsl: (hasDepth, spriteGroupIndex) => makeCustomSpriteWgsl(hasDepth, spriteGroupIndex, extraTextures, fragment),
    };
}
