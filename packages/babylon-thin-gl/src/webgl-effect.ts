import type { WebGLContext } from "./webgl-context.js";
import { compileShader, getLinkError, isLinkComplete, linkProgram } from "./webgl-shader.js";
import { bindTexture, type GLTexture } from "./webgl-texture.js";

export interface GLEffectOptions {
    name: string;
    /** GLSL ES 3.00 source, ready for `gl.shaderSource`. */
    vertexSource: string;
    /** GLSL ES 3.00 source, ready for `gl.shaderSource`. */
    fragmentSource: string;
    /** Declared uniform names. Locations are resolved during readiness
     *  finalization. Names not declared here are legal but allocate cache
     *  slots lazily on first setter use. */
    uniformNames: readonly string[];
    /** Declared sampler names, in unit-assignment order. Each gets a fixed
     *  texture unit assigned during readiness finalization, and
     *  `gl.uniform1i(loc, unit)` is called exactly once per program lifetime
     *  (re-run after `webglcontextrestored`). */
    samplerNames: readonly string[];
    /** Default `["position"]`. The first attribute is bound to location 0 via
     *  `gl.bindAttribLocation(program, 0, name)` BEFORE link, so the shared
     *  fullscreen-quad VAO always feeds the same location. */
    attributeNames?: readonly string[];
    /** Optional `#define` block. Each unique `defines` string must be paired
     *  with the same vertex/fragment source via a separate `createEffect` call —
     *  the package does NOT cache compiled variants. */
    defines?: string;
}

export interface GLEffect {
    readonly name: string;
    readonly options: GLEffectOptions;
    program: WebGLProgram;
    _vs: WebGLShader;
    _fs: WebGLShader;
    /** Resolved during readiness finalization. Missing names map to `null` —
     *  setters with a `null` location are silent no-ops (matches Babylon). */
    uniformLocations: { [name: string]: WebGLUniformLocation | null };
    /** Fixed unit assignment for declared samplers, index into
     *  `_state.boundTextures`. */
    samplerUnits: { [name: string]: number };
    /** True once `gl.uniform1i(samplerLoc, unit)` has been issued for every
     *  declared sampler. Cleared on context-lost so finalization re-runs. */
    _samplersAssigned: boolean;
    attributeLocations: { [name: string]: number };
    /** Last-UPLOADED scalar floats. A setter that skips the upload must NOT
     *  update this — otherwise a later real set with the same value would
     *  incorrectly elide and the GPU would keep stale data. */
    readonly _lastF1: { [name: string]: number };
    /** Last-UPLOADED vector floats (vec2/vec3/vec4). Plain `number[]` (NOT
     *  `Float32Array`) so values like `0.1` compare equal across frames. */
    readonly _lastVec: { [name: string]: number[] };
    readonly _lastI1: { [name: string]: number };
    isReady: boolean;
    _compileError: string | null;
    _disposed: boolean;
    /** Callbacks fired exactly once on the first transition to ready. */
    readonly _onCompiled: ((effect: GLEffect) => void)[];
    /** Replay closure for context-restore. Re-compiles + relinks into a fresh
     *  `program` field. Finalization happens lazily on the next `isEffectReady`
     *  poll. */
    _restore: (ctx: WebGLContext) => void;
}

/** Compile + link a new effect. Does NOT block on link completion — `isReady`
 *  starts false; consumers poll `isEffectReady` (typically from their render
 *  callback) to drive finalization. */
export function createEffect(ctx: WebGLContext, options: GLEffectOptions): GLEffect {
    const attribs = options.attributeNames ?? ["position"];
    const gl = ctx.gl;

    const compileErr: (string | null)[] = [null];
    const finalVS = applyDefines(options.vertexSource, options.defines);
    const finalFS = applyDefines(options.fragmentSource, options.defines);

    const vs = compileShader(gl, finalVS, gl.VERTEX_SHADER, compileErr);
    if (vs === null) {
        throw new Error(`thin-gl: ${options.name} vertex compile failed: ${compileErr[0] ?? "unknown"}`);
    }
    const fs = compileShader(gl, finalFS, gl.FRAGMENT_SHADER, compileErr);
    if (fs === null) {
        gl.deleteShader(vs);
        throw new Error(`thin-gl: ${options.name} fragment compile failed: ${compileErr[0] ?? "unknown"}`);
    }
    const program = linkProgram(gl, vs, fs, attribs);
    if (program === null) {
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        throw new Error(`thin-gl: ${options.name} program allocation failed`);
    }

    const effect: GLEffect = {
        name: options.name,
        options,
        program,
        _vs: vs,
        _fs: fs,
        uniformLocations: {},
        samplerUnits: {},
        _samplersAssigned: false,
        attributeLocations: {},
        _lastF1: {},
        _lastVec: {},
        _lastI1: {},
        isReady: false,
        _compileError: null,
        _disposed: false,
        _onCompiled: [],
        _restore: () => {},
    };

    effect._restore = (target: WebGLContext): void => {
        const g = target.gl;
        const newVS = compileShader(g, applyDefines(options.vertexSource, options.defines), g.VERTEX_SHADER, [null]);
        const newFS = compileShader(g, applyDefines(options.fragmentSource, options.defines), g.FRAGMENT_SHADER, [null]);
        if (newVS === null || newFS === null) {
            effect._compileError = "context-restore: shader compile failed";
            return;
        }
        const newProg = linkProgram(g, newVS, newFS, attribs);
        if (newProg === null) {
            g.deleteShader(newVS);
            g.deleteShader(newFS);
            effect._compileError = "context-restore: program allocation failed";
            return;
        }
        effect.program = newProg;
        effect._vs = newVS;
        effect._fs = newFS;
        effect.isReady = false;
        effect._samplersAssigned = false;
        effect.uniformLocations = {};
        effect.attributeLocations = {};
        effect._compileError = null;
    };

    ctx._effects.push(effect);
    return effect;
}

