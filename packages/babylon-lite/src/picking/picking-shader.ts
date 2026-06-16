/** WGSL shaders for GPU pick-ID rendering.
 *  Outputs pick ID as rgba8unorm (location 0) and depth as r32float (location 1). */

// ─── Shared structs + fragment shader ───────────────────────────────

const PICK_SHARED = /* wgsl */ `
fn pickClipOne(wp: vec3f, a: vec4f, b: vec4f, c: vec4f) -> bool {
let q = wp.xz - a.xy;
let ds = dot(q, a.zw);
let dp = dot(q, vec2f(-a.w, a.z));
if (abs(dp) > c.y) { return false; }
let y = wp.y - b.x;
let outerHW = b.y + c.x;
if (c.z > 0.5) { return y <= b.z + c.x && abs(ds) <= outerHW; }
if (y <= b.z) { return abs(ds) <= outerHW; }
let outerRise = b.w + c.x;
if (y > b.z + outerRise || outerRise <= 0.0) { return false; }
let ex = ds / max(outerHW, 0.001);
let ey = (y - b.z) / max(outerRise, 0.001);
return ex * ex + ey * ey <= 1.0;
}
`;

// ─── Shared structs + fragment shader ───────────────────────────────

const PICK_FS = /* wgsl */ `
struct VsOut { @builtin(position) position: vec4f, @location(0) @interpolate(flat) pickId: u32, @location(1) worldPos: vec3f, @location(2) clipSkip: f32 };
struct FsOut { @location(0) color: vec4f, @location(1) depth: vec4f };
@fragment fn fs(input: VsOut) -> FsOut {
if (input.clipSkip < 0.5 && pickClipHit(input.worldPos)) { discard; }
let id = input.pickId;
let r = f32((id >> 16u) & 0xFFu) / 255.0;
let g = f32((id >> 8u) & 0xFFu) / 255.0;
let b = f32(id & 0xFFu) / 255.0;
return FsOut(vec4f(r, g, b, 1.0), vec4f(input.position.z, 0.0, 0.0, 0.0));
}
`;

// ─── Regular mesh picking shader ────────────────────────────────────

export const pickingShaderSource = /* wgsl */ `
struct SceneUniforms { viewProjection: mat4x4f };
struct MeshUniforms {
world: mat4x4f,
pickId: u32,
clipCount: u32,
_pad0: vec2u,
clipA0: vec4f, clipB0: vec4f, clipC0: vec4f,
clipA1: vec4f, clipB1: vec4f, clipC1: vec4f,
clipA2: vec4f, clipB2: vec4f, clipC2: vec4f,
clipA3: vec4f, clipB3: vec4f, clipC3: vec4f,
clipA4: vec4f, clipB4: vec4f, clipC4: vec4f,
clipA5: vec4f, clipB5: vec4f, clipC5: vec4f,
clipA6: vec4f, clipB6: vec4f, clipC6: vec4f,
clipA7: vec4f, clipB7: vec4f, clipC7: vec4f,
clipA8: vec4f, clipB8: vec4f, clipC8: vec4f,
clipA9: vec4f, clipB9: vec4f, clipC9: vec4f,
clipA10: vec4f, clipB10: vec4f, clipC10: vec4f,
clipA11: vec4f, clipB11: vec4f, clipC11: vec4f,
};
@group(0) @binding(0) var<uniform> scene: SceneUniforms;
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;
${PICK_SHARED}
fn pickClipHit(wp: vec3f) -> bool {
let n = i32(mesh.clipCount);
if (n > 0 && pickClipOne(wp, mesh.clipA0, mesh.clipB0, mesh.clipC0)) { return true; }
if (n > 1 && pickClipOne(wp, mesh.clipA1, mesh.clipB1, mesh.clipC1)) { return true; }
if (n > 2 && pickClipOne(wp, mesh.clipA2, mesh.clipB2, mesh.clipC2)) { return true; }
if (n > 3 && pickClipOne(wp, mesh.clipA3, mesh.clipB3, mesh.clipC3)) { return true; }
if (n > 4 && pickClipOne(wp, mesh.clipA4, mesh.clipB4, mesh.clipC4)) { return true; }
if (n > 5 && pickClipOne(wp, mesh.clipA5, mesh.clipB5, mesh.clipC5)) { return true; }
if (n > 6 && pickClipOne(wp, mesh.clipA6, mesh.clipB6, mesh.clipC6)) { return true; }
if (n > 7 && pickClipOne(wp, mesh.clipA7, mesh.clipB7, mesh.clipC7)) { return true; }
if (n > 8 && pickClipOne(wp, mesh.clipA8, mesh.clipB8, mesh.clipC8)) { return true; }
if (n > 9 && pickClipOne(wp, mesh.clipA9, mesh.clipB9, mesh.clipC9)) { return true; }
if (n > 10 && pickClipOne(wp, mesh.clipA10, mesh.clipB10, mesh.clipC10)) { return true; }
if (n > 11 && pickClipOne(wp, mesh.clipA11, mesh.clipB11, mesh.clipC11)) { return true; }
return false;
}
${PICK_FS}
@vertex fn vs(@location(0) position: vec3f) -> VsOut {
var out: VsOut;
let wp = (mesh.world * vec4f(position, 1.0)).xyz;
out.position = scene.viewProjection * vec4f(wp, 1.0);
out.pickId = mesh.pickId;
out.worldPos = wp;
out.clipSkip = 0.0;
return out;
}
`;

