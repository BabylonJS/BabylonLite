/**
 * Loads .env.local (if present) then spawns browserstack-node-sdk with
 * the remaining argv. This ensures BrowserStack credentials from .env.local
 * are available as env vars before the SDK reads browserstack.yml.
 */
import { config } from "dotenv";
import { execSync } from "child_process";
import { resolve } from "path";

config({ path: ".env.local" });
config(); // .env fallback

// Tell the SDK where to find browserstack.yml (not at root)
process.env.BROWSERSTACK_CONFIG_FILE = resolve(__dirname, "../config/browserstack.yml");

const args = process.argv.slice(2).join(" ");
try {
    execSync(`npx browserstack-node-sdk ${args}`, { stdio: "inherit", env: process.env });
} catch (e: any) {
    process.exit(e.status ?? 1);
}
