import { createEngine, startEngine, loadSpriteAtlas, createSprite2DLayer, addSprite2DIndex, createSpriteRenderer, registerSpriteRenderer } from "babylon-lite";

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

    const engine = await createEngine(canvas);
    const atlas = await loadSpriteAtlas(engine, "/sprites/atlas.png", { gridSize: [32, 32] });

    const layer = createSprite2DLayer(atlas, { blendMode: "alpha", depth: "none" });
    addSprite2DIndex(layer, { positionPx: [100, 100], sizePx: [64, 64], frame: 0 });
    addSprite2DIndex(layer, { positionPx: [200, 150], sizePx: [64, 64], frame: 1 });
    addSprite2DIndex(layer, { positionPx: [300, 200], sizePx: [128, 128], frame: 2, rotation: 0.3 });
    addSprite2DIndex(layer, { positionPx: [500, 300], sizePx: [64, 64], frame: 3, color: [1, 0.5, 0.5, 1] });
    addSprite2DIndex(layer, { positionPx: [650, 450], sizePx: [96, 96], frame: 0, flipX: true });

    const sr = createSpriteRenderer(engine, {
        layers: [layer],
        clearValue: { r: 0.1, g: 0.12, b: 0.18, a: 1.0 },
    });
    registerSpriteRenderer(engine, sr);

    await startEngine(engine);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
});
