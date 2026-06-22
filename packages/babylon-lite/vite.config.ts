import { defineConfig, type Plugin } from "vite";
import { resolve } from "path";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import dts from "vite-plugin-dts";
import { trimInternalDts } from "../../scripts/vite-trim-internal-dts";

/**
 * api-extractor's trim pass works around #4260 by dropping top-level imports kept
 * alive only by `@internal` members. We tag the failure mode `ae-internal-missing-underscore`
 * as an error so the trim stays paired with the `underscore-requires-internal` ESLint rule.
 * See {@link trimInternalDts} for the shared implementation.
 */

/**
 * Resolve the version this build should report. The release pipeline resolves the
 * next published version *before* `pnpm build` and exposes it as `PACKAGE_VERSION`
 * (see scripts/prepare-npm-release.ts), so both the runtime `VERSION` constant
 * (baked in via the `define` below) and the emitted `package.json` report the
 * version the package actually ships as. Outside the release pipeline (local
 * builds) it falls back to this package's source `version`.
 */
function resolveReleaseVersion(): string {
    const fromEnv = process.env.PACKAGE_VERSION?.trim();
    if (fromEnv) {
        return fromEnv;
    }
    const { version } = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as { version?: string };
    return version ?? "0.1.0";
}

/**
 * Release provenance recorded into the published `package.json` so the publish
 * script can dedupe re-runs of the same Azure build (see `getPublishedBuildId`
 * in scripts/prepare-npm-release.ts). Populated only inside the pipeline, where
 * `BUILD_BUILDID` / `BUILD_SOURCEVERSION` are set.
 */
function resolveReleaseProvenance(): { azureBuildId?: string; sourceVersion?: string } | undefined {
    const azureBuildId = process.env.BUILD_BUILDID;
    const sourceVersion = process.env.BUILD_SOURCEVERSION;
    if (!azureBuildId && !sourceVersion) {
        return undefined;
    }
    return {
        ...(azureBuildId ? { azureBuildId } : {}),
        ...(sourceVersion ? { sourceVersion } : {}),
    };
}

/**
 * Emit a publish-ready package.json into the build output directory and copy
 * the README and LICENSE alongside it so the published package is complete.
 */
function emitPackageJson(outDir: string): Plugin {
    return {
        name: "emit-package-json",
        writeBundle() {
            const provenance = resolveReleaseProvenance();
            const pkg = {
                name: "@babylonjs/lite",
                version: resolveReleaseVersion(),
                description: "A lightweight, tree-shakable, WebGPU-first rendering library derived from Babylon.js.",
                license: "Apache-2.0",
                homepage: "https://doc.babylonjs.com/lite/",
                repository: {
                    type: "git",
                    url: "https://github.com/BabylonJS/Babylon-Lite.git",
                },
                type: "module",
                main: "./index.js",
                module: "./index.js",
                types: "./index.d.ts",
                exports: {
                    ".": {
                        import: "./index.js",
                        types: "./index.d.ts",
                    },
                },
                sideEffects: false,
                ...(provenance ? { babylonLiteRelease: provenance } : {}),
            };
            writeFileSync(resolve(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
            copyFileSync(resolve(__dirname, "README.md"), resolve(outDir, "README.md"));
            copyFileSync(resolve(__dirname, "../../LICENSE"), resolve(outDir, "LICENSE"));
        },
    };
}

/**
 * Third-party packages whose code is bundled into the published output (as
 * opposed to dev-only tooling, which never ships). Each runtime dependency's
 * license text must be propagated per its MIT/Apache-2.0 attribution terms.
 * Keep this list in sync with the `dependencies` field of package.json.
 */
const BUNDLED_DEPENDENCIES = ["manifold-3d", "@recast-navigation/core", "@recast-navigation/generators", "@recast-navigation/wasm", "text-shaper"];

/**
 * Resolve a bundled dependency's installed directory. These are declared
 * runtime `dependencies`, so the package manager installs them under this
 * package's `node_modules`. We read from there directly rather than resolving
 * the dependency specifier, because several of them restrict access via their
 * `exports` map (resolving the bare entry or `package.json` throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED).
 */
function resolveDependencyDir(dep: string): string {
    const dir = resolve(__dirname, "node_modules", dep);
    const pkgJson = resolve(dir, "package.json");
    if (!existsSync(pkgJson)) {
        throw new Error(`Could not locate installed package directory for bundled dependency "${dep}" at ${dir}`);
    }
    return dir;
}

/**
 * Generate THIRD_PARTY_NOTICES.txt by aggregating the license text of every
 * bundled runtime dependency. Generated at build time so the notices stay in
 * sync with the actual dependency versions on each release. Fails the build if
 * a license file cannot be located, so attribution is never silently dropped.
 */
function emitThirdPartyNotices(outDir: string): Plugin {
    return {
        name: "emit-third-party-notices",
        writeBundle() {
            const sections: string[] = [
                "@babylonjs/lite bundles the following third-party open source software.",
                "Their license texts are reproduced below as required by their terms.",
            ];
            for (const dep of BUNDLED_DEPENDENCIES) {
                const pkgDir = resolveDependencyDir(dep);
                const { version } = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8")) as { version: string };
                const licenseFile = readdirSync(pkgDir).find((f) => /^(license|licence|copying)/i.test(f));
                if (!licenseFile) {
                    throw new Error(`No license file found for bundled dependency "${dep}" in ${pkgDir}`);
                }
                const licenseText = readFileSync(resolve(pkgDir, licenseFile), "utf8").trimEnd();
                const divider = "=".repeat(78);
                sections.push(`${divider}\n${dep} ${version}\n${divider}\n\n${licenseText}`);
            }
            writeFileSync(resolve(outDir, "THIRD_PARTY_NOTICES.txt"), sections.join("\n\n") + "\n");
        },
    };
}

export default defineConfig(({ mode }) => {
    const outDir = mode === "prod" ? "dist/prod" : "dist";
    const isWatch = process.argv.includes("--watch");
    return {
        // Bake the resolved version into the `VERSION` export (engine.ts reads
        // `__BL_VERSION__`). esbuild constant-folds the `typeof` guard so the
        // published bundle reports the npm version it ships as.
        define: {
            __BL_VERSION__: JSON.stringify(resolveReleaseVersion()),
        },
        build: {
            lib: {
                entry: resolve(__dirname, "src/index.ts"),
                formats: ["es"],
                fileName: "index",
            },
            outDir,
            sourcemap: true,
            minify: mode === "prod" ? "esbuild" : false,
        },
        plugins: [
            dts({
                rollupTypes: !isWatch,
                tsconfigPath: resolve(__dirname, "tsconfig.json"),
                outDir,
            }),
            ...(isWatch ? [] : [trimInternalDts({ outDir, projectFolder: __dirname })]),
            emitPackageJson(outDir),
            emitThirdPartyNotices(outDir),
        ],
    };
});
