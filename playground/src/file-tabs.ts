import type { PlaygroundEditor } from "./editor";

// Horizontal file-tab bar for the multi-file editor. Renders one tab per file with
// an entry-file marker (the dot), inline rename (double-click), delete (×), and a
// trailing "+" to add a file. It reads/writes file state through the editor and
// re-renders whenever the editor's file set or active file changes.

/** A sensible default body for a freshly added module. */
const NEW_FILE_TEMPLATE = "export {};\n";

export function mountFileTabs(container: HTMLElement, editor: PlaygroundEditor): void {
    function render(): void {
        const names = editor.getFileNames();
        const active = editor.getActive();
        const entry = editor.getEntry();

        // If only the active/entry file changed (same files in the same order), update
        // classes in place instead of rebuilding — rebuilding would detach the tab
        // node mid-interaction (e.g. between the two clicks of a rename double-click).
        const existing = Array.from(container.querySelectorAll<HTMLElement>(".file-tab")).map((el) => el.dataset.name ?? "");
        if (existing.length === names.length && existing.every((name, i) => name === names[i])) {
            for (const tab of container.querySelectorAll<HTMLElement>(".file-tab")) {
                const name = tab.dataset.name ?? "";
                tab.classList.toggle("is-active", name === active);
                tab.classList.toggle("is-entry", name === entry);
            }
            return;
        }

        container.replaceChildren();
        for (const name of names) {
            container.appendChild(buildTab(name, name === active, name === entry, names.length));
        }

        const add = document.createElement("button");
        add.className = "file-tab-add";
        add.type = "button";
        add.title = "Add file";
        add.setAttribute("aria-label", "Add file");
        add.textContent = "+";
        add.addEventListener("click", () => editor.addFile("file.ts", NEW_FILE_TEMPLATE));
        container.appendChild(add);
    }

    function buildTab(name: string, isActive: boolean, isEntry: boolean, fileCount: number): HTMLElement {
        const tab = document.createElement("div");
        tab.className = "file-tab" + (isActive ? " is-active" : "") + (isEntry ? " is-entry" : "");
        tab.dataset.name = name;

        // Entry marker: click to make this file the bundle entry point.
        const dot = document.createElement("button");
        dot.className = "file-tab-dot";
        dot.type = "button";
        dot.title = isEntry ? "Entry file" : "Set as entry file";
        dot.setAttribute("aria-label", dot.title);
        dot.addEventListener("click", (event) => {
            event.stopPropagation();
            editor.setEntry(name);
        });
        tab.appendChild(dot);

        const label = document.createElement("span");
        label.className = "file-tab-label";
        label.textContent = name;
        label.addEventListener("click", () => editor.setActive(name));
        label.addEventListener("dblclick", () => beginRename(tab, name));
        tab.appendChild(label);

        if (fileCount > 1) {
            const close = document.createElement("button");
            close.className = "file-tab-close";
            close.type = "button";
            close.title = "Delete file";
            close.setAttribute("aria-label", `Delete ${name}`);
            close.textContent = "×";
            close.addEventListener("click", (event) => {
                event.stopPropagation();
                editor.removeFile(name);
            });
            tab.appendChild(close);
        }

        return tab;
    }

    function beginRename(tab: HTMLElement, name: string): void {
        const input = document.createElement("input");
        input.className = "file-tab-rename";
        input.value = name;
        input.spellcheck = false;
        const label = tab.querySelector(".file-tab-label");
        if (!label) {
            return;
        }
        tab.replaceChild(input, label);
        input.focus();
        input.setSelectionRange(0, name.lastIndexOf(".") > 0 ? name.lastIndexOf(".") : name.length);

        let committed = false;
        const commit = (apply: boolean): void => {
            if (committed) {
                return;
            }
            committed = true;
            if (apply) {
                editor.renameFile(name, input.value);
            }
            render();
        };
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                commit(true);
            } else if (event.key === "Escape") {
                commit(false);
            }
        });
        input.addEventListener("blur", () => commit(true));
    }

    editor.onChange(render);
    render();
}
