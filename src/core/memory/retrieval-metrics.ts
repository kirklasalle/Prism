import type { SemanticMatch } from "../memory/semantic-memory.js";
import {
    type RetrievalAlertPolicy,
    withRetrievalAlertPolicy,
} from "./retrieval-alert-policy.js";

export interface RetrievalMetric {
    queryId: string;
    query: string;
    queryTokenCount: number;
    matchCount: number;
    matchIds: string[];
    hasHit: boolean;
    coverageScore: number;
    noveltyScore: number;
    utilityScore: number;
    topScores: number[];
    latencyMs: number;
    timestamp: string;
}

export interface RetrievalStats {
    totalQueries: number;
    hitRate: number;
    avgMatchCount: number;
    avgTopScore: number;
    avgCoverageScore: number;
    avgNoveltyScore: number;
    avgUtilityScore: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
}

export interface RetrievalGrowthDriftDiagnostics {
    totalQueries: number;
    metricsBufferUtilization: number;
    olderWindowSize: number;
    newerWindowSize: number;
    queryVolumePerMinuteOlder: number;
    queryVolumePerMinuteNewer: number;
    queryVolumeTrend: "up" | "down" | "stable" | "insufficient_data";
    coverageDelta: number;
    noveltyDelta: number;
    utilityDelta: number;
    hitRateDelta: number;
    driftScore: number;
    driftDetected: boolean;
    alerts: string[];
}

export interface RetrievalCohortSummary {
    cohortKey: string;
    queryCount: number;
    hitRate: number;
    avgCoverageScore: number;
    avgNoveltyScore: number;
    avgUtilityScore: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    firstSeen: string;
    lastSeen: string;
}

export interface RetrievalCohortDashboard {
    generatedAt: string;
    sampleSize: number;
    cohortCount: number;
    cohorts: RetrievalCohortSummary[];
    alerts: string[];
}

export class RetrievalMetricsCollector {
    private readonly metrics: RetrievalMetric[] = [];
    private readonly maxMetrics: number;
    private readonly noveltyWindow: number;
    private readonly alertPolicy: RetrievalAlertPolicy;

    constructor(
        maxMetrics: number = 1000,
        noveltyWindow: number = 100,
        alertPolicyOverrides: Partial<RetrievalAlertPolicy> = {},
    ) {
        this.maxMetrics = maxMetrics;
        this.noveltyWindow = Math.max(1, noveltyWindow);
        this.alertPolicy = withRetrievalAlertPolicy(alertPolicyOverrides);
    }

    recordRetrievalQuery(
        queryId: string,
        query: string,
        matches: SemanticMatch[],
        latencyMs: number,
        recordedAt: Date = new Date(),
    ): void {
        const queryTokens = tokenize(query);
        const queryTokenCount = queryTokens.length;
        const topScores = matches.slice(0, 5).map((m) => m.score);
        const matchIds = matches.slice(0, 5).map((m) => m.id);
        const hasHit = matches.length > 0;
        const coverageScore = topScores[0] ?? 0;
        const noveltyScore = this.calculateNoveltyScore(matchIds);
        const utilityScore = hasHit
            ? clamp01((coverageScore * 0.5) + (noveltyScore * 0.3) + (Math.min(1, matches.length / 3) * 0.2))
            : 0;

        this.metrics.push({
            queryId,
            query,
            queryTokenCount,
            matchCount: matches.length,
            matchIds,
            hasHit,
            coverageScore,
            noveltyScore,
            utilityScore,
            topScores,
            latencyMs,
            timestamp: recordedAt.toISOString(),
        });

        while (this.metrics.length > this.maxMetrics) {
            this.metrics.shift();
        }
    }

    getMetrics(limit: number = 100): RetrievalMetric[] {
        return this.metrics.slice(-Math.max(1, limit));
    }

    getStats(sampleSize: number = 100): RetrievalStats {
        const sample = this.metrics.slice(-Math.max(1, sampleSize));

        if (sample.length === 0) {
            return {
                totalQueries: 0,
                hitRate: 0,
                avgMatchCount: 0,
                avgTopScore: 0,
                avgCoverageScore: 0,
                avgNoveltyScore: 0,
                avgUtilityScore: 0,
                avgLatencyMs: 0,
                p50LatencyMs: 0,
                p95LatencyMs: 0,
                p99LatencyMs: 0,
            };
        }

        const latencies = sample.map((m) => m.latencyMs).sort((a, b) => a - b);

        return {
            totalQueries: this.metrics.length,
            hitRate: sample.reduce((sum, m) => sum + (m.hasHit ? 1 : 0), 0) / sample.length,
            avgMatchCount: sample.reduce((sum, m) => sum + m.matchCount, 0) / sample.length,
            avgTopScore:
                sample.reduce((sum, m) => sum + (m.topScores[0] ?? 0), 0) / sample.length,
            avgCoverageScore: sample.reduce((sum, m) => sum + m.coverageScore, 0) / sample.length,
            avgNoveltyScore: sample.reduce((sum, m) => sum + m.noveltyScore, 0) / sample.length,
            avgUtilityScore: sample.reduce((sum, m) => sum + m.utilityScore, 0) / sample.length,
            avgLatencyMs: sample.reduce((sum, m) => sum + m.latencyMs, 0) / sample.length,
            p50LatencyMs: percentile(latencies, 0.50),
            p95LatencyMs: percentile(latencies, 0.95),
            p99LatencyMs: percentile(latencies, 0.99),
        };
    }

