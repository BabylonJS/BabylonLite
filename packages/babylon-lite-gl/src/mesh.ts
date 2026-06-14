/**
 * Sub-entry: indexed meshes, dynamic vertex/index buffers, and hardware
 * instancing.
 *
 * Dynamic-importable via `import { ... } from "@babylonjs/lite-gl/mesh"` so
 * consumers that only render the fullscreen quad / sprites don't pull the mesh
 * code into their bundles.
 *
 * This is the lite-gl equivalent of Babylon's `ThinEngine.createVertexBuffer` /
 * `createIndexBuffer` / `_releaseBuffer` / `bindIndexBuffer` /
 * `bindInstancesBuffer` / `unbindInstanceAttributes` / `drawElementsType`. The
 * attribute binder reproduces Babylon's instancing semantics EXACTLY, including
 * the `computeStride = false → stride 0` "sliding window" used by ShapeBuilder's
 * tape buffers (consecutive instances read overlapping vec4 windows) and the
 * `divisor === undefined → 1` default.
 *
 * The mesh path runs on the DEFAULT (null) VAO — every buffer/attribute op binds
 * `gl.bindVertexArray(null)` first, so it never corrupts the quad / sprite VAOs.
 * Vertex and index buffers retain their CPU data and re-upload automatically on
 * `webglcontextrestored`.
 */
import type { GLEngineContext } from "./context.js";
import { getEffectAttributeLocation, type GLEffect } from "./effect.js";

/** GL `gl.ARRAY_BUFFER`. */
const ARRAY_BUFFER = 0x8892;
/** GL `gl.ELEMENT_ARRAY_BUFFER`. */
const ELEMENT_ARRAY_BUFFER = 0x8893;
/** GL `gl.STATIC_DRAW`. */
const STATIC_DRAW = 0x88e4;
/** GL `gl.DYNAMIC_DRAW`. */
const DYNAMIC_DRAW = 0x88e8;
/** GL `gl.FLOAT`. */
const FLOAT = 0x1406;
/** GL `gl.TRIANGLES`. */
const TRIANGLES = 0x0004;
/** GL `gl.UNSIGNED_SHORT`. */
const UNSIGNED_SHORT = 0x1403;
/** GL `gl.UNSIGNED_INT`. */
const UNSIGNED_INT = 0x1405;

/** A GPU vertex buffer holding interleaved float vertex data. The lite-gl
 *  counterpart of Babylon's `DataBuffer` for vertex data. */
export interface GLVertexBuffer {
    /** The live `WebGLBuffer`. Swapped on `webglcontextrestored`. */
    handle: WebGLBuffer;
    /** Size of the GL buffer in bytes. */
    byteLength: number;
    /** @internal */
    _disposed: boolean;
    /** @internal Delete the underlying GL buffer. */
    _deleteGpu: (gl: WebGL2RenderingContext) => void;
    /** @internal Re-create + re-upload the retained CPU data into a fresh handle. */
    _restore: (engine: GLEngineContext) => void;
    /** @internal Retained CPU data for context-restore replay (the creation /
     *  last full-buffer upload). */
    _data: Float32Array;
    /** @internal `true` for `DYNAMIC_DRAW` (updated via `updateVertexBuffer`). */
    _dynamic: boolean;
}

/** A GPU index buffer. The lite-gl counterpart of Babylon's `DataBuffer` for
 *  index data. */
export interface GLIndexBuffer {
    /** The live `WebGLBuffer`. Swapped on `webglcontextrestored`. */
    handle: WebGLBuffer;
    /** Number of indices. */
    count: number;
    /** `true` for 32-bit (`Uint32Array`) indices, `false` for 16-bit. */
    is32Bits: boolean;
    /** @internal */
    _disposed: boolean;
    /** @internal Delete the underlying GL buffer. */
    _deleteGpu: (gl: WebGL2RenderingContext) => void;
    /** @internal Re-create + re-upload the retained CPU data into a fresh handle. */
    _restore: (engine: GLEngineContext) => void;
    /** @internal Retained CPU data for context-restore replay. */
    _data: Uint16Array | Uint32Array;
}

/**
 * Describes one vertex attribute fed from a buffer — the lite-gl equivalent of
 * Babylon's `InstancingAttributeInfo`. Pass an array of these to
 * {@link bindAttributes}.
 */
