import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ActivityBus } from "./core/activity/bus.js";
import { ConsoleActivitySubscriber } from "./core/activity/console-subscriber.js";
import { SqliteActivityStore } from "./core/activity/sqlite-store.js";
import { ApprovalQueue } from "./core/approval/approval-queue.js";
import { resolveEnvironmentProfile } from "./core/config/environment-profiles.js";
import { EpisodicMemory } from "./core/memory/episodic-memory.js";
import {
    resolveRetrievalAlertProfile,
    withRetrievalAlertPolicyProfile,
} from "./core/memory/retrieval-alert-policy.js";
import { RetrievalMetricsCollector } from "./core/memory/retrieval-metrics.js";
import { RetrievalDashboardStore } from "./core/memory/retrieval-dashboard-store.js";
import { SemanticMemoryIndex } from "./core/memory/semantic-memory.js";
import { SessionMemoryStore } from "./core/memory/session-memory.js";
import { PolicyEngine } from "./core/policy/engine.js";
import { Orchestrator } from "./core/runtime/orchestrator.js";
import { WorkflowExecutor } from "./core/runtime/workflow.js";
import { resolveExecutionProfileFromEnv, describeExecutionProfileResolution } from "./core/config/execution-mode-config.js";
import { builtinTools } from "./core/tools/builtin-tools.js";
import { ToolRegistry } from "./core/tools/registry.js";
import { MemoryQueryTool, SemanticQueryTool } from "./adapters/application/semantic-query-tool.js";
import { nexusBridgeTools } from "./adapters/application/nexus-bridge-tool.js";
import { ChatSessionStore } from "./core/operator/chat-session-store.js";
import { DashboardService, type DashboardAction } from "./core/operator/dashboard-service.js";
import { SelfReviewScheduler } from "./core/operator/self-review-scheduler.js";
import { McpClientAdapter } from "./adapters/protocol/mcp-client-tool.js";
import { AgentPool } from "./core/agents/agent-pool.js";