    getGrowthAndDriftDiagnostics(
        windowSize: number = 20,
        driftThreshold: number = this.alertPolicy.driftScoreThreshold,
    ): RetrievalGrowthDriftDiagnostics {
        const boundedWindowSize = Math.max(2, windowSize);
        const alerts: string[] = [];

        if (this.metrics.length < boundedWindowSize * 2) {
            return {
                totalQueries: this.metrics.length,
                metricsBufferUtilization: this.metrics.length / this.maxMetrics,
                olderWindowSize: 0,
                newerWindowSize: 0,
                queryVolumePerMinuteOlder: 0,
                queryVolumePerMinuteNewer: 0,
                queryVolumeTrend: "insufficient_data",
                coverageDelta: 0,
                noveltyDelta: 0,
                utilityDelta: 0,
                hitRateDelta: 0,
                driftScore: 0,
                driftDetected: false,
                alerts: ["Insufficient retrieval history for growth/drift diagnostics."],
            };
        }

        const sample = this.metrics.slice(-(boundedWindowSize * 2));
        const older = sample.slice(0, boundedWindowSize);
        const newer = sample.slice(boundedWindowSize);

        const olderCoverage = average(older.map((metric) => metric.coverageScore));
        const newerCoverage = average(newer.map((metric) => metric.coverageScore));
        const olderNovelty = average(older.map((metric) => metric.noveltyScore));
        const newerNovelty = average(newer.map((metric) => metric.noveltyScore));
        const olderUtility = average(older.map((metric) => metric.utilityScore));
        const newerUtility = average(newer.map((metric) => metric.utilityScore));
        const olderHitRate = average(older.map((metric) => (metric.hasHit ? 1 : 0)));
        const newerHitRate = average(newer.map((metric) => (metric.hasHit ? 1 : 0)));

        const olderRate = queriesPerMinute(older);
        const newerRate = queriesPerMinute(newer);
        const volumeDeltaRatio = ratioDelta(olderRate, newerRate);
        const queryVolumeTrend = classifyTrend(volumeDeltaRatio, this.alertPolicy.volumeTrendChangeThreshold);

        const coverageDelta = newerCoverage - olderCoverage;
        const noveltyDelta = newerNovelty - olderNovelty;
        const utilityDelta = newerUtility - olderUtility;
        const hitRateDelta = newerHitRate - olderHitRate;
        const driftScore = average([
            Math.abs(coverageDelta),
            Math.abs(noveltyDelta),
            Math.abs(utilityDelta),
            Math.abs(hitRateDelta),
        ]);
        const driftDetected = driftScore >= Math.max(0.01, driftThreshold);

        if (driftDetected) {
            alerts.push(`Retrieval drift detected (score=${driftScore.toFixed(3)}).`);
        }
        if (newerUtility < this.alertPolicy.recentMinUtility) {
            alerts.push("Utility score is low in the recent window.");
        }
        if (newerNovelty < this.alertPolicy.recentMinNovelty) {
            alerts.push("Novelty score is low; repeated retrieval patterns may be increasing.");
        }
        if (coverageDelta < this.alertPolicy.coverageDropThreshold) {
            alerts.push("Coverage score dropped significantly in the recent window.");
        }
        if (
            queryVolumeTrend === "up" &&
            newerRate >= this.alertPolicy.volumeSpikeMultiplier * Math.max(olderRate, 0.001)
        ) {
            alerts.push("Query volume growth spike detected.");
        }

        return {
            totalQueries: this.metrics.length,
            metricsBufferUtilization: this.metrics.length / this.maxMetrics,
            olderWindowSize: older.length,
            newerWindowSize: newer.length,
            queryVolumePerMinuteOlder: olderRate,
            queryVolumePerMinuteNewer: newerRate,
            queryVolumeTrend,
            coverageDelta,
            noveltyDelta,
            utilityDelta,
            hitRateDelta,
            driftScore,
            driftDetected,
            alerts,
        };
    }

