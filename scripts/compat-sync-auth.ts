/**
 * Compat-layer sync — shared GitHub auth helper.
 *
 * Resolves a usable GitHub token for the compat-sync pipeline scripts
 * (`open-compat-sync-pr.ts` and `check-open-compat-sync-pr.ts`) so they stay
 * consistent and there is exactly one place that knows how to authenticate.
 *
 * Auth resolution (provide EITHER a GitHub App OR a PAT):
 *   - GH_APP_ID + GH_APP_PRIVATE_KEY → mint a short-lived **GitHub App
 *     installation token** scoped to the repo. PRs opened with it are authored by
 *     the app's bot identity (`<app>[bot]`), so a human (even the pipeline owner)
 *     can review/approve them. Preferred path.
 *   - GITHUB_TOKEN → fallback PAT. PRs opened with it are authored by the PAT's
 *     owner, who then cannot review their own PR.
 *
 * Every secret the resolver touches (PAT, private key, minted token) is returned
 * in `secrets` so callers can redact them from logs via `makeRedactor`.
 */

import { createSign } from "crypto";

export interface ResolvedToken {
    /** Bearer token usable for `git push` and the GitHub REST API. */
    token: string;
    /** Secret strings to redact from any log/error output. */
    secrets: string[];
    /** Human-readable description of which auth path was used. */
    source: string;
}

/**
 * Resolve the GitHub token for `repo` ("owner/name"). Uses a GitHub App
 * installation token when GH_APP_ID/GH_APP_PRIVATE_KEY are configured, otherwise
 * the GITHUB_TOKEN PAT. Throws if neither is available.
 */
export async function resolveGithubToken(repo: string): Promise<ResolvedToken> {
    const appId = cleanEnv(process.env.GH_APP_ID);
    const privateKeyRaw = cleanEnv(process.env.GH_APP_PRIVATE_KEY);
    const secrets: string[] = [];

    if (appId && privateKeyRaw) {
        const privateKey = normalizePem(privateKeyRaw);
        secrets.push(privateKey);
        const token = await mintInstallationToken(appId, privateKey, repo);
        secrets.push(token);
        return {
            token,
            secrets,
            source: "GitHub App installation token (PRs authored by the app bot, reviewable)",
        };
    }

    const pat = cleanEnv(process.env.GITHUB_TOKEN);
    if (!pat) {
        throw new Error("No GitHub auth configured: set GH_APP_ID + GH_APP_PRIVATE_KEY (preferred) or GITHUB_TOKEN.");
    }
    secrets.push(pat);
    return {
        token: pat,
        secrets,
        source: "GITHUB_TOKEN PAT (no GitHub App configured; PRs authored by the PAT owner)",
    };
}

/** Build a redactor that strips every provided secret from a string before logging. */
export function makeRedactor(secrets: string[]): (text: string) => string {
    return (text: string): string => {
        let out = text;
        for (const secret of secrets) {
            if (secret) {
                out = out.split(secret).join("***");
            }
        }
        return out;
    };
}

/** Common headers for GitHub API calls authenticated with the given bearer token. */
export function githubHeaders(bearer: string): Record<string, string> {
    return {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "compat-sync-pipeline",
    };
}

/**
 * Read an env var, treating empty/whitespace AND an un-substituted ADO macro
 * (e.g. the literal `$(GH_APP_ID)` left behind when a pipeline variable is not
 * defined) as "unset". Returns the trimmed value or undefined.
 */
export function cleanEnv(raw: string | undefined): string | undefined {
    const value = raw?.trim();
    if (!value || /^\$\([^)]*\)$/.test(value)) {
        return undefined;
    }
    return value;
}

/** Normalize a PEM that may have been stored with literal `\n` instead of real newlines. */
function normalizePem(raw: string): string {
    return raw.includes("\n") ? raw : raw.replace(/\\n/g, "\n");
}

/** Base64url-encode a string or buffer (no padding), per the JWT spec. */
function base64url(input: string | Buffer): string {
    return Buffer.from(input).toString("base64url");
}

/** Build a short-lived (≤10 min) RS256 JWT used to authenticate AS the GitHub App. */
function makeAppJwt(appId: string, privateKey: string): string {
    const now = Math.floor(Date.now() / 1000);
    // `iat` is back-dated 60s to tolerate minor clock skew between us and GitHub.
    const header = { alg: "RS256", typ: "JWT" };
    const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(privateKey).toString("base64url");
    return `${signingInput}.${signature}`;
}

/**
 * Exchange the App's private key for an installation access token scoped to `repo`.
 * Discovers the installation id from the repo automatically (so no separate
 * installation-id secret is needed), then requests a token restricted to that one
 * repository with the permissions the pipeline uses.
 */
async function mintInstallationToken(appId: string, privateKey: string, repo: string): Promise<string> {
    const jwt = makeAppJwt(appId, privateKey);

    const instResponse = await fetch(`https://api.github.com/repos/${repo}/installation`, {
        headers: githubHeaders(jwt),
    });
    if (!instResponse.ok) {
        throw new Error(`Failed to find the GitHub App installation on ${repo} (${instResponse.status}): ${await instResponse.text()}. Is the App installed on this repo?`);
    }
    const installation = (await instResponse.json()) as { id?: number };
    if (!installation.id) {
        throw new Error(`GitHub App installation lookup for ${repo} returned no id.`);
    }

    const [owner, name] = repo.split("/");
    const tokenResponse = await fetch(`https://api.github.com/app/installations/${installation.id}/access_tokens`, {
        method: "POST",
        headers: { ...githubHeaders(jwt), "Content-Type": "application/json" },
        body: JSON.stringify({
            repositories: name ? [name] : undefined,
            permissions: { contents: "write", pull_requests: "write", issues: "write" },
        }),
    });
    if (!tokenResponse.ok) {
        throw new Error(`Failed to mint an installation token for ${owner}/${name} (${tokenResponse.status}): ${await tokenResponse.text()}`);
    }
    const minted = (await tokenResponse.json()) as { token?: string };
    if (!minted.token) {
        throw new Error("GitHub App token exchange returned no token.");
    }
    return minted.token;
}
