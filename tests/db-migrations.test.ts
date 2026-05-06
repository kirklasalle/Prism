/**
 * R5-2 — Migration runner unit tests.
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, beforeEach, afterEach } from "mocha";
import { MigrationRunner, MigrationError, type Migration } from "../src/core/db/migrations.js";

describe("MigrationRunner", () => {
    let tmpDir: string;
    let dbPath: string;
    let db: DatabaseSync;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-mig-"));
        dbPath = join(tmpDir, "test.db");
        db = new DatabaseSync(dbPath);
    });

    afterEach(() => {
        try { db.close(); } catch { /* already closed */ }
        if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it("applies pending migrations in ascending order on first run", () => {
        const migrations: Migration[] = [
            { version: 1, name: "init", up: "CREATE TABLE foo (id TEXT PRIMARY KEY);" },
            { version: 2, name: "add-bar", up: "ALTER TABLE foo ADD COLUMN bar TEXT;" },
        ];
        const runner = new MigrationRunner(db, migrations);
        const result = runner.run();

        assert.strictEqual(result.applied.length, 2);
        assert.strictEqual(result.alreadyApplied.length, 0);
        assert.strictEqual(result.currentVersion, 2);
        assert.strictEqual(result.applied[0]!.version, 1);
        assert.strictEqual(result.applied[1]!.version, 2);

        // Schema actually changed.
        const cols = db.prepare("PRAGMA table_info(foo)").all() as Array<{ name: string }>;
        const names = cols.map((c) => c.name);
        assert.ok(names.includes("id"));
        assert.ok(names.includes("bar"));
    });

    it("is idempotent — second run applies nothing", () => {
        const migrations: Migration[] = [
            { version: 1, name: "init", up: "CREATE TABLE foo (id TEXT PRIMARY KEY);" },
        ];
        new MigrationRunner(db, migrations).run();
        const second = new MigrationRunner(db, migrations).run();
        assert.strictEqual(second.applied.length, 0);
        assert.strictEqual(second.alreadyApplied.length, 1);
        assert.strictEqual(second.currentVersion, 1);
    });

    it("applies only newly-added migrations on a subsequent run", () => {
        new MigrationRunner(db, [
            { version: 1, name: "init", up: "CREATE TABLE foo (id TEXT PRIMARY KEY);" },
        ]).run();

        const result = new MigrationRunner(db, [
            { version: 1, name: "init", up: "CREATE TABLE foo (id TEXT PRIMARY KEY);" },
            { version: 2, name: "add-bar", up: "ALTER TABLE foo ADD COLUMN bar TEXT;" },
        ]).run();

        assert.strictEqual(result.applied.length, 1);
        assert.strictEqual(result.applied[0]!.version, 2);
        assert.strictEqual(result.currentVersion, 2);
    });

    it("rolls back a failing migration without recording it", () => {
        const ok: Migration = { version: 1, name: "init", up: "CREATE TABLE foo (id TEXT PRIMARY KEY);" };
        new MigrationRunner(db, [ok]).run();

        const bad: Migration = {
            version: 2,
            name: "bad",
            // Reference a nonexistent table — this fails at runtime.
            up: "INSERT INTO does_not_exist (id) VALUES ('x');",
        };

        assert.throws(
            () => new MigrationRunner(db, [ok, bad]).run(),
            /migration v2 \(bad\) failed/,
        );

        // Migration v2 must not be recorded.
        const runner = new MigrationRunner(db, [ok]);
        assert.strictEqual(runner.currentVersion(), 1);
    });

    it("rejects a checksum mismatch on a previously-applied migration", () => {
        const original: Migration[] = [
            { version: 1, name: "init", up: "CREATE TABLE foo (id TEXT PRIMARY KEY);" },
        ];
        new MigrationRunner(db, original).run();

        // Operator silently edits v1 — the runner must catch it.
        const tampered: Migration[] = [
            { version: 1, name: "init", up: "CREATE TABLE foo (id TEXT PRIMARY KEY, evil TEXT);" },
        ];
        assert.throws(
            () => new MigrationRunner(db, tampered).run(),
            /checksum mismatch/,
        );
    });

    it("rejects gaps in declared migration versions", () => {
        assert.throws(
            () => new MigrationRunner(db, [
                { version: 1, name: "a", up: "SELECT 1;" },
                { version: 3, name: "c", up: "SELECT 3;" }, // missing v2
            ]),
            /must be 1-indexed and contiguous/,
        );
    });

    it("rejects duplicate migration versions", () => {
        assert.throws(
            () => new MigrationRunner(db, [
                { version: 1, name: "a", up: "SELECT 1;" },
                { version: 1, name: "b", up: "SELECT 2;" },
            ]),
            /duplicate migration version/,
        );
    });

    it("rejects duplicate migration names", () => {
        assert.throws(
            () => new MigrationRunner(db, [
                { version: 1, name: "shared", up: "SELECT 1;" },
                { version: 2, name: "shared", up: "SELECT 2;" },
            ]),
            /duplicate migration name/,
        );
    });

    it("rejects non-positive versions", () => {
        assert.throws(
            () => new MigrationRunner(db, [{ version: 0, name: "zero", up: "SELECT 1;" }]),
            /positive integer/,
        );
    });

    it("listApplied returns rows in ascending version order with valid metadata", () => {
        new MigrationRunner(db, [
            { version: 1, name: "init", up: "CREATE TABLE foo (id TEXT);" },
            { version: 2, name: "add-bar", up: "ALTER TABLE foo ADD COLUMN bar TEXT;" },
        ]).run();

        const applied = new MigrationRunner(db, []).listApplied();
        assert.strictEqual(applied.length, 2);
        assert.strictEqual(applied[0]!.version, 1);
        assert.strictEqual(applied[1]!.version, 2);
        for (const m of applied) {
            assert.ok(typeof m.checksum === "string" && m.checksum.length === 64, "checksum must be 64-char sha256");
            assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(m.appliedAt), "appliedAt must be ISO-8601");
        }
    });

    it("does not throw when no migrations are declared (empty array)", () => {
        const runner = new MigrationRunner(db, []);
        const result = runner.run();
        assert.strictEqual(result.applied.length, 0);
        assert.strictEqual(result.currentVersion, 0);
    });

    it("MigrationError is the thrown error type for runtime failures", () => {
        try {
            new MigrationRunner(db, [
                { version: 1, name: "bad", up: "this is not sql;" },
            ]).run();
            assert.fail("expected throw");
        } catch (e) {
            assert.ok(e instanceof MigrationError, `expected MigrationError, got ${(e as Error).name}`);
        }
    });
});
