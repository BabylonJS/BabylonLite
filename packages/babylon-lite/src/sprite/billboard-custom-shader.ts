/**
 * Optional, tree-shakable custom-shader hook for `*BillboardSpriteSystem`.
 *
 * The default billboard pipeline bakes a fixed fragment (sample × tint, with an
 * optional cutout discard). Some real scenes need a different per-fragment
 * treatment — palette-indexed sampling, COLORMAP light banding, toon shading,
 * custom fog — and/or extra texture bindings beyond the atlas. This module lets
 * a caller supply a WGSL fragment body plus extra textures while the billboard
 * system keeps full ownership of geometry, instancing, sorting, and depth.
 *
 * Tree-shaking contract: the default billboard path never imports this module.
 * `billboard-pipeline.ts` only reaches the custom composer through the opaque
 * object a caller builds here via `createBillboardCustomShader`, so a scene that
 * uses only stock billboards pays zero bytes for this code.
 *
 * WGSL contract for the supplied `fragment` body:
 *   - Receives `in: VOut` with: `uv: vec2<f32>`, `tint: vec4<f32>`
 *     (the per-sprite `color`), `viewDist: f32` (distance from the camera to the
 *     sprite anchor in world units, constant across the quad), `worldPos: vec3<f32>`
 *     (this fragment's world position).
 *   - Has access to `atlasTex` / `atlasSamp` (the system atlas at group 1,
 *     bindings 1/2) and each extra texture as `<name>Tex` / `<name>Samp`.
 *   - Must `return vec4<f32>(...)` (and may `discard`). No automatic cutout is
 *     injected — the body owns all alpha handling.
 */
import { SCENE_UBO_WGSL } from "../shader/scene-uniforms.js";
import type { BillboardDepthMode, BillboardOrientation } from "./billboard-sprite.js";
import { makeBillboardBasisWgsl } from "./billboard-pipeline.js";
import type { CustomShaderTexture } from "./custom-shader-core.js";
import { makeExtraBindingsWgsl, nextCustomShaderKey, normalizeContractNames, validateExtraTextureNames } from "./custom-shader-core.js";

/** One extra texture bound after the atlas (group 1, bindings 3, 5, 7, …). */
export type BillboardCustomTexture = CustomShaderTexture;

/** Options for `createBillboardCustomShader`. */
export interface BillboardCustomShaderOptions {
    /** WGSL fragment body. See module header for the in-scope identifiers. */
    readonly fragment: string;
    /** Extra textures, in binding order. Each contributes a `texture_2d` + `sampler`. */
    readonly extraTextures?: readonly BillboardCustomTexture[];
}

/** Opaque custom-shader descriptor produced by `createBillboardCustomShader`. */
export interface BillboardCustomShader {
    readonly _entityType: "billboard-custom-shader";
    /** @internal Extra textures bound after the atlas. */
    readonly _extraTextures: readonly BillboardCustomTexture[];
    /** @internal Pipeline/shader-module cache discriminator. */
    readonly _key: string;
    /** @internal Builds the full WGSL for the given orientation (depth mode is irrelevant — the body owns alpha). */
    readonly _composeWgsl: (orientation: BillboardOrientation, depthMode: BillboardDepthMode) => string;
}

/**
 * Build-time mangle pairs that the billboard custom-shader contract relies on. KEEP IN SYNC
 * with the matching entries in `scripts/bundle-scenes-core.ts:mangleWgslIdentifiers`.
 */
const BILLBOARD_CONTRACT_MANGLE: readonly (readonly [string, string])[] = [
    ["atlasTex", "atx"],
    ["atlasSamp", "asp"],
    ["worldPos", "wp"],
];

function makeCustomBillboardWgsl(orientation: BillboardOrientation, extraTextures: readonly BillboardCustomTexture[], fragment: string): string {
    const composed = `${SCENE_UBO_WGSL}
struct BillboardSystem {
opacityMul: vec4<f32>,
axisAndCutoff: vec4<f32>,
};
@group(1) @binding(0) var<uniform> billboards: BillboardSystem;
@group(1) @binding(1) var atlasTex: texture_2d<f32>;
@group(1) @binding(2) var atlasSamp: sampler;
${makeExtraBindingsWgsl(1, 3, extraTextures)}${makeBillboardBasisWgsl(orientation)}
struct VIn {
@builtin(vertex_index) vid: u32,
@location(0) iPos: vec3<f32>,
@location(1) iSize: vec2<f32>,
@location(2) iUvMin: vec2<f32>,
@location(3) iUvMax: vec2<f32>,
@location(4) iRot: f32,
@location(5) iPivot: vec2<f32>,
@location(6) iColor: vec4<f32>,
};
struct VOut {
@builtin(position) pos: vec4<f32>,
@location(0) uv: vec2<f32>,
@location(1) tint: vec4<f32>,
@location(2) viewDist: f32,
@location(3) worldPos: vec3<f32>,
};
@vertex
fn vs(in: VIn) -> VOut {
let corner = vec2<f32>(select(0.0, 1.0, in.vid == 1u || in.vid == 2u), select(0.0, 1.0, in.vid >= 2u));
let local = (corner - in.iPivot) * in.iSize;
let cosRot = cos(in.iRot);
let sinRot = sin(in.iRot);
let rotated = vec2<f32>(local.x * cosRot - local.y * sinRot, local.x * sinRot + local.y * cosRot);
let basis = getBillboardBasis(in.iPos);
let worldPos = in.iPos + basis.right * rotated.x + basis.up * rotated.y;
var out: VOut;
out.pos = scene.viewProjection * vec4<f32>(worldPos, 1.0);
out.uv = mix(in.iUvMin, in.iUvMax, corner);
out.tint = in.iColor;
let viewCenter = scene.view * vec4<f32>(in.iPos, 1.0);
out.viewDist = length(viewCenter.xyz);
out.worldPos = worldPos;
return out;
}
@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
${fragment}
}`;
    return normalizeContractNames(composed, BILLBOARD_CONTRACT_MANGLE);
}

/**
 * Build a custom-shader descriptor to pass as `customShader` when creating a
 * billboard system. The descriptor is opaque; the pipeline consumes it lazily.
 */
export function createBillboardCustomShader(options: BillboardCustomShaderOptions): BillboardCustomShader {
    const extraTextures = options.extraTextures ?? [];
    validateExtraTextureNames("createBillboardCustomShader", extraTextures);
    const fragment = options.fragment;
    const key = nextCustomShaderKey("c");
    return {
        _entityType: "billboard-custom-shader",
        _extraTextures: extraTextures,
        _key: key,
        _composeWgsl: (orientation) => makeCustomBillboardWgsl(orientation, extraTextures, fragment),
    };
}
