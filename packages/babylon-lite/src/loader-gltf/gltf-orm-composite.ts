/**
 * glTF ORM texture compositing.
 *
 * Dynamically imported by loaders ONLY when a material has separate
 * metallic-roughness and occlusion bitmaps that must be packed into a single
 * ORM texture (R=occlusion, G=roughness, B=metallic).
 *
 * Kept in its own module so scenes whose materials already ship packed ORM
 * (or no occlusion at all) don't pay for the OffscreenCanvas compositing path.
 */

/** Composite separate MR + occlusion bitmaps into a single ORM bitmap.
 *  Output channel layout: R=occlusion (from occ.R), G=roughness (from mr.G), B=metallic (from mr.B).
 *  The MR bitmap's resolution is kept; occlusion is drawn scaled to match. */
export async function compositeOrm(mrBitmap: ImageBitmap, occBitmap: ImageBitmap): Promise<ImageBitmap> {
    const w = mrBitmap.width;
    const h = mrBitmap.height;

    const c1 = new OffscreenCanvas(w, h);
    const x1 = c1.getContext("2d")!;
    x1.drawImage(mrBitmap, 0, 0, w, h);
    const d1 = x1.getImageData(0, 0, w, h);

    const c2 = new OffscreenCanvas(w, h);
    const x2 = c2.getContext("2d")!;
    x2.drawImage(occBitmap, 0, 0, w, h);
    const d2 = x2.getImageData(0, 0, w, h);

    for (let j = 0; j < d1.data.length; j += 4) {
        d1.data[j] = d2.data[j]!;
    }
    x1.putImageData(d1, 0, 0);
    return createImageBitmap(c1);
}
