import assert from "node:assert";
import { existsSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SqliteActivityStore } from "../src/core/activity/sqlite-store.js";
import { RetrievalDashboardStore } from "../src/core/memory/retrieval-dashboard-store.js";
import { SessionMemoryStore } from "../src/core/memory/session-memory.js";
import { SessionPackageSqliteStore } from "../src/core/operator/session-package-sqlite-store.js";

export async function testSqliteMigrations(): Promise<void> {
    await testActivityStoreMigrationCompatibility();
    await testRetrievalDashboardMigrationCompatibility();
    await testSessionSummaryMigrationCompatibility();
    await testSessionPackageMigrationCompatibility();

    console.log("✓ SQLite migration compatibility tests passed");
}

async function testActivityStoreMigrationCompatibility(): Promise<void> {
    const dbPath = "./prism-test-migration-activity.db";
    cleanup(dbPath);

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL,
        layer TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);
    db.close();

    const store = new SqliteActivityStore(dbPath);
    store.onEvent({
        id: "evt-1",
        timestamp: new Date("2026-03-11T00:00:00.000Z").toISOString(),
        sessionId: "migration-session",
        layer: "tool_execution",
        operation: "file_write",
        status: "succeeded",
        details: { migrated: true },
        sideEffects: [{ type: "file", description: "written: test" }],
        hash: "h1",
    });

    const events = store.queryEvents({ sessionId: "migration-session" });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]!.operation, "file_write");
    assert.ok(Array.isArray(events[0]!.sideEffects));

    store.close();
    cleanup(dbPath);
}

async function testRetrievalDashboardMigrationCompatibility(): Promise<void> {
    const dbPath = "./prism-test-migration-dashboard.db";
    cleanup(dbPath);

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE retrieval_cohort_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);
    db.close();

    const store = new RetrievalDashboardStore(dbPath);
    store.saveSnapshot("migration-session", {
        generatedAt: "2026-03-11T00:00:00.000Z",
        sampleSize: 10,
        cohortCount: 1,
        cohorts: [
            {
                cohortKey: "approval",
                queryCount: 5,
                hitRate: 0.8,
                avgCoverageScore: 0.7,
                avgNoveltyScore: 0.5,
                avgUtilityScore: 0.6,
                avgLatencyMs: 20,
                p95LatencyMs: 60,
                firstSeen: "2026-03-11T00:00:00.000Z",
                lastSeen: "2026-03-11T00:00:00.000Z",
            },
        ],
        alerts: [],
    });

    const snapshots = store.getRecentSnapshots(5, "migration-session");
    assert.strictEqual(snapshots.length, 1);
    assert.strictEqual(snapshots[0]!.sampleSize, 10);
    assert.strictEqual(snapshots[0]!.cohortCount, 1);

    store.close();
    cleanup(dbPath);
}

async function testSessionSummaryMigrationCompatibility(): Promise<void> {
    const dbPath = "./prism-test-migration-session.db";
    cleanup(dbPath);

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session_summaries (
        session_id TEXT PRIMARY KEY,
        total_events INTEGER NOT NULL,
        failures INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.close();

    const store = new SessionMemoryStore(dbPath);
    store.onEvent({
        id: "evt-1",
        timestamp: new Date("2026-03-11T00:00:00.000Z").toISOString(),
        sessionId: "migration-session",
        layer: "tool_execution",
        operation: "file_list",
        status: "succeeded",
        details: {},
    });

    const summary = store.getSessionSummary("migration-session");
    assert.ok(summary);
    assert.strictEqual(summary!.totalEvents, 1);
    assert.strictEqual(summary!.toolExecutions, 1);

    store.close();
    cleanup(dbPath);
}

function cleanup(dbPath: string): void {
    if (existsSync(dbPath)) {
        unlinkSync(dbPath);
    }
}

async function testSessionPackageMigrationCompatibility(): Promise<void> {
    const dbPath = "./prism-test-migration-session-package.db";
    cleanup(dbPath);

    // Simulate an older schema that predates title, area_of_interest, objective,
    // success_criteria, dependencies, last_run_at, last_export_at, export_artifact_path
    // and history columns: title, previous_status, next_status, source, message, target_session_id
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session_packages (
        package_id  TEXT PRIMARY KEY,
        status      TEXT NOT NULL DEFAULT 'planned',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        session_ids TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE session_package_history (
        history_id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL,
        action     TEXT NOT NULL DEFAULT 'status_changed',
        timestamp  TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'planned'
      );
    `);
    db.close();

    // Opening the store must migrate all missing columns without error
    const store = new SessionPackageSqliteStore(dbPath);

    const now = new Date().toISOString();
    store.upsertPackage({
        packageId: "pkg-migration-1",
        title: "Migration Test Package",
        areaOfInterest: "testing",
        objective: "Verify migration",
        successCriteria: "All columns present",
        dependencies: ["dep-a"],
        status: "planned",
        createdAt: now,
        updatedAt: now,
        sessionIds: ["sess-1", "sess-2"],
        lastRunAt: null,
        lastExportAt: null,
        exportArtifactPath: null,
    });

    const retrieved = store.getPackage("pkg-migration-1");
    assert.ok(retrieved, "package should be retrievable after migration");
    assert.strictEqual(retrieved!.title, "Migration Test Package");
    assert.strictEqual(retrieved!.areaOfInterest, "testing");
    assert.strictEqual(retrieved!.objective, "Verify migration");
    assert.deepStrictEqual(retrieved!.dependencies, ["dep-a"]);
    assert.deepStrictEqual(retrieved!.sessionIds, ["sess-1", "sess-2"]);
    assert.strictEqual(retrieved!.exportArtifactPath, null);

    store.upsertHistoryEntry({
        historyId: "hist-migration-1",
        packageId: "pkg-migration-1",
        title: "Migration Test Package",
        action: "created",
        timestamp: now,
        status: "planned",
        previousStatus: null,
        nextStatus: null,
        source: "migration_test",
        message: "created during migration test",
        targetSessionId: null,
    });

    const history = store.listHistory(10);
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0]!.action, "created");
    assert.strictEqual(history[0]!.source, "migration_test");
    assert.strictEqual(history[0]!.message, "created during migration test");

    // Analytics methods must work after migration
    const countByStatus = store.packageCountByStatus();
    assert.strictEqual(countByStatus["planned"], 1);

    const trend = store.packageCreatedPerDay(7);
    assert.ok(Array.isArray(trend));
    assert.strictEqual(trend.length, 1);
    assert.strictEqual(trend[0]!.count, 1);

    const freq = store.actionFrequency(5);
    assert.ok(Array.isArray(freq));
    assert.strictEqual(freq.length, 1);
    assert.strictEqual(freq[0]!.action, "created");

    store.close();
    cleanup(dbPath);
}