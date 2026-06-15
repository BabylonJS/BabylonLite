/**
 * Babylon.js `@babylonjs/addons/navigation` compatibility wrapper over Babylon
 * Lite's native navigation API (`createNavigationPluginAsync` / `createNavMesh` /
 * `createDebugNavMeshGeometry` / `createNavCrowd` / …).
 *
 * The Babylon.js navigation addon (`RecastNavigationJSPluginV2`, created via
 * `CreateNavigationPluginAsync`) is a thin wrapper around `recast-navigation-js`.
 * Babylon Lite ships its own Recast V2 integration with the same capabilities, so
 * this module mirrors the addon's public plugin/crowd surface and delegates to
 * Lite. The Recast instance the scene injects via `{ instance }` is ignored —
 * Lite loads its own Recast wasm (served at `/recast-navigation.wasm`).
 *
 * Only the surface exercised by ported scenes is implemented (`createNavMesh`,
 * `createDebugNavMesh`, `getClosestPoint`, `createCrowd` + `addAgent`); the rest
 * of the addon API is intentionally omitted.
 */

import {
    createNavigationPluginAsync as liteCreateNavigationPluginAsync,
    createNavMesh as liteCreateNavMesh,
    createDebugNavMeshGeometry as liteCreateDebugNavMeshGeometry,
    getClosestPoint as liteGetClosestPoint,
    createNavCrowd as liteCreateNavCrowd,
    addAgent as liteAddAgent,
    getAgentPosition as liteGetAgentPosition,
    updateNavCrowd as liteUpdateNavCrowd,
    createMeshFromData,
    addToScene,
    type NavigationPlugin as LiteNavigationPlugin,
    type NavCrowd as LiteNavCrowd,
    type Mesh as LiteMesh,
} from "babylon-lite";

import { Mesh } from "../meshes/meshes.js";
import { Vector3 } from "../math/vector.js";
import type { Scene } from "../scene/scene.js";

interface Vec3Like {
    x: number;
    y: number;
    z: number;
}

interface AgentTransform {
    position: { set(x: number, y: number, z: number): unknown };
}

/** Babylon.js `IAgentParameters` subset accepted by `RecastJSCrowd.addAgent`. */
interface AgentParameters {
    radius: number;
    height: number;
    maxAcceleration: number;
    maxSpeed: number;
    collisionQueryRange: number;
    pathOptimizationRange: number;
    separationWeight: number;
    reachRadius?: number;
}

/**
 * Babylon.js `RecastJSCrowd` (subset) — owns crowd agents and syncs each agent's
 * Babylon transform to the simulated position every frame, exactly like the addon.
 */
class RecastJSCrowd {
    /** @internal */ public readonly _lite: LiteNavCrowd;
    private readonly _transforms = new Map<number, AgentTransform>();

    public constructor(lite: LiteNavCrowd, scene: Scene) {
        this._lite = lite;
        // Babylon.js' crowd advances the simulation and writes back agent transforms
        // on the scene's before-render tick; mirror that over Lite's manual crowd update.
        scene.onBeforeRenderObservable.add(() => {
            liteUpdateNavCrowd(this._lite, 1 / 60);
            for (const [index, transform] of this._transforms) {
                const p = liteGetAgentPosition(this._lite, index);
                transform.position.set(p.x, p.y, p.z);
            }
        });
    }

    /** Babylon.js `crowd.addAgent(pos, parameters, transform)` — returns the agent index. */
    public addAgent(pos: Vec3Like, parameters: AgentParameters, transform: AgentTransform): number {
        const index = liteAddAgent(this._lite, { x: pos.x, y: pos.y, z: pos.z }, parameters);
        this._transforms.set(index, transform);
        return index;
    }

    /** Babylon.js `crowd.getAgentPosition(index)`. */
    public getAgentPosition(index: number): Vector3 {
        const p = liteGetAgentPosition(this._lite, index);
        return new Vector3(p.x, p.y, p.z);
    }
}

/**
 * Babylon.js `RecastNavigationJSPluginV2` (subset) over Babylon Lite navigation.
 */
class RecastNavigationJSPluginV2 {
    /** @internal */ public readonly _lite: LiteNavigationPlugin;

    public constructor(lite: LiteNavigationPlugin) {
        this._lite = lite;
    }

    /** Babylon.js `plugin.createNavMesh(meshes, parameters)`. */
    public createNavMesh(meshes: Array<{ _lite: LiteMesh }>, parameters: Record<string, unknown>): void {
        liteCreateNavMesh(
            this._lite,
            meshes.map((m) => m._lite),
            parameters as never
        );
    }

    /** Babylon.js `plugin.createDebugNavMesh(scene)` — builds a renderable debug mesh. */
    public createDebugNavMesh(scene: Scene): Mesh {
        const geo = liteCreateDebugNavMeshGeometry(this._lite);
        const engine = scene.getEngine()._lite;
        const lite = createMeshFromData(engine, "navDebugMesh", geo.positions, geo.normals, geo.indices);
        const mesh = new Mesh("navDebugMesh", lite, scene);
        scene._deferAdd(() => {
            const mat = mesh.material;
            mat?._ensureRenderable(engine);
            if (mat?._lite) {
                mesh._lite.material = mat._lite as never;
            }
            addToScene(scene._lite, mesh._lite);
        });
        return mesh;
    }

    /** Babylon.js `plugin.getClosestPoint(position)` — snap to the navmesh. */
    public getClosestPoint(position: Vec3Like): Vector3 {
        const p = liteGetClosestPoint(this._lite, { x: position.x, y: position.y, z: position.z });
        return new Vector3(p.x, p.y, p.z);
    }

    /** Babylon.js `plugin.createCrowd(maxAgents, maxAgentRadius, scene)`. */
    public createCrowd(maxAgents: number, maxAgentRadius: number, scene: Scene): RecastJSCrowd {
        const crowd = liteCreateNavCrowd(this._lite, maxAgents, maxAgentRadius);
        return new RecastJSCrowd(crowd, scene);
    }
}

/**
 * Babylon.js `@babylonjs/addons/navigation` `CreateNavigationPluginAsync`. The
 * injected Recast `instance` (if any) is ignored — Babylon Lite loads its own
 * Recast wasm from `/recast-navigation.wasm`.
 */
export async function CreateNavigationPluginAsync(_options?: { version?: string; instance?: unknown }): Promise<RecastNavigationJSPluginV2> {
    const lite = await liteCreateNavigationPluginAsync({ locateFile: () => "/recast-navigation.wasm" });
    return new RecastNavigationJSPluginV2(lite);
}

export { RecastNavigationJSPluginV2, RecastJSCrowd };
