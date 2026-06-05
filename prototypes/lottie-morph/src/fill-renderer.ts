// Vector fill renderer — stencil-then-cover, packaged as a LayerRenderer for shape layers.
//
// For each path, per frame:
//   1. STENCIL pass — draw a triangle fan (anchor -> polyline edge) with two-sided
//      stencil inc/dec wrap. This writes the nonzero winding number into the stencil
//      buffer with no triangulation, handling concave/self-intersecting/holey shapes.
//   2. COVER pass  — draw the path's bounding quad, testing stencil != 0. The fragment
//      shader evaluates the solid/linear/radial gradient. passOp = "zero" resets the
//      stencil so the next path starts clean.
//
// The shared frame pass (frame.ts) owns the MSAA color + stencil targets and the clear/
// resolve; this renderer only records draws into the pass it is handed. Output is
// premultiplied alpha, blended "over".

import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine.js";
import type { LayerRenderContext, LayerRenderer } from "./layer-renderer.js";
import type { DrawOp, ParsedLayer, Transform } from "./parse.js";
import type { Prop } from "./lottie-raw.js";
import { DEPTH_STENCIL_FORMAT } from "./frame.js";
import { apply, lottieTransform, multiply, type Mat2D } from "./matrix.js";
import { sampleEllipse, sampleMulti, sampleRect, sampleScalar, sampleShape } from "./sample.js";
import { buildContourPoints } from "./geometry.js";

/** Generates stroke triangles from a flattened polyline. Provided (gated) only when the
 *  animation has visible strokes; see stroke-geometry.ts and the player's dynamic import. */
export type StrokeGen = (poly: number[], count: number, halfWidth: number, closed: boolean, out: number[]) => number;

/** Floats per paint UBO block (256-byte aligned for dynamic offsets). */
const PAINT_FLOATS = 64;
const PAINT_BYTES = PAINT_FLOATS * 4; // 256

interface FillDraw {
    /** Stroke draws bypass the stencil pass and render their triangles directly. */
    stroke: boolean;
    fanFirst: number;
    fanCount: number;
    coverFirst: number;
    coverCount: number;
    paintIndex: number;
}

const STENCIL_WGSL = /* wgsl */ `
struct G { screen: vec4f };
@group(0) @binding(0) var<uniform> g: G;
@vertex fn vs(@location(0) p: vec2f) -> @builtin(position) vec4f {
  return vec4f(p.x / g.screen.x * 2.0 - 1.0, 1.0 - p.y / g.screen.y * 2.0, 0.0, 1.0);
}
@fragment fn fs() -> @location(0) vec4f { return vec4f(0.0); }
`;

const COVER_WGSL = /* wgsl */ `
struct G { screen: vec4f };
struct Paint {
  kso: vec4f,
  solid: vec4f,
  grad: vec4f,
  offs0: vec4f,
  offs1: vec4f,
  col: array<vec4f, 8>,
};
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var<uniform> P: Paint;
struct VO { @builtin(position) pos: vec4f, @location(0) scr: vec2f };
@vertex fn vs(@location(0) p: vec2f) -> VO {
  var o: VO;
  o.pos = vec4f(p.x / g.screen.x * 2.0 - 1.0, 1.0 - p.y / g.screen.y * 2.0, 0.0, 1.0);
  o.scr = p;
  return o;
}
fn off(i: u32) -> f32 {
  if (i < 4u) { return P.offs0[i]; }
  return P.offs1[i - 4u];
}
fn ramp(t: f32) -> vec4f {
  let n = u32(P.kso.y);
  if (t <= off(0u)) { return P.col[0]; }
  for (var i: u32 = 0u; i + 1u < n; i = i + 1u) {
    let a = off(i);
    let b = off(i + 1u);
    if (t >= a && t <= b) {
      let f = (t - a) / max(b - a, 1e-6);
      return mix(P.col[i], P.col[i + 1u], f);
    }
  }
  return P.col[n - 1u];
}
@fragment fn fs(in: VO) -> @location(0) vec4f {
  let kind = u32(P.kso.x);
  var rgba: vec4f;
  if (kind == 0u) {
    rgba = P.solid;
  } else {
    let s = P.grad.xy;
    let e = P.grad.zw;
    var t: f32;
    if (kind == 1u) {
      let d = e - s;
      t = clamp(dot(in.scr - s, d) / max(dot(d, d), 1e-6), 0.0, 1.0);
    } else {
      t = clamp(length(in.scr - s) / max(length(e - s), 1e-6), 0.0, 1.0);
    }
    rgba = ramp(t);
  }
  let a = rgba.a * P.kso.z;
  return vec4f(rgba.rgb * a, a);
}
`;