// ─── Thin-instance picking shader ───────────────────────────────────

export const pickingThinInstanceShaderSource = /* wgsl */ `
struct SceneUniforms { viewProjection: mat4x4f };
struct TIMeshUniforms {
baseMeshPickId: u32,
clipCount: u32,
_pad0: vec2u,
clipA0: vec4f, clipB0: vec4f, clipC0: vec4f,
clipA1: vec4f, clipB1: vec4f, clipC1: vec4f,
clipA2: vec4f, clipB2: vec4f, clipC2: vec4f,
clipA3: vec4f, clipB3: vec4f, clipC3: vec4f,
clipA4: vec4f, clipB4: vec4f, clipC4: vec4f,
clipA5: vec4f, clipB5: vec4f, clipC5: vec4f,
clipA6: vec4f, clipB6: vec4f, clipC6: vec4f,
clipA7: vec4f, clipB7: vec4f, clipC7: vec4f,
clipA8: vec4f, clipB8: vec4f, clipC8: vec4f,
clipA9: vec4f, clipB9: vec4f, clipC9: vec4f,
clipA10: vec4f, clipB10: vec4f, clipC10: vec4f,
clipA11: vec4f, clipB11: vec4f, clipC11: vec4f,
};
@group(0) @binding(0) var<uniform> scene: SceneUniforms;
@group(1) @binding(0) var<uniform> tiMesh: TIMeshUniforms;
@group(1) @binding(1) var<storage, read> instances: array<mat4x4f>;
${PICK_SHARED}
fn pickClipHit(wp: vec3f) -> bool {
let n = i32(tiMesh.clipCount);
if (n > 0 && pickClipOne(wp, tiMesh.clipA0, tiMesh.clipB0, tiMesh.clipC0)) { return true; }
if (n > 1 && pickClipOne(wp, tiMesh.clipA1, tiMesh.clipB1, tiMesh.clipC1)) { return true; }
if (n > 2 && pickClipOne(wp, tiMesh.clipA2, tiMesh.clipB2, tiMesh.clipC2)) { return true; }
if (n > 3 && pickClipOne(wp, tiMesh.clipA3, tiMesh.clipB3, tiMesh.clipC3)) { return true; }
if (n > 4 && pickClipOne(wp, tiMesh.clipA4, tiMesh.clipB4, tiMesh.clipC4)) { return true; }
if (n > 5 && pickClipOne(wp, tiMesh.clipA5, tiMesh.clipB5, tiMesh.clipC5)) { return true; }
if (n > 6 && pickClipOne(wp, tiMesh.clipA6, tiMesh.clipB6, tiMesh.clipC6)) { return true; }
if (n > 7 && pickClipOne(wp, tiMesh.clipA7, tiMesh.clipB7, tiMesh.clipC7)) { return true; }
if (n > 8 && pickClipOne(wp, tiMesh.clipA8, tiMesh.clipB8, tiMesh.clipC8)) { return true; }
if (n > 9 && pickClipOne(wp, tiMesh.clipA9, tiMesh.clipB9, tiMesh.clipC9)) { return true; }
if (n > 10 && pickClipOne(wp, tiMesh.clipA10, tiMesh.clipB10, tiMesh.clipC10)) { return true; }
if (n > 11 && pickClipOne(wp, tiMesh.clipA11, tiMesh.clipB11, tiMesh.clipC11)) { return true; }
return false;
}
${PICK_FS}
@vertex fn vs(@location(0) position: vec3f, @builtin(instance_index) instanceIndex: u32) -> VsOut {
let m = instances[instanceIndex];
// Treat the instance placement as an AFFINE transform: force the basis columns' homogeneous w to 0 and the
// translation column's w to 1. Thin-instanced ShaderMaterials may pack per-instance data in those spare w
// lanes (a sanctioned pattern — Lite injects world0..world3 and the app's own vertex shader zeroes them
// before transforming, e.g. a frozen anchor Y in world0.w). Picking only needs the transform, so any packed
// value left in w would corrupt clip.w → wrong depth/rasterisation → the pick returns the wrong instance.
let world = mat4x4f(
vec4f(m[0].xyz, 0.0),
vec4f(m[1].xyz, 0.0),
vec4f(m[2].xyz, 0.0),
vec4f(m[3].xyz, 1.0),
);
var out: VsOut;
let wp = (world * vec4f(position, 1.0)).xyz;
out.position = scene.viewProjection * vec4f(wp, 1.0);
out.pickId = tiMesh.baseMeshPickId + instanceIndex;
out.worldPos = wp;
out.clipSkip = clamp(floor(max(m[2].w, 0.0) * 0.25), 0.0, 1.0);
return out;
}
`;
