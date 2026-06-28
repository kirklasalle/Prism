/**
 * Database Migration Framework — Tests
 *
 * Verifies the migration framework correctly:
 * - Runs migrations in order
 * - Skips already-applied migrations
 * - Tracks schema version
 * - Reports diagnostics
 *
 * Phase R (Readiness) — Audit remediation item R7b.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { runMigrations, getSchemaVersion, listMigrations, type Migration } from "../src/core/database/migrations/framework.js";
import { MIGRATIONS } from "../src/core/database/migrations/definitions.js";

const TEST_DB = "./prism-test-migration-framework.db";

function makeTestMigrations(): Migration[] {
    let migration2Ran = false;
    return [
        {
            id: 1,
            description: "Create test table",
            up: (db) => {
                db.exec("CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, value TEXT)");
            },
        },
        {
            id: 2,
            description: "Add index to test_table",
            up: (db) => {
                db.exec("CREATE INDEX IF NOT EXISTS idx_test_value ON test_table(value)");
                migration2Ran = true;
            },
        },
    ];
}

describe("Database Migration Framework", () => {
    let db: DatabaseSync;

    before(() => {
        if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
        db = new DatabaseSync(TEST_DB);
    });

    after(() => {
        db.close();
        if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    });

    it("runs pending migrations in order", () => {
        const migrations = makeTestMigrations();
        const applied = runMigrations(db, migrations);
        assert.equal(applied.length, 2);
        assert.equal(applied[0]!.id, 1);
        assert.equal(applied[1]!.id, 2);
    });

    it("skips already-applied migrations on subsequent runs", () => {
        const migrations = makeTestMigrations();
        const applied = runMigrations(db, migrations);
        assert.equal(applied.length, 0);
    });

    it("tracks schema version correctly", () => {
        const version = getSchemaVersion(db);
        assert.equal(version.current, 2);
        assert.equal(version.migrations, 2);
        assert.notEqual(version.appliedAt, null);
    });

    it("lists all known migrations", () => {
        const migrations = makeTestMigrations();
        const listed = listMigrations(migrations);
        assert.equal(listed.length, 2);
        assert.equal(listed[0]!.id, 1);
        assert.equal(listed[1]!.id, 2);
    });

    it("has accessible schema version table", () => {
        const rows = db.prepare("SELECT * FROM _prism_schema_version ORDER BY id").all();
        assert.equal(rows.length, 2);
    });

    it("handles empty migration list gracefully", () => {
        const applied = runMigrations(db, []);
        assert.equal(applied.length, 0);
    });
});

describe("Canonical Schema Migrations", () => {
    let db: DatabaseSync;
    const CANONICAL_DB = "./prism-test-canonical-schema.db";

    before(() => {
        if (existsSync(CANONICAL_DB)) unlinkSync(CANONICAL_DB);
        db = new DatabaseSync(CANONICAL_DB);
    });

    after(() => {
        db.close();
        if (existsSync(CANONICAL_DB)) unlinkSync(CANONICAL_DB);
    });

    it("applies canonical schema migration 001", () => {
        const applied = runMigrations(db, MIGRATIONS);
        assert.ok(applied.length >= 1, "Expected at least migration 001 to apply");
        assert.equal(applied[0]!.id, 1);
        assert.equal(applied[0]!.description.includes("Initial schema"), true);
    });

    it("creates all expected tables", () => {
        const tables = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        ).all() as { name: string }[];
        const tableNames = tables.map((t) => t.name);

        assert.ok(tableNames.includes("activity_events"));
        assert.ok(tableNames.includes("prism_llre_telemetry"));
        assert.ok(tableNames.includes("retrieval_metrics"));
        assert.ok(tableNames.includes("session_summaries"));
        assert.ok(tableNames.includes("chat_sessions"));
        assert.ok(tableNames.includes("chat_messages"));
        assert.ok(tableNames.includes("usage_metering"));
        assert.ok(tableNames.includes("retrieval_dashboard"));
        assert.ok(tableNames.includes("character_assignments"));
        assert.ok(tableNames.includes("iam_principals"));
        assert.ok(tableNames.includes("session_packages"));
    });
});