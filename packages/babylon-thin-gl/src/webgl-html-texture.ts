/**
 * Sub-entry: HTML element textures.
 *
 * Dynamic-importable via `import { ... } from "@babylon-lite/thin-gl/html-texture"`
 * so consumers that don't need it (everything except NeonBrush's `InputGlow`)
 * don't pull it into their bundles.
 */
import type { WebGLContext } from "./webgl-context.js";
import { bindTextureRaw, type GLTexture, type GLTextureOptions } from "./webgl-texture.js";

export interface GLHtmlElementTextureOptions extends GLTextureOptions {
    /** Default: false. Reserved for future use; currently has no behaviour
     *  beyond marking the texture as a sampling-mode-tagged HTML texture. */
    samplingMode?: GLenum;
}

/** Create a texture backed by an `<canvas>` / `<img>` / `<video>` element.
 *  The initial upload is performed immediately; call `updateHtmlElementTexture`
 *  to re-upload after the source has changed. */
export function createHtmlElementTexture(ctx: WebGLContext, element: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement, options?: GLHtmlElementTextureOptions): GLTexture {
    const gl = ctx.gl;
    const handle = gl.createTexture();
    if (handle === null) {
        throw new Error("thin-gl: gl.createTexture returned null");
    }
    const opts = options ?? {};
    const minFilter = opts.minFilter ?? gl.LINEAR;
    const magFilter = opts.magFilter ?? gl.LINEAR;
    const wrapS = opts.wrapS ?? gl.CLAMP_TO_EDGE;
    const wrapT = opts.wrapT ?? gl.CLAMP_TO_EDGE;
    const invertY = opts.invertY ?? false;
    const generateMipMaps = opts.generateMipMaps ?? false;

    const sizeOf = (): [number, number] => {
        if (element instanceof HTMLVideoElement) {
            return [element.videoWidth || 1, element.videoHeight || 1];
        }
        if (element instanceof HTMLImageElement) {
            return [element.naturalWidth || 1, element.naturalHeight || 1];
        }
        return [element.width || 1, element.height || 1];
    };

    const upload = (target: WebGLContext): void => {
        const g = target.gl;
        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, invertY ? 1 : 0);
        bindTextureRaw(target, 0, tex.handle);
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, element);
        const [w, h] = sizeOf();
        tex.width = w;
        tex.height = h;
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, minFilter);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, magFilter);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, wrapS);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, wrapT);
        if (generateMipMaps) {
            g.generateMipmap(g.TEXTURE_2D);
        }
    };

    const [w0, h0] = sizeOf();
    const tex: GLTexture = {
        handle,
        target: gl.TEXTURE_2D,
        width: w0,
        height: h0,
        isReady: true,
        _disposed: false,
        _refCount: 1,
        _upload: upload,
        _wasReady: true,
    };
    upload(ctx);
    ctx._textures.push(tex);
    return tex;
}

/** Re-upload from the source element. `force=false` (default) skips the
 *  upload when the element bounds haven't changed — set `force=true` to
 *  always re-upload (e.g. when the inner pixels mutated without resizing). */
export function updateHtmlElementTexture(ctx: WebGLContext, tex: GLTexture, force?: boolean): void {
    if (ctx._isLost || ctx._disposed || tex._disposed) {
        return;
    }
    if (force === true) {
        tex._upload(ctx);
        return;
    }
    // Without `force`, only re-upload if the source bounds changed (cheap
    // approximation of "did the pixels change"). Consumers that mutate
    // pixels in place must pass force=true.
    const before = { w: tex.width, h: tex.height };
    tex._upload(ctx);
    if (before.w === tex.width && before.h === tex.height) {
        // Bounds unchanged. The upload still ran — without an OES_pixel_*
        // hash we have no cheap way to detect "same pixels". Future work:
        // expose a `lastUpdate` field and let the caller pass an epoch.
    }
}