export interface GLAttributeDescriptor {
    /** Attribute name; resolved to a location via the effect when `index` is
     *  omitted (`Effect.getAttributeLocationByName`). */
    name?: string;
    /** Explicit attribute location. When set, overrides the `name` lookup. */
    index?: number;
    /** Number of components, 1–4. */
    size: number;
    /** Byte offset of this attribute's first element within the buffer. Default 0. */
    offset?: number;
    /**
     * Per-instance vertex divisor. **Omitted/`undefined` → `1` (instanced)**,
     * matching Babylon's `bindInstancesBuffer`. Pass `0` explicitly for a
     * per-vertex attribute (e.g. the base mesh position).
     */
    divisor?: number;
    /** GL component type. Default `gl.FLOAT`. */
    type?: GLenum;
    /** Normalize fixed-point integer data to `[0,1]`/`[-1,1]`. Default `false`. */
    normalized?: boolean;
}

/* ────────────────────────────────  buffers  ──────────────────────────────── */

/**
 * Create a GPU vertex buffer from interleaved float data.
 *
 * @param engine - The engine.
 * @param data - The vertex data. Retained by reference for context-restore — do
 *  not mutate it in place; use {@link updateVertexBuffer} to change contents.
 * @param dynamic - Hint that the buffer will be updated frequently
 *  (`DYNAMIC_DRAW`). Default `false` (`STATIC_DRAW`).
 * @returns The new {@link GLVertexBuffer}.
 */
export function createVertexBuffer(engine: GLEngineContext, data: Float32Array, dynamic = false): GLVertexBuffer {
    const gl = engine.gl;
    const handle = gl.createBuffer();
    if (handle === null) {
        throw new Error("lite-gl: gl.createBuffer returned null (vertex buffer)");
    }
    const vb: GLVertexBuffer = {
        handle,
        byteLength: data.byteLength,
        _data: data,
        _dynamic: dynamic,
        _disposed: false,
        _deleteGpu: () => {},
        _restore: () => {},
    };
    vb._deleteGpu = (g: WebGL2RenderingContext): void => {
        g.deleteBuffer(vb.handle);
    };
    vb._restore = (target: GLEngineContext): void => {
        const g = target.gl;
        const fresh = g.createBuffer();
        if (fresh === null) {
            return;
        }
        vb.handle = fresh;
        bindArrayBufferRaw(target, fresh);
        g.bufferData(ARRAY_BUFFER, vb._data, vb._dynamic ? DYNAMIC_DRAW : STATIC_DRAW);
    };
    bindArrayBufferRaw(engine, handle);
    gl.bufferData(ARRAY_BUFFER, data, dynamic ? DYNAMIC_DRAW : STATIC_DRAW);
    engine._buffers.push(vb);
    return vb;
}

/**
 * Upload new contents into (part of) a vertex buffer via `bufferSubData`. A
 * full-buffer update from offset 0 also refreshes the retained CPU data used
 * for context-restore.
 *
 * @param engine - The engine.
 * @param vb - The vertex buffer to update.
 * @param data - The new float data.
 * @param dstByteOffset - Destination byte offset within the buffer. Default 0.
 */
export function updateVertexBuffer(engine: GLEngineContext, vb: GLVertexBuffer, data: Float32Array, dstByteOffset = 0): void {
    if (engine._isLost || engine._disposed || vb._disposed) {
        return;
    }
    bindArrayBufferRaw(engine, vb.handle);
    engine.gl.bufferSubData(ARRAY_BUFFER, dstByteOffset, data);
    if (dstByteOffset === 0 && data.byteLength >= vb.byteLength) {
        vb._data = data;
        vb.byteLength = data.byteLength;
    }
}

/**
 * Create a GPU index buffer. `Uint16Array` → 16-bit indices, `Uint32Array` →
 * 32-bit. Binds the default VAO first so it never corrupts the quad / sprite
 * VAO element bindings.
 *
 * @param engine - The engine.
 * @param data - The index data. Retained by reference for context-restore.
 * @returns The new {@link GLIndexBuffer}.
 */
