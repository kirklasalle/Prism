/**
 * OtelExporter — ActivityBus → OpenTelemetry span subscriber
 *
 * Bridges PRISM's ActivityBus to the OpenTelemetry ecosystem.
 * Zero external npm dependencies: emits OTLP-JSON to stdout (for log collectors)
 * or to a configurable HTTP endpoint via PRISM_OTEL_ENDPOINT env var.
 *
 * Also drives the MetricsStore: each ActivityBus event increments the
 * appropriate counters/histograms so `GET /metrics` always reflects live state.
 *
 * Usage:
 *   const exporter = new OtelExporter(activityBus, metricsStore, {
 *     serviceName: "prism",
 *     serviceVersion: "0.2.0",
 *     endpoint: process.env.PRISM_OTEL_ENDPOINT,   // optional HTTP OTLP endpoint
 *     consoleExport: process.env.PRISM_OTEL_CONSOLE === "true",
 *   });
 *   exporter.start();     // begins listening
 *   exporter.stop();      // unsubscribes
 *
 * Phase E — Workstream E6. See docs/PHASE_E_TASKS_MANIFEST.md.
 */

import { randomUUID } from "node:crypto";
import https from "node:https";
import http from "node:http";
import type { ActivityBus } from "./bus.js";
import type { ActivityEvent } from "./types.js";
import { MetricsStore } from "./metrics-store.js";

// ── Configuration ─────────────────────────────────────────────────────────────

export interface OtelExporterConfig {
    /** OTel resource service.name attribute. Default: "prism". */
    serviceName?: string;
    /** OTel resource service.version attribute. Default: "0.2.0". */
    serviceVersion?: string;
    /**
     * HTTP/HTTPS OTLP endpoint URL (e.g., "http://localhost:4318/v1/traces").
     * If omitted, no network export is performed.
     */
    endpoint?: string;
    /**
     * Emit OTLP JSON spans to stdout.
     * Useful with log collectors (Loki, Datadog, Splunk) that ingest stdout.
     * Default: false.
     */
    consoleExport?: boolean;
}

// ── Minimal OTLP-JSON types ───────────────────────────────────────────────────

interface OtlpSpan {
    traceId: string;
    spanId: string;
    name: string;
    kind: number; // 2 = SPAN_KIND_SERVER
    startTimeUnixNano: string;
    endTimeUnixNano: string;
    status: { code: number; message?: string }; // 0=unset 1=ok 2=error
    attributes: Array<{ key: string; value: { stringValue?: string; intValue?: number; boolValue?: boolean } }>;
}

// ── Exporter ─────────────────────────────────────────────────────────────────

export class OtelExporter {
    private readonly config: Required<OtelExporterConfig>;
    private readonly metricsStore: MetricsStore;
    private unsubscribe: (() => void) | null = null;

    constructor(
        private readonly activityBus: ActivityBus,
        metricsStore: MetricsStore,
        config: OtelExporterConfig = {}
    ) {
        this.metricsStore = metricsStore;
        this.config = {
            serviceName: config.serviceName ?? "prism",
            serviceVersion: config.serviceVersion ?? "0.2.0",
            endpoint: config.endpoint ?? "",
            consoleExport: config.consoleExport ?? false,
        };
        this.registerMetrics();
    }

    /** Subscribe to ActivityBus. Call once at startup. */
    start(): void {
        if (this.unsubscribe) return; // already started
        this.unsubscribe = this.activityBus.subscribe({
            onEvent: (event) => this.handleEvent(event),
        });
    }

    /** Unsubscribe from ActivityBus. */
    stop(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }

    // ── Metric registration ───────────────────────────────────────────────────

