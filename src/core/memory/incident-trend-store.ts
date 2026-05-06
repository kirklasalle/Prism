/**
 * IncidentTrendStore — rolling-window aggregator of operationally-significant
 * activity events that retrieval alert tuning can consult to adjust default
 * thresholds.
 *
 * Subscribes to ActivityBus and keeps per-profile counters for:
 *  - policy.deny           (any "deny" policy decision)
 *  - approval.timeout      (approval queue timeouts)
 *  - retrieval.alert.*     (downstream alerts from RetrievalDashboardStore)
 *  - incident.*            (incident bundle captures)
 *
 * Counts are bucketed into 24h-day partitions so callers can compute 7-day
 * and 30-day trends. The store is intentionally non-durable — it is
 * recomputable from the SqliteActivityStore on restart.
 */

import type { ActivityBus } from "../activity/bus.js";
import type { ActivityEvent } from "../activity/types.js";

export type IncidentProfile = "individual" | "business" | "unknown";

export interface IncidentBucket {
    /** Day key yyyy-mm-dd in UTC */
    day: string;
    profile: IncidentProfile;
    policyDenies: number;
    approvalTimeouts: number;
    retrievalAlerts: number;
    incidents: number;
}

export interface IncidentTrendReport {
    profile: IncidentProfile;
    windowDays: number;
    totalPolicyDenies: number;
    totalApprovalTimeouts: number;
    totalRetrievalAlerts: number;
    totalIncidents: number;
    eventCount: number;
    /** Daily-average rate per metric over the window. */
    dailyAverage: {
        policyDenies: number;
        approvalTimeouts: number;
        retrievalAlerts: number;
        incidents: number;
    };
}

const MAX_DAYS = 60;

function dayKey(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
}

function profileFromEvent(event: ActivityEvent): IncidentProfile {
    const seg = (event as { executionProfileSegment?: unknown }).executionProfileSegment;
    if (seg === "business" || seg === "individual") return seg;
    return "unknown";
}

export class IncidentTrendStore {
    /** keyed by `${day}::${profile}` */
    private buckets = new Map<string, IncidentBucket>();
    private unsubscribe: (() => void) | null = null;

    constructor(private readonly activityBus?: ActivityBus) {
        if (activityBus) {
            this.unsubscribe = activityBus.subscribe({
                onEvent: (event: ActivityEvent) => this.ingest(event),
            });
        }
    }

    /**
     * Tear down the bus subscription. Safe to call multiple times.
     */
    close(): void {
        if (this.unsubscribe) {
            try { this.unsubscribe(); } catch { /* ignore */ }
            this.unsubscribe = null;
        }
    }

    /** Test/replay hook — feed an event manually. */
    ingest(event: ActivityEvent): void {
        const op = (event.operation ?? "").toLowerCase();
        const decision = (event as { policyDecision?: unknown }).policyDecision;
        const isPolicyDeny = decision === "deny" || op.endsWith("policy.deny") || op.includes(".deny");
        const isApprovalTimeout = op.includes("approval") && op.includes("timeout");
        const isRetrievalAlert = op.startsWith("retrieval.alert");
        const isIncident = op.startsWith("incident.");

        if (!isPolicyDeny && !isApprovalTimeout && !isRetrievalAlert && !isIncident) return;

        const day = dayKey(event.timestamp ?? new Date().toISOString());
        const profile = profileFromEvent(event);
        const key = `${day}::${profile}`;
        let bucket = this.buckets.get(key);
        if (!bucket) {
            bucket = {
                day, profile,
                policyDenies: 0, approvalTimeouts: 0, retrievalAlerts: 0, incidents: 0,
            };
            this.buckets.set(key, bucket);
        }
        if (isPolicyDeny) bucket.policyDenies += 1;
        if (isApprovalTimeout) bucket.approvalTimeouts += 1;
        if (isRetrievalAlert) bucket.retrievalAlerts += 1;
        if (isIncident) bucket.incidents += 1;

        // Trim very old buckets
        if (this.buckets.size > MAX_DAYS * 4) {
            const cutoff = new Date(Date.now() - MAX_DAYS * 86_400_000).toISOString().slice(0, 10);
            for (const [k, b] of this.buckets) {
                if (b.day < cutoff) this.buckets.delete(k);
            }
        }
    }

    getReport(profile: IncidentProfile, windowDays: number): IncidentTrendReport {
        const winDays = Math.max(1, Math.min(MAX_DAYS, windowDays));
        const cutoff = new Date(Date.now() - winDays * 86_400_000).toISOString().slice(0, 10);
        const matching: IncidentBucket[] = [];
        for (const bucket of this.buckets.values()) {
            if (bucket.profile !== profile) continue;
            if (bucket.day < cutoff) continue;
            matching.push(bucket);
        }
        const totals = matching.reduce(
            (acc, b) => {
                acc.policyDenies += b.policyDenies;
                acc.approvalTimeouts += b.approvalTimeouts;
                acc.retrievalAlerts += b.retrievalAlerts;
                acc.incidents += b.incidents;
                return acc;
            },
            { policyDenies: 0, approvalTimeouts: 0, retrievalAlerts: 0, incidents: 0 },
        );
        return {
            profile,
            windowDays: winDays,
            totalPolicyDenies: totals.policyDenies,
            totalApprovalTimeouts: totals.approvalTimeouts,
            totalRetrievalAlerts: totals.retrievalAlerts,
            totalIncidents: totals.incidents,
            eventCount: matching.length,
            dailyAverage: {
                policyDenies: totals.policyDenies / winDays,
                approvalTimeouts: totals.approvalTimeouts / winDays,
                retrievalAlerts: totals.retrievalAlerts / winDays,
                incidents: totals.incidents / winDays,
            },
        };
    }

    listBuckets(): IncidentBucket[] {
        return Array.from(this.buckets.values()).sort((a, b) => {
            if (a.day !== b.day) return a.day.localeCompare(b.day);
            return a.profile.localeCompare(b.profile);
        });
    }
}
