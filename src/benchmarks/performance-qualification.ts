import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { workspacePath } from "../core/config/workspace-resolver.js";
import { ActivityBus } from "../core/activity/bus.js";
import { SqliteActivityStore } from "../core/activity/sqlite-store.js";
import type { ActivityEvent } from "../core/activity/types.js";
import { ApprovalQueue } from "../core/approval/approval-queue.js";
import {
    getPerformanceSloProfile,
    resolveEnvironmentProfile,
} from "../core/config/environment-profiles.js";
import { SemanticMemoryIndex } from "../core/memory/semantic-memory.js";
import { PolicyEngine } from "../core/policy/engine.js";

interface PerformanceGate {
    metric: string;
    measured: number;
    threshold: number;
    comparator: "<=";
    passed: boolean;
}

interface BenchmarkResult {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    avgMs: number;
    sampleCount: number;
}

interface PerformanceQualificationArtifact {
    generatedAt: string;
    configuration: {
        environmentProfile: string;
        policyIterations: number;
        retrievalDocuments: number;
        retrievalQueries: number;
        eventEmits: number;
        warmupIterations: number;
        approvalRequests: number;
        approvalConcurrency: number;
    };
    thresholds: {
        policyP95Ms: number;
        retrievalP95Ms: number;
        eventDeliveryP95Ms: number;
        telemetryOverheadP95Ms: number;
        persistenceOverheadP95Ms: number;
        approvalPathwayP99Ms: number;
    };
    benchmarks: {
        policy: BenchmarkResult;
        retrieval: BenchmarkResult;
        eventBaseline: BenchmarkResult;
        eventDelivery: BenchmarkResult;
        persistenceIncluded: BenchmarkResult;
        approvalContention: BenchmarkResult;
    };
    derived: {
        telemetryOverheadP95Ms: number;
        persistenceOverheadP95Ms: number;
    };
    gateResults: PerformanceGate[];
    advisoryGateResults: PerformanceGate[];
    passed: boolean;
}

const POLICY_ITERATIONS = readIntEnv("PRISM_POLICY_ITERATIONS", 10_000);
const RETRIEVAL_DOCUMENTS = readIntEnv("PRISM_RETRIEVAL_DOCUMENTS", 4_000);
const RETRIEVAL_QUERIES = readIntEnv("PRISM_RETRIEVAL_QUERIES", 1_000);
const EVENT_EMITS = readIntEnv("PRISM_EVENT_EMITS", 2_000);
const WARMUP_ITERATIONS = readIntEnv("PRISM_PERF_WARMUP_ITERATIONS", 250);
const APPROVAL_REQUESTS = readIntEnv("PRISM_APPROVAL_REQUESTS", 400);
const APPROVAL_CONCURRENCY = readIntEnv("PRISM_APPROVAL_CONCURRENCY", 40);
const ENVIRONMENT_PROFILE = resolveEnvironmentProfile(
    process.env.PRISM_ENV_PROFILE ?? (process.env.CI ? "staging" : "dev"),
);
const ACTIVE_SLO_PROFILE = getPerformanceSloProfile(ENVIRONMENT_PROFILE);

const SLO_POLICY_P95_MS = readNumberEnv("PRISM_SLO_POLICY_P95_MS", ACTIVE_SLO_PROFILE.policyP95Ms);
const SLO_RETRIEVAL_P95_MS = readNumberEnv("PRISM_SLO_RETRIEVAL_P95_MS", ACTIVE_SLO_PROFILE.retrievalP95Ms);
const SLO_EVENT_P95_MS = readNumberEnv("PRISM_SLO_EVENT_P95_MS", ACTIVE_SLO_PROFILE.eventDeliveryP95Ms);
const SLO_TELEMETRY_OVERHEAD_P95_MS = readNumberEnv("PRISM_SLO_TELEMETRY_OVERHEAD_P95_MS", ACTIVE_SLO_PROFILE.telemetryOverheadP95Ms);
const SLO_PERSISTENCE_OVERHEAD_P95_MS = readNumberEnv("PRISM_SLO_PERSISTENCE_OVERHEAD_P95_MS", ACTIVE_SLO_PROFILE.persistenceOverheadP95Ms);
const SLO_APPROVAL_PATHWAY_P99_MS = readNumberEnv("PRISM_SLO_APPROVAL_PATHWAY_P99_MS", ACTIVE_SLO_PROFILE.approvalPathwayP99Ms);
const PERF_OUTPUT_PATH = process.env.PRISM_PERF_OUTPUT_PATH ?? workspacePath("artifacts", "benchmarks", "perf-qualification.json");

