/**
 * PRISM Bootstrap — Server Mode
 *
 * Handles server-mode lifecycle: readiness checks, self-review scheduler,
 * setup wizard auto-open, and graceful shutdown with resource cleanup.
 *
 * Phase R (Readiness) — Audit remediation item R2a (continued decomposition).
 */

import { ActivityBus } from "../core/activity/bus.js";
import type { AppContext } from "./context.js";
import { waitForShutdown } from "./shutdown.js";
import { workspacePath } from "../core/config/workspace-resolver.js";
import type { McpClientAdapter } from "../adapters/protocol/mcp-client-tool.js";

export interface ServerModeDeps {
    activityBus: ActivityBus;
    sessionId: string;
    dashboardPort: number;
    environmentProfile: string;
    startedAt: string;
    cliSetup: boolean;
    mcpAdapter: McpClientAdapter;
}

/**
 * Run server mode: start the self-review scheduler, emit the server.started
 * event, auto-open setup wizard if requested, and block until SIGTERM/SIGINT.
 */
export async function runServerMode(ctx: AppContext): Promise<void> {
    const {
        sessionId,
        dashboardPort,
        environmentProfile,
        startedAt,
        cliSetup,
        activityBus,
        mcpAdapter,
        selfReviewScheduler,
        agentLifecycle,
        dashboardService,
    } = ctx;

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

    // Auto-open setup wizard when --setup flag is passed
    if (cliSetup) {
        const setupUrl = `http://localhost:${dashboardPort}/setup`;
        console.log(`[PRISM] --setup flag detected, opening wizard: ${setupUrl}`);
        import("node:child_process").then(({ exec }) => {
            const cmd = process.platform === "win32" ? `start "" "${setupUrl}"`
                : process.platform === "darwin" ? `open "${setupUrl}"`
                    : `xdg-open "${setupUrl}"`;
            exec(cmd, () => {/* best-effort */ });
        }).catch(() => {/* ignore */ });
    }

    await waitForShutdown(async () => {
        console.log("[PRISM][system] [INFO] Commencing graceful system shutdown sequence...");

        activityBus.emit({
            operation: "system.shutdown",
            status: "started",
            sessionId: "system",
            layer: "agent",
            details: {},
        });

        // Persist agent state before shutdown
        console.log("[PRISM][system] [TRACE] Persisting agent lifecycle states to state/agents.json...");
        try {
            const { writeFileSync, mkdirSync } = await import("node:fs");
            const persistDir = workspacePath("state");
            mkdirSync(persistDir, { recursive: true });
            const persistPath = workspacePath("state", "agents.json");
            writeFileSync(persistPath, JSON.stringify(agentLifecycle.serializePersistent(), null, 2));
            console.log("[PRISM][system] [TRACE] Agent states persisted successfully.");
        } catch (err) {
            console.warn("[PRISM][system] [WARN] Best-effort agent state persistence failed:", err);
        }

        console.log("[PRISM][system] [TRACE] Deactivating agent reapers and schedulers...");
        agentLifecycle.stopReaper();
        selfReviewScheduler.stop();

        console.log("[PRISM][system] [TRACE] Disconnecting all active MCP client interfaces...");
        mcpAdapter.disconnectAll();

        console.log("[PRISM][system] [TRACE] Flushing and closing persistent databases...");
        ctx.sqliteStore.close();
        ctx.retrievalDashboardStore.close();
        ctx.sessionMemory.close();
        ctx.chatSessionStore.close();
        ctx.adapterDb.close();
        console.log("[PRISM][system] [TRACE] SQLite stores closed.");

        console.log("[PRISM][system] [TRACE] Terminating operator console HTTP/WS dashboard service...");
        ctx.dashboardService.stop();
        console.log("[PRISM][system] [INFO] Graceful shutdown process complete. System offline.");
    });
}

/**
 * Run demo mode: execute a series of demonstration operations against the
 * orchestrator to exercise all governance tiers.
 */
export async function runDemoMode(ctx: AppContext): Promise<void> {
    const { orchestrator, activityBus, sessionId, workflowExecutor, semanticIndex, episodicMemory, sessionMemory, metricsCollector, retrievalDashboardStore, dashboardPort, approvalQueue } = ctx;

    console.log("\n--- DEMO 1: Tier 1 autonomous (file_list) ---");
    await orchestrator.run({
        operation: "file_list", args: { path: "." }, risk: "low", mutatesState: false,
    });

    console.log("\n--- DEMO 2: Tier 2 conditional (file_write) ---");
    await orchestrator.run({
        operation: "file_write",
        args: { path: "./prism-output/hello.txt", content: "PRISM Phase 1 operational\n" },
        risk: "medium", mutatesState: true,
        rollbackPlan: "delete prism-output/hello.txt",
    });

    console.log("\n--- DEMO 3: Tier 2 conditional (shell_exec) ---");
    await orchestrator.run({
        operation: "shell_exec", args: { command: "node --version", timeoutMs: 5000 },
        risk: "medium", mutatesState: false, rollbackPlan: "read-only command",
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
        risk: "high", mutatesState: true,
        rollbackPlan: "restore critical.cfg from git checkpoint",
    });

    console.log("\n--- DEMO 5: Tier 1 autonomous (semantic_query) ---");
    await orchestrator.run({
        operation: "semantic_query", args: { query: "approval file_write", limit: 3, sessionId },
        risk: "low", mutatesState: false,
    });

    console.log("\n--- DEMO 6: Tier 1 autonomous (memory_query mode=all) ---");
    await orchestrator.run({
        operation: "memory_query", args: { mode: "all", query: "approval file_write", limit: 3, sessionId },
        risk: "low", mutatesState: false,
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

    // Diagnostics report
    const events = activityBus.listEvents();
    const semanticMatches = semanticIndex.query("approval file_write", 3);
    const episodeSnapshot = episodicMemory.snapshot(8);
    const sessionSummary = (ctx as any).sessionMemory.getSessionSummary?.(sessionId);
    const retrievalStats = metricsCollector.getStats(50);
    const retrievalDiagnostics = metricsCollector.getGrowthAndDriftDiagnostics(5, 0.12);
    const retrievalCohorts = metricsCollector.getCohortDashboard(50, 3, 1);
    (ctx as any).retrievalDashboardStore.saveSnapshot?.(sessionId, retrievalCohorts);
    const cohortTrend = (ctx as any).retrievalDashboardStore.getTrendReport?.(sessionId, 10, 3, { trendP95LatencyIncreaseMs: 80 });

    console.log("\n" + "=".repeat(60));
    console.log("  Activity events recorded : " + events.length);
    console.log("  Persisted to SQLite       : prism-activity.db");
    console.log("  Approval service          : " + `http://localhost:${dashboardPort}/pending`);
    console.log("  Episodic events buffered  : " + episodeSnapshot.count);
    console.log("  Semantic matches found    : " + semanticMatches.length);
    console.log("  Retrieval hit rate        : " + (retrievalStats.hitRate * 100).toFixed(1) + "%");
    console.log("  Retrieval coverage avg    : " + retrievalStats.avgCoverageScore.toFixed(2));
    console.log("  Retrieval novelty avg     : " + retrievalStats.avgNoveltyScore.toFixed(2));
    console.log("=".repeat(60));

    // Cleanup
    ctx.sqliteStore.close();
    ctx.retrievalDashboardStore.close();
    ctx.sessionMemory.close();
    ctx.chatSessionStore.close();
    ctx.adapterDb.close();
    await ctx.dashboardService.stop();
}