/** Poll the link state and, on first success, run finalization (uniform-
 *  location resolution + one-shot sampler-unit `uniform1i` assignment +
 *  `_onCompiled` callbacks). Returns `true` once the effect is usable. */
export function isEffectReady(ctx: WebGLContext, effect: GLEffect): boolean {
    if (effect.isReady) {
        return true;
    }
    if (effect._disposed || ctx._isLost || ctx._disposed) {
        return false;
    }
    if (effect._compileError !== null) {
        return false;
    }
    if (!isLinkComplete(ctx.gl, effect.program, ctx.caps.parallelShaderCompile)) {
        return false;
    }
    const linkErr = getLinkError(ctx.gl, effect.program);
    if (linkErr !== null) {
        effect._compileError = linkErr;
        console.error(`thin-gl: ${effect.name} link failed:`, linkErr);
        return false;
    }
    finalizeEffect(ctx, effect);
    return true;
}

/** Resolves uniform/attribute locations, binds the program (cached), and
 *  issues the one-time `gl.uniform1i(samplerLoc, unit)` per declared sampler. */
function finalizeEffect(ctx: WebGLContext, effect: GLEffect): void {
    const gl = ctx.gl;
    const program = effect.program;
    for (const name of effect.options.uniformNames) {
        effect.uniformLocations[name] = gl.getUniformLocation(program, name);
    }
    const attribs = effect.options.attributeNames ?? ["position"];
    for (const name of attribs) {
        effect.attributeLocations[name] = gl.getAttribLocation(program, name);
    }
    // Switch to this program via the cached helper so _state.currentProgram
    // stays consistent — no raw gl.useProgram outside useEffect.
    useEffect(ctx, effect);
    let unit = 0;
    for (const name of effect.options.samplerNames) {
        const loc = gl.getUniformLocation(program, name);
        if (loc !== null) {
            gl.uniform1i(loc, unit);
        }
        effect.samplerUnits[name] = unit;
        unit++;
    }
    effect._samplersAssigned = true;
    effect.isReady = true;
    // Fire and clear the one-shot ready callbacks.
    const cbs = effect._onCompiled.slice();
    effect._onCompiled.length = 0;
    for (const cb of cbs) {
        try {
            cb(effect);
        } catch (err) {
            console.error(`thin-gl: ${effect.name} onCompiled callback threw`, err);
        }
    }
}

/** Fires `cb` synchronously if the effect is already ready; otherwise queues
 *  it for the next finalization. */
export function executeWhenCompiled(ctx: WebGLContext, effect: GLEffect, cb: (e: GLEffect) => void): void {
    if (isEffectReady(ctx, effect)) {
        cb(effect);
        return;
    }
    effect._onCompiled.push(cb);
}

export function disposeEffect(ctx: WebGLContext, effect: GLEffect): void {
    if (effect._disposed) {
        return;
    }
    effect._disposed = true;
    effect.isReady = false;
    const i = ctx._effects.indexOf(effect);
    if (i !== -1) {
        ctx._effects.splice(i, 1);
    }
    if (!ctx._isLost && !ctx._disposed) {
        ctx.gl.deleteProgram(effect.program);
        ctx.gl.deleteShader(effect._vs);
        ctx.gl.deleteShader(effect._fs);
    }
    if (ctx._state.currentProgram === effect.program) {
        ctx._state.currentProgram = null;
    }
    effect._onCompiled.length = 0;
}

/** Cached `gl.useProgram`. No-op when the effect is not ready or already current. */
export function useEffect(ctx: WebGLContext, effect: GLEffect): void {
    if (ctx._isLost || ctx._disposed || effect._disposed) {
        return;
    }
    if (ctx._state.currentProgram === effect.program) {
        return;
    }
    ctx.gl.useProgram(effect.program);
    ctx._state.currentProgram = effect.program;
}

/* ────────────────────────────  cached setters  ────────────────────────────
 *
 * Each setter has the shape:
 *   1. bail when context lost / effect not ready (no cache write)
 *   2. lookup uniform location; bail on null (no cache write)
 *   3. compare against last-UPLOADED value; bail on equality
 *   4. write to cache, issue gl.uniform*
 *
 * Step 3's comparison is intentionally bit-equal (===) — NaN inputs re-upload
 * every frame because `NaN !== NaN`, which is the correct safety net for
 * caller bugs.
 */

