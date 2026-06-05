// Feature detection: decide which gated renderer modules an animation needs, BEFORE any
// of them are imported. The player uses this to dynamically import only the renderers a
// given file actually exercises — so a shapes-only file never bundles the image path, and
// vice versa. This is the runtime half of "pay only for what you use".

import type { ParsedAnimation } from "./parse.js";

export interface LottieFeatures {
    /** Shape layers with drawable ops → needs the vector (stencil-then-cover) renderer. */
    shapes: boolean;
    /** Image layers → needs the textured-quad renderer. */
    images: boolean;
    /** Visible strokes → needs the gated stroke-geometry module. */
    strokes: boolean;
    /** Text layers → needs the gated text renderer. */
    text: boolean;
}

export function detectFeatures(anim: ParsedAnimation): LottieFeatures {
    let shapes = false;
    let images = false;
    let strokes = false;
    let text = false;
    for (const layer of anim.layers) {
        if (layer.kind === 4 && layer.ops.length > 0) {
            shapes = true;
            for (const op of layer.ops) {
                if (op.paint.kind === "stroke") {
                    strokes = true;
                }
            }
        } else if (layer.kind === 2 && layer.image) {
            images = true;
        } else if (layer.kind === 5 && layer.text && layer.text.text.length > 0) {
            text = true;
        }
    }
    return { shapes, images, strokes, text };
}
