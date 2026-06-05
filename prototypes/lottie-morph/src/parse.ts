// Parse: walk a Lottie document's shape layers into a flat, plain-data draw list.
// We keep animatable values as raw props (sampled per frame); only the static
// gradient stops are pre-parsed. Strokes are intentionally ignored (this file's
// strokes are width 0). Nested sub-groups are flattened (single-level groups here).

import type { Asset, FontDef, Layer, LottieFile, Prop, ShapeItem } from "./lottie-raw.js";

export interface GradientStops {
    count: number;
    /** Stop offsets in [0,1], length `count`. */
    offsets: number[];
    /** Stop colors as [r,g,b,a] in [0,1], length `count`. */
    colors: number[][];
}

export interface SolidPaint {
    kind: "solid";
    /** rgba color prop (components 0–1). */
    color: Prop;
}

export interface GradientPaint {
    kind: "linear" | "radial";
    /** Gradient start point (shape-local). */
    start: Prop;
    /** Gradient end point (shape-local). */
    end: Prop;
    stops: GradientStops;
}

export interface StrokePaint {
    kind: "stroke";
    /** rgba color prop (components 0–1). */
    color: Prop;
    /** Stroke width prop (shape-local units). */
    width: Prop;
}

export type Paint = SolidPaint | GradientPaint | StrokePaint;

/** A rectangle primitive source (center, size, corner roundness). */
export interface RectSource {
    /** Center position. */
    p: Prop;
    /** Size [w, h]. */
    s: Prop;
    /** Corner roundness (radius). */
    r?: Prop;
}

/** An ellipse primitive source (center, size). */
export interface EllipseSource {
    /** Center position. */
    p: Prop;
    /** Size [w, h] (diameters). */
    s: Prop;
}

/** One contour of a (possibly compound) shape: a bezier path, a rect, or an ellipse. */
export interface Contour {
    path?: Prop;
    rect?: RectSource;
    ellipse?: EllipseSource;
}

/** Lottie transform fields (anchor, position, scale, rotation, opacity). */
export interface Transform {
    a?: Prop;
    p?: Prop;
    s?: Prop;
    r?: Prop;
    o?: Prop;
}

export interface DrawOp {
    /**
     * Contours filled together as ONE compound path. Multiple contours with opposite winding
     * (e.g. a glyph outline + its counter) produce holes via the nonzero winding rule — they
     * are stencilled together before a single cover pass.
     */
    contours: Contour[];
    /** The owning group's transform. */
    groupTransform: Transform;
    paint: Paint;
    /** Paint opacity (0–100), if any. */
    paintOpacity?: Prop;
}

/** A decoded reference to an image asset (resolved from a layer's `refId`). */
export interface ParsedImage {
    /** Index into `ParsedAnimation.assets`. */
    assetIndex: number;
    width: number;
    height: number;
}

/** A parsed text document (resolved to a CSS-ready font). */
export interface ParsedText {
    text: string;
    /** CSS font family (e.g. "Segoe UI"). */
    family: string;
    /** CSS font weight (e.g. 400, 600, 700). */
    weight: number;
    /** CSS font style ("normal" | "italic"). */
    style: string;
    /** Font size in px. */
    size: number;
    /** Fill color [r,g,b,a] in 0–1. */
    color: [number, number, number, number];
    /** Justify: 0 left, 1 right, 2 center. */
    justify: number;
    /** Letter spacing in px. */
    letterSpacing: number;
    /** Line height in px. */
    lineHeight: number;
    /** Box width (boxed/paragraph text wraps within this; undefined for point text). */
    boxW?: number;
    /** Box height. */
    boxH?: number;
    /** Box top-left X in layer-local space. */
    boxX?: number;
    /** Box top-left Y in layer-local space. */
    boxY?: number;
}

/** An image asset with its (possibly embedded) source URI. */
export interface ParsedAsset {
    id: string;
    width: number;
    height: number;
    /** Path or `data:` URI. */
    src: string;
}

export interface ParsedLayer {
    /** Lottie layer type (`4` shape, `2` image, `3` null/transform-only). Renderers dispatch on this. */
    kind: number;
    /** Layer index (`ind`), used to resolve parent references. */
    ind: number;
    /** Parent layer index, for transform chaining. */
    parent?: number;
    name: string;
    transform: Transform;
    ip: number;
    op: number;
    st: number;
    /** Shape draw ops in Lottie array order (render back-to-front == iterate in reverse). */
    ops: DrawOp[];
    /** Image reference, for image layers. */
    image?: ParsedImage;
    /** Text document, for text layers. */
    text?: ParsedText;
}

export interface ParsedAnimation {
    width: number;
    height: number;
    ip: number;
    op: number;
    fr: number;
    layers: ParsedLayer[];
    assets: ParsedAsset[];
}

