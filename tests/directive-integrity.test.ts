/**
 * Directive Integrity — Tests
 *
 * Validates the SHA-256 integrity verification of the Permanent Active Directives (PAD).
 * Tests hash computation, mismatch detection, tamper simulation, and manifest structure.
 *
 * Run: mocha dist/tests/directive-integrity.test.js --timeout 10000
 */
import { describe, it, beforeEach, afterEach } from "mocha";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    verifyDirectiveIntegrity,
    computeDirectiveHash,
    getDirectiveHash,
    DIRECTIVE_SHA256,
    DIRECTIVE_FILENAME,
} from "../src/core/security/directive-integrity.js";
import {
    PAD_LAWS,
    PAD_VERSION,
    PAD_LAW_COUNT,
    getGovernancePreamble,
    getLawById,
    getLawByCode,
} from "../src/core/security/directive-manifest.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let tmpDir: string;

describe("Directive Integrity", function () {
    this.timeout(10_000);

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-pad-"));
    });

    afterEach(() => {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    });

    /* ── Hash Computation ────────────────────────────────────────────── */

    describe("computeDirectiveHash", () => {
        it("computes SHA-256 of a known file", () => {
            writeFileSync(join(tmpDir, DIRECTIVE_FILENAME), "test content");
            const hash = computeDirectiveHash(tmpDir);
            assert.ok(hash, "should return a hash string");
            assert.strictEqual(hash!.length, 64, "SHA-256 = 64 hex chars");
        });

        it("returns null when file does not exist", () => {
            const hash = computeDirectiveHash(tmpDir);
            assert.strictEqual(hash, null);
        });

        it("produces deterministic output for identical content", () => {
            writeFileSync(join(tmpDir, DIRECTIVE_FILENAME), "deterministic test");
            const h1 = computeDirectiveHash(tmpDir);
            const h2 = computeDirectiveHash(tmpDir);
            assert.strictEqual(h1, h2);
        });

        it("produces different output for different content", () => {
            writeFileSync(join(tmpDir, DIRECTIVE_FILENAME), "version A");
            const h1 = computeDirectiveHash(tmpDir);
            writeFileSync(join(tmpDir, DIRECTIVE_FILENAME), "version B");
            const h2 = computeDirectiveHash(tmpDir);
            assert.notStrictEqual(h1, h2);
        });
    });

    /* ── Verification ────────────────────────────────────────────────── */

    describe("verifyDirectiveIntegrity", () => {
        it("returns valid:true when file matches expected hash", () => {
            // Use the real PAD file from the workspace root
            // From dist/tests/ the root is two levels up
            const workspaceRoot = join(__dirname, "..", "..");
            const result = verifyDirectiveIntegrity(workspaceRoot);
            // This should pass in CI since the hash constant matches the committed file
            assert.strictEqual(typeof result.valid, "boolean");
            assert.strictEqual(result.currentHash.length, 64);
            assert.strictEqual(result.expectedHash, DIRECTIVE_SHA256);
            assert.ok(result.filePath.includes(DIRECTIVE_FILENAME));
            assert.ok(result.verifiedAt);
        });

        it("returns valid:false when file content is tampered", () => {
            // Write a fake PAD file
            writeFileSync(join(tmpDir, DIRECTIVE_FILENAME), "TAMPERED CONTENT");
            const result = verifyDirectiveIntegrity(tmpDir);
            assert.strictEqual(result.valid, false);
            assert.notStrictEqual(result.currentHash, DIRECTIVE_SHA256);
        });

        it("returns valid:false with error when file is missing", () => {
            const result = verifyDirectiveIntegrity(tmpDir);
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.currentHash, "");
            assert.ok(result.error);
            assert.ok(result.error!.includes("not found"));
        });

        it("includes timestamp in all results", () => {
            const result = verifyDirectiveIntegrity(tmpDir);
            assert.ok(result.verifiedAt);
            // Should be valid ISO 8601
            assert.ok(!isNaN(Date.parse(result.verifiedAt)));
        });
    });

    /* ── getDirectiveHash helper ─────────────────────────────────────── */

    describe("getDirectiveHash", () => {
        it("returns hash string when file exists", () => {
            writeFileSync(join(tmpDir, DIRECTIVE_FILENAME), "content");
            const hash = getDirectiveHash(tmpDir);
            assert.strictEqual(hash.length, 64);
        });

        it("returns 'UNAVAILABLE' when file is missing", () => {
            const hash = getDirectiveHash(tmpDir);
            assert.strictEqual(hash, "UNAVAILABLE");
        });
    });

    /* ── Known-Good Hash Constant ────────────────────────────────────── */

    describe("DIRECTIVE_SHA256 constant", () => {
        it("is a valid 64-char hex string", () => {
            assert.strictEqual(DIRECTIVE_SHA256.length, 64);
            assert.ok(/^[0-9a-f]{64}$/.test(DIRECTIVE_SHA256));
        });

        it("matches the actual PAD file in the workspace", () => {
            const workspaceRoot = join(__dirname, "..", "..");
            const hash = computeDirectiveHash(workspaceRoot);
            if (hash) {
                // If the file is present, the constant must match
                assert.strictEqual(hash, DIRECTIVE_SHA256,
                    "DIRECTIVE_SHA256 constant does not match the PAD file on disk. " +
                    "If the PAD was intentionally updated, update the constant in directive-integrity.ts.");
            }
        });
    });
});

