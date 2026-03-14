import assert from "node:assert";
import { EpisodicMemory } from "../src/core/memory/episodic-memory.js";
import { RetrievalMetricsCollector } from "../src/core/memory/retrieval-metrics.js";
import { SemanticMemoryIndex } from "../src/core/memory/semantic-memory.js";
import type { ActivityEvent } from "../src/core/activity/types.js";

export async function testEpisodicMemory(): Promise<void> {
    const episodic = new EpisodicMemory(10);

    // Empty state
    let snapshot = episodic.snapshot();
    assert.strictEqual(snapshot.count, 0);
    assert.strictEqual(snapshot.estimatedTokens, 0);

    // Add events
    for (let i = 0; i < 5; i++) {
        episodic.onEvent({
            id: `event-${i}`,
            timestamp: new Date().toISOString(),
            sessionId: "test-session",
            layer: "tool_execution",
            operation: `op${i}`,
            status: "succeeded",
            details: { result: i },
            hash: "fake-hash",
        });
    }

    snapshot = episodic.snapshot();
    assert.strictEqual(snapshot.count, 5);
    assert.ok(snapshot.estimatedTokens > 0);

    // Get recent events
    const recent = episodic.recent(3);
    assert.strictEqual(recent.length, 3);
    assert.strictEqual(recent[recent.length - 1]!.operation, "op4");

    // Test max capacity
    for (let i = 5; i < 15; i++) {
        episodic.onEvent({
            id: `event-${i}`,
            timestamp: new Date().toISOString(),
            sessionId: "test-session",
            layer: "tool_execution",
            operation: `op${i}`,
            status: "succeeded",
            details: { result: i },
            hash: "fake-hash",
        });
    }

    snapshot = episodic.snapshot();
    assert.strictEqual(snapshot.count, 10); // Max capacity is 10
    const oldest = episodic.recent(1);
    assert.strictEqual(oldest[0]!.operation, "op14"); // Most recent

    console.log("✓ EpisodicMemory tests passed");
}

export async function testSemanticMemoryIndex(): Promise<void> {
    const index = new SemanticMemoryIndex();

    // Add events
    index.onEvent({
        id: "event-1",
        timestamp: new Date().toISOString(),
        sessionId: "test-session",
        layer: "tool_execution",
        operation: "file_write",
        status: "succeeded",
        details: { path: "/etc/config.txt" },
        hash: "hash-1",
    });

    index.onEvent({
        id: "event-2",
        timestamp: new Date().toISOString(),
        sessionId: "test-session",
        layer: "governance",
        operation: "file_write.policy_check",
        status: "succeeded",
        details: { tier: "tier3_approval" },
        hash: "hash-2",
    });

    index.onEvent({
        id: "event-3",
        timestamp: new Date().toISOString(),
        sessionId: "test-session",
        layer: "tool_execution",
        operation: "shell_exec",
        status: "succeeded",
        details: { command: "node --version" },
        hash: "hash-3",
    });

    // Query for file_write
    const fileMatches = index.query("file_write", 5);
    assert.strictEqual(fileMatches.length, 2); // event-1 and event-2
    assert.strictEqual(fileMatches[0]!.operation, "file_write");

    // Query for governance layer
    const govMatches = index.query("governance", 5);
    assert.ok(govMatches.some((m) => m.id === "event-2"));

    // Query that doesn't match
    const noMatches = index.query("nonexistent_term", 5);
    assert.strictEqual(noMatches.length, 0);

    console.log("✓ SemanticMemoryIndex tests passed");
}

