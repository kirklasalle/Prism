/**
 * Soc2EvidenceExporter — ActivityBus → SOC 2 evidence pipeline
 *
 * Subscribes to the same `ActivityBus` that drives `OtelExporter` and
 * filters down to the subset of events that map to SOC 2 Trust Services
 * Criteria. Each filtered event is shaped into a stable
 * `Soc2EvidenceRecord` and forwarded to one of two transports:
 *
 *   - FileTransport: appends one JSONL record per event under
 *     `prism-output/soc2/YYYY-MM-DD.jsonl` (rotated daily). Each record
 *     carries the source event's sha256 hash for tamper-evidence.
 *
 *   - WebhookTransport: batches records (default every 60s, flush at
 *     32 records) and POSTs to a configurable HTTPS endpoint with an
 *     optional bearer token. On failure, the unflushed batch is written
 *     to a JSONL DLQ (`prism-output/soc2/_dlq.jsonl`) so no evidence is
 *     lost.
 *
 * Wiring is opt-in via `PRISM_SOC2_EXPORTER`:
 *   off     — the default; the exporter never registers (zero overhead).
 *   file    — FileTransport only.
 *   webhook — WebhookTransport (also writes to file as the DLQ).
 *
 * Trust Services Criteria covered:
 *   CC6.1 logical access (auth.* / iam.* / rbac.deny)
 *   CC6.6 boundary protection (governance + policy decisions)
 *   CC7.2 anomaly detection (failures, denies, require_approval)
 *   CC8.1 change management (mutating side-effects)
 *
 * Phase Cloud-2 / W5 — see CHANGELOG entry "Phase SOC2-1".
 *
 * Zero new runtime dependencies — uses node:fs / node:https / node:http /
 * node:path only.
 */

import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import type { ActivityBus } from "../activity/bus.js";
import type { ActivityEvent, ActivitySubscriber } from "../activity/types.js";

// ── Public types ─────────────────────────────────────────────────────────────

export type Soc2Control =
    | "CC6.1"   // logical access
    | "CC6.6"   // boundary protection
    | "CC7.2"   // anomaly detection
    | "CC8.1";  // change management

export interface Soc2EvidenceRecord {
    /** Stable record identifier — mirrors the source ActivityEvent.id. */
    id: string;
    /** ISO-8601 timestamp inherited from the source event. */
    timestamp: string;
    /** Source event sha256 hash (chain-of-custody). */
    sourceHash?: string;
    /** Trust Services Criteria controls this record contributes to. */
    controls: Soc2Control[];
    /** PRISM activity layer (governance, llm, agent, …). */
    layer: string;
    /** Operation name (e.g. "auth.login.success", "policy.deny", "tool.invoke"). */
    operation: string;
    /** Outcome — succeeded / failed / started. */
    status: "started" | "succeeded" | "failed";
    /** Policy decision when present. */
    policyDecision?: "allow" | "deny" | "require_approval";
    /** Authority tier when present. */
    authorityTier?: string;
    /** Principal/user identification (best-effort, drawn from the ActivityEvent). */
    principal: {
        userId?: string;
        userEmail?: string;
        operatorId?: string;
        operatorEmail?: string;
        clientId?: string;
        sessionId: string;
    };
    /** Side-effect summary for CC8.1 (only mutating side-effects survive). */
    sideEffects?: Array<{
        type: string;
        description: string;
        action?: string;
        resource?: string;
        reversible?: boolean;
    }>;
    /** Free-form details mirrored from the source event (stringified JSON). */
    details: Record<string, unknown>;
    /** Schema version of the record envelope itself. */
    schemaVersion: 1;
}

export type WebhookFlavor = "generic" | "vanta" | "drata";

