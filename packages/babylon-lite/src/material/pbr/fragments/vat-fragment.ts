/**
 * VAT (Vertex Animation Texture) Fragment
 *
 * Vertex-stage skinning whose bone matrices come from a BAKED texture instead of the live per-frame
 * bone texture: the skeletal animation was pre-evaluated and stacked one frame per texture ROW
 * (vat/vat-baker.ts). Each vertex still uses its `joints`/`weights` attributes, but the bone matrix is
 * read from row = the current animation frame, so the whole skeleton update is gone from the CPU and the
 * mesh becomes GPU thin-instanceable (each instance can sit at its own frame).
 *
 * Same texture layout as the live skeleton (rgba32float, 4 texels per bone, one mat4 column each — see
 * skeleton/create-skeleton.ts), just with `height = frameCount` rows. Strictly opt-in behind MSH_VAT;
 * a scene with no VAT mesh never imports this module (dynamic-import gated by `hasSomeVat`).
 */

import type { ShaderFragment, VertexAttribute } from "../../../shader/fragment-types.js";

// WebGPU shader stage constants
const STAGE_VERTEX = 0x1;

// `vat.params` = (fromRow, toRow, frameOffset, fps); `vat.clock.x` = elapsed seconds. The current row is
// fromRow + ((frameOffset + clock*fps) wrapped into [0, toRow-fromRow+1)). readMatrixFromVat reads bone
// `index`'s 4 column-texels from that row.
const VAT_HELPERS = `struct vatUniforms {
params: vec4<f32>,
clock: vec4<f32>,
}
fn readMatrixFromVat(smp: texture_2d<f32>, index: f32, row: i32) -> mat4x4<f32> {
let o = i32(index) * 4;
let m0 = textureLoad(smp, vec2<i32>(o + 0, row), 0);
let m1 = textureLoad(smp, vec2<i32>(o + 1, row), 0);
let m2 = textureLoad(smp, vec2<i32>(o + 2, row), 0);
let m3 = textureLoad(smp, vec2<i32>(o + 3, row), 0);
return mat4x4f(m0, m1, m2, m3);
}
fn vatFrameRow(p: vec4<f32>, t: f32) -> i32 {
let span = max(1.0, p.y - p.x + 1.0);
let raw = p.z + t * p.w;
let wrapped = raw - floor(raw / span) * span;
return i32(p.x + wrapped);
}`;

function makeVatSkinningCode(has8Bones: boolean, instanced: boolean): string {
    // Per-instance VAT reads each instance's (fromRow,toRow,offset,fps) from instanceTexture at
    // column = instance_index; non-instanced VAT uses the shared settings UBO. The shared clock
    // (vat.clock.x) drives both, so a per-instance offset just staggers each instance's phase.
    const rowExpr = instanced
        ? `let vatP = textureLoad(vatInstanceTex, vec2<i32>(i32(vatInstanceIndex), 0), 0);
let vatRow = vatFrameRow(vatP, vat.clock.x);`
        : `let vatRow = vatFrameRow(vat.params, vat.clock.x);`;
    let code = `${rowExpr}
var influence: mat4x4<f32> = readMatrixFromVat(vatSampler, f32(joints[0]), vatRow) * weights[0];
influence = influence + readMatrixFromVat(vatSampler, f32(joints[1]), vatRow) * weights[1];
influence = influence + readMatrixFromVat(vatSampler, f32(joints[2]), vatRow) * weights[2];
influence = influence + readMatrixFromVat(vatSampler, f32(joints[3]), vatRow) * weights[3];`;
    if (has8Bones) {
        code += `
influence = influence + readMatrixFromVat(vatSampler, f32(joints1[0]), vatRow) * weights1[0];
influence = influence + readMatrixFromVat(vatSampler, f32(joints1[1]), vatRow) * weights1[1];
influence = influence + readMatrixFromVat(vatSampler, f32(joints1[2]), vatRow) * weights1[2];
influence = influence + readMatrixFromVat(vatSampler, f32(joints1[3]), vatRow) * weights1[3];`;
    }
    // Instanced: place the fully-posed prototype (mesh.world * skin) into the world by the per-instance
    // matrix (world0-3) applied OUTERMOST, so grid/herd offsets are world-space and not scaled by the
    // prototype's own transform. Non-instanced keeps the Stage-1 path (mesh.world * skin).
    code += instanced
        ? `\nlet vatInstWorld = mat4x4<f32>(world0, world1, world2, world3);
finalWorld = vatInstWorld * mesh.world * influence;`
        : `\nfinalWorld = mesh.world * influence;`;
    return code;
}

