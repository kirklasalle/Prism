import assert from "node:assert";
import { unlinkSync, existsSync } from "node:fs";
import { RetrievalDashboardStore } from "../src/core/memory/retrieval-dashboard-store.js";
import type { RetrievalCohortDashboard } from "../src/core/memory/retrieval-metrics.js";

export async function testRetrievalDashboardStore(): Promise<void> {
    const dbPath = "./prism-test-retrieval-dashboard.db";
    if (existsSync(dbPath)) {
        unlinkSync(dbPath);
    }

    const store = new RetrievalDashboardStore(dbPath);

    const dashboardA: RetrievalCohortDashboard = {
        generatedAt: "2026-03-11T00:00:00.000Z",
        sampleSize: 20,
        cohortCount: 2,
        cohorts: [
            {
                cohortKey: "approval_file_write",
                queryCount: 7,
                hitRate: 0.86,
                avgCoverageScore: 0.72,
                avgNoveltyScore: 0.41,
                avgUtilityScore: 0.67,
                avgLatencyMs: 24,
                p95LatencyMs: 55,
                firstSeen: "2026-03-11T00:00:00.000Z",
                lastSeen: "2026-03-11T00:10:00.000Z",
            },
            {
                cohortKey: "approval_timeout",
                queryCount: 4,
                hitRate: 0.65,
                avgCoverageScore: 0.52,
                avgNoveltyScore: 0.33,
                avgUtilityScore: 0.50,
                avgLatencyMs: 45,
                p95LatencyMs: 95,
                firstSeen: "2026-03-11T00:02:00.000Z",
                lastSeen: "2026-03-11T00:10:00.000Z",
            },
        ],
        alerts: [],
    };

    const dashboardB: RetrievalCohortDashboard = {
        generatedAt: "2026-03-11T00:20:00.000Z",
        sampleSize: 20,
        cohortCount: 1,
        cohorts: [
            {
                cohortKey: "approval_timeout",
                queryCount: 5,
                hitRate: 0.4,
                avgCoverageScore: 0.25,
                avgNoveltyScore: 0.1,
                avgUtilityScore: 0.22,
                avgLatencyMs: 60,
                p95LatencyMs: 140,
                firstSeen: "2026-03-11T00:12:00.000Z",
                lastSeen: "2026-03-11T00:20:00.000Z",
            },
        ],
        alerts: ["Cohort approval_timeout has low utility (0.22)."],
    };

    store.saveSnapshot("session-a", dashboardA);
    store.saveSnapshot("session-a", dashboardB);

    const dashboardC: RetrievalCohortDashboard = {
        generatedAt: "2026-03-11T00:30:00.000Z",
        sampleSize: 25,
        cohortCount: 2,
        cohorts: [
            {
                cohortKey: "approval_timeout",
                queryCount: 8,
                hitRate: 0.2,
                avgCoverageScore: 0.12,
                avgNoveltyScore: 0.08,
                avgUtilityScore: 0.12,
                avgLatencyMs: 90,
                p95LatencyMs: 280,
                firstSeen: "2026-03-11T00:21:00.000Z",
                lastSeen: "2026-03-11T00:30:00.000Z",
            },
            {
                cohortKey: "approval_file_write",
                queryCount: 9,
                hitRate: 0.92,
                avgCoverageScore: 0.8,
                avgNoveltyScore: 0.4,
                avgUtilityScore: 0.74,
                avgLatencyMs: 20,
                p95LatencyMs: 52,
                firstSeen: "2026-03-11T00:22:00.000Z",
                lastSeen: "2026-03-11T00:30:00.000Z",
            },
        ],
        alerts: ["Cohort approval_timeout has high p95 latency (280.0ms)."],
    };

    store.saveSnapshot("session-a", dashboardC);

    const recent = store.getRecentSnapshots(5, "session-a");
    assert.strictEqual(recent.length, 3);
    assert.strictEqual(recent[0]!.cohortCount, 2);
    assert.strictEqual(recent[1]!.cohortCount, 1);
    assert.strictEqual(recent[0]!.dashboard.cohorts[0]!.cohortKey, "approval_timeout");

    const allRecent = store.getRecentSnapshots(10);
    assert.ok(allRecent.length >= 2);

    const trend = store.getTrendReport("session-a", 10, 5);
    assert.ok(trend);
    assert.strictEqual(trend!.snapshotsCompared, 3);
    assert.ok(trend!.topChanges.length > 0);
    const timeoutTrend = trend!.topChanges.find((item) => item.cohortKey === "approval_timeout");
    assert.ok(timeoutTrend);
    assert.ok(timeoutTrend!.utilityDelta < 0);
    assert.ok(timeoutTrend!.p95LatencyDeltaMs > 0);
    assert.ok(trend!.alerts.length > 0);

    const strictTrend = store.getTrendReport("session-a", 10, 5, {
        trendUtilityDropThreshold: -0.01,
        trendHitRateDropThreshold: -0.01,
        trendP95LatencyIncreaseMs: 10,
    });
    assert.ok(strictTrend);
    assert.ok(strictTrend!.alerts.length >= trend!.alerts.length);

    store.close();

    if (existsSync(dbPath)) {
        unlinkSync(dbPath);
    }

    console.log("✓ RetrievalDashboardStore tests passed");
}
