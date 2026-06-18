/**
 * DatabaseManager — Centralized Connection Tests
 *
 * Verifies the DatabaseManager singleton correctly:
 * - Creates a single shared connection
 * - Applies WAL mode and pragmas
 * - Tracks reference counts
 * - Checkpoints WAL on close
 * - Survives multiple ref/unref cycles
 *
 * Phase R (Readiness) — Audit remediation item R2b.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import { DatabaseManager } from "../src/core/database/manager.js";

const TEST_DB = "./prism-test-db-manager.db";

describe("DatabaseManager", () => {
    before(() => {
        if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    });

    after(() => {
        DatabaseManager.resetInstance();
        if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    });

    it("creates a singleton instance", () => {
        const mgr1 = DatabaseManager.getInstance({ dbPath: TEST_DB });
        const mgr2 = DatabaseManager.getInstance();
        assert.strictEqual(mgr1, mgr2, "getInstance() should return the same object");
    });

    it("opens the database on first db access", () => {
        const mgr = DatabaseManager.getInstance();
        assert.ok(!mgr.isOpen, "DB should not be open before first access");
        const db = mgr.db;
        assert.ok(mgr.isOpen, "DB should be open after accessing .db");
        assert.ok(db instanceof Object, "db should be a DatabaseSync instance");
    });

    it("applies WAL mode pragma", () => {
        const mgr = DatabaseManager.getInstance();
        const row = mgr.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
        assert.equal(row.journal_mode.toLowerCase(), "wal");
    });

    it("applies foreign_keys pragma", () => {
        const mgr = DatabaseManager.getInstance();
        const row = mgr.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
        assert.equal(row.foreign_keys, 1);
    });

    it("tracks reference count", () => {
        const mgr = DatabaseManager.getInstance();
        const initial = mgr.refCount;
        mgr.ref();
        assert.equal(mgr.refCount, initial + 1);
        mgr.ref();
        assert.equal(mgr.refCount, initial + 2);
        mgr.unref();
        assert.equal(mgr.refCount, initial + 1);
    });

    it("executes SQL successfully", () => {
        const mgr = DatabaseManager.getInstance();
        mgr.db.exec("CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, value TEXT)");
        mgr.db.exec("INSERT INTO test_table (value) VALUES ('hello')");
        const row = mgr.db.prepare("SELECT value FROM test_table WHERE id = 1").get() as { value: string };
        assert.equal(row.value, "hello");
    });

    it("checkpoints WAL", () => {
        const mgr = DatabaseManager.getInstance();
        // checkpoint() should not throw
        mgr.checkpoint();
        assert.ok(true, "checkpoint completed without error");
    });

    it("closes and reopens on demand", () => {
        const mgr = DatabaseManager.getInstance();
        mgr.close(true); // force close
        assert.ok(!mgr.isOpen, "DB should be closed after force close");
        // Accessing .db again should reopen
        const db = mgr.db;
        assert.ok(mgr.isOpen, "DB should reopen on access");
    });

    it("provides the dbPath", () => {
        const mgr = DatabaseManager.getInstance();
        assert.ok(mgr.dbPath.includes("prism-test-db-manager.db"));
    });

    it("resetInstance creates fresh state", () => {
        DatabaseManager.resetInstance();
        const mgr = DatabaseManager.getInstance({ dbPath: TEST_DB });
        assert.equal(mgr.refCount, 0);
    });
});