function parseStops(g: { p: number; k: Prop }): GradientStops {
    const raw = (g.k.a === 1 ? (g.k.k as { s: number[] }[])[0].s : g.k.k) as number[];
    const count = g.p;
    const offsets: number[] = [];
    const colors: number[][] = [];
    for (let i = 0; i < count; i++) {
        offsets.push(raw[i * 4]);
        colors.push([raw[i * 4 + 1], raw[i * 4 + 2], raw[i * 4 + 3], 1]);
    }
    // Optional alpha stops follow the color stops as [offset, alpha] pairs.
    const alphaStart = count * 4;
    if (raw.length > alphaStart) {
        const alphaCount = Math.floor((raw.length - alphaStart) / 2);
        for (let i = 0; i < alphaCount && i < count; i++) {
            colors[i][3] = raw[alphaStart + i * 2 + 1];
        }
    }
    return { count, offsets, colors };
}

function parseGradient(it: ShapeItem): GradientPaint {
    return {
        kind: it.t === 2 ? "radial" : "linear",
        start: it.s as Prop,
        end: it.e as Prop,
        stops: parseStops(it.g as { p: number; k: Prop }),
    };
}

function walkGroup(items: ShapeItem[], ops: DrawOp[]): void {
    // A group's paths/rects combine into one compound shape that its fill(s) paint together.
    const contours: Contour[] = [];
    let transform: Transform = {};
    const paints: { paint: Paint; opacity?: Prop }[] = [];

    for (const it of items) {
        if (it.hd) {
            continue;
        }
        switch (it.ty) {
            case "gr":
                walkGroup(it.it ?? [], ops);
                break;
            case "sh":
                if (it.ks) {
                    contours.push({ path: it.ks });
                }
                break;
            case "rc":
                // Rect primitive: p center, s size, r corner roundness (ShapeItem.r is typed as fill rule).
                contours.push({ rect: { p: it.p as Prop, s: it.s as Prop, r: it.r as unknown as Prop | undefined } });
                break;
            case "el":
                // Ellipse primitive: p center, s size (diameters).
                contours.push({ ellipse: { p: it.p as Prop, s: it.s as Prop } });
                break;
            case "tr": {
                // On a transform item `r` is the rotation prop (ShapeItem.r is typed as the fill rule).
                const rotation = it.r as unknown as Prop | undefined;
                transform = { a: it.a, p: it.p, s: it.s, r: rotation, o: it.o };
                break;
            }
            case "fl":
                paints.push({ paint: { kind: "solid", color: it.c as Prop }, opacity: it.o });
                break;
            case "gf":
                paints.push({ paint: parseGradient(it), opacity: it.o });
                break;
            case "st":
                if (it.w) {
                    paints.push({ paint: { kind: "stroke", color: it.c as Prop, width: it.w }, opacity: it.o });
                }
                break;
            // "gs" (gradient strokes) not yet supported.
        }
    }

    if (contours.length > 0) {
        for (const pt of paints) {
            ops.push({ contours, groupTransform: transform, paint: pt.paint, paintOpacity: pt.opacity });
        }
    }
}

/** Derive a CSS weight + style from a Lottie font definition (name + style string). */
function fontWeightStyle(def: FontDef | undefined, fontName: string): { weight: number; style: string } {
    const style = (def?.fStyle ?? "").toLowerCase();
    const name = (def?.fName ?? fontName).toLowerCase();
    let weight = 400;
    if (/black|heavy/.test(style) || /black|heavy/.test(name)) {
        weight = 900;
    } else if (/semibold|demibold/.test(style) || /semibold|demibold/.test(name)) {
        weight = 600;
    } else if (/bold/.test(style) || /bold/.test(name)) {
        weight = 700;
    } else if (/medium/.test(style) || /medium/.test(name)) {
        weight = 500;
    } else if (/light/.test(style) || /light/.test(name)) {
        weight = 300;
    }
    const italic = /italic|oblique/.test(style) || /italic|oblique/.test(name);
    return { weight, style: italic ? "italic" : "normal" };
}

