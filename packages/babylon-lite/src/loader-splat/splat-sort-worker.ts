/** Splat sort worker.
 *
 *  Vite import: `import SortWorker from './splat-sort-worker.ts?worker&inline'`.
 *  The `?worker&inline` query keeps the bundled worker JS embedded as a base-64
 *  blob in the splat scene chunk — it adds zero bytes to any other scene
 *  because the whole `loader-splat/` module is dynamic-imported.
 *
 *  Protocol
 *  --------
 *  Init (once):  { positions: Float32Array, vertexCount: number }
 *                — buffer is transferred and retained on the worker side.
 *  Sort  (N×):   { view: Float32Array(16), depthMix: BigInt64Array }
 *                — depthMix is round-tripped via transferable; layout is
 *                  high-32 bits = packed depth, low-32 bits = splat index.
 *                  After sort, low-32 bits give the back-to-front order.
 *
 *  The sort key recipe matches BJS `_CreateWorker`: store a monotone-decreasing
 *  function of view-space Z in the high half so that `BigInt64Array.sort()`
 *  (which is numeric / signed) yields back-to-front order. */

let positions: Float32Array | null = null;
let vertexCount = 0;

self.onmessage = (e: MessageEvent) => {
    const data = e.data as { positions?: Float32Array; vertexCount?: number; view?: Float32Array; depthMix?: BigInt64Array };

    if (data.positions) {
        positions = data.positions;
        vertexCount = data.vertexCount ?? 0;
        return;
    }

    if (!positions || !data.view || !data.depthMix) {
        return;
    }

    const view = data.view;
    const depthMix = data.depthMix;
    const indices = new Uint32Array(depthMix.buffer);
    const floatMix = new Float32Array(depthMix.buffer);

    for (let j = 0; j < vertexCount; j++) {
        indices[2 * j] = j;
    }
    // High 32 bits hold the sort key; we use `10000 - z` so that nearer
    // splats (larger projected z) sort to the END of the array, i.e. drawn last
    // — back-to-front for additive alpha blending.
    for (let j = 0; j < vertexCount; j++) {
        floatMix[2 * j + 1] = 10000 - (view[2]! * positions[3 * j]! + view[6]! * positions[3 * j + 1]! + view[10]! * positions[3 * j + 2]!);
    }

    depthMix.sort();

    (self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }).postMessage({ depthMix }, [depthMix.buffer]);
};
