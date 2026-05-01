// Skinned (8-bone) shadow depth vertex shader.
// Same as shadow-skinned-4 but with a second joints/weights set for KHR_mesh_quantization-style
// meshes that use 8 influences per vertex.
struct MeshUniforms {
  world: mat4x4<f32>,
};
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;

struct ShadowParams {
  biasAndScale: vec4<f32>,
  depthValues: vec4<f32>,
};
@group(1) @binding(1) var<uniform> shadowParams: ShadowParams;

@group(1) @binding(2) var boneSampler: texture_2d<f32>;

fn readMatrixFromRawSampler(smp: texture_2d<f32>, index: f32) -> mat4x4<f32> {
  let offset = i32(index) * 4;
  let m0 = textureLoad(smp, vec2<i32>(offset + 0, 0), 0);
  let m1 = textureLoad(smp, vec2<i32>(offset + 1, 0), 0);
  let m2 = textureLoad(smp, vec2<i32>(offset + 2, 0), 0);
  let m3 = textureLoad(smp, vec2<i32>(offset + 3, 0), 0);
  return mat4x4f(m0, m1, m2, m3);
}

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) vDepthMetricSM: f32,
};

@vertex
fn main(
  @location(0) position: vec3<f32>,
  @location(1) joints: vec4<u32>,
  @location(2) weights: vec4<f32>,
  @location(3) joints1: vec4<u32>,
  @location(4) weights1: vec4<f32>,
) -> VertexOutput {
  var influence: mat4x4<f32> = readMatrixFromRawSampler(boneSampler, f32(joints[0])) * weights[0];
  influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints[1])) * weights[1];
  influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints[2])) * weights[2];
  influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints[3])) * weights[3];
  influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints1[0])) * weights1[0];
  influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints1[1])) * weights1[1];
  influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints1[2])) * weights1[2];
  influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints1[3])) * weights1[3];
  let finalWorld = mesh.world * influence;
  var out: VertexOutput;
  let worldPos = finalWorld * vec4<f32>(position, 1.0);
  out.clipPos = scene.viewProjection * worldPos;
  out.vDepthMetricSM = (out.clipPos.z + shadowParams.depthValues.x) / shadowParams.depthValues.y + shadowParams.biasAndScale.x;
  return out;
}
