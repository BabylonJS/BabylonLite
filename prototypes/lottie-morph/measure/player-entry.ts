// Realistic "what does it cost to render this animation" entry — no viewer UI chrome.
// Mirrors exactly what a real consumer of the tiny player would import and call.

import { createEngine, resizeEngine } from "../../../packages/babylon-lite/src/engine/engine.js";
import { createLottiePlayer, renderLottieFrame } from "../src/player.js";
import type { LottieFile } from "../src/lottie-raw.js";

export async function run(canvas: HTMLCanvasElement, file: LottieFile): Promise<void> {
    const engine = await createEngine(canvas, { alphaMode: "premultiplied", msaaSamples: 4 });
    resizeEngine(engine);
    const player = createLottiePlayer(engine, file);
    renderLottieFrame(player, 50);
}

// Prevent the bundler from tree-shaking the entry away.
(globalThis as unknown as { __run?: unknown }).__run = run;
