/** WGSL shaders for GPU pick-ID rendering.
 *  Outputs pick ID as rgba8unorm (location 0) and depth as r32float (location 1). */

// ─── Regular mesh picking shader ────────────────────────────────────

export const pickingShaderSource = /* wgsl */ `
struct SceneUniforms { viewProjection: mat4x4f };
struct MeshUniforms { world: mat4x4f, pickId: u32 };
@group(0) @binding(0) var<uniform> scene: SceneUniforms;
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;
struct VsOut { @builtin(position) position: vec4f, @location(0) @interpolate(flat) pickId: u32 };
@vertex fn vs(@location(0) position: vec3f) -> VsOut {
var out: VsOut;
out.position = scene.viewProjection * mesh.world * vec4f(position, 1.0);
out.pickId = mesh.pickId;
return out;
}
struct FsOut { @location(0) color: vec4f, @location(1) depth: vec4f };
@fragment fn fs(input: VsOut) -> FsOut {
let id = input.pickId;
let r = f32((id >> 16u) & 0xFFu) / 255.0;
let g = f32((id >> 8u) & 0xFFu) / 255.0;
let b = f32(id & 0xFFu) / 255.0;
return FsOut(vec4f(r, g, b, 1.0), vec4f(input.position.z, 0.0, 0.0, 0.0));
}
`;

// ─── Thin-instance picking shader ───────────────────────────────────

export const pickingThinInstanceShaderSource = /* wgsl */ `
struct SceneUniforms { viewProjection: mat4x4f };
struct TIMeshUniforms { baseMeshPickId: u32 };
@group(0) @binding(0) var<uniform> scene: SceneUniforms;
@group(1) @binding(0) var<uniform> tiMesh: TIMeshUniforms;
@group(1) @binding(1) var<storage, read> instances: array<mat4x4f>;
struct VsOut { @builtin(position) position: vec4f, @location(0) @interpolate(flat) pickId: u32 };
@vertex fn vs(@location(0) position: vec3f, @builtin(instance_index) instanceIndex: u32) -> VsOut {
let world = instances[instanceIndex];
var out: VsOut;
out.position = scene.viewProjection * world * vec4f(position, 1.0);
out.pickId = tiMesh.baseMeshPickId + instanceIndex;
return out;
}
struct FsOut { @location(0) color: vec4f, @location(1) depth: vec4f };
@fragment fn fs(input: VsOut) -> FsOut {
let id = input.pickId;
let r = f32((id >> 16u) & 0xFFu) / 255.0;
let g = f32((id >> 8u) & 0xFFu) / 255.0;
let b = f32(id & 0xFFu) / 255.0;
return FsOut(vec4f(r, g, b, 1.0), vec4f(input.position.z, 0.0, 0.0, 0.0));
}
`;
