// Block-specific math, lazily imported by the blocks that need it so core
// `math/` (Vec3-centric, minimal) stays untouched and non-interactivity scenes
// stay byte-identical (GUIDANCE pillar: tree-shakable, no core bloat).
//
// Ops here are TYPE-GENERIC: they branch on the runtime value shape
// (number | FgInteger | Vec2 | Vec3 | Vec4), mirroring BJS's per-component
// handling of the same `math/*` ops. Add more dispatchers (fgSub, fgMul, …) in
// Phase 3 as the math block library broadens.

import { fgInt, isFgInt } from "./custom-types/fg-integer.js";
import type { FgValue, Vec2 } from "./types.js";
import type { Vec3, Vec4 } from "../math/types.js";

function isVec2(v: unknown): v is Vec2 {
    return typeof v === "object" && v !== null && "x" in v && "y" in v && !("z" in v);
}
function isVec3(v: unknown): v is Vec3 {
    return typeof v === "object" && v !== null && "x" in v && "y" in v && "z" in v && !("w" in v);
}
function isVec4(v: unknown): v is Vec4 {
    return typeof v === "object" && v !== null && "x" in v && "y" in v && "z" in v && "w" in v;
}

/** Type-generic component-wise add. Matches BJS `math/add` semantics across
 *  number, FlowGraphInteger, and Vector2/3/4. Mixed/unknown shapes fall back to
 *  numeric addition of `0` (BJS returns the left operand on type mismatch; we
 *  keep it total to avoid throwing inside the runtime loop). */
export function fgAdd(a: FgValue, b: FgValue): FgValue {
    if (isFgInt(a) && isFgInt(b)) {
        return fgInt(a.value + b.value);
    }
    if (typeof a === "number" && typeof b === "number") {
        return a + b;
    }
    if (isVec4(a) && isVec4(b)) {
        return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z, w: a.w + b.w };
    }
    if (isVec3(a) && isVec3(b)) {
        return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
    }
    if (isVec2(a) && isVec2(b)) {
        return { x: a.x + b.x, y: a.y + b.y };
    }
    return a;
}
