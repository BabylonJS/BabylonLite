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
import type { Quat, Vec3, Vec4 } from "../math/types.js";
import { crossVec3 } from "../math/cross-vec3.js";
import { dotVec3 } from "../math/dot-vec3.js";

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

// ─── Phase 3 helpers ────────────────────────────────────────────────────────

/** Numeric payload of a number / FlowGraphInteger; `NaN` for other shapes. */
function num(v: FgValue): number {
    if (isFgInt(v)) {
        return v.value;
    }
    return typeof v === "number" ? v : NaN;
}
/** Numeric payload, or 0 when the value is not scalar (combine inputs). */
function num0(v: FgValue): number {
    const n = num(v);
    return Number.isNaN(n) && !(typeof v === "number") ? 0 : n;
}
/** True for number | FlowGraphInteger (the comparison/bitwise scalar domain). */
function isNumeric(v: FgValue): boolean {
    return typeof v === "number" || isFgInt(v);
}
/** Coerce to a 32-bit signed int payload (integer bitwise ops). */
function toI(v: FgValue): number {
    return (isFgInt(v) ? v.value : (v as number)) | 0;
}

/** Component-wise ternary across number / FlowGraphInteger / Vector2-4. */
function ternary(a: FgValue, b: FgValue, c: FgValue, f: (x: number, y: number, z: number) => number): FgValue {
    if (isFgInt(a) && isFgInt(b) && isFgInt(c)) {
        return fgInt(f(a.value, b.value, c.value));
    }
    if (typeof a === "number" && typeof b === "number" && typeof c === "number") {
        return f(a, b, c);
    }
    if (isVec4(a) && isVec4(b) && isVec4(c)) {
        return { x: f(a.x, b.x, c.x), y: f(a.y, b.y, c.y), z: f(a.z, b.z, c.z), w: f(a.w, b.w, c.w) };
    }
    if (isVec3(a) && isVec3(b) && isVec3(c)) {
        return { x: f(a.x, b.x, c.x), y: f(a.y, b.y, c.y), z: f(a.z, b.z, c.z) };
    }
    if (isVec2(a) && isVec2(b) && isVec2(c)) {
        return { x: f(a.x, b.x, c.x), y: f(a.y, b.y, c.y) };
    }
    return a;
}

// ─── Arithmetic (binary) ────────────────────────────────────────────────────

/** Component-wise minimum (glTF `math/min`). */
export function fgMin(a: FgValue, b: FgValue): FgValue {
    return binary(a, b, Math.min);
}
/** Component-wise maximum (glTF `math/max`). */
export function fgMax(a: FgValue, b: FgValue): FgValue {
    return binary(a, b, Math.max);
}
/** Component-wise power, a^b (glTF `math/pow`). */
export function fgPow(a: FgValue, b: FgValue): FgValue {
    return binary(a, b, Math.pow);
}
/** Component-wise atan2(a, b) where a = y, b = x (glTF `math/atan2`). */
export function fgAtan2(a: FgValue, b: FgValue): FgValue {
    return binary(a, b, Math.atan2);
}

// ─── Unary scalar / component-wise ──────────────────────────────────────────

