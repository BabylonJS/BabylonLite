// Standalone viewer: Babylon Lite engine + the tiny Lottie morph player.

import { createEngine, resizeEngine } from "../../../packages/babylon-lite/src/engine/engine.js";
import type { LottieFile } from "./lottie-raw.js";
import { createLottiePlayer, renderLottieFrame } from "./player.js";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const stage = document.getElementById("stage") as HTMLDivElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const scrub = document.getElementById("scrub") as HTMLInputElement;
const stat = document.getElementById("stat") as HTMLSpanElement;
const bgSel = document.getElementById("bg") as HTMLSelectElement;
const fileSel = document.getElementById("file") as HTMLSelectElement;
const errBox = document.getElementById("err") as HTMLDivElement;

// Which animation to load (?file=teams.json default). The selector reloads with a new value.
const params = new URLSearchParams(location.search);
const animFile = params.get("file") ?? "teams.json";
const animUrl = "/" + animFile;
if (fileSel) {
    fileSel.value = animFile;
    fileSel.addEventListener("change", () => {
        params.set("file", fileSel.value);
        location.search = params.toString();
    });
}

function fail(message: string): void {
    errBox.style.display = "grid";
    errBox.textContent = message;
}

async function main(): Promise<void> {
    if (!navigator.gpu) {
        fail("WebGPU is not available in this browser.");
        return;
    }

    const engine = await createEngine(canvas, { alphaMode: "premultiplied", msaaSamples: 4 });
    resizeEngine(engine);

    // Surface WebGPU validation errors (they would otherwise silently invalidate frames).
    engine._device.addEventListener("uncapturederror", (e: Event) => {
        // eslint-disable-next-line no-console
        console.error("WebGPU error:", (e as GPUUncapturedErrorEvent).error.message);
    });

    const file = (await (await fetch(animUrl)).json()) as LottieFile;
    const player = await createLottiePlayer(engine, file);

    const ip = file.ip;
    const op = file.op;
    scrub.min = String(ip);
    scrub.max = String(op);

    let frame = ip;
    let playing = true;
    let last = performance.now();

    bgSel.addEventListener("change", () => {
        stage.dataset.bg = bgSel.value;
    });
    playBtn.addEventListener("click", () => {
        playing = !playing;
        playBtn.textContent = playing ? "Pause" : "Play";
        last = performance.now();
    });
    scrub.addEventListener("input", () => {
        playing = false;
        playBtn.textContent = "Play";
        frame = parseFloat(scrub.value);
    });
    window.addEventListener("resize", () => resizeEngine(engine));

    function loop(now: number): void {
        if (playing) {
            const dt = (now - last) / 1000;
            frame += dt * file.fr;
            const span = op - ip;
            if (frame >= op) {
                frame = ip + ((frame - ip) % span);
            }
            scrub.value = String(frame);
        }
        last = now;

        renderLottieFrame(player, frame);
        stat.textContent = `frame ${frame.toFixed(1)} / ${op}`;
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

main().catch((e: unknown) => fail(String(e instanceof Error ? (e.stack ?? e.message) : e)));
