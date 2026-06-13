/**
 * Babylon.js-compatible `SpriteManager` / `Sprite` over Babylon Lite's
 * camera-facing billboard sprite system.
 *
 * Babylon.js positions sprites in **world space** (`sprite.position` is a
 * `Vector3`, `sprite.width`/`height` are world units) and renders them as
 * camera-facing billboards. Babylon Lite's `createFacingBillboardSystem` +
 * `addBillboardSpriteIndex` use the exact same world-space model
 * (`position: [x,y,z]`, `sizeWorld: [w,h]`), so the mapping is direct.
 *
 * The atlas image loads asynchronously, so the `SpriteManager` constructor
 * defers building the Lite billboard system until engine start: it tracks the
 * atlas-load promise via `scene._trackTextureLoad` and registers a
 * `scene._deferAdd` callback that — once the atlas is ready — builds the system,
 * pushes every `Sprite`'s current props, and attaches it to the scene.
 */

import {
    loadSpriteAtlas,
    createFacingBillboardSystem,
    addBillboardSpriteIndex,
    updateBillboardSpriteIndex,
    addFacingBillboardSystem,
    billboardBlendAlpha,
    billboardBlendAdditive,
} from "babylon-lite";
import type { SpriteAtlas, FacingBillboardSpriteSystem, BillboardBlendDescriptor, BillboardSpriteInit } from "babylon-lite";

import { Vector3 } from "../math/vector.js";
import { Color4 } from "../math/color.js";
import type { Scene } from "../scene/scene.js";

interface CellSize {
    width: number;
    height: number;
}

/** Babylon.js `Constants.ALPHA_ONEONE` (additive). */
const ALPHA_ONEONE = 6;
/** Babylon.js `Constants.ALPHA_ADD`. */
const ALPHA_ADD = 1;

/**
 * Babylon.js `SpriteManager` — owns a sprite atlas and a pool of `Sprite`s that
 * render as camera-facing billboards. Backed by a Lite facing-billboard system.
 */
export class SpriteManager {
    public name: string;
    /** Babylon.js `manager.disableDepthWrite`. Accepted for parity (Lite billboards self-manage depth). */
    public disableDepthWrite = false;
    /** Babylon.js `manager.blendMode` (`Constants.ALPHA_*`). Mapped to a Lite billboard blend at build. */
    public blendMode = 2;

    /** @internal Sprites created against this manager, in creation order. */
    public readonly _sprites: Sprite[] = [];
    /** @internal The Lite billboard system, built at engine start. */
    public _lite?: FacingBillboardSpriteSystem;

    private _atlas?: SpriteAtlas;

    public constructor(name: string, url: string, capacity: number, cellSize: CellSize, scene: Scene, _epsilon = 0.01, samplingMode = 2) {
        this.name = name;
        const engine = scene.getEngine()._lite;
        // Babylon.js `Texture.NEAREST_SAMPLINGMODE` is 1; everything else (bi/tri-
        // linear) maps to Lite's "linear".
        const sampling = samplingMode === 1 ? "nearest" : "linear";
        // Kick off the async atlas load; resolve stores the atlas for the
        // deferred build. Tracked so the engine awaits it before building.
        scene._trackTextureLoad(
            loadSpriteAtlas(engine, url, {
                gridSize: [cellSize.width, cellSize.height],
                sampling,
            }).then((atlas) => {
                this._atlas = atlas;
            })
        );
        // Build the billboard system once the atlas is ready (after pending
        // textures are awaited) and attach it to the scene.
        scene._deferAdd(() => {
            if (!this._atlas) {
                return;
            }
            const blendMode = this._mapBlendMode();
            const system = createFacingBillboardSystem(this._atlas, { capacity, blendMode });
            for (const sprite of this._sprites) {
                sprite._applyTo(system);
            }
            this._lite = system;
            addFacingBillboardSystem(scene._lite, system);
        });
    }