export async function testRetrievalMetricsCollector(): Promise<void> {
    const collector = new RetrievalMetricsCollector(100, 10, {
        cohortMinHitRate: 0.7,
        cohortMinUtility: 0.6,
        cohortMaxP95LatencyMs: 120,
    });
    const baseTime = new Date("2026-03-11T00:00:00.000Z");

    collector.recordRetrievalQuery(
        "q1",
        "approval file_write",
        [
            { id: "e1", operation: "file_write", layer: "tool_execution", timestamp: "t1", score: 1 },
            { id: "e2", operation: "file_write.policy_check", layer: "governance", timestamp: "t1", score: 0.5 },
        ],
        10,
        new Date(baseTime.getTime() + 0),
    );

    collector.recordRetrievalQuery(
        "q2",
        "approval denied",
        [{ id: "e2", operation: "file_write.policy_check", layer: "governance", timestamp: "t2", score: 0.5 }],
        30,
        new Date(baseTime.getTime() + 60_000),
    );

    collector.recordRetrievalQuery("q3", "nonexistent topic", [], 50, new Date(baseTime.getTime() + 120_000));

    collector.recordRetrievalQuery(
        "q4",
        "approval timeout",
        [{ id: "e2", operation: "file_write.policy_check", layer: "governance", timestamp: "t3", score: 0.2 }],
        60,
        new Date(baseTime.getTime() + 130_000),
    );

    collector.recordRetrievalQuery(
        "q5",
        "approval timeout",
        [{ id: "e2", operation: "file_write.policy_check", layer: "governance", timestamp: "t4", score: 0.1 }],
        80,
        new Date(baseTime.getTime() + 140_000),
    );

    collector.recordRetrievalQuery(
        "q6",
        "approval timeout",
        [{ id: "e2", operation: "file_write.policy_check", layer: "governance", timestamp: "t5", score: 0.1 }],
        90,
        new Date(baseTime.getTime() + 150_000),
    );

    const stats = collector.getStats(50);

    assert.strictEqual(stats.totalQueries, 6);
    assert.ok(stats.hitRate > 0 && stats.hitRate < 1);
    assert.ok(stats.avgCoverageScore >= 0 && stats.avgCoverageScore <= 1);
    assert.ok(stats.avgNoveltyScore >= 0 && stats.avgNoveltyScore <= 1);
    assert.ok(stats.avgUtilityScore >= 0 && stats.avgUtilityScore <= 1);
    assert.ok(stats.p50LatencyMs >= 10 && stats.p50LatencyMs <= 50);
    assert.ok(stats.p95LatencyMs >= stats.p50LatencyMs);
    assert.ok(stats.p99LatencyMs >= stats.p95LatencyMs);

    const diagnostics = collector.getGrowthAndDriftDiagnostics(3, 0.10);
    assert.ok(diagnostics.metricsBufferUtilization > 0);
    assert.ok(diagnostics.queryVolumeTrend === "up" || diagnostics.queryVolumeTrend === "stable" || diagnostics.queryVolumeTrend === "down");
    assert.ok(diagnostics.driftScore >= 0);
    assert.ok(diagnostics.alerts.length >= 0);

    const cohortDashboard = collector.getCohortDashboard(20, 5, 1);
    assert.ok(cohortDashboard.cohortCount > 0);
    assert.ok(cohortDashboard.cohorts.length > 0);
    const topCohort = cohortDashboard.cohorts[0]!;
    assert.ok(typeof topCohort.cohortKey === "string");
    assert.ok(topCohort.queryCount >= 1);
    assert.ok(topCohort.hitRate >= 0 && topCohort.hitRate <= 1);
    assert.ok(topCohort.avgUtilityScore >= 0 && topCohort.avgUtilityScore <= 1);
    assert.ok(topCohort.p95LatencyMs >= 0);
    assert.ok(Array.isArray(cohortDashboard.alerts));
    assert.ok(cohortDashboard.alerts.length > 0);

    const metrics = collector.getMetrics(6);
    assert.strictEqual(metrics.length, 6);
    assert.ok(typeof metrics[0]!.queryTokenCount === "number");
    assert.ok(Array.isArray(metrics[0]!.matchIds));
    assert.ok(typeof metrics[0]!.noveltyScore === "number");
    assert.ok(typeof metrics[0]!.utilityScore === "number");

    console.log("✓ RetrievalMetricsCollector tests passed");
}
