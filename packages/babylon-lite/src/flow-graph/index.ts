// Public surface of the flow-graph subsystem. Pure data + standalone functions.
// Re-exported from the package root (../index.ts).

// Core data types
export type { FgBlock, FgDataSocket, FgGraph, FgSignalSocket, FgValue, Vec2 } from "./types.js";
export { FgEventType, FgType } from "./types.js";

// Behaviour definitions + block-type names
export type { FgBlockDef, FgBlockShape } from "./block-def.js";
export { FgBlockType } from "./block-type.js";

// Execution context & environment
export type { FgAccessor, FgCapabilities, FgContext, FgEnv, FgPendingTask, FgWiring } from "./context.js";

// Event bus
export type { FgEventBus, FgEventHandler, FgEventPayload } from "./event-bus.js";
export { clearFgEventBus, createFgEventBus, pumpFgEvent, subscribeFgEvent } from "./event-bus.js";

// Rich-type pure functions
export { animationTypeForFgType, coerceValue, defaultForType, FgAnimationValueType } from "./rich-type.js";

// Custom types
export type { FgInteger } from "./custom-types/fg-integer.js";
export { fgInt, isFgInt } from "./custom-types/fg-integer.js";
export type { FgMatrix2D, FgMatrix3D } from "./custom-types/fg-matrix.js";
export { fgMatrix2D, fgMatrix3D, isFgMatrix2D, isFgMatrix3D } from "./custom-types/fg-matrix.js";

// Block registry
export { getBlockDef } from "./block-registry.js";

// Scene attachment
export { attachFlowGraph, detachFlowGraph } from "./scene-flow-graph.js";

// Runtime functions + FgRuntime
export type { FgRuntime } from "./runtime.js";
export {
    activateSignal,
    addPending,
    cancelPendingForBlock,
    compactPending,
    createFgContext,
    createFgEnv,
    createFgRuntime,
    disposeFlowGraph,
    getDataValue,
    setDataValue,
    startFlowGraph,
    stillPending,
    tickFlowGraph,
} from "./runtime.js";
