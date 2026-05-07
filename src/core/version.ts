/**
 * Centralized version source for PRISM. Reads `package.json` once at module
 * load so every subsystem (health endpoint, OTel resource, OpenAPI document,
 * dashboard header, TUI chrome) reports the same string.
 *
 * The package.json file is co-located at the repository root in production
 * builds (it is excluded from `dist/` but accessible relative to the running
 * Node process via the workspace resolver).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadVersion(): string {
    const fromEnv = (process.env.PRISM_VERSION ?? "").trim();
    if (fromEnv) {
        return fromEnv;
    }
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        // dist/src/core/version.js → ../../../package.json
        // src/core/version.ts (tsx)  → ../../package.json
        const candidates = [
            resolve(here, "..", "..", "..", "package.json"),
            resolve(here, "..", "..", "package.json"),
            resolve(process.cwd(), "package.json"),
        ];
        for (const candidate of candidates) {
            try {
                const raw = readFileSync(candidate, "utf8");
                const parsed = JSON.parse(raw) as { name?: string; version?: string };
                if (parsed.name === "prism-core" && typeof parsed.version === "string" && parsed.version.length > 0) {
                    return parsed.version;
                }
            } catch {
                continue;
            }
        }
    } catch {
        // fall through
    }
    return "0.0.0-unknown";
}

export const PRISM_VERSION: string = loadVersion();
