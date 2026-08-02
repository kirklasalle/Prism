import { createHash } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";
import type { ActivityEvent } from "../activity/types.js";
import type { ChatSessionStore, SupportTicket } from "./chat-session-store.js";

export interface SupportLogAuditResult {
    scanned: number;
    incidentsCreated: number;
    duplicatesSkipped: number;
}

export class SupportLogAuditor {
    private lastAuditedEventCount = 0;

    constructor(
        private readonly activityBus: ActivityBus,
        private readonly chatStore: ChatSessionStore,
        private readonly sessionId: string,
    ) { }

    audit(trigger: "initialization" | "scheduled" | "manual" = "scheduled"): SupportLogAuditResult {
        const events = this.activityBus.listEvents();
        const candidates = events.slice(this.lastAuditedEventCount).filter((event) => this.classify(event) !== null);
        this.lastAuditedEventCount = events.length;

        const openFingerprints = new Set(
            this.chatStore
                .listSupportTickets()
                .filter((ticket) => ticket.status !== "resolved")
                .map((ticket) => ticket.metadata.fingerprint)
                .filter((fingerprint): fingerprint is string => typeof fingerprint === "string"),
        );
        let incidentsCreated = 0;
        let duplicatesSkipped = 0;

        for (const event of candidates) {
            const classification = this.classify(event)!;
            const fingerprint = this.fingerprint(event);
            if (openFingerprints.has(fingerprint)) {
                duplicatesSkipped += 1;
                continue;
            }

            this.chatStore.createSupportTicket({
                title: `[${classification.label}] ${event.operation}`,
                description: this.describe(event),
                source: "scheduler-log-audit",
                severity: classification.severity,
                metadata: {
                    itemType: "incident",
                    origin: "automated-log-audit",
                    trigger,
                    fingerprint,
                    activityEventId: event.id,
                    activitySessionId: event.sessionId,
                    operation: event.operation,
                    logSource: event.details.source ?? event.layer,
                    eventTimestamp: event.timestamp,
                    correlationId:
                        event.details.correlationId ?? event.details.traceId ?? event.details.requestId ?? null,
                    remediation: event.details.remediation ?? event.details.suggestedAction ?? null,
                },
            });
            openFingerprints.add(fingerprint);
            incidentsCreated += 1;
        }

        const result = { scanned: candidates.length, incidentsCreated, duplicatesSkipped };
        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "performance",
            operation: "support.log_audit.completed",
            status: "succeeded",
            details: { trigger, ...result },
        });
        return result;
    }

    private classify(event: ActivityEvent): { label: "Warning" | "Error"; severity: SupportTicket["severity"] } | null {
        if (event.operation === "support.log_audit.completed") return null;
        const reportedSeverity = String(event.details.severity ?? event.details.level ?? "").toLowerCase();
        if (event.status === "failed" || reportedSeverity === "error" || reportedSeverity === "critical") {
            return { label: "Error", severity: reportedSeverity === "critical" ? "critical" : "high" };
        }
        if (
            reportedSeverity === "warn" ||
            reportedSeverity === "warning" ||
            /(^|[._-])warn(?:ing)?($|[._-])/i.test(event.operation)
        ) {
            return { label: "Warning", severity: "medium" };
        }
        return null;
    }

    private fingerprint(event: ActivityEvent): string {
        const reason = event.details.reason ?? event.details.error ?? event.details.message ?? event.details.summary ?? "";
        return createHash("sha256")
            .update(`${event.layer}\n${event.operation}\n${String(reason).trim().toLowerCase()}`)
            .digest("hex");
    }

    private describe(event: ActivityEvent): string {
        const detail = event.details.reason ?? event.details.error ?? event.details.message ?? event.details.summary;
        return detail
            ? `${event.operation} reported at ${event.timestamp}: ${String(detail)}`
            : `${event.operation} reported ${event.status} status at ${event.timestamp}.`;
    }
}