export interface Soc2ExporterConfig {
    /** Off / file / webhook. Default: off. */
    mode?: "off" | "file" | "webhook";
    /** Output directory for FileTransport + DLQ. Default: prism-output/soc2 */
    outputDir?: string;
    /** Webhook URL (https/http). Required when mode === "webhook". */
    webhookUrl?: string;
    /** Bearer token sent as `Authorization: Bearer <token>`. */
    webhookToken?: string;
    /** Vendor flavor controlling payload shape. Default: generic. */
    webhookFlavor?: WebhookFlavor;
    /** Batch size threshold that triggers an immediate flush. Default: 32. */
    batchSize?: number;
    /** Flush interval in ms when below batchSize. Default: 60_000. */
    flushIntervalMs?: number;
    /**
     * Test-only seam: clock for deterministic file rotation.
     * Default: () => new Date().
     */
    now?: () => Date;
    /**
     * Test-only seam: HTTP transport. When provided, replaces node:https/http.
     * Receives the assembled URL + body; resolves on success, rejects on failure.
     */
    httpPoster?: (url: string, body: string, headers: Record<string, string>) => Promise<void>;
}

// ── Filtering ────────────────────────────────────────────────────────────────

/**
 * Event predicate. Returns the list of Trust Services Criteria controls the
 * event maps to, or `null` if the event should be dropped.
 *
 * Exported separately so tests can pin the behaviour and so a future
 * dashboard surface (e.g. "show me CC6.1 evidence") can reuse it.
 */
export function classifyEventForSoc2(event: ActivityEvent): Soc2Control[] | null {
    const controls = new Set<Soc2Control>();

    const op = event.operation || "";
    const layer = event.layer;

    // CC6.1 — logical access
    if (op.startsWith("auth.") || op.startsWith("iam.") || op.startsWith("rbac.") || op.startsWith("sso.")) {
        controls.add("CC6.1");
    }

    // CC6.6 — boundary protection (governance layer + explicit policy decisions)
    if (layer === "governance" || event.policyDecision != null) {
        controls.add("CC6.6");
    }

    // CC7.2 — anomaly detection
    if (event.status === "failed" || event.policyDecision === "deny" || event.policyDecision === "require_approval") {
        controls.add("CC7.2");
    }

    // CC8.1 — change management (mutating side effects)
    if (event.sideEffects?.some((se) => se.mutating === true)) {
        controls.add("CC8.1");
    }

    return controls.size > 0 ? Array.from(controls) : null;
}

/** Pure mapper: ActivityEvent → Soc2EvidenceRecord. Exported for tests. */
export function mapEventToSoc2(event: ActivityEvent, controls: Soc2Control[]): Soc2EvidenceRecord {
    return {
        id: event.id,
        timestamp: event.timestamp,
        sourceHash: event.hash,
        controls,
        layer: event.layer,
        operation: event.operation,
        status: event.status,
        policyDecision: event.policyDecision,
        authorityTier: event.authorityTier,
        principal: {
            userId: event.prismUserId,
            userEmail: event.prismUserEmail,
            operatorId: event.operatorId,
            operatorEmail: event.operatorEmail,
            clientId: event.clientId,
            sessionId: event.sessionId,
        },
        sideEffects: event.sideEffects
            ?.filter((se) => se.mutating === true)
            .map((se) => ({
                type: se.type,
                description: se.description,
                action: se.action,
                resource: se.resource,
                reversible: se.reversible,
            })),
        details: event.details ?? {},
        schemaVersion: 1,
    };
}

// ── Transports ───────────────────────────────────────────────────────────────

interface Transport {
    write(record: Soc2EvidenceRecord): void;
    /** Flush any pending batches. Returns when the in-flight write completes. */
    flush(): Promise<void>;
    /** Stop timers / release resources. Does NOT flush. */
    close(): void;
}

class FileTransport implements Transport {
    constructor(
        private readonly outputDir: string,
        private readonly now: () => Date,
    ) {
        ensureDir(this.outputDir);
    }

    write(record: Soc2EvidenceRecord): void {
        const day = isoDay(this.now());
        const path = join(this.outputDir, `${day}.jsonl`);
        appendFileSync(path, JSON.stringify(record) + "\n", { encoding: "utf8" });
    }

    async flush(): Promise<void> {
        // Synchronous append; nothing to flush.
    }

    close(): void {
        // No state.
    }
}

class WebhookTransport implements Transport {
    private readonly buffer: Soc2EvidenceRecord[] = [];
    private timer: NodeJS.Timeout | null = null;
    private readonly dlqPath: string;
    private flushChain: Promise<void> = Promise.resolve();