    /** @internal Map the Babylon.js `Constants.ALPHA_*` blend mode to a Lite billboard blend. */
    private _mapBlendMode(): BillboardBlendDescriptor {
        if (this.blendMode === ALPHA_ONEONE || this.blendMode === ALPHA_ADD) {
            return billboardBlendAdditive;
        }
        return billboardBlendAlpha;
    }
}

/**
 * Babylon.js `Sprite` — a single camera-facing billboard in a `SpriteManager`'s
 * atlas. World-space position + size; cell index selects the atlas frame.
 *
 * Properties are **live**: once the manager has built its Lite billboard system
 * (at engine start), mutating a sprite property pushes an
 * `updateBillboardSpriteIndex` patch so per-frame animation (e.g. advancing
 * `cellIndex` or toggling `isVisible`) is reflected on the GPU. Before the
 * system is built, property writes are buffered and flushed once in `_applyTo`.
 *
 * Note: `position`/`color` are object values; reassigning them
 * (`sprite.position = new Vector3(...)`) pushes a patch, but mutating a
 * component in place (`sprite.position.x = …`) does not — call the setter (or
 * reassign) to push a live update.
 */
export class Sprite {
    public name: string;

    private _position = new Vector3(0, 0, 0);
    private _width = 1;
    private _height = 1;
    private _cellIndex = 0;
    private _angle = 0;
    private _color = new Color4(1, 1, 1, 1);
    private _invertU = false;
    private _invertV = false;
    private _visible = true;

    /** @internal The Lite billboard system this sprite belongs to (set in `_applyTo`). */
    private _system?: FacingBillboardSpriteSystem;
    /** @internal This sprite's instance index in `_system` (set in `_applyTo`). */
    private _index = -1;

    public constructor(name: string, manager: SpriteManager) {
        this.name = name;
        manager._sprites.push(this);
    }

    public get position(): Vector3 {
        return this._position;
    }
    public set position(value: Vector3) {
        this._position = value;
        this._patch({ position: [value.x, value.y, value.z] });
    }

    public get width(): number {
        return this._width;
    }
    public set width(value: number) {
        this._width = value;
        this._patch({ sizeWorld: [value, this._height] });
    }

    public get height(): number {
        return this._height;
    }
    public set height(value: number) {
        this._height = value;
        this._patch({ sizeWorld: [this._width, value] });
    }

    public get cellIndex(): number {
        return this._cellIndex;
    }
    public set cellIndex(value: number) {
        this._cellIndex = value;
        this._patch({ frame: value });
    }

    public get angle(): number {
        return this._angle;
    }
    public set angle(value: number) {
        this._angle = value;
        this._patch({ rotation: value });
    }

    public get color(): Color4 {
        return this._color;
    }
    public set color(value: Color4) {
        this._color = value;
        this._patch({ color: [value.r, value.g, value.b, value.a] });
    }

    public get invertU(): boolean {
        return this._invertU;
    }
    public set invertU(value: boolean) {
        this._invertU = value;
        this._patch({ flipX: value });
    }

    public get invertV(): boolean {
        return this._invertV;
    }
    public set invertV(value: boolean) {
        this._invertV = value;
        this._patch({ flipY: value });
    }

    public get isVisible(): boolean {
        return this._visible;
    }
    public set isVisible(value: boolean) {
        this._visible = value;
        this._patch({ visible: value });
    }

    /** @internal Add this sprite to the Lite billboard system and record its index for live updates. */
    public _applyTo(system: FacingBillboardSpriteSystem): void {
        this._index = addBillboardSpriteIndex(system, {
            position: [this._position.x, this._position.y, this._position.z],
            sizeWorld: [this._width, this._height],
            frame: this._cellIndex,
            rotation: this._angle,
            color: [this._color.r, this._color.g, this._color.b, this._color.a],
            flipX: this._invertU,
            flipY: this._invertV,
            visible: this._visible,
        });
        this._system = system;
    }

    /** @internal Push a live property patch to the Lite billboard system (no-op before build). */
    private _patch(patch: Partial<BillboardSpriteInit>): void {
        if (this._system && this._index >= 0) {
            updateBillboardSpriteIndex(this._system, this._index, patch);
        }
    }
}
