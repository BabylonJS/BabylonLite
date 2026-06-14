/**
 * GL-state cache type. Owned by `GLEngineContext._state`. Source of truth for
 * "what is currently bound on the GL context" — every public function that
 * issues a GL call updates this in lock-step with the underlying gl.* call,
 * and elides the call when the cached state already matches the requested one.
 *
 * See `00-lite-gl.md` §4.1 for the full table of cached operations.
 *
 * INVARIANTS:
 *  - The cache is the source of truth. If consumers poke `engine.gl.*` directly
 *    they will silently corrupt this state.
 *  - On `webglcontextlost` the entire cache is reset to its initial values
 *    (handles are dead anyway; subsequent setters bail out on `engine._isLost`).
 */
export interface GLState {
    currentProgram: WebGLProgram | null;
    activeTextureUnit: number;
    /** Per-unit binding; length === caps.maxTextureUnits. */
    boundTextures: (WebGLTexture | null)[];
    boundArrayBuffer: WebGLBuffer | null;
    boundElementBuffer: WebGLBuffer | null;
    boundVao: WebGLVertexArrayObject | null;
    viewportX: number;
    viewportY: number;
    viewportW: number;
    viewportH: number;
    /**
     * Currently-bound draw framebuffer, or `null` for the default (canvas)
     * framebuffer. Owned by the render-target module's `bindRenderTarget`
     * (binding `null` returns to the canvas). Reset to `null` on context-lost.
     */
    boundFramebuffer: WebGLFramebuffer | null;
    /**
     * Granular blend cache. Both `setBlendMode` (presets) and `setBlendState`
     * (arbitrary separate func + equation) resolve to the same fields, so the
     * two paths can never desync. `blendEnabled` is a tri-state: `-1` unset,
     * `0` disabled, `1` enabled — the `-1` sentinel guarantees the first
     * `setBlendMode`/`disableBlend` is never elided. The func/equation fields
     * are only trusted while `blendEnabled === 1`; the disabled→enabled
     * transition always re-issues both (matching Babylon's `AlphaState`, which
     * does not track func/equation while blending is off). Reset on context-lost.
     */
    blendEnabled: number;
    blendSrcRGB: number;
    blendDstRGB: number;
    blendSrcAlpha: number;
    blendDstAlpha: number;
    blendEqRGB: number;
    blendEqAlpha: number;
    /** Depth-test enable tri-state (`-1` unset, `0` off, `1` on). */
    depthTest: number;
    /** Depth-write mask tri-state (`-1` unset, `0` off, `1` on). */
    depthMask: number;
    /** Cached `gl.depthFunc` value, or `0` when unset (no GL func is `0`). */
    depthFunc: number;
    /** Face-cull enable tri-state (`-1` unset, `0` off, `1` on). */
    cullEnabled: number;
    /** Cached `gl.cullFace` value, or `0` when unset. */
    cullFace: number;
    /** Stencil-test enable tri-state (`-1` unset, `0` off, `1` on). */
    stencilTest: number;
    /** Cached `gl.stencilMask` value, or `-1` when unset. */
    stencilMask: number;
    /** Cached `gl.stencilFunc(func, ref, mask)` triple; `func === 0` is unset. */
    stencilFuncFunc: number;
    stencilFuncRef: number;
    stencilFuncMask: number;
    /** Cached `gl.stencilOp(fail, zFail, zPass)` triple; `0` is unset. */
    stencilOpFail: number;
    stencilOpZFail: number;
    stencilOpZPass: number;
    /** Color-write mask packed as `r<<3 | g<<2 | b<<1 | a`, or `-1` when unset. */
    colorMask: number;
    /** Scissor-test enable tri-state (`-1` unset, `0` off, `1` on). */
    scissorEnabled: number;
    scissorX: number;
    scissorY: number;
    scissorW: number;
    scissorH: number;
    /** Cached `gl.pixelStorei(UNPACK_ALIGNMENT)`, or `-1` when unset. */
    unpackAlignment: number;
    /** Cached `gl.pixelStorei(UNPACK_FLIP_Y_WEBGL)`, or `-1` when unset. */
    unpackFlipY: number;
    /** Cached `gl.pixelStorei(UNPACK_PREMULTIPLY_ALPHA_WEBGL)`, or `-1` unset. */
    unpackPremultiplyAlpha: number;
    /**
     * Per-location vertex-attribute enable flags for the DEFAULT (null) VAO —
     * the mesh / instancing path (mirrors Babylon's `_vertexAttribArraysEnabled`).
     * Index is the attribute location. lite-gl's quad / sprite paths use their
     * own VAOs and do not touch this. Cleared on context-lost.
     */
    enabledAttribs: boolean[];
    /**
     * Attribute locations currently configured with a non-default vertex divisor
     * (instanced attributes), mirroring Babylon's `_currentInstanceLocations`.
     * `unbindInstanceAttributes` resets each back to divisor 0 and clears this.
     */
    instanceLocations: number[];
    /** Shared fullscreen quad — lazily created on first `applyEffectWrapper`. */
    quadVbo: WebGLBuffer | null;
    quadIbo: WebGLBuffer | null;
    quadVao: WebGLVertexArrayObject | null;
}

