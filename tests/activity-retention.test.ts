import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ActivityBus } from "../src/core/activity/bus.js";
import type { ActivityEvent } from "../src/core/activity/types.js";
import {
    ActivityRetentionPolicy,
    resolveRetentionConfigFromEnv,
} from "../src/core/activity/retention-policy.js";

function seedDb(dbPath: string, rows: Array<{ id: string; timestamp: string }>): void {
    const db = new DatabaseSync(dbPath);
    db.exec(`
        CREATE TABLE IF NOT EXISTS activity_events (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            session_id TEXT NOT NULL,
            layer TEXT NOT NULL,
            operation TEXT NOT NULL,
            status TEXT NOT NULL,
            details TEXT
        );
    `);
    const stmt = db.prepare(
        "INSERT INTO activity_events (id, timestamp, session_id, layer, operation, status, details) VALUES (?, ?, 's', 'tool_execution', 'op', 'succeeded', '{}')",
    );
    for (const row of rows) stmt.run(row.id, row.timestamp);
    db.close();
}

function rowCount(dbPath: string): number {
    const db = new DatabaseSync(dbPath);
    try {
        const r = db.prepare("SELECT COUNT(*) AS c FROM activity_events").get() as { c: number | bigint };
        return typeof r.c === "bigint" ? Number(r.c) : r.c;
    } finally {
        db.close();
    }
}

export async function testActivityRetention(): Promise<void> {
    const tmp = mkdtempSync(join(tmpdir(), "prism-retention-"));
    const dbPath = join(tmp, "activity.db");

    // ── 1. resolveRetentionConfigFromEnv: disabled by default ───────────────
    assert.strictEqual(resolveRetentionConfigFromEnv("/x", {}), null,
        "missing PRISM_ACTIVITY_RETENTION_DAYS keeps policy disabled");
    assert.strictEqual(resolveRetentionConfigFromEnv("/x", { PRISM_ACTIVITY_RETENTION_DAYS: "0" }), null,
        "PRISM_ACTIVITY_RETENTION_DAYS=0 keeps policy disabled");
    assert.strictEqual(resolveRetentionConfigFromEnv("/x", { PRISM_ACTIVITY_RETENTION_DAYS: "abc" }), null,
        "non-numeric retention days keeps policy disabled");

    const cfg = resolveRetentionConfigFromEnv("/fallback.db", {
        PRISM_ACTIVITY_RETENTION_DAYS: "30",
        PRISM_ACTIVITY_RETENTION_SWEEP_MS: "5000",
    });
    assert.ok(cfg, "positive retention days enables policy");
    assert.strictEqual(cfg!.retentionDays, 30);
    assert.strictEqual(cfg!.sweepIntervalMs, 5000);
    assert.strictEqual(cfg!.dbPath, "/fallback.db");

    // sweep interval below floor is ignored
    const cfg2 = resolveRetentionConfigFromEnv("/x", {
        PRISM_ACTIVITY_RETENTION_DAYS: "7",
        PRISM_ACTIVITY_RETENTION_SWEEP_MS: "10",
    });
    assert.strictEqual(cfg2!.sweepIntervalMs, 60 * 60 * 1000,
        "sweep interval below 1000ms falls back to default");

    // ── 2. sweep: deletes only rows older than cutoff ───────────────────────
    const fixedNow = new Date("2026-05-07T12:00:00.000Z");
    const oldIso = new Date(fixedNow.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days old
    const recentIso = new Date(fixedNow.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day old

    seedDb(dbPath, [
        { id: "old-1", timestamp: oldIso },
        { id: "old-2", timestamp: oldIso },
        { id: "recent-1", timestamp: recentIso },
    ]);
    assert.strictEqual(rowCount(dbPath), 3, "seeded 3 rows");

    const bus = new ActivityBus();
    const seen: ActivityEvent[] = [];
    bus.subscribe({ onEvent: (e) => seen.push(e) });

    const policy = new ActivityRetentionPolicy(
        { retentionDays: 7, dbPath, sweepIntervalMs: 60_000 },
        bus,
        () => fixedNow,
    );

    const result = policy.sweep();
    assert.strictEqual(result.deleted, 2, "sweep deletes both rows older than 7 days");
    assert.strictEqual(rowCount(dbPath), 1, "recent row survives");

    // emitted activity event has expected shape
    assert.strictEqual(seen.length, 1, "sweep emits exactly one activity event");
    const ev = seen[0]!;
    assert.strictEqual(ev.layer, "governance");
    assert.strictEqual(ev.operation, "activity.retention.swept");
    assert.strictEqual(ev.status, "succeeded");
    assert.strictEqual((ev.details as { deleted: number }).deleted, 2);
    assert.strictEqual((ev.details as { retentionDays: number }).retentionDays, 7);
    assert.ok(Array.isArray(ev.sideEffects) && ev.sideEffects!.length === 1);
    assert.strictEqual(ev.sideEffects![0]!.type, "database");
    assert.strictEqual(ev.sideEffects![0]!.mutating, true);
    assert.strictEqual(ev.sideEffects![0]!.reversible, false);

    // ── 3. sweep: zero-deletion case emits empty sideEffects ────────────────
    const result2 = policy.sweep();
    assert.strictEqual(result2.deleted, 0, "second sweep deletes nothing");
    const ev2 = seen[1]!;
    assert.strictEqual(ev2.operation, "activity.retention.swept");
    assert.deepStrictEqual(ev2.sideEffects, [], "no-op sweep emits empty sideEffects");

    // ── 4. constructor rejects non-positive retention ───────────────────────
    assert.throws(
        () => new ActivityRetentionPolicy({ retentionDays: 0, dbPath }, bus),
        /retentionDays must be > 0/,
        "constructor rejects retentionDays=0",
    );

    // ── 5. start/stop lifecycle ─────────────────────────────────────────────
    assert.strictEqual(policy.isRunning(), false, "policy is not running before start");
    policy.start();
    assert.strictEqual(policy.isRunning(), true, "policy is running after start");
    policy.start(); // idempotent
    assert.strictEqual(policy.isRunning(), true, "second start is a no-op");
    policy.stop();
    assert.strictEqual(policy.isRunning(), false, "policy is not running after stop");
    policy.stop(); // idempotent

    rmSync(tmp, { recursive: true, force: true });
}
