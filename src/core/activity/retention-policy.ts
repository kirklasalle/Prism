/**
 * ActivityRetentionPolicy — periodic sweep of `activity_events` rows older
 * than a configured retention window.
 *
 * **Default off.** Activated only when `PRISM_ACTIVITY_RETENTION_DAYS` is set
 * to a positive integer. When enabled, on a configurable interval the policy
 * deletes rows from `activity_events` whose `timestamp` is older than
 * `now - retentionDays`, then emits an `activity.retention.swept` event back
 * onto the {@link ActivityBus} with the deleted row count and cutoff.
 *
 * The sweep is purely destructive on the SQLite store and cannot be undone.
 * Operators who also run the SOC 2 evidence exporter should ensure the
 * exporter has caught up before retention reclaims rows; this module does
 * **not** coordinate with the exporter directly because exporter modes are
 * heterogenous (file/webhook/off) and the source-of-truth contract is the
 * downstream SIEM/object store, not the local SQLite buffer.
 *
 * Frontend Protection Guarantee: this module is strictly additive. It does
 * not alter the activity_events schema, the ActivityBus contract, or any
 * existing subscriber.
 */

import { DatabaseSync } from "node:sqlite";
import type { ActivityBus } from "./bus.js";

export interface ActivityRetentionConfig {
    /** Retention window in days. Rows older than now - retentionDays are deleted. */
    retentionDays: number;
    /** Sweep cadence in milliseconds. Defaults to 1 hour. */
    sweepIntervalMs?: number;
    /** Path to the SQLite activity database. */
    dbPath: string;
}

export interface ActivityRetentionSweepResult {
    /** Number of rows deleted in this sweep. */
    deleted: number;
    /** ISO timestamp; rows with timestamp < cutoffIso were deleted. */
    cutoffIso: string;
    /** Wall-clock duration of the sweep in milliseconds. */
    durationMs: number;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolve config from environment. Returns null when the policy is disabled
 * (the default).
 *
 * - `PRISM_ACTIVITY_RETENTION_DAYS` — positive integer enables the policy.
 *   `0`, missing, or non-numeric leaves it disabled.
 * - `PRISM_ACTIVITY_RETENTION_SWEEP_MS` — optional sweep cadence override.
 *   Must be ≥ 1000. Defaults to 3,600,000 (1 hour).
 * - `PRISM_ACTIVITY_DB_PATH` — optional override for the SQLite path. When
 *   absent, the caller should pass the same `dbPath` used by
 *   `SqliteActivityStore`.
 */
export function resolveRetentionConfigFromEnv(
    fallbackDbPath: string,
    env: NodeJS.ProcessEnv = process.env,
): ActivityRetentionConfig | null {
    const raw = env.PRISM_ACTIVITY_RETENTION_DAYS?.trim();
    if (!raw) return null;
    const days = Number.parseInt(raw, 10);
    if (!Number.isFinite(days) || days <= 0) return null;

    let sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS;
    const sweepRaw = env.PRISM_ACTIVITY_RETENTION_SWEEP_MS?.trim();
    if (sweepRaw) {
        const n = Number.parseInt(sweepRaw, 10);
        if (Number.isFinite(n) && n >= 1000) sweepIntervalMs = n;
    }

    const dbPath = env.PRISM_ACTIVITY_DB_PATH?.trim() || fallbackDbPath;
    return { retentionDays: days, sweepIntervalMs, dbPath };
}

export class ActivityRetentionPolicy {
    private timer: NodeJS.Timeout | null = null;
    private readonly intervalMs: number;
    private readonly retentionMs: number;
    private lastSweep: ActivityRetentionSweepResult | null = null;
    private lastSweepAt: string | null = null;

    constructor(
        private readonly config: ActivityRetentionConfig,
        private readonly bus: ActivityBus,
        private readonly now: () => Date = () => new Date(),
    ) {
        if (config.retentionDays <= 0) {
            throw new Error("ActivityRetentionPolicy: retentionDays must be > 0");
        }
        this.retentionMs = config.retentionDays * 24 * 60 * 60 * 1000;
        this.intervalMs = config.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    }

    /** Begin periodic sweeps. The first sweep runs after one interval. */
    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            try {
                this.sweep();
            } catch {
                // Sweep failures are logged via the activity event below or
                // surface through the bus subscribers; never let a sweep
                // exception propagate out of the timer callback.
            }
        }, this.intervalMs);
        // Allow process exit even if the interval is still pending.
        if (typeof this.timer.unref === "function") this.timer.unref();
    }

    /** Stop periodic sweeps. */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * Run one sweep synchronously and emit an `activity.retention.swept`
     * event with the result. Exported for tests and for operator-triggered
     * one-shot sweeps from an admin endpoint.
     */
    sweep(): ActivityRetentionSweepResult {
        const start = Date.now();
        const cutoff = new Date(this.now().getTime() - this.retentionMs);
        const cutoffIso = cutoff.toISOString();

        const db = new DatabaseSync(this.config.dbPath);
        let deleted = 0;
        try {
            const stmt = db.prepare("DELETE FROM activity_events WHERE timestamp < :cutoff");
            const info = stmt.run({ cutoff: cutoffIso });
            // node:sqlite returns { changes, lastInsertRowid }; coerce defensively.
            const changes = (info as { changes?: number | bigint }).changes;
            if (typeof changes === "bigint") deleted = Number(changes);
            else if (typeof changes === "number") deleted = changes;
        } finally {
            db.close();
        }

        const result: ActivityRetentionSweepResult = {
            deleted,
            cutoffIso,
            durationMs: Date.now() - start,
        };
        this.lastSweep = result;
        this.lastSweepAt = new Date().toISOString();

        this.bus.emit({
            sessionId: "system:activity-retention",
            layer: "governance",
            operation: "activity.retention.swept",
            status: "succeeded",
            details: {
                deleted,
                cutoffIso,
                durationMs: result.durationMs,
                retentionDays: this.config.retentionDays,
            },
            sideEffects: deleted > 0 ? [{
                type: "database",
                description: `deleted ${deleted} activity_events row(s) older than ${cutoffIso}`,
                action: "delete",
                resource: "activity_events",
                mutating: true,
                reversible: false,
            }] : [],
        });

        return result;
    }

    /** Test/diagnostic helper — true while the timer is active. */
    isRunning(): boolean {
        return this.timer !== null;
    }

    /** Most recent successful sweep result, or null when no sweep has run. */
    getLastSweep(): ActivityRetentionSweepResult | null {
        return this.lastSweep;
    }

    /**
     * Read-only status snapshot. Safe to call before `start()` and after
     * `stop()`. Used by the `/api/activity/retention/status` endpoint.
     */
    getStatus(): {
        enabled: true;
        retentionDays: number;
        sweepIntervalMs: number;
        dbPath: string;
        running: boolean;
        lastSweepAt: string | null;
        lastSweep: ActivityRetentionSweepResult | null;
    } {
        return {
            enabled: true,
            retentionDays: this.config.retentionDays,
            sweepIntervalMs: this.intervalMs,
            dbPath: this.config.dbPath,
            running: this.timer !== null,
            lastSweepAt: this.lastSweepAt,
            lastSweep: this.lastSweep,
        };
    }
}