export function createIndexBuffer(engine: GLEngineContext, data: Uint16Array | Uint32Array): GLIndexBuffer {
    const gl = engine.gl;
    const handle = gl.createBuffer();
    if (handle === null) {
        throw new Error("lite-gl: gl.createBuffer returned null (index buffer)");
    }
    const is32 = data instanceof Uint32Array;
    const ib: GLIndexBuffer = {
        handle,
        count: data.length,
        is32Bits: is32,
        _data: data,
        _disposed: false,
        _deleteGpu: () => {},
        _restore: () => {},
    };
    ib._deleteGpu = (g: WebGL2RenderingContext): void => {
        g.deleteBuffer(ib.handle);
    };
    ib._restore = (target: GLEngineContext): void => {
        const g = target.gl;
        const fresh = g.createBuffer();
        if (fresh === null) {
            return;
        }
        ib.handle = fresh;
        bindDefaultVao(target);
        g.bindBuffer(ELEMENT_ARRAY_BUFFER, fresh);
        target._state.boundElementBuffer = fresh;
        g.bufferData(ELEMENT_ARRAY_BUFFER, ib._data, STATIC_DRAW);
    };
    bindDefaultVao(engine);
    gl.bindBuffer(ELEMENT_ARRAY_BUFFER, handle);
    engine._state.boundElementBuffer = handle;
    gl.bufferData(ELEMENT_ARRAY_BUFFER, data, STATIC_DRAW);
    engine._buffers.push(ib);
    return ib;
}

/** Dispose a vertex or index buffer (delete the GL buffer + unregister). Clears
 *  the array/element-buffer cache slot if it pointed at this buffer. Idempotent. */
export function disposeBuffer(engine: GLEngineContext, buffer: GLVertexBuffer | GLIndexBuffer): void {
    if (buffer._disposed) {
        return;
    }
    buffer._disposed = true;
    const i = engine._buffers.indexOf(buffer);
    if (i !== -1) {
        engine._buffers.splice(i, 1);
    }
    const s = engine._state;
    if (!engine._isLost && !engine._disposed) {
        engine.gl.deleteBuffer(buffer.handle);
    }
    if (s.boundArrayBuffer === buffer.handle) {
        s.boundArrayBuffer = null;
    }
    if (s.boundElementBuffer === buffer.handle) {
        s.boundElementBuffer = null;
    }
}

/* ──────────────────────────────  binding + draw  ──────────────────────────── */

/**
 * Bind an index buffer as the current element-array buffer (on the default
 * VAO). Cached. The lite-gl equivalent of Babylon's `_bindIndexBufferWithCache`.
 *
 * @param engine - The engine.
 * @param ib - The index buffer to bind.
 */
export function bindIndexBuffer(engine: GLEngineContext, ib: GLIndexBuffer): void {
    if (engine._isLost || engine._disposed || ib._disposed) {
        return;
    }
    bindDefaultVao(engine);
    const s = engine._state;
    if (s.boundElementBuffer === ib.handle) {
        return;
    }
    engine.gl.bindBuffer(ELEMENT_ARRAY_BUFFER, ib.handle);
    s.boundElementBuffer = ib.handle;
}

/**
 * Configure vertex attributes from `vb`, reproducing Babylon's
 * `bindInstancesBuffer` exactly. For each descriptor: resolves the location
 * (explicit `index` or via the effect), enables the attribute array, issues
 * `vertexAttribPointer`, and sets the vertex divisor (`undefined → 1`). Every
 * touched location is tracked so {@link unbindInstanceAttributes} can reset its
 * divisor afterwards.
 *
 * `computeStride` controls the GL stride passed to `vertexAttribPointer`:
 * - `false` (default) → stride `0`: each attribute is independently tightly
 *   packed. Combined with overlapping `offset`s this yields the "sliding window"
 *   ShapeBuilder uses for distance-field tape buffers.
 * - `true` → stride = Σ(`size`·4 bytes): interleaved per-vertex/per-instance.
 *
 * Runs on the default (null) VAO — never corrupts the quad / sprite VAOs.
 * No-op on a lost/disposed context or before the effect is ready.
 *
 * @param engine - The engine.
 * @param vb - The buffer supplying the attribute data.
 * @param descriptors - The attribute layout.
 * @param effect - The effect whose attribute locations resolve unnamed indices.
 * @param computeStride - See above. Default `false`.
 */
