// Lite block-type identifiers. `const enum` string tags → erased at build.
// String values mirror the BJS `FlowGraphBlockNames` / glTF op identifiers
// where practical so the declaration mapper can pass them through.
// Phase 1 ships NO block implementations; this enum is the stable name surface
// that block-registry.ts and the gltf mapper resolve against as blocks land.

export const enum FgBlockType {
    // ─── Events ───────────────────────────────────────────────
    SceneStart = "SceneReadyEvent",
    SceneTick = "SceneTickEvent",
    OnSelect = "OnSelect",
    SendCustomEvent = "SendCustomEvent",
    ReceiveCustomEvent = "ReceiveCustomEvent",

    // ─── Control flow ─────────────────────────────────────────
    Branch = "Branch",
    Sequence = "Sequence",
    Switch = "Switch",
    ForLoop = "ForLoop",
    WhileLoop = "WhileLoop",
    DoN = "DoN",
    MultiGate = "MultiGate",
    WaitAll = "WaitAll",
    Throttle = "Throttle",
    SetDelay = "SetDelay",
    CancelDelay = "CancelDelay",

    // ─── Data / math (subset; broadened in Phase 3) ───────────
    Constant = "Constant",
    Add = "Add",
    Subtract = "Subtract",
    Multiply = "Multiply",
    Divide = "Divide",
    Modulo = "Modulo",
    Abs = "Abs",
    Floor = "Floor",
    LessThan = "LessThan",
    Clamp = "Clamp",
    CombineVector2 = "CombineVector2",
    ExtractVector2 = "ExtractVector2",

    // ─── Pointer / variable / animation ───────────────────────
    GetProperty = "GetProperty",
    SetProperty = "SetProperty",
    JsonPointerParser = "JsonPointerParser",
    GetVariable = "GetVariable",
    SetVariable = "SetVariable",
    ValueInterpolation = "ValueInterpolation",
    PlayAnimation = "PlayAnimation",
    StopAnimation = "StopAnimation",

    // ─── Debug ────────────────────────────────────────────────
    ConsoleLog = "ConsoleLog",
}
