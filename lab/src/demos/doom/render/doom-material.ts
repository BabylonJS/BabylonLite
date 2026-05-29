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
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let src = textureSample(srcTex, srcTexSampler, input.uv);
  if (src.a < 0.5) { discard; }
  let idx = floor(src.r * 255.0 + 0.5);
  let sectorLight = input.light.x * 255.0;
  let fullbright = input.light.y;
  // Brighter sectors map to lower (lighter) colormap rows.
  let baseRow = clamp(31.0 - floor(sectorLight / 8.0), 0.0, 31.0);
  let distBand = floor(length(input.viewPos) / DIST_PER_BAND);
  var row = clamp(baseRow + distBand, 0.0, 31.0);
  row = mix(row, 0.0, step(0.5, fullbright));
  let lut = textureSample(colormapTex, colormapTexSampler, vec2<f32>((idx + 0.5) / 256.0, (row + 0.5) / 34.0));
  return vec4<f32>(lut.rgb, 1.0);
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