/** Component-wise negation, −a (glTF `math/neg`). */
export function fgNeg(a: FgValue): FgValue {
    return unary(a, (x) => -x);
}
/** Component-wise sign (glTF `math/sign`). */
export function fgSign(a: FgValue): FgValue {
    return unary(a, Math.sign);
}
/** Component-wise ceil (glTF `math/ceil`). */
export function fgCeil(a: FgValue): FgValue {
    return unary(a, Math.ceil);
}
/** Component-wise round, half toward +∞ (glTF `math/round`). */
export function fgRound(a: FgValue): FgValue {
    return unary(a, Math.round);
}
/** Component-wise truncation toward zero (glTF `math/trunc`). */
export function fgTrunc(a: FgValue): FgValue {
    return unary(a, Math.trunc);
}
/** Component-wise fractional part, `x − floor(x)` (glTF `math/fract`). */
export function fgFract(a: FgValue): FgValue {
    return unary(a, (x) => x - Math.floor(x));
}
/** Component-wise clamp to [0, 1] (glTF `math/saturate`). */
export function fgSaturate(a: FgValue): FgValue {
    return unary(a, (x) => Math.min(Math.max(x, 0), 1));
}
/** Component-wise square root (glTF `math/sqrt`). */
export function fgSqrt(a: FgValue): FgValue {
    return unary(a, Math.sqrt);
}
/** Component-wise cube root (glTF `math/cbrt`). */
export function fgCbrt(a: FgValue): FgValue {
    return unary(a, Math.cbrt);
}
/** Component-wise e^x (glTF `math/exp`). */
export function fgExp(a: FgValue): FgValue {
    return unary(a, Math.exp);
}
/** Component-wise natural log (glTF `math/log`). */
export function fgLog(a: FgValue): FgValue {
    return unary(a, Math.log);
}
/** Component-wise base-2 log (glTF `math/log2`). */
export function fgLog2(a: FgValue): FgValue {
    return unary(a, Math.log2);
}
/** Component-wise base-10 log (glTF `math/log10`). */
export function fgLog10(a: FgValue): FgValue {
    return unary(a, Math.log10);
}
/** Component-wise degrees → radians (glTF `math/rad`). */
export function fgDegToRad(a: FgValue): FgValue {
    return unary(a, (x) => (x * Math.PI) / 180);
}
/** Component-wise radians → degrees (glTF `math/deg`). */
export function fgRadToDeg(a: FgValue): FgValue {
    return unary(a, (x) => (x * 180) / Math.PI);
}
/** Component-wise sine (glTF `math/sin`). */
export function fgSin(a: FgValue): FgValue {
    return unary(a, Math.sin);
}
/** Component-wise cosine (glTF `math/cos`). */
export function fgCos(a: FgValue): FgValue {
    return unary(a, Math.cos);
}
/** Component-wise tangent (glTF `math/tan`). */
export function fgTan(a: FgValue): FgValue {
    return unary(a, Math.tan);
}
/** Component-wise arcsine (glTF `math/asin`). */
export function fgAsin(a: FgValue): FgValue {
    return unary(a, Math.asin);
}
/** Component-wise arccosine (glTF `math/acos`). */
export function fgAcos(a: FgValue): FgValue {
    return unary(a, Math.acos);
}
/** Component-wise arctangent (glTF `math/atan`). */
export function fgAtan(a: FgValue): FgValue {
    return unary(a, Math.atan);
}
/** Component-wise hyperbolic sine (glTF `math/sinh`). */
export function fgSinh(a: FgValue): FgValue {
    return unary(a, Math.sinh);
}
/** Component-wise hyperbolic cosine (glTF `math/cosh`). */
export function fgCosh(a: FgValue): FgValue {
    return unary(a, Math.cosh);
}
/** Component-wise hyperbolic tangent (glTF `math/tanh`). */
export function fgTanh(a: FgValue): FgValue {
    return unary(a, Math.tanh);
}
/** Component-wise inverse hyperbolic sine (glTF `math/asinh`). */
export function fgAsinh(a: FgValue): FgValue {
    return unary(a, Math.asinh);
}
/** Component-wise inverse hyperbolic cosine (glTF `math/acosh`). */
export function fgAcosh(a: FgValue): FgValue {
    return unary(a, Math.acosh);
}
/** Component-wise inverse hyperbolic tangent (glTF `math/atanh`). */
export function fgAtanh(a: FgValue): FgValue {
    return unary(a, Math.atanh);
}

// ─── Interpolation (ternary) ────────────────────────────────────────────────

/** Linear blend `(1 − t)·a + t·b` (glTF `math/mix`). Supports vector a/b with a
 *  scalar `t`, mirroring BJS's component-wise interpolation. */
export function fgMix(a: FgValue, b: FgValue, t: FgValue): FgValue {
    const tv = num(t);
    if (Number.isNaN(tv)) {
        return a;
    }
    const lerp = (x: number, y: number): number => (1 - tv) * x + tv * y;
    if (isVec4(a) && isVec4(b)) {
        return { x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z), w: lerp(a.w, b.w) };
    }
    if (isVec3(a) && isVec3(b)) {
        return { x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z) };
    }
    if (isVec2(a) && isVec2(b)) {
        return { x: lerp(a.x, b.x), y: lerp(a.y, b.y) };
    }
    if (isNumeric(a) && isNumeric(b)) {
        const r = lerp(num(a), num(b));
        return isFgInt(a) && isFgInt(b) ? fgInt(r) : r;
    }
    return ternary(a, b, t, (x, y, z) => (1 - z) * x + z * y);
}

// ─── Comparison (→ boolean) ─────────────────────────────────────────────────

/** Strict equality (glTF `math/eq`): exact, zero-tolerance, component-wise for
 *  vectors/quaternions; mismatched types compare unequal (BJS behaviour). */
