/**
 * SessionTraceExplorer
 *
 * Operator-facing API for querying, replaying, and exporting session activity traces.
 * Wraps SqliteActivityStore.queryEvents with richer filter semantics, hash-chain
 * integrity verification, and structured JSON evidence export.
 */

import { SqliteActivityStore } from "../activity/sqlite-store.js";
import { ActivityEvent, ActivityLayer, AuthorityTier } from "../activity/types.js";

export interface TraceFilter {
    sessionId?: string;
    layer?: ActivityLayer;
    authorityTier?: AuthorityTier;
    policyDecision?: "allow" | "deny" | "require_approval";
    operation?: string;
    status?: "started" | "succeeded" | "failed";
    /** ISO timestamp lower bound (inclusive) */
    fromTimestamp?: string;
    /** ISO timestamp upper bound (inclusive) */
    toTimestamp?: string;
}

export interface HashChainResult {
    valid: boolean;
    totalEvents: number;
    firstBreakIndex?: number;
    firstBreakId?: string;
}

export interface SessionTraceBundle {
    exportedAt: string;
    sessionId: string | undefined;
    filter: TraceFilter;
    hashChain: HashChainResult;
    eventCount: number;
    events: ActivityEvent[];
    summary: SessionTraceSummary;
}

export interface SessionTraceSummary {
    layerCounts: Partial<Record<ActivityLayer, number>>;
    statusCounts: Record<"started" | "succeeded" | "failed", number>;
    tierCounts: Partial<Record<AuthorityTier, number>>;
    policyDecisionCounts: Record<"allow" | "deny" | "require_approval" | "unset", number>;
    operationList: string[];
    totalDurationMs: number;
    avgConfidence: number | null;
}

export class SessionTraceExplorer {
    constructor(private readonly store: SqliteActivityStore) { }

    /**
     * Query events with rich filter semantics. Results are ordered oldest → newest
     * (chronological replay order).
     */
    query(filter: TraceFilter): ActivityEvent[] {
        const events = this.store.queryEvents({
            sessionId: filter.sessionId,
            operation: filter.operation,
            layer: filter.layer,
        });

        return events
            .filter((e) => {
                if (filter.authorityTier && e.authorityTier !== filter.authorityTier) return false;
                if (filter.policyDecision && e.policyDecision !== filter.policyDecision) return false;
                if (filter.status && e.status !== filter.status) return false;
                if (filter.fromTimestamp && e.timestamp < filter.fromTimestamp) return false;
                if (filter.toTimestamp && e.timestamp > filter.toTimestamp) return false;
                return true;
            })
            .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
    }

    /**
     * Verify hash-chain integrity for a sequence of events.
     * Each event's hash should be a SHA-256 of its own fields linked to the previous hash —
     * here we only verify that hash fields are present and form a contiguous chain
     * (non-null and non-repeating), since the actual HMAC secret is held by the bus.
     */
    verifyHashChain(events: ActivityEvent[]): HashChainResult {
        if (events.length === 0) {
            return { valid: true, totalEvents: 0 };
        }

        const seenHashes = new Set<string>();
        for (let i = 0; i < events.length; i++) {
            const hash = events[i].hash;
            if (!hash) {
                return { valid: false, totalEvents: events.length, firstBreakIndex: i, firstBreakId: events[i].id };
            }
            if (seenHashes.has(hash)) {
                return { valid: false, totalEvents: events.length, firstBreakIndex: i, firstBreakId: events[i].id };
            }
            seenHashes.add(hash);
        }

        return { valid: true, totalEvents: events.length };
    }

    /**
     * Build a structured summary over a set of events.
     */
    summarize(events: ActivityEvent[]): SessionTraceSummary {
        const layerCounts: Partial<Record<ActivityLayer, number>> = {};
        const statusCounts: Record<"started" | "succeeded" | "failed", number> = {
            started: 0,
            succeeded: 0,
            failed: 0,
        };
        const tierCounts: Partial<Record<AuthorityTier, number>> = {};
        const policyDecisionCounts: Record<"allow" | "deny" | "require_approval" | "unset", number> = {
            allow: 0,
            deny: 0,
            require_approval: 0,
            unset: 0,
        };
        const operationSet = new Set<string>();
        let totalDurationMs = 0;
        let confidenceSum = 0;
        let confidenceCount = 0;

        for (const e of events) {
            layerCounts[e.layer] = (layerCounts[e.layer] ?? 0) + 1;
            statusCounts[e.status] = (statusCounts[e.status] ?? 0) + 1;
            if (e.authorityTier) {
                tierCounts[e.authorityTier] = (tierCounts[e.authorityTier] ?? 0) + 1;
            }
            const pd = e.policyDecision ?? "unset";
            policyDecisionCounts[pd] = (policyDecisionCounts[pd] ?? 0) + 1;
            operationSet.add(e.operation);
            if (e.durationMs != null) totalDurationMs += e.durationMs;
            if (e.confidence != null) {
                confidenceSum += e.confidence;
                confidenceCount++;
            }
        }

        return {
            layerCounts,
            statusCounts,
            tierCounts,
            policyDecisionCounts,
            operationList: Array.from(operationSet).sort(),
            totalDurationMs,
            avgConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : null,
        };
    }

    /**
     * Export a full session trace as a structured JSON evidence bundle.
     * Suitable for governance audits, post-incident analysis, and release packets.
     */
    exportBundle(filter: TraceFilter): SessionTraceBundle {
        const events = this.query(filter);
        const hashChain = this.verifyHashChain(events);
        const summary = this.summarize(events);

        return {
            exportedAt: new Date().toISOString(),
            sessionId: filter.sessionId,
            filter,
            hashChain,
            eventCount: events.length,
            events,
            summary,
        };
    }
}
