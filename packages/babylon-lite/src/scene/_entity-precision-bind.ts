import type { ScenePrecisionPolicy } from "./_scene-precision.js";
import type { MatrixAllocator } from "../math/_matrix-allocator.js";

/** @internal Any entity that owns matrix storage participates in precision binding.
 *  The bind helper writes `_boundPolicy` on first attach. Subsequent attaches
 *  to scenes on the same engine are no-ops; cross-engine attaches throw.
 *  Optional `_rebindAllocator` is invoked after first-bind so the entity can
 *  (re)allocate its matrix caches from the new allocator. */
export interface MatrixBindable {
    _boundPolicy?: ScenePrecisionPolicy | null;
    _rebindAllocator?: (allocator: MatrixAllocator) => void;
}

/** @internal Bind an entity to a scene's precision policy on first attach.
 *
 *  - First attach: sets `_boundPolicy`, invokes `_rebindAllocator` if present.
 *  - Reattach to the same engine (allocator reference equality): no-op.
 *  - Reattach to a different engine: throws a synchronous configuration error.
 *
 *  The error message MUST contain the substring "matrix-precision policy" —
 *  downstream tests/audits rely on this exact phrasing. */
export function bindEntityMatrixPolicy(entity: MatrixBindable, policy: ScenePrecisionPolicy): void {
    const prior = entity._boundPolicy;
    if (prior !== undefined && prior !== null) {
        if (prior.allocator === policy.allocator) {
            // Same-engine reattach is a no-op. Engine policy hasn't changed; cached storage is valid.
            return;
        }
        throw new Error(
            "Babylon Lite: cannot attach a matrix-owning entity to a scene whose engine has a different matrix-precision policy. " +
                "Create a new entity for the second engine instead of reusing one."
        );
    }
    entity._boundPolicy = policy;
    entity._rebindAllocator?.(policy.allocator);
}
