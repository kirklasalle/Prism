import type { TaskRole } from "../operator/model-capability-matrix.js";
import type {
    AgentLifecycleTier,
    AgentTelemetrySummary,
    DispatchTelemetryRecord,
    PromotionRecommendation,
} from "./agent-types.js";
import type { AgentLifecycleManager } from "./agent-lifecycle.js";

// ──────────────────────────────────────────────────────────────────────────────
// AgentTelemetryCollector
// ──────────────────────────────────────────────────────────────────────────────

/** Dispatch threshold before recommending promotion from ephemeral. */
const PROMOTION_DISPATCH_THRESHOLD = 10;
/** Success rate threshold for promotion recommendation. */
const PROMOTION_SUCCESS_THRESHOLD = 0.8;
/** Maximum records kept per agent to bound memory. */
const MAX_RECORDS_PER_AGENT = 500;

export class AgentTelemetryCollector {
    private readonly records = new Map<string, DispatchTelemetryRecord[]>();
    private totalDispatches = 0;
    private totalCompleted = 0;
    private totalFailed = 0;

    /** Record a dispatch event. */
    record(entry: DispatchTelemetryRecord): void {
        let agentRecords = this.records.get(entry.agentId);
        if (!agentRecords) {
            agentRecords = [];
            this.records.set(entry.agentId, agentRecords);
        }
        agentRecords.push(entry);
        // Bound memory usage
        if (agentRecords.length > MAX_RECORDS_PER_AGENT) {
            agentRecords.splice(0, agentRecords.length - MAX_RECORDS_PER_AGENT);
        }
        this.totalDispatches++;
        if (entry.ok) this.totalCompleted++;
        else this.totalFailed++;
    }

    /** Return telemetry summary for a single agent. */
    getAgentSummary(agentId: string): AgentTelemetrySummary | null {
        const recs = this.records.get(agentId);
        if (!recs || recs.length === 0) return null;

        const durations = recs.map((r) => r.durationMs).sort((a, b) => a - b);
        const successes = recs.filter((r) => r.ok).length;
        const last = recs[recs.length - 1];

        return {
            agentId,
            role: last.role,
            dispatchCount: recs.length,
            avgDurationMs: Math.round(durations.reduce((s, d) => s + d, 0) / durations.length),
            p95DurationMs: durations[Math.floor(durations.length * 0.95)] ?? durations[durations.length - 1],
            successRate: successes / recs.length,
            lastModel: last.model,
            lastActiveAt: last.timestamp,
        };
    }

    /** Return summaries for all recorded agents. */
    getAllSummaries(): AgentTelemetrySummary[] {
        const summaries: AgentTelemetrySummary[] = [];
        for (const agentId of this.records.keys()) {
            const s = this.getAgentSummary(agentId);
            if (s) summaries.push(s);
        }
        return summaries;
    }

    /** Return global counters. */
    getGlobalStats(): { activeAgents: number; tasksCompleted: number; tasksFailed: number; avgResponseMs: number; totalDispatches: number } {
        let totalDuration = 0;
        let totalCount = 0;
        for (const recs of this.records.values()) {
            for (const r of recs) {
                totalDuration += r.durationMs;
                totalCount++;
            }
        }

        return {
            activeAgents: this.records.size,
            tasksCompleted: this.totalCompleted,
            tasksFailed: this.totalFailed,
            avgResponseMs: totalCount > 0 ? Math.round(totalDuration / totalCount) : 0,
            totalDispatches: this.totalDispatches,
        };
    }

    /** Analyze dispatch patterns and recommend promotions. */
    getPromotionRecommendations(lifecycle: AgentLifecycleManager): PromotionRecommendation[] {
        const recommendations: PromotionRecommendation[] = [];

        for (const [agentId, recs] of this.records) {
            if (recs.length < PROMOTION_DISPATCH_THRESHOLD) continue;

            const instance = lifecycle.get(agentId);
            if (!instance || instance.lifecycle === "permanent") continue;

            const successes = recs.filter((r) => r.ok).length;
            const successRate = successes / recs.length;
            if (successRate < PROMOTION_SUCCESS_THRESHOLD) continue;

            const recommendedTier: AgentLifecycleTier =
                instance.lifecycle === "ephemeral" ? "semi-permanent" : "permanent";

            recommendations.push({
                agentId,
                currentTier: instance.lifecycle,
                recommendedTier,
                reason: `${recs.length} dispatches with ${(successRate * 100).toFixed(0)}% success rate`,
                dispatchCount: recs.length,
                successRate,
            });
        }

        return recommendations;
    }

    /** Get dispatch frequency histogram (dispatches per agent per role). */
    getDispatchFrequency(): Array<{ agentId: string; role: TaskRole; count: number }> {
        const freq: Array<{ agentId: string; role: TaskRole; count: number }> = [];
        for (const [agentId, recs] of this.records) {
            if (recs.length === 0) continue;
            freq.push({ agentId, role: recs[0].role, count: recs.length });
        }
        return freq.sort((a, b) => b.count - a.count);
    }

    /** Clear all telemetry records. */
    clear(): void {
        this.records.clear();
        this.totalDispatches = 0;
        this.totalCompleted = 0;
        this.totalFailed = 0;
    }
}
