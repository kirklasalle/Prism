/**
 * Workspace Integrity Fingerprint (WIF) — Tests
 *
 * Validates the novel WIF engine: deterministic hash trees, diff detection,
 * tamper identification, and idempotency guarantees.
 *
 * Run: mocha dist/tests/workspace-integrity.test.js --timeout 15000
 */
import { describe, it, before, after, beforeEach } from "mocha";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    computeWorkspaceFingerprint,
    diffFingerprints,
    WorkspaceFingerprint,
} from "../src/core/config/integrity-fingerprint.js";

let tmpDir: string;

describe("Workspace Integrity Fingerprint", function () {
    this.timeout(15_000);

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-wif-"));
    });

    after(() => {
        // Clean up any leftover dirs
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });

    /* ── Compute ─────────────────────────────────────────────────────── */

    describe("computeWorkspaceFingerprint", () => {
        it("returns a valid fingerprint for a populated workspace", () => {
            writeFileSync(join(tmpDir, "README.md"), "# Hello");
            mkdirSync(join(tmpDir, "config"));
            writeFileSync(join(tmpDir, "config", "settings.json"), '{"a":1}');

            const fp = computeWorkspaceFingerprint(tmpDir);
            assert.ok(fp.hash, "should have a root hash");
            assert.strictEqual(fp.hash.length, 64, "SHA-256 = 64 hex chars");
            assert.strictEqual(fp.fileCount, 2);
            assert.ok(fp.totalSize > 0);
            assert.strictEqual(fp.tree.length, 2);
            assert.ok(fp.computedAt, "should have a timestamp");
        });

        it("returns zero counts for an empty directory", () => {
            const fp = computeWorkspaceFingerprint(tmpDir);
            assert.strictEqual(fp.fileCount, 0);
            assert.strictEqual(fp.totalSize, 0);
            assert.strictEqual(fp.tree.length, 0);
            assert.strictEqual(fp.hash.length, 64, "empty hash is still valid SHA-256");
        });

        it("ignores .git and node_modules by default", () => {
            mkdirSync(join(tmpDir, ".git"));
            writeFileSync(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main");
            mkdirSync(join(tmpDir, "node_modules"));
            writeFileSync(join(tmpDir, "node_modules", "pkg.json"), "{}");
            writeFileSync(join(tmpDir, "real.txt"), "content");

            const fp = computeWorkspaceFingerprint(tmpDir);
            assert.strictEqual(fp.fileCount, 1);
            assert.strictEqual(fp.tree[0].path, "real.txt");
        });

        it("custom ignore set overrides defaults", () => {
            mkdirSync(join(tmpDir, "build"));
            writeFileSync(join(tmpDir, "build", "out.js"), "compiled");
            writeFileSync(join(tmpDir, "src.ts"), "source");

            const fp = computeWorkspaceFingerprint(tmpDir, new Set(["build"]));
            assert.strictEqual(fp.fileCount, 1);
            assert.strictEqual(fp.tree[0].path, "src.ts");
        });

        it("uses posix path separators in tree entries", () => {
            mkdirSync(join(tmpDir, "a", "b"), { recursive: true });
            writeFileSync(join(tmpDir, "a", "b", "c.txt"), "deep");

            const fp = computeWorkspaceFingerprint(tmpDir);
            assert.ok(!fp.tree[0].path.includes("\\"), "no backslashes in paths");
            assert.strictEqual(fp.tree[0].path, "a/b/c.txt");
        });

        it("tree is sorted by path", () => {
            writeFileSync(join(tmpDir, "z.txt"), "z");
            writeFileSync(join(tmpDir, "a.txt"), "a");
            mkdirSync(join(tmpDir, "m"));
            writeFileSync(join(tmpDir, "m", "inside.txt"), "m");

            const fp = computeWorkspaceFingerprint(tmpDir);
            const paths = fp.tree.map((f) => f.path);
            const sorted = [...paths].sort();
            assert.deepStrictEqual(paths, sorted);
        });
    });

    /* ── Determinism ─────────────────────────────────────────────────── */

    describe("Determinism", () => {
        it("identical content produces identical hashes", () => {
            writeFileSync(join(tmpDir, "file.txt"), "hello world");

            const fp1 = computeWorkspaceFingerprint(tmpDir);
            const fp2 = computeWorkspaceFingerprint(tmpDir);
            assert.strictEqual(fp1.hash, fp2.hash);
        });

        it("two directories with same content produce same hash", () => {
            const dir2 = mkdtempSync(join(tmpdir(), "prism-wif-dup-"));
            try {
                writeFileSync(join(tmpDir, "a.txt"), "same");
                writeFileSync(join(dir2, "a.txt"), "same");

                const fp1 = computeWorkspaceFingerprint(tmpDir);
                const fp2 = computeWorkspaceFingerprint(dir2);
                assert.strictEqual(fp1.hash, fp2.hash);
            } finally {
                rmSync(dir2, { recursive: true, force: true });
            }
        });

        it("different content produces different hashes", () => {
            writeFileSync(join(tmpDir, "f.txt"), "version1");
            const fp1 = computeWorkspaceFingerprint(tmpDir);

            writeFileSync(join(tmpDir, "f.txt"), "version2");
            const fp2 = computeWorkspaceFingerprint(tmpDir);

            assert.notStrictEqual(fp1.hash, fp2.hash);
        });

        it("different filenames with same content produce different hashes", () => {
            writeFileSync(join(tmpDir, "alpha.txt"), "content");
            const fp1 = computeWorkspaceFingerprint(tmpDir);

            unlinkSync(join(tmpDir, "alpha.txt"));
            writeFileSync(join(tmpDir, "beta.txt"), "content");
            const fp2 = computeWorkspaceFingerprint(tmpDir);

            assert.notStrictEqual(fp1.hash, fp2.hash);
        });
    });

    /* ── Diff ────────────────────────────────────────────────────────── */

    describe("diffFingerprints", () => {
        it("identical fingerprints → diff.identical = true", () => {
            writeFileSync(join(tmpDir, "x.txt"), "x");
            const fp = computeWorkspaceFingerprint(tmpDir);
            const diff = diffFingerprints(fp, fp);
            assert.strictEqual(diff.identical, true);
            assert.deepStrictEqual(diff.added, []);
            assert.deepStrictEqual(diff.removed, []);
            assert.deepStrictEqual(diff.modified, []);
        });

        it("detects added files", () => {
            writeFileSync(join(tmpDir, "original.txt"), "og");
            const before = computeWorkspaceFingerprint(tmpDir);

            writeFileSync(join(tmpDir, "new-file.txt"), "new");
            const after = computeWorkspaceFingerprint(tmpDir);

            const diff = diffFingerprints(before, after);
            assert.strictEqual(diff.identical, false);
            assert.ok(diff.added.includes("new-file.txt"));
            assert.deepStrictEqual(diff.removed, []);
            assert.deepStrictEqual(diff.modified, []);
        });

        it("detects removed files", () => {
            writeFileSync(join(tmpDir, "a.txt"), "a");
            writeFileSync(join(tmpDir, "b.txt"), "b");
            const before = computeWorkspaceFingerprint(tmpDir);

            unlinkSync(join(tmpDir, "b.txt"));
            const after = computeWorkspaceFingerprint(tmpDir);

            const diff = diffFingerprints(before, after);
            assert.strictEqual(diff.identical, false);
            assert.ok(diff.removed.includes("b.txt"));
            assert.deepStrictEqual(diff.added, []);
        });

        it("detects modified files", () => {
            writeFileSync(join(tmpDir, "doc.md"), "v1");
            const before = computeWorkspaceFingerprint(tmpDir);

            writeFileSync(join(tmpDir, "doc.md"), "v2");
            const after = computeWorkspaceFingerprint(tmpDir);

            const diff = diffFingerprints(before, after);
            assert.strictEqual(diff.identical, false);
            assert.ok(diff.modified.includes("doc.md"));
        });

        it("detects complex multi-change scenario", () => {
            writeFileSync(join(tmpDir, "keep.txt"), "keep");
            writeFileSync(join(tmpDir, "modify.txt"), "old");
            writeFileSync(join(tmpDir, "delete.txt"), "bye");
            const before = computeWorkspaceFingerprint(tmpDir);

            writeFileSync(join(tmpDir, "modify.txt"), "new");
            unlinkSync(join(tmpDir, "delete.txt"));
            writeFileSync(join(tmpDir, "added.txt"), "hi");
            const after = computeWorkspaceFingerprint(tmpDir);

            const diff = diffFingerprints(before, after);
            assert.strictEqual(diff.identical, false);
            assert.ok(diff.added.includes("added.txt"));
            assert.ok(diff.removed.includes("delete.txt"));
            assert.ok(diff.modified.includes("modify.txt"));
        });

        it("diff results are sorted", () => {
            writeFileSync(join(tmpDir, "z-remove.txt"), "r");
            writeFileSync(join(tmpDir, "a-remove.txt"), "r");
            writeFileSync(join(tmpDir, "stay.txt"), "s");
            const before = computeWorkspaceFingerprint(tmpDir);

            unlinkSync(join(tmpDir, "z-remove.txt"));
            unlinkSync(join(tmpDir, "a-remove.txt"));
            writeFileSync(join(tmpDir, "z-add.txt"), "a");
            writeFileSync(join(tmpDir, "a-add.txt"), "a");
            const after = computeWorkspaceFingerprint(tmpDir);

            const diff = diffFingerprints(before, after);
            assert.deepStrictEqual(diff.added, [...diff.added].sort());
            assert.deepStrictEqual(diff.removed, [...diff.removed].sort());
        });
    });

    /* ── Tamper Detection ────────────────────────────────────────────── */

    describe("Tamper Detection", () => {
        it("single byte change is detectable", () => {
            writeFileSync(join(tmpDir, "config.json"), '{"key":"value"}');
            const clean = computeWorkspaceFingerprint(tmpDir);

            // Tamper: change one character
            writeFileSync(join(tmpDir, "config.json"), '{"key":"valuf"}');
            const tampered = computeWorkspaceFingerprint(tmpDir);

            assert.notStrictEqual(clean.hash, tampered.hash);
            const diff = diffFingerprints(clean, tampered);
            assert.ok(diff.modified.includes("config.json"));
        });

        it("appending a single byte is detectable", () => {
            writeFileSync(join(tmpDir, "data.bin"), Buffer.from([0x00, 0x01, 0x02]));
            const before = computeWorkspaceFingerprint(tmpDir);

            appendFileSync(join(tmpDir, "data.bin"), Buffer.from([0x03]));
            const after = computeWorkspaceFingerprint(tmpDir);

            assert.notStrictEqual(before.hash, after.hash);
        });

        it("file size in tree matches actual content length", () => {
            const content = "Hello, Prism!";
            writeFileSync(join(tmpDir, "msg.txt"), content);
            const fp = computeWorkspaceFingerprint(tmpDir);
            assert.strictEqual(fp.tree[0].size, Buffer.byteLength(content));
            assert.strictEqual(fp.totalSize, Buffer.byteLength(content));
        });
    });

    /* ── Pre/Post Import Integrity ───────────────────────────────────── */

    describe("Import Integrity Workflow", () => {
        it("fingerprint changes after simulated import", () => {
            mkdirSync(join(tmpDir, "characters"));
            writeFileSync(join(tmpDir, "characters", "agent.json"), '{"id":"a"}');
            const preImport = computeWorkspaceFingerprint(tmpDir);

            // Simulate import: add a new character file
            writeFileSync(join(tmpDir, "characters", "imported.json"), '{"id":"imported"}');
            const postImport = computeWorkspaceFingerprint(tmpDir);

            assert.notStrictEqual(preImport.hash, postImport.hash);
            assert.strictEqual(postImport.fileCount, preImport.fileCount + 1);

            const diff = diffFingerprints(preImport, postImport);
            assert.ok(diff.added.includes("characters/imported.json"));
            assert.strictEqual(diff.modified.length, 0);
            assert.strictEqual(diff.removed.length, 0);
        });

        it("fingerprint is stable between import checks (no phantom changes)", () => {
            writeFileSync(join(tmpDir, "stable.txt"), "unchanged");
            const fp1 = computeWorkspaceFingerprint(tmpDir);
            const fp2 = computeWorkspaceFingerprint(tmpDir);
            const diff = diffFingerprints(fp1, fp2);
            assert.strictEqual(diff.identical, true);
        });
    });
});