export function fgEq(a: FgValue, b: FgValue): boolean {
    if (isFgInt(a) && isFgInt(b)) {
        return a.value === b.value;
    }
    if (isFgInt(a) !== isFgInt(b)) {
        return false;
    }
    if (isVec4(a) && isVec4(b)) {
        return a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;
    }
    if (isVec3(a) && isVec3(b)) {
        return a.x === b.x && a.y === b.y && a.z === b.z;
    }
    if (isVec2(a) && isVec2(b)) {
        return a.x === b.x && a.y === b.y;
    }
    return a === b;
}
/** Scalar `a ≤ b` (glTF `math/le`); false for non-scalar shapes. */
export function fgLe(a: FgValue, b: FgValue): boolean {
    return isNumeric(a) && isNumeric(b) ? num(a) <= num(b) : false;
}
/** Scalar `a > b` (glTF `math/gt`); false for non-scalar shapes. */
export function fgGt(a: FgValue, b: FgValue): boolean {
    return isNumeric(a) && isNumeric(b) ? num(a) > num(b) : false;
}
/** Scalar `a ≥ b` (glTF `math/ge`); false for non-scalar shapes. */
export function fgGe(a: FgValue, b: FgValue): boolean {
    return isNumeric(a) && isNumeric(b) ? num(a) >= num(b) : false;
}
/** Scalar NaN test (glTF `math/isNaN`); false for non-scalar shapes. */
export function fgIsNaN(a: FgValue): boolean {
    return isNumeric(a) ? Number.isNaN(num(a)) : false;
}
/** Scalar non-finite test — ±Infinity and NaN (glTF `math/isInf`). */
export function fgIsInf(a: FgValue): boolean {
    return isNumeric(a) ? !Number.isFinite(num(a)) : false;
}

/** Random value in `[min, max)` (glTF `math/random`); defaults to `[0, 1)`. */
export function fgRandom(min = 0, max = 1): number {
    return Math.random() * (max - min) + min;
}

// ─── Boolean / bitwise (type-dispatched) ────────────────────────────────────

/** Logical/bitwise AND (glTF `math/and`): `&&` for booleans, `&` for ints. */
export function fgAnd(a: FgValue, b: FgValue): FgValue {
    if (typeof a === "boolean" && typeof b === "boolean") {
        return a && b;
    }
    if (typeof a === "number" && typeof b === "number") {
        return a & b;
    }
    if (isFgInt(a) && isFgInt(b)) {
        return fgInt(a.value & b.value);
    }
    return a;
}
/** Logical/bitwise OR (glTF `math/or`): `||` for booleans, `|` for ints. */
export function fgOr(a: FgValue, b: FgValue): FgValue {
    if (typeof a === "boolean" && typeof b === "boolean") {
        return a || b;
    }
    if (typeof a === "number" && typeof b === "number") {
        return a | b;
    }
    if (isFgInt(a) && isFgInt(b)) {
        return fgInt(a.value | b.value);
    }
    return a;
}
/** Logical/bitwise XOR (glTF `math/xor`): `a≠b` for booleans, `^` for ints. */
export function fgXor(a: FgValue, b: FgValue): FgValue {
    if (typeof a === "boolean" && typeof b === "boolean") {
        return a !== b;
    }
    if (typeof a === "number" && typeof b === "number") {
        return a ^ b;
    }
    if (isFgInt(a) && isFgInt(b)) {
        return fgInt(a.value ^ b.value);
    }
    return a;
}
/** Logical/bitwise NOT (glTF `math/not`): `!a` for booleans, `~a` for ints. */
export function fgNot(a: FgValue): FgValue {
    if (typeof a === "boolean") {
        return !a;
    }
    if (typeof a === "number") {
        return ~a;
    }
    if (isFgInt(a)) {
        return fgInt(~a.value);
    }
    return a;
}

// ─── Integer bitwise ────────────────────────────────────────────────────────

/** Logical left shift, `a << b` (glTF `math/lsl`). */
export function fgLsl(a: FgValue, b: FgValue): FgValue {
    return fgInt(toI(a) << toI(b));
}
/** Arithmetic right shift, `a >> b`, sign-extending (glTF `math/asr`). */
export function fgAsr(a: FgValue, b: FgValue): FgValue {
    return fgInt(toI(a) >> toI(b));
}
/** Count leading zero bits over 32 bits (glTF `math/clz`). */
export function fgClz(a: FgValue): FgValue {
    return fgInt(Math.clz32(toI(a)));
}
/** Count trailing zero bits; 32 for input 0 (glTF `math/ctz`). */
export function fgCtz(a: FgValue): FgValue {
    const n = toI(a);
    return fgInt(n ? 31 - Math.clz32(n & -n) : 32);
}
/** Population count — number of set bits over 32 bits (glTF `math/popcnt`). */
export function fgPopcnt(a: FgValue): FgValue {
    let n = toI(a) >>> 0;
    let r = 0;
    while (n) {
        r += n & 1;
        n >>>= 1;
    }
    return fgInt(r);
}