    constructor(
        private readonly url: string,
        private readonly token: string | undefined,
        private readonly flavor: WebhookFlavor,
        private readonly batchSize: number,
        private readonly flushIntervalMs: number,
        outputDir: string,
        private readonly httpPoster: (url: string, body: string, headers: Record<string, string>) => Promise<void>,
    ) {
        ensureDir(outputDir);
        this.dlqPath = join(outputDir, "_dlq.jsonl");
    }

    write(record: Soc2EvidenceRecord): void {
        this.buffer.push(record);
        if (this.buffer.length >= this.batchSize) {
            this.scheduleFlush(true);
            return;
        }
        if (this.timer == null) {
            this.timer = setTimeout(() => this.scheduleFlush(false), this.flushIntervalMs);
            // Allow process to exit even if the timer hasn't fired.
            this.timer.unref?.();
        }
    }

    async flush(): Promise<void> {
        this.scheduleFlush(true);
        await this.flushChain;
    }

    close(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private scheduleFlush(immediate: boolean): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.buffer.length === 0) return;
        const batch = this.buffer.splice(0, this.buffer.length);
        const body = this.shapeBody(batch);
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (this.token) headers["authorization"] = `Bearer ${this.token}`;

        const op = (async () => {
            try {
                await this.httpPoster(this.url, body, headers);
            } catch {
                this.writeDlq(batch);
            }
        })();
        this.flushChain = this.flushChain.then(() => op);
        // Mark immediate-vs-not for callers; behaviour identical.
        void immediate;
    }

    private shapeBody(batch: Soc2EvidenceRecord[]): string {
        switch (this.flavor) {
            case "vanta":
                return JSON.stringify({ source: "prism", evidence: batch });
            case "drata":
                return JSON.stringify({ vendor: "prism", records: batch });
            case "generic":
            default:
                return JSON.stringify({ records: batch });
        }
    }

    private writeDlq(batch: Soc2EvidenceRecord[]): void {
        try {
            for (const r of batch) {
                appendFileSync(this.dlqPath, JSON.stringify(r) + "\n", { encoding: "utf8" });
            }
        } catch {
            // Last-ditch: swallow. We never want evidence pipeline failures
            // to crash the host PRISM process.
        }
    }
}

// ── Exporter ─────────────────────────────────────────────────────────────────

export class Soc2EvidenceExporter implements ActivitySubscriber {
    private readonly config: Required<Omit<Soc2ExporterConfig, "webhookUrl" | "webhookToken" | "httpPoster">> &
        Pick<Soc2ExporterConfig, "webhookUrl" | "webhookToken" | "httpPoster">;
    private transport: Transport | null = null;
    private unsubscribe: (() => void) | null = null;
    private lastEventAt: string | null = null;
    private totalEvents = 0;
    private droppedEvents = 0;

    constructor(
        private readonly activityBus: ActivityBus,
        config: Soc2ExporterConfig = {},
    ) {
        this.config = {
            mode: config.mode ?? (process.env.PRISM_SOC2_EXPORTER as Soc2ExporterConfig["mode"]) ?? "off",
            outputDir: config.outputDir ?? resolve(process.cwd(), "prism-output", "soc2"),
            webhookUrl: config.webhookUrl ?? process.env.PRISM_SOC2_WEBHOOK_URL,
            webhookToken: config.webhookToken ?? process.env.PRISM_SOC2_WEBHOOK_TOKEN,
            webhookFlavor: config.webhookFlavor ??
                ((process.env.PRISM_SOC2_WEBHOOK_FLAVOR as WebhookFlavor) || "generic"),
            batchSize: config.batchSize ?? 32,
            flushIntervalMs: config.flushIntervalMs ?? 60_000,
            now: config.now ?? (() => new Date()),
            httpPoster: config.httpPoster,
        };
    }

    /** Returns true when start() will actually subscribe. */
    isEnabled(): boolean {
        return this.config.mode === "file" || this.config.mode === "webhook";
    }

    /** Subscribe and instantiate the configured transport. No-op when off. */
    start(): void {
        if (!this.isEnabled() || this.unsubscribe) return;
        this.transport = this.buildTransport();
        this.unsubscribe = this.activityBus.subscribe(this);
    }

