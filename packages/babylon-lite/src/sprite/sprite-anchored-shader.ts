/**
 * AnchoredSpriteLayer WGSL composer.
 *
 * Anchored sprites project a world anchor through the 3D viewProjection, then
 * expand a pixel-sized quad in clip space. The screen size is invariant to
 * camera distance — multiplication by `anchorClip.w` cancels the perspective
 * divide.
 *
 * Composition variables:
 *  - PIXEL_SNAP — bake `floor(p + 0.5)` for the pixel offset when enabled.
 *  - CUTOFF     — `cutout` blend mode discards fragments below `alphaCutoff`.
 *  - RETURN     — `multiply` blend mode pre-weights RGB by alpha.
 *
 * Shares the Sprite3DSceneUBO from `shared/sprite-3d-scene-ubo.ts` (single per-scene
 * UBO at @group(0) @binding(0) — see that file for the chosen binding model).
 */

import type { SpriteBlendMode } from "./shared/sprite-atlas.js";
import { SPRITE_3D_SCENE_UBO_WGSL } from "./shared/sprite-3d-scene-ubo.js";

export interface AnchoredSpriteShaderOptions {
    pixelSnap: boolean;
    blendMode: SpriteBlendMode;
    /** Required only for `cutout`. */
    alphaCutoff?: number;
}

export interface ComposedAnchoredSpriteShader {
    vertexWGSL: string;
    fragmentWGSL: string;
}

export function composeAnchoredSprite(opts: AnchoredSpriteShaderOptions): ComposedAnchoredSpriteShader {
    const snap = opts.pixelSnap ? "let snapped = floor(rotated + vec2<f32>(0.5));" : "let snapped = rotated;";

    const vertexWGSL = /* wgsl */ `
${SPRITE_3D_SCENE_UBO_WGSL}
@group(0) @binding(0) var<uniform> scene: Sprite3DSceneUBO;

struct VSIn {
    @builtin(vertex_index) vid: u32,
    @location(0) worldPos: vec3<f32>,
    @location(1) depthBias: f32,
    @location(2) offsetPx: vec2<f32>,
    @location(3) sizePx: vec2<f32>,
    @location(4) pivot: vec2<f32>,
    @location(5) sinCos: vec2<f32>,
    @location(6) uvRect: vec4<f32>,
    @location(7) color: vec4<f32>,
    @location(8) flagsAndPad: vec4<f32>,
};

struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

fn rotate2(p: vec2<f32>, sinCos: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(p.x * sinCos.y - p.y * sinCos.x, p.x * sinCos.x + p.y * sinCos.y);
}

@vertex
fn vs_main(in: VSIn) -> VSOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0)
    );
    let corner = corners[in.vid];
    let anchorClip = scene.viewProjection * vec4<f32>(in.worldPos, 1.0);
    let localPx = (corner - in.pivot) * in.sizePx + in.offsetPx;
    let rotated = rotate2(localPx, in.sinCos);
    ${snap}
    let ndcOffset = vec2<f32>(
         snapped.x * scene.invViewportPx.x * 2.0,
        -snapped.y * scene.invViewportPx.y * 2.0
    );
    var u = mix(in.uvRect.x, in.uvRect.z, corner.x);
    var v = mix(in.uvRect.y, in.uvRect.w, corner.y);
    if (in.flagsAndPad.x > 0.5) { u = in.uvRect.x + in.uvRect.z - u; }
    if (in.flagsAndPad.y > 0.5) { v = in.uvRect.y + in.uvRect.w - v; }
    var out: VSOut;
    out.pos = vec4<f32>(
        anchorClip.x + ndcOffset.x * anchorClip.w,
        anchorClip.y + ndcOffset.y * anchorClip.w,
        anchorClip.z + in.depthBias * anchorClip.w,
        anchorClip.w
    );
    out.uv = vec2<f32>(u, v);
    out.color = in.color;
    return out;
}
`;

    const cutoff = opts.blendMode === "cutout" ? `if (c.a < ${(opts.alphaCutoff ?? 0.5).toFixed(6)}) { discard; }` : "";
    const returnStmt = opts.blendMode === "multiply" ? "return vec4<f32>(c.rgb * c.a, c.a);" : "return c;";

    const fragmentWGSL = /* wgsl */ `
struct SpriteLayerUBO {
    opacity: f32,
    _pad: vec3<f32>,
};
@group(1) @binding(0) var atlasTex: texture_2d<f32>;
@group(1) @binding(1) var atlasSamp: sampler;
@group(1) @binding(2) var<uniform> layer: SpriteLayerUBO;

struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    var c = textureSample(atlasTex, atlasSamp, in.uv) * in.color;
    c.a = c.a * layer.opacity;
    ${cutoff}
    ${returnStmt}
}
`;

    return { vertexWGSL, fragmentWGSL };
}
