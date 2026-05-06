/**
 * UtilityRegistry — operator-facing one-shot utilities exposed via the
 * dashboard "Utilities" panel.
 *
 * A utility is a named, idempotent administrative task (e.g. regenerate
 * release packet, run contract diff gate, export policy audit). Each entry
 * exposes a stable id, a label, a risk tier (1=autonomous, 2=conditional,
 * 3=requires approval), and a handler that returns a small JSON-serializable
 * result object.
 *
 * The registry maintains a bounded in-memory ring buffer of recent runs so
 * the operator can poll for status. It is intentionally non-durable —
 * historical runs live in the ActivityBus / SqliteActivityStore.
 */

import { randomUUID } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";

export type UtilityRiskTier = 1 | 2 | 3;

export type UtilityRunStatus = "queued" | "running" | "succeeded" | "failed";

export interface UtilityDescriptor {
    id: string;
    label: string;
    description: string;
    riskTier: UtilityRiskTier;
    handler: (args?: Record<string, unknown>) => Promise<UtilityResult>;
}

export interface UtilityResult {
    summary: string;
    details?: Record<string, unknown>;
}

export interface UtilityRun {
    runId: string;
    utilityId: string;
    label: string;
    riskTier: UtilityRiskTier;
    status: UtilityRunStatus;
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    result: UtilityResult | null;
    error: string | null;
    requestedBy: string | null;
}

const MAX_HISTORY = 50;

export class UtilityRegistry {
    private readonly utilities = new Map<string, UtilityDescriptor>();
    private readonly history: UtilityRun[] = [];

    constructor(private readonly activityBus?: ActivityBus) { }

    register(descriptor: UtilityDescriptor): void {
        if (!descriptor.id || !descriptor.label) {
            throw new Error("UtilityDescriptor requires id and label");
        }
        this.utilities.set(descriptor.id, descriptor);
    }

    list(): Array<Omit<UtilityDescriptor, "handler">> {
        return Array.from(this.utilities.values()).map(({ handler: _handler, ...rest }) => rest);
    }

    get(id: string): UtilityDescriptor | null {
        return this.utilities.get(id) ?? null;
    }

    getRun(runId: string): UtilityRun | null {
        return this.history.find((r) => r.runId === runId) ?? null;
    }

    listRuns(limit = 20): UtilityRun[] {
        return this.history.slice(0, Math.max(1, Math.min(MAX_HISTORY, limit)));
    }

    /**
     * Execute a utility synchronously (the caller awaits completion).
     * Returns the run record. The registry retains the last MAX_HISTORY runs.
     */
    async execute(
        utilityId: string,
        args?: Record<string, unknown>,
        requestedBy?: string,
    ): Promise<UtilityRun> {
        const descriptor = this.utilities.get(utilityId);
        if (!descriptor) {
            const err = new Error(`Unknown utility: ${utilityId}`);
            (err as Error & { code?: string }).code = "UTILITY_NOT_FOUND";
            throw err;
        }

        const run: UtilityRun = {
            runId: randomUUID(),
            utilityId: descriptor.id,
            label: descriptor.label,
            riskTier: descriptor.riskTier,
            status: "running",
            startedAt: new Date().toISOString(),
            completedAt: null,
            durationMs: null,
            result: null,
            error: null,
            requestedBy: requestedBy ?? null,
        };
        this.history.unshift(run);
        if (this.history.length > MAX_HISTORY) {
            this.history.length = MAX_HISTORY;
        }

        this.activityBus?.emit({
            sessionId: run.runId,
            layer: "governance",
            operation: `utility.${descriptor.id}.started`,
            status: "started",
            details: {
                utilityId: descriptor.id,
                label: descriptor.label,
                riskTier: descriptor.riskTier,
                requestedBy: run.requestedBy,
            },
        });

        const t0 = Date.now();
        try {
            const result = await descriptor.handler(args);
            run.status = "succeeded";
            run.result = result;
            run.completedAt = new Date().toISOString();
            run.durationMs = Date.now() - t0;
            this.activityBus?.emit({
                sessionId: run.runId,
                layer: "governance",
                operation: `utility.${descriptor.id}.succeeded`,
                status: "succeeded",
                details: {
                    utilityId: descriptor.id,
                    durationMs: run.durationMs,
                    summary: result.summary,
                },
            });
            return run;
        } catch (err: unknown) {
            run.status = "failed";
            run.error = err instanceof Error ? err.message : String(err);
            run.completedAt = new Date().toISOString();
            run.durationMs = Date.now() - t0;
            this.activityBus?.emit({
                sessionId: run.runId,
                layer: "governance",
                operation: `utility.${descriptor.id}.failed`,
                status: "failed",
                details: {
                    utilityId: descriptor.id,
                    durationMs: run.durationMs,
                    error: run.error,
                },
            });
            return run;
        }
    }
}

