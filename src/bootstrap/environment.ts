/**
 * PRISM Bootstrap — Environment Validation
 *
 * Validates the runtime environment before any subsystems are initialized.
 * Fails fast in production, warns in development.
 *
 * Extracted from `src/index.ts` monolith as part of Phase R (Readiness) audit remediation.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface EnvValidationResult {
    isProduction: boolean;
    warnings: string[];
    fatals: string[];
    resolvedJwtSecret: string;
}

/**
 * Validate the runtime environment. Returns warnings and fatal errors.
 * Caller must check `fatals.length > 0` and refuse to boot if so in production.
 */
export function validateEnvironment(): EnvValidationResult {
    const isProduction = process.env.NODE_ENV === "production";
    const warnings: string[] = [];
    const fatals: string[] = [];
    let resolvedJwtSecret = process.env.PRISM_JWT_SECRET ?? "";

    // ── JWT Secret ────────────────────────────────────────────────────────
    if (resolvedJwtSecret.length < 32) {
        if (isProduction) {
            fatals.push(
                "PRISM_JWT_SECRET must be set to a string of at least 32 characters " +
                "(generate via: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")",
            );
        } else {
            // Dev convenience: auto-generate a persistent secret stored under
            // the workspace data dir so the warning does not fire on every
            // restart and so the same token survives across reboots.
            try {
                const dataDir = process.env.PRISM_DATA_DIR
                    ?? join(process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(), ".prism");
                mkdirSync(dataDir, { recursive: true });
                const secretPath = join(dataDir, ".prism-jwt-secret");
                let secret = "";
                if (existsSync(secretPath)) {
                    secret = readFileSync(secretPath, "utf8").trim();
                }
                if (secret.length < 32) {
                    secret = randomBytes(32).toString("hex");
                    writeFileSync(secretPath, secret, { encoding: "utf8", mode: 0o600 });
                    console.warn(
                        `[PRISM][startup] PRISM_JWT_SECRET not set — generated a development ` +
                        `secret at ${secretPath} (mode 0600). Set PRISM_JWT_SECRET explicitly for ` +
                        `production deployments.`,
                    );
                }
                resolvedJwtSecret = secret;
                process.env.PRISM_JWT_SECRET = secret;
            } catch (err) {
                warnings.push(
                    "PRISM_JWT_SECRET not set and dev auto-generation failed " +
                    `(${(err as Error).message}) — authentication may be insecure`,
                );
            }
        }
    }

    // ── Auth disabled guard ───────────────────────────────────────────────
    if (process.env.PRISM_AUTH_DISABLED === "true") {
        const msg = "PRISM_AUTH_DISABLED=true disables dashboard authentication entirely";
        if (isProduction) fatals.push(`${msg} — forbidden when NODE_ENV=production`);
        else warnings.push(`${msg} — only acceptable in development`);
    }

    // ── Production data dir ───────────────────────────────────────────────
    if (isProduction && !process.env.PRISM_DATA_DIR) {
        fatals.push(
            "PRISM_DATA_DIR must be set in production so SQLite databases, characters, " +
            "plugin packs, and audit logs are persistent across container restarts",
        );
    }

    // ── Dashboard port ────────────────────────────────────────────────────
    if (!process.env.PRISM_DASHBOARD_PORT) {
        warnings.push("PRISM_DASHBOARD_PORT not set — defaulting to 7070");
    }

    return { isProduction, warnings, fatals, resolvedJwtSecret };
}

/**
 * Resolve runtime mode from environment or CLI args.
 */
export function resolveRuntimeMode(rawMode?: string): "demo" | "server" {
    const normalized = (rawMode ?? "").trim().toLowerCase();
    if (normalized === "server" || normalized === "web") {
        return "server";
    }
    return "demo";
}

/**
 * Resolve and validate a numeric interval from a raw environment value.
 */
export function resolveIntervalMs(rawValue: string | undefined, fallbackMs: number): number {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallbackMs;
    }
    const minimumMs = 60_000;
    return Math.max(minimumMs, Math.floor(parsed));
}

/**
 * Resolve dashboard port from environment or default.
 */
export function resolveDashboardPort(rawValue?: string): number {
    const port = Number(rawValue ?? 7070);
    return Number.isFinite(port) ? port : 7070;
}

/**
 * Print environment validation results to console.
 */
export function printEnvValidation(warnings: string[], fatals: string[], isProduction: boolean): void {
    for (const warn of warnings) {
        console.warn(`[PRISM][startup] WARN: ${warn}`);
    }

    if (fatals.length > 0) {
        console.error("\n[PRISM][startup] FATAL: refusing to boot in production with the following issues:");
        for (const fatal of fatals) {
            console.error(`  - ${fatal}`);
        }
        console.error(
            "\nSet NODE_ENV=development for local work, or fix the environment and retry. " +
            "See .env.example at the workspace root for documentation of every variable.",
        );
        process.exit(1);
    }
}

/**
 * Ensure `.env` exists from `.env.example` on first run.
 * Silent if `.env` already exists or `.env.example` is missing.
 */
export function ensureEnvFile(): void {
    const envPath = resolve(process.cwd(), ".env");
    const examplePath = resolve(process.cwd(), ".env.example");

    if (existsSync(envPath)) return; // Already configured
    if (!existsSync(examplePath)) {
        console.warn("[PRISM][startup] WARN: .env.example not found — skipping first-run env setup.");
        return;
    }

    try {
        copyFileSync(examplePath, envPath);
        console.warn(
            "[PRISM][startup] WARN: No .env found — created one from .env.example.\n" +
            "  Open .env in your editor to configure PRISM_JWT_SECRET and other settings.",
        );
    } catch (err) {
        console.warn(
            "[PRISM][startup] WARN: Could not auto-create .env from .env.example: " +
            `${(err as Error).message}`,
        );
    }
}