export function setEffectFloat(ctx: WebGLContext, effect: GLEffect, name: string, x: number): void {
    if (ctx._isLost || !effect.isReady) {
        return;
    }
    const loc = effect.uniformLocations[name];
    if (loc === null || loc === undefined) {
        return;
    }
    if (effect._lastF1[name] === x) {
        return;
    }
    effect._lastF1[name] = x;
    ctx.gl.uniform1f(loc, x);
}

export function setEffectFloat2(ctx: WebGLContext, effect: GLEffect, name: string, x: number, y: number): void {
    if (ctx._isLost || !effect.isReady) {
        return;
    }
    const loc = effect.uniformLocations[name];
    if (loc === null || loc === undefined) {
        return;
    }
    let v = effect._lastVec[name];
    if (v !== undefined && v[0] === x && v[1] === y) {
        return;
    }
    if (v === undefined) {
        v = [x, y];
        effect._lastVec[name] = v;
    } else {
        v[0] = x;
        v[1] = y;
    }
    ctx.gl.uniform2f(loc, x, y);
}

export function setEffectFloat3(ctx: WebGLContext, effect: GLEffect, name: string, x: number, y: number, z: number): void {
    if (ctx._isLost || !effect.isReady) {
        return;
    }
    const loc = effect.uniformLocations[name];
    if (loc === null || loc === undefined) {
        return;
    }
    let v = effect._lastVec[name];
    if (v !== undefined && v[0] === x && v[1] === y && v[2] === z) {
        return;
    }
    if (v === undefined) {
        v = [x, y, z];
        effect._lastVec[name] = v;
    } else {
        v[0] = x;
        v[1] = y;
        v[2] = z;
    }
    ctx.gl.uniform3f(loc, x, y, z);
}

export function setEffectFloat4(ctx: WebGLContext, effect: GLEffect, name: string, x: number, y: number, z: number, w: number): void {
    if (ctx._isLost || !effect.isReady) {
        return;
    }
    const loc = effect.uniformLocations[name];
    if (loc === null || loc === undefined) {
        return;
    }
    let v = effect._lastVec[name];
    if (v !== undefined && v[0] === x && v[1] === y && v[2] === z && v[3] === w) {
        return;
    }
    if (v === undefined) {
        v = [x, y, z, w];
        effect._lastVec[name] = v;
    } else {
        v[0] = x;
        v[1] = y;
        v[2] = z;
        v[3] = w;
    }
    ctx.gl.uniform4f(loc, x, y, z, w);
}

export function setEffectColor3(ctx: WebGLContext, effect: GLEffect, name: string, c: { r: number; g: number; b: number }): void {
    setEffectFloat3(ctx, effect, name, c.r, c.g, c.b);
}

export function setEffectColor4(ctx: WebGLContext, effect: GLEffect, name: string, c: { r: number; g: number; b: number; a: number }): void {
    setEffectFloat4(ctx, effect, name, c.r, c.g, c.b, c.a);
}

export function setEffectInt(ctx: WebGLContext, effect: GLEffect, name: string, x: number): void {
    if (ctx._isLost || !effect.isReady) {
        return;
    }
    const loc = effect.uniformLocations[name];
    if (loc === null || loc === undefined) {
        return;
    }
    if (effect._lastI1[name] === x) {
        return;
    }
    effect._lastI1[name] = x;
    ctx.gl.uniform1i(loc, x);
}

/** Bind a texture to the sampler's pre-assigned unit (§4.4). NO `gl.uniform1i`
 *  is issued — that was done exactly once per program lifetime during
 *  finalization. This is the key win over Babylon's `Effect.setTexture` which
 *  re-issues the sampler binding on every call. */
export function setEffectTexture(ctx: WebGLContext, effect: GLEffect, samplerName: string, tex: GLTexture): void {
    if (ctx._isLost || !effect.isReady) {
        return;
    }
    const unit = effect.samplerUnits[samplerName];
    if (unit === undefined) {
        return;
    }
    bindTexture(ctx, unit, tex);
}

/* ────────────────────────────  internal helpers  ──────────────────────────── */

/** Inject `options.defines` between the `#version`/precision header and the
 *  user shader body. Supports a `// __DEFINES__` marker (preferred — keeps the
 *  runtime regex-free, per spec §6.2) OR auto-detects the end of the leading
 *  preprocessor / precision lines. */
function applyDefines(source: string, defines: string | undefined): string {
    if (defines === undefined || defines.length === 0) {
        return source;
    }
    const marker = "// __DEFINES__";
    const idx = source.indexOf(marker);
    if (idx !== -1) {
        return source.slice(0, idx) + defines + source.slice(idx + marker.length);
    }
    // Fallback: insert after the last `precision` line (or after `#version`).
    const lines = source.split("\n");
    let insertAt = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) {
            continue;
        }
        const trimmed = line.trim();
        if (trimmed.startsWith("#version") || trimmed.startsWith("precision ")) {
            insertAt = i + 1;
        }
    }
    lines.splice(insertAt, 0, defines);
    return lines.join("\n");
}
