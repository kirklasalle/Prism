/**
 * Tests for AgentTelemetryCollector — record, summaries, global stats, recommendations.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AgentTelemetryCollector } from "../src/core/agents/agent-telemetry-collector.js";
import { AgentLifecycleManager } from "../src/core/agents/agent-lifecycle.js";
import type { DispatchTelemetryRecord } from "../src/core/agents/agent-types.js";

function makeRecord(
    agentId: string,
    ok = true,
    durationMs = 100,
    overrides?: Partial<DispatchTelemetryRecord>,
): DispatchTelemetryRecord {
    return {
        agentId,
        role: "chat",
        model: "gemma3:1b",
        providerId: "ollama",
        durationMs,
        ok,
        timestamp: Date.now(),
        ...overrides,
    };
}

describe("AgentTelemetryCollector", () => {
    let telemetry: AgentTelemetryCollector;

    beforeEach(() => {
        telemetry = new AgentTelemetryCollector();
    });

    // ── record & getAgentSummary ─────────────────────────────────────────

    it("getAgentSummary returns null for unrecorded agent", () => {
        assert.equal(telemetry.getAgentSummary("unknown"), null);
    });

    it("records a dispatch and returns summary", () => {
        telemetry.record(makeRecord("chat", true, 200));
        const s = telemetry.getAgentSummary("chat");
        assert.ok(s);
        assert.equal(s.agentId, "chat");
        assert.equal(s.dispatchCount, 1);
        assert.equal(s.avgDurationMs, 200);
        assert.equal(s.successRate, 1.0);
        assert.equal(s.lastModel, "gemma3:1b");
    });

    it("computes correct average and p95 duration", () => {
        // 10 records: durations 10, 20, ...100
        for (let i = 1; i <= 10; i++) {
            telemetry.record(makeRecord("agent-a", true, i * 10));
        }
        const s = telemetry.getAgentSummary("agent-a")!;
        assert.equal(s.dispatchCount, 10);
        assert.equal(s.avgDurationMs, 55); // (10+20+...+100)/10 = 550/10
        assert.ok(s.p95DurationMs >= 90); // p95 of [10..100] should be high
    });

    it("tracks success rate correctly with mix of ok/fail", () => {
        telemetry.record(makeRecord("x", true));
        telemetry.record(makeRecord("x", true));
        telemetry.record(makeRecord("x", false));
        telemetry.record(makeRecord("x", true));
        const s = telemetry.getAgentSummary("x")!;
        assert.equal(s.dispatchCount, 4);
        assert.equal(s.successRate, 0.75);
    });

    // ── getAllSummaries ──────────────────────────────────────────────────

    it("getAllSummaries returns summaries for all agents", () => {
        telemetry.record(makeRecord("a"));
        telemetry.record(makeRecord("b"));
        telemetry.record(makeRecord("c"));
        const all = telemetry.getAllSummaries();
        assert.equal(all.length, 3);
        const ids = all.map((s) => s.agentId).sort();
        assert.deepEqual(ids, ["a", "b", "c"]);
    });

    // ── getGlobalStats ──────────────────────────────────────────────────

    it("getGlobalStats returns correct counters", () => {
        telemetry.record(makeRecord("a", true, 100));
        telemetry.record(makeRecord("a", false, 200));
        telemetry.record(makeRecord("b", true, 300));

        const stats = telemetry.getGlobalStats();
        assert.equal(stats.totalDispatches, 3);
        assert.equal(stats.tasksCompleted, 2);
        assert.equal(stats.tasksFailed, 1);
        assert.equal(stats.activeAgents, 2);
        assert.equal(stats.avgResponseMs, 200); // (100+200+300)/3
    });

    it("getGlobalStats returns zeros when empty", () => {
        const stats = telemetry.getGlobalStats();
        assert.equal(stats.totalDispatches, 0);
        assert.equal(stats.avgResponseMs, 0);
    });

    // ── getPromotionRecommendations ─────────────────────────────────────

    it("recommends promotion for high-performing ephemeral agent", () => {
        const lifecycle = new AgentLifecycleManager();
        lifecycle.spawn({ agentId: "worker-1", role: "chat", lifecycle: "ephemeral" });

        // 12 successful records
        for (let i = 0; i < 12; i++) {
            telemetry.record(makeRecord("worker-1", true, 50));
        }

        const recs = telemetry.getPromotionRecommendations(lifecycle);
        assert.equal(recs.length, 1);
        assert.equal(recs[0].agentId, "worker-1");
        assert.equal(recs[0].currentTier, "ephemeral");
        assert.equal(recs[0].recommendedTier, "semi-permanent");
        assert.ok(recs[0].successRate >= 0.8);
    });

    it("does not recommend promotion below dispatch threshold", () => {
        const lifecycle = new AgentLifecycleManager();
        lifecycle.spawn({ agentId: "worker-2", role: "chat", lifecycle: "ephemeral" });

        // Only 5 records (below threshold of 10)
        for (let i = 0; i < 5; i++) {
            telemetry.record(makeRecord("worker-2", true));
        }

        const recs = telemetry.getPromotionRecommendations(lifecycle);
        assert.equal(recs.length, 0);
    });

    it("does not recommend promotion for low success rate", () => {
        const lifecycle = new AgentLifecycleManager();
        lifecycle.spawn({ agentId: "worker-3", role: "chat", lifecycle: "ephemeral" });

        // 12 records, 50% success (below 80% threshold)
        for (let i = 0; i < 6; i++) {
            telemetry.record(makeRecord("worker-3", true));
        }
        for (let i = 0; i < 6; i++) {
            telemetry.record(makeRecord("worker-3", false));
        }

        const recs = telemetry.getPromotionRecommendations(lifecycle);
        assert.equal(recs.length, 0);
    });

    it("does not recommend promotion for permanent agents", () => {
        const lifecycle = new AgentLifecycleManager();
        // "chat" is default permanent
        for (let i = 0; i < 15; i++) {
            telemetry.record(makeRecord("chat", true));
        }
        const recs = telemetry.getPromotionRecommendations(lifecycle);
        const chatRec = recs.find((r) => r.agentId === "chat");
        assert.equal(chatRec, undefined);
    });

    // ── getDispatchFrequency ────────────────────────────────────────────

    it("getDispatchFrequency returns sorted frequency histogram", () => {
        telemetry.record(makeRecord("a"));
        telemetry.record(makeRecord("a"));
        telemetry.record(makeRecord("a"));
        telemetry.record(makeRecord("b"));

        const freq = telemetry.getDispatchFrequency();
        assert.equal(freq.length, 2);
        assert.equal(freq[0].agentId, "a");
        assert.equal(freq[0].count, 3);
        assert.equal(freq[1].agentId, "b");
        assert.equal(freq[1].count, 1);
    });

    // ── clear ────────────────────────────────────────────────────────────

    it("clear() resets all state", () => {
        telemetry.record(makeRecord("a"));
        telemetry.record(makeRecord("b"));
        telemetry.clear();
        assert.equal(telemetry.getAllSummaries().length, 0);
        assert.equal(telemetry.getGlobalStats().totalDispatches, 0);
    });

    // ── Memory bounds ────────────────────────────────────────────────────

    it("bounds records per agent to MAX_RECORDS_PER_AGENT", () => {
        // Record 600 entries (limit is 500)
        for (let i = 0; i < 600; i++) {
            telemetry.record(makeRecord("bounded", true, i));
        }
        const s = telemetry.getAgentSummary("bounded")!;
        assert.equal(s.dispatchCount, 500); // bounded
    });
});
