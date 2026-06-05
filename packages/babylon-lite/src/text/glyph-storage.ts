/** GlyphStorage — opaque, multi-curve-set bundle of glyph outlines plus their packed GPU
 *  atlases. A single storage can hold an arbitrary number of curve-sets (one per font);
 *  each curve-set gets its own atlas. Shared by reference across any number of `TextData`s
 *  that need the same glyph catalog.
 *
 *  Lifetime is caller-owned (matches `Texture2D` semantics):
 *    - `createGlyphStorage(initial?)` allocates a fresh storage, optionally seeded with
 *      one or more curve-sets.
 *    - `updateGlyphStorage(storage, curveSetId, curves)` adds glyphs to the named
 *      curve-set, creating it lazily if it doesn't exist yet. Glyph ids already present
 *      are skipped.
 *    - `disposeGlyphStorage(storage)` releases every atlas owned by the storage. The
 *      caller must ensure no `TextData` is still drawing from it — using a disposed
 *      storage is undefined behavior. Idempotent.
 */

import type { CurveSetId, GlyphCurves } from "./public-types.js";
import type { GlyphStorage, GlyphStorageCurveSet } from "./internal.js";
import { createSharedAtlas, packAppendGlyph } from "./slug-pack.js";
import { disposeSharedAtlasGpu } from "./_gpu/slug-textures.js";

/** Build a `GlyphStorage`. If `initial` is provided, each curve-set is packed into its
 *  own atlas synchronously. The passed inner maps are *adopted* by the storage — the
 *  caller must not mutate them directly afterward (use `updateGlyphStorage` instead). */
export function createGlyphStorage(initial?: Map<CurveSetId, Map<number, GlyphCurves>>): GlyphStorage {
    const _curveSets = new Map<CurveSetId, GlyphStorageCurveSet>();
    if (initial) {
        for (const [curveSetId, curves] of initial) {
            _curveSets.set(curveSetId, makeCurveSet(curves));
        }
    }
    return { _curveSets } as unknown as GlyphStorage;
}

/** Add glyphs to the named curve-set, creating it if it doesn't exist yet. Glyph ids
 *  already present in the curve-set are skipped (the existing outline + atlas slot wins).
 *  Safe to call between frames: the atlas grows in place and the next render uploads the
 *  new glyphs. */
export function updateGlyphStorage(storage: GlyphStorage, curveSetId: CurveSetId, curves: ReadonlyMap<number, GlyphCurves>): void {
    let cs = storage._curveSets.get(curveSetId);
    if (!cs) {
        cs = makeCurveSet(new Map());
        storage._curveSets.set(curveSetId, cs);
    }
    for (const [glyphId, glyph] of curves) {
        if (cs.curves.has(glyphId)) {
            continue;
        }
        cs.curves.set(glyphId, glyph);
        cs.atlas.glyphSlots.set(glyphId, packAppendGlyph(cs.atlas, glyph));
    }
}

/** Release every GPU atlas owned by `storage`. Idempotent. The caller is responsible for
 *  ensuring no `TextData` is still drawing from this storage. */
export function disposeGlyphStorage(storage: GlyphStorage): void {
    for (const cs of storage._curveSets.values()) {
        disposeSharedAtlasGpu(cs.atlas);
    }
    storage._curveSets.clear();
}

function makeCurveSet(curves: Map<number, GlyphCurves>): GlyphStorageCurveSet {
    const atlas = createSharedAtlas();
    for (const [glyphId, glyph] of curves) {
        atlas.glyphSlots.set(glyphId, packAppendGlyph(atlas, glyph));
    }
    return { curves, atlas };
}