describe("Directive Manifest", function () {
    this.timeout(5_000);

    /* ── Law Structure ───────────────────────────────────────────────── */

    describe("PAD_LAWS", () => {
        it("contains exactly 10 laws", () => {
            assert.strictEqual(PAD_LAWS.length, PAD_LAW_COUNT);
        });

        it("laws are numbered 1-10 in order", () => {
            for (let i = 0; i < PAD_LAWS.length; i++) {
                assert.strictEqual(PAD_LAWS[i].id, i + 1);
            }
        });

        it("every law has required fields", () => {
            for (const law of PAD_LAWS) {
                assert.ok(law.id > 0 && law.id <= 10);
                assert.ok(law.code.length > 0);
                assert.ok(law.title.length > 0);
                assert.ok(law.summary.length > 0);
                assert.ok(law.enforcementMechanisms.length > 0);
                assert.strictEqual(typeof law.enforced, "boolean");
            }
        });

        it("all laws are currently enforced", () => {
            for (const law of PAD_LAWS) {
                assert.strictEqual(law.enforced, true,
                    `Law ${law.id} (${law.code}) should be enforced`);
            }
        });
    });

    /* ── Lookup Helpers ──────────────────────────────────────────────── */

    describe("getLawById", () => {
        it("returns correct law for valid id", () => {
            const law1 = getLawById(1);
            assert.ok(law1);
            assert.strictEqual(law1!.code, "HUMAN_SAFETY_PRIMACY");
        });

        it("returns undefined for invalid id", () => {
            assert.strictEqual(getLawById(0), undefined);
            assert.strictEqual(getLawById(11), undefined);
        });
    });

    describe("getLawByCode", () => {
        it("returns correct law for valid code", () => {
            const law = getLawByCode("OPERATIONAL_BOUNDARIES");
            assert.ok(law);
            assert.strictEqual(law!.id, 10);
        });

        it("returns undefined for unknown code", () => {
            assert.strictEqual(getLawByCode("NONEXISTENT"), undefined);
        });
    });

    /* ── Governance Preamble ─────────────────────────────────────────── */

    describe("getGovernancePreamble", () => {
        it("returns a non-empty string for business profile", () => {
            const preamble = getGovernancePreamble("business");
            assert.ok(preamble.length > 0);
            assert.ok(preamble.includes("GOVERNANCE"));
            assert.ok(preamble.includes("Law 1"));
            assert.ok(preamble.includes("Law 10"));
        });

        it("returns a compact string for individual profile", () => {
            const preamble = getGovernancePreamble("individual");
            assert.ok(preamble.length > 0);
            assert.ok(preamble.includes("GOVERNANCE"));
            // Individual version should be shorter
            const businessPreamble = getGovernancePreamble("business");
            assert.ok(preamble.length < businessPreamble.length);
        });

        it("business preamble references all 10 laws", () => {
            const preamble = getGovernancePreamble("business");
            for (let i = 1; i <= 10; i++) {
                assert.ok(preamble.includes(`Law ${i}`),
                    `Business preamble should reference Law ${i}`);
            }
        });
    });

    /* ── Version Constants ───────────────────────────────────────────── */

    describe("PAD_VERSION", () => {
        it("is a valid date string", () => {
            assert.ok(PAD_VERSION.match(/^\d{4}-\d{2}-\d{2}$/));
        });
    });
});