/**
 * Built-in utility descriptors that wrap existing PRISM CLI scripts /
 * service hooks. Each handler is a small shim that returns a summary plus
 * any structured details produced by the underlying operation.
 */
export interface BuiltInUtilityWiring {
    runReleasePacket?: () => Promise<UtilityResult>;
    runContractDiffGate?: () => Promise<UtilityResult>;
    exportPolicyAudit?: () => Promise<UtilityResult>;
    exportSessionTrace?: () => Promise<UtilityResult>;
    runPerfQualify?: () => Promise<UtilityResult>;
    runRetrievalTrends?: () => Promise<UtilityResult>;
    runPerfTrendReport?: () => Promise<UtilityResult>;
}

export function registerBuiltInUtilities(
    registry: UtilityRegistry,
    wiring: BuiltInUtilityWiring,
): void {
    const stubHandler = (label: string) => async (): Promise<UtilityResult> => ({
        summary: `${label} not wired in this deployment.`,
        details: { wired: false },
    });

    registry.register({
        id: "regenerate-release-packet",
        label: "Regenerate release packet",
        description: "Run scripts/generate-release-packet to refresh release artifacts.",
        riskTier: 2,
        handler: wiring.runReleasePacket ?? stubHandler("Release packet generation"),
    });
    registry.register({
        id: "run-contract-diff-gate",
        label: "Run tool contract diff gate",
        description: "Compare the current tool contract snapshot to the baseline.",
        riskTier: 1,
        handler: wiring.runContractDiffGate ?? stubHandler("Contract diff gate"),
    });
    registry.register({
        id: "export-policy-audit",
        label: "Export policy audit bundle",
        description: "Materialize a JSON audit bundle of recent policy decisions.",
        riskTier: 1,
        handler: wiring.exportPolicyAudit ?? stubHandler("Policy audit export"),
    });
    registry.register({
        id: "export-session-trace",
        label: "Export session trace bundle",
        description: "Materialize a JSON trace bundle for the current session.",
        riskTier: 1,
        handler: wiring.exportSessionTrace ?? stubHandler("Session trace export"),
    });
    registry.register({
        id: "run-perf-qualify",
        label: "Run performance qualification",
        description: "Run the perf:qualify suite and return summary metrics.",
        riskTier: 2,
        handler: wiring.runPerfQualify ?? stubHandler("Performance qualification"),
    });
    registry.register({
        id: "run-perf-trend-report",
        label: "Generate perf trend report",
        description: "Compute profile-differentiated performance trend artifacts.",
        riskTier: 1,
        handler: wiring.runPerfTrendReport ?? stubHandler("Perf trend report"),
    });
    registry.register({
        id: "run-retrieval-trends",
        label: "Run retrieval trends snapshot",
        description: "Capture a retrieval cohort trend snapshot for the active session.",
        riskTier: 1,
        handler: wiring.runRetrievalTrends ?? stubHandler("Retrieval trends snapshot"),
    });
}
