import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sqlite3 from "sqlite3";
import { TerminalSessionAdapter } from "./adapters/application/terminal-session-adapter.js";
import { ContainerSandboxAdapter } from "./adapters/application/container-sandbox-adapter.js";
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
import { GmailOAuthAdapter } from "./adapters/application/email-oauth-adapter.js";
import { OutlookOAuthAdapter } from "./adapters/application/outlook-oauth-adapter.js";
import { createOAuthTokenStore } from "./core/operator/oauth-token-store.js";
import { MemoryQueryTool, SemanticQueryTool } from "./adapters/application/semantic-query-tool.js";
import { nexusBridgeTools } from "./adapters/application/nexus-bridge-tool.js";
import { ChatSessionStore } from "./core/operator/chat-session-store.js";
import { DashboardService, type DashboardAction } from "./core/operator/dashboard-service.js";
import { SelfReviewScheduler } from "./core/operator/self-review-scheduler.js";
import { UsageMeteringService } from "./core/operator/usage-metering-service.js";
import { McpClientAdapter } from "./adapters/protocol/mcp-client-tool.js";
import { getConsoleInterceptor } from "./core/logging/console-interceptor.js";
import { AgentPool } from "./core/agents/agent-pool.js";
import { AgentLifecycleManager } from "./core/agents/agent-lifecycle.js";
import { AgentTelemetryCollector } from "./core/agents/agent-telemetry-collector.js";
import { AgentRouter } from "./core/agents/agent-router.js";
import { SwarmCoordinator } from "./core/agents/swarm-coordinator.js";
import { DevIdentityProvider } from "./core/iam/dev-identity-provider.js";
import { TabSessionRegistry } from "./core/iam/tab-session-registry.js";
import { UniversalTelemetryAggregator } from "./core/observability/universal-telemetry-aggregator.js";
import { AutonomousAgentLoop } from "./core/runtime/autonomous-agent-loop.js";
import { AutonomousBrowserAgent } from "./core/runtime/autonomous-browser-agent.js";
import { AutonomousComputerAgent } from "./core/runtime/autonomous-computer-agent.js";
import { PrismCovenant } from "./core/governance/prism-covenant.js";
import type { DispatchTelemetryRecord, SubAgentResult } from "./core/agents/agent-types.js";
import {
    ensureWorkspaceStructure,
    resolveWorkspaceRoot,
    workspaceDbPath,
    workspacePath,
    workspaceConfigDir,
    workspaceArtifactsDir,
    detectLegacyPaths,
    seedDefaultCharacters,
} from "./core/config/workspace-resolver.js";

