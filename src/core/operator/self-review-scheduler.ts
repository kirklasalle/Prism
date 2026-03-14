import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActivityBus } from "../activity/bus.js";
import type { ActivityEvent } from "../activity/types.js";

export type SelfReviewCadence = "daily" | "weekly" | "monthly";

export interface SelfReviewIntervalsMs {
    daily: number;
    weekly: number;
    monthly: number;
}

export interface SelfReviewReport {
    generatedAt: string;
    cadence: SelfReviewCadence;
    sessionId: string;
    environmentProfile: string;
    windowMs: number;
    metrics: {
        eventsTotal: number;
        failures: number;
        approvals: number;
        retrievalEvents: number;
        governanceEvents: number;
        performanceEvents: number;
        chatMessages: number;
        lastEventOperation: string | null;
    };
    recommendations: string[];
}

export interface SelfReviewSchedulerOptions {
    activityBus: ActivityBus;
    sessionId: string;
    environmentProfile: string;
    outputDir?: string;
    intervalsMs?: Partial<SelfReviewIntervalsMs>;
    minimumIntervalMs?: number;
}

export interface SelfReviewSchedulerConfiguration {
    intervalsMs: SelfReviewIntervalsMs;
    minimumIntervalMs: number;
    warnings: string[];
}

const defaultIntervalsMs: SelfReviewIntervalsMs = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
};

const maxTimerIntervalMs = 2_147_000_000;

export class SelfReviewScheduler {
    private readonly outputDir: string;
    private readonly intervalsMs: SelfReviewIntervalsMs;
    private readonly minimumIntervalMs: number;
    private readonly warnings: string[] = [];
    private readonly timers = new Map<SelfReviewCadence, NodeJS.Timeout>();

    constructor(private readonly options: SelfReviewSchedulerOptions) {
        this.outputDir = options.outputDir ?? "prism-output";
        this.minimumIntervalMs = Math.max(1, Math.floor(options.minimumIntervalMs ?? 60_000));
        this.intervalsMs = {
            daily: this.sanitizeInterval(options.intervalsMs?.daily, defaultIntervalsMs.daily, "daily"),
            weekly: this.sanitizeInterval(options.intervalsMs?.weekly, defaultIntervalsMs.weekly, "weekly"),
            monthly: this.sanitizeInterval(options.intervalsMs?.monthly, defaultIntervalsMs.monthly, "monthly"),
        };
    }

    start(): void {
        this.stop();
        this.schedule("daily");
        this.schedule("weekly");
        this.schedule("monthly");
    }

    stop(): void {
        for (const timer of this.timers.values()) {
            clearInterval(timer);
        }
        this.timers.clear();
    }

    runInitialPass(): SelfReviewReport[] {
        return [
            this.runReview("daily"),
            this.runReview("weekly"),
            this.runReview("monthly"),
        ];
    }

    runReview(cadence: SelfReviewCadence): SelfReviewReport {
        const now = Date.now();
        const windowMs = this.intervalsMs[cadence];
        const allEvents = this.options.activityBus.listEvents();
        const recentEvents = allEvents.filter((event) => {
            const ts = Date.parse(event.timestamp);
            return Number.isFinite(ts) && now - ts <= windowMs;
        });

        const report: SelfReviewReport = {
            generatedAt: new Date(now).toISOString(),
            cadence,
            sessionId: this.options.sessionId,
            environmentProfile: this.options.environmentProfile,
            windowMs,
            metrics: {
                eventsTotal: recentEvents.length,
                failures: countByStatus(recentEvents, "failed"),
                approvals: recentEvents.filter((event) => event.operation.includes("approval")).length,
                retrievalEvents: recentEvents.filter((event) => event.layer === "retrieval").length,
                governanceEvents: recentEvents.filter((event) => event.layer === "governance").length,
                performanceEvents: recentEvents.filter((event) => event.layer === "performance").length,
                chatMessages: recentEvents.filter((event) => event.operation.startsWith("chat.")).length,
                lastEventOperation: recentEvents[recentEvents.length - 1]?.operation ?? null,
            },
            recommendations: buildRecommendations(recentEvents),
        };

        this.persistReport(report);
        this.options.activityBus.emit({
            sessionId: this.options.sessionId,
            layer: "performance",
            operation: `prism.self_review.${cadence}`,
            status: "succeeded",
            details: {
                generatedAt: report.generatedAt,
                eventsTotal: report.metrics.eventsTotal,
                failures: report.metrics.failures,
                recommendations: report.recommendations,
            },
        });

        return report;
    }

