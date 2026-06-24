// Scene/coordinator-scoped event bus feeding flow-graph event blocks.
// Pure data (`FgEventBus`) + standalone subscribe/pump functions — NO methods
// on the interface (GUIDANCE §4b′). One bus is shared across all graphs in a
// scene so multiple `KHR_interactivity` graphs can exchange custom events.

import { FgEventType } from "./types.js";

export { FgEventType };

/** Payload carried by a pumped event. `tick` carries `{ deltaMs, deltaTime }`;
 *  `customEvent` carries `{ eventName, values }`. */
export interface FgEventPayload {
    [key: string]: unknown;
}

export type FgEventHandler = (payload: FgEventPayload) => void;

/** Pure-data event bus. Channel name → ordered list of handlers. */
export interface FgEventBus {
    /** @internal channel → handlers, in subscription order. */
    readonly _listeners: Map<string, FgEventHandler[]>;
}

/** Create an empty event bus. (Allocation is inside the factory, never at
 *  module scope, so the module stays tree-shakable.) */
export function createFgEventBus(): FgEventBus {
    return { _listeners: new Map() };
}

/** Subscribe `handler` to a channel. Returns an unsubscribe function.
 *  Handlers fire in subscription order — callers control ordering by the order
 *  in which they subscribe (see runtime init-priority). */
export function subscribeFgEvent(bus: FgEventBus, channel: string, handler: FgEventHandler): () => void {
    let handlers = bus._listeners.get(channel);
    if (!handlers) {
        handlers = [];
        bus._listeners.set(channel, handlers);
    }
    handlers.push(handler);
    return () => {
        const list = bus._listeners.get(channel);
        if (!list) {
            return;
        }
        const i = list.indexOf(handler);
        if (i >= 0) {
            list.splice(i, 1);
        }
    };
}

/** Dispatch `payload` to every handler subscribed to `channel`. Iterates a
 *  snapshot so a handler may safely (un)subscribe during dispatch. */
export function pumpFgEvent(bus: FgEventBus, channel: string, payload: FgEventPayload): void {
    const handlers = bus._listeners.get(channel);
    if (!handlers || handlers.length === 0) {
        return;
    }
    for (const handler of handlers.slice()) {
        handler(payload);
    }
}

/** Remove every listener from the bus. */
export function clearFgEventBus(bus: FgEventBus): void {
    bus._listeners.clear();
}
