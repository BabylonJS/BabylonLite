// Player: feature-detects which renderers an animation needs, dynamically imports only
// those, then per frame walks layers in z-order, dispatching each to the renderer for its
// kind. All renderers record into one shared frame pass (frame.ts) so shape and image
// layers composite correctly. Pure functions over plain data; no scene/camera/light/mesh.

import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine.js";
import type { LottieFile, Prop } from "./lottie-raw.js";
import type { ParsedAnimation, ParsedLayer, Transform } from "./parse.js";
import type { LayerRenderContext, LayerRenderer } from "./layer-renderer.js";
import type { FrameTargets } from "./frame.js";
import { parseAnimation } from "./parse.js";
import { detectFeatures } from "./feature-detect.js";
import { sampleMulti, sampleScalar } from "./sample.js";
import { lottieTransform, multiply, type Mat2D } from "./matrix.js";
import { beginFrame, createFrameTargets, endFrame, ensureFrameTargets } from "./frame.js";

export interface LottiePlayer {
    engine: EngineContext;
    anim: ParsedAnimation;
    /** Active renderers keyed by Lottie layer kind. Only detected kinds are present. */
    renderers: Map<number, LayerRenderer>;
    targets: FrameTargets;
    /** Layer lookup by `ind`, for resolving parent transform chains. */
    byInd: Map<number, ParsedLayer>;
    /** Per-frame memo of each layer's local world matrix (parent chain applied, pre-global). */
    worldCache: Map<number, Mat2D>;
    // Per-frame ordered command list (renderer + token), rebuilt each frame in z-order.
    cmdRenderers: LayerRenderer[];
    cmdTokens: number[];
    // Transform scratch.
    a: number[];
    p: number[];
    s: number[];
}

/**
 * Create a player for a Lottie document. Async because it feature-detects the animation
 * and dynamically imports (and, for images, decodes) only the renderers it needs.
 */
export async function createLottiePlayer(engine: EngineContext, file: LottieFile): Promise<LottiePlayer> {
    const anim = parseAnimation(file);
    const features = detectFeatures(anim);
    const renderers = new Map<number, LayerRenderer>();

    // Gated dynamic imports: a shape-only file never fetches the image module, and vice versa.
    if (features.shapes) {
        // Strokes are a further-gated sub-feature: load the stroke-geometry module only when
        // the animation has visible strokes, then hand its generator to the fill renderer.
        const [{ createFillRenderer }, strokeGen] = await Promise.all([
            import("./fill-renderer.js"),
            features.strokes ? import("./stroke-geometry.js").then((m) => m.buildStrokePoints) : Promise.resolve(undefined),
        ]);
        renderers.set(4, createFillRenderer(engine, strokeGen));
    }
    if (features.images) {
        const { createImageRenderer } = await import("./image-renderer.js");
        renderers.set(2, await createImageRenderer(engine, anim.assets));
    }
    if (features.text) {
        const { createTextRenderer } = await import("./text-renderer.js");
        const textLayers = anim.layers.filter((l) => l.kind === 5);
        renderers.set(5, createTextRenderer(engine, textLayers));
    }

    const byInd = new Map<number, ParsedLayer>();
    for (const layer of anim.layers) {
        byInd.set(layer.ind, layer);
    }

    return {
        engine,
        anim,
        renderers,
        targets: createFrameTargets(),
        byInd,
        worldCache: new Map(),
        cmdRenderers: [],
        cmdTokens: [],
        a: [0, 0],
        p: [0, 0],
        s: [100, 100],
    };
}

function samplePoint(prop: Prop | undefined, frame: number, dx: number, dy: number, out: number[]): void {
    out[0] = dx;
    out[1] = dy;
    sampleMulti(prop, frame, out);
}

function transformMatrix(t: Transform, frame: number, a: number[], p: number[], s: number[]): Mat2D {
    samplePoint(t.a, frame, 0, 0, a);
    samplePoint(t.p, frame, 0, 0, p);
    samplePoint(t.s, frame, 100, 100, s);
    const r = sampleScalar(t.r, frame, 0);
    return lottieTransform(a, p, s, r);
}

/**
 * Resolve a layer's local world matrix (parent chain applied, before the global projection).
 * A child's transform is composed under its parent's: world = parentWorld × localTransform.
 * Lottie parenting inherits only the transform, not opacity. Memoized per frame via `worldCache`.
 */
function resolveWorld(pl: LottiePlayer, layer: ParsedLayer, frame: number, depth: number): Mat2D {
    const cached = pl.worldCache.get(layer.ind);
    if (cached) {
        return cached;
    }
    const local = transformMatrix(layer.transform, frame, pl.a, pl.p, pl.s);
    let world = local;
    // Guard against cycles / runaway depth in malformed files.
    if (layer.parent !== undefined && depth < 32) {
        const parent = pl.byInd.get(layer.parent);
        if (parent) {
            world = multiply(resolveWorld(pl, parent, frame, depth + 1), local);
        }
    }
    pl.worldCache.set(layer.ind, world);
    return world;
}

/** Render the animation at `frame` (comp frames) into the engine's swapchain. */
export function renderLottieFrame(pl: LottiePlayer, frame: number): void {
    const { engine, anim, renderers } = pl;
    const w = engine.canvas.width;
    const h = engine.canvas.height;
    const scale = Math.min(w / anim.width, h / anim.height);
    const ox = (w - anim.width * scale) * 0.5;
    const oy = (h - anim.height * scale) * 0.5;
    const global: Mat2D = [scale, 0, 0, scale, ox, oy];
    const ctx: LayerRenderContext = { frame, screenW: w, screenH: h };

    for (const r of renderers.values()) {
        r.beginFrame(ctx);
    }
    pl.cmdRenderers.length = 0;
    pl.cmdTokens.length = 0;
    pl.worldCache.clear();

    // Lottie renders layers back-to-front: iterate in reverse array order.
    for (let li = anim.layers.length - 1; li >= 0; li--) {
        const layer = anim.layers[li];
        if (frame < layer.ip || frame >= layer.op) {
            continue;
        }
        const renderer = renderers.get(layer.kind);
        if (!renderer) {
            continue;
        }
        const layerAlpha = sampleScalar(layer.transform.o, frame, 100) / 100;
        if (layerAlpha <= 0.0001) {
            continue;
        }
        const world = multiply(global, resolveWorld(pl, layer, frame, 0));
        const token = renderer.emitLayer(layer, world, layerAlpha, ctx);
        if (token < 0) {
            continue;
        }
        pl.cmdRenderers.push(renderer);
        pl.cmdTokens.push(token);
    }

    for (const r of renderers.values()) {
        r.flush(ctx);
    }

    ensureFrameTargets(engine, pl.targets, w, h);
    const swapView = engine._context.getCurrentTexture().createView();
    // Clip to the comp bounds: Lottie content beyond the composition rect is not shown
    // (lottie-web clips to the comp). Without this, shapes that extend past the comp edge
    // bleed into the letterbox margins.
    const sx = Math.max(0, Math.floor(ox));
    const sy = Math.max(0, Math.floor(oy));
    const scissor = {
        x: sx,
        y: sy,
        width: Math.min(w - sx, Math.ceil(anim.width * scale)),
        height: Math.min(h - sy, Math.ceil(anim.height * scale)),
    };
    const fp = beginFrame(engine, pl.targets, swapView, scissor);
    for (let i = 0; i < pl.cmdRenderers.length; i++) {
        pl.cmdRenderers[i].recordLayer(fp.pass, pl.cmdTokens[i]);
    }
    endFrame(engine, fp);
}
