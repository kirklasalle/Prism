/**
 * Persisted Audit Chain — IC-11 residual closure.
 *
 * The in-memory chain in `ActivityBus` proves nothing after a restart. These tests exercise
 * the property that actually matters to an auditor: that the chain can be verified from the
 * database alone, that the rows are append-only, and that a row altered behind the API is
 * detected and localised.
 *
 * Includes an adversarial case in the spirit of Orrery's `tests/test_adversarial.py`: it
 * asserts the attack that still succeeds (an attacker with direct database write access can
 * drop the triggers) so the limit of the control is recorded rather than assumed away.
 */

import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ActivityBus } from "../src/core/activity/bus.js";
import { SqliteActivityStore } from "../src/core/activity/sqlite-store.js";
import { ActivityRetentionPolicy } from "../src/core/activity/retention-policy.js";

describe("Persisted audit chain (IC-11)", () => {
    let tmpDir: string;
    let dbPath: string;
    let store: SqliteActivityStore;
    let bus: ActivityBus;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-chain-"));
        dbPath = join(tmpDir, "activity.db");
        store = new SqliteActivityStore(dbPath);
        bus = new ActivityBus();
        bus.subscribe(store);
    });

    afterEach(() => {
        try {
            store.close();
        } catch {
            /* already closed */
        }
        rmSync(tmpDir, { recursive: true, force: true });
    });

    function emit(operation: string): void {
        bus.emit({
            sessionId: "session-under-test",
            layer: "governance",
            operation,
            status: "succeeded",
            details: { operation },
        });
    }

    it("persists previousHash and sequenceNumber so the chain survives the process", () => {
        emit("alpha");
        emit("beta");
        emit("gamma");

        const db = new DatabaseSync(dbPath);
        const rows = db
            .prepare("SELECT sequence_number, previous_hash, hash FROM activity_events ORDER BY sequence_number ASC")
            .all() as Array<{ sequence_number: number; previous_hash: string; hash: string }>;
        db.close();

        assert.equal(rows.length, 3);
        assert.deepEqual(
            rows.map((r) => Number(r.sequence_number)),
            [1, 2, 3],
        );
        assert.equal(rows[0]!.previous_hash, "0".repeat(64), "first event links to genesis");
        assert.equal(rows[1]!.previous_hash, rows[0]!.hash, "second event links to the first");
        assert.equal(rows[2]!.previous_hash, rows[1]!.hash, "third event links to the second");
    });

    it("verifies an intact chain from the database alone", () => {
        emit("alpha");
        emit("beta");

        const result = store.verifyPersistedChain();
        assert.equal(result.valid, true, result.reason);
        assert.equal(result.checked, 2);
        assert.equal(result.unchainedRows, 0);
        assert.equal(result.brokenAtSequence, null);
    });

    it("continues the durable sequence and predecessor link after a process restart", () => {
        emit("before-restart-1");
        emit("before-restart-2");
        store.close();

        store = new SqliteActivityStore(dbPath);
        bus = new ActivityBus();
        bus.subscribe(store);
        emit("after-restart");

        const db = new DatabaseSync(dbPath);
        const rows = db
            .prepare("SELECT sequence_number, previous_hash, hash FROM activity_events ORDER BY sequence_number")
            .all() as Array<{ sequence_number: number; previous_hash: string; hash: string }>;
        db.close();

        assert.deepEqual(rows.map((row) => Number(row.sequence_number)), [1, 2, 3]);
        assert.equal(rows[2]!.previous_hash, rows[1]!.hash, "post-restart event links to the prior process head");

        const result = store.verifyPersistedChain();
        assert.equal(result.valid, true, result.reason);
        assert.equal(result.checked, 3);
    });

    it("serializes alternating writers against the database head", () => {
        const secondStore = new SqliteActivityStore(dbPath);
        const secondBus = new ActivityBus();
        secondBus.subscribe(secondStore);

        emit("writer-one-first");
        secondBus.emit({
            sessionId: "second-writer",
            layer: "governance",
            operation: "writer-two",
            status: "succeeded",
            details: {},
        });
        emit("writer-one-last");
        secondStore.close();

        const result = store.verifyPersistedChain();
        assert.equal(result.valid, true, result.reason);
        assert.equal(result.checked, 3);

        const db = new DatabaseSync(dbPath);
        const sequences = db
            .prepare("SELECT sequence_number FROM activity_events ORDER BY sequence_number")
            .all()
            .map((row) => Number((row as { sequence_number: number }).sequence_number));
        db.close();
        assert.deepEqual(sequences, [1, 2, 3]);
    });

    it("refuses updates to audit rows unconditionally", () => {
        emit("alpha");

        const db = new DatabaseSync(dbPath);
        assert.throws(
            () => db.exec("UPDATE activity_events SET operation = 'tampered'"),
            /Modification of append-only audit event is forbidden/,
        );
        db.close();
    });

    it("refuses deletes outside a governed retention sweep", () => {
        emit("alpha");

        const db = new DatabaseSync(dbPath);
        assert.throws(
            () => db.exec("DELETE FROM activity_events"),
            /Deletion of append-only audit event is forbidden outside a governed retention sweep/,
        );
        db.close();

        assert.equal(store.verifyPersistedChain().checked, 1, "row survived the attempted delete");
    });

    it("detects deletion performed with the raw guard but without a prune record", () => {
        emit("alpha");

        const db = new DatabaseSync(dbPath);
        db.exec("UPDATE audit_chain_guard SET retention_active = 1 WHERE id = 1");
        db.exec("DELETE FROM activity_events");
        db.exec("UPDATE audit_chain_guard SET retention_active = 0 WHERE id = 1");
        const remaining = db.prepare("SELECT COUNT(*) AS c FROM activity_events").get() as { c: number | bigint };
        db.close();

        assert.equal(Number(remaining.c), 0, "the raw database guard permits the database owner");
        const result = store.verifyPersistedChain();
        assert.equal(result.status, "indeterminate", "an empty retained set is never reported valid");
    });

    it("detects and localises a row altered behind the API", () => {
        emit("alpha");
        emit("beta");
        emit("gamma");

        // An attacker with direct database write access can drop the triggers. This is the
        // documented limit of the control: the triggers stop accidental and API-level
        // mutation, the chain is what survives a determined one.
        const db = new DatabaseSync(dbPath);
        db.exec("DROP TRIGGER IF EXISTS prevent_activity_event_update");
        db.exec("UPDATE activity_events SET operation = 'forged' WHERE sequence_number = 2");
        db.close();

        const result = store.verifyPersistedChain();
        assert.equal(result.valid, false, "an altered row must not verify");
        assert.equal(result.brokenAtSequence, 2, "the break is localised to the altered row");
        assert.match(result.reason, /Content mismatch at sequence 2/);
    });

    it("hashes policy and authority evidence, not only operation fields", () => {
        bus.emit({
            sessionId: "session-under-test",
            layer: "governance",
            operation: "authorized-action",
            status: "succeeded",
            details: {},
            policyDecision: "allow",
            authorityTier: "tier3_approval",
            rollbackPlan: "restore snapshot",
        });

        const db = new DatabaseSync(dbPath);
        db.exec("DROP TRIGGER IF EXISTS prevent_activity_event_update");
        db.exec("UPDATE activity_events SET policy_decision = 'deny' WHERE sequence_number = 1");
        db.close();

        const result = store.verifyPersistedChain();
        assert.equal(result.status, "invalid");
        assert.equal(result.brokenAtSequence, 1);
    });

    it("reports pre-migration rows as unprovable rather than valid", () => {
        emit("alpha");

        const db = new DatabaseSync(dbPath);
        db.exec(`
            INSERT INTO activity_events (id, timestamp, session_id, layer, operation, status, details)
            VALUES ('legacy-1', '2026-01-01T00:00:00.000Z', 's', 'governance', 'legacy', 'succeeded', '{}')
        `);
        db.close();

        const result = store.verifyPersistedChain();
        assert.equal(result.status, "indeterminate", "legacy evidence prevents an overall valid result");
        assert.equal(result.valid, false);
        assert.equal(result.checked, 1);
        assert.equal(result.unchainedRows, 1, "legacy row is counted separately, never as verified");
        assert.match(result.reason, /unprovable/);
    });

    it("records and verifies the boundary of a governed retention prune", () => {
        const oldTimestamp = "2026-01-01T00:00:00.000Z";
        store.onEvent({
            id: "old-1",
            timestamp: oldTimestamp,
            sessionId: "s",
            layer: "governance",
            operation: "old-1",
            status: "succeeded",
            details: {},
        });
        store.onEvent({
            id: "old-2",
            timestamp: oldTimestamp,
            sessionId: "s",
            layer: "governance",
            operation: "old-2",
            status: "succeeded",
            details: {},
        });
        emit("retained");

        const retention = new ActivityRetentionPolicy(
            { dbPath, retentionDays: 1 },
            new ActivityBus(),
            () => new Date("2026-08-08T00:00:00.000Z"),
        );
        const sweep = retention.sweep();
        assert.equal(sweep.prunedThroughSequence, 2);

        const result = store.verifyPersistedChain();
        assert.equal(result.valid, true);
        assert.equal(result.firstSequence, 3);
        assert.equal(result.rootedAfterPrune, true, "pruned predecessors must be declared, not implied");
        assert.match(result.reason, /cannot be proven/);
    });

    it("continues from the recorded boundary after all retained events are pruned", () => {
        store.onEvent({
            id: "old-only",
            timestamp: "2026-01-01T00:00:00.000Z",
            sessionId: "s",
            layer: "governance",
            operation: "old-only",
            status: "succeeded",
            details: {},
        });
        const retention = new ActivityRetentionPolicy(
            { dbPath, retentionDays: 1 },
            new ActivityBus(),
            () => new Date("2026-08-08T00:00:00.000Z"),
        );
        retention.sweep();

        emit("after-full-prune");
        const db = new DatabaseSync(dbPath);
        const row = db.prepare(`
            SELECT sequence_number, previous_hash
            FROM activity_events
            WHERE operation = 'after-full-prune'
        `).get() as { sequence_number: number | bigint; previous_hash: string };
        const state = db.prepare("SELECT last_pruned_hash FROM audit_chain_state WHERE id = 1").get() as {
            last_pruned_hash: string;
        };
        db.close();

        assert.equal(Number(row.sequence_number), 2);
        assert.equal(row.previous_hash, state.last_pruned_hash);
        assert.equal(store.verifyPersistedChain().status, "valid");
    });

    it("retention never punches a sequence hole for an out-of-order timestamp", () => {
        const events = [
            { id: "old-first", timestamp: "2026-01-01T00:00:00.000Z" },
            { id: "new-middle", timestamp: "2026-08-08T00:00:00.000Z" },
            { id: "old-last", timestamp: "2026-01-02T00:00:00.000Z" },
        ];
        for (const event of events) {
            store.onEvent({
                ...event,
                sessionId: "s",
                layer: "governance",
                operation: event.id,
                status: "succeeded",
                details: {},
            });
        }
        const retention = new ActivityRetentionPolicy(
            { dbPath, retentionDays: 1 },
            bus,
            () => new Date("2026-08-08T12:00:00.000Z"),
        );
        const sweep = retention.sweep();

        assert.equal(sweep.prunedThroughSequence, 1, "pruning stops at the first retained sequence");
        const result = store.verifyPersistedChain();
        assert.equal(result.status, "valid", result.reason);
        assert.equal(result.firstSequence, 2);
    });
});