/** Allocate a fresh, fully-null GLState sized for `maxTextureUnits`. */
export function createGLState(maxTextureUnits: number): GLState {
    return {
        currentProgram: null,
        activeTextureUnit: 0,
        boundTextures: new Array<WebGLTexture | null>(maxTextureUnits).fill(null),
        boundArrayBuffer: null,
        boundElementBuffer: null,
        boundVao: null,
        viewportX: 0,
        viewportY: 0,
        viewportW: 0,
        viewportH: 0,
        boundFramebuffer: null,
        blendEnabled: -1,
        blendSrcRGB: 0,
        blendDstRGB: 0,
        blendSrcAlpha: 0,
        blendDstAlpha: 0,
        blendEqRGB: 0,
        blendEqAlpha: 0,
        depthTest: -1,
        depthMask: -1,
        depthFunc: 0,
        cullEnabled: -1,
        cullFace: 0,
        stencilTest: -1,
        stencilMask: -1,
        stencilFuncFunc: 0,
        stencilFuncRef: 0,
        stencilFuncMask: 0,
        stencilOpFail: 0,
        stencilOpZFail: 0,
        stencilOpZPass: 0,
        colorMask: -1,
        scissorEnabled: -1,
        scissorX: 0,
        scissorY: 0,
        scissorW: 0,
        scissorH: 0,
        unpackAlignment: -1,
        unpackFlipY: -1,
        unpackPremultiplyAlpha: -1,
        enabledAttribs: [],
        instanceLocations: [],
        quadVbo: null,
        quadIbo: null,
        quadVao: null,
    };
}

/** Reset only the cached "current GL state" — every binding (program / buffers /
 *  textures / VAO / framebuffer) and render-state (blend / depth / stencil /
 *  scissor / color-mask / viewport / unpack) field — to its unset sentinel,
 *  WITHOUT discarding owned GPU resources (the shared quad). After this, the
 *  next setter in each category is re-issued rather than elided.
 *
 *  Used by `resetGLState` (context-lost) and by `wipeGLStateCache` (a host that
 *  shares the GL context calling in after mutating raw `gl.*` state). The shared
 *  quad's GL objects are still alive in the latter case, so they are preserved
 *  here to avoid leaking + needlessly rebuilding them every render scope. */
export function resetGLStateCache(state: GLState): void {
    state.currentProgram = null;
    state.activeTextureUnit = 0;
    state.boundTextures.fill(null);
    state.boundArrayBuffer = null;
    state.boundElementBuffer = null;
    state.boundVao = null;
    state.viewportX = 0;
    state.viewportY = 0;
    state.viewportW = 0;
    state.viewportH = 0;
    state.boundFramebuffer = null;
    state.blendEnabled = -1;
    state.blendSrcRGB = 0;
    state.blendDstRGB = 0;
    state.blendSrcAlpha = 0;
    state.blendDstAlpha = 0;
    state.blendEqRGB = 0;
    state.blendEqAlpha = 0;
    state.depthTest = -1;
    state.depthMask = -1;
    state.depthFunc = 0;
    state.cullEnabled = -1;
    state.cullFace = 0;
    state.stencilTest = -1;
    state.stencilMask = -1;
    state.stencilFuncFunc = 0;
    state.stencilFuncRef = 0;
    state.stencilFuncMask = 0;
    state.stencilOpFail = 0;
    state.stencilOpZFail = 0;
    state.stencilOpZPass = 0;
    state.colorMask = -1;
    state.scissorEnabled = -1;
    state.scissorX = 0;
    state.scissorY = 0;
    state.scissorW = 0;
    state.scissorH = 0;
    state.unpackAlignment = -1;
    state.unpackFlipY = -1;
    state.unpackPremultiplyAlpha = -1;
    state.enabledAttribs.length = 0;
    state.instanceLocations.length = 0;
}

/** Zero the cache in-place. Used by the context-lost handler — GL handles are
 *  already dead per WebGL spec; we forget what we knew about them (including the
 *  shared quad, whose GL objects are gone and must be rebuilt) so the next
 *  bind/use after restore is NOT incorrectly elided. */
export function resetGLState(state: GLState): void {
    resetGLStateCache(state);
    state.quadVbo = null;
    state.quadIbo = null;
    state.quadVao = null;
}