    onEvent(event: ActivityEvent): void {
        if (!this.transport) return;
        const controls = classifyEventForSoc2(event);
        if (!controls) return;
        const record = mapEventToSoc2(event, controls);
        try {
            this.transport.write(record);
            this.lastEventAt = new Date().toISOString();
            this.totalEvents += 1;
        } catch {
            // Never let the pipeline tear down PRISM.
            this.droppedEvents += 1;
        }
    }

    /**
     * Read-only status snapshot. Safe to call regardless of `mode`.
     * Returns `{enabled:false}` cleanly when `PRISM_SOC2_EXPORTER` is unset.
     */
    getStatus(): {
        enabled: boolean;
        mode: Soc2ExporterConfig["mode"];
        running: boolean;
        webhookFlavor?: WebhookFlavor;
        outputDir?: string;
        lastEventAt: string | null;
        totalEvents: number;
        droppedEvents: number;
    } {
        return {
            enabled: this.isEnabled(),
            mode: this.config.mode,
            running: this.unsubscribe !== null,
            webhookFlavor: this.config.mode === "webhook" ? this.config.webhookFlavor : undefined,
            outputDir: this.config.mode === "file" ? this.config.outputDir : undefined,
            lastEventAt: this.lastEventAt,
            totalEvents: this.totalEvents,
            droppedEvents: this.droppedEvents,
        };
    }

    /** Flush + unsubscribe. Safe to call repeatedly. */
    async stop(): Promise<void> {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        if (this.transport) {
            try { await this.transport.flush(); } catch { /* swallow */ }
            this.transport.close();
            this.transport = null;
        }
    }

    private buildTransport(): Transport {
        if (this.config.mode === "file") {
            return new FileTransport(this.config.outputDir, this.config.now);
        }
        if (this.config.mode === "webhook") {
            const url = this.config.webhookUrl;
            if (!url) {
                throw new Error(
                    "Soc2EvidenceExporter: PRISM_SOC2_EXPORTER=webhook requires PRISM_SOC2_WEBHOOK_URL.",
                );
            }
            const poster = this.config.httpPoster ?? defaultHttpPoster;
            return new WebhookTransport(
                url,
                this.config.webhookToken,
                this.config.webhookFlavor,
                this.config.batchSize,
                this.config.flushIntervalMs,
                this.config.outputDir,
                poster,
            );
        }
        throw new Error(`Soc2EvidenceExporter: unknown mode '${this.config.mode}'`);
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

function isoDay(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function defaultHttpPoster(url: string, body: string, headers: Record<string, string>): Promise<void> {
    return new Promise((resolveP, rejectP) => {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch (err) {
            rejectP(err as Error);
            return;
        }
        const lib = parsed.protocol === "https:" ? https : http;
        const req = lib.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
                path: `${parsed.pathname || "/"}${parsed.search || ""}`,
                method: "POST",
                headers: { ...headers, "content-length": Buffer.byteLength(body).toString() },
            },
            (res) => {
                // Consume body so the socket can be released.
                res.resume();
                const status = res.statusCode ?? 0;
                if (status >= 200 && status < 300) resolveP();
                else rejectP(new Error(`webhook responded ${status}`));
            },
        );
        req.on("error", rejectP);
        req.setTimeout(10_000, () => req.destroy(new Error("webhook request timed out")));
        req.write(body);
        req.end();
    });
}

/** Backfill helper used by `scripts/prism-soc2-export.cjs`. */
export function backfillFromEvents(
    events: ActivityEvent[],
    opts?: { since?: Date; until?: Date },
): Soc2EvidenceRecord[] {
    const out: Soc2EvidenceRecord[] = [];
    const sinceMs = opts?.since ? opts.since.getTime() : Number.NEGATIVE_INFINITY;
    const untilMs = opts?.until ? opts.until.getTime() : Number.POSITIVE_INFINITY;
    for (const ev of events) {
        const tsMs = Date.parse(ev.timestamp);
        if (Number.isNaN(tsMs)) continue;
        if (tsMs < sinceMs || tsMs > untilMs) continue;
        const controls = classifyEventForSoc2(ev);
        if (!controls) continue;
        out.push(mapEventToSoc2(ev, controls));
    }
    return out;
}

/** Idempotent: ensures the parent directory of `path` exists. */
export function ensureParentDir(path: string): void {
    const parent = dirname(path);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
}