async function main(): Promise<void> {
    const runtimeMode = resolveRuntimeMode(process.env.PRISM_MODE ?? process.argv[2]);
    const dashboardPort = Number(process.env.PRISM_DASHBOARD_PORT ?? 7070);
    const environmentProfile = resolveEnvironmentProfile(
        process.env.PRISM_ENV_PROFILE ?? (process.env.CI ? "staging" : "dev"),
    );
    const retrievalAlertProfile = resolveRetrievalAlertProfile(environmentProfile);
    const sessionId = randomUUID();
    const activityBus = new ActivityBus();
    const sqliteStore = new SqliteActivityStore("prism-activity.db");
    const episodicMemory = new EpisodicMemory(600);
    const metricsCollector = new RetrievalMetricsCollector(1000, 100, {
        ...withRetrievalAlertPolicyProfile(retrievalAlertProfile),
    });
    const semanticIndex = new SemanticMemoryIndex();
    const retrievalDashboardStore = new RetrievalDashboardStore("prism-activity.db");
    const sessionMemory = new SessionMemoryStore("prism-activity.db");
    const chatSessionStore = new ChatSessionStore("prism-activity.db");
    const approvalQueue = new ApprovalQueue();
    const startedAt = new Date().toISOString();
    activityBus.subscribe(new ConsoleActivitySubscriber());
    activityBus.subscribe(sqliteStore);
    activityBus.subscribe(episodicMemory);
    activityBus.subscribe(semanticIndex);
    activityBus.subscribe(sessionMemory);
    const policyEngine = new PolicyEngine();
    const registry = new ToolRegistry();
    for (const tool of builtinTools()) {
        registry.register(tool);
    }
    registry.register(new SemanticQueryTool(semanticIndex, episodicMemory, sessionMemory, metricsCollector));
    registry.register(new MemoryQueryTool(semanticIndex, episodicMemory, sessionMemory, "memory_query", metricsCollector));
    for (const tool of nexusBridgeTools()) {
        registry.register(tool);
    }

    // Load MCP tools from .mcp/mcp-settings.json if present
    const mcpAdapter = new McpClientAdapter();
    const mcpSettingsPath = join(
        process.cwd(),
        process.env.PRISM_MCP_SETTINGS ?? ".mcp/mcp-settings.json",
    );
    if (existsSync(mcpSettingsPath)) {
        try {
            const mcpResult = await mcpAdapter.loadAndRegister(mcpSettingsPath, registry);
            if (mcpResult.registered.length > 0) {
                console.log(
                    `[MCP] Registered ${mcpResult.registered.length} tool(s):`,
                    mcpResult.registered.join(", "),
                );
            }
            for (const e of mcpResult.errors) {
                console.warn(`[MCP] ${e.server}: ${e.error}`);
            }
        } catch (err: unknown) {
            console.warn(`[MCP] Skipping MCP tool load: ${String(err)}`);
        }
    }

    const executionProfile = resolveExecutionProfileFromEnv(environmentProfile);
    const orchestrator = new Orchestrator(
        sessionId, activityBus, policyEngine, registry,
        { approvalQueue, approvalTimeoutMs: 30_000, executionProfile },
    );
    const workflowExecutor = new WorkflowExecutor();
    const dashboardActions = createDashboardActions(orchestrator, workflowExecutor, approvalQueue, sessionId);
    const dashboardService = new DashboardService(
        approvalQueue,
        activityBus,
        {
            sessionId,
            environmentProfile,
            mode: runtimeMode,
            startedAt,
        },
        chatSessionStore,
        dashboardActions,
        Number.isFinite(dashboardPort) ? dashboardPort : 7070,
        metricsCollector,
        retrievalDashboardStore,
        undefined,
        sqliteStore,
    );

    // Wire AgentPool — must happen after dashboardService (which owns LlmProviderManager)
    const agentPool = new AgentPool(dashboardService.getLlmDelegate());
    orchestrator.setAgentPool(agentPool);
    const selfReviewScheduler = new SelfReviewScheduler({
        activityBus,
        sessionId,
        environmentProfile,
        intervalsMs: {
            daily: resolveIntervalMs(process.env.PRISM_SELF_REVIEW_DAILY_MS, 24 * 60 * 60 * 1000),
            weekly: resolveIntervalMs(process.env.PRISM_SELF_REVIEW_WEEKLY_MS, 7 * 24 * 60 * 60 * 1000),
            monthly: resolveIntervalMs(process.env.PRISM_SELF_REVIEW_MONTHLY_MS, 30 * 24 * 60 * 60 * 1000),
        },
    });
    const selfReviewConfiguration = selfReviewScheduler.getConfiguration();
    dashboardService.start();

    console.log("=".repeat(60));
    console.log("  PRISM RUNTIME -- Session:", sessionId);
    console.log("  Environment profile:", environmentProfile);
    console.log("  Execution profile:", describeExecutionProfileResolution(executionProfile, environmentProfile));
    console.log("  Mode:", runtimeMode);
    console.log("  Dashboard:", `http://localhost:${dashboardPort}`);
    console.log(
        "  Self-review intervals:",
        `daily=${selfReviewConfiguration.intervalsMs.daily}ms weekly=${selfReviewConfiguration.intervalsMs.weekly}ms monthly=${selfReviewConfiguration.intervalsMs.monthly}ms`,
    );
    console.log("=".repeat(60));

    for (const warning of selfReviewConfiguration.warnings) {
        console.warn("[PRISM][self-review]", warning);
    }

    if (runtimeMode === "server") {
        selfReviewScheduler.runInitialPass();
        selfReviewScheduler.start();
        activityBus.emit({
            sessionId,
            layer: "causal",
            operation: "prism.server.started",
            status: "succeeded",
            details: {
                environmentProfile,
                dashboardPort,
                startedAt,
            },
        });

        console.log("\nPRISM server mode is running. Open the dashboard in your browser.");
        await waitForShutdown(async () => {
            selfReviewScheduler.stop();
            mcpAdapter.disconnectAll();
            sqliteStore.close();
            retrievalDashboardStore.close();
            sessionMemory.close();
            chatSessionStore.close();
            await dashboardService.stop();
        });
        return;
    }

    console.log("\n--- DEMO 1: Tier 1 autonomous (file_list) ---");
    await orchestrator.run({
        operation: "file_list",
        args: { path: "." },
        risk: "low",
        mutatesState: false,
    });

    console.log("\n--- DEMO 2: Tier 2 conditional (file_write) ---");
    await orchestrator.run({
        operation: "file_write",
        args: { path: "./prism-output/hello.txt", content: "PRISM Phase 1 operational\n" },
        risk: "medium",
        mutatesState: true,
        rollbackPlan: "delete prism-output/hello.txt",
    });

    console.log("\n--- DEMO 3: Tier 2 conditional (shell_exec) ---");
    await orchestrator.run({
        operation: "shell_exec",
        args: { command: "node --version", timeoutMs: 5000 },
        risk: "medium",
        mutatesState: false,
        rollbackPlan: "read-only command",
    });

    console.log("\n--- DEMO 4: Tier 3 approval-gated (file_write critical) ---");
    setTimeout(() => {
        const pending = approvalQueue.list();
        if (pending.length > 0) {
            console.log("[AUTO-DEMO] Approving id=" + pending[0]!.id);
            approvalQueue.approve(pending[0]!.id);
        }
    }, 2000);
    await orchestrator.run({
        operation: "file_write",
        args: { path: "./prism-output/critical.cfg", content: "PRISM_MODE=production\n" },
        risk: "high",
        mutatesState: true,
        rollbackPlan: "restore critical.cfg from git checkpoint",
    });

    console.log("\n--- DEMO 5: Tier 1 autonomous (semantic_query) ---");
    await orchestrator.run({
        operation: "semantic_query",
        args: { query: "approval file_write", limit: 3, sessionId },
        risk: "low",
        mutatesState: false,
    });

    console.log("\n--- DEMO 6: Tier 1 autonomous (memory_query mode=all) ---");
    await orchestrator.run({
        operation: "memory_query",
        args: { mode: "all", query: "approval file_write", limit: 3, sessionId },
        risk: "low",
        mutatesState: false,
    });

    console.log("\n--- DEMO 7: Multi-step workflow with fallbacks ---");
    const dag = workflowExecutor.createDAG(
        "Demo Workflow",
        [
            { id: "step1", operation: "file_list", args: { path: "." }, risk: "low", mutatesState: false },
            { id: "step2", operation: "memory_query", args: { mode: "episodic_recent", limit: 2 }, risk: "low", mutatesState: false },
        ],
        [],
    );
    await orchestrator.runWorkflow(dag);

    const events = activityBus.listEvents();
    const semanticMatches = semanticIndex.query("approval file_write", 3);
    const episodeSnapshot = episodicMemory.snapshot(8);
    const sessionSummary = sessionMemory.getSessionSummary(sessionId);
    const retrievalStats = metricsCollector.getStats(50);
    const retrievalDiagnostics = metricsCollector.getGrowthAndDriftDiagnostics(5, 0.12);
    const retrievalCohorts = metricsCollector.getCohortDashboard(50, 3, 1);
    retrievalDashboardStore.saveSnapshot(sessionId, retrievalCohorts);
    const recentCohortSnapshots = retrievalDashboardStore.getRecentSnapshots(3, sessionId);
    const cohortTrend = retrievalDashboardStore.getTrendReport(sessionId, 10, 3, {
        trendP95LatencyIncreaseMs: 80,
    });

    console.log("\n" + "=".repeat(60));
    console.log("  Activity events recorded : " + events.length);
    console.log("  Persisted to SQLite       : prism-activity.db");
    console.log("  Approval service          : " + `http://localhost:${dashboardPort}/pending`);
    console.log("  Episodic events buffered  : " + episodeSnapshot.count);
    console.log("  Episodic token estimate   : " + episodeSnapshot.estimatedTokens);
    console.log("  Semantic matches found    : " + semanticMatches.length);
    console.log("  Retrieval hit rate        : " + (retrievalStats.hitRate * 100).toFixed(1) + "%");
    console.log("  Retrieval coverage avg    : " + retrievalStats.avgCoverageScore.toFixed(2));
    console.log("  Retrieval novelty avg     : " + retrievalStats.avgNoveltyScore.toFixed(2));
    console.log("  Retrieval utility avg     : " + retrievalStats.avgUtilityScore.toFixed(2));
    console.log("  Retrieval avg latency     : " + retrievalStats.avgLatencyMs.toFixed(1) + "ms");
    console.log("  Retrieval p50 latency     : " + retrievalStats.p50LatencyMs.toFixed(1) + "ms");
    console.log("  Retrieval p95 latency     : " + retrievalStats.p95LatencyMs.toFixed(1) + "ms");
    console.log("  Retrieval p99 latency     : " + retrievalStats.p99LatencyMs.toFixed(1) + "ms");
    console.log("  Retrieval drift score     : " + retrievalDiagnostics.driftScore.toFixed(3));
    console.log("  Retrieval drift detected  : " + (retrievalDiagnostics.driftDetected ? "yes" : "no"));
    console.log("  Retrieval volume trend    : " + retrievalDiagnostics.queryVolumeTrend);
    console.log("  Cohort snapshots saved    : " + recentCohortSnapshots.length);
    if (sessionSummary) {
        console.log("  Session summary events    : " + sessionSummary.totalEvents);
        console.log("  Session summary failures  : " + sessionSummary.failures);
    }
    console.log("=".repeat(60));

    if (semanticMatches.length > 0) {
        console.log("\nTop semantic retrieval matches:");
        for (const match of semanticMatches) {
            console.log(`  - ${match.operation} [${match.layer}] score=${match.score.toFixed(2)}`);
        }
    }

    if (retrievalDiagnostics.alerts.length > 0) {
        console.log("\nRetrieval diagnostics alerts:");
        for (const alert of retrievalDiagnostics.alerts) {
            console.log(`  - ${alert}`);
        }
    }

    if (retrievalCohorts.cohorts.length > 0) {
        console.log("\nTop retrieval cohorts:");
        for (const cohort of retrievalCohorts.cohorts) {
            console.log(
                `  - ${cohort.cohortKey} count=${cohort.queryCount} ` +
                `hitRate=${(cohort.hitRate * 100).toFixed(1)}% utility=${cohort.avgUtilityScore.toFixed(2)} ` +
                `p95=${cohort.p95LatencyMs.toFixed(1)}ms`,
            );
        }
    }

    if (retrievalCohorts.alerts.length > 0) {
        console.log("\nRetrieval cohort alerts:");
        for (const alert of retrievalCohorts.alerts) {
            console.log(`  - ${alert}`);
        }
    }

    if (cohortTrend) {
        console.log("\nRetrieval cohort baseline comparison:");
        console.log(`  snapshots compared: ${cohortTrend.snapshotsCompared}`);
        for (const trend of cohortTrend.topChanges) {
            console.log(
                `  - ${trend.cohortKey} utilityΔ=${trend.utilityDelta.toFixed(2)} ` +
                `hitRateΔ=${(trend.hitRateDelta * 100).toFixed(1)}% ` +
                `p95Δ=${trend.p95LatencyDeltaMs.toFixed(1)}ms`,
            );
        }

        if (cohortTrend.alerts.length > 0) {
            console.log("\nRetrieval cohort trend alerts:");
            for (const alert of cohortTrend.alerts) {
                console.log(`  - ${alert}`);
            }
        }
    }

    sqliteStore.close();
    retrievalDashboardStore.close();
    sessionMemory.close();
    chatSessionStore.close();
    await dashboardService.stop();
}

