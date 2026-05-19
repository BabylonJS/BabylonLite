import { defineConfig, type Plugin } from "vite";
import { resolve } from "path";
import { writeFileSync } from "fs";
import dts from "vite-plugin-dts";

/** Emit a publish-ready package.json into the build output directory. */
function emitPackageJson(outDir: string): Plugin {
    return {
        name: "emit-package-json",
        writeBundle() {
            const pkg = {
                name: "@babylon-lite/thin-gl",
                version: "0.1.0",
                type: "module",
                main: "./index.js",
                module: "./index.js",
                types: "./index.d.ts",
                sideEffects: false,
                exports: {
                    ".": {
                        import: "./index.js",
                        types: "./index.d.ts",
                    },
                    "./html-texture": {
                        import: "./webgl-html-texture.js",
                        types: "./webgl-html-texture.d.ts",
                    },
                },
            };
            writeFileSync(resolve(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
        },
    };
}

export default defineConfig(({ mode }) => {
    const outDir = mode === "prod" ? "dist/prod" : "dist";
    const isWatch = process.argv.includes("--watch");
    return {
        build: {
            lib: {
                entry: {
                    index: resolve(__dirname, "src/index.ts"),
                    "webgl-html-texture": resolve(__dirname, "src/webgl-html-texture.ts"),
                },
                formats: ["es"],
            },
            outDir,
            rollupOptions: {
                external: [],
                output: {
                    preserveModules: false,
                    entryFileNames: "[name].js",
                },
            },
            sourcemap: true,
            minify: mode === "prod" ? "esbuild" : false,
        },
        plugins: [
            dts({
                rollupTypes: !isWatch,
                tsconfigPath: resolve(__dirname, "tsconfig.json"),
                outDir,
            }),
            emitPackageJson(outDir),
        ],
    };
});
