/**
 * Compat-layer weekly sync — PR driver.
 *
 * Runs AFTER an agent step has executed the `update-compat-layer` skill (which
 * may have edited files under `packages/babylon-lite-compat/`). This script is
 * the deterministic, CI-owned half of the job:
 *
 *   1. Re-validate independently (compat unit tests + typecheck) — we never trust
 *      the agent's self-report; the pipeline verifies.
 *   2. Detect whether the agent actually changed anything.
 *   3. If it did, create a branch, commit, push, and open a PR via the GitHub API.
 *      A failing validation does not block the PR — it is opened as a DRAFT with
 *      the failure captured in the body so a human can finish it.
 *
 * Idempotent: a week with no BJS/Lite changes produces no commit and no PR.
 *
 * Required env:
 *   - GITHUB_TOKEN        token with `contents:write` + `pull_requests:write`
 *   - GITHUB_REPOSITORY   e.g. "BabylonJS/Babylon-Lite"
 * Optional env:
 *   - BASE_BRANCH         default "master"
 *   - GIT_USER_NAME       default "Babylon.js CI"
 *   - GIT_USER_EMAIL      default "bjsplat@gmail.com"
 *   - DRY_RUN             when "true", do everything except push + open PR
 */

import { execFileSync } from "child_process";

const REPO = requireEnv("GITHUB_REPOSITORY");
const TOKEN = requireEnv("GITHUB_TOKEN");
const BASE_BRANCH = process.env.BASE_BRANCH ?? "master";
const GIT_USER_NAME = process.env.GIT_USER_NAME ?? "Babylon.js CI";
const GIT_USER_EMAIL = process.env.GIT_USER_EMAIL ?? "bjsplat@gmail.com";
const DRY_RUN = process.env.DRY_RUN === "true";

const COMPAT_PATHS = ["packages/babylon-lite-compat", "compat.md"];

async function main(): Promise<void> {
    // 1. Independent validation (does not throw — captured for the PR body).
    const validation = runValidation();

    // 2. Did the agent change anything under the compat surface?
    const changedFiles = listChangedFiles();
    if (changedFiles.length === 0) {
        console.log("No compat-layer changes this week. Nothing to do.");
        return;
    }
    console.log(`Detected ${changedFiles.length} changed file(s):\n${changedFiles.map((f) => `  ${f}`).join("\n")}`);

    // 3. Branch, commit, push, PR.
    const date = new Date().toISOString().slice(0, 10);
    const branch = `compat-sync/${date}`;
    const isDraft = !validation.passed;

    configureGit();
    runGit(["checkout", "-b", branch]);
    runGit(["add", ...COMPAT_PATHS]);
    runGit(["commit", "-m", commitMessage(date)]);

    if (DRY_RUN) {
        console.log(`[dry-run] Would push ${branch} and open a ${isDraft ? "draft " : ""}PR.`);
        return;
    }

    runGit(["push", "--force-with-lease", "origin", branch]);
    const prUrl = await openPullRequest(branch, isDraft, validation, changedFiles);
    console.log(`Opened ${isDraft ? "draft " : ""}PR: ${prUrl}`);
}

interface ValidationResult {
    passed: boolean;
    log: string;
}

function runValidation(): ValidationResult {
    const steps: Array<{ name: string; cmd: string; args: string[] }> = [
        { name: "compat unit tests", cmd: "npx", args: ["vitest", "run", "--project", "compat"] },
        { name: "compat typecheck", cmd: "npx", args: ["tsc", "-p", "packages/babylon-lite-compat/tsconfig.json", "--noEmit"] },
    ];

    let passed = true;
    const log: string[] = [];
    for (const step of steps) {
        try {
            execFileSync(step.cmd, step.args, { cwd: process.cwd(), encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
            log.push(`- ✅ ${step.name}`);
        } catch (error) {
            passed = false;
            const message = error instanceof Error ? error.message : String(error);
            log.push(`- ❌ ${step.name}\n\n\`\`\`\n${message.slice(0, 2000)}\n\`\`\``);
        }
    }
    return { passed, log: log.join("\n") };
}

function listChangedFiles(): string[] {
    const out = runGit(["status", "--porcelain", "--", ...COMPAT_PATHS]);
    return out
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
}

function commitMessage(date: string): string {
    // Conventional-commit "chore" so the npm release pipeline never mistakes a
    // compat sync for a feature/breaking change in @babylonjs/lite.
    return `chore(compat): weekly Babylon.js compat-layer sync (${date})`;
}

function bjsSha(): string {
    const out = runGit(["grep", "-hoE", "Last synced BJS commit:\\** `[0-9a-f]{7,40}`", "--", "packages/babylon-lite-compat/COMPAT-STATUS.md"], true);
    const match = out.match(/`([0-9a-f]{7,40})`/);
    return match ? match[1]! : "(unknown)";
}

async function openPullRequest(branch: string, isDraft: boolean, validation: ValidationResult, changedFiles: string[]): Promise<string> {
    const title = `chore(compat): weekly compat-layer sync`;
    const body = [
        "Automated weekly sync of `@babylonjs/lite-compat` against the latest Babylon.js and Babylon Lite changes,",
        "produced by the [`update-compat-layer`](.github/copilot/skills/update-compat-layer.md) skill.",
        "",
        `**Synced against BJS commit:** \`${bjsSha()}\``,
        "",
        "### Validation",
        validation.log,
        "",
        "### Changed files",
        changedFiles.map((f) => `- \`${f}\``).join("\n"),
        "",
        isDraft
            ? "> ⚠️ Opened as a **draft** because validation did not fully pass. A maintainer should resolve the failures above before merging."
            : "> Validation passed. Please review the wrapper changes and the updated `COMPAT-STATUS.md` before merging.",
    ].join("\n");

    const response = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ title, head: branch, base: BASE_BRANCH, body, draft: isDraft }),
    });

    if (!response.ok) {
        throw new Error(`Failed to open PR (${response.status}): ${await response.text()}`);
    }
    const json = (await response.json()) as { html_url?: string };
    return json.html_url ?? "(unknown URL)";
}

function configureGit(): void {
    runGit(["config", "user.name", GIT_USER_NAME]);
    runGit(["config", "user.email", GIT_USER_EMAIL]);
}

function runGit(args: string[], allowFailure = false): string {
    try {
        return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (error) {
        if (allowFailure) {
            return "";
        }
        throw error;
    }
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
