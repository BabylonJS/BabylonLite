import "./styles.css";
import { createEditor } from "./editor";
import { transpile } from "./transpile";
import { Runner, type RunnerMessage } from "./runner";
import { DEFAULT_SNIPPET } from "./examples";

const editorContainer = document.getElementById("editor") as HTMLElement;
const previewHost = document.getElementById("previewHost") as HTMLElement;
const consoleEl = document.getElementById("console") as HTMLElement;
const runBtn = document.getElementById("runBtn") as HTMLButtonElement;

function appendConsole(level: string, text: string): void {
    const line = document.createElement("div");
    line.className = `line level-${level}`;
    line.textContent = text;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearConsole(): void {
    consoleEl.replaceChildren();
}

const runner = new Runner(previewHost, (message: RunnerMessage) => {
    switch (message.type) {
        case "console":
            appendConsole(message.level, message.text);
            break;
        case "error":
            appendConsole("error", message.text);
            break;
        default:
            break;
    }
});

let running = false;

async function run(): Promise<void> {
    if (running) {
        return;
    }
    running = true;
    runBtn.disabled = true;
    clearConsole();
    appendConsole("system", "Compiling…");
    try {
        const code = await transpile(editor.getValue());
        appendConsole("system", "Running…");
        await runner.run(code);
    } catch (err) {
        appendConsole("error", err instanceof Error ? (err.stack ?? err.message) : String(err));
    } finally {
        running = false;
        runBtn.disabled = false;
    }
}

const editor = createEditor(editorContainer, DEFAULT_SNIPPET, () => void run());

runBtn.addEventListener("click", () => void run());

// Auto-run the default snippet on first load.
void run();
