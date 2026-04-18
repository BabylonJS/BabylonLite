/**
 * glTF material extension system.
 *
 * Each KHR (or vendor) material extension is implemented as a `GltfMatExt`:
 * one self-contained module that knows how to (a) parse its raw extension
 * object from a glTF material def, (b) declare its texture-info refs so the
 * loader can batch fetches, and (c) build a partial `PbrMaterialProps` from
 * the parsed data + uploaded textures.
 *
 * The core gltf loader knows ZERO extension names: it iterates over registered
 * exts only. Ext modules are dynamic-imported by the loader based on the
 * asset's `extensionsUsed` list, keeping unused extension code out of bundles.
 *
 * Registration is per-load (no module-level side effects, no global state).
 */
import type { PbrMaterialProps } from "../material/pbr/pbr-material.js";
import type { Texture2D } from "../texture/texture-2d.js";

/** Texture-info reference returned by an ext's parse() call. */
export interface GltfExtImageRef {
    /** Stable key the ext uses to look up the uploaded texture in build(). */
    key: string;
    /** Raw glTF textureInfo object (`{ index, texCoord?, extensions? }`) or null/undefined. */
    texInfo: unknown;
    /** Whether the texture should be uploaded as sRGB. */
    sRGB: boolean;
}

/** Result of parsing an extension from one material's raw `.extensions` object. */
export interface GltfExtParsed {
    /** Texture infos this ext needs the loader to fetch + upload. */
    imageRefs: GltfExtImageRef[];
    /** Opaque per-material data; passed back to build() unchanged. */
    data: unknown;
    /** Optional sheen-style asynchronous prep: extra promise the loader must
     *  await before invoking build (e.g. fetching nested image-pair data).
     *  Resolved value replaces `data`. */
    asyncPrep?: () => Promise<unknown>;
}

export interface GltfMatExt {
    /** Canonical KHR id, e.g. "KHR_materials_clearcoat". */
    readonly id: string;
    /** Parse the ext from one raw glTF material def. Return null when this
     *  material doesn't carry the extension. */
    parse(rawMat: unknown): GltfExtParsed | null;
    /** Build a partial PbrMaterialProps fragment to merge onto the base material. */
    build(data: unknown, textures: Readonly<Record<string, Texture2D | undefined>>): Partial<PbrMaterialProps>;
}