function createDashboardActions(
    orchestrator: Orchestrator,
    workflowExecutor: WorkflowExecutor,
    approvalQueue: ApprovalQueue,
    sessionId: string,
): DashboardAction[] {
    let actionInFlight = false;

    const guarded = async (
        run: () => Promise<{ message: string; details?: Record<string, unknown> }>,
    ): Promise<{ message: string; details?: Record<string, unknown> }> => {
        if (actionInFlight) {
            throw new Error("Another action is already running. Please wait for completion.");
        }
        actionInFlight = true;
        try {
            return await run();
        } finally {
            actionInFlight = false;
        }
    };

    return [
        {
            name: "run_file_list",
            label: "Run file list demo",
            description: "Runs a low-risk autonomous file listing operation.",
            run: () => guarded(async () => {
                await orchestrator.run({
                    operation: "file_list",
                    args: { path: "." },
                    risk: "low",
                    mutatesState: false,
                });
                return { message: "file_list demo completed." };
            }),
        },
        {
            name: "run_approval_demo",
            label: "Queue approval-required action",
            description: "Submits a high-risk write operation that requires manual approve/deny.",
            run: () => guarded(async () => {
                await orchestrator.run({
                    operation: "file_write",
                    args: { path: "./prism-output/dashboard-critical.cfg", content: "DASHBOARD_TRIGGERED=true\n" },
                    risk: "high",
                    mutatesState: true,
                    rollbackPlan: "restore dashboard-critical.cfg from git checkpoint",
                });
                return {
                    message: "Approval-required action submitted.",
                    details: { pendingApprovals: approvalQueue.list().length },
                };
            }),
        },
        {
            name: "run_workflow_demo",
            label: "Run workflow demo",
            description: "Runs a two-step workflow (file list + episodic memory query).",
            run: () => guarded(async () => {
                const dag = workflowExecutor.createDAG(
                    "Dashboard Workflow",
                    [
                        { id: "step1", operation: "file_list", args: { path: "." }, risk: "low", mutatesState: false },
                        { id: "step2", operation: "memory_query", args: { mode: "episodic_recent", limit: 2, sessionId }, risk: "low", mutatesState: false },
                    ],
                    [],
                );
                await orchestrator.runWorkflow(dag);
                return { message: "Workflow demo completed." };
            }),
        },
    ];
}

function resolveRuntimeMode(rawMode?: string): "demo" | "server" {
    const normalized = (rawMode ?? "").trim().toLowerCase();
    if (normalized === "server" || normalized === "web") {
        return "server";
    }
    return "demo";
}

function resolveIntervalMs(rawValue: string | undefined, fallbackMs: number): number {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallbackMs;
    }

    const minimumMs = 60_000;
    return Math.max(minimumMs, Math.floor(parsed));
}

function waitForShutdown(cleanup: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
        let shuttingDown = false;

        const shutdown = (signal: string): void => {
            if (shuttingDown) {
                return;
            }
            shuttingDown = true;
            console.log(`\n[PRISM] Received ${signal}. Shutting down...`);
            void cleanup()
                .then(() => resolve())
                .catch((error) => reject(error));
        };

        process.once("SIGINT", () => shutdown("SIGINT"));
        process.once("SIGTERM", () => shutdown("SIGTERM"));
    });
}

main().catch((error: unknown) => {
    console.error("PRISM bootstrap failed:", error);
    process.exitCode = 1;
});
