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

/** Apply a component-wise binary op across number / FlowGraphInteger / Vector2-4.
 *  Mixed/unknown shapes return the left operand (BJS behaviour) so the runtime
 *  loop never throws. */
function binary(a: FgValue, b: FgValue, f: (x: number, y: number) => number): FgValue {
    if (isFgInt(a) && isFgInt(b)) {
        return fgInt(f(a.value, b.value));
    }
    if (typeof a === "number" && typeof b === "number") {
        return f(a, b);
    }
    if (isVec4(a) && isVec4(b)) {
        return { x: f(a.x, b.x), y: f(a.y, b.y), z: f(a.z, b.z), w: f(a.w, b.w) };
    }
    if (isVec3(a) && isVec3(b)) {
        return { x: f(a.x, b.x), y: f(a.y, b.y), z: f(a.z, b.z) };
    }
    if (isVec2(a) && isVec2(b)) {
        return { x: f(a.x, b.x), y: f(a.y, b.y) };
    }
    return a;
}

/** Apply a component-wise unary op across number / FlowGraphInteger / Vector2-4. */
function unary(a: FgValue, f: (x: number) => number): FgValue {
    if (isFgInt(a)) {
        return fgInt(f(a.value));
    }
    if (typeof a === "number") {
        return f(a);
    }
    if (isVec4(a)) {
        return { x: f(a.x), y: f(a.y), z: f(a.z), w: f(a.w) };
    }
    if (isVec3(a)) {
        return { x: f(a.x), y: f(a.y), z: f(a.z) };
    }
    if (isVec2(a)) {
        return { x: f(a.x), y: f(a.y) };
    }
    return a;
}

/** Type-generic component-wise add (glTF `math/add`). */
export function fgAdd(a: FgValue, b: FgValue): FgValue {
    return binary(a, b, (x, y) => x + y);
}

/** Type-generic component-wise subtract, a − b (glTF `math/sub`). */
export function fgSub(a: FgValue, b: FgValue): FgValue {
    return binary(a, b, (x, y) => x - y);
}

/** Type-generic component-wise (Hadamard) multiply (glTF `math/mul`, which is
 *  per-component for vectors — `useMatrixPerComponent` in BJS). */
export function fgMul(a: FgValue, b: FgValue): FgValue {
    return binary(a, b, (x, y) => x * y);
}

/** Type-generic component-wise divide, a ÷ b (glTF `math/div`). */
export function fgDiv(a: FgValue, b: FgValue): FgValue {
    return binary(a, b, (x, y) => x / y);
}

/** Type-generic component-wise remainder, a − b·trunc(a/b) (glTF `math/rem`,
 *  matching JS `%`). */
export function fgRem(a: FgValue, b: FgValue): FgValue {
    return binary(a, b, (x, y) => x % y);
}

/** Type-generic component-wise absolute value (glTF `math/abs`). */
export function fgAbs(a: FgValue): FgValue {
    return unary(a, Math.abs);
}

/** Type-generic component-wise floor (glTF `math/floor`). */
export function fgFloor(a: FgValue): FgValue {
    return unary(a, Math.floor);
}

/** Type-generic component-wise clamp, min(max(a, b), c) (glTF `math/clamp`,
 *  b = min, c = max). */
export function fgClamp(a: FgValue, b: FgValue, c: FgValue): FgValue {
    const lo = binary(a, b, (x, y) => Math.max(x, y));
    return binary(lo, c, (x, y) => Math.min(x, y));
}

/** Scalar less-than, `a < b` → boolean (glTF `math/lt`). Operates on the numeric
 *  payload of number / FlowGraphInteger; returns false for non-scalar shapes. */
export function fgLt(a: FgValue, b: FgValue): boolean {
    const x = isFgInt(a) ? a.value : a;
    const y = isFgInt(b) ? b.value : b;
    if (typeof x === "number" && typeof y === "number") {
        return x < y;
    }
    return false;
}

/** Combine two scalars into a Vector2 (glTF `math/combine2`). */
export function fgCombine2(a: FgValue, b: FgValue): Vec2 {
    const x = isFgInt(a) ? a.value : (a as number);
    const y = isFgInt(b) ? b.value : (b as number);
    return { x: x ?? 0, y: y ?? 0 };
}

/** Extract a Vector2's components (glTF `math/extract2`) → `[x, y]`. */
export function fgExtract2(v: FgValue): [number, number] {
    if (isVec2(v) || isVec3(v) || isVec4(v)) {
        return [v.x, v.y];
    }
    return [0, 0];
}
