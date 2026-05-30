// Faithful DOOM render material: nearest-sampled, palette-indexed source texture
// remapped through a COLORMAP light-diminishing LUT (banded, not smooth RGB).
//
// Source textures store the palette index in the R channel (0..255) and coverage
// in A (255 opaque / 0 transparent). A 256×34 colormap LUT texture maps
// (paletteIndex, lightRow) → final RGB. Per-vertex `color` carries:
//   color.r = sector light level / 255
//   color.g = fullbright flag (1 = ignore diminishing, e.g. fullbright sprites)

import { createShaderMaterial, setShaderTexture, type ShaderMaterial, type Texture2D } from "babylon-lite";

const vertexSource = `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) viewPos: vec3<f32>,
  @location(2) light: vec2<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.worldViewProjection * vec4<f32>(input.position, 1.0);
  out.viewPos = (shaderSystem.worldView * vec4<f32>(input.position, 1.0)).xyz;
  out.uv = input.uv;
  out.light = vec2<f32>(input.color.r, input.color.g);
  return out;
}`;

// Distance, in Doom map units, that darkens the picture by one colormap band.
const DIST_PER_BAND = 224.0;

const fragmentSource = `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) viewPos: vec3<f32>,
  @location(2) light: vec2<f32>,
};
const DIST_PER_BAND: f32 = ${DIST_PER_BAND.toFixed(1)};
// Max texture taps for the anisotropic footprint integration. Glancing walls
// squeeze many texels into one screen column; a single nearest tap aliases into
// fine vertical "bars". We instead average several taps across the pixel's
// texel footprint -- but only AFTER the COLORMAP lookup, so we average final
// RGB colors (valid) rather than palette indices (averaging indices is garbage).
const MAX_TAPS: i32 = 8;
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = input.uv;
  // Screen-space derivatives MUST be evaluated in uniform control flow (here,
  // before any discard/branch). Convert to texel space to size the footprint.
  let dims = vec2<f32>(textureDimensions(srcTex, 0));
  let dx = dpdx(uv) * dims;
  let dy = dpdy(uv) * dims;
  // Walk along whichever screen axis stretches the texture most (the minified,
  // aliasing direction). majorUv is that step expressed in normalized UV.
  let xMajor = dot(dx, dx) >= dot(dy, dy);
  let majorUv = select(dpdy(uv), dpdx(uv), xMajor);
  let footprint = sqrt(max(dot(dx, dx), dot(dy, dy)));
  let taps = clamp(i32(ceil(footprint)), 1, MAX_TAPS);
  let tapsF = f32(taps);

  let fullbright = input.light.y;
  let sectorLight = input.light.x * 255.0;
  // Brighter sectors map to lower (lighter) colormap rows.
  let baseRow = clamp(31.0 - floor(sectorLight / 8.0), 0.0, 31.0);
  // Doom diminishes light by forward DEPTH (distance into the view), not radial
  // distance, so bands read as flat horizontal steps rather than arcs curving
  // around the camera. View space is left-handed (camera looks down +Z).
  let depth = max(0.0, input.viewPos.z);
  // Continuous light row + linear blend between the two adjacent COLORMAP light
  // levels so depth-cueing reads as a smooth gradient, not hard banding.
  let lightRow = clamp(baseRow + depth / DIST_PER_BAND, 0.0, 31.0);
  let row = mix(lightRow, 0.0, step(0.5, fullbright));
  let r0 = floor(row);
  let r1 = min(r0 + 1.0, 31.0);
  let frac = row - r0;
  let v0 = (r0 + 0.5) / 34.0;
  let v1 = (r1 + 0.5) / 34.0;

  var acc = vec3<f32>(0.0, 0.0, 0.0);
  var cover = 0.0;
  for (var i = 0; i < taps; i = i + 1) {
    // Spread taps evenly across the footprint, centered on the fragment.
    let t = (f32(i) + 0.5) / tapsF - 0.5;
    let sampleUv = uv + majorUv * t;
    // textureSampleLevel (explicit LOD 0) is safe inside the loop -- it needs no
    // implicit derivative -- and the nearest sampler keeps each tap palette-exact.
    let s = textureSampleLevel(srcTex, srcTexSampler, sampleUv, 0.0);
    if (s.a >= 0.5) {
      let su = (floor(s.r * 255.0 + 0.5) + 0.5) / 256.0;
      let c0 = textureSampleLevel(colormapTex, colormapTexSampler, vec2<f32>(su, v0), 0.0);
      let c1 = textureSampleLevel(colormapTex, colormapTexSampler, vec2<f32>(su, v1), 0.0);
      acc = acc + mix(c0, c1, frac).rgb;
      cover = cover + 1.0;
    }
  }
  if (cover < 0.5) { discard; }
  return vec4<f32>(acc / cover, 1.0);
}`;

export function createDoomMaterial(name: string, srcTex: Texture2D, colormapTex: Texture2D): ShaderMaterial {
    const mat = createShaderMaterial({
        name,
        vertexSource,
        fragmentSource,
        attributes: ["position", "uv", "color"],
        uniforms: ["worldViewProjection", "worldView"],
        samplers: ["srcTex", "colormapTex"],
        backFaceCulling: false,
    });
    setShaderTexture(mat, "srcTex", srcTex);
    setShaderTexture(mat, "colormapTex", colormapTex);
    return mat;
}
