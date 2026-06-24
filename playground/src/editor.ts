import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// Wire Monaco's web workers through Vite's `?worker` imports.
self.MonacoEnvironment = {
    getWorker(_workerId, label) {
        if (label === "typescript" || label === "javascript") {
            return new tsWorker();
        }
        return new editorWorker();
    },
};

monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    strict: true,
    allowNonTsExtensions: true,
    noEmit: true,
});

export interface PlaygroundEditor {
    getValue(): string;
}

/**
 * Create the Monaco editor. Rich `@babylonjs/lite` type definitions are wired in
 * Phase 2; Phase 1 provides TypeScript editing with the default snippet and a
 * Ctrl/Cmd+Enter run shortcut.
 */
export function createEditor(container: HTMLElement, value: string, onRun: () => void): PlaygroundEditor {
    const editor = monaco.editor.create(container, {
        value,
        language: "typescript",
        theme: "vs-dark",
        automaticLayout: true,
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 4,
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, onRun);

    return {
        getValue: () => editor.getValue(),
    };
}