async function main(): Promise<void> {
    // Install the console interceptor BEFORE any startup logging so the
    // dashboard's Live Console panel captures every line — including the
    // earliest [PRISM][startup] warnings about JWT secrets, etc.
    const consoleInterceptor = getConsoleInterceptor();
    consoleInterceptor.install();

    const runtimeMode = resolveRuntimeMode(process.env.PRISM_MODE ?? process.argv[2]);
    const cliSetup = process.argv.includes("--setup");
    const dashboardPort = Number(process.env.PRISM_DASHBOARD_PORT ?? 7070);
    const environmentProfile = resolveEnvironmentProfile(
        process.env.PRISM_ENV_PROFILE ?? (process.env.CI ? "staging" : "dev"),
    );
    const retrievalAlertProfile = resolveRetrievalAlertProfile(environmentProfile);

    // Startup environment validation — fail fast in production, warn in dev.
    // Each FATAL condition refuses to boot when NODE_ENV=production.
    const isProduction = process.env.NODE_ENV === "production";
    const envWarnings: string[] = [];
    const envFatals: string[] = [];

    const jwtSecret = process.env.PRISM_JWT_SECRET ?? "";
    if (jwtSecret.length < 32) {
        if (isProduction) {
            envFatals.push(
                "PRISM_JWT_SECRET must be set to a string of at least 32 characters " +
                "(generate via: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")",
            );
        } else {
            // Dev convenience: auto-generate a persistent secret stored under
            // the workspace data dir so the warning does not fire on every
            // restart and so the same token survives across reboots.
            try {
                const dataDir = process.env.PRISM_DATA_DIR
                    ?? join(process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(), ".prism");
                mkdirSync(dataDir, { recursive: true });
                const secretPath = join(dataDir, ".prism-jwt-secret");
                let secret = "";
                if (existsSync(secretPath)) {
                    secret = readFileSync(secretPath, "utf8").trim();
                }
                if (secret.length < 32) {
                    secret = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
                    writeFileSync(secretPath, secret, { encoding: "utf8", mode: 0o600 });
                    console.warn(
                        `[PRISM][startup] PRISM_JWT_SECRET not set — generated a development ` +
                        `secret at ${secretPath} (mode 0600). Set PRISM_JWT_SECRET explicitly for ` +
                        `production deployments.`,
                    );
                }
                process.env.PRISM_JWT_SECRET = secret;
            } catch (err) {
                envWarnings.push(
                    "PRISM_JWT_SECRET not set and dev auto-generation failed " +
                    `(${(err as Error).message}) — authentication may be insecure`,
                );
            }
        }
    }

    if (process.env.PRISM_AUTH_DISABLED === "true") {
        const msg = "PRISM_AUTH_DISABLED=true disables dashboard authentication entirely";
        if (isProduction) envFatals.push(`${msg} — forbidden when NODE_ENV=production`);
        else envWarnings.push(`${msg} — only acceptable in development`);
    }

    if (isProduction && !process.env.PRISM_DATA_DIR) {
        envFatals.push(
            "PRISM_DATA_DIR must be set in production so SQLite databases, characters, " +
            "plugin packs, and audit logs are persistent across container restarts",
        );
    }

    if (!process.env.PRISM_DASHBOARD_PORT) {
        envWarnings.push("PRISM_DASHBOARD_PORT not set — defaulting to 7070");
    }

    for (const warn of envWarnings) {
        console.warn(`[PRISM][startup] WARN: ${warn}`);
    }

    if (envFatals.length > 0) {
        console.error("\n[PRISM][startup] FATAL: refusing to boot in production with the following issues:");
        for (const fatal of envFatals) {
            console.error(`  - ${fatal}`);
        }
        console.error(
            "\nSet NODE_ENV=development for local work, or fix the environment and retry. " +
            "See .env.example at the workspace root for documentation of every variable.",
        );
        process.exit(1);
    }

    // Initialize persistent workspace
    ensureWorkspaceStructure(environmentProfile);
    seedDefaultCharacters();
    const wsRoot = resolveWorkspaceRoot();
    const dbPath = workspaceDbPath();
    const legacy = detectLegacyPaths();
    if (legacy.found) {
        console.log(
            `[PRISM][workspace] Legacy CWD-relative paths detected: ${legacy.paths.join(", ")}. ` +
            `Workspace is now at: ${wsRoot}`,
        );
    }

    const sessionId = randomUUID();
    const activityBus = new ActivityBus();
    const sqliteStore = new SqliteActivityStore(dbPath);
    const episodicMemory = new EpisodicMemory(600);
    const metricsCollector = new RetrievalMetricsCollector(1000, 100, {
        ...withRetrievalAlertPolicyProfile(retrievalAlertProfile),
    });
    const semanticIndex = new SemanticMemoryIndex();
    const retrievalDashboardStore = new RetrievalDashboardStore(dbPath);
    const sessionMemory = new SessionMemoryStore(dbPath);
    const chatSessionStore = new ChatSessionStore(dbPath);
    const approvalQueue = new ApprovalQueue();
    const usageMeteringService = new UsageMeteringService(dbPath);
    const startedAt = new Date().toISOString();
    activityBus.subscribe(new ConsoleActivitySubscriber());
    activityBus.subscribe(sqliteStore);
    activityBus.subscribe(episodicMemory);
    activityBus.subscribe(semanticIndex);
    activityBus.subscribe(sessionMemory);

    // ── Phase A1: Dev Identity & Tab Session Bootstrap ────────────────────
    // Creates a persistent dev operator identity (CAC-compatible) and
    // initializes per-tab sessions for full traceability across all tabs.
    const stateDir = workspacePath("state");
    const devIdentity = new DevIdentityProvider(stateDir, sessionId, activityBus);
    const { operator: devOperator, agent: devAgent } = devIdentity.bootstrap();
    console.log(`[PRISM][identity] Dev operator: ${devOperator.displayName} <${devOperator.email}>`);
    console.log(`[PRISM][identity] Agent identity: ${devAgent.displayName} <${devAgent.email}>`);
    console.log(`[PRISM][identity] CAC fingerprint: ${devOperator.cacFingerprint}`);

    const tabSessionRegistry = new TabSessionRegistry(stateDir, sessionId, devOperator.operatorId, activityBus);
    const tabSessions = tabSessionRegistry.initializeAll();
    console.log(`[PRISM][identity] Initialized ${tabSessions.length} tab sessions`);

    // ── Phase A3: Universal Telemetry Aggregator ──────────────────────────
    // Central observability — all events from every source normalized into
    // a unified format piped to Logs & Debug tab.
    const telemetryAggregator = new UniversalTelemetryAggregator(10_000);
    activityBus.subscribe(telemetryAggregator);
    // Wire console interceptor lines to the telemetry aggregator
    consoleInterceptor.onLine((line) => telemetryAggregator.ingestConsoleLine(line));
    console.log(`[PRISM][telemetry] Universal telemetry aggregator active (10k buffer)`);

    // ── Phase A4: Prism Covenant ─────────────────────────────────────────
    // Immutable governance contract between agent and operator.
    // Ref: .github/PRISM_SACRED_COVENANT.md
    const covenant = new PrismCovenant(activityBus);
    console.log(`[PRISM][covenant] Sacred Covenant active (v${covenant.getStatus().version}, hash:${covenant.getStatus().hash})`);

    // ── Phase A2B: Specialized Autonomous Agents ─────────────────────────
    const autonomousBrowserAgent = new AutonomousBrowserAgent(activityBus);
    const autonomousComputerAgent = new AutonomousComputerAgent(activityBus);
    console.log(`[PRISM][autonomous] Browser + Computer agents initialized`);
    // ── Phase A2: Autonomous Agent Loop ──────────────────────────────────
    const policyEngine = new PolicyEngine();
    
    // Initialize OAuth adapters early for tool injection
    const oauthTokenStore = createOAuthTokenStore();
    const gmailOAuth = new GmailOAuthAdapter(oauthTokenStore);
    const outlookOAuth = new OutlookOAuthAdapter(oauthTokenStore);

    // Initialize system adapters — PTY terminal + container sandbox
    const adapterDb = new sqlite3.Database(dbPath);
    const executionProfile = resolveExecutionProfileFromEnv(environmentProfile);
    const terminalAdapter = new TerminalSessionAdapter(adapterDb, policyEngine, activityBus, executionProfile);
    const containerAdapter = new ContainerSandboxAdapter(adapterDb, policyEngine, activityBus, executionProfile);
    console.log(`[PRISM][adapters] TerminalSessionAdapter PTY init: pending (node-pty)`);
    console.log(`[PRISM][adapters] ContainerSandboxAdapter runtime: ${containerAdapter.getRuntimeBackend()}`);

    const registry = new ToolRegistry();
    for (const tool of builtinTools(gmailOAuth, outlookOAuth, terminalAdapter, containerAdapter)) {
        registry.register(tool);
    }
    registry.register(new SemanticQueryTool(semanticIndex, episodicMemory, sessionMemory, metricsCollector));
    registry.register(new MemoryQueryTool(semanticIndex, episodicMemory, sessionMemory, "memory_query", metricsCollector));
    for (const tool of nexusBridgeTools()) {
        registry.register(tool);
    }

    // Load MCP tools from workspace config or CWD fallback
    const mcpAdapter = new McpClientAdapter();
    const mcpSettingsPath = process.env.PRISM_MCP_SETTINGS
        ?? (existsSync(join(workspaceConfigDir(), "mcp-settings.json"))
            ? join(workspaceConfigDir(), "mcp-settings.json")
            : join(process.cwd(), ".mcp/mcp-settings.json"));
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

    const orchestrator = new Orchestrator(
        sessionId, activityBus, policyEngine, registry,
        { approvalQueue, approvalTimeoutMs: 30_000, executionProfile },
    );
    const workflowExecutor = new WorkflowExecutor();
    const demoHooksRef: { service: DashboardService | null } = { service: null };
    const dashboardActions = createDashboardActions(orchestrator, workflowExecutor, approvalQueue, sessionId, demoHooksRef, activityBus);
    const dashboardService = new DashboardService(
        approvalQueue,
        activityBus,
        {
            sessionId,
            environmentProfile,
            mode: runtimeMode,
            startedAt,
            executionProfileSegment: executionProfile.segment,
        },
        chatSessionStore,
        dashboardActions,
        Number.isFinite(dashboardPort) ? dashboardPort : 7070,
        metricsCollector,
        retrievalDashboardStore,
        undefined,
        sqliteStore,
        undefined,
        undefined, // sessionPackageExportDir
        registry,
        usageMeteringService,
        gmailOAuth,
        outlookOAuth,
        terminalAdapter,
        containerAdapter,
    );

    // Wire MCP adapter + console interceptor so /api/mcp/servers,
    // /api/debug/console, and the Guardian's mcp_health_recovery task work.
    dashboardService.setMcpAdapter(mcpAdapter);
    dashboardService.setConsoleInterceptor(consoleInterceptor);

    // ── Phase A2 (cont): Wire Autonomous Agent Loop ─────────────────────
    // Goal-driven autonomous execution with browser + computer + shell tools.
    // Uses the configured LLM provider and Guardian (llama.cpp) for reasoning.
    const autonomousLoop = new AutonomousAgentLoop(activityBus, registry, {
        maxConcurrentGoals: 1,
        defaultMaxActions: 100,
        defaultMaxDurationMs: 10 * 60 * 1000,
        guardianCheckIntervalActions: 5,
        actionsPerMinuteLimit: 30,
    });
    console.log(`[PRISM][autonomous] Autonomous agent loop initialized`);

    // Late-bind the dashboard service into the workflow-demo action's hooks so
    // the demo can broadcast a UI tour and fire real BUA/CUA probes.
    demoHooksRef.service = dashboardService;
    // Wire AgentPool — must happen after dashboardService (which owns LlmProviderManager)
    const llmDelegate = dashboardService.getLlmDelegate();
    const agentTelemetry = new AgentTelemetryCollector();
    const agentLifecycle = new AgentLifecycleManager({
        onSpawn: (inst) => {
            activityBus.emit({
                sessionId, layer: "agent", operation: "agent.spawned",
                status: "succeeded", details: { agentId: inst.agentId, role: inst.role, lifecycle: inst.lifecycle },
            });
        },
        onStop: (agentId) => {
            activityBus.emit({
                sessionId, layer: "agent", operation: "agent.stopped",
                status: "succeeded", details: { agentId },
            });
        },
        onPromote: (agentId, from, to) => {
            activityBus.emit({
                sessionId, layer: "agent", operation: "agent.promoted",
                status: "succeeded", details: { agentId, from, to },
            });
        },
        onReap: (agentId) => {
            activityBus.emit({
                sessionId, layer: "agent", operation: "agent.reaped",
                status: "succeeded", details: { agentId },
            });
        },
    });

    // Restore persisted agents from workspace
    try {
        const persistPath = workspacePath("state", "agents.json");
        const { readFileSync } = await import("node:fs");
        if (existsSync(persistPath)) {
            const persisted = JSON.parse(readFileSync(persistPath, "utf-8"));
            if (Array.isArray(persisted)) {
                agentLifecycle.restoreFromPersisted(persisted);
                console.log(`[PRISM][agents] Restored ${persisted.length} persisted agent(s)`);
            }
        }
    } catch {
        // No persisted agents or parse error — continue with defaults
    }

    // Sync lifecycle model overrides to LLM routing config
    const llmProviders = dashboardService.getLlmProviderManager();
    for (const inst of agentLifecycle.list()) {
        if (inst.modelOverride) {
            llmProviders.setAgentModelOverride(inst.agentId, inst.modelOverride.providerId, inst.modelOverride.model);
        }
    }

    const agentPool = new AgentPool(llmDelegate);

    // Register all lifecycle agents in the pool
    for (const inst of agentLifecycle.list()) {
        agentPool.register({ agentId: inst.agentId, role: inst.role, description: inst.description, systemContext: inst.systemContext });
    }

    // Wire dispatch hooks for lifecycle tracking and telemetry
    agentPool.setDispatchHooks(
        (agentId) => agentLifecycle.recordDispatch(agentId),
        (agentId, result: SubAgentResult) => {
            agentLifecycle.recordDispatchComplete(agentId);
            const inst = agentLifecycle.get(agentId);
            agentTelemetry.record({
                agentId,
                role: inst?.role ?? "chat",
                model: result.model ?? "unknown",
                providerId: result.routing?.providerId ?? "unknown",
                durationMs: result.durationMs,
                ok: result.ok,
                timestamp: Date.now(),
            });
        },
    );

    const swarmCoordinator = new SwarmCoordinator(agentPool, (swarm) => {
        activityBus.emit({
            sessionId, layer: "agent", operation: "swarm.updated",
            status: "succeeded", details: { swarmId: swarm.swarmId, state: swarm.state, topology: swarm.topology },
        });
    });

    const agentRouter = new AgentRouter(agentPool, llmDelegate);

    // Wire agent control into dashboard
    dashboardService.setAgentControl({
        lifecycle: agentLifecycle,
        telemetry: agentTelemetry,
        swarm: swarmCoordinator,
        pool: agentPool,
        router: agentRouter,
    });

    // Wire autonomous control surface into dashboard (Phase A)
    await dashboardService.setAutonomousControl({
        autonomousLoop,
        devIdentity,
        tabSessionRegistry,
        telemetryAggregator,
        covenant,
        browserAgent: autonomousBrowserAgent,
        computerAgent: autonomousComputerAgent,
    });

    // Start ephemeral agent reaper
    agentLifecycle.startReaper();

    orchestrator.setAgentPool(agentPool);
    const selfReviewScheduler = new SelfReviewScheduler({
        activityBus,
        sessionId,
        environmentProfile,
        outputDir: workspacePath("artifacts", "self-review"),
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
            // Emit shutdown event to all activity subscribers before stores close
            activityBus.emit({
                operation: "system.shutdown",
                status: "started",
                sessionId: "system",
                layer: "agent",
                details: {},
            });

            // Persist agent state before shutdown
            try {
                const { writeFileSync, mkdirSync } = await import("node:fs");
                const persistDir = workspacePath("state");
                mkdirSync(persistDir, { recursive: true });
                const persistPath = workspacePath("state", "agents.json");
                writeFileSync(persistPath, JSON.stringify(agentLifecycle.serializePersistent(), null, 2));
            } catch {
                // Best-effort persistence
            }
            agentLifecycle.stopReaper();
            selfReviewScheduler.stop();
            mcpAdapter.disconnectAll();
            sqliteStore.close();
            retrievalDashboardStore.close();
            sessionMemory.close();
            chatSessionStore.close();
            adapterDb.close();
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
    adapterDb.close();
    await dashboardService.stop();
}

function createDashboardActions(
    orchestrator: Orchestrator,
    workflowExecutor: WorkflowExecutor,
    approvalQueue: ApprovalQueue,
    sessionId: string,
    demoHooksRef: { service: DashboardService | null },
    activityBus: ActivityBus,
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
            description: "Visual UI tour + a 2-step DAG + a real (best-effort) browser-use and computer-use probe so the operator can watch PRISM operate itself.",
            run: () => guarded(async () => {
                const dag = workflowExecutor.createDAG(
                    "Dashboard Workflow",
                    [
                        { id: "step1", operation: "file_list", args: { path: "." }, risk: "low", mutatesState: false },
                        { id: "step2", operation: "memory_query", args: { mode: "episodic_recent", limit: 2, sessionId }, risk: "low", mutatesState: false },
                    ],
                    [],
                );

                // ── Cosmetic UI tour: walks every operator console tab so the user
                //    can literally watch PRISM cycle through Chat → Agentic → Computer
                //    → Browser → Logs while the underlying DAG + BUA + CUA run in
                //    parallel. Suppress with PRISM_DEMO_TOUR_DISABLED=1.
                const svc = demoHooksRef.service;
                const tour = svc
                    ? svc.broadcastUiTour([
                        { tabId: "chat", dwellMs: 600, message: "Workflow demo started" },
                        { tabId: "agentic", anchor: "guardian-status", dwellMs: 1500, message: "Guardian observing the run" },
                        { tabId: "computer", dwellMs: 1500, message: "Computer-use probe — capturing a screengrab" },
                        { tabId: "browser", dwellMs: 1800, message: "Browser-use probe — launching a headless session" },
                        { tabId: "logs", anchor: "actions", dwellMs: 1500, message: "Quick Actions running" },
                        { tabId: "logs", anchor: "action-history", dwellMs: 1500, message: "Action recorded in history" },
                        { tabId: "chat", dwellMs: 200, message: "Workflow demo complete" },
                    ])
                    : Promise.resolve();

                // ── Real CUA probe: take a single framebuffer screengrab. Best-effort,
                //    fails gracefully on headless servers / restricted environments.
                const cuaProbe = (async () => {
                    if (!svc) return;
                    try {
                        const fb = svc.getFramebufferCapture();
                        const result = await fb.captureSingle();
                        activityBus.emit({
                            sessionId, layer: "tool_execution", operation: "cua.screengrab",
                            status: "succeeded",
                            details: { source: "workflow_demo", path: (result as Record<string, unknown>)?.path ?? null },
                        });
                    } catch (err) {
                        activityBus.emit({
                            sessionId, layer: "tool_execution", operation: "cua.screengrab",
                            status: "failed",
                            details: { source: "workflow_demo", error: String(err) },
                        });
                    }
                })();

                // ── Real BUA probe: launch a headless browser, navigate to about:blank,
                //    take a screenshot, close. Best-effort — fails gracefully when no
                //    Chromium is available (e.g. fresh Windows dev box without Playwright).
                const buaProbe = (async () => {
                    if (!svc) return;
                    try {
                        const reg = svc.getToolRegistry();
                        const tool = reg ? (reg.get("browser_control") as unknown as { getManager?: () => { launch: (o: Record<string, unknown>) => Promise<{ id: string }>; navigate: (id: string, url: string) => Promise<unknown>; screenshot: (id: string) => Promise<unknown>; closeSession: (id: string) => Promise<void>; } } | null) : null;
                        const mgr = tool?.getManager?.();
                        if (!mgr) {
                            activityBus.emit({
                                sessionId, layer: "tool_execution", operation: "bua.probe",
                                status: "failed",
                                details: { source: "workflow_demo", error: "browser_control tool not available" },
                            });
                            return;
                        }
                        const session = await mgr.launch({ headless: true });
                        try {
                            await mgr.navigate(session.id, "about:blank");
                            await mgr.screenshot(session.id);
                            activityBus.emit({
                                sessionId, layer: "tool_execution", operation: "bua.probe",
                                status: "succeeded",
                                details: { source: "workflow_demo", url: "about:blank", sessionId: session.id },
                            });
                        } finally {
                            try { await mgr.closeSession(session.id); } catch { /* swallow close errors */ }
                        }
                    } catch (err) {
                        activityBus.emit({
                            sessionId, layer: "tool_execution", operation: "bua.probe",
                            status: "failed",
                            details: { source: "workflow_demo", error: String(err) },
                        });
                    }
                })();

                // Run the underlying DAG concurrently with the cosmetic tour and the
                // BUA/CUA probes. The DAG is the substantive workload; the others are
                // observable side-quests that surface in Recent Action History.
                const [, , , ] = await Promise.all([
                    orchestrator.runWorkflow(dag),
                    tour,
                    cuaProbe,
                    buaProbe,
                ]);

                return { message: "Workflow demo completed (DAG + UI tour + BUA + CUA)." };
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