    private registerMetrics(): void {
        const m = this.metricsStore;

        // Counters
        m.registerCounter("prism_activity_events_total", "Total ActivityBus events emitted");
        m.registerCounter("prism_policy_decisions_total", "Total policy decisions by tier and decision");
        m.registerCounter("prism_errors_total", "Total failed operations");
        m.registerCounter("prism_llm_requests_total", "Total LLM generation requests");
        m.registerCounter("prism_a2a_tasks_total", "Total A2A protocol tasks received");
        m.registerCounter("prism_governance_hooks_total", "Total governance hook evaluations");
        m.registerCounter("prism_tool_executions_total", "Total tool execution attempts");
        m.registerCounter("prism_agent_lifecycle_total", "Total agent lifecycle transitions");
        m.registerCounter("prism_auto_run_approved_tier2_total", "Total auto-run executions triggered after Tier-2 approval");

        // Histograms (latency in ms)
        m.registerHistogram(
            "prism_operation_duration_ms",
            "Duration of PRISM operations in milliseconds",
            [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
        );
        m.registerHistogram(
            "prism_policy_latency_ms",
            "Policy evaluation latency in milliseconds",
            [1, 2, 5, 10, 25, 50, 100, 250, 500]
        );
        // Auto-run duration: time between approval-resolved and agentic completion
        m.registerHistogram(
            "prism_auto_run_duration_ms",
            "Duration of auto-run executions triggered after Tier-2 approval (ms)",
            [50, 100, 250, 500, 1000, 2500, 5000, 10000]
        );
        m.registerHistogram(
            "prism_llm_latency_ms",
            "LLM generation latency in milliseconds",
            [100, 250, 500, 1000, 2500, 5000, 10000, 30000]
        );

        // Gauges (note: these are set on each event, not on-demand)
        m.registerGauge("prism_info", "PRISM version information (always 1)");
        m.set("prism_info", 1, {
            version: "0.2.0",
            service: "prism",
        });
    }

    // ── Event handler ─────────────────────────────────────────────────────────

    private handleEvent(event: ActivityEvent): void {
        const m = this.metricsStore;

        // prism_activity_events_total{layer, status}
        m.inc("prism_activity_events_total", {
            layer: event.layer,
            status: event.status,
        });

        // prism_errors_total{layer, operation}
        if (event.status === "failed") {
            m.inc("prism_errors_total", {
                layer: event.layer,
                operation: event.operation,
            });
        }

        // prism_policy_decisions_total{tier, decision}
        if (event.authorityTier && event.policyDecision) {
            m.inc("prism_policy_decisions_total", {
                tier: event.authorityTier,
                decision: event.policyDecision,
            });
        }

        // prism_llm_requests_total{status}
        if (event.layer === "llm") {
            m.inc("prism_llm_requests_total", { status: event.status });
            if (event.durationMs !== undefined) {
                m.observe("prism_llm_latency_ms", event.durationMs);
            }
        }

        // prism_a2a_tasks_total{status}
        if (event.operation.startsWith("a2a_task")) {
            m.inc("prism_a2a_tasks_total", { operation: event.operation });
        }

        // prism_governance_hooks_total{decision}
        if (event.operation === "pre_tool_use_evaluated") {
            const decision = (event.details?.permission_decision as string) ?? "unknown";
            m.inc("prism_governance_hooks_total", { hook: "pre_tool_use", decision });
        }
        if (event.operation === "post_tool_use_recorded") {
            m.inc("prism_governance_hooks_total", { hook: "post_tool_use", decision: "recorded" });
        }

        // prism_tool_executions_total{operation, status}
        if (event.layer === "tool_execution") {
            m.inc("prism_tool_executions_total", {
                operation: event.operation,
                status: event.status,
            });
        }

        // prism_agent_lifecycle_total{operation}
        if (event.layer === "agent") {
            m.inc("prism_agent_lifecycle_total", { operation: event.operation });
        }

        // prism_operation_duration_ms{layer}
        if (event.durationMs !== undefined) {
            m.observe("prism_operation_duration_ms", event.durationMs, { layer: event.layer });
        }

        // OTel span export
        if (this.config.endpoint || this.config.consoleExport) {
            const span = this.eventToSpan(event);
            if (this.config.consoleExport) {
                process.stdout.write(JSON.stringify(span) + "\n");
            }
            if (this.config.endpoint) {
                void this.exportSpan(span);
            }
        }
    }

    // ── OTel span conversion ──────────────────────────────────────────────────

    private eventToSpan(event: ActivityEvent): OtlpSpan {
        const startNs = BigInt(new Date(event.timestamp).getTime()) * BigInt(1_000_000);
        const durationNs = event.durationMs
            ? BigInt(Math.round(event.durationMs * 1_000_000))
            : BigInt(0);
        const endNs = startNs + durationNs;

        const attributes: OtlpSpan["attributes"] = [
            { key: "prism.layer", value: { stringValue: event.layer } },
            { key: "prism.operation", value: { stringValue: event.operation } },
            { key: "prism.status", value: { stringValue: event.status } },
            { key: "prism.session_id", value: { stringValue: event.sessionId } },
        ];
        if (event.authorityTier) {
            attributes.push({ key: "prism.authority_tier", value: { stringValue: event.authorityTier } });
        }
        if (event.policyDecision) {
            attributes.push({ key: "prism.policy_decision", value: { stringValue: event.policyDecision } });
        }
        if (event.characterId) {
            attributes.push({ key: "prism.character_id", value: { stringValue: event.characterId } });
        }

        return {
            traceId: event.id.replace(/-/g, "").padEnd(32, "0").slice(0, 32),
            spanId: randomUUID().replace(/-/g, "").slice(0, 16),
            name: `${event.layer}:${event.operation}`,
            kind: 2,
            startTimeUnixNano: startNs.toString(),
            endTimeUnixNano: endNs.toString(),
            status: {
                code: event.status === "failed" ? 2 : 1,
                message: event.status,
            },
            attributes,
        };
    }

    private exportSpan(span: OtlpSpan): Promise<void> {
        return new Promise<void>((resolve) => {
            try {
                const payload = JSON.stringify({
                    resourceSpans: [{
                        resource: {
                            attributes: [
                                { key: "service.name", value: { stringValue: this.config.serviceName } },
                                { key: "service.version", value: { stringValue: this.config.serviceVersion } },
                            ]
                        },
                        scopeSpans: [{ spans: [span] }]
                    }]
                });

                const url = new URL(this.config.endpoint);
                const transport = url.protocol === "https:" ? https : http;
                const req = transport.request({
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname,
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(payload),
                    },
                }, () => resolve());

                req.on("error", () => resolve()); // silent failure — observability must not break the platform
                req.setTimeout(3000, () => { req.destroy(); resolve(); });
                req.write(payload);
                req.end();
            } catch {
                resolve(); // never throw from telemetry path
            }
        });
    }
}
