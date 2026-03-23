/**
 * Tests for workspace persistence — resolveWorkspaceRoot priority, setWorkspaceRoot verification.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    resolveWorkspaceRoot,
    setWorkspaceRoot,
    _resetWorkspaceRootCache,
    readPreferences,
    writePreferences,
    preferencesPath,
} from "../src/core/config/workspace-resolver.js";

describe("Workspace Persistence", () => {
    const originalEnv = process.env.PRISM_WORKSPACE_ROOT;
    let tempDir: string | undefined;

    afterEach(() => {
        _resetWorkspaceRootCache();
        // Restore env
        if (originalEnv !== undefined) {
            process.env.PRISM_WORKSPACE_ROOT = originalEnv;
        } else {
            delete process.env.PRISM_WORKSPACE_ROOT;
        }
        // Clean temp
        if (tempDir && existsSync(tempDir)) {
            try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
            tempDir = undefined;
        }
    });

    // ── setWorkspaceRoot ─────────────────────────────────────────────────

    it("setWorkspaceRoot rejects non-absolute paths", () => {
        assert.throws(
            () => setWorkspaceRoot("relative/path"),
            { message: /absolute path/ },
        );
    });

    it("setWorkspaceRoot rejects empty string", () => {
        assert.throws(
            () => setWorkspaceRoot(""),
            { message: /absolute path/ },
        );
    });

    it("setWorkspaceRoot updates the cached root", () => {
        tempDir = mkdtempSync(join(tmpdir(), "prism-ws-test-"));
        setWorkspaceRoot(tempDir);
        assert.equal(resolveWorkspaceRoot(), tempDir);
    });

    it("setWorkspaceRoot sets PRISM_WORKSPACE_ROOT env var", () => {
        tempDir = mkdtempSync(join(tmpdir(), "prism-ws-test-"));
        setWorkspaceRoot(tempDir);
        assert.equal(process.env.PRISM_WORKSPACE_ROOT, tempDir);
    });

    // ── resolveWorkspaceRoot priority ────────────────────────────────────

    it("resolveWorkspaceRoot prefers cached value on subsequent calls", () => {
        tempDir = mkdtempSync(join(tmpdir(), "prism-ws-test-"));
        setWorkspaceRoot(tempDir);

        // Change env — should still return cached
        process.env.PRISM_WORKSPACE_ROOT = "/different/path";
        assert.equal(resolveWorkspaceRoot(), tempDir);
    });

    it("resolveWorkspaceRoot returns env var fallback when no cache and no prefs", () => {
        _resetWorkspaceRootCache();
        tempDir = mkdtempSync(join(tmpdir(), "prism-ws-test-"));
        process.env.PRISM_WORKSPACE_ROOT = tempDir;
        assert.equal(resolveWorkspaceRoot(), tempDir);
    });

    // ── Preferences read/write ──────────────────────────────────────────

    it("writePreferences writes and readPreferences reads back", () => {
        const prefsFile = preferencesPath();
        const existed = existsSync(prefsFile);
        const originalContent = existed ? readFileSync(prefsFile, "utf-8") : null;

        try {
            writePreferences({ workspaceRoot: "/test/path" });
            const read = readPreferences();
            assert.ok(read);
            assert.equal(read.workspaceRoot, "/test/path");
            assert.ok(read.lastModified);
        } finally {
            // Restore original state
            if (originalContent !== null) {
                writeFileSync(prefsFile, originalContent, "utf-8");
            }
        }
    });
});
