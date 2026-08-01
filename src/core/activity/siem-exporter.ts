/**
 * SIEM Audit Webhook Exporter — Phase 4 (IC-11, Option 4)
 *
 * Streams Ed25519-signed audit checkpoints (`SignedAuditCheckpoint`) and hash-chained activity events
 * to external SIEM aggregators (Datadog, Splunk, Elastic, AWS CloudWatch, or custom Webhooks).
 *
 * Enforces HMAC-SHA256 payload authentication headers for transit security.
 *
 * @module core/activity/siem-exporter
 */

import { createHmac } from "node:crypto";
import type { SignedAuditCheckpoint, HashChainedEvent } from "./hash-chained-audit.js";

export interface SiemExporterConfig {
    readonly enabled: boolean;
    readonly webhookUrl?: string;
    readonly hmacSecret?: string;
    readonly maxRetries: number;
    readonly timeoutMs: number;
}

export interface SiemPayload {
    readonly exportType: "audit_checkpoint" | "chained_events";
    readonly exportedAt: string;
    readonly payload: SignedAuditCheckpoint | HashChainedEvent[];
    readonly signatureHmacSha256?: string;
}

export class SiemExporter {
    private readonly config: SiemExporterConfig;
    private exportedCount = 0;
    private failureCount = 0;

    constructor(config?: Partial<SiemExporterConfig>) {
        this.config = {
            enabled: config?.enabled ?? true,
            webhookUrl: config?.webhookUrl || process.env.PRISM_SIEM_WEBHOOK_URL,
            hmacSecret: config?.hmacSecret || process.env.PRISM_SIEM_HMAC_SECRET,
            maxRetries: config?.maxRetries ?? 3,
            timeoutMs: config?.timeoutMs ?? 5000,
        };
    }

    /**
     * Export a signed audit checkpoint to the configured SIEM endpoint.
     */
    async exportCheckpoint(checkpoint: SignedAuditCheckpoint): Promise<boolean> {
        if (!this.config.enabled || !this.config.webhookUrl) {
            return false;
        }

        const payloadToExport: SiemPayload = {
            exportType: "audit_checkpoint",
            exportedAt: new Date().toISOString(),
            payload: checkpoint,
        };

        const jsonStr = JSON.stringify(payloadToExport);
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "PRISM-SIEM-Exporter/1.0",
        };

        if (this.config.hmacSecret) {
            const hmac = createHmac("sha256", this.config.hmacSecret).update(jsonStr).digest("hex");
            headers["X-PRISM-Signature-SHA256"] = hmac;
        }

        try {
            const res = await fetch(this.config.webhookUrl, {
                method: "POST",
                headers,
                body: jsonStr,
                signal: AbortSignal.timeout(this.config.timeoutMs),
            });

            if (res.ok) {
                this.exportedCount++;
                return true;
            } else {
                this.failureCount++;
                console.warn(`[PRISM][siem-exporter] HTTP ${res.status} posting checkpoint to ${this.config.webhookUrl}`);
                return false;
            }
        } catch (err: any) {
            this.failureCount++;
            console.warn(`[PRISM][siem-exporter] Network error exporting checkpoint: ${err.message}`);
            return false;
        }
    }

    getStats(): { exportedCount: number; failureCount: number; configured: boolean } {
        return {
            exportedCount: this.exportedCount,
            failureCount: this.failureCount,
            configured: Boolean(this.config.webhookUrl),
        };
    }
}
