/** Babylon.js-compatible spatial constants (`Axis`, `Space`). */

import { Vector3 } from "./vector.js";

export const Axis = {
    get X(): Vector3 {
        return new Vector3(1, 0, 0);
    },
    get Y(): Vector3 {
        return new Vector3(0, 1, 0);
    },
    get Z(): Vector3 {
        return new Vector3(0, 0, 1);
    },
};

export enum Space {
    LOCAL = 0,
    WORLD = 1,
    BONE = 2,
}
