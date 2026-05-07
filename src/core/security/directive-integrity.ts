/**
 * Directive Integrity Module
 *
 * Provides SHA-256 integrity verification for the Permanent Active Directives (PAD).
 * The PAD is the root governance document for all Prism intelligence systems.
 * Per Law 10: "shall not permanently modify its core directives without explicit,
 * cryptographically secured approval from Governance."
 *
 * This module:
 *   - Reads PAD from disk and computes its SHA-256 hash
 *   - Compares against a hardcoded known-good hash constant
 *   - Exports verification functions for use at boot, in CI gates, and by the Guardian Agent
 *
 * The known-good hash can only change via a code commit (git + CI + review),
 * which serves as the "cryptographically secured approval" mechanism.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    DIRECTIVE_SHA256_GENERATED,
    DIRECTIVE_HASH_GENERATED_AT,
} from "./directive-hash.generated.js";

/* ── Known-Good Directive Hash ───────────────────────────────────────── */

/**
 * SHA-256 hex digest of Permanent_Active_Directives.txt (UTF-8).
 *
 * The value is sourced from `directive-hash.generated.ts`, which is rebuilt by
 * `scripts/compute-directive-hash.cjs` on every `npm run prebuild`. Editing
 * the PAD therefore produces a tracked diff in the generated file that MUST
 * be committed alongside the PAD change — satisfying Law 10's
 * "cryptographically secured approval" requirement (git + CI + code review)
 * while eliminating the prior risk of a stale hardcoded constant.
 *
 * The generation timestamp is exported for inclusion in audit events.
 */
export const DIRECTIVE_SHA256: string = DIRECTIVE_SHA256_GENERATED;

/** ISO-8601 timestamp of the most recent prebuild hash regeneration. */
export const DIRECTIVE_HASH_LAST_GENERATED_AT: string = DIRECTIVE_HASH_GENERATED_AT;

/** Filename of the Permanent Active Directives document. */
export const DIRECTIVE_FILENAME = "Permanent_Active_Directives.txt";

/* ── Types ───────────────────────────────────────────────────────────── */

export interface DirectiveIntegrityResult {
    /** Whether the current file hash matches the known-good hash. */
    valid: boolean;
    /** SHA-256 hex digest computed from the file on disk. */
    currentHash: string;
    /** The hardcoded known-good hash constant. */
    expectedHash: string;
    /** Absolute path to the directive file that was verified. */
    filePath: string;
    /** ISO 8601 timestamp of the verification. */
    verifiedAt: string;
    /** If the file could not be read, the error message. */
    error?: string;
}

/* ── Core Functions ──────────────────────────────────────────────────── */

/**
 * Locate the PAD file relative to the workspace root.
 * Walks up from this module's directory to find the project root
 * (identified by the presence of the PAD file itself or package.json).
 */
function resolveDirectivePath(workspaceRoot?: string): string {
    if (workspaceRoot) {
        return join(workspaceRoot, DIRECTIVE_FILENAME);
    }
    
    // Resolve robustly whether running from `src/` (via tsx) or `dist/`
    let currentDir = dirname(fileURLToPath(import.meta.url));
    while (currentDir !== "/" && !currentDir.match(/^[a-zA-Z]:\\$/)) {
        if (existsSync(join(currentDir, "package.json"))) {
            return join(currentDir, DIRECTIVE_FILENAME);
        }
        currentDir = dirname(currentDir);
    }
    
    // Fallback if package.json isn't found
    return join(process.cwd(), DIRECTIVE_FILENAME);
}

/**
 * Compute the SHA-256 hex digest of the PAD file content.
 * Returns the hash string, or null if the file cannot be read.
 */
export function computeDirectiveHash(workspaceRoot?: string): string | null {
    const filePath = resolveDirectivePath(workspaceRoot);
    if (!existsSync(filePath)) return null;
    try {
        const content = readFileSync(filePath, "utf8");
        return createHash("sha256").update(content, "utf8").digest("hex");
    } catch {
        return null;
    }
}

/**
 * Verify the integrity of the Permanent Active Directives file.
 * Compares the on-disk SHA-256 hash against the hardcoded known-good constant.
 *
 * @param workspaceRoot - Optional absolute path to the workspace root directory.
 * @returns DirectiveIntegrityResult with validity status and hash details.
 */
export function verifyDirectiveIntegrity(workspaceRoot?: string): DirectiveIntegrityResult {
    const filePath = resolveDirectivePath(workspaceRoot);
    const verifiedAt = new Date().toISOString();

    if (!existsSync(filePath)) {
        return {
            valid: false,
            currentHash: "",
            expectedHash: DIRECTIVE_SHA256,
            filePath,
            verifiedAt,
            error: `Directive file not found: ${filePath}`,
        };
    }

    try {
        const content = readFileSync(filePath, "utf8");
        const currentHash = createHash("sha256").update(content, "utf8").digest("hex");

        return {
            valid: currentHash === DIRECTIVE_SHA256,
            currentHash,
            expectedHash: DIRECTIVE_SHA256,
            filePath,
            verifiedAt,
        };
    } catch (err) {
        return {
            valid: false,
            currentHash: "",
            expectedHash: DIRECTIVE_SHA256,
            filePath,
            verifiedAt,
            error: `Failed to read directive file: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

/**
 * Get the current SHA-256 hash of the PAD file (for inclusion in audit events).
 * Returns the hash string or "UNAVAILABLE" if the file cannot be read.
 */
export function getDirectiveHash(workspaceRoot?: string): string {
    return computeDirectiveHash(workspaceRoot) ?? "UNAVAILABLE";
}