function parseText(layer: Layer, fonts: Map<string, FontDef>): ParsedText | undefined {
    const doc = layer.t?.d?.k?.[0]?.s;
    if (!doc) {
        return undefined;
    }
    const def = fonts.get(doc.f);
    const { weight, style } = fontWeightStyle(def, doc.f);
    const family = def?.fFamily?.split(",")[0]?.replace(/['"]/g, "").trim() || "sans-serif";
    const fc = doc.fc ?? [0, 0, 0];
    const size = doc.s ?? 16;
    const boxed = Array.isArray(doc.sz) && doc.sz[0] > 0;
    return {
        text: doc.t ?? "",
        family,
        weight,
        style,
        size,
        color: [fc[0], fc[1], fc[2], 1],
        justify: doc.j ?? 0,
        // Lottie tracking is 1/1000 em; convert to px letter spacing.
        letterSpacing: ((doc.tr ?? 0) / 1000) * size,
        lineHeight: doc.lh ?? size * 1.2,
        boxW: boxed ? doc.sz![0] : undefined,
        boxH: boxed ? doc.sz![1] : undefined,
        boxX: boxed && doc.ps ? doc.ps[0] : undefined,
        boxY: boxed && doc.ps ? doc.ps[1] : undefined,
    };
}

/** Build a static (non-animated) property holding a constant value. */
function staticProp(value: unknown): Prop {
    return { a: 0, k: value };
}

/** Parse a hex color string (#rgb / #rrggbb) into [r,g,b,a] in 0–1. */
function parseHexColor(hex: string): [number, number, number, number] {
    let h = hex.replace("#", "");
    if (h.length === 3) {
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

/** Synthesize a draw op for a solid layer: a `sw`×`sh` rect (top-left origin) filled with `sc`. */
function solidLayerOp(layer: Layer): DrawOp {
    const w = layer.sw ?? 0;
    const h = layer.sh ?? 0;
    const color = parseHexColor(layer.sc ?? "#000000");
    return {
        // Rect centered at (w/2, h/2) so its top-left is the layer origin (Lottie solid convention).
        contours: [{ rect: { p: staticProp([w / 2, h / 2]), s: staticProp([w, h]) } }],
        groupTransform: {},
        paint: { kind: "solid", color: staticProp(color) },
    };
}

function parseLayer(layer: Layer, assetIndex: Map<string, number>, assets: ParsedAsset[], fonts: Map<string, FontDef>): ParsedLayer {
    const ops: DrawOp[] = [];
    let image: ParsedImage | undefined;
    let text: ParsedText | undefined;
    if (layer.ty === 4 && layer.shapes) {
        walkGroup(layer.shapes, ops);
    } else if (layer.ty === 1) {
        // Solid layer: a full-size colored rectangle (rendered through the vector fill path).
        ops.push(solidLayerOp(layer));
    } else if (layer.ty === 2 && layer.refId !== undefined) {
        const idx = assetIndex.get(layer.refId);
        if (idx !== undefined) {
            image = { assetIndex: idx, width: assets[idx].width, height: assets[idx].height };
        }
    } else if (layer.ty === 5 && layer.t) {
        text = parseText(layer, fonts);
    }
    return {
        // Solid layers (ty 1) render through the vector fill path, so report them as kind 4.
        kind: layer.ty === 1 ? 4 : layer.ty,
        ind: layer.ind,
        parent: layer.parent,
        name: layer.nm ?? "",
        transform: layer.ks,
        ip: layer.ip,
        op: layer.op,
        st: layer.st ?? 0,
        ops,
        image,
        text,
    };
}

function parseAssets(raw: Asset[] | undefined): ParsedAsset[] {
    const assets: ParsedAsset[] = [];
    for (const a of raw ?? []) {
        assets.push({
            id: a.id,
            width: a.w ?? 0,
            height: a.h ?? 0,
            src: (a.u ?? "") + (a.p ?? ""),
        });
    }
    return assets;
}

/** Parse a Lottie document into a flat draw list. Keeps shape (`ty 4`), image (`ty 2`),
 *  text (`ty 5`), and null (`ty 3`, transform-only) layers. */
export function parseAnimation(file: LottieFile): ParsedAnimation {
    const assets = parseAssets(file.assets);
    const assetIndex = new Map<string, number>();
    for (let i = 0; i < assets.length; i++) {
        assetIndex.set(assets[i].id, i);
    }
    const fonts = new Map<string, FontDef>();
    for (const f of file.fonts?.list ?? []) {
        fonts.set(f.fName, f);
    }
    const layers: ParsedLayer[] = [];
    for (const layer of file.layers) {
        if (layer.ty === 4 && layer.shapes) {
            layers.push(parseLayer(layer, assetIndex, assets, fonts));
        } else if (layer.ty === 1) {
            // Solid layer (colored background rect).
            layers.push(parseLayer(layer, assetIndex, assets, fonts));
        } else if (layer.ty === 2 && layer.refId !== undefined) {
            layers.push(parseLayer(layer, assetIndex, assets, fonts));
        } else if (layer.ty === 5 && layer.t) {
            layers.push(parseLayer(layer, assetIndex, assets, fonts));
        } else if (layer.ty === 3) {
            // Null layer: no content, but kept so children can resolve it as a transform parent.
            layers.push(parseLayer(layer, assetIndex, assets, fonts));
        }
    }
    return { width: file.w, height: file.h, ip: file.ip, op: file.op, fr: file.fr, layers, assets };
}
