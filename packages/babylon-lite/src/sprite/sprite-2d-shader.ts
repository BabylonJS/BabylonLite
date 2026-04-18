/**
 * Sprite2DLayer WGSL composer.
 *
 * Per spec §13: small parameterized shader composed from inline TS strings
 * (mirrors `material/pbr/background-dds-skybox.ts` style). No `?raw` import.
 *
 * Composition variables:
 *  - PIXEL_SNAP   — pixelSnap branch baked as either `floor(p + 0.5)` or `p`.
 *  - CUTOFF       — `cutout` blend mode discards fragments below `alphaCutoff`.
 *  - RETURN       — `alpha`/`multiply` premultiply at output; others return as-is.
 */

import type { SpriteBlendMode } from "./shared/sprite-atlas.js";

export interface Sprite2DShaderOptions {
    pixelSnap: boolean;
    blendMode: SpriteBlendMode;
    /** Required only for `cutout`. */
    alphaCutoff?: number;
}

export interface ComposedSprite2DShader {
    vertexWGSL: string;
    fragmentWGSL: string;
}

export function composeSprite2D(opts: Sprite2DShaderOptions): ComposedSprite2DShader {
    const snap = opts.pixelSnap ? "let snapped = floor(viewed + vec2<f32>(0.5));" : "let snapped = viewed;";

    const vertexWGSL = /* wgsl */ `
struct Sprite2DSceneUBO {
    viewportPx: vec2<f32>,
    invViewportPx: vec2<f32>,
    viewPositionPx: vec2<f32>,
    zoom: f32,
    viewRotation: f32,
};
@group(0) @binding(0) var<uniform> scene: Sprite2DSceneUBO;

struct VSIn {
    @builtin(vertex_index) vid: u32,
    @location(0) positionPx: vec2<f32>,
    @location(1) sizePx: vec2<f32>,
    @location(2) pivot: vec2<f32>,
    @location(3) sinCos: vec2<f32>,
    @location(4) uvRect: vec4<f32>,
    @location(5) color: vec4<f32>,
    @location(6) layerZ: f32,
    @location(7) flipX: f32,
    @location(8) flipY: f32,
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
    let localPx = (corner - in.pivot) * in.sizePx;
    let rotated = rotate2(localPx, in.sinCos);
    let layerPx = in.positionPx + rotated;
    let viewSinCos = vec2<f32>(sin(scene.viewRotation), cos(scene.viewRotation));
    let viewed = rotate2(layerPx - scene.viewPositionPx, viewSinCos) * scene.zoom + scene.viewPositionPx;
    ${snap}
    let ndc = vec2<f32>(
        snapped.x * scene.invViewportPx.x * 2.0 - 1.0,
        1.0 - snapped.y * scene.invViewportPx.y * 2.0
    );
    let z = 1.0 - clamp(in.layerZ, 0.0, 1.0);
    var u = mix(in.uvRect.x, in.uvRect.z, corner.x);
    var v = mix(in.uvRect.y, in.uvRect.w, corner.y);
    if (in.flipX > 0.5) { u = in.uvRect.x + in.uvRect.z - u; }
    if (in.flipY > 0.5) { v = in.uvRect.y + in.uvRect.w - v; }
    var out: VSOut;
    out.pos = vec4<f32>(ndc, z, 1.0);
    out.uv = vec2<f32>(u, v);
    out.color = in.color;
    return out;
}
`;

    const cutoff = opts.blendMode === "cutout" ? `if (c.a < ${(opts.alphaCutoff ?? 0.5).toFixed(6)}) { discard; }` : "";
    // Premultiply only for `multiply` blend (its blend state expects pre-weighted RGB).
    // `alpha` mode emits straight RGB and the (src-alpha, 1-src-alpha) blend state
    // performs the weighting — matching canvas2D `globalAlpha` semantics.
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