export function bindAttributes(engine: GLEngineContext, vb: GLVertexBuffer, descriptors: readonly GLAttributeDescriptor[], effect: GLEffect, computeStride = false): void {
    if (engine._isLost || engine._disposed || vb._disposed || !effect.isReady) {
        return;
    }
    const gl = engine.gl;
    const s = engine._state;
    bindDefaultVao(engine);
    bindArrayBufferRaw(engine, vb.handle);

    let stride = 0;
    if (computeStride) {
        for (let i = 0; i < descriptors.length; i++) {
            stride += (descriptors[i] as GLAttributeDescriptor).size * 4;
        }
    }

    for (let i = 0; i < descriptors.length; i++) {
        const d = descriptors[i] as GLAttributeDescriptor;
        const loc = d.index !== undefined ? d.index : d.name !== undefined ? getEffectAttributeLocation(engine, effect, d.name) : -1;
        if (loc < 0) {
            continue;
        }
        if (!s.enabledAttribs[loc]) {
            gl.enableVertexAttribArray(loc);
            s.enabledAttribs[loc] = true;
        }
        gl.vertexAttribPointer(loc, d.size, d.type ?? FLOAT, d.normalized ?? false, stride, d.offset ?? 0);
        gl.vertexAttribDivisor(loc, d.divisor === undefined ? 1 : d.divisor);
        s.instanceLocations.push(loc);
    }
}

/**
 * Reset the vertex divisor of every attribute touched by {@link bindAttributes}
 * back to 0 — the lite-gl equivalent of Babylon's `unbindInstanceAttributes`.
 * Call after an instanced draw so a following non-instanced draw is not skewed.
 * No-op on a lost/disposed context.
 *
 * @param engine - The engine.
 */
export function unbindInstanceAttributes(engine: GLEngineContext): void {
    if (engine._isLost || engine._disposed) {
        return;
    }
    const gl = engine.gl;
    const locs = engine._state.instanceLocations;
    for (let i = 0; i < locs.length; i++) {
        gl.vertexAttribDivisor(locs[i] as number, 0);
    }
    locs.length = 0;
}

/**
 * Draw indexed triangles from `ib` — the lite-gl equivalent of Babylon's
 * `drawElementsType` (triangle fill mode). When `instanceCount > 0` issues
 * `drawElementsInstanced`, otherwise `drawElements`. No-op on a lost/disposed
 * context or when no program is current.
 *
 * @param engine - The engine.
 * @param ib - The index buffer (also bound as a side-effect, cached).
 * @param indexCount - Number of indices to draw.
 * @param indexStart - First index offset (in indices, not bytes). Default 0.
 * @param instanceCount - Instance count for instanced draws. Default 0
 *  (non-instanced).
 */
export function drawIndexed(engine: GLEngineContext, ib: GLIndexBuffer, indexCount: number, indexStart = 0, instanceCount = 0): void {
    if (engine._isLost || engine._disposed || ib._disposed) {
        return;
    }
    if (engine._state.currentProgram === null) {
        return;
    }
    bindIndexBuffer(engine, ib);
    const gl = engine.gl;
    const type = ib.is32Bits ? UNSIGNED_INT : UNSIGNED_SHORT;
    const byteOffset = indexStart * (ib.is32Bits ? 4 : 2);
    if (instanceCount > 0) {
        gl.drawElementsInstanced(TRIANGLES, indexCount, type, byteOffset, instanceCount);
    } else {
        gl.drawElements(TRIANGLES, indexCount, type, byteOffset);
    }
}

/* ────────────────────────────  internal helpers  ──────────────────────────── */

/** Bind the default (null) VAO if not already bound. The mesh path lives here so
 *  it never disturbs the quad / sprite VAO state. Binding a VAO restores ITS
 *  element-array binding, so the element-buffer cache is forgotten on the
 *  switch (the next `bindIndexBuffer` re-binds). */
function bindDefaultVao(engine: GLEngineContext): void {
    const s = engine._state;
    if (s.boundVao !== null) {
        engine.gl.bindVertexArray(null);
        s.boundVao = null;
        s.boundElementBuffer = null;
    }
}

/** Cached `gl.bindBuffer(ARRAY_BUFFER, …)`. ARRAY_BUFFER binding is global (not
 *  VAO state), so this cache is coherent across VAO switches. */
function bindArrayBufferRaw(engine: GLEngineContext, handle: WebGLBuffer): void {
    const s = engine._state;
    if (s.boundArrayBuffer === handle) {
        return;
    }
    engine.gl.bindBuffer(ARRAY_BUFFER, handle);
    s.boundArrayBuffer = handle;
}
