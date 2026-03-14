import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { RetrievalCohortDashboard } from "./retrieval-metrics.js";
import type { RetrievalAlertPolicy } from "./retrieval-alert-policy.js";
import { withRetrievalAlertPolicy } from "./retrieval-alert-policy.js";

export interface RetrievalCohortSnapshot {
    id: number;
    sessionId: string;
    generatedAt: string;
    sampleSize: number;
    cohortCount: number;
    dashboard: RetrievalCohortDashboard;
}

export interface RetrievalCohortTrendItem {
    cohortKey: string;
    latestQueryCount: number;
    baselineQueryCount: number;
    queryCountDelta: number;
    latestHitRate: number;
    baselineHitRate: number;
    hitRateDelta: number;
    latestUtility: number;
    baselineUtility: number;
    utilityDelta: number;
    latestP95LatencyMs: number;
    baselineP95LatencyMs: number;
    p95LatencyDeltaMs: number;
}

export interface RetrievalCohortTrendReport {
    sessionId: string;
    latestGeneratedAt: string;
    baselineGeneratedAt: string;
    snapshotsCompared: number;
    topChanges: RetrievalCohortTrendItem[];
    alerts: string[];
}

export class RetrievalDashboardStore {
    private readonly db: DatabaseSync;
    private readonly insertStmt: StatementSync;

    constructor(dbPath: string = "prism-activity.db") {
        this.db = new DatabaseSync(dbPath);
        this.migrate();
        this.insertStmt = this.db.prepare(`
      INSERT INTO retrieval_cohort_snapshots
        (session_id, generated_at, sample_size, cohort_count, payload)
      VALUES
        (:sessionId, :generatedAt, :sampleSize, :cohortCount, :payload)
    `);
    }

    private migrate(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS retrieval_cohort_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        sample_size INTEGER NOT NULL,
        cohort_count INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rcs_session ON retrieval_cohort_snapshots(session_id);
      CREATE INDEX IF NOT EXISTS idx_rcs_generated_at ON retrieval_cohort_snapshots(generated_at);
    `);

        this.ensureColumns("retrieval_cohort_snapshots", [
            { name: "sample_size", definition: "INTEGER NOT NULL DEFAULT 0" },
            { name: "cohort_count", definition: "INTEGER NOT NULL DEFAULT 0" },
            { name: "payload", definition: "TEXT NOT NULL DEFAULT '{}'" },
        ]);
    }

    private ensureColumns(
        tableName: string,
        columns: Array<{ name: string; definition: string }>,
    ): void {
        const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
        const existing = new Set(rows.map((row) => row.name));

        for (const column of columns) {
            if (existing.has(column.name)) {
                continue;
            }

            this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.definition}`);
        }
    }

    saveSnapshot(sessionId: string, dashboard: RetrievalCohortDashboard): void {
        this.insertStmt.run({
            sessionId,
            generatedAt: dashboard.generatedAt,
            sampleSize: dashboard.sampleSize,
            cohortCount: dashboard.cohortCount,
            payload: JSON.stringify(dashboard),
        });
    }

    getRecentSnapshots(limit: number = 20, sessionId?: string): RetrievalCohortSnapshot[] {
        const boundedLimit = Math.max(1, Math.floor(limit));

        const query = sessionId
            ? `
      SELECT id, session_id, generated_at, sample_size, cohort_count, payload
      FROM retrieval_cohort_snapshots
      WHERE session_id = :sessionId
      ORDER BY generated_at DESC, id DESC
      LIMIT :limit
    `
            : `
      SELECT id, session_id, generated_at, sample_size, cohort_count, payload
      FROM retrieval_cohort_snapshots
      ORDER BY generated_at DESC, id DESC
      LIMIT :limit
    `;

        const stmt = this.db.prepare(query);
        const rows = sessionId
            ? stmt.all({ sessionId, limit: boundedLimit })
            : stmt.all({ limit: boundedLimit });

        return (rows as Array<Record<string, unknown>>).map((row) => ({
            id: Number(row.id),
            sessionId: String(row.session_id),
            generatedAt: String(row.generated_at),
            sampleSize: Number(row.sample_size),
            cohortCount: Number(row.cohort_count),
            dashboard: JSON.parse(String(row.payload)) as RetrievalCohortDashboard,
        }));
    }

    getTrendReport(
        sessionId: string,
        lookbackSnapshots: number = 10,
        topN: number = 5,
        alertPolicyOverrides: Partial<RetrievalAlertPolicy> = {},
    ): RetrievalCohortTrendReport | null {
        const alertPolicy = withRetrievalAlertPolicy(alertPolicyOverrides);
        const snapshots = this.getRecentSnapshots(Math.max(2, lookbackSnapshots), sessionId);
        if (snapshots.length < 2) {
            return null;
        }

        const latest = snapshots[0]!;
        const baseline = snapshots[snapshots.length - 1]!;

        const baselineByCohort = new Map(baseline.dashboard.cohorts.map((cohort) => [cohort.cohortKey, cohort]));
        const trends: RetrievalCohortTrendItem[] = latest.dashboard.cohorts.map((cohort) => {
            const previous = baselineByCohort.get(cohort.cohortKey);
            return {
                cohortKey: cohort.cohortKey,
                latestQueryCount: cohort.queryCount,
                baselineQueryCount: previous?.queryCount ?? 0,
                queryCountDelta: cohort.queryCount - (previous?.queryCount ?? 0),
                latestHitRate: cohort.hitRate,
                baselineHitRate: previous?.hitRate ?? 0,
                hitRateDelta: cohort.hitRate - (previous?.hitRate ?? 0),
                latestUtility: cohort.avgUtilityScore,
                baselineUtility: previous?.avgUtilityScore ?? 0,
                utilityDelta: cohort.avgUtilityScore - (previous?.avgUtilityScore ?? 0),
                latestP95LatencyMs: cohort.p95LatencyMs,
                baselineP95LatencyMs: previous?.p95LatencyMs ?? 0,
                p95LatencyDeltaMs: cohort.p95LatencyMs - (previous?.p95LatencyMs ?? 0),
            };
        });

        trends.sort((a, b) => Math.abs(b.utilityDelta) - Math.abs(a.utilityDelta));
        const topChanges = trends.slice(0, Math.max(1, topN));

        const alerts: string[] = [];
        for (const trend of topChanges) {
            if (trend.utilityDelta < alertPolicy.trendUtilityDropThreshold) {
                alerts.push(`Cohort ${trend.cohortKey} utility dropped by ${trend.utilityDelta.toFixed(2)}.`);
            }
            if (trend.hitRateDelta < alertPolicy.trendHitRateDropThreshold) {
                alerts.push(`Cohort ${trend.cohortKey} hit rate dropped by ${(trend.hitRateDelta * 100).toFixed(1)}%.`);
            }
            if (trend.p95LatencyDeltaMs > alertPolicy.trendP95LatencyIncreaseMs) {
                alerts.push(`Cohort ${trend.cohortKey} p95 latency increased by ${trend.p95LatencyDeltaMs.toFixed(1)}ms.`);
            }
        }

        return {
            sessionId,
            latestGeneratedAt: latest.generatedAt,
            baselineGeneratedAt: baseline.generatedAt,
            snapshotsCompared: snapshots.length,
            topChanges,
            alerts,
        };
    }

    close(): void {
        this.db.close();
    }
}