    getConfiguration(): SelfReviewSchedulerConfiguration {
        return {
            intervalsMs: { ...this.intervalsMs },
            minimumIntervalMs: this.minimumIntervalMs,
            warnings: [...this.warnings],
        };
    }

    private schedule(cadence: SelfReviewCadence): void {
        const timer = setInterval(() => {
            try {
                this.runReview(cadence);
            } catch (error) {
                this.options.activityBus.emit({
                    sessionId: this.options.sessionId,
                    layer: "performance",
                    operation: `prism.self_review.${cadence}`,
                    status: "failed",
                    details: {
                        reason: String(error),
                    },
                });
            }
        }, this.intervalsMs[cadence]);

        this.timers.set(cadence, timer);
    }

    private persistReport(report: SelfReviewReport): void {
        mkdirSync(this.outputDir, { recursive: true });

        const latestPath = join(this.outputDir, "self-review-latest.json");
        const cadencePath = join(this.outputDir, `self-review-${report.cadence}.json`);
        const historyPath = join(this.outputDir, "self-review-history.ndjson");

        const serialized = JSON.stringify(report, null, 2);
        writeFileSync(latestPath, serialized + "\n", "utf-8");
        writeFileSync(cadencePath, serialized + "\n", "utf-8");
        appendFileSync(historyPath, JSON.stringify(report) + "\n", "utf-8");
    }

    private sanitizeInterval(value: number | undefined, fallback: number, cadence?: SelfReviewCadence): number {
        const label = cadence ?? "unknown";

        if (!Number.isFinite(value) || (value ?? 0) <= 0) {
            const boundedFallback = Math.min(maxTimerIntervalMs, fallback);
            if (boundedFallback !== fallback) {
                this.warnings.push(
                    `${label} self-review interval fallback ${fallback}ms exceeds Node timer max; clamped to ${boundedFallback}ms.`,
                );
            }
            return boundedFallback;
        }

        const safeValue = Math.floor(value as number);
        const bounded = Math.max(this.minimumIntervalMs, safeValue);
        if (bounded !== safeValue) {
            this.warnings.push(
                `${label} self-review interval ${safeValue}ms is below minimum ${this.minimumIntervalMs}ms; raised to ${bounded}ms.`,
            );
        }

        const clamped = Math.min(maxTimerIntervalMs, bounded);
        if (clamped !== bounded) {
            this.warnings.push(
                `${label} self-review interval ${bounded}ms exceeds Node timer max; clamped to ${clamped}ms.`,
            );
        }

        return clamped;
    }
}

function countByStatus(events: readonly ActivityEvent[], status: ActivityEvent["status"]): number {
    return events.filter((event) => event.status === status).length;
}

function buildRecommendations(events: readonly ActivityEvent[]): string[] {
    if (events.length === 0) {
        return [
            "No events in review window. Verify scheduled workflows and operator activity are healthy.",
        ];
    }

    const failures = events.filter((event) => event.status === "failed").length;
    const approvalTimeouts = events.filter((event) => event.operation.includes("approval") && event.status === "failed").length;
    const retrievalEvents = events.filter((event) => event.layer === "retrieval").length;

    const recommendations: string[] = [];
    if (failures > 0) {
        recommendations.push(`Investigate ${failures} failed events from the current review window.`);
    }
    if (approvalTimeouts > 0) {
        recommendations.push(`Review approval workflow latency; observed ${approvalTimeouts} approval-related failures.`);
    }
    if (retrievalEvents === 0) {
        recommendations.push("No retrieval-layer activity observed; run retrieval diagnostics to validate memory quality.");
    }
    if (recommendations.length === 0) {
        recommendations.push("System health is stable. Continue scheduled monitoring and weekly hardening review.");
    }

    return recommendations;
}