async function main(): Promise<void> {
    const policyResult = benchmarkPolicyEngine(POLICY_ITERATIONS);
    const retrievalResult = benchmarkSemanticRetrieval(RETRIEVAL_DOCUMENTS, RETRIEVAL_QUERIES);
    const eventBaseline = benchmarkActivityBus(EVENT_EMITS, { semantic: false, sqlite: false });
    const eventResult = benchmarkActivityBus(EVENT_EMITS, { semantic: true, sqlite: false });
    const persistenceResult = benchmarkActivityBus(EVENT_EMITS, { semantic: true, sqlite: true });
    const telemetryOverheadP95 = Math.max(0, eventResult.p95Ms - eventBaseline.p95Ms);
    const persistenceOverheadP95 = Math.max(0, persistenceResult.p95Ms - eventResult.p95Ms);
    const approvalContention = await benchmarkApprovalPathwayContention(
        APPROVAL_REQUESTS,
        APPROVAL_CONCURRENCY,
    );

    const gates: PerformanceGate[] = [
        gate("Policy decision p95 (ms)", policyResult.p95Ms, SLO_POLICY_P95_MS),
        gate("Retrieval latency p95 (ms)", retrievalResult.p95Ms, SLO_RETRIEVAL_P95_MS),
        gate("Event delivery p95 (ms)", eventResult.p95Ms, SLO_EVENT_P95_MS),
        gate("Telemetry overhead p95 (ms)", telemetryOverheadP95, SLO_TELEMETRY_OVERHEAD_P95_MS),
    ];

    const advisoryGates: PerformanceGate[] = [
        gate("Persistence overhead p95 (ms)", persistenceOverheadP95, SLO_PERSISTENCE_OVERHEAD_P95_MS),
        gate("Approval pathway p99 (ms)", approvalContention.p99Ms, SLO_APPROVAL_PATHWAY_P99_MS),
    ];

    console.log("\nPRISM performance qualification\n");
    console.log(`- Environment profile: ${ENVIRONMENT_PROFILE}`);
    printResult("Policy", policyResult);
    printResult("Retrieval", retrievalResult);
    printResult("Event Baseline", eventBaseline);
    printResult("Event Delivery", eventResult);
    printResult("Persistence Included", persistenceResult);
    printResult("Approval Contention", approvalContention);
    console.log(`- Telemetry Overhead (p95 delta): ${telemetryOverheadP95.toFixed(3)}ms`);
    console.log(`- Persistence Overhead (p95 delta): ${persistenceOverheadP95.toFixed(3)}ms`);

    console.log("\nGate results");
    for (const check of gates) {
        const status = check.passed ? "PASS" : "FAIL";
        console.log(
            `- [${status}] ${check.metric}: measured=${check.measured.toFixed(3)}ms threshold<=${check.threshold.toFixed(3)}ms`,
        );
    }

    console.log("\nAdvisory gates");
    for (const check of advisoryGates) {
        const status = check.passed ? "PASS" : "WARN";
        console.log(
            `- [${status}] ${check.metric}: measured=${check.measured.toFixed(3)}ms threshold<=${check.threshold.toFixed(3)}ms`,
        );
    }

    const failed = gates.filter((check) => !check.passed);
    await writeArtifact({
        generatedAt: new Date().toISOString(),
        configuration: {
            environmentProfile: ENVIRONMENT_PROFILE,
            policyIterations: POLICY_ITERATIONS,
            retrievalDocuments: RETRIEVAL_DOCUMENTS,
            retrievalQueries: RETRIEVAL_QUERIES,
            eventEmits: EVENT_EMITS,
            warmupIterations: WARMUP_ITERATIONS,
            approvalRequests: APPROVAL_REQUESTS,
            approvalConcurrency: APPROVAL_CONCURRENCY,
        },
        thresholds: {
            policyP95Ms: SLO_POLICY_P95_MS,
            retrievalP95Ms: SLO_RETRIEVAL_P95_MS,
            eventDeliveryP95Ms: SLO_EVENT_P95_MS,
            telemetryOverheadP95Ms: SLO_TELEMETRY_OVERHEAD_P95_MS,
            persistenceOverheadP95Ms: SLO_PERSISTENCE_OVERHEAD_P95_MS,
            approvalPathwayP99Ms: SLO_APPROVAL_PATHWAY_P99_MS,
        },
        benchmarks: {
            policy: policyResult,
            retrieval: retrievalResult,
            eventBaseline,
            eventDelivery: eventResult,
            persistenceIncluded: persistenceResult,
            approvalContention,
        },
        derived: {
            telemetryOverheadP95Ms: telemetryOverheadP95,
            persistenceOverheadP95Ms: persistenceOverheadP95,
        },
        gateResults: gates,
        advisoryGateResults: advisoryGates,
        passed: failed.length === 0,
    });

    if (failed.length > 0) {
        process.exitCode = 1;
    }
}