// ─── Vector ops ─────────────────────────────────────────────────────────────

/** Euclidean length of a Vector2/3/4 or Quaternion (glTF `math/length`). */
export function fgLength(a: FgValue): number {
    if (isVec2(a)) {
        return Math.hypot(a.x, a.y);
    }
    if (isVec4(a)) {
        return Math.hypot(a.x, a.y, a.z, a.w);
    }
    if (isVec3(a)) {
        return Math.hypot(a.x, a.y, a.z);
    }
    return 0;
}
/** Normalize a Vector2/3/4 or Quaternion to unit length; zero-vector stays zero
 *  (glTF `math/normalize`). */
export function fgNormalize(a: FgValue): FgValue {
    const len = fgLength(a);
    const s = len === 0 ? 0 : 1 / len;
    if (isVec2(a)) {
        return { x: a.x * s, y: a.y * s };
    }
    if (isVec4(a)) {
        return { x: a.x * s, y: a.y * s, z: a.z * s, w: a.w * s };
    }
    if (isVec3(a)) {
        return { x: a.x * s, y: a.y * s, z: a.z * s };
    }
    return a;
}
/** Dot product of two same-size vectors/quaternions (glTF `math/dot`). */
export function fgDot(a: FgValue, b: FgValue): number {
    if (isVec2(a) && isVec2(b)) {
        return a.x * b.x + a.y * b.y;
    }
    if (isVec4(a) && isVec4(b)) {
        return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    }
    if (isVec3(a) && isVec3(b)) {
        return dotVec3(a, b);
    }
    return 0;
}
/** 3D cross product (glTF `math/cross`); Vector3 only. */
export function fgCross(a: FgValue, b: FgValue): FgValue {
    if (isVec3(a) && isVec3(b)) {
        return crossVec3(a, b);
    }
    return a;
}
/** Rotate a Vector2 by `angle` radians, CCW (glTF `math/rotate2D`). */
export function fgRotate2D(a: FgValue, angle: FgValue): FgValue {
    if (isVec2(a) && typeof angle === "number") {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        return { x: c * a.x - s * a.y, y: s * a.x + c * a.y };
    }
    return a;
}
/** Rotate a Vector3 by a Quaternion (glTF `math/rotate3D`). */
export function fgRotate3D(a: FgValue, q: FgValue): FgValue {
    if (isVec3(a) && isVec4(q)) {
        const { x, y, z } = a;
        const tx = 2 * (q.y * z - q.z * y);
        const ty = 2 * (q.z * x - q.x * z);
        const tz = 2 * (q.x * y - q.y * x);
        return {
            x: x + q.w * tx + (q.y * tz - q.z * ty),
            y: y + q.w * ty + (q.z * tx - q.x * tz),
            z: z + q.w * tz + (q.x * ty - q.y * tx),
        };
    }
    return a;
}

// ─── Combine / extract (vectors) ────────────────────────────────────────────

/** Combine three scalars into a Vector3 (glTF `math/combine3`). */
export function fgCombine3(a: FgValue, b: FgValue, c: FgValue): Vec3 {
    return { x: num0(a), y: num0(b), z: num0(c) };
}
/** Combine four scalars into a Vector4 (glTF `math/combine4`). */
export function fgCombine4(a: FgValue, b: FgValue, c: FgValue, d: FgValue): Vec4 {
    return { x: num0(a), y: num0(b), z: num0(c), w: num0(d) };
}
/** Extract a Vector3's components (glTF `math/extract3`) → `[x, y, z]`. */
export function fgExtract3(v: FgValue): [number, number, number] {
    if (isVec3(v) || isVec4(v)) {
        return [v.x, v.y, v.z];
    }
    return [0, 0, 0];
}
/** Extract a Vector4's / Quaternion's components (glTF `math/extract4`). */
export function fgExtract4(v: FgValue): [number, number, number, number] {
    if (isVec4(v)) {
        return [v.x, v.y, v.z, v.w];
    }
    return [0, 0, 0, 0];
}

/** Quaternion conjugate, `(−x, −y, −z, w)` (glTF `math/quatConjugate`). */
export function fgConjugate(a: FgValue): FgValue {
    if (isVec4(a)) {
        return { x: -a.x, y: -a.y, z: -a.z, w: a.w } as Quat;
    }
    return a;
}
