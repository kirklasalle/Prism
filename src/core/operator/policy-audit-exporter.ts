/**
 * PolicyAuditExporter
 *
 * Operator-facing API for exporting policy decision records from activity events.
 * Produces structured evidence bundles suitable for governance reviews, compliance
 * audits, and release packets.
 */

import { SqliteActivityStore } from "../activity/sqlite-store.js";
import { ActivityEvent, AuthorityTier } from "../activity/types.js";

export interface PolicyAuditFilter {
    sessionId?: string;
    decision?: "allow" | "deny" | "require_approval";
    authorityTier?: AuthorityTier;
    operation?: string;
    /** ISO timestamp lower bound (inclusive) */
    fromTimestamp?: string;
    /** ISO timestamp upper bound (inclusive) */
    toTimestamp?: string;
}

export interface PolicyDecisionRecord {
    eventId: string;
    timestamp: string;
    sessionId: string;
    operation: string;
    layer: string;
    status: string;
    authorityTier?: AuthorityTier;
    policyDecision: "allow" | "deny" | "require_approval";
    rollbackPlan?: string;
    sideEffectCount: number;
    mutatingEffects: number;
    irreversibleEffects: number;
    reasonCodes: string[];
    hash?: string;
}

export interface PolicyAuditStats {
    total: number;
    allow: number;
    deny: number;
    require_approval: number;
    byTier: Partial<Record<AuthorityTier, number>>;
    byOperation: Record<string, number>;
    denyRate: number;
    approvalGateRate: number;
}

export interface PolicyAuditBundle {
    exportedAt: string;
    filter: PolicyAuditFilter;
    stats: PolicyAuditStats;
    recordCount: number;
    records: PolicyDecisionRecord[];
}

export class PolicyAuditExporter {
    constructor(private readonly store: SqliteActivityStore) { }

    /**
     * Fetch all activity events matching the filter that carry a policyDecision field.
     * Returns raw events for further processing.
     */
    private fetchDecisionEvents(filter: PolicyAuditFilter): ActivityEvent[] {
        const raw = this.store.queryEvents({
            sessionId: filter.sessionId,
            operation: filter.operation,
        });

        return raw.filter((e) => {
            if (!e.policyDecision) return false;
            if (filter.decision && e.policyDecision !== filter.decision) return false;
            if (filter.authorityTier && e.authorityTier !== filter.authorityTier) return false;
            if (filter.fromTimestamp && e.timestamp < filter.fromTimestamp) return false;
            if (filter.toTimestamp && e.timestamp > filter.toTimestamp) return false;
            return true;
        });
    }

    /**
     * Extract machine-readable reason codes from an event's details object.
     * Checks common signal keys: reason, code, reasonCode, denial_reason, errorCode.
     */
    private extractReasonCodes(event: ActivityEvent): string[] {
        const codes: string[] = [];
        const d = event.details ?? {};

        for (const key of ["reason", "code", "reasonCode", "denial_reason", "errorCode"]) {
            const val = d[key];
            if (typeof val === "string" && val.trim()) {
                codes.push(`${key}:${val.trim()}`);
            }
        }

        if (event.status === "failed" && codes.length === 0) {
            codes.push("status:failed");
        }

        return codes;
    }

    /**
     * Convert a raw ActivityEvent into a PolicyDecisionRecord.
     * Only call with events that have a non-null policyDecision.
     */
    private toRecord(event: ActivityEvent): PolicyDecisionRecord {
        const sideEffects = event.sideEffects ?? [];
        const mutating = sideEffects.filter((s) => s.mutating === true).length;
        const irreversible = sideEffects.filter((s) => s.reversible === false).length;

        return {
            eventId: event.id,
            timestamp: event.timestamp,
            sessionId: event.sessionId,
            operation: event.operation,
            layer: event.layer,
            status: event.status,
            authorityTier: event.authorityTier,
            policyDecision: event.policyDecision!,
            rollbackPlan: event.rollbackPlan,
            sideEffectCount: sideEffects.length,
            mutatingEffects: mutating,
            irreversibleEffects: irreversible,
            reasonCodes: this.extractReasonCodes(event),
            hash: event.hash,
        };
    }

    /**
     * Build aggregate stats over a set of policy decision records.
     */
    computeStats(records: PolicyDecisionRecord[]): PolicyAuditStats {
        const byTier: Partial<Record<AuthorityTier, number>> = {};
        const byOperation: Record<string, number> = {};
        let allow = 0;
        let deny = 0;
        let require_approval = 0;

        for (const r of records) {
            if (r.policyDecision === "allow") allow++;
            else if (r.policyDecision === "deny") deny++;
            else if (r.policyDecision === "require_approval") require_approval++;

            if (r.authorityTier) {
                byTier[r.authorityTier] = (byTier[r.authorityTier] ?? 0) + 1;
            }
            byOperation[r.operation] = (byOperation[r.operation] ?? 0) + 1;
        }

        const total = records.length;
        return {
            total,
            allow,
            deny,
            require_approval,
            byTier,
            byOperation,
            denyRate: total > 0 ? deny / total : 0,
            approvalGateRate: total > 0 ? require_approval / total : 0,
        };
    }

    /**
     * Export all policy decisions matching the filter as a structured evidence bundle.
     * Records are sorted oldest → newest.
     */
    exportBundle(filter: PolicyAuditFilter): PolicyAuditBundle {
        const events = this.fetchDecisionEvents(filter);
        const sorted = events.sort((a, b) =>
            a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
        );
        const records = sorted.map((e) => this.toRecord(e));
        const stats = this.computeStats(records);

        return {
            exportedAt: new Date().toISOString(),
            filter,
            stats,
            recordCount: records.length,
            records,
        };
    }
}