async function writeArtifact(artifact: PerformanceQualificationArtifact): Promise<void> {
    const outputPath = PERF_OUTPUT_PATH;
    const normalizedPath = outputPath.replaceAll("\\", "/");
    const lastSlashIndex = normalizedPath.lastIndexOf("/");
    const outputDir = lastSlashIndex >= 0 ? normalizedPath.slice(0, lastSlashIndex) : ".";

    await mkdir(outputDir, { recursive: true });
    await writeFile(normalizedPath, JSON.stringify(artifact, null, 2), "utf-8");
    console.log(`- Artifact: ${normalizedPath}`);
}

async function benchmarkApprovalPathwayContention(
    totalRequests: number,
    maxInFlight: number,
): Promise<BenchmarkResult> {
    const queue = new ApprovalQueue();
    const samples: number[] = [];
    const sessionId = "perf-approval-session";
    const inFlight = new Set<Promise<void>>();
    let nextRequestId = 0;
    let settleToggle = 0;

    await withMutedConsole(async () => {
        const startNext = (): void => {
            if (nextRequestId >= totalRequests) {
                return;
            }

            const requestNumber = nextRequestId;
            nextRequestId += 1;

            const run = (async () => {
                const startedAt = performance.now();
                const requestPromise = queue.request(
                    sessionId,
                    `contention_op_${requestNumber % 5}`,
                    { requestNumber },
                    5_000,
                );

                await settleOne(queue, settleToggle++ % 3 !== 0);
                await requestPromise;
                samples.push(performance.now() - startedAt);
            })();

            inFlight.add(run);
            void run.finally(() => {
                inFlight.delete(run);
            });
        };

        const warmupCount = Math.min(WARMUP_ITERATIONS, Math.max(10, Math.floor(totalRequests / 10)));
        for (let i = 0; i < warmupCount; i++) {
            const warmup = queue.request(sessionId, "warmup", { i }, 1_000);
            await settleOne(queue, true);
            await warmup;
        }

        while (nextRequestId < totalRequests || inFlight.size > 0) {
            while (nextRequestId < totalRequests && inFlight.size < Math.max(1, maxInFlight)) {
                startNext();
            }

            if (inFlight.size > 0) {
                await Promise.race(inFlight);
            }
        }
    });

    return summarize(samples);
}

async function settleOne(queue: ApprovalQueue, approve: boolean): Promise<void> {
    while (true) {
        const pending = queue.list();
        if (pending.length > 0) {
            const id = pending[0]!.id;
            if (approve) {
                queue.approve(id);
            } else {
                queue.deny(id);
            }
            return;
        }

        await delay(0);
    }
}

