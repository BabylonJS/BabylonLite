/**
 * Babylon.js-compatible material classes over the Babylon Lite material
 * factories.
 *
 * The Lite material is plain-data props (`_lite`); assign it to a mesh via
 * `mesh.material = material`. Property setters mutate the props and mark the
 * material UBO dirty (matching Babylon.js's "mutate then it just works"
 * behaviour). Only the common property subset is mapped; rarely-used Babylon.js
 * material properties are intentionally omitted.
 */

import { createStandardMaterial, createPbrMaterial, markMaterialUboDirty } from "babylon-lite";
import type { StandardMaterialProps, PbrMaterialProps, Texture2D } from "babylon-lite";

import { Color3 } from "../math/color.js";
import type { Scene } from "../scene/scene.js";
import type { BaseTexture } from "../textures/textures.js";

type Tuple3 = [number, number, number];
type Tuple4 = [number, number, number, number];

/** Babylon.js `Material` — base class for all materials. */
export abstract class Material {
    public name: string;
    /** Common transparency mode flag (Babylon.js `Material.transparencyMode`). */
    public transparencyMode: number | null = null;
    /** Back-face culling toggle. */
    public backFaceCulling = true;
    /** Wireframe rendering toggle (not honoured by all Lite materials). */
    public wireframe = false;
    /** @internal Underlying Babylon Lite material props. */
    public abstract readonly _lite: StandardMaterialProps | PbrMaterialProps;

    protected constructor(name: string, _scene?: Scene) {
        this.name = name;
    }

    public getClassName(): string {
        return "Material";
    }

    protected _markDirty(): void {
        markMaterialUboDirty(this._lite);
    }

    public dispose(): void {
        // No GPU resources are owned by the props object directly; textures are
        // disposed through their own handles.
    }
}

/** Babylon.js `PushMaterial` — intermediate base; behaves like {@link Material} here. */
export abstract class PushMaterial extends Material {
    public override getClassName(): string {
        return "PushMaterial";
    }
}

function readColor3(tuple: Tuple3 | undefined): Color3 {
    return tuple ? new Color3(tuple[0], tuple[1], tuple[2]) : new Color3(0, 0, 0);
}

export class StandardMaterial extends PushMaterial {
    /** @internal Underlying Babylon Lite standard-material props. */
    public readonly _lite: StandardMaterialProps;

    public constructor(name: string, scene?: Scene) {
        super(name, scene);
        this._lite = createStandardMaterial();
    }

    public override getClassName(): string {
        return "StandardMaterial";
    }

    public get diffuseColor(): Color3 {
        return readColor3(this._lite.diffuseColor);
    }
    public set diffuseColor(value: Color3) {
        this._lite.diffuseColor = [value.r, value.g, value.b];
        this._markDirty();
    }

    public get specularColor(): Color3 {
        return readColor3(this._lite.specularColor);
    }
    public set specularColor(value: Color3) {
        this._lite.specularColor = [value.r, value.g, value.b];
        this._markDirty();
    }

    public get emissiveColor(): Color3 {
        return readColor3(this._lite.emissiveColor);
    }
    public set emissiveColor(value: Color3) {
        this._lite.emissiveColor = [value.r, value.g, value.b];
        this._markDirty();
    }

    public get ambientColor(): Color3 {
        return readColor3(this._lite.ambientColor);
    }
    public set ambientColor(value: Color3) {
        this._lite.ambientColor = [value.r, value.g, value.b];
        this._markDirty();
    }

    public get alpha(): number {
        return this._lite.alpha;
    }
    public set alpha(value: number) {
        this._lite.alpha = value;
        this._markDirty();
    }

    public get diffuseTexture(): BaseTexture | null {
        return this._diffuseTexture;
    }
    public set diffuseTexture(texture: BaseTexture | null) {
        this._diffuseTexture = texture;
        this._lite.diffuseTexture = (texture?._lite as Texture2D | undefined) ?? null;
        this._markDirty();
    }

    public get bumpTexture(): BaseTexture | null {
        return this._bumpTexture;
    }
    public set bumpTexture(texture: BaseTexture | null) {
        this._bumpTexture = texture;
        this._lite.bumpTexture = (texture?._lite as Texture2D | undefined) ?? null;
        this._markDirty();
    }

    private _diffuseTexture: BaseTexture | null = null;
    private _bumpTexture: BaseTexture | null = null;
}

export class PBRMaterial extends PushMaterial {
    /** @internal Underlying Babylon Lite PBR-material props. */
    public readonly _lite: PbrMaterialProps;

    public constructor(name: string, scene?: Scene) {
        super(name, scene);
        this._lite = createPbrMaterial();
        if (!this._lite.baseColorFactor) {
            this._lite.baseColorFactor = [1, 1, 1, 1];
        }
    }

    public override getClassName(): string {
        return "PBRMaterial";
    }

    public get albedoColor(): Color3 {
        const f = this._lite.baseColorFactor;
        return f ? new Color3(f[0], f[1], f[2]) : new Color3(1, 1, 1);
    }
    public set albedoColor(value: Color3) {
        const f: Tuple4 = this._lite.baseColorFactor ?? [1, 1, 1, 1];
        this._lite.baseColorFactor = [value.r, value.g, value.b, f[3]];
        this._markDirty();
    }

    public get metallic(): number {
        return this._lite.metallicFactor ?? 1;
    }
    public set metallic(value: number) {
        this._lite.metallicFactor = value;
        this._markDirty();
    }

    public get roughness(): number {
        return this._lite.roughnessFactor ?? 1;
    }
    public set roughness(value: number) {
        this._lite.roughnessFactor = value;
        this._markDirty();
    }

    public get emissiveColor(): Color3 {
        return readColor3(this._lite.emissiveColor);
    }
    public set emissiveColor(value: Color3) {
        this._lite.emissiveColor = [value.r, value.g, value.b];
        this._markDirty();
    }

    public get alpha(): number {
        return this._lite.alpha ?? 1;
    }
    public set alpha(value: number) {
        this._lite.alpha = value;
        this._markDirty();
    }
}

/**
 * Babylon.js `PBRMetallicRoughnessMaterial` — a simplified façade over
 * {@link PBRMaterial} exposing the metallic-roughness workflow directly.
 */
export class PBRMetallicRoughnessMaterial extends PBRMaterial {
    public override getClassName(): string {
        return "PBRMetallicRoughnessMaterial";
    }

    /** Alias of `albedoColor` (glTF "base color"). */
    public get baseColor(): Color3 {
        return this.albedoColor;
    }
    public set baseColor(value: Color3) {
        this.albedoColor = value;
    }
}

/**
 * Babylon.js `PBRSpecularGlossinessMaterial` — the spec/gloss workflow is
 * supported when loaded from glTF (`KHR_materials_pbrSpecularGlossiness`), but a
 * standalone manual spec/gloss material is not mapped onto Lite's metallic-roughness
 * PBR. The constructor builds a metallic-roughness PBR material and exposes a
 * `diffuseColor`/`glossiness` façade; results will not match BJS spec/gloss exactly.
 */
export class PBRSpecularGlossinessMaterial extends PBRMaterial {
    public override getClassName(): string {
        return "PBRSpecularGlossinessMaterial";
    }

    public get diffuseColor(): Color3 {
        return this.albedoColor;
    }
    public set diffuseColor(value: Color3) {
        this.albedoColor = value;
    }

    /** Maps glossiness → (1 - roughness). */
    public get glossiness(): number {
        return 1 - this.roughness;
    }
    public set glossiness(value: number) {
        this.roughness = 1 - value;
    }
}
