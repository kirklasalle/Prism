import { randomBytes, randomUUID } from "node:crypto";
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
    readPreferences,
} from "./core/config/workspace-resolver.js";
import { resolveProfile } from "./core/operator/model-capability-matrix.js";
import {
    validateEnvironment,
    printEnvValidation,
    resolveRuntimeMode,
    resolveDashboardPort,
    resolveIntervalMs,
    ensureEnvFile,
} from "./bootstrap/environment.js";
import { waitForShutdown } from "./bootstrap/shutdown.js";
import { createDashboardActions } from "./bootstrap/dashboard-actions.js";
import { runServerMode, runDemoMode } from "./bootstrap/server-mode.js";
import type { AppContext } from "./bootstrap/context.js";
import { GuardianAgent } from "./core/agents/guardian-agent.js";
import { SkillsEngine } from "./core/skills/skills-engine.js";
import { TabToolAdapter } from "./core/skills/tab-tool-adapter.js";
import { SkillsDbAdapter } from "./core/skills/db-adapter.js";

async function main(): Promise<void> {
    // Auto-create .env from .env.example on first run
    ensureEnvFile();

    // Assign mock credentials in dev mode if they are not configured, so OAuth is connectable
    if (process.env.NODE_ENV !== "production") {
        if (!process.env.PRISM_GMAIL_CLIENT_ID) {
            process.env.PRISM_GMAIL_CLIENT_ID = "mock_gmail_client_id";
        }
        if (!process.env.PRISM_GMAIL_CLIENT_SECRET) {
            process.env.PRISM_GMAIL_CLIENT_SECRET = "mock_gmail_client_secret";
        }
        if (!process.env.PRISM_OUTLOOK_CLIENT_ID) {
            process.env.PRISM_OUTLOOK_CLIENT_ID = "mock_outlook_client_id";
        }
    }

    // Install the console interceptor BEFORE any startup logging so the
    // dashboard's Live Console panel captures every line — including the
    // earliest [PRISM][startup] warnings about JWT secrets, etc.
    const consoleInterceptor = getConsoleInterceptor();
    consoleInterceptor.install();

    const runtimeMode = resolveRuntimeMode(process.env.PRISM_MODE ?? process.argv[2]);
    const cliSetup = process.argv.includes("--setup");
    const dashboardPort = resolveDashboardPort(process.env.PRISM_DASHBOARD_PORT);
    const environmentProfile = resolveEnvironmentProfile(
        process.env.PRISM_ENV_PROFILE ?? (process.env.CI ? "staging" : "dev"),
    );
    const retrievalAlertProfile = resolveRetrievalAlertProfile(environmentProfile);

    // ── Environment Validation ────────────────────────────────────────────
    const { isProduction, warnings, fatals } = validateEnvironment();
    printEnvValidation(warnings, fatals, isProduction);

    // Initialize persistent workspace
    ensureWorkspaceStructure(environmentProfile);
    seedDefaultCharacters();

    // Load and apply powerMode preference early at startup to determine baseMode.
    // Base Mode defaults to off unless a low-end local model (tier <= 2) is actually running.
    try {
        const prefs = readPreferences();
        const powerMode = prefs?.powerMode || "adaptive";
        let isAuto = false;
        let targetBaseMode = false;

        if (powerMode === "adaptive") {
            isAuto = true;
            process.env.PRISM_BASE_MODE_AUTO = "true";
            
            // Resolve configured provider / model from prefs or env
            const providerId = prefs?.activeLlmProviderId || (process.env.PRISM_LLM_PROVIDER ?? "").trim().toLowerCase();
            const activeModel = prefs?.activeLlmModel || process.env.PRISM_LLM_MODEL || null;
            
            if (activeModel) {
                const profile = resolveProfile(activeModel);
                targetBaseMode = profile.locality === "local" && profile.tier <= 2;
            } else {
                targetBaseMode = false;
            }
        } else {
            isAuto = false;
            process.env.PRISM_BASE_MODE_AUTO = "false";
            targetBaseMode = powerMode === "eco";
        }

        process.env.PRISM_BASE_MODE = targetBaseMode ? "true" : "false";
        console.log(`[PRISM][startup] Early hydrated powerMode preference: '${powerMode}' -> baseMode=${targetBaseMode} (auto=${isAuto})`);
    } catch (err) {
        console.warn("[PRISM][startup] Failed to early hydrate powerMode preference:", err);
    }

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

    if (process.env.PRISM_BASE_MODE === "true") {
        console.log(`\n[PRISM][startup] ======================================================`);
        console.log(`[PRISM][startup] ACTIVE CONSTRAINT PARADIGM ENGAGED: Base Mode initialized.`);
        console.log(`[PRISM][startup] Optimizing GGUF and task scheduling for GTX 1050 Ti & Core i5 Haswell.`);
        console.log(`[PRISM][startup] ======================================================\n`);
    }

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

    const tabToolAdapter = new TabToolAdapter(registry, consoleInterceptor);
    registry.register(tabToolAdapter);

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
    let resolveDashboardService: ((svc: DashboardService) => void) | null = null;
    const dashboardServiceReady = new Promise<DashboardService>((resolve) => {
        resolveDashboardService = resolve;
    });
    const dashboardActions = createDashboardActions(orchestrator, workflowExecutor, approvalQueue, sessionId, dashboardServiceReady, activityBus);
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
    autonomousLoop.setUsageMetering(usageMeteringService);
    console.log(`[PRISM][autonomous] Autonomous agent loop initialized`);

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
    for (const inst of agentLifecycle.list()) {
        if (inst.modelOverride) {
            dashboardService.getLlmProviders().setAgentModelOverride(inst.agentId, inst.modelOverride.providerId, inst.modelOverride.model);
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

    // ── Phase A2 (cont): Guardian Agent & Skills Engine ───────────────────
    // Guardian is the permanent Custodian agent (llama.cpp) that executes
    // custodian skills and supports the CAC Character.
    const guardianAgent = dashboardService.getGuardianAgent();
    console.log(`[PRISM][guardian] Guardian agent initialized`);

    // ── Skills Engine — CAC-gated skill execution ────────────────────────
    // Skills are workflows composed of tools. The SkillsEngine enforces
    // CAC permission checks before executing any skill step.
    const skillsEngine = dashboardService.getSkillsEngine();
    console.log(`[PRISM][skills] Skills engine initialized`);

    // Late-bind the dashboard service into the workflow-demo action's hooks so
    // the demo can broadcast a UI tour and fire real BUA/CUA probes.
    resolveDashboardService!(dashboardService);
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

    // ── Build AppContext for mode dispatch ────────────────────────────────────
    const ctx: AppContext = {
        sessionId,
        runtimeMode,
        cliSetup,
        dashboardPort,
        environmentProfile,
        startedAt,
        executionProfile,
        consoleInterceptor,
        activityBus,
        sqliteStore,
        approvalQueue,
        episodicMemory,
        metricsCollector,
        semanticIndex,
        retrievalDashboardStore,
        sessionMemory,
        chatSessionStore,
        usageMeteringService,
        gmailOAuth,
        outlookOAuth,
        adapterDb,
        terminalAdapter,
        containerAdapter,
        registry,
        mcpAdapter,
        policyEngine,
        orchestrator,
        workflowExecutor,
        devIdentity,
        tabSessionRegistry,
        telemetryAggregator,
        covenant,
        autonomousLoop,
        autonomousBrowserAgent,
        autonomousComputerAgent,
        llmDelegate,
        agentTelemetry,
        agentLifecycle,
        agentPool,
        swarmCoordinator,
        agentRouter,
        dashboardService,
        selfReviewScheduler,
        guardianAgent,
        skillsEngine,
    };

    if (runtimeMode === "server") {
        await runServerMode(ctx);
        return;
    }

    await runDemoMode(ctx);
}

main().catch((error: unknown) => {
    console.error("PRISM bootstrap failed:", error);
    process.exitCode = 1;
});