    getCohortDashboard(
        sampleSize: number = 200,
        topN: number = 5,
        minCohortSize: number = 2,
    ): RetrievalCohortDashboard {
        const sample = this.metrics.slice(-Math.max(1, sampleSize));
        const groups = new Map<string, RetrievalMetric[]>();

        for (const metric of sample) {
            const key = cohortKey(metric.query);
            const bucket = groups.get(key);
            if (bucket) {
                bucket.push(metric);
            } else {
                groups.set(key, [metric]);
            }
        }

        const cohortSummaries: RetrievalCohortSummary[] = [];
        for (const [key, metrics] of groups.entries()) {
            if (metrics.length < Math.max(1, minCohortSize)) {
                continue;
            }

            const latencies = metrics.map((metric) => metric.latencyMs).sort((a, b) => a - b);
            const firstSeen = metrics[0]!.timestamp;
            const lastSeen = metrics[metrics.length - 1]!.timestamp;

            cohortSummaries.push({
                cohortKey: key,
                queryCount: metrics.length,
                hitRate: average(metrics.map((metric) => (metric.hasHit ? 1 : 0))),
                avgCoverageScore: average(metrics.map((metric) => metric.coverageScore)),
                avgNoveltyScore: average(metrics.map((metric) => metric.noveltyScore)),
                avgUtilityScore: average(metrics.map((metric) => metric.utilityScore)),
                avgLatencyMs: average(metrics.map((metric) => metric.latencyMs)),
                p95LatencyMs: percentile(latencies, 0.95),
                firstSeen,
                lastSeen,
            });
        }

        cohortSummaries.sort((a, b) => {
            if (b.queryCount !== a.queryCount) {
                return b.queryCount - a.queryCount;
            }
            return b.avgUtilityScore - a.avgUtilityScore;
        });

        const selected = cohortSummaries.slice(0, Math.max(1, topN));
        const alerts = buildCohortAlerts(selected, this.alertPolicy);

        return {
            generatedAt: new Date().toISOString(),
            sampleSize: sample.length,
            cohortCount: cohortSummaries.length,
            cohorts: selected,
            alerts,
        };
    }

    private calculateNoveltyScore(matchIds: string[]): number {
        if (matchIds.length === 0) {
            return 0;
        }

        const recent = this.metrics.slice(-this.noveltyWindow);
        const seen = new Set<string>();
        for (const metric of recent) {
            for (const id of metric.matchIds) {
                seen.add(id);
            }
        }

        const unseenCount = matchIds.reduce((count, id) => count + (seen.has(id) ? 0 : 1), 0);
        return unseenCount / matchIds.length;
    }
}

function buildCohortAlerts(
    cohorts: RetrievalCohortSummary[],
    alertPolicy: RetrievalAlertPolicy,
): string[] {
    const alerts: string[] = [];
    for (const cohort of cohorts) {
        if (cohort.hitRate < alertPolicy.cohortMinHitRate) {
            alerts.push(`Cohort ${cohort.cohortKey} has low hit rate (${(cohort.hitRate * 100).toFixed(1)}%).`);
        }
        if (cohort.avgUtilityScore < alertPolicy.cohortMinUtility) {
            alerts.push(`Cohort ${cohort.cohortKey} has low utility (${cohort.avgUtilityScore.toFixed(2)}).`);
        }
        if (cohort.p95LatencyMs > alertPolicy.cohortMaxP95LatencyMs) {
            alerts.push(`Cohort ${cohort.cohortKey} has high p95 latency (${cohort.p95LatencyMs.toFixed(1)}ms).`);
        }
    }

    return alerts;
}

function percentile(sortedValues: number[], percentileValue: number): number {
    if (sortedValues.length === 0) {
        return 0;
    }

    const clamped = clamp01(percentileValue);
    const index = Math.floor((sortedValues.length - 1) * clamped);
    return sortedValues[index] ?? 0;
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function tokenize(input: string): string[] {
    return input
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((token) => token.length > 1);
}

function average(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function queriesPerMinute(window: RetrievalMetric[]): number {
    if (window.length === 0) {
        return 0;
    }

    const first = Date.parse(window[0]!.timestamp);
    const last = Date.parse(window[window.length - 1]!.timestamp);

    if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) {
        return window.length;
    }

    const elapsedMinutes = Math.max((last - first) / 60_000, 1 / 60);
    return window.length / elapsedMinutes;
}

function ratioDelta(oldValue: number, newValue: number): number {
    if (oldValue === 0 && newValue === 0) {
        return 0;
    }

    return (newValue - oldValue) / Math.max(Math.abs(oldValue), 0.0001);
}

function classifyTrend(
    deltaRatio: number,
    threshold: number,
): "up" | "down" | "stable" {
    if (deltaRatio > threshold) {
        return "up";
    }
    if (deltaRatio < -threshold) {
        return "down";
    }
    return "stable";
}

function cohortKey(query: string): string {
    const tokens = tokenize(query).slice(0, 2);
    if (tokens.length === 0) {
        return "(empty)";
    }

    return tokens.join("_");
}
