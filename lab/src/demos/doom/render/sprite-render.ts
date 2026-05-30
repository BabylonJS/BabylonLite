// Faithful DOOM sprite rendering, built on Babylon-Lite's facing billboards.
//
// Every visible mobj is one facing billboard: a camera-facing world-space quad
// whose anchor is the mobj origin. The shared SpriteStore atlas (one frame per
// placed patch, R = palette index, A = coverage) is wrapped in a lite
// `SpriteAtlas`, and a custom billboard fragment runs the same palette + COLORMAP
// path as the world so monsters/items get correct banded light diminishing.
//
// DOOM places a sprite's origin at the patch pivot (leftOffset, topOffset). The
// billboard `pivot` carries that anchor; horizontal mirroring is expressed with
// per-sprite `flipX` plus a mirrored pivot override, so the same atlas pixels
// serve both facings without duplicating rectangles.
//
// `cutout` blend mode writes depth, so sprites occlude (and are occluded by)
// walls and each other through the shared reverse-Z depth buffer.

import {
    addBillboardSpriteIndex,
    addFacingBillboardSystem,
    clearBillboardSprites,
    createBillboardCustomShader,
    createFacingBillboardSystem,
    type FacingBillboardSpriteSystem,
    type SceneContext,
    type Texture2D,
} from "babylon-lite";
import type { SpriteImage, SpriteStore } from "./sprites.js";

const DIST_PER_BAND = 224.0;

// Custom billboard fragment: palette-indexed sample → COLORMAP LUT with sector-light
// + view-distance banding, fullbright override, and a hard cutout discard.
const SPRITE_FRAGMENT = `let DIST_PER_BAND: f32 = ${DIST_PER_BAND.toFixed(1)};
let src = textureSample(atlasTex, atlasSamp, in.uv);
if (src.a < 0.5) { discard; }
let idx = floor(src.r * 255.0 + 0.5);
let sectorLight = in.tint.x * 255.0;
let fullbright = in.tint.y;
let baseRow = clamp(31.0 - floor(sectorLight / 8.0), 0.0, 31.0);
let distBand = floor(in.viewDist / DIST_PER_BAND);
var row = clamp(baseRow + distBand, 0.0, 31.0);
row = mix(row, 0.0, step(0.5, fullbright));
let lut = textureSample(colormapTex, colormapSamp, vec2<f32>((idx + 0.5) / 256.0, (row + 0.5) / 34.0));
return vec4<f32>(lut.rgb, 1.0);`;

/** A single mobj to draw this frame. */
export interface RenderSprite {
    /** Doom map X (world X). */
    x: number;
    /** Vertical origin (world Y / Doom z). */
    z: number;
    /** Doom map Y (world Z). */
    y: number;
    image: SpriteImage;
    /** Sector light 0..255. */
    light: number;
    fullbright: boolean;
}

export class SpriteRenderer {
    private system: FacingBillboardSpriteSystem | null = null;

    constructor(
        private readonly scene: SceneContext,
        private readonly store: SpriteStore,
        private readonly colormapTex: Texture2D
    ) {}

    private ensureSystem(): FacingBillboardSpriteSystem | null {
        if (this.system) return this.system;
        const atlas = this.store.spriteAtlas;
        if (!atlas) return null;
        const customShader = createBillboardCustomShader({
            fragment: SPRITE_FRAGMENT,
            extraTextures: [{ name: "colormap", texture: this.colormapTex }],
        });
        const system = createFacingBillboardSystem(atlas, { blendMode: "cutout", customShader, capacity: 256 });
        addFacingBillboardSystem(this.scene, system);
        this.system = system;
        return system;
    }

    /** Rebuilds the billboard set from the given visible sprites (call once/frame). */
    rebuild(sprites: RenderSprite[]): void {
        const system = this.ensureSystem();
        if (!system) return;
        clearBillboardSprites(system);
        for (const s of sprites) {
            const img = s.image;
            const aw = img.aw;
            const ah = img.ah;
            // DOOM origin sits at the patch pivot. Mirroring reflects the horizontal
            // pivot about the sprite centre so the flipped image still anchors correctly.
            const pivotX = img.mirror ? (aw - img.leftOffset) / aw : img.leftOffset / aw;
            const pivotY = img.topOffset / ah;
            addBillboardSpriteIndex(system, {
                position: [s.x, s.z, s.y],
                sizeWorld: [aw, ah],
                frame: img.frameIndex,
                pivot: [pivotX, pivotY],
                flipX: img.mirror,
                color: [s.light / 255, s.fullbright ? 1 : 0, 0, 1],
            });
        }
    }

    dispose(): void {
        if (this.system) {
            clearBillboardSprites(this.system);
            this.system = null;
        }
    }
}