const VERTEX_LAYOUT: GPUVertexBufferLayout = {
    arrayStride: 8,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
};

function samplePoint(prop: Prop | undefined, frame: number, dx: number, dy: number, out: number[]): void {
    out[0] = dx;
    out[1] = dy;
    sampleMulti(prop, frame, out);
}

function transformMatrix(t: Transform, frame: number, a: number[], p: number[], s: number[]): Mat2D {
    samplePoint(t.a, frame, 0, 0, a);
    samplePoint(t.p, frame, 0, 0, p);
    samplePoint(t.s, frame, 100, 100, s);
    const rot = sampleScalar(t.r, frame, 0);
    return lottieTransform(a, p, s, rot);
}

/** Create the vector (shape-layer) renderer. Pass `strokeGen` (from the gated
 *  stroke-geometry module) to enable stroke rendering; omit it for fill-only animations. */
export function createFillRenderer(engine: EngineContext, strokeGen?: StrokeGen): LayerRenderer {
    const device = engine._device;
    const format = engine.format;
    const sampleCount = engine.msaaSamples;

    const globalBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const stencilBGL = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });
    const coverBGL = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: PAINT_BYTES } },
        ],
    });

    const stencilModule = device.createShaderModule({ code: STENCIL_WGSL });
    const coverModule = device.createShaderModule({ code: COVER_WGSL });

    // Nonzero winding: front faces increment, back faces decrement (wrap).
    const stencilPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [stencilBGL] }),
        vertex: { module: stencilModule, entryPoint: "vs", buffers: [VERTEX_LAYOUT] },
        fragment: { module: stencilModule, entryPoint: "fs", targets: [{ format, writeMask: 0 }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
            format: DEPTH_STENCIL_FORMAT,
            depthWriteEnabled: false,
            depthCompare: "always",
            stencilFront: { compare: "always", passOp: "increment-wrap", failOp: "keep", depthFailOp: "keep" },
            stencilBack: { compare: "always", passOp: "decrement-wrap", failOp: "keep", depthFailOp: "keep" },
            stencilReadMask: 0xff,
            stencilWriteMask: 0xff,
        },
        multisample: { count: sampleCount },
    });

    // Cover: draw where stencil != 0, reset stencil to 0, blend premultiplied "over".
    const coverPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [coverBGL] }),
        vertex: { module: coverModule, entryPoint: "vs", buffers: [VERTEX_LAYOUT] },
        fragment: {
            module: coverModule,
            entryPoint: "fs",
            targets: [
                {
                    format,
                    blend: {
                        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                    },
                },
            ],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
            format: DEPTH_STENCIL_FORMAT,
            depthWriteEnabled: false,
            depthCompare: "always",
            stencilFront: { compare: "not-equal", passOp: "zero", failOp: "keep", depthFailOp: "keep" },
            stencilBack: { compare: "not-equal", passOp: "zero", failOp: "keep", depthFailOp: "keep" },
            stencilReadMask: 0xff,
            stencilWriteMask: 0xff,
        },
        multisample: { count: sampleCount },
    });

    const stencilBindGroup = device.createBindGroup({ layout: stencilBGL, entries: [{ binding: 0, resource: { buffer: globalBuffer } }] });

    // Stroke stencil pipeline (only when strokes are enabled). A stroke's expanded triangles
    // (segment quads + round-join discs) self-overlap heavily; drawing them directly with a
    // semi-transparent color would accumulate alpha at every overlap (a 40% stroke piling up to
    // a thick opaque halo). Instead we stencil the UNION of all stroke triangles here — both
    // faces increment-clamp, so coverage is winding-independent and never cancels — then cover
    // once with the cover pipeline so the stroke paints at a single uniform alpha.
    const strokeStencilPipeline = strokeGen
        ? device.createRenderPipeline({
              layout: device.createPipelineLayout({ bindGroupLayouts: [stencilBGL] }),
              vertex: { module: stencilModule, entryPoint: "vs", buffers: [VERTEX_LAYOUT] },
              fragment: { module: stencilModule, entryPoint: "fs", targets: [{ format, writeMask: 0 }] },
              primitive: { topology: "triangle-list", cullMode: "none" },
              depthStencil: {
                  format: DEPTH_STENCIL_FORMAT,
                  depthWriteEnabled: false,
                  depthCompare: "always",
                  stencilFront: { compare: "always", passOp: "increment-clamp", failOp: "keep", depthFailOp: "keep" },
                  stencilBack: { compare: "always", passOp: "increment-clamp", failOp: "keep", depthFailOp: "keep" },
                  stencilReadMask: 0xff,
                  stencilWriteMask: 0xff,
              },
              multisample: { count: sampleCount },
          })
        : null;

    // Per-frame accumulation + scratch (reused across frames to avoid GC churn).
    const verts: number[] = [];
    const paintData: number[] = [];
    const draws: FillDraw[] = [];
    const ranges: number[] = []; // token -> (drawStart, drawCount) pairs
    const pts: number[] = [];
    const a = [0, 0];
    const p = [0, 0];
    const s = [100, 100];
    const g0 = [0, 0, 0, 1];
    const g1 = [0, 0];

    let vertexBuffer: GPUBuffer | null = null;
    let vertexCapacity = 0;
    let paintBuffer: GPUBuffer | null = null;
    let paintCapacity = 0;
    let coverBindGroup: GPUBindGroup | null = null;

    function writePaintBlock(op: DrawOp, m: Mat2D, frame: number, alpha: number): void {
        const base = paintData.length;
        for (let i = 0; i < PAINT_FLOATS; i++) {
            paintData.push(0);
        }
        const paint = op.paint;
        if (paint.kind === "solid" || paint.kind === "stroke") {
            paintData[base + 2] = alpha;
            g0[0] = 0;
            g0[1] = 0;
            g0[2] = 0;
            g0[3] = 1;
            sampleMulti(paint.color, frame, g0);
            paintData[base + 4] = g0[0];
            paintData[base + 5] = g0[1];
            paintData[base + 6] = g0[2];
            paintData[base + 7] = g0[3];
            return;
        }
        paintData[base + 0] = paint.kind === "radial" ? 2 : 1;
        paintData[base + 1] = paint.stops.count;
        paintData[base + 2] = alpha;
        samplePoint(paint.start, frame, 0, 0, g0);
        samplePoint(paint.end, frame, 0, 0, g1);
        const start: [number, number] = [0, 0];
        const end: [number, number] = [0, 0];
        apply(m, g0[0], g0[1], start);
        apply(m, g1[0], g1[1], end);
        paintData[base + 8] = start[0];
        paintData[base + 9] = start[1];
        paintData[base + 10] = end[0];
        paintData[base + 11] = end[1];
        for (let i = 0; i < paint.stops.count && i < 8; i++) {
            paintData[base + 12 + i] = paint.stops.offsets[i];
        }
        for (let i = 0; i < paint.stops.count && i < 8; i++) {
            const c = paint.stops.colors[i];
            paintData[base + 20 + i * 4 + 0] = c[0];
            paintData[base + 20 + i * 4 + 1] = c[1];
            paintData[base + 20 + i * 4 + 2] = c[2];
            paintData[base + 20 + i * 4 + 3] = c[3];
        }
    }

    function emitOp(op: DrawOp, worldLayer: Mat2D, frame: number, layerAlpha: number): void {
        const m = multiply(worldLayer, transformMatrix(op.groupTransform, frame, a, p, s));
        const groupOpacity = sampleScalar(op.groupTransform.o, frame, 100) / 100;
        const paintOpacity = sampleScalar(op.paintOpacity, frame, 100) / 100;
        const alpha = layerAlpha * groupOpacity * paintOpacity;
        if (alpha <= 0.0001) {
            return;
        }
        // Stroke paints need the gated stroke generator; skip if it wasn't loaded.
        const isStroke = op.paint.kind === "stroke";
        if (isStroke && !strokeGen) {
            return;
        }

        if (isStroke && op.paint.kind === "stroke") {
            // Strokes outline each contour. We stencil the UNION of all stroke triangles, then
            // cover once — so a semi-transparent stroke paints at a single uniform alpha instead
            // of accumulating where the expanded triangles overlap.
            const scale = Math.hypot(m[0], m[1]);
            const halfWidth = (sampleScalar(op.paint.width, frame, 0) * scale) / 2;
            if (halfWidth <= 0) {
                return;
            }
            const fanFirst = verts.length / 2;
            let fanCount = 0;
            let sMinx = Infinity;
            let sMiny = Infinity;
            let sMaxx = -Infinity;
            let sMaxy = -Infinity;
            for (const contour of op.contours) {
                const shape = contour.rect
                    ? sampleRect(contour.rect, frame)
                    : contour.ellipse
                      ? sampleEllipse(contour.ellipse, frame)
                      : contour.path
                        ? sampleShape(contour.path, frame)
                        : null;
                if (!shape) {
                    continue;
                }
                pts.length = 0;
                const np = buildContourPoints(shape, m, pts);
                if (np < 2) {
                    continue;
                }
                const before = verts.length;
                const added = strokeGen!(pts, np, halfWidth, shape.c, verts);
                fanCount += added;
                for (let vi = before; vi < verts.length; vi += 2) {
                    const x = verts[vi];
                    const y = verts[vi + 1];
                    if (x < sMinx) {
                        sMinx = x;
                    }
                    if (y < sMiny) {
                        sMiny = y;
                    }
                    if (x > sMaxx) {
                        sMaxx = x;
                    }
                    if (y > sMaxy) {
                        sMaxy = y;
                    }
                }
            }
            if (fanCount === 0) {
                return;
            }
            const coverFirst = verts.length / 2;
            verts.push(sMinx - 1, sMiny - 1, sMaxx + 1, sMiny - 1, sMinx - 1, sMaxy + 1, sMinx - 1, sMaxy + 1, sMaxx + 1, sMiny - 1, sMaxx + 1, sMaxy + 1);
            const paintIndex = draws.length;
            writePaintBlock(op, m, frame, alpha);
            draws.push({ stroke: true, fanFirst, fanCount, coverFirst, coverCount: 6, paintIndex });
            return;
        }

        // Fill: stencil ALL contours of the compound path together so opposite-winding counters
        // (glyph holes) cancel in the overlap region (nonzero winding), then cover once.
        const fanFirst = verts.length / 2;
        let fanCount = 0;
        let minx = Infinity;
        let miny = Infinity;
        let maxx = -Infinity;
        let maxy = -Infinity;
        for (const contour of op.contours) {
            const shape = contour.rect
                ? sampleRect(contour.rect, frame)
                : contour.ellipse
                  ? sampleEllipse(contour.ellipse, frame)
                  : contour.path
                    ? sampleShape(contour.path, frame)
                    : null;
            if (!shape) {
                continue;
            }
            pts.length = 0;
            const np = buildContourPoints(shape, m, pts);
            if (np < 2) {
                continue;
            }
            // Per-contour bbox: its center anchors this contour's fan; the union bounds the cover.
            let cMinx = Infinity;
            let cMiny = Infinity;
            let cMaxx = -Infinity;
            let cMaxy = -Infinity;
            for (let k = 0; k < np; k++) {
                const x = pts[k * 2];
                const y = pts[k * 2 + 1];
                if (x < cMinx) {
                    cMinx = x;
                }
                if (y < cMiny) {
                    cMiny = y;
                }
                if (x > cMaxx) {
                    cMaxx = x;
                }
                if (y > cMaxy) {
                    cMaxy = y;
                }
            }
            const cx = (cMinx + cMaxx) * 0.5;
            const cy = (cMiny + cMaxy) * 0.5;
            for (let k = 0; k < np - 1; k++) {
                verts.push(cx, cy, pts[k * 2], pts[k * 2 + 1], pts[(k + 1) * 2], pts[(k + 1) * 2 + 1]);
            }
            fanCount += (np - 1) * 3;
            if (cMinx < minx) {
                minx = cMinx;
            }
            if (cMiny < miny) {
                miny = cMiny;
            }
            if (cMaxx > maxx) {
                maxx = cMaxx;
            }
            if (cMaxy > maxy) {
                maxy = cMaxy;
            }
        }
        if (fanCount === 0) {
            return;
        }

        const coverFirst = verts.length / 2;
        verts.push(minx - 1, miny - 1, maxx + 1, miny - 1, minx - 1, maxy + 1, minx - 1, maxy + 1, maxx + 1, miny - 1, maxx + 1, maxy + 1);

        const paintIndex = draws.length;
        writePaintBlock(op, m, frame, alpha);
        draws.push({ stroke: false, fanFirst, fanCount, coverFirst, coverCount: 6, paintIndex });
    }

    function ensureVertexBuffer(vec2Count: number): void {
        if (vertexBuffer && vertexCapacity >= vec2Count) {
            return;
        }
        vertexBuffer?.destroy();
        vertexCapacity = Math.max(vec2Count, Math.ceil((vertexCapacity || 4096) * 1.5));
        vertexBuffer = device.createBuffer({ size: vertexCapacity * 8, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }

    function ensurePaintBuffer(blocks: number): void {
        if (paintBuffer && paintCapacity >= blocks) {
            return;
        }
        paintBuffer?.destroy();
        paintCapacity = Math.max(blocks, Math.ceil((paintCapacity || 32) * 1.5));
        paintBuffer = device.createBuffer({ size: paintCapacity * PAINT_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        coverBindGroup = device.createBindGroup({
            layout: coverBGL,
            entries: [
                { binding: 0, resource: { buffer: globalBuffer } },
                { binding: 1, resource: { buffer: paintBuffer, offset: 0, size: PAINT_BYTES } },
            ],
        });
    }

    return {
        kind: 4,
        beginFrame() {
            verts.length = 0;
            paintData.length = 0;
            draws.length = 0;
            ranges.length = 0;
        },
        emitLayer(layer: ParsedLayer, world: Mat2D, layerAlpha: number, ctx: LayerRenderContext): number {
            const drawStart = draws.length;
            // Lottie renders shape items back-to-front: iterate in reverse array order.
            for (let oi = layer.ops.length - 1; oi >= 0; oi--) {
                emitOp(layer.ops[oi], world, ctx.frame, layerAlpha);
            }
            const count = draws.length - drawStart;
            if (count === 0) {
                return -1;
            }
            const token = ranges.length / 2;
            ranges.push(drawStart, count);
            return token;
        },
        flush(ctx: LayerRenderContext) {
            const vertexCount = verts.length / 2;
            const blocks = draws.length;
            ensureVertexBuffer(Math.max(vertexCount, 1));
            ensurePaintBuffer(Math.max(blocks, 1));
            device.queue.writeBuffer(globalBuffer, 0, new Float32Array([ctx.screenW, ctx.screenH, 0, 0]));
            if (vertexCount > 0) {
                device.queue.writeBuffer(vertexBuffer!, 0, new Float32Array(verts), 0, vertexCount * 2);
            }
            if (blocks > 0) {
                device.queue.writeBuffer(paintBuffer!, 0, new Float32Array(paintData), 0, blocks * PAINT_FLOATS);
            }
        },
        recordLayer(pass: GPURenderPassEncoder, token: number) {
            const drawStart = ranges[token * 2];
            const drawCount = ranges[token * 2 + 1];
            if (drawCount === 0) {
                return;
            }
            pass.setVertexBuffer(0, vertexBuffer!);
            pass.setStencilReference(0);
            for (let i = 0; i < drawCount; i++) {
                const d = draws[drawStart + i];
                if (d.stroke) {
                    // Union-stencil the stroke triangles, then cover once at uniform alpha.
                    pass.setPipeline(strokeStencilPipeline!);
                    pass.setBindGroup(0, stencilBindGroup);
                    pass.draw(d.fanCount, 1, d.fanFirst);
                    pass.setPipeline(coverPipeline);
                    pass.setBindGroup(0, coverBindGroup!, [d.paintIndex * PAINT_BYTES]);
                    pass.draw(d.coverCount, 1, d.coverFirst);
                    continue;
                }
                pass.setPipeline(stencilPipeline);
                pass.setBindGroup(0, stencilBindGroup);
                pass.draw(d.fanCount, 1, d.fanFirst);
                pass.setPipeline(coverPipeline);
                pass.setBindGroup(0, coverBindGroup!, [d.paintIndex * PAINT_BYTES]);
                pass.draw(d.coverCount, 1, d.coverFirst);
            }
        },
        dispose() {
            vertexBuffer?.destroy();
            paintBuffer?.destroy();
            globalBuffer.destroy();
        },
    };
}