/**
 * Create a VAT fragment.
 * @param has8Bones - Whether to use 8-bone skinning (joints1/weights1).
 * @param instanced - Whether each thin-instance plays its own frame (reads instanceTexture by instance_index).
 */
export function createVatFragment(has8Bones: boolean, instanced: boolean): ShaderFragment {
    return {
        _id: "vat",

        // Instanced VAT places the skinned mesh by world0-3 (declared by the thin-instance fragment), so it
        // must compose AFTER thin-instance in the shared VW slot — otherwise thin-instance's finalWorld write
        // would clobber the skinned+instanced transform.
        _dependencies: instanced ? ["thin-instance"] : undefined,

        _vertexAttributes: [
            { _name: "joints", _type: "vec4<u32>", _gpuFormat: "uint32x4" as GPUVertexFormat, _arrayStride: 16 },
            { _name: "weights", _type: "vec4<f32>", _gpuFormat: "float32x4" as GPUVertexFormat, _arrayStride: 16 },
            ...(has8Bones
                ? [
                      { _name: "joints1", _type: "vec4<u32>", _gpuFormat: "uint32x4" as GPUVertexFormat, _arrayStride: 16 },
                      { _name: "weights1", _type: "vec4<f32>", _gpuFormat: "float32x4" as GPUVertexFormat, _arrayStride: 16 },
                  ]
                : []),
        ] as VertexAttribute[],

        _vertexBindings: [
            { _name: "vatSampler", _type: { _kind: "texture", _textureType: "texture_2d<f32>" as const, _sampleType: "unfilterable-float" as const }, _visibility: STAGE_VERTEX },
            { _name: "vat", _type: { _kind: "uniform-buffer" as const }, _visibility: STAGE_VERTEX },
            ...(instanced
                ? [{ _name: "vatInstanceTex", _type: { _kind: "texture" as const, _textureType: "texture_2d<f32>" as const, _sampleType: "unfilterable-float" as const }, _visibility: STAGE_VERTEX }]
                : []),
        ],

        _vertexBuiltins: instanced ? [{ _name: "vatInstanceIndex", _builtin: "instance_index", _type: "u32" }] : undefined,

        _vertexHelperFunctions: VAT_HELPERS,

        _vertexSlots: {
            VW: makeVatSkinningCode(has8Bones, instanced),
        },
    };
}

import type { PbrExt } from "../pbr-flags.js";
import { MSH_VAT, MSH_HAS_SKELETON_8, MSH_VAT_INSTANCED } from "../../mesh-features.js";

export const pbrExt: PbrExt = {
    id: "vat",
    phase: "vertex",
    frag(ctx) {
        if (!(ctx._meshFeatures & MSH_VAT)) {
            return null;
        }
        return createVatFragment((ctx._meshFeatures & MSH_HAS_SKELETON_8) !== 0, (ctx._meshFeatures & MSH_VAT_INSTANCED) !== 0);
    },
    bind(ctx, entries, b) {
        const mesh = ctx._mesh as { vat?: { texture: GPUTexture; settingsBuffer: GPUBuffer; instanceTexture?: GPUTexture | null } } | undefined;
        if (!(ctx._meshFeatures & MSH_VAT) || !mesh?.vat) {
            return b;
        }
        entries.push({ binding: b++, resource: mesh.vat.texture.createView() });
        entries.push({ binding: b++, resource: { buffer: mesh.vat.settingsBuffer } });
        if (ctx._meshFeatures & MSH_VAT_INSTANCED && mesh.vat.instanceTexture) {
            // Same declaration order as _vertexBindings above (vatSampler, vat, vatInstanceTex).
            entries.push({ binding: b++, resource: mesh.vat.instanceTexture.createView() });
        }
        return b;
    },
};
