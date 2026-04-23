/** Node-block registry — lazy-init dispatch table.
 *
 *  Each block lives in its own module under `./blocks/`. The table maps the
 *  BJS `className` (plus an optional discriminator like `_uniform`/`_attribute`
 *  for InputBlocks) to a dynamic-import loader. Rollup analyzes each literal
 *  `import()` and emits one chunk per block, so scenes only pay for blocks
 *  their snippet actually uses.
 *
 *  GUIDANCE §4: the table itself is built lazily — there is no module-level
 *  `Map` allocation, which would defeat tree-shaking for scenes that never
 *  touch NME at all.
 */

import type { BlockEmitter } from "./node-types.js";

export type BlockLoader = () => Promise<{ emitter: BlockEmitter }>;

let _table: Map<string, BlockLoader> | null = null;

function getTable(): Map<string, BlockLoader> {
    if (_table) {
        return _table;
    }
    const t = new Map<string, BlockLoader>();
    // Block loaders are added here as they land. Phase 1a–1e populate this list.
    // Each entry MUST use a literal string import so Rollup splits per-block chunks.
    _table = t;
    return t;
}

/** Resolve a block emitter by key. Throws if the block is not registered. */
export async function loadBlockEmitter(key: string): Promise<BlockEmitter> {
    const loader = getTable().get(key);
    if (!loader) {
        throw new Error(`NodeMaterial: no emitter registered for block "${key}"`);
    }
    const mod = await loader();
    return mod.emitter;
}

/** Returns true if a key is registered (used by tests). */
export function hasBlockEmitter(key: string): boolean {
    return getTable().has(key);
}