async function withMutedConsole<T>(fn: () => Promise<T>): Promise<T> {
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => { };
    console.warn = () => { };

    try {
        return await fn();
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function benchmarkPolicyEngine(iterations: number): BenchmarkResult {
    const engine = new PolicyEngine();
    const samples: number[] = [];

    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        engine.evaluate({
            operation: "file_read",
            risk: "low",
            mutatesState: false,
            rollbackPlan: undefined,
            isWhitelisted: false,
        });
    }

    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        engine.evaluate({
            operation: i % 3 === 0 ? "shell_exec" : "file_read",
            risk: i % 3 === 0 ? "high" : i % 2 === 0 ? "medium" : "low",
            mutatesState: i % 3 === 0,
            rollbackPlan: i % 4 === 0 ? "restore snapshot" : undefined,
            isWhitelisted: false,
        });
        samples.push(performance.now() - start);
    }

    return summarize(samples);
}

function benchmarkSemanticRetrieval(documentCount: number, queryCount: number): BenchmarkResult {
    const index = new SemanticMemoryIndex();

    for (let i = 0; i < documentCount; i++) {
        index.onEvent(syntheticEvent(i));
    }

    const samples: number[] = [];
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        index.query("workflow governance approval", 5);
    }

    for (let i = 0; i < queryCount; i++) {
        const query = i % 2 === 0 ? "workflow governance approval" : "memory retrieval utility";
        const start = performance.now();
        index.query(query, 5);
        samples.push(performance.now() - start);
    }

    return summarize(samples);
}

function benchmarkActivityBus(
    eventCount: number,
    options: { semantic: boolean; sqlite: boolean },
): BenchmarkResult {
    const bus = new ActivityBus();
    const semantic = new SemanticMemoryIndex();
    const subscribers: Array<{ close?: () => void }> = [];

    if (options.semantic) {
        bus.subscribe(semantic);
    }

    if (options.sqlite) {
        const dbPath = join(tmpdir(), `prism-perf-${randomUUID()}.db`);
        const sqlite = new SqliteActivityStore(dbPath);
        subscribers.push({
            close: () => {
                sqlite.close();
                rmSync(dbPath, { force: true });
            },
        });
        bus.subscribe(sqlite);
    }

    const samples: number[] = [];
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        bus.emit({
            sessionId: "perf-warmup",
            layer: "tool_execution",
            operation: "perf.warmup",
            status: "succeeded",
            details: { i },
        });
    }

    for (let i = 0; i < eventCount; i++) {
        const start = performance.now();
        bus.emit({
            sessionId: "perf-session",
            layer: i % 2 === 0 ? "tool_execution" : "retrieval",
            operation: i % 2 === 0 ? "perf.tool" : "perf.retrieve",
            status: "succeeded",
            details: { n: i, payload: `event-${i}` },
        });
        samples.push(performance.now() - start);
    }

    for (const subscriber of subscribers) {
        subscriber.close?.();
    }

    return summarize(samples);
}

function syntheticEvent(index: number): ActivityEvent {
    return {
        id: `perf-${index}`,
        timestamp: new Date(Date.now() + index).toISOString(),
        sessionId: "perf-retrieval-session",
        layer: index % 2 === 0 ? "retrieval" : "causal",
        operation: index % 2 === 0 ? "retrieval.lookup" : "workflow.step",
        status: "succeeded",
        details: {
            text: index % 2 === 0
                ? "governance approval workflow retrieval policy"
                : "memory utility novelty coverage diagnostics",
        },
    };
}

function summarize(samples: number[]): BenchmarkResult {
    const sorted = [...samples].sort((a, b) => a - b);
    return {
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        p99Ms: percentile(sorted, 0.99),
        avgMs: samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length),
        sampleCount: samples.length,
    };
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) {
        return 0;
    }
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return sorted[idx] ?? 0;
}

function printResult(name: string, result: BenchmarkResult): void {
    console.log(
        `- ${name}: samples=${result.sampleCount} avg=${result.avgMs.toFixed(3)}ms p50=${result.p50Ms.toFixed(3)}ms p95=${result.p95Ms.toFixed(3)}ms p99=${result.p99Ms.toFixed(3)}ms`,
    );
}

function gate(metric: string, measured: number, threshold: number): PerformanceGate {
    return {
        metric,
        measured,
        threshold,
        comparator: "<=",
        passed: measured <= threshold,
    };
}

function readIntEnv(name: string, fallback: number): number {
    const value = process.env[name];
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNumberEnv(name: string, fallback: number): number {
    const value = process.env[name];
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

void main();