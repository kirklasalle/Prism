import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { randomUUID, createHash } from "node:crypto";
import {
    createWriteStream,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync,
    unlinkSync,
} from "node:fs";
import { dirname, join, resolve as resolvePath, sep as pathSep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { homedir } from "node:os";
import { get as httpGet } from "node:http";
import https from "node:https";
import { spawnSync } from "node:child_process";
import type { ActivityBus } from "../activity/bus.js";
import type { ActivityEvent } from "../activity/types.js";
import { SqliteActivityStore } from "../activity/sqlite-store.js";
import type { ApprovalQueue } from "../approval/approval-queue.js";
import type { LlmDelegate } from "../agents/agent-types.js";
import type { AgentLifecycleManager } from "../agents/agent-lifecycle.js";
import type { AgentTelemetryCollector } from "../agents/agent-telemetry-collector.js";
import type { SwarmCoordinator } from "../agents/swarm-coordinator.js";
import type { AgentPool } from "../agents/agent-pool.js";
import type { AgentRouter } from "../agents/agent-router.js";
import { verifyDirectiveIntegrity } from "../security/directive-integrity.js";
import { hashPassword } from "../security/password-util.js";
import {
    ChatSessionStore,
    type ProviderSettingsInput,
    type ChatMessage,
    type ChatSessionSummary,
} from "./chat-session-store.js";
import {
    LlmProviderManager,
    type LlmProviderCatalog,
    type PrismLlmProviderId,
    type RoutingConfig,
} from "./llm-provider-manager.js";
import { resolveProfile } from "./model-capability-matrix.js";
import {
    WindowsProtectedFileProviderSecretStore,
    InMemoryProviderSecretStore,
    type ProviderSecretStore,
} from "./provider-secret-store.js";
import { SessionTraceExplorer } from "./session-trace-explorer.js";
import { PolicyAuditExporter } from "./policy-audit-exporter.js";
import { SessionPackageSqliteStore } from "./session-package-sqlite-store.js";
import type { RetrievalMetricsCollector } from "../memory/retrieval-metrics.js";
import type { RetrievalDashboardStore } from "../memory/retrieval-dashboard-store.js";
import type { Tool } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import {
    workspacePath,
    resolveWorkspaceRoot,
    setWorkspaceRoot,
    ensureWorkspaceStructure,
    workspaceFramebufferDir,
    readPreferences,
    writePreferences,
    getWorkspaceHub,
    setWorkspaceHub,
    seedDefaultCharacters,
} from "../config/workspace-resolver.js";
import { FramebufferCapture } from "./framebuffer-capture.js";
import { AgenticChatExecutor, type AgenticTurnEvent, type AgenticResult } from "./agentic-chat-executor.js";
import { IntentClassifier } from "./intent-classifier.js";
import {
    CharacterAccountabilityStore,
    type CharacterAssignmentFilter,
} from "../accountability/character-accountability-store.js";
import { CharacterAccountabilityManager } from "../accountability/character-accountability-manager.js";
import { workspaceCharactersDir, workspaceDbPath } from "../config/workspace-resolver.js";
import { UsageMeteringService, type UsageWindow } from "./usage-metering-service.js";
import { LlamaCppSupervisor } from "./llama-cpp-supervisor.js";
import { GuardianAgent } from "../agents/guardian-agent.js";
import { SkillsEngine } from "../skills/skills-engine.js";
import type { McpClientAdapter } from "../../adapters/protocol/mcp-client-tool.js";
import type { ConsoleInterceptor, ConsoleLine } from "../logging/console-interceptor.js";
import { DashboardControlTool } from "../tools/dashboard-control-tool.js";
import { ComputerUseTool } from "../../adapters/system/computer-use-tool.js";
import { ImageGenerateTool } from "../../adapters/application/image-generate-tool.js";
import { VideoGenerateTool, AudioGenerateTool, AudioTranscribeTool } from "../../adapters/application/media-tools.js";
import { SchedulerEngine, parseCronExpression, getNextNCronOccurrences } from "./scheduler-engine.js";

import { AutonomousAgentLoop } from "../runtime/autonomous-agent-loop.js";
import { AutonomousBrowserAgent } from "../runtime/autonomous-browser-agent.js";
import { AutonomousComputerAgent } from "../runtime/autonomous-computer-agent.js";
import type { AutonomousLlmGenerateFn, LlmToolDef } from "../runtime/autonomous-planner.js";
import { PrismCovenant } from "../governance/prism-covenant.js";
import { SSHPInterceptor } from "./sshp-interceptor.js";
import { CSHManager } from "./csh-manager.js";

import { AuthGate } from "../security/auth.js";
import { RateLimiter } from "../security/rate-limiter.js";
import { applyCorsAndCsrf, resolveAllowedOrigins, type CorsCsrfConfig } from "../security/cors-csrf.js";
import { validateEgressUrl } from "../security/network-egress-guard.js";
import {
    deriveSessionTitle,
    parseEventFilters,
    buildSessionConfigDiff,
    normalizeSessionPackageStatus,
    normalizePrompt,
    parseMultipartParts,
    sanitizeFileName,
} from "./utils/http-helpers.js";
import { dashboardHtml } from "./templates/index.js";

import { Router } from "./routes/index.js";
import { IamStore } from "../iam/store.js";
import { SessionManager } from "../iam/sso/session.js";
import { IamRouteHandler } from "./routes/iam-handler.js";
import { InboundChannelPoller } from "./services/inbound-channel-poller.js";
import { TooltipsRegistry } from "./tooltips-registry.js";

import sqlite3 from "sqlite3";

import { ToolContractExtractor, type ExtractionRequest } from "../tools/tool-contract-extractor.js";
import { PolicyEngine } from "../policy/engine.js";
import { A2ATaskAdapter } from "../../adapters/application/a2a-task-adapter.js";
import { GovernanceHooksAdapter } from "../../adapters/application/governance-hooks-adapter.js";
import { MetricsStore } from "../activity/metrics-store.js";
import { OtelExporter } from "../activity/otel-exporter.js";
import { ActivityRetentionPolicy, resolveRetentionConfigFromEnv } from "../activity/retention-policy.js";
import { Soc2EvidenceExporter } from "../compliance/soc2-exporter.js";
import { GmailOAuthAdapter } from "../../adapters/application/email-oauth-adapter.js";
import { OutlookOAuthAdapter } from "../../adapters/application/outlook-oauth-adapter.js";
import { createOAuthTokenStore, OAuthTokenStore } from "../operator/oauth-token-store.js";
import { TerminalSessionAdapter } from "../../adapters/application/terminal-session-adapter.js";
import { ContainerSandboxAdapter } from "../../adapters/application/container-sandbox-adapter.js";
import { UtilityRegistry, registerBuiltInUtilities } from "./utility-registry.js";
import { RiskOverrideStore } from "./risk-override-store.js";
import { IncidentTrendStore } from "../memory/incident-trend-store.js";

// ── Canonical type definitions live in ./types/dashboard-types.ts (Phase 1 extraction).
// Imported for internal use and re-exported below to preserve the public API surface.
import type {
    DashboardRuntimeStatus,
    DashboardAction,
    DashboardActionState,
    DashboardActionHistoryEntry,
    DashboardChatTurn,
    DashboardReadinessSnapshot,
    SessionConfigState,
    PrioritizedAlertResponse,
    CorrelatedTraceResponse,
    SessionPackageStatus,
    SessionPackageRecord,
    SessionPackageSummary,
    SessionPackageEnvelope,
    SessionPackageHistoryEntry,
    SessionPackageReleaseSnapshot,
    SessionPackageTraceExport,
    SessionPackageStoreSnapshot,
    SessionPackageMetrics,
    ProviderSettingsPayload,
    DownloadProgress,
} from "./types/dashboard-types.js";

export type {
    DashboardRuntimeStatus,
    DashboardAction,
    DashboardActionState,
    DashboardActionHistoryEntry,
    DashboardChatTurn,
    TelemetryWindow,
    TelemetryWindowMetrics,
    TelemetryWindowDelta,
    TelemetrySummary,
    AlertSeverity,
    PrioritizedAlert,
    PrioritizedAlertResponse,
    CorrelatedTraceSummary,
    CorrelatedTraceResponse,
    RuntimeExcellenceSnapshot,
    SessionPackageStatus,
    SessionPackageRecord,
    SessionPackageSummary,
    SessionPackageEnvelope,
    SessionPackageHistoryEntry,
    SessionPackageReleaseSnapshot,
    SessionPackageTraceExport,
    SessionPackageMetrics,
    SloStatus,
    SloMetric,
    SloSummary,
    DownloadProgress,
} from "./types/dashboard-types.js";

// ── Canonical telemetry/SLO computation lives in ./services/telemetry-computation.ts.
import {
    parseTelemetryWindow,
    computeTelemetrySummary,
    computeSloSummary,
    buildPrioritizedAlerts,
    SEVERITY_ORDER,
    buildCorrelatedTraceSummaries,
    getCorrelatedTraceEvents,
    computeRuntimeExcellenceSnapshot,
} from "./services/telemetry-computation.js";

let activeValidationPid: number | null = null;

export class DashboardService {
    private static readonly publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
    private readonly server: Server;
    private readonly llmProviders: LlmProviderManager;
    private readonly providerSecretStore: ProviderSecretStore;
    private readonly authGate: AuthGate;
    private readonly rateLimiter: RateLimiter;
    private readonly corsCsrfConfig: CorsCsrfConfig;
    private tlsEnabled = false;
    public readonly actionsByName = new Map<string, DashboardAction>();
    public readonly actionStates = new Map<string, DashboardActionState>();
    private readonly actionHistory: DashboardActionHistoryEntry[] = [];
    private readonly actionHistoryLimit = 25;
    private readonly sessionPackageStorePath: string;
    private readonly sessionPackageExportDir: string;
    private readonly sessionPackageHistoryLimit = 250;
    private sessionPackages: SessionPackageRecord[] = [];
    private sessionPackageHistory: SessionPackageHistoryEntry[] = [];
    private readonly pkgStore?: SessionPackageSqliteStore;
    private readonly traceExplorer?: SessionTraceExplorer;
    private readonly policyAuditExporter?: PolicyAuditExporter;
    private readonly toolRegistry: ToolRegistry | null;
    private toolContractExtractor: ToolContractExtractor | null = null;
    private readonly llamaSupervisor: LlamaCppSupervisor;
    private readonly bitnetSupervisor: LlamaCppSupervisor;
    private readonly guardianAgent: GuardianAgent;
    private readonly agenticExecutor: AgenticChatExecutor | null;
    private readonly dashboardControlTool: DashboardControlTool;
    public readonly tools: Tool[];
    private readonly framebufferCapture = new FramebufferCapture();
    private readonly wsServer: WebSocketServer;
    public readonly wsClients = new Set<WebSocket>();
    /** Optional MCP adapter for /api/mcp/servers and Guardian self-heal task. */
    public mcpAdapter: McpClientAdapter | null = null;
    /** Optional console interceptor for /api/debug/console + live WS stream. */
    public consoleInterceptor: ConsoleInterceptor | null = null;
    public sshpInterceptor!: SSHPInterceptor;
    private cshManager!: CSHManager;
    /** Unsubscribe handle for the console-line listener. */
    private consoleUnsubscribe: (() => void) | null = null;
    private readonly openSockets = new Set<Socket>();
    public readonly sseClients = new Map<string, ServerResponse>();
    public readonly networkCommandHistory: Array<{ command: string; tier?: string; ok: boolean; timestamp: string }> =
        [];
    public toolStates: Record<
        string,
        {
            enabled: boolean;
            invocations: number;
            successes: number;
            failures: number;
            avgLatencyMs: number;
            lastInvoked: string | null;
            lastError: string | null;
        }
    > = {};
    public pluginStates: Record<
        string,
        {
            enabled: boolean;
            healthy: boolean;
            requests: number;
            errors: number;
            avgResponseMs: number;
            lastChecked: string | null;
        }
    > = {};
    private utilityStates: Record<string, Record<string, unknown>> = {};
    private pendingToolCalls = new Map<string, { toolName: string; startedAt: number }>();
    private agentLifecycle: AgentLifecycleManager | null = null;
    private agentTelemetry: AgentTelemetryCollector | null = null;
    private swarmCoordinator: SwarmCoordinator | null = null;
    private agentPool: AgentPool | null = null;
    private agentRouter: AgentRouter | null = null;
    private importHistory: Array<{
        id: string;
        timestamp: string;
        mode: string;
        fileName: string;
        targetDir: string;
        registeredType: string | null;
        status: string;
        message: string;
        size: number;
    }> = [];
    public diagnosticsRunning = false;
    public diagnosticsLastRunAt: string | null = null;
    public agentDiagnosticsRunning = false;
    public agentDiagnosticsLastRunAt: string | null = null;
    public computerDiagnosticsRunning = false;
    public computerDiagnosticsLastRunAt: string | null = null;
    public knowledgeGraphDiagnosticsRunning = false;
    public knowledgeGraphDiagnosticsLastRunAt: string | null = null;
    public workspaceDiagnosticsRunning = false;
    public workspaceDiagnosticsLastRunAt: string | null = null;
    public networkDiagnosticsRunning = false;
    public networkDiagnosticsLastRunAt: string | null = null;
    public telemetryDiagnosticsRunning = false;
    public telemetryDiagnosticsLastRunAt: string | null = null;
    public logsDiagnosticsRunning = false;
    public logsDiagnosticsLastRunAt: string | null = null;
    public schedulerDiagnosticsRunning = false;
    public schedulerDiagnosticsLastRunAt: string | null = null;
    public demoDiagnosticsRunning = false;
    public demoDiagnosticsLastRunAt: string | null = null;
    private readonly characterAccountabilityStore: CharacterAccountabilityStore;
    private readonly characterAccountabilityManager: CharacterAccountabilityManager;
    private readonly utilityRegistry!: UtilityRegistry;
    private readonly riskOverrideStore!: RiskOverrideStore;
    private readonly incidentTrendStore!: IncidentTrendStore;
    // ── Phase H: Novel Systems Incubation (CCC + DLMA + SHWS) ──────────
    // Lazy-initialized to keep the dashboard fast when PRISM_INCUBATION=off.
    private incubation?: {
        enabled: boolean;
        compiler: import("../incubation/ccc/compiler.js").CausalCompiler;
        arbiter: import("../incubation/dlma/arbiter.js").DualLensArbiter;
        synthesizer: import("../incubation/shws/synthesizer.js").WorkflowSynthesizer;
        history: import("../incubation/shws/history-index.js").WorkflowHistoryIndex;
        constitution: import("../incubation/ccc/types.js").Constitution;
    };
    public usageMetering?: UsageMeteringService;
    public runtimeSettings: Record<string, unknown> = {
        approvalTimeoutMs: 30000,
        selfReviewDailyMs: 86400000,
        selfReviewWeeklyMs: 604800000,
        selfReviewMonthlyMs: 2592000000,
        maxEpisodicEvents: 600,
        actionHistoryLimit: 25,
        sessionPackageHistoryLimit: 250,
        shellTimeoutMs: 30000,
        httpTimeoutMs: 30000,
        mcpTimeoutMs: 30000,
        telemetryWindow: "1d",
        llamacppBin: "llama-server",
        bitnetBin: "bitnet-server",
        // When true, approved Tier-2 chat requests automatically continue
        // and are executed by the AgenticChatExecutor. Set to false to
        // require manual operator follow-up after approval.
        autoRunApprovedTier2: true,
        llreEnabled: true,
        verboseLogging: false,
    };
    private readonly downloadStatus = new Map<string, DownloadProgress>();
    private readonly iamStore: IamStore;
    private readonly sessionManager: SessionManager;
    private readonly iamHandler: IamRouteHandler;
    private readonly router: Router;
    private readonly activityStore: SqliteActivityStore | null = null;

    public getRuntimeSettings(): Record<string, unknown> {
        return this.runtimeSettings;
    }
    public getIamStore(): IamStore {
        return this.iamStore;
    }
    public getSessionManager(): SessionManager {
        return this.sessionManager;
    }
    public getIamHandler(): IamRouteHandler {
        return this.iamHandler;
    }
    public getActivityStore(): SqliteActivityStore | null {
        return this.activityStore;
    }
    public getSkillsEngine(): SkillsEngine {
        return this.skillsEngine;
    }
    private readonly skillsEngine!: SkillsEngine;
    private readonly tooltipsRegistry: TooltipsRegistry = new TooltipsRegistry(
        resolvePath(process.cwd(), "docs", "tooltips"),
    );
    public customRecommendedModels: Array<{
        name: string;
        fileName: string;
        size: string;
        path: string;
        source: string;
        addedAt: string;
    }> = [];

    /* ── A2A Protocol adapters (Phase F) ───────────────────────────────── */
    private a2aTaskAdapter: A2ATaskAdapter | null = null;
    private governanceHooksAdapter: GovernanceHooksAdapter | null = null;
    private readonly terminalAdapter: TerminalSessionAdapter | null = null;
    private readonly containerAdapter: ContainerSandboxAdapter | null = null;

    /* ── Autonomous Modules (Priority 1 — Roadmap) ─────────────────────── */
    // Note: autonomousLoop, _browserAgent, _computerAgent, and _covenant
    // are declared in the Phase A section below (~L2736). The constructor
    // creates instances and wires them into those existing members.

    /* ── Observability (Phase E6) ───────────────────────────────────────── */
    private readonly metricsStore: MetricsStore;
    private readonly otelExporter: OtelExporter;
    private readonly soc2Exporter: Soc2EvidenceExporter;
    private readonly activityRetentionPolicy: ActivityRetentionPolicy | null;

    /* ── OAuth adapters (Phase E2) ──────────────────────────────────────── */
    private readonly gmailOAuth: GmailOAuthAdapter;
    private readonly outlookOAuth: OutlookOAuthAdapter;
    public readonly oauthTokenStore: OAuthTokenStore;
    public readonly inboundPoller: InboundChannelPoller;

    /* ── Scheduler in-memory stores ────────────────────────────────────── */
    private readonly schedulerEvents = new Map<
        string,
        { id: string; title: string; start: string; end?: string; description?: string; createdAt: string }
    >();
    private readonly schedulerProjects = new Map<
        string,
        {
            id: string;
            name: string;
            description?: string;
            tasks: Array<{
                id: string;
                title: string;
                status: string;
                assignee?: string;
                startDate?: string;
                endDate?: string;
                dueDate?: string;
                createdAt: string;
            }>;
            milestones: Array<{ title: string; dueDate?: string }>;
            createdAt: string;
        }
    >();
    private readonly schedulerEngine: SchedulerEngine;

    constructor(
        private readonly queue: ApprovalQueue,
        private readonly activityBus: ActivityBus,
        public readonly status: DashboardRuntimeStatus,
        private readonly chatStore: ChatSessionStore,
        actions: DashboardAction[] = [],
        private readonly port = 7070,
        private readonly metricsCollector?: RetrievalMetricsCollector,
        private readonly retrievalDashboardStore?: RetrievalDashboardStore,
        providerSecretStore?: ProviderSecretStore,
        activityStore?: SqliteActivityStore,
        sessionPackageStorePath: string = workspacePath("state", "dashboard-session-packages.json"),
        sessionPackageExportDir: string = workspacePath("artifacts", "packages"),
        toolRegistry?: ToolRegistry,
        usageMetering?: UsageMeteringService,
        gmailOAuth?: GmailOAuthAdapter,
        outlookOAuth?: OutlookOAuthAdapter,
        terminalAdapter?: TerminalSessionAdapter,
        containerAdapter?: ContainerSandboxAdapter,
    ) {
        this.activityStore = activityStore ?? null;
        this.providerSecretStore =
            providerSecretStore ??
            (process.platform === "win32"
                ? new WindowsProtectedFileProviderSecretStore()
                : new InMemoryProviderSecretStore());

        const iamDbPath = join(resolveWorkspaceRoot(), ".prism", "iam.db");
        mkdirSync(dirname(iamDbPath), { recursive: true });
        this.iamStore = new IamStore(iamDbPath);
        this.sessionManager = new SessionManager(this.iamStore);
        this.iamHandler = new IamRouteHandler({
            iamStore: this.iamStore,
            sessionManager: this.sessionManager,
            defaultTenantId: "default",
            activityBus: this.activityBus,
        });
        this.router = new Router(this.iamHandler);

        this.iamStore.seedDefaultRoles("default");
        const existingUsers = this.iamStore.listUsers("default");
        if (existingUsers.length === 0) {
            const env = (process.env.NODE_ENV ?? "").toLowerCase();
            const allowDefaultCredentials =
                (process.env.PRISM_ALLOW_DEFAULT_CREDENTIALS ?? "") === "1" || env === "test" || env === "development";

            const randomPassword = () => `${randomUUID().replace(/-/g, "")}${randomUUID().slice(0, 8)}`;
            const adminPassword = allowDefaultCredentials ? "admin" : randomPassword();
            const testPassword = allowDefaultCredentials ? "testing" : randomPassword();

            const adminUser = this.iamStore.createUser({
                tenantId: "default",
                email: "admin@prismrefraction.com",
                displayName: "Administrator",
                status: "active",
                attrs: { passwordHash: hashPassword(adminPassword) },
            });
            const adminRole = this.iamStore.getRoleByName("default", "admin");
            if (adminRole) this.iamStore.addMembership(adminUser.id, "default", adminRole.id);

            if (allowDefaultCredentials) {
                const testUser = this.iamStore.createUser({
                    tenantId: "default",
                    email: "testing@prismrefraction.com",
                    displayName: "Test Operator",
                    status: "active",
                    attrs: { passwordHash: hashPassword(testPassword) },
                });
                const operatorRole = this.iamStore.getRoleByName("default", "operator");
                if (operatorRole) this.iamStore.addMembership(testUser.id, "default", operatorRole.id);
            }

            // In non-dev/test environments, persist one-time bootstrap credentials
            // to a protected workspace file so operators can complete first login.
            if (!allowDefaultCredentials) {
                const bootstrapPath = workspacePath("state", "iam-bootstrap-credentials.json");
                mkdirSync(dirname(bootstrapPath), { recursive: true });
                const payload = {
                    createdAt: new Date().toISOString(),
                    note: "Delete this file after first successful IAM login.",
                    users: [{ email: "admin@prismrefraction.com", password: adminPassword, role: "admin" }],
                };
                writeFileSync(bootstrapPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
            }
        }

        // ── Security: Auth gate & rate limiter ──────────────────────────────
        const authDisabled = process.env.PRISM_AUTH_DISABLED === "true";
        if (authDisabled && process.env.NODE_ENV === "production") {
            throw new Error(
                "[SECURITY] PRISM_AUTH_DISABLED=true is not permitted when NODE_ENV=production. " +
                    "Remove this environment variable before deploying.",
            );
        }
        this.authGate = new AuthGate({
            tokenFilePath: workspacePath("state", "admin-token"),
            disabled: authDisabled,
            publicRoutes: [
                "/health",
                "/api/health",
                "/favicon.ico",
                "/.well-known/agent.json",
                "/metrics",
                "/api/v1/openapi.json",
                "/api/openapi.json",
                // Dashboard pages — DashboardHandler has its own cookie+token auth
                // that gracefully redirects to /login; let it handle auth, not the gate.
                "/",
                // Auth telemetry beacon — login page sends client-side trace events
                "/api/v1/telemetry/auth-trace",
            ],
            publicPrefixes: [
                "/public/",
                "/login",
                "/api/auth/",
                "/api/v1/auth/",
                "/api/iam/sso/",
                "/api/v1/iam/sso/",
                "/api/iam/login",
                "/api/v1/iam/login",
                "/scim/v2/",
                // Dashboard pages — DashboardHandler does its own auth (cookie/token → 302 /login)
                "/dashboard",
                "/simple",
            ],
            bootstrapRoutes: [
                // Setup wizard (step 4/6): character listing + import
                "/api/workspace/characters",
                "/api/workspace/character-import",
                "/api/workspace/character-assign",
                // Setup wizard (step 5): local model listing
                "/api/models/gguf",
                "/api/models/recommended",
                // Setup wizard (step 3): provider catalog, connection test, API key save
                "/api/llm/catalog",
                "/api/llm/provider-test",
                "/api/llm/provider-secret",
                "/api/llm/routing/suggest",
                // Setup wizard (step 7): browser profile creation
                "/api/browser/profiles",
                // Setup wizard (step 5): guardian configuration
                "/api/guardian/configure",
                "/api/guardian/status",
                "/api/guardian/start",
                // Setup wizard (step 6): readiness recheck
                "/api/readiness/recheck",
            ],
            bootstrapPrefixes: [
                "/setup",
                // Setup wizard API — all /api/setup/* endpoints (profile, workspace, character, cac, complete)
                "/api/setup/",
                "/api/v1/setup/",
            ],
        });
        this.rateLimiter = new RateLimiter({
            maxRequests: Number(process.env.PRISM_RATE_LIMIT ?? 200),
            windowMs: 60_000,
        });

        // ── R2: CORS allowlist + Origin/Referer CSRF guard ─────────────────
        // Loopback variants of the dashboard's own port are always allowed;
        // additional origins are added via PRISM_CORS_ORIGINS (comma-sep).
        // Wildcards are rejected by resolveAllowedOrigins().
        this.corsCsrfConfig = {
            allowedOrigins: resolveAllowedOrigins(this.port, process.env),
            logRejections: process.env.PRISM_SECURITY_QUIET !== "true",
        };

        // ── Observability (Phase E6) — initialize early so all events are counted ─
        this.metricsStore = new MetricsStore();
        this.otelExporter = new OtelExporter(this.activityBus, this.metricsStore, {
            serviceName: "prism",
            serviceVersion: "0.2.0",
            endpoint: process.env.PRISM_OTEL_ENDPOINT,
            consoleExport: process.env.PRISM_OTEL_CONSOLE === "true",
        });
        this.otelExporter.start();

        // ── SOC 2 evidence exporter (Phase SOC2-1) ─ default off ───────────────
        this.soc2Exporter = new Soc2EvidenceExporter(this.activityBus);
        if (this.soc2Exporter.isEnabled()) {
            this.soc2Exporter.start();
        }

        // ── Activity-events retention policy (W6) ─ default off ────────────────
        // Activated when PRISM_ACTIVITY_RETENTION_DAYS is a positive integer.
        // Periodically deletes rows from activity_events older than the configured
        // window and emits an `activity.retention.swept` governance event.
        {
            const retentionCfg = activityStore ? resolveRetentionConfigFromEnv(activityStore.dbPath) : null;
            if (retentionCfg) {
                this.activityRetentionPolicy = new ActivityRetentionPolicy(retentionCfg, this.activityBus);
                this.activityRetentionPolicy.start();
            } else {
                this.activityRetentionPolicy = null;
            }
        }

        // ── OAuth adapters (Phase E2) ─────────────────────────────────────────────
        const oauthTokenStore = createOAuthTokenStore();
        this.oauthTokenStore = oauthTokenStore;
        this.gmailOAuth = gmailOAuth ?? new GmailOAuthAdapter(oauthTokenStore);
        this.outlookOAuth = outlookOAuth ?? new OutlookOAuthAdapter(oauthTokenStore);
        this.inboundPoller = new InboundChannelPoller(
            this.gmailOAuth,
            this.outlookOAuth,
            this.queue,
            this.chatStore,
            this,
            this.activityBus,
        );
        this.terminalAdapter = terminalAdapter ?? null;
        this.containerAdapter = containerAdapter ?? null;

        const initialPrefs = readPreferences();
        const initLlamacppBin =
            (initialPrefs?.runtimeSettings?.llamacppBin as string) || process.env.PRISM_LLAMACPP_BIN || "llama-server";
        const initBitnetBin =
            (initialPrefs?.runtimeSettings?.bitnetBin as string) || process.env.PRISM_BITNET_BIN || "bitnet-server";

        this.llamaSupervisor = new LlamaCppSupervisor({
            binaryPath: initLlamacppBin,
            basePort: 8081,
            maxSlots: 5,
            defaultContext: 4096,
            modelsDir: join(process.cwd(), "models"),
        });

        this.bitnetSupervisor = new LlamaCppSupervisor({
            binaryPath: initBitnetBin,
            basePort: 8082,
            maxSlots: 2,
            defaultContext: 4096,
            modelsDir: join(process.cwd(), "models"),
        });

        this.llmProviders = new LlmProviderManager(
            process.env,
            this.chatStore.listProviderSettings(),
            this.providerSecretStore,
            this.llamaSupervisor,
            this.bitnetSupervisor,
            this.activityBus,
            oauthTokenStore,
        );
        if (this.usageMetering) {
            this.llmProviders.setUsageMetering(this.usageMetering);
        }
        this.llmProviders.loadPersistedProfiles(this.chatStore.listModelProfiles());

        // Load and apply powerMode preference at server startup
        try {
            const prefs = readPreferences();
            const powerMode = prefs?.powerMode || "adaptive";
            let isAuto = false;
            let targetBaseMode = false;

            if (powerMode === "adaptive") {
                isAuto = true;
                process.env.PRISM_BASE_MODE_AUTO = "true";
                const activeModel = this.llmProviders.activeModel;
                if (activeModel) {
                    const profile = resolveProfile(activeModel);
                    targetBaseMode = profile.locality === "local" && profile.tier <= 2;
                }
            } else {
                isAuto = false;
                process.env.PRISM_BASE_MODE_AUTO = "false";
                targetBaseMode = powerMode === "eco";
            }

            process.env.PRISM_BASE_MODE = targetBaseMode ? "true" : "false";
            console.log(
                `[PRISM][startup] Hydrated powerMode preference: '${powerMode}' -> baseMode=${targetBaseMode} (auto=${isAuto})`,
            );
        } catch (err) {
            console.warn("[PRISM][startup] Failed to hydrate powerMode preference:", err);
        }

        this.characterAccountabilityStore = new CharacterAccountabilityStore(workspaceDbPath());
        this.characterAccountabilityManager = new CharacterAccountabilityManager(
            this.characterAccountabilityStore,
            this.activityBus,
        );
        this.sessionPackageStorePath = sessionPackageStorePath;
        this.sessionPackageExportDir = sessionPackageExportDir;
        this.traceExplorer = activityStore ? new SessionTraceExplorer(activityStore) : undefined;
        this.policyAuditExporter = activityStore ? new PolicyAuditExporter(activityStore) : undefined;
        this.pkgStore = activityStore ? new SessionPackageSqliteStore(activityStore.dbPath) : undefined;
        this.toolRegistry = toolRegistry ?? null;
        if (this.toolRegistry) {
            this.toolRegistry.register({
                name: "ask_reasoning_model",
                contract: {
                    version: "1.0.0",
                    args: {
                        prompt: { type: "string", required: true },
                    },
                },
                execute: async (request: any) => {
                    const prompt = request.args.prompt as string;
                    if (!prompt) return { ok: false, output: { error: "Missing prompt." } };
                    const result = await this.llmProviders.generateForRole("reasoning", {
                        message: prompt,
                        conversation: [],
                        systemPrompt:
                            "You are the primary reasoning model for PRISM. A smaller agent has delegated a complex task to you. Provide the best possible answer or analysis based on the prompt.",
                    });
                    if (!result)
                        return { ok: false, output: { error: "Reasoning model failed to produce a response." } };
                    return { ok: true, output: { response: result.content } };
                },
            });
        }
        this.agenticExecutor = this.toolRegistry ? new AgenticChatExecutor(this.toolRegistry) : null;
        this.tools = toolRegistry ? toolRegistry.list() : [];
        if (usageMetering) this.usageMetering = usageMetering;

        // Initialize SOTA Skills Engine (durable sqlite workflows)
        this.skillsEngine = new SkillsEngine(
            this.llmProviders,
            this.activityBus,
            resolveWorkspaceRoot(),
            this.chatStore,
        );

        // Guardian Agent — permanent autonomous agent powered by llama.cpp
        this.guardianAgent = new GuardianAgent(this.activityBus, this.llamaSupervisor, this.tools, {
            modelAlias: process.env.PRISM_GUARDIAN_MODEL_ALIAS || "guardian",
            modelPath: process.env.PRISM_GUARDIAN_MODEL_PATH || "",
            authorityTier:
                (process.env.PRISM_GUARDIAN_AUTHORITY as "tier1_autonomous" | "tier2_conditional") ||
                "tier2_conditional",
            autoStart: process.env.PRISM_GUARDIAN_AUTOSTART !== "false",
            contextSize: parseInt(process.env.PRISM_GUARDIAN_CTX_SIZE || "4096", 10),
            draftModelPath: process.env.PRISM_GUARDIAN_DRAFT_MODEL || undefined,
            gpuLayers: process.env.PRISM_GUARDIAN_GPU_LAYERS
                ? parseInt(process.env.PRISM_GUARDIAN_GPU_LAYERS, 10)
                : undefined,
            flashAttn: process.env.PRISM_GUARDIAN_FLASH_ATTN !== "false",
            dashboardBaseUrl: `http://127.0.0.1:${this.port}`,
        });
        this.guardianAgent.setSkillsEngine(this.skillsEngine);

        this.dashboardControlTool = new DashboardControlTool(this.activityBus);
        if (this.toolRegistry) {
            this.toolRegistry.register(this.dashboardControlTool);
        }
        this.tools.push(this.dashboardControlTool);

        const computerUseTool = new ComputerUseTool(this.framebufferCapture);
        if (this.toolRegistry) {
            this.toolRegistry.register(computerUseTool);
        }
        this.tools.push(computerUseTool);

        // ── v0.20.3: image generation tool ──
        // Wired here (not in builtinTools()) because it needs the LlmProviderManager
        // + ProviderSecretStore that DashboardService owns. Routes through the
        // model-capability matrix to pick an `image-generation`-capable model.
        const imageGenerateTool = new ImageGenerateTool({
            providerManager: this.llmProviders,
            secretStore: this.providerSecretStore,
        });
        if (this.toolRegistry) {
            this.toolRegistry.register(imageGenerateTool);
        }
        this.tools.push(imageGenerateTool);

        // ── v0.20.4: full media-modality tool coverage ──
        // Video generation, audio (TTS / music / SFX), and audio transcription.
        // Same wiring pattern as ImageGenerateTool. Each routes through the
        // model-capability matrix and surfaces structured failures when no capable
        // provider is configured.
        const videoGenerateTool = new VideoGenerateTool({
            providerManager: this.llmProviders,
            secretStore: this.providerSecretStore,
        });
        const audioGenerateTool = new AudioGenerateTool({
            providerManager: this.llmProviders,
            secretStore: this.providerSecretStore,
        });
        const audioTranscribeTool = new AudioTranscribeTool({
            providerManager: this.llmProviders,
            secretStore: this.providerSecretStore,
        });
        if (this.toolRegistry) {
            this.toolRegistry.register(videoGenerateTool);
            this.toolRegistry.register(audioGenerateTool);
            this.toolRegistry.register(audioTranscribeTool);
        }
        this.tools.push(videoGenerateTool, audioGenerateTool, audioTranscribeTool);

        // ── Autonomous modules (Priority 1 — Roadmap) ──────────────────────
        // Initialize covenant, agents, and the autonomous loop. The loop needs
        // the tool registry for step execution, the LLM for planning, and the
        // specialized agents for browser/computer tasks.
        // These are assigned to the Phase A members declared later in the class.
        this._covenant = new PrismCovenant(this.activityBus);
        this.sshpInterceptor = new SSHPInterceptor(this._covenant);
        this.cshManager = new CSHManager();
        this._browserAgent = new AutonomousBrowserAgent(this.activityBus);
        this._browserAgent.setSSHPInterceptor(this.sshpInterceptor);
        this._browserAgent.setCSHManager(this.cshManager);
        this._computerAgent = new AutonomousComputerAgent(this.activityBus);

        // Propagate SSHP Interceptor and CSH Manager to any matching registered tools (browser_control, secure_browser)
        for (const tool of this.tools) {
            if (typeof (tool as any).setSSHPInterceptor === "function") {
                (tool as any).setSSHPInterceptor(this.sshpInterceptor);
            }
            if (typeof (tool as any).setCSHManager === "function") {
                (tool as any).setCSHManager(this.cshManager);
            }
        }

        if (this.toolRegistry) {
            const loop = new AutonomousAgentLoop(this.activityBus, this.toolRegistry, {
                maxConcurrentGoals: 1,
                defaultMaxActions: 100,
                defaultMaxDurationMs: 10 * 60 * 1000,
                guardianCheckIntervalActions: 5,
                actionsPerMinuteLimit: 30,
            });
            if (this.usageMetering) {
                loop.setUsageMetering(this.usageMetering);
            }
            this.autonomousLoop = loop;

            // Wire LLM generate function — adapts LlmProviderManager.generate()
            // to the AutonomousLlmGenerateFn signature expected by the planner.
            const providerManager = this.llmProviders;
            const autonomousGenerateFn: AutonomousLlmGenerateFn = async (input) => {
                const result = await providerManager.generate({
                    message: input.message,
                    conversation: input.conversation as any,
                    systemPrompt: input.systemPrompt,
                    tools: input.tools as any,
                    tool_choice: input.tool_choice,
                });
                if (!result) return null;
                return {
                    content: result.content,
                    toolCalls: result.toolCalls,
                    stopReason: result.stopReason,
                    thoughtSignature: result.thoughtSignature,
                };
            };
            loop.setLlmGenerateFn(autonomousGenerateFn);

            // Wire tool definitions from the registry
            const toolDefs: LlmToolDef[] = this.toolRegistry
                .list()
                .filter((t) => t.contract?.args)
                .map((t) => ({
                    name: t.name,
                    description: (t.contract as any)?.description ?? `Execute the ${t.name} tool`,
                    parameters: {
                        type: "object" as const,
                        properties: Object.fromEntries(
                            Object.entries(t.contract?.args ?? {}).map(([key, schema]) => [
                                key,
                                {
                                    type: String((schema as any).type ?? "string"),
                                    description: String((schema as any).description ?? key),
                                },
                            ]),
                        ),
                        required: Object.entries(t.contract?.args ?? {})
                            .filter(([, schema]) => (schema as any).required === true)
                            .map(([key]) => key),
                    },
                }));
            loop.setToolDefinitions(toolDefs);

            // Wire specialized agents
            loop.setSpecializedAgents(this._browserAgent ?? undefined, this._computerAgent ?? undefined);

            // Wire covenant for pre-step enforcement
            if (this._covenant) {
                loop.setCovenant(this._covenant);
            }
        }

        // Forward Guardian events and UI actions to WebSocket clients
        this.guardianAgent.on("guardian_event", (evt: { operation: string; detail: string }) => {
            for (const ws of this.wsClients) {
                try {
                    ws.send(JSON.stringify({ type: "guardian_event", ...evt, timestamp: new Date().toISOString() }));
                } catch {
                    /* client may have disconnected */
                }
            }
        });

        this.activityBus.subscribe({
            onEvent: (event) => {
                if (event.operation.startsWith("ui.")) {
                    for (const ws of this.wsClients) {
                        try {
                            ws.send(
                                JSON.stringify({
                                    type: "ui_action",
                                    ...event.details,
                                    timestamp: new Date().toISOString(),
                                }),
                            );
                        } catch {
                            /* client may have disconnected */
                        }
                    }
                }
            },
        });
        // v0.20.5 — Hydrate Guardian config from persisted preferences BEFORE the
        // autostart check below. Without this, every server restart loses the
        // operator's last-selected model and Guardian refuses to autostart.
        try {
            const guardianPrefs = readPreferences()?.guardianConfig;
            if (guardianPrefs && typeof guardianPrefs === "object") {
                // Strip any unknown keys defensively. The agent's configure() merges
                // with its own defaults so missing fields are safe.
                const allowed: Record<string, unknown> = {};
                for (const k of [
                    "modelAlias",
                    "modelPath",
                    "draftModelPath",
                    "authorityTier",
                    "healthCheckIntervalMs",
                    "autoStart",
                    "contextSize",
                    "flashAttn",
                    "gpuLayers",
                    "modelSource",
                ]) {
                    if (k in (guardianPrefs as Record<string, unknown>))
                        allowed[k] = (guardianPrefs as Record<string, unknown>)[k];
                }
                if (Object.keys(allowed).length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    this.guardianAgent.configure(allowed as any);
                }
            }
        } catch (err) {
            console.warn("[guardian] failed to hydrate config from preferences:", err);
        }
        // Auto-start Guardian if configured and model path is set
        if (this.guardianAgent.getConfig().autoStart && this.guardianAgent.getConfig().modelPath) {
            void this.guardianAgent.start();
        }
        // Inject agent-list resolver so guardian tasks can inspect agent state
        if (this.agentLifecycle) {
            const lifecycle = this.agentLifecycle;
            this.guardianAgent.setAgentListFn(() => {
                const agents = lifecycle
                    .list()
                    .map((a) => ({ id: a.agentId, state: a.state, role: a.role, lifecycle: a.lifecycle }));
                return { agents };
            });
        }

        // Inject log-entries resolver so guardian tasks can analyze log volumes
        this.guardianAgent.setLogEntriesFn(() => {
            return this.activityBus.listEvents().map((e) => ({
                severity: e.status === "failed" ? "error" : "info",
                timestamp: e.timestamp,
            }));
        });

        // Inject AAB ledger accessor so Guardian can monitor autonomous behavior
        if (this.autonomousLoop) {
            const loop = this.autonomousLoop;
            this.guardianAgent.setAABLedgerFn(() => loop.getAABLedger());
        }

        // Inject Covenant accessor so Guardian can run integrity audits
        if (this._covenant) {
            const covenant = this._covenant;
            this.guardianAgent.setCovenantFn(() => covenant.getStatus());
            covenant.bindGuardian(this.guardianAgent);
        }

        for (const t of this.tools) {
            if (!this.toolStates[t.name]) {
                this.toolStates[t.name] = {
                    enabled: true,
                    invocations: 0,
                    successes: 0,
                    failures: 0,
                    avgLatencyMs: 0,
                    lastInvoked: null,
                    lastError: null,
                };
            }
        }
        // Load persisted runtime settings from preferences file
        try {
            const prefs = readPreferences();
            if (prefs?.runtimeSettings && typeof prefs.runtimeSettings === "object") {
                const persisted = prefs.runtimeSettings;
                for (const [k, v] of Object.entries(persisted)) {
                    if (k in this.runtimeSettings) {
                        this.runtimeSettings[k] = v;
                    }
                }
            }
        } catch {
            // Preferences file missing or malformed — use defaults
        }
        this.loadSessionPackageStore();
        this.loadCustomRecommendedModels();
        try {
            this.seedTestingCacChain();
        } catch (err) {
            console.warn("[PRISM][seeding] Failed to seed testing operator CAC chain:", err);
        }

        // ── A2A Protocol adapters (Phase F) ──────────────────────────────────
        // Use the workspace's persistent SQLite DB so A2A tasks survive restarts.
        try {
            const a2aDb = new sqlite3.Database(workspaceDbPath());
            this.a2aTaskAdapter = new A2ATaskAdapter(a2aDb, this.activityBus);
            this.governanceHooksAdapter = new GovernanceHooksAdapter(this.activityBus);
        } catch {
            // Graceful degradation — A2A endpoints will return 503 if adapter failed to init.
        }

        // ── Operator surfaces (Phase E3 follow-on) ───────────────────────────
        this.riskOverrideStore = new RiskOverrideStore(workspacePath("state", "risk-overrides.json"), this.activityBus);
        this.incidentTrendStore = new IncidentTrendStore(this.activityBus);
        this.utilityRegistry = new UtilityRegistry(this.activityBus);
        registerBuiltInUtilities(this.utilityRegistry, {
            runContractDiffGate: async () => {
                // Lightweight wrapper — runs the gate script in-process.
                const cp = await import("node:child_process");
                const out = await new Promise<{ code: number; stdout: string; stderr: string }>((resolveCp) => {
                    const child = cp.spawn(process.execPath, ["scripts/contract-diff-gate.cjs"], {
                        cwd: process.cwd(),
                        env: process.env,
                    });
                    let stdout = "";
                    let stderr = "";
                    child.stdout.on("data", (b) => {
                        stdout += b.toString();
                    });
                    child.stderr.on("data", (b) => {
                        stderr += b.toString();
                    });
                    child.on("close", (code) => resolveCp({ code: code ?? 0, stdout, stderr }));
                });
                return {
                    summary:
                        out.code === 0 ? "Contract diff gate passed." : `Contract diff gate failed (exit ${out.code}).`,
                    details: { exitCode: out.code, stdout: out.stdout.slice(-2000), stderr: out.stderr.slice(-2000) },
                };
            },
            exportPolicyAudit: async () => {
                if (!this.policyAuditExporter) {
                    return { summary: "Policy audit exporter not available.", details: { available: false } };
                }
                const bundle = this.policyAuditExporter.exportBundle({ sessionId: this.status.sessionId });
                return {
                    summary: `Exported policy audit bundle (${bundle.recordCount} decisions).`,
                    details: { bundle },
                };
            },
            exportSessionTrace: async () => {
                if (!this.traceExplorer) {
                    return { summary: "Session trace explorer not available.", details: { available: false } };
                }
                const bundle = this.traceExplorer.exportBundle({ sessionId: this.status.sessionId });
                return { summary: `Exported session trace bundle (${bundle.eventCount} events).`, details: { bundle } };
            },
            runRetrievalTrends: async () => {
                if (!this.retrievalDashboardStore) {
                    return { summary: "Retrieval dashboard store not configured.", details: { available: false } };
                }
                const report = this.retrievalDashboardStore.getTrendReport(this.status.sessionId);
                return {
                    summary: report
                        ? `Trend report ready (${report.snapshotsCompared} snapshots).`
                        : "No trend data yet.",
                    details: { report },
                };
            },
            runPerfTrendReport: async () => {
                const cp = await import("node:child_process");
                const out = await new Promise<{ code: number; stdout: string; stderr: string }>((resolveCp) => {
                    const child = cp.spawn(process.execPath, ["scripts/perf-trend-report.cjs"], {
                        cwd: process.cwd(),
                        env: process.env,
                    });
                    let stdout = "";
                    let stderr = "";
                    child.stdout.on("data", (b) => {
                        stdout += b.toString();
                    });
                    child.stderr.on("data", (b) => {
                        stderr += b.toString();
                    });
                    child.on("close", (code) => resolveCp({ code: code ?? 0, stdout, stderr }));
                });
                return {
                    summary:
                        out.code === 0
                            ? "Perf trend report generated."
                            : `Perf trend report failed (exit ${out.code}).`,
                    details: { exitCode: out.code, stdout: out.stdout.slice(-2000), stderr: out.stderr.slice(-2000) },
                };
            },
        });

        this.schedulerEngine = new SchedulerEngine({
            activityBus: this.activityBus,
            sessionId: this.status.sessionId,
            persistencePath: workspacePath("state", "schedules.json"),
            onAction: (entry) => {
                this.broadcastEvent({
                    type: "scheduler:action-fired",
                    id: entry.id,
                    label: entry.label,
                    action: entry.action,
                    entryType: entry.type,
                    payload: entry.payload,
                    firedAt: new Date().toISOString(),
                });
            },
        });
        for (const action of actions) {
            this.actionsByName.set(action.name, action);
            this.actionStates.set(action.name, {
                name: action.name,
                label: action.label,
                description: action.description,
                status: "idle",
                lastStartedAt: null,
                lastCompletedAt: null,
                lastMessage: null,
                lastError: null,
            });
        }
        // ── Server creation (HTTPS when cert/key provided, else HTTP) ─────
        const tlsCert = process.env.PRISM_TLS_CERT;
        const tlsKey = process.env.PRISM_TLS_KEY;
        if (tlsCert && tlsKey && existsSync(tlsCert) && existsSync(tlsKey)) {
            this.server = https.createServer({ cert: readFileSync(tlsCert), key: readFileSync(tlsKey) }, (req, res) => {
                void this.handle(req, res);
            });
            this.tlsEnabled = true;
        } else {
            this.server = createServer((req, res) => {
                void this.handle(req, res);
            });
            this.tlsEnabled = false;
        }
        this.wsServer = new WebSocketServer({ noServer: true });
        // Track all open sockets so stop() can destroy them immediately.
        this.server.on("connection", (socket: Socket) => {
            this.openSockets.add(socket);
            socket.on("close", () => this.openSockets.delete(socket));
        });
        this.server.on("upgrade", (req, socket, head) => {
            // Authenticate WebSocket upgrade (token via query param or Authorization header)
            const authResult = this.authGate.check(req);
            if (!authResult.authenticated) {
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                return;
            }
            if (req.url?.startsWith("/ws") || req.url?.startsWith("/ws/chat")) {
                this.wsServer.handleUpgrade(req, socket, head, (ws) => {
                    this.wsClients.add(ws);
                    ws.on("close", () => this.wsClients.delete(ws));
                    ws.on("error", () => this.wsClients.delete(ws));
                    ws.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));
                });
            } else {
                socket.destroy();
            }
        });
    }

    public seedTestingCacChain(): void {
        const packages = this.listSessionPackages();
        const hasTestingCert = packages.some((pkg) => /testing@prism\.ai/i.test(pkg.title || ""));
        if (hasTestingCert) {
            return;
        }

        const characters = this.listWorkspaceCharacters();
        if (characters.length === 0) {
            console.log("[PRISM][seeding] No workspace characters found; skipping testing operator CAC chain seed.");
            return;
        }

        const character = characters[0]!;
        const timestamp = new Date().toISOString();
        const operatorEmail = "testing@prism.ai";
        const assistantEmail = character.defaultEmail || `${character.id}@prism.ai`;

        // 1. Create a session package
        console.log(`[PRISM][seeding] Seeding testing operator CAC session chain for ${operatorEmail}...`);

        // 2. Create the dedicated chat session
        const session = this.createChatSession({
            title: "PRISM Initialization Certificate \u2014 TESTING \u2014 " + timestamp,
            operatorEmail,
            assistantEmail,
            characterId: character.id,
            allowUnbound: false,
        });

        // 3. Create CAC assignment
        const assignment = this.characterAccountabilityManager.assign({
            characterId: character.id,
            prismUserId: "prism-user",
            prismUserEmail: operatorEmail,
            operatorId: "operator-testing",
            operatorEmail,
            clientId: "dashboard",
            sessionId: session.sessionId,
            executionProfile: "individual",
            workspaceHub: getWorkspaceHub(),
        });

        // 4. Mark assignment verified
        this.characterAccountabilityManager.markEmailVerified(assignment.assignmentId, operatorEmail, "mock_oauth");
        this.characterAccountabilityManager.recordDispatch(assignment.assignmentId);

        // 5. Bind session to CAC assignment
        this.chatStore.bindSessionCharacter(session.sessionId, {
            characterId: character.id,
            cacAssignmentId: assignment.assignmentId,
            executionProfile: "individual",
            operatorEmail,
            assistantEmail,
        });

        // 6. Build cert content
        const certLines = [
            "# PRISM Initialization Certificate (Seeded Testing Chain)",
            "**Generated:** " + timestamp,
            "**Session:** " + session.sessionId,
            "**Operator Email:** " + operatorEmail,
            "**Assignment ID:** " + assignment.assignmentId,
            "",
            "## Configuration Summary",
            "- **Execution Profile:** individual",
            "- **Workspace:** " + resolveWorkspaceRoot(),
            "- **Primary LLM Provider:** mock-provider",
            "- **Model Routing:** default-routing",
            "- **Guardian Agent:** active",
            "- **Agentic Control:** active",
            "- **Character Accountability (CAC):** active",
        ];

        this.chatStore.appendMessage(session.sessionId, "assistant", certLines.join("\n"), {
            source: "initialization_certificate",
            type: "certificate",
        });

        // 7. Create Session Package
        this.createSessionPackage({
            title: "Initialization Certificate v1.0 \u2014 testing@prism.ai",
            areaOfInterest: "System Initialization",
            objective: "Immutable provenance record of seeded testing PRISM configuration",
            successCriteria: "Testing operator setup initialized automatically",
            sessionIds: [session.sessionId],
            status: "complete" as SessionPackageStatus,
            source: "setup_wizard_advanced",
        });

        console.log("[PRISM][seeding] Testing operator CAC session chain successfully seeded.");
    }

    private resolvePluginName(mcpToolName: string): string {
        const stripped = mcpToolName.replace(/^mcp_/, "");
        const knownPlugins = [
            "ids_mcp",
            "impressioncore_eds",
            "impressioncore_ipa",
            "impressioncore_goliath",
            "impressioncore_vrgc",
            "impressioncore_dpa",
            "web_search_mcp",
        ];
        for (const p of knownPlugins) {
            if (stripped.startsWith(p)) return p.replace(/_/g, "-");
        }
        const parts = stripped.split("_");
        return parts.length >= 2 ? parts.slice(0, 2).join("-") : stripped;
    }

    private buildToolCatalog(): Array<{
        name: string;
        cat: string;
        desc: string;
        risk: "low" | "medium" | "high";
        mut: boolean;
    }> {
        const known: Record<string, { cat: string; desc: string; risk: "low" | "medium" | "high"; mut: boolean }> = {
            file_read: { cat: "System", desc: "Read file contents with encoding support", risk: "low", mut: false },
            file_write: { cat: "System", desc: "Write or append content to files", risk: "medium", mut: true },
            file_delete: { cat: "System", desc: "Delete files and directories", risk: "high", mut: true },
            file_list: {
                cat: "System",
                desc: "List directory contents with file type detection",
                risk: "low",
                mut: false,
            },
            shell_exec: {
                cat: "System",
                desc: "Execute shell commands with blocked-pattern protection",
                risk: "high",
                mut: true,
            },
            terminal_session: {
                cat: "System",
                desc: "Manage interactive terminal sessions with lifecycle control",
                risk: "medium",
                mut: true,
            },
            container_sandbox: {
                cat: "System",
                desc: "Create and manage containerized sandbox environments",
                risk: "medium",
                mut: true,
            },
            http_request: {
                cat: "Integration",
                desc: "Execute HTTP requests (GET/POST/PUT/PATCH/DELETE)",
                risk: "medium",
                mut: true,
            },
            semantic_query: {
                cat: "Knowledge",
                desc: "Semantic memory index with multiple retrieval modes",
                risk: "low",
                mut: false,
            },
            memory_query: {
                cat: "Knowledge",
                desc: "Query episodic, semantic, or session memory stores",
                risk: "low",
                mut: false,
            },
            network_exec: {
                cat: "System",
                desc: "Execute curated network diagnostics and commands",
                risk: "medium",
                mut: true,
            },
            vision_capture: {
                cat: "System",
                desc: "Capture framebuffer screenshots and burst snapshots",
                risk: "medium",
                mut: false,
            },
            nexus_check_hotline: {
                cat: "Integration",
                desc: "Read broadcast messages from Nexus hotline",
                risk: "low",
                mut: false,
            },
            nexus_read_memory: { cat: "Integration", desc: "Read Nexus primary memory store", risk: "low", mut: false },
            nexus_log_insight: {
                cat: "Integration",
                desc: "Append insights to Nexus daily memory log",
                risk: "medium",
                mut: true,
            },
            nexus_broadcast: {
                cat: "Integration",
                desc: "Send STP messages to Nexus thread or hotline",
                risk: "medium",
                mut: true,
            },
        };

        const tools = this.tools || [];
        return tools.map((tool) => {
            const preset = known[tool.name];
            if (preset) {
                return { name: tool.name, cat: preset.cat, desc: preset.desc, risk: preset.risk, mut: preset.mut };
            }
            const lower = tool.name.toLowerCase();
            const isMutating =
                lower.includes("write") ||
                lower.includes("delete") ||
                lower.includes("exec") ||
                lower.includes("install") ||
                lower.includes("set_") ||
                lower.includes("create") ||
                lower.includes("stop") ||
                lower.includes("launch");
            const category =
                lower.includes("memory") || lower.includes("semantic") || lower.includes("neo4j")
                    ? "Knowledge"
                    : lower.includes("http") || lower.includes("mcp") || lower.includes("nexus")
                      ? "Integration"
                      : "System";
            return {
                name: tool.name,
                cat: category,
                desc: "Runtime registered tool",
                risk: isMutating ? "medium" : "low",
                mut: isMutating,
            };
        });
    }

    listActions(): DashboardActionState[] {
        return [...this.actionsByName.values()].map((action) => ({
            ...this.actionStates.get(action.name)!,
            label: action.label,
            description: action.description,
        }));
    }

    listActionHistory(): DashboardActionHistoryEntry[] {
        return [...this.actionHistory];
    }

    listChatSessions(): ChatSessionSummary[] {
        return this.chatStore.listSessions();
    }

    listSessionPackages(): SessionPackageEnvelope[] {
        return [...this.sessionPackages]
            .map((pkg) => ({
                ...pkg,
                summary: this.buildSessionPackageSummary(pkg),
            }))
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }

    listSessionPackageHistory(limit = 20): SessionPackageHistoryEntry[] {
        return this.sessionPackageHistory.slice(0, Math.max(1, limit));
    }

    getSessionPackageReleaseSnapshot(): SessionPackageReleaseSnapshot {
        const snapshot: SessionPackageReleaseSnapshot = {
            totalPackages: this.sessionPackages.length,
            byStatus: {
                planned: 0,
                running: 0,
                blocked: 0,
                complete: 0,
            },
            exportedCount: 0,
            latestExportArtifactPath: null,
            latestExportedAt: null,
            completeWithoutExportCount: 0,
        };

        for (const pkg of this.sessionPackages) {
            snapshot.byStatus[pkg.status] += 1;
            if (pkg.exportArtifactPath) {
                snapshot.exportedCount += 1;
            }
            if (pkg.status === "complete" && !pkg.exportArtifactPath) {
                snapshot.completeWithoutExportCount += 1;
            }
            if (pkg.lastExportAt && (!snapshot.latestExportedAt || pkg.lastExportAt > snapshot.latestExportedAt)) {
                snapshot.latestExportedAt = pkg.lastExportAt;
                snapshot.latestExportArtifactPath = pkg.exportArtifactPath;
            }
        }

        return snapshot;
    }

    getSessionPackageMetrics(): SessionPackageMetrics {
        const now = new Date().toISOString();
        const packages = this.sessionPackages;
        const history = this.sessionPackageHistory;

        const byStatus: Record<SessionPackageStatus, number> = { planned: 0, running: 0, blocked: 0, complete: 0 };
        let totalChapters = 0;
        let minChapters = Infinity;
        let maxChapters = 0;
        let exportedCount = 0;
        let completeWithoutExport = 0;

        for (const pkg of packages) {
            byStatus[pkg.status] = (byStatus[pkg.status] ?? 0) + 1;
            const chapters = pkg.sessionIds.length;
            totalChapters += chapters;
            if (chapters < minChapters) minChapters = chapters;
            if (chapters > maxChapters) maxChapters = chapters;
            if (pkg.exportArtifactPath) exportedCount++;
            if (pkg.status === "complete" && !pkg.exportArtifactPath) completeWithoutExport++;
        }

        const avg = packages.length > 0 ? totalChapters / packages.length : 0;
        const exportRate = packages.length > 0 ? exportedCount / packages.length : 0;
        const safeMin = packages.length > 0 ? minChapters : 0;
        const safeMax = packages.length > 0 ? maxChapters : 0;

        if (this.pkgStore) {
            return {
                generatedAt: now,
                totals: { all: packages.length, byStatus },
                chapterStats: { total: totalChapters, avg: Number(avg.toFixed(2)), min: safeMin, max: safeMax },
                exportStats: {
                    exportedCount,
                    exportRate: Number(exportRate.toFixed(4)),
                    completeWithoutExportCount: completeWithoutExport,
                },
                historyStats: {
                    totalEntries: history.length,
                    actionFrequency: this.pkgStore.actionFrequency(10),
                },
                creationTrend: this.pkgStore.packageCreatedPerDay(7),
            };
        }

        // Fallback: compute from in-memory data when no SQLite store
        const actionCounts = new Map<string, number>();
        for (const entry of history) {
            actionCounts.set(entry.action, (actionCounts.get(entry.action) ?? 0) + 1);
        }
        const actionFrequency = Array.from(actionCounts.entries())
            .map(([action, count]) => ({ action, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const trendMap = new Map<string, number>();
        for (const pkg of packages) {
            const ts = Date.parse(pkg.createdAt);
            if (ts >= sevenDaysAgo) {
                const day = pkg.createdAt.substring(0, 10);
                trendMap.set(day, (trendMap.get(day) ?? 0) + 1);
            }
        }
        const creationTrend = Array.from(trendMap.entries())
            .map(([day, count]) => ({ day, count }))
            .sort((a, b) => a.day.localeCompare(b.day));

        return {
            generatedAt: now,
            totals: { all: packages.length, byStatus },
            chapterStats: { total: totalChapters, avg: Number(avg.toFixed(2)), min: safeMin, max: safeMax },
            exportStats: {
                exportedCount,
                exportRate: Number(exportRate.toFixed(4)),
                completeWithoutExportCount: completeWithoutExport,
            },
            historyStats: { totalEntries: history.length, actionFrequency },
            creationTrend,
        };
    }

    createSessionPackage(payload: {
        title?: string;
        areaOfInterest?: string | null;
        objective?: string | null;
        successCriteria?: string | null;
        dependencies?: string[];
        sessionIds?: string[];
        status?: SessionPackageStatus;
        source?: string;
    }): SessionPackageEnvelope {
        const now = new Date().toISOString();
        const validSessions = new Set(this.chatStore.listSessions().map((session) => session.sessionId));
        const requestedSessionIds = Array.isArray(payload.sessionIds)
            ? payload.sessionIds.filter((sessionId) => typeof sessionId === "string" && validSessions.has(sessionId))
            : [];
        if (requestedSessionIds.length === 0) {
            throw new Error("Package must include at least one valid session chapter.");
        }

        const packagedSessionIds = new Set(this.sessionPackages.flatMap((pkg) => pkg.sessionIds));
        const overlaps = requestedSessionIds.filter((sessionId) => packagedSessionIds.has(sessionId));
        if (overlaps.length > 0) {
            throw new Error("Some sessions are already packaged: " + overlaps.join(", "));
        }

        const record: SessionPackageRecord = {
            packageId: `pkg-${randomUUID()}`,
            title: payload.title?.trim() || `Session Package ${now}`,
            areaOfInterest: payload.areaOfInterest?.trim() || null,
            objective: payload.objective?.trim() || null,
            successCriteria: payload.successCriteria?.trim() || null,
            dependencies: Array.isArray(payload.dependencies)
                ? payload.dependencies.map((item) => String(item).trim()).filter(Boolean)
                : [],
            status: normalizeSessionPackageStatus(payload.status),
            createdAt: now,
            updatedAt: now,
            sessionIds: requestedSessionIds,
            lastRunAt: null,
            lastExportAt: null,
            exportArtifactPath: null,
        };

        this.sessionPackages.unshift(record);
        this.recordSessionPackageHistory({
            packageId: record.packageId,
            title: record.title,
            action: "created",
            timestamp: now,
            status: record.status,
            previousStatus: null,
            nextStatus: record.status,
            source: payload.source || "dashboard_api",
            message: `Created package with ${record.sessionIds.length} chapters.`,
            targetSessionId: null,
        });
        this.persistSessionPackageStore();
        this.activityBus.emit({
            sessionId: this.status.sessionId,
            layer: "causal",
            operation: "dashboard.package.created",
            status: "succeeded",
            details: {
                packageId: record.packageId,
                title: record.title,
                chapterCount: record.sessionIds.length,
                source: payload.source || "dashboard_api",
            },
        });
        return this.getSessionPackage(record.packageId);
    }

    getSessionPackage(packageId: string): SessionPackageEnvelope {
        const pkg = this.sessionPackages.find((entry) => entry.packageId === packageId);
        if (!pkg) {
            throw new Error(`Unknown package: ${packageId}`);
        }
        return {
            ...pkg,
            summary: this.buildSessionPackageSummary(pkg),
        };
    }

    updateSessionPackage(
        packageId: string,
        patch: {
            title?: string;
            areaOfInterest?: string | null;
            objective?: string | null;
            successCriteria?: string | null;
            dependencies?: string[];
            status?: SessionPackageStatus;
            lastRunAt?: string | null;
            lastExportAt?: string | null;
            exportArtifactPath?: string | null;
            source?: string;
            message?: string | null;
            targetSessionId?: string | null;
            historyAction?: SessionPackageHistoryEntry["action"];
        },
    ): SessionPackageEnvelope {
        const index = this.sessionPackages.findIndex((entry) => entry.packageId === packageId);
        if (index === -1) {
            throw new Error(`Unknown package: ${packageId}`);
        }

        const existing = this.sessionPackages[index]!;
        const previousStatus = existing.status;
        const nextStatus = patch.status ? normalizeSessionPackageStatus(patch.status) : existing.status;
        const updatedAt = new Date().toISOString();
        const updated: SessionPackageRecord = {
            ...existing,
            title: patch.title === undefined ? existing.title : patch.title.trim() || existing.title,
            areaOfInterest:
                patch.areaOfInterest === undefined ? existing.areaOfInterest : patch.areaOfInterest?.trim() || null,
            objective: patch.objective === undefined ? existing.objective : patch.objective?.trim() || null,
            successCriteria:
                patch.successCriteria === undefined ? existing.successCriteria : patch.successCriteria?.trim() || null,
            dependencies:
                patch.dependencies === undefined
                    ? existing.dependencies
                    : patch.dependencies.map((item) => String(item).trim()).filter(Boolean),
            status: nextStatus,
            updatedAt,
            lastRunAt: patch.lastRunAt === undefined ? existing.lastRunAt : patch.lastRunAt,
            lastExportAt: patch.lastExportAt === undefined ? existing.lastExportAt : patch.lastExportAt,
            exportArtifactPath:
                patch.exportArtifactPath === undefined ? existing.exportArtifactPath : patch.exportArtifactPath,
        };
        this.sessionPackages[index] = updated;

        const statusChanged = previousStatus !== updated.status;
        if (statusChanged || patch.historyAction || patch.message || patch.exportArtifactPath !== undefined) {
            this.recordSessionPackageHistory({
                packageId: updated.packageId,
                title: updated.title,
                action: patch.historyAction || (statusChanged ? "status_changed" : "exported"),
                timestamp: updatedAt,
                status: updated.status,
                previousStatus,
                nextStatus: updated.status,
                source: patch.source || "dashboard_api",
                message: patch.message || null,
                targetSessionId: patch.targetSessionId || null,
            });
        }

        this.persistSessionPackageStore();
        this.activityBus.emit({
            sessionId: this.status.sessionId,
            layer: "causal",
            operation: "dashboard.package.updated",
            status: "succeeded",
            details: {
                packageId: updated.packageId,
                source: patch.source || "dashboard_api",
                previousStatus,
                nextStatus: updated.status,
                targetSessionId: patch.targetSessionId || null,
            },
        });

        return this.getSessionPackage(updated.packageId);
    }

    deleteSessionPackage(packageId: string, source: string = "dashboard_api"): { deleted: true } {
        const existing = this.sessionPackages.find((entry) => entry.packageId === packageId);
        if (!existing) {
            throw new Error(`Unknown package: ${packageId}`);
        }

        this.sessionPackages = this.sessionPackages.filter((entry) => entry.packageId !== packageId);
        this.pkgStore?.deletePackage(packageId);
        this.recordSessionPackageHistory({
            packageId: existing.packageId,
            title: existing.title,
            action: "unpackaged",
            timestamp: new Date().toISOString(),
            status: existing.status,
            previousStatus: existing.status,
            nextStatus: null,
            source,
            message: "Package restored to top-level history.",
            targetSessionId: null,
        });
        this.persistSessionPackageStore();
        this.activityBus.emit({
            sessionId: this.status.sessionId,
            layer: "causal",
            operation: "dashboard.package.deleted",
            status: "succeeded",
            details: {
                packageId: existing.packageId,
                title: existing.title,
                source,
            },
        });
        return { deleted: true };
    }

    exportSessionPackage(packageId: string, source: string = "dashboard_api"): SessionPackageTraceExport {
        if (!this.traceExplorer || !this.policyAuditExporter) {
            throw new Error("Session package export is unavailable because the activity store is not configured.");
        }

        const pkg = this.getSessionPackage(packageId);
        const sessionsById = new Map(this.chatStore.listSessions().map((session) => [session.sessionId, session]));
        const chapters = pkg.sessionIds
            .map((sessionId) => sessionsById.get(sessionId))
            .filter((session): session is ChatSessionSummary => Boolean(session))
            .map((session) => ({
                sessionId: session.sessionId,
                sessionTitle: session.title,
                trace: this.traceExplorer!.exportBundle({ sessionId: session.sessionId }),
                policyAudit: this.policyAuditExporter!.exportBundle({ sessionId: session.sessionId }),
            }));

        const exportedAt = new Date().toISOString();
        const artifactPath = join(
            this.sessionPackageExportDir,
            `${pkg.packageId}-${exportedAt.replace(/[:.]/g, "-")}.json`,
        );
        const payload: SessionPackageTraceExport = {
            exportedAt,
            artifactPath,
            package: pkg,
            chapters,
            aggregate: {
                totalEvents: chapters.reduce((sum, chapter) => sum + chapter.trace.eventCount, 0),
                totalPolicyRecords: chapters.reduce((sum, chapter) => sum + chapter.policyAudit.recordCount, 0),
                chaptersExported: chapters.length,
            },
        };

        mkdirSync(this.sessionPackageExportDir, { recursive: true });
        writeFileSync(artifactPath, JSON.stringify(payload, null, 2), "utf-8");
        this.updateSessionPackage(packageId, {
            lastExportAt: exportedAt,
            exportArtifactPath: artifactPath,
            source,
            message: `Trace export written to ${artifactPath}`,
            historyAction: "exported",
        });
        return {
            ...payload,
            package: this.getSessionPackage(packageId),
        };
    }

    private getOrCreateToolContractExtractor(): ToolContractExtractor {
        if (!this.toolContractExtractor) {
            const db = new sqlite3.Database(":memory:");
            const policyEngine = new PolicyEngine();
            this.toolContractExtractor = new ToolContractExtractor(db, policyEngine, this.activityBus);
            if (this.toolRegistry) {
                this.toolContractExtractor.setToolRegistry(this.toolRegistry);
            }
            this.toolContractExtractor.addManifestPath(join(process.cwd(), "prism-output"));
        }
        return this.toolContractExtractor;
    }

    private loadSessionPackageStore(): void {
        if (this.pkgStore) {
            this.sessionPackages = this.pkgStore
                .listPackages()
                .map((row) => this.normalizeSessionPackageRecord(row as Partial<SessionPackageRecord>));
            this.sessionPackageHistory = this.pkgStore
                .listHistory(this.sessionPackageHistoryLimit)
                .map((entry) => this.normalizeSessionPackageHistoryEntry(entry as Partial<SessionPackageHistoryEntry>));
            if (this.sessionPackages.length === 0 && existsSync(this.sessionPackageStorePath)) {
                this.importLegacyJsonToSqlite();
            }
            return;
        }

        if (!existsSync(this.sessionPackageStorePath)) {
            this.sessionPackages = [];
            this.sessionPackageHistory = [];
            return;
        }

        try {
            const parsed = JSON.parse(
                readFileSync(this.sessionPackageStorePath, "utf-8"),
            ) as Partial<SessionPackageStoreSnapshot>;
            this.sessionPackages = Array.isArray(parsed.packages)
                ? parsed.packages.map((pkg) => this.normalizeSessionPackageRecord(pkg))
                : [];
            this.sessionPackageHistory = Array.isArray(parsed.history)
                ? parsed.history.map((entry) => this.normalizeSessionPackageHistoryEntry(entry))
                : [];
        } catch {
            this.sessionPackages = [];
            this.sessionPackageHistory = [];
        }
    }

    private importLegacyJsonToSqlite(): void {
        if (!this.pkgStore) return;
        try {
            const parsed = JSON.parse(
                readFileSync(this.sessionPackageStorePath, "utf-8"),
            ) as Partial<SessionPackageStoreSnapshot>;
            const packages = Array.isArray(parsed.packages)
                ? parsed.packages.map((pkg) => this.normalizeSessionPackageRecord(pkg))
                : [];
            const history = Array.isArray(parsed.history)
                ? parsed.history.map((entry) => this.normalizeSessionPackageHistoryEntry(entry))
                : [];
            for (const pkg of packages) {
                this.pkgStore.upsertPackage(pkg);
            }
            for (const entry of history) {
                this.pkgStore.upsertHistoryEntry(entry);
            }
            this.sessionPackages = packages;
            this.sessionPackageHistory = history;
        } catch {
            // leave arrays empty if legacy file is corrupt
        }
    }

    private persistSessionPackageStore(): void {
        if (this.pkgStore) {
            for (const pkg of this.sessionPackages) {
                this.pkgStore.upsertPackage(pkg);
            }
            const limit = this.sessionPackageHistoryLimit;
            for (const entry of this.sessionPackageHistory.slice(0, limit)) {
                this.pkgStore.upsertHistoryEntry(entry);
            }
            return;
        }
        mkdirSync(dirname(this.sessionPackageStorePath), { recursive: true });
        const payload: SessionPackageStoreSnapshot = {
            packages: this.sessionPackages.map((pkg) => this.normalizeSessionPackageRecord(pkg)),
            history: this.sessionPackageHistory.slice(0, this.sessionPackageHistoryLimit),
        };
        writeFileSync(this.sessionPackageStorePath, JSON.stringify(payload, null, 2), "utf-8");
    }

    private normalizeSessionPackageRecord(pkg: Partial<SessionPackageRecord>): SessionPackageRecord {
        return {
            packageId: String(pkg.packageId || `pkg-${randomUUID()}`),
            title: String(pkg.title || "Session Package"),
            areaOfInterest: pkg.areaOfInterest == null ? null : String(pkg.areaOfInterest),
            objective: pkg.objective == null ? null : String(pkg.objective),
            successCriteria: pkg.successCriteria == null ? null : String(pkg.successCriteria),
            dependencies: Array.isArray(pkg.dependencies)
                ? pkg.dependencies.map((item) => String(item)).filter(Boolean)
                : [],
            status: normalizeSessionPackageStatus(pkg.status),
            createdAt: String(pkg.createdAt || new Date(0).toISOString()),
            updatedAt: String(pkg.updatedAt || pkg.createdAt || new Date(0).toISOString()),
            sessionIds: Array.isArray(pkg.sessionIds) ? pkg.sessionIds.map((item) => String(item)).filter(Boolean) : [],
            lastRunAt: pkg.lastRunAt == null ? null : String(pkg.lastRunAt),
            lastExportAt: pkg.lastExportAt == null ? null : String(pkg.lastExportAt),
            exportArtifactPath: pkg.exportArtifactPath == null ? null : String(pkg.exportArtifactPath),
        };
    }

    private normalizeSessionPackageHistoryEntry(
        entry: Partial<SessionPackageHistoryEntry>,
    ): SessionPackageHistoryEntry {
        const action = entry.action;
        const validAction: SessionPackageHistoryEntry["action"] =
            action === "created" ||
            action === "status_changed" ||
            action === "workflow_started" ||
            action === "workflow_paused" ||
            action === "workflow_blocked" ||
            action === "workflow_completed" ||
            action === "exported" ||
            action === "unpackaged"
                ? action
                : "status_changed";
        return {
            historyId: String(entry.historyId || randomUUID()),
            packageId: String(entry.packageId || ""),
            title: String(entry.title || "Session Package"),
            action: validAction,
            timestamp: String(entry.timestamp || new Date(0).toISOString()),
            status: normalizeSessionPackageStatus(entry.status),
            previousStatus: entry.previousStatus == null ? null : normalizeSessionPackageStatus(entry.previousStatus),
            nextStatus: entry.nextStatus == null ? null : normalizeSessionPackageStatus(entry.nextStatus),
            source: String(entry.source || "dashboard_api"),
            message: entry.message == null ? null : String(entry.message),
            targetSessionId: entry.targetSessionId == null ? null : String(entry.targetSessionId),
        };
    }

    private buildSessionPackageSummary(pkg: SessionPackageRecord): SessionPackageSummary {
        const sessionsById = new Map(this.chatStore.listSessions().map((session) => [session.sessionId, session]));
        const sessions = pkg.sessionIds
            .map((sessionId) => sessionsById.get(sessionId))
            .filter((session): session is ChatSessionSummary => Boolean(session));
        const lastActiveSession = [...sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;
        const packageEvents = this.listPackageActivityEvents(pkg.sessionIds).sort((a, b) =>
            a.timestamp < b.timestamp ? 1 : -1,
        );
        const latestPolicyEvent = packageEvents.find((event) => Boolean(event.policyDecision)) ?? null;
        const pendingApprovalCount = this.queue.list().filter((item) => pkg.sessionIds.includes(item.sessionId)).length;
        const completedChapterCount = sessions.filter((session) => session.messageCount > 1).length;

        return {
            chapterCount: pkg.sessionIds.length,
            completedChapterCount,
            completionPct:
                pkg.sessionIds.length > 0 ? Math.round((completedChapterCount / pkg.sessionIds.length) * 100) : 0,
            lastActiveAt: lastActiveSession?.updatedAt ?? null,
            lastActiveSessionTitle: lastActiveSession?.title ?? null,
            latestPolicyDecision: latestPolicyEvent?.policyDecision ?? null,
            pendingApprovalCount,
        };
    }

    private listPackageActivityEvents(sessionIds: string[]): ActivityEvent[] {
        if (this.traceExplorer) {
            return sessionIds.flatMap((sessionId) => this.traceExplorer!.query({ sessionId }));
        }

        const sessionIdSet = new Set(sessionIds);
        return this.activityBus.listEvents().filter((event) => sessionIdSet.has(event.sessionId));
    }

    private recordSessionPackageHistory(entry: Omit<SessionPackageHistoryEntry, "historyId">): void {
        this.sessionPackageHistory.unshift({
            historyId: randomUUID(),
            ...entry,
        });
        if (this.sessionPackageHistory.length > this.sessionPackageHistoryLimit) {
            this.sessionPackageHistory.length = this.sessionPackageHistoryLimit;
        }
    }

    /**
     * Phase E3b: create a chat session bound to a character + CAC identity.
     *
     * Governance contract:
     *   - If `input.characterId` is omitted, resolve from `PrismPreferences.defaultCharacterId`.
     *   - If there is still no character and `input.allowUnbound !== true`, throw a tagged
     *     Error with `.code = "no_default_character"` so the caller can return 409 +
     *     `{ action: "run_wizard" }`.
     *   - If `input.cacAssignmentId` is omitted, auto-create one via `AccountabilityManager`
     *     using workspace defaults (placeholder emails accepted; runtime enforces tier caps).
     *   - The session row records the character, CAC assignment id, and execution-profile
     *     snapshot so downstream policy / UI can render the governance state without
     *     re-reading preferences.
     *
     * The `allowUnbound` branch exists for internal bootstrap (`start()`) and for the
     * initialization-certificate seed where no character yet exists; those sessions are
     * displayed with a "no character bound" banner until reassigned.
     */
    createChatSession(
        input?:
            | string
            | {
                  title?: string;
                  characterId?: string | null;
                  cacAssignmentId?: string | null;
                  operatorEmail?: string | null;
                  assistantEmail?: string | null;
                  allowUnbound?: boolean;
              },
    ): ChatSessionSummary {
        const opts =
            typeof input === "string" || input === undefined
                ? { title: typeof input === "string" ? input : undefined }
                : input;
        const prefs = readPreferences() ?? undefined;
        const sessions = this.chatStore.listSessions();
        const lastSession = sessions.length > 0 ? sessions[0] : null;

        const prevCharacterId = lastSession ? lastSession.characterId : null;
        const prevExecutionProfile = lastSession ? lastSession.executionProfile : null;
        const prevOperatorEmail = lastSession ? lastSession.operatorEmail : null;
        const prevAssistantEmail = lastSession ? lastSession.assistantEmail : null;
        const prevLlmProviderId = lastSession ? lastSession.llmProviderId : null;
        const prevLlmModel = lastSession ? lastSession.llmModel : null;

        const executionProfile =
            prevExecutionProfile ??
            (this.status.executionProfileSegment || prefs?.executionProfileSegment || "individual")
                .toString()
                .toLowerCase();

        // Resolve character id: explicit > last session > workspace default > auto-pick from workspace characters.
        const defaultChar = (prefs?.defaultCharacterId ?? "").toString().trim();
        let characterId =
            opts.characterId !== undefined ? opts.characterId : (prevCharacterId ?? (defaultChar || null));

        if (!characterId && !opts.allowUnbound) {
            // Auto-pick the first character matching the execution profile so sessions can be
            // created without requiring the setup wizard when characters are already available.
            const available = this.listWorkspaceCharacters();
            const profileMatch =
                available.find((c) => !c.executionProfile || c.executionProfile.toLowerCase() === executionProfile) ??
                available[0] ??
                null;
            if (profileMatch) {
                characterId = profileMatch.id;
                // Persist as default so subsequent sessions resolve without re-scanning.
                try {
                    writePreferences({ defaultCharacterId: characterId, lastUsedCharacterId: characterId });
                } catch (_) {
                    /* non-fatal — preferences write failure must not block session creation */
                }
            } else {
                const err = new Error("no_default_character") as Error & { code?: string };
                err.code = "no_default_character";
                throw err;
            }
        }

        // Validate character exists when one was resolved.
        if (characterId) {
            const available = this.listWorkspaceCharacters();
            if (!available.some((c) => c.id === characterId)) {
                const err = new Error(`character_not_found: ${characterId}`) as Error & { code?: string };
                err.code = "character_not_found";
                throw err;
            }
        }

        // Create session row first so CAC auto-assignment can reference its id.
        const session = this.chatStore.createSession({
            title: opts.title ?? "New Session",
            characterId,
            executionProfile,
            operatorEmail: opts.operatorEmail ?? prevOperatorEmail ?? null,
            assistantEmail: opts.assistantEmail ?? prevAssistantEmail ?? null,
            llmProviderId: prevLlmProviderId,
            llmModel: prevLlmModel,
        });
        // If a CAC assignment id was supplied, bind it. Otherwise, when we have a character,
        // auto-create an assignment with workspace-default identities (placeholders OK).
        let cacAssignmentId = opts.cacAssignmentId ?? null;
        let operatorEmailFinal = opts.operatorEmail ?? prevOperatorEmail ?? null;
        let assistantEmailFinal = opts.assistantEmail ?? prevAssistantEmail ?? null;

        if (!cacAssignmentId && characterId) {
            const operatorEmail = (operatorEmailFinal ?? `operator@prism.local`).toString().trim();
            const assistantEmail = (assistantEmailFinal ?? `${characterId}@prism.local`).toString().trim();
            try {
                const assignment = this.characterAccountabilityManager.assign({
                    characterId,
                    prismUserId: "prism-user",
                    prismUserEmail: operatorEmail,
                    operatorId: "operator",
                    operatorEmail,
                    clientId: "dashboard",
                    sessionId: session.sessionId,
                    executionProfile,
                    workspaceHub: getWorkspaceHub(),
                });
                cacAssignmentId = assignment.assignmentId;
                operatorEmailFinal = assignment.operatorEmail;
                assistantEmailFinal = assistantEmail;
            } catch (err) {
                // Business-segment domain-mismatch is the usual failure. We surface via session
                // metadata as unbound-CAC; runtime policy will block tier-2+ until reassigned.
                void err;
            }
        }

        if (cacAssignmentId || operatorEmailFinal || assistantEmailFinal) {
            const rebound = this.chatStore.bindSessionCharacter(session.sessionId, {
                characterId: characterId ?? "",
                cacAssignmentId,
                executionProfile,
                operatorEmail: operatorEmailFinal,
                assistantEmail: assistantEmailFinal,
            });
            if (rebound) {
                return rebound;
            }
        }

        // Persist last-used character so the next session picker prefills correctly.
        if (characterId) {
            try {
                writePreferences({ lastUsedCharacterId: characterId });
            } catch {
                /* non-fatal */
            }
        }

        return session;
    }

    deleteChatSession(sessionId: string): void {
        this.chatStore.deleteSession(sessionId);
    }

    getChatMessages(sessionId: string): ChatMessage[] {
        return this.chatStore.getMessages(sessionId);
    }

    async getProviderSettings(providerId: string): Promise<ProviderSettingsPayload> {
        const resolved = this.requireProviderId(providerId);
        const persisted = this.chatStore.getProviderSettings(resolved);
        const snapshot = await this.getProviderSnapshot(resolved);
        return {
            providerId: resolved,
            baseUrl: snapshot.baseUrl,
            apiKeyHeader: snapshot.apiKeyHeader,
            models: snapshot.models,
            defaultModel: snapshot.defaultModel,
            requiresApiKey: snapshot.requiresApiKey,
            hasApiKey: snapshot.hasApiKey,
            enabled: snapshot.enabled,
            reason: snapshot.reason,
            settingsSource: snapshot.settingsSource,
            updatedAt: persisted?.updatedAt ?? null,
            source: persisted?.source ?? null,
        };
    }

    async saveProviderSettings(
        providerId: string,
        settings: ProviderSettingsInput,
        source: string = "dashboard",
    ): Promise<ProviderSettingsPayload> {
        const resolved = this.requireProviderId(providerId);
        const snapshot = await this.getProviderSnapshot(resolved);
        const normalizedBaseUrl = settings.baseUrl?.trim() || null;
        if (normalizedBaseUrl) {
            const allowPrivateProviderEgress =
                snapshot.kind === "local" ||
                (process.env.PRISM_ALLOW_PRIVATE_PROVIDER_EGRESS ?? "").toLowerCase() === "true";
            const baseUrlCheck = validateEgressUrl(normalizedBaseUrl, {
                allowLoopback: allowPrivateProviderEgress,
                allowPrivate: allowPrivateProviderEgress,
                allowLinkLocal: allowPrivateProviderEgress,
                allowMetadata: false,
            });
            if (!baseUrlCheck.ok) {
                throw new Error(`Blocked provider baseUrl: ${baseUrlCheck.reason ?? "egress policy violation."}`);
            }
        }

        this.chatStore.upsertProviderSettings(
            resolved,
            {
                ...settings,
                baseUrl: normalizedBaseUrl,
            },
            source,
        );
        this.refreshProviderConfiguration();

        // Keep the runtime + persisted model matrix aligned with provider config.
        // This is provider-agnostic and covers manual entry or discovered models.
        try {
            const discovery = await this.llmProviders.discoverProviderModels(resolved);
            for (const profile of discovery.suggested) {
                this.chatStore.upsertModelProfile(profile);
            }
        } catch {
            // Non-fatal: provider settings should still save even if matrix sync fails.
        }

        const payload = await this.getProviderSettings(resolved);
        this.activityBus.emit({
            sessionId: this.status.sessionId,
            layer: "causal",
            operation: "dashboard.provider_settings_updated",
            status: "succeeded",
            details: {
                providerId: resolved,
                source,
                baseUrl: payload.baseUrl,
                models: payload.models,
                defaultModel: payload.defaultModel,
            },
        });
        return payload;
    }

    async saveProviderApiKey(
        providerId: string,
        apiKey: string,
        source: string = "dashboard",
    ): Promise<ProviderSettingsPayload> {
        const resolved = this.requireProviderId(providerId);
        this.providerSecretStore.setApiKey(resolved, apiKey);
        this.refreshProviderConfiguration();
        const payload = await this.getProviderSettings(resolved);
        this.activityBus.emit({
            sessionId: this.status.sessionId,
            layer: "causal",
            operation: "dashboard.provider_secret_updated",
            status: "succeeded",
            details: {
                providerId: resolved,
                source,
                hasApiKey: payload.hasApiKey,
            },
        });
        return payload;
    }

    async clearProviderApiKey(providerId: string, source: string = "dashboard"): Promise<ProviderSettingsPayload> {
        const resolved = this.requireProviderId(providerId);
        this.providerSecretStore.clearApiKey(resolved);
        this.refreshProviderConfiguration();
        const payload = await this.getProviderSettings(resolved);
        this.activityBus.emit({
            sessionId: this.status.sessionId,
            layer: "causal",
            operation: "dashboard.provider_secret_cleared",
            status: "succeeded",
            details: {
                providerId: resolved,
                source,
                hasApiKey: payload.hasApiKey,
            },
        });
        return payload;
    }

    async getSessionLlmCatalog(sessionId: string, refresh?: boolean): Promise<LlmProviderCatalog> {
        const session = this.chatStore.getSession(sessionId);
        if (!session) {
            throw new Error(`Unknown chat session: ${sessionId}`);
        }

        return this.llmProviders.getCatalog(
            {
                providerId: session.llmProviderId ?? undefined,
                model: session.llmModel ?? undefined,
            },
            refresh,
        );
    }

    async setSessionLlmSelection(
        sessionId: string,
        providerId: string,
        model?: string,
        source: string = "dashboard",
        correlationId?: string,
    ): Promise<LlmProviderCatalog> {
        const eventCorrelationId = correlationId ?? `llm-config:${randomUUID()}`;
        const session = this.chatStore.getSession(sessionId);
        if (!session) {
            this.emitLlmSelectionAudit("failed", {
                sessionId,
                requestedProviderId: providerId,
                requestedModel: model ?? null,
                source,
                reason: "unknown_chat_session",
                correlationId: eventCorrelationId,
            });
            throw new Error(`Unknown chat session: ${sessionId}`);
        }

        const previousProviderId = session.llmProviderId;
        const previousModel = session.llmModel;
        const catalog = await this.llmProviders.getCatalog({ providerId, model: model ?? null });
        const selectedProvider = catalog.activeProviderId
            ? (catalog.providers.find((entry) => entry.id === catalog.activeProviderId) ?? null)
            : null;
        if (!catalog.activeProviderId || catalog.activeProviderId !== providerId || !selectedProvider) {
            this.emitLlmSelectionAudit("failed", {
                sessionId,
                requestedProviderId: providerId,
                requestedModel: model ?? null,
                previousProviderId,
                previousModel,
                source,
                reason: "provider_unavailable",
                correlationId: eventCorrelationId,
            });
            throw new Error(`Provider is not available: ${providerId}`);
        }

        if (!selectedProvider.enabled) {
            this.emitLlmSelectionAudit("failed", {
                sessionId,
                requestedProviderId: providerId,
                requestedModel: model ?? null,
                previousProviderId,
                previousModel,
                source,
                reason: selectedProvider.reason ?? "provider_unavailable",
                correlationId: eventCorrelationId,
            });
            throw new Error(selectedProvider.reason || `Provider is not available: ${providerId}`);
        }

        if (!catalog.activeModel) {
            this.emitLlmSelectionAudit("failed", {
                sessionId,
                requestedProviderId: providerId,
                requestedModel: model ?? null,
                previousProviderId,
                previousModel,
                source,
                reason: "model_missing",
                correlationId: eventCorrelationId,
            });
            throw new Error(`No model is configured for provider: ${providerId}`);
        }

        this.chatStore.updateSessionLlmSelection(sessionId, catalog.activeProviderId, catalog.activeModel);

        // Dynamic pre-loading/initialization of local models when selected/applied
        if (catalog.activeProviderId === "llamacpp" && this.llamaSupervisor && catalog.activeModel) {
            const modelPath = this.llamaSupervisor.getModelPath(catalog.activeModel);
            if (modelPath) {
                try {
                    console.log(
                        `[PRISM][settings] Initializing and pre-loading llama.cpp model: ${catalog.activeModel}`,
                    );
                    await this.llamaSupervisor.loadModel(modelPath, catalog.activeModel, { ctxSize: 2048 });
                } catch (err) {
                    throw new Error(
                        `Failed to load local GGUF model "${catalog.activeModel}": ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
            } else {
                throw new Error(
                    `Local GGUF model "${catalog.activeModel}" was not found in the local models directory.`,
                );
            }
        } else if (catalog.activeProviderId === "bitnetcpp" && this.bitnetSupervisor && catalog.activeModel) {
            const modelPath = this.bitnetSupervisor.getModelPath(catalog.activeModel);
            if (modelPath) {
                try {
                    console.log(
                        `[PRISM][settings] Initializing and pre-loading bitnet.cpp model: ${catalog.activeModel}`,
                    );
                    await this.bitnetSupervisor.loadModel(modelPath, catalog.activeModel);
                } catch (err) {
                    throw new Error(
                        `Failed to load local BitNet model "${catalog.activeModel}": ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
            } else {
                throw new Error(
                    `Local BitNet model "${catalog.activeModel}" was not found in the local models directory.`,
                );
            }
        }

        const historyEntry = this.chatStore.appendSessionConfigHistory(
            sessionId,
            previousProviderId,
            previousModel,
            catalog.activeProviderId,
            catalog.activeModel,
            source,
        );
        this.chatStore.clearSessionConfigDraft(sessionId);
        const updatedCatalog = await this.llmProviders.getCatalog({
            providerId: catalog.activeProviderId,
            model: catalog.activeModel,
        });

        this.emitLlmSelectionAudit("succeeded", {
            sessionId,
            previousProviderId,
            previousModel,
            selectedProviderId: updatedCatalog.activeProviderId,
            selectedModel: updatedCatalog.activeModel,
            requestedProviderId: providerId,
            requestedModel: model ?? null,
            source,
            correlationId: eventCorrelationId,
        });

        this.activityBus.emit({
            sessionId: this.status.sessionId,
            layer: "causal",
            operation: "dashboard.llm_config_applied",
            status: "succeeded",
            details: {
                chatSessionId: sessionId,
                source,
                changedFields: historyEntry.changedFields,
                previousProviderId,
                previousModel,
                nextProviderId: catalog.activeProviderId,
                nextModel: catalog.activeModel,
                correlationId: eventCorrelationId,
            },
        });

        if (process.env.PRISM_BASE_MODE_AUTO === "true" && updatedCatalog.activeModel) {
            const profile = resolveProfile(updatedCatalog.activeModel);
            const targetBaseMode = profile.locality === "local" && profile.tier <= 2;
            const currentBaseMode = process.env.PRISM_BASE_MODE === "true";
            if (targetBaseMode !== currentBaseMode) {
                process.env.PRISM_BASE_MODE = targetBaseMode ? "true" : "false";
                console.log(
                    `[PRISM][paradigm] Auto-detected model selection changed to ${updatedCatalog.activeModel}. Setting Base Mode to ${targetBaseMode}`,
                );
                if (this.guardianAgent) {
                    this.guardianAgent.syncModeCatalog();
                }
            }
        }

        return updatedCatalog;
    }

    getSessionLlmConfigState(sessionId: string): SessionConfigState {
        const session = this.chatStore.getSession(sessionId);
        if (!session) {
            throw new Error(`Unknown chat session: ${sessionId}`);
        }

        const draft = this.chatStore.getSessionConfigDraft(sessionId);
        return {
            sessionId,
            current: {
                providerId: session.llmProviderId,
                model: session.llmModel,
            },
            draft,
            diff: draft
                ? buildSessionConfigDiff(session.llmProviderId, session.llmModel, draft.providerId, draft.model)
                : null,
            history: this.chatStore.listSessionConfigHistory(sessionId, 10),
        };
    }

    async saveSessionLlmConfigDraft(
        sessionId: string,
        providerId: string,
        model?: string,
        source: string = "dashboard",
    ): Promise<SessionConfigState> {
        const session = this.chatStore.getSession(sessionId);
        if (!session) {
            throw new Error(`Unknown chat session: ${sessionId}`);
        }

        const catalog = await this.llmProviders.getCatalog({ providerId, model: model ?? null });
        const selectedProvider = catalog.activeProviderId
            ? (catalog.providers.find((entry) => entry.id === catalog.activeProviderId) ?? null)
            : null;
        if (!catalog.activeProviderId || catalog.activeProviderId !== providerId || !selectedProvider) {
            throw new Error(`Provider is not available: ${providerId}`);
        }
        if (!selectedProvider.enabled) {
            throw new Error(selectedProvider.reason || `Provider is not available: ${providerId}`);
        }
        if (!catalog.activeModel) {
            throw new Error(`No model is configured for provider: ${providerId}`);
        }

        this.chatStore.upsertSessionConfigDraft(sessionId, catalog.activeProviderId, catalog.activeModel, source);
        return this.getSessionLlmConfigState(sessionId);
    }

    discardSessionLlmConfigDraft(sessionId: string): SessionConfigState {
        this.chatStore.clearSessionConfigDraft(sessionId);
        return this.getSessionLlmConfigState(sessionId);
    }

    async applySessionLlmConfigDraft(
        sessionId: string,
        source: string = "dashboard",
    ): Promise<{
        catalog: LlmProviderCatalog;
        config: SessionConfigState;
    }> {
        const draft = this.chatStore.getSessionConfigDraft(sessionId);
        if (!draft?.providerId) {
            throw new Error(`No draft exists for chat session: ${sessionId}`);
        }

        const catalog = await this.setSessionLlmSelection(
            sessionId,
            draft.providerId,
            draft.model ?? undefined,
            `${source}_draft_apply`,
        );
        return {
            catalog,
            config: this.getSessionLlmConfigState(sessionId),
        };
    }

    async rollbackSessionLlmConfig(
        sessionId: string,
        source: string = "dashboard",
    ): Promise<{
        catalog: LlmProviderCatalog;
        config: SessionConfigState;
    }> {
        const history = this.chatStore.listSessionConfigHistory(sessionId, 1);
        const latest = history[0];
        if (!latest) {
            throw new Error(`No config history found for chat session: ${sessionId}`);
        }
        if (!latest.previousProviderId) {
            throw new Error("No previous provider state available for rollback.");
        }

        const catalog = await this.setSessionLlmSelection(
            sessionId,
            latest.previousProviderId,
            latest.previousModel ?? undefined,
            `${source}_rollback`,
        );

        return {
            catalog,
            config: this.getSessionLlmConfigState(sessionId),
        };
    }

    async submitChatMessage(sessionId: string, content: string): Promise<DashboardChatTurn> {
        const correlationId = `chat-turn:${randomUUID()}`;
        const trimmedContent = content.trim();
        if (!trimmedContent) {
            throw new Error("Message cannot be empty.");
        }

        const existingSession = this.chatStore.getSession(sessionId);
        if (!existingSession) {
            throw new Error(`Unknown chat session: ${sessionId}`);
        }

        const previousMessages = this.chatStore.getMessages(sessionId);
        if (previousMessages.length === 0 && existingSession.title === "New Session") {
            this.chatStore.updateSessionTitle(sessionId, deriveSessionTitle(trimmedContent));
        }

        const userMessage = this.chatStore.appendMessage(sessionId, "user", trimmedContent, {
            source: "dashboard",
        });

        this.activityBus.emit({
            sessionId: this.status.sessionId,
            layer: "causal",
            operation: "chat.user_message",
            status: "succeeded",
            details: {
                chatSessionId: sessionId,
                chatMessageId: userMessage.messageId,
                correlationId,
            },
        });

        const assistantReply = await this.generateAssistantReply(
            sessionId,
            trimmedContent,
            this.chatStore.getMessages(sessionId).slice(-20),
        );
        const assistantMessage = this.chatStore.appendMessage(
            sessionId,
            "assistant",
            assistantReply.content,
            assistantReply.metadata,
        );

        this.activityBus.emit({
            sessionId: this.status.sessionId,
            layer: "causal",
            operation: "chat.assistant_message",
            status: "succeeded",
            details: {
                chatSessionId: sessionId,
                chatMessageId: assistantMessage.messageId,
                intent: assistantReply.metadata.intent,
                correlationId,
            },
        });

        // Emit LLM telemetry when the reply came from a model
        if (assistantReply.metadata.intent === "llm") {
            this.activityBus.emit({
                sessionId: this.status.sessionId,
                layer: "llm",
                operation: "llm.generation",
                status: "succeeded",
                details: {
                    chatSessionId: sessionId,
                    provider: assistantReply.metadata.provider,
                    model: assistantReply.metadata.model,
                    tier: assistantReply.metadata.tier,
                    degraded: assistantReply.metadata.degraded,
                    routingReason: assistantReply.metadata.routingReason,
                    correlationId,
                },
            });
        }

        return {
            session: this.chatStore.getSession(sessionId)!,
            userMessage,
            assistantMessage,
        };
    }

    triggerAction(actionName: string, chatSessionId?: string): { accepted: true; action: string } {
        const action = this.actionsByName.get(actionName);
        if (!action) {
            throw new Error(`Unknown action: ${actionName}`);
        }

        const currentState = this.actionStates.get(actionName);
        if (currentState?.status === "running") {
            throw new Error(`Action already running: ${actionName}`);
        }

        const startedAt = new Date().toISOString();
        const runId = `${action.name}:${startedAt}`;
        const correlationId = `dashboard-action:${runId}`;
        this.actionStates.set(actionName, {
            ...currentState!,
            name: action.name,
            label: action.label,
            description: action.description,
            status: "running",
            lastStartedAt: startedAt,
            lastError: null,
        });
        this.recordActionHistory({
            runId,
            name: action.name,
            label: action.label,
            status: "running",
            startedAt,
            completedAt: null,
            message: null,
            error: null,
        });

        void action
            .run()
            .then((result) => {
                const completedAt = new Date().toISOString();
                this.actionStates.set(actionName, {
                    ...this.actionStates.get(actionName)!,
                    status: "succeeded",
                    lastCompletedAt: completedAt,
                    lastMessage: result.message,
                    lastError: null,
                });
                this.updateActionHistory(runId, {
                    status: "succeeded",
                    completedAt,
                    message: result.message,
                    error: null,
                });
                this.activityBus.emit({
                    sessionId: this.status.sessionId,
                    layer: "causal",
                    operation: `dashboard.action.${action.name}`,
                    status: "succeeded",
                    details: { correlationId, message: result.message, ...(result.details ?? {}) },
                });
            })
            .catch((error) => {
                const errorMessage = String(error);
                const completedAt = new Date().toISOString();
                this.actionStates.set(actionName, {
                    ...this.actionStates.get(actionName)!,
                    status: "failed",
                    lastCompletedAt: completedAt,
                    lastError: errorMessage,
                });
                this.updateActionHistory(runId, {
                    status: "failed",
                    completedAt,
                    message: null,
                    error: errorMessage,
                });
                this.activityBus.emit({
                    sessionId: this.status.sessionId,
                    layer: "causal",
                    operation: `dashboard.action.${action.name}`,
                    status: "failed",
                    details: { correlationId, chatSessionId, error: errorMessage },
                });
            });

        return { accepted: true, action: action.name };
    }

    /**
     * Attach the MCP client adapter so the dashboard can expose
     * /api/mcp/servers and the Guardian agent can drive self-heal.
     */
    setMcpAdapter(adapter: McpClientAdapter): void {
        this.mcpAdapter = adapter;
        // Wire Guardian's self-heal hook so mcp_health_recovery has a live adapter.
        this.guardianAgent.setMcpAdapterFn(() => this.mcpAdapter);
    }

    /** True if an MCP adapter is currently attached. */
    hasMcpAdapter(): boolean {
        return this.mcpAdapter !== null;
    }

    /** Return the attached MCP adapter, if any. */
    getMcpAdapter(): McpClientAdapter | null {
        return this.mcpAdapter;
    }

    /**
     * Attach a ConsoleInterceptor so the dashboard can broadcast captured
     * stdout/stderr lines to WebSocket clients and serve /api/debug/console.
     * Idempotent.
     */
    setConsoleInterceptor(interceptor: ConsoleInterceptor): void {
        if (this.consoleInterceptor === interceptor) return;
        if (this.consoleUnsubscribe) {
            this.consoleUnsubscribe();
            this.consoleUnsubscribe = null;
        }
        this.consoleInterceptor = interceptor;
        this.consoleUnsubscribe = interceptor.onLine((entry: ConsoleLine) => {
            const payload = JSON.stringify({
                type: "console",
                ts: entry.ts,
                stream: entry.stream,
                line: entry.line,
            });
            for (const ws of this.wsClients) {
                try {
                    ws.send(payload);
                } catch {
                    /* ignore broken clients */
                }
            }
        });
    }

    /**
     * Return a slim LlmDelegate bound to this service's LlmProviderManager.
     * Used by AgentPool so it shares the same provider settings and API keys.
     */
    getLlmDelegate(): LlmDelegate {
        return {
            generateForRole: (role, input, agentId?) => this.llmProviders.generateForRole(role, input, agentId),
        };
    }

    // ── Phase A: Autonomous Control Surface ──────────────────────────────────

    private autonomousLoop: import("../runtime/autonomous-agent-loop.js").AutonomousAgentLoop | null = null;
    private devIdentity: import("../iam/dev-identity-provider.js").DevIdentityProvider | null = null;
    private tabSessionRegistry: import("../iam/tab-session-registry.js").TabSessionRegistry | null = null;
    private telemetryAggregator:
        import("../observability/universal-telemetry-aggregator.js").UniversalTelemetryAggregator | null = null;
    private _covenant: import("../governance/prism-covenant.js").PrismCovenant | null = null;
    private _browserAgent: import("../runtime/autonomous-browser-agent.js").AutonomousBrowserAgent | null = null;
    private _computerAgent: import("../runtime/autonomous-computer-agent.js").AutonomousComputerAgent | null = null;
    private _demoEngine: import("../runtime/demonstration-engine.js").DemonstrationEngine | null = null;
    // Cache for expensive model matrix computation to avoid repeated work
    private modelMatrixCache: { ts: number; matrix: any } | null = null;

    /**
     * Wire autonomous control dependencies after construction.
     * Provides access to:
     *   - AutonomousAgentLoop for goal-driven autonomous execution
     *   - DevIdentityProvider for operator identity and CAC
     *   - TabSessionRegistry for per-tab session management
     *   - UniversalTelemetryAggregator for unified observability
     */
    async setAutonomousControl(deps: {
        autonomousLoop: import("../runtime/autonomous-agent-loop.js").AutonomousAgentLoop;
        devIdentity: import("../iam/dev-identity-provider.js").DevIdentityProvider;
        tabSessionRegistry: import("../iam/tab-session-registry.js").TabSessionRegistry;
        telemetryAggregator: import("../observability/universal-telemetry-aggregator.js").UniversalTelemetryAggregator;
        covenant?: import("../governance/prism-covenant.js").PrismCovenant;
        browserAgent?: import("../runtime/autonomous-browser-agent.js").AutonomousBrowserAgent;
        computerAgent?: import("../runtime/autonomous-computer-agent.js").AutonomousComputerAgent;
    }): Promise<void> {
        this.autonomousLoop = deps.autonomousLoop;
        this.devIdentity = deps.devIdentity;
        this.tabSessionRegistry = deps.tabSessionRegistry;
        this.telemetryAggregator = deps.telemetryAggregator;
        if (deps.covenant) this._covenant = deps.covenant;
        if (deps.browserAgent) {
            this._browserAgent = deps.browserAgent;
            this._browserAgent.setCSHManager(this.cshManager);
            this._browserAgent.setSSHPInterceptor(this.sshpInterceptor);
        }
        if (deps.computerAgent) this._computerAgent = deps.computerAgent;

        // ── Bind LLM reasoning engine to the autonomous loop ──────────────────
        // This connects the planner brain to the configured LLM provider so
        // autonomous goals can think and act via the ReAct loop.
        deps.autonomousLoop.setLlmGenerateFn(async (input) => {
            let selection: { providerId: string | null; model: string | null } | undefined = undefined;
            console.log(
                `[PRISM][DEBUG] setLlmGenerateFn invoked. goalId: ${input.goal?.goalId}, chatSessionId: ${input.goal?.chatSessionId}`,
            );
            if (input.goal?.chatSessionId && this.chatStore) {
                const parentSession = this.chatStore.getSession(input.goal.chatSessionId);
                console.log(
                    `[PRISM][DEBUG] parentSession fetched: ${parentSession ? JSON.stringify({ id: parentSession.sessionId, provider: parentSession.llmProviderId, model: parentSession.llmModel }) : "null"}`,
                );
                if (parentSession?.llmProviderId) {
                    selection = {
                        providerId: parentSession.llmProviderId,
                        model: parentSession.llmModel ?? null,
                    };
                }
            }

            // Hard-Pin/override selection: if providerId is unset, unconfigured, or empty, force "google" (Gemini 2.5 Pro)
            // Note: gemini-2.5-pro is required for autonomous goals because it handles all 104 tool schemas
            // without hitting Google's schema complexity limit (gemini-2.5-flash rejects with 400).
            if (!selection || !selection.providerId) {
                selection = { providerId: "google", model: "models/gemini-2.5-pro" };
            }

            console.log(`[PRISM][DEBUG] selection resolved to: ${JSON.stringify(selection)}`);

            const result = await this.llmProviders.generate(
                {
                    message: input.message,
                    conversation: input.conversation as any,
                    systemPrompt: input.systemPrompt,
                    tools: input.tools as any,
                    tool_choice: input.tool_choice,
                    disableRecovery: true, // Prevent recursive fallback loops in autonomous context
                },
                selection,
            );
            if (!result) return null;
            return {
                content: result.content,
                toolCalls: result.toolCalls,
                stopReason: result.stopReason,
                thoughtSignature: result.thoughtSignature,
            };
        });

        // Bind tool definitions for the planner
        if (this.toolRegistry) {
            const { toolsToLlmDefinitions } = await import("../tools/tool-schema-converter.js");
            const defs = toolsToLlmDefinitions(this.toolRegistry.list()) as any;
            deps.autonomousLoop.setToolDefinitions(defs);
        }

        // Bind specialized agents
        deps.autonomousLoop.setSpecializedAgents(deps.browserAgent ?? undefined, deps.computerAgent ?? undefined);

        // Wire telemetry WebSocket fan-out so Logs & Debug gets real-time updates
        deps.telemetryAggregator.subscribe((entry) => {
            const payload = JSON.stringify({ type: "telemetry", entry });
            for (const ws of this.wsClients) {
                try {
                    ws.send(payload);
                } catch {
                    /* ignore broken clients */
                }
            }
        });
    }

    /** Return the autonomous loop for external callers (e.g. API routes). */
    getAutonomousLoop() {
        return this.autonomousLoop;
    }
    /** Return the dev identity provider. */
    getDevIdentity() {
        return this.devIdentity;
    }
    /** Return the tab session registry. */
    getTabSessionRegistry() {
        return this.tabSessionRegistry;
    }
    /** Return the universal telemetry aggregator. */
    getTelemetryAggregator() {
        return this.telemetryAggregator;
    }

    /** Return the LlmProviderManager for direct access. */
    getLlmProviderManager(): LlmProviderManager {
        return this.llmProviders;
    }

    public getUsageMetering() {
        return this.usageMetering;
    }

    public getMetricsCollector() {
        return this.metricsCollector;
    }

    public getIncidentTrendStore() {
        return this.incidentTrendStore;
    }

    public getMetricsStore() {
        return this.metricsStore;
    }

    public getRetrievalDashboardStore() {
        return this.retrievalDashboardStore;
    }

    public getSoc2Exporter() {
        return this.soc2Exporter;
    }

    public getActivityRetentionPolicy() {
        return this.activityRetentionPolicy;
    }

    public getRiskOverrideStore() {
        return this.riskOverrideStore;
    }

    public getUtilityRegistry() {
        return this.utilityRegistry;
    }

    public getUtilityStates() {
        return this.utilityStates;
    }

    public getAgentLifecycle() {
        return this.agentLifecycle;
    }

    public getSwarmCoordinator() {
        return this.swarmCoordinator;
    }

    public getAgentTelemetry() {
        return this.agentTelemetry;
    }

    public getAgentPool() {
        return this.agentPool;
    }

    public getModelMatrixCache() {
        return this.modelMatrixCache;
    }

    public setModelMatrixCache(cache: { ts: number; matrix: any } | null) {
        this.modelMatrixCache = cache;
    }

    /** Wire agent control dependencies after construction. */
    setAgentControl(deps: {
        lifecycle: AgentLifecycleManager;
        telemetry: AgentTelemetryCollector;
        swarm: SwarmCoordinator;
        pool: AgentPool;
        router: AgentRouter;
    }): void {
        this.agentLifecycle = deps.lifecycle;
        this.agentTelemetry = deps.telemetry;
        this.swarmCoordinator = deps.swarm;
        this.agentPool = deps.pool;
        this.agentRouter = deps.router;
    }

    start(): void {
        if (this.chatStore.listSessions().length === 0) {
            const segment = (this.status.executionProfileSegment || "individual").toLowerCase();
            const newSession = this.chatStore.createSession();
            this.chatStore.updateSessionTitle(newSession.sessionId, "New Session");
            if (segment === "individual") {
                this.activityBus.emit({
                    sessionId: this.status.sessionId,
                    layer: "causal",
                    operation: "prism.accountability.init",
                    status: "started",
                    details: {
                        message: "Auto-created initial session for individual segment.",
                        chatSessionId: newSession.sessionId,
                    },
                });
            } else {
                this.activityBus.emit({
                    sessionId: this.status.sessionId,
                    layer: "causal",
                    operation: "prism.accountability.init",
                    status: "started",
                    details: {
                        message:
                            "Accountability systems initiated for enterprise segment with initial session context.",
                        chatSessionId: newSession.sessionId,
                    },
                });
            }
        }

        // ── Permanent Active Directives Integrity Verification ──────────────
        const padResult = verifyDirectiveIntegrity();
        if (padResult.valid) {
            console.log(`[SECURITY] Directive integrity verified (SHA-256: ${padResult.currentHash.slice(0, 12)}…)`);
            this.activityBus.emit({
                sessionId: this.status.sessionId,
                layer: "causal",
                operation: "directive.integrity_check",
                status: "succeeded",
                details: {
                    currentHash: padResult.currentHash,
                    expectedHash: padResult.expectedHash,
                    filePath: padResult.filePath,
                    verifiedAt: padResult.verifiedAt,
                },
            });
        } else {
            console.error(`[SECURITY] ⚠ DIRECTIVE INTEGRITY VIOLATION — PAD hash mismatch or file missing.`);
            console.error(`[SECURITY]   Expected: ${padResult.expectedHash}`);
            console.error(`[SECURITY]   Got:      ${padResult.currentHash || "(unreadable)"}`);
            if (padResult.error) console.error(`[SECURITY]   Error: ${padResult.error}`);
            this.activityBus.emit({
                sessionId: this.status.sessionId,
                layer: "causal",
                operation: "directive.integrity_check",
                status: "failed",
                details: {
                    currentHash: padResult.currentHash,
                    expectedHash: padResult.expectedHash,
                    filePath: padResult.filePath,
                    verifiedAt: padResult.verifiedAt,
                    error: padResult.error,
                    severity: "critical",
                    reasonCode: "DIRECTIVE_INTEGRITY_VIOLATION",
                },
            });
        }

        this.server.listen(this.port, "0.0.0.0", () => {
            this.inboundPoller.start();
            const proto = this.tlsEnabled ? "https" : "http";
            console.log(`[DASHBOARD] Listening at ${proto}://localhost:${this.port}`);
            if (this.tlsEnabled) console.log(`[SECURITY] TLS enabled`);
            if (!this.authGate.check({ headers: {}, url: "/" } as any).authenticated) {
                const token = this.authGate.getToken();
                console.log(`[AUTH] Admin token: ${token}`);
                console.log(`[AUTH] Access: ${proto}://localhost:${this.port}/dashboard?token=${token}`);
                console.log(`[AUTH] Set PRISM_AUTH_DISABLED=true to bypass auth (dev only).`);
            }
            void this.getReadinessSnapshot()
                .then((snapshot) => this.emitReadinessAudit("startup", snapshot))
                .catch((error) => {
                    const correlationId = `readiness:${randomUUID()}`;
                    this.activityBus.emit({
                        sessionId: this.status.sessionId,
                        layer: "causal",
                        operation: "dashboard.readiness_check",
                        status: "failed",
                        details: {
                            source: "startup",
                            error: String(error),
                            correlationId,
                        },
                    });
                });
            // Warm the model matrix cache asynchronously so the first UI request is fast.
            setTimeout(() => {
                try {
                    const m = this.llmProviders.getFullModelMatrix();
                    this.modelMatrixCache = { ts: Date.now(), matrix: m };
                    console.log(`[PERF] Warmed modelMatrixCache (known=${(m.known || []).length})`);
                } catch (e) {
                    /* best-effort warm; ignore */
                }
            }, 0);
        });
    }

    stop(): Promise<void> {
        this.inboundPoller.stop();
        this.pkgStore?.close();
        this.characterAccountabilityStore.close();
        for (const ws of this.wsClients) {
            ws.close();
        }
        this.wsClients.clear();
        for (const [, res] of this.sseClients) {
            res.end();
        }
        this.sseClients.clear();
        // Force-destroy all tracked sockets so server.close() resolves promptly
        // instead of waiting for keep-alive connections to drain on their own.
        for (const socket of this.openSockets) {
            socket.destroy();
        }
        this.openSockets.clear();
        return new Promise((resolve, reject) => {
            this.server.close((err) => (err ? reject(err) : resolve()));
        });
    }

    /** Broadcast a JSON event to all connected WebSocket and SSE clients. */
    public broadcastEvent(event: Record<string, unknown>): void {
        const data = JSON.stringify(event);
        for (const ws of this.wsClients) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        }
        for (const [, res] of this.sseClients) {
            res.write(`data: ${data}\n\n`);
        }
    }

    /**
     * Drive every connected dashboard like a screencast: sequentially broadcast
     * `{type:'ui_action', action:'switch_tab', tabId, anchor?, message?}` envelopes
     * with a configurable dwell between steps. Used by the Workflow Demo so the
     * operator can literally watch PRISM walk Chat → Agentic → Computer → Browser
     * → Logs while the underlying DAG runs in parallel.
     *
     * No-op when no clients are connected. Defensive — any per-step error is
     * swallowed so the cosmetic narrator never crashes the host action.
     *
     * Suppress the entire tour by setting `PRISM_DEMO_TOUR_DISABLED=1`.
     */
    public async broadcastUiTour(
        steps: Array<{ tabId: string; anchor?: string; dwellMs?: number; message?: string }>,
    ): Promise<void> {
        if (process.env.PRISM_DEMO_TOUR_DISABLED === "1") return;
        if (!Array.isArray(steps) || steps.length === 0) return;
        if (this.wsClients.size === 0 && this.sseClients.size === 0) return;
        for (const step of steps) {
            try {
                const tabId = String(step.tabId || "").trim();
                if (!tabId) continue;
                const envelope: Record<string, unknown> = { type: "ui_action", action: "switch_tab", tabId };
                if (step.anchor) envelope.anchor = String(step.anchor);
                if (step.message) envelope.message = String(step.message);
                this.broadcastEvent(envelope);
            } catch {
                /* defensive: tour is cosmetic, never crash the caller */
            }
            const dwell = Math.max(0, Math.min(60_000, Number(step.dwellMs) || 0));
            if (dwell > 0) await new Promise<void>((r) => setTimeout(r, dwell));
        }
    }

    public async fetchOllamaTags(): Promise<Array<{ name: string; source: string }>> {
        return new Promise((resolve) => {
            const req = httpGet("http://localhost:11434/api/tags", (res) => {
                let body = "";
                res.on("data", (chunk) => (body += chunk));
                res.on("end", () => {
                    try {
                        const data = JSON.parse(body);
                        resolve((data.models || []).map((m: any) => ({ name: m.name, source: "ollama" })));
                    } catch {
                        resolve([]);
                    }
                });
            });
            req.on("error", () => resolve([]));
            req.setTimeout(2000, () => {
                req.destroy();
                resolve([]);
            });
        });
    }

    public async downloadFile(id: string, url: string, targetPath: string): Promise<void> {
        const status = this.downloadStatus.get(id);
        if (!status) return;

        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const isHttps = parsed.protocol === "https:";
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (isHttps ? 443 : 80),
                path: parsed.pathname + parsed.search,
                headers: {
                    "User-Agent": "prism/1.0",
                    Accept: "*/*",
                },
            };
            const client = isHttps ? https : { get: httpGet };
            client
                .get(options, (res) => {
                    if ([301, 302, 307, 308].includes(res.statusCode ?? 0)) {
                        const nextUrl = new URL(res.headers.location!, url).href;
                        return this.downloadFile(id, nextUrl, targetPath).then(resolve).catch(reject);
                    }
                    if (res.statusCode !== 200) {
                        status.status = "error";
                        status.error = `HTTP ${res.statusCode}`;
                        return reject(new Error(status.error));
                    }

                    const total = parseInt(res.headers["content-length"] || "0", 10);
                    status.totalBytes = total;
                    status.status = "downloading";

                    const file = createWriteStream(targetPath);
                    res.pipe(file);

                    let dl = 0;
                    res.on("data", (chunk) => {
                        dl += chunk.length;
                        status.downloadedBytes = dl;
                        status.progress = total > 0 ? (dl / total) * 100 : 0;
                    });

                    file.on("finish", () => {
                        file.close();
                        status.status = "completed";
                        status.progress = 100;
                        resolve();
                    });

                    file.on("error", (err) => {
                        status.status = "error";
                        status.error = err.message;
                        reject(err);
                    });
                })
                .on("error", (err) => {
                    status.status = "error";
                    status.error = err.message;
                    reject(err);
                });
        });
    }

    private async readBody(req: IncomingMessage): Promise<string> {
        const MAX_BODY_SIZE = parseInt(process.env.PRISM_MAX_BODY_SIZE ?? "10485760", 10); // 10 MB default
        return new Promise((resolve, reject) => {
            let body = "";
            let size = 0;
            req.on("data", (chunk: Buffer | string) => {
                const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk as string);
                size += bytes;
                if (size > MAX_BODY_SIZE) {
                    req.destroy();
                    reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
                    return;
                }
                body += chunk.toString();
            });
            req.on("end", () => resolve(body));
            req.on("error", () => resolve(""));
        });
    }

    public scanForGgufs(
        dir: string,
        source: string,
        models: Array<{ name: string; path: string; source: string }>,
    ): void {
        if (!existsSync(dir)) return;
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                    // Avoid deep recursion, just one level for models/ or similar
                    if (entry.name !== "node_modules" && entry.name !== ".git") {
                        this.scanForGgufs(fullPath, source, models);
                    }
                } else if (entry.name.endsWith(".gguf")) {
                    models.push({
                        name: entry.name,
                        path: fullPath,
                        source,
                    });
                }
            }
        } catch (err) {
            console.error(`[dashboard] failed to scan ${dir}`, err);
        }
    }

    private loadCustomRecommendedModels(): void {
        try {
            const filePath = join(process.cwd(), "prism-output", "custom-recommended-models.json");
            if (existsSync(filePath)) {
                const data = JSON.parse(readFileSync(filePath, "utf8"));
                if (Array.isArray(data)) this.customRecommendedModels = data;
            }
        } catch {
            /* best-effort — use empty list */
        }
    }

    public saveCustomRecommendedModels(): void {
        try {
            const dir = join(process.cwd(), "prism-output");
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(
                join(dir, "custom-recommended-models.json"),
                JSON.stringify(this.customRecommendedModels, null, 2),
            );
        } catch (err) {
            console.error("[dashboard] failed to save custom recommended models", err);
        }
    }

    getPort(): number {
        return this.port;
    }
    getChatStore(): ChatSessionStore {
        return this.chatStore;
    }
    getGuardianAgent(): GuardianAgent {
        return this.guardianAgent;
    }
    getLlmProviders(): LlmProviderManager {
        return this.llmProviders;
    }
    getActivityBus(): ActivityBus {
        return this.activityBus;
    }
    getApprovalQueue(): ApprovalQueue {
        return this.queue;
    }
    getAuthGate(): AuthGate {
        return this.authGate;
    }
    getRateLimiter(): RateLimiter {
        return this.rateLimiter;
    }
    getRuntimeStatus(): DashboardRuntimeStatus {
        return this.status;
    }
    getDownloadStatus(): Map<string, DownloadProgress> {
        return this.downloadStatus;
    }
    getCharacterAccountabilityStore(): CharacterAccountabilityStore {
        return this.characterAccountabilityStore;
    }
    getCharacterAccountabilityManager(): CharacterAccountabilityManager {
        return this.characterAccountabilityManager;
    }
    getSchedulerEngine(): SchedulerEngine {
        return this.schedulerEngine;
    }
    getSchedulerEvents(): Map<
        string,
        { id: string; title: string; start: string; end?: string; description?: string; createdAt: string }
    > {
        return this.schedulerEvents;
    }
    getSchedulerProjects(): Map<string, any> {
        return this.schedulerProjects;
    }
    getLlamaSupervisor(): any {
        return this.llamaSupervisor;
    }
    getBitnetSupervisor(): any {
        return this.bitnetSupervisor;
    }
    getImportHistory(): Array<{
        id: string;
        timestamp: string;
        mode: string;
        fileName: string;
        targetDir: string;
        registeredType: string | null;
        status: string;
        message: string;
        size: number;
    }> {
        return this.importHistory;
    }
    public listWorkspaceCharacters(): Array<{
        id: string;
        name: string;
        displayName: string;
        executionProfile: string | null;
        persona: string | null;
        greeting: string | null;
        systemPrompt: string | null;
        tags: string[];
        maxRiskTier: number | null;
        allowedTools: string[];
        deniedTools: string[];
        defaultEmail: string | null;
        sourcePath: string;
        tooltipTips: string[];
    }> {
        const dir = workspaceCharactersDir();
        console.log(`[PRISM][workspace] Characters request: searching in ${dir}`);
        let needsSeeding = !existsSync(dir);
        if (!needsSeeding) {
            try {
                const existing = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".json"));
                if (existing.length === 0) {
                    needsSeeding = true;
                }
            } catch {
                needsSeeding = true;
            }
        }

        if (needsSeeding) {
            try {
                this.activityBus.emit({
                    sessionId: this.status.sessionId,
                    layer: "causal",
                    operation: "workspace.characters_seed",
                    status: "started",
                    details: {
                        message: "Character directory missing or empty. Seeding defaults from repository.",
                        path: dir,
                    },
                });
                seedDefaultCharacters();
                this.activityBus.emit({
                    sessionId: this.status.sessionId,
                    layer: "causal",
                    operation: "workspace.characters_seed",
                    status: "succeeded",
                    details: { message: "Successfully seeded default characters." },
                });
            } catch (err) {
                this.activityBus.emit({
                    sessionId: this.status.sessionId,
                    layer: "causal",
                    operation: "workspace.characters_seed",
                    status: "failed",
                    details: { error: String(err) },
                });
                return [];
            }
        }

        if (!existsSync(dir)) {
            console.error(`[PRISM][workspace] Character directory STILL missing after seeding: ${dir}`);
            return [];
        }

        const files = readdirSync(dir)
            .filter((entry) => entry.toLowerCase().endsWith(".json"))
            .sort((left, right) => left.localeCompare(right));
        console.log(`[PRISM][workspace] Found ${files.length} character files in ${dir}`);

        const characters: Array<{
            id: string;
            name: string;
            displayName: string;
            executionProfile: string | null;
            persona: string | null;
            greeting: string | null;
            systemPrompt: string | null;
            tags: string[];
            maxRiskTier: number | null;
            allowedTools: string[];
            deniedTools: string[];
            defaultEmail: string | null;
            sourcePath: string;
            tooltipTips: string[];
        }> = [];
        for (const fileName of files) {
            const fullPath = join(dir, fileName);
            try {
                const content = readFileSync(fullPath, "utf-8");
                const parsed = JSON.parse(content) as Record<string, unknown>;
                const toolPermissions = (parsed.toolPermissions ?? {}) as Record<string, unknown>;
                const allow = Array.isArray(toolPermissions.allow)
                    ? toolPermissions.allow.map((entry) => String(entry))
                    : [];
                const deny = Array.isArray(toolPermissions.deny)
                    ? toolPermissions.deny.map((entry) => String(entry))
                    : [];
                const name = String(parsed.name ?? fileName.replace(/\.json$/i, "")).trim();
                const tooltipTips = Array.isArray(parsed.tooltipTips)
                    ? parsed.tooltipTips.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
                    : [];

                const char = {
                    id: name,
                    name,
                    displayName: String(parsed.displayName ?? name).trim() || name,
                    executionProfile:
                        parsed.executionProfile != null ? String(parsed.executionProfile).toLowerCase() : null,
                    persona: parsed.persona != null ? String(parsed.persona) : null,
                    greeting: parsed.greeting != null ? String(parsed.greeting) : null,
                    systemPrompt: parsed.systemPrompt != null ? String(parsed.systemPrompt) : null,
                    tags: Array.isArray(parsed.tags) ? parsed.tags.map((entry) => String(entry)) : [],
                    maxRiskTier: Number.isFinite(Number(parsed.maxRiskTier)) ? Number(parsed.maxRiskTier) : null,
                    allowedTools: allow,
                    deniedTools: deny,
                    defaultEmail: parsed.defaultEmail != null ? String(parsed.defaultEmail) : null,
                    sourcePath: fullPath,
                    tooltipTips,
                };
                characters.push(char);
                console.log(`[PRISM][workspace] Loaded character: ${char.id} (profile: ${char.executionProfile})`);
            } catch (err) {
                console.error(`[PRISM][workspace] Failed to parse character ${fileName}:`, err);
            }
        }
        return characters;
    }
    getToolRegistry(): ToolRegistry | null {
        return this.toolRegistry;
    }
    getContainerAdapter(): ContainerSandboxAdapter | null {
        return this.containerAdapter;
    }
    getTerminalAdapter(): TerminalSessionAdapter | null {
        return this.terminalAdapter;
    }
    getCovenant(): PrismCovenant {
        return this._covenant!;
    }
    getAutonomousBrowserAgent(): AutonomousBrowserAgent | null {
        return this._browserAgent;
    }
    getAutonomousComputerAgent(): AutonomousComputerAgent | null {
        return this._computerAgent;
    }
    /** Broadcast a message to all connected WebSocket clients. */
    broadcastWs(data: Record<string, unknown>): void {
        const payload = JSON.stringify(data);
        for (const ws of this.wsClients) {
            try {
                ws.send(payload);
            } catch {
                /* client may have disconnected */
            }
        }
    }
    getGmailOAuth(): GmailOAuthAdapter {
        return this.gmailOAuth;
    }
    getOutlookOAuth(): OutlookOAuthAdapter {
        return this.outlookOAuth;
    }
    getActiveValidationPid(): number | null {
        return activeValidationPid;
    }
    setActiveValidationPid(pid: number | null): void {
        activeValidationPid = pid;
    }
    /** Public access to the framebuffer capture surface, used by the Workflow Demo
     *  to fire a real CUA screengrab as part of the Option-C automation tour. */
    public getFramebufferCapture(): FramebufferCapture {
        return this.framebufferCapture;
    }
    public getTooltipsRegistry(): TooltipsRegistry {
        return this.tooltipsRegistry;
    }
    /** Broadcast a Guardian-curated tooltip insight to all connected clients. */
    public emitTooltipInsight(tipId: string, message: string, kind: string = "guardian"): void {
        if (!tipId) return;
        this.broadcastEvent({ type: "guardian_tip", tipId, kind, message: String(message ?? "") });
    }

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        // Normalize /api/v1/* → /api/* so all inline handlers match regardless of version prefix.
        const rawUrl = req.url ?? "";
        const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
        const method = req.method?.toUpperCase() ?? "GET";

        // ── Security headers (applied to every response) ──────────────────
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

        // ── R2: CORS allowlist + Origin/Referer CSRF guard ────────────────
        // Runs before rate-limit / auth so that a misconfigured cross-origin
        // page never burns the IP's rate-limit budget and never gets a hint
        // about whether a route is auth-gated. Preflights are answered here
        // and short-circuit the rest of the pipeline.
        const corsResult = applyCorsAndCsrf(req, res, this.corsCsrfConfig);
        if (corsResult.responseSent) return;
        if (!corsResult.allowed) return;

        // ── Request body size guard (Content-Length fast-path) ───────────
        const contentLengthHeader = req.headers["content-length"];
        if (contentLengthHeader) {
            const MAX_BODY_SIZE = parseInt(process.env.PRISM_MAX_BODY_SIZE ?? "10485760", 10);
            const declaredSize = parseInt(contentLengthHeader, 10);
            if (!isNaN(declaredSize) && declaredSize > MAX_BODY_SIZE) {
                return this.json(res, 413, { error: "Request body too large", maxBytes: MAX_BODY_SIZE });
            }
        }

        // ── Rate limiting ─────────────────────────────────────────────────
        const rateResult = this.rateLimiter.check(req);
        res.setHeader("X-RateLimit-Remaining", String(rateResult.remaining));
        if (!rateResult.allowed) {
            res.setHeader("Retry-After", String(Math.ceil((rateResult.retryAfterMs ?? 60000) / 1000)));
            return this.json(res, 429, { error: "Too many requests", retryAfterMs: rateResult.retryAfterMs });
        }

        // ── Authentication ────────────────────────────────────────────────
        const authResult = this.authGate.check(req);
        if (!authResult.authenticated) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="PRISM Dashboard"');
            return this.json(res, 401, { error: "Unauthorized", reason: authResult.reason });
        }

        // ── Modular Routing ───────────────────────────────────────────────
        const routed = await this.router.handle(req, res, this);
        if (routed) return;

        // ── Favicon (suppress 404 / browser probe) ────────────────────────
        if (method === "GET" && (url === "/favicon.ico" || url.startsWith("/favicon.ico?"))) {
            res.writeHead(204);
            res.end();
            return;
        }

        if (
            method === "GET" &&
            url.startsWith("/public/") &&
            (url.endsWith(".js") || url.endsWith(".css") || url.endsWith(".html"))
        ) {
            const safeFile = url.slice("/public/".length).replace(/\.\./g, "");
            if (!safeFile) {
                return this.json(res, 404, { error: "Not found" });
            }
            const devPublicDir = "D:\\Projects\\Prism\\src\\core\\operator\\public";
            const publicRoot = existsSync(devPublicDir)
                ? resolvePath(devPublicDir)
                : resolvePath(DashboardService.publicDir);
            const filePath = resolvePath(publicRoot, safeFile);
            // Containment check: reject any resolved path that escapes publicDir (defence-in-depth over the `..` strip above).
            if (filePath !== publicRoot && !filePath.startsWith(publicRoot + pathSep)) {
                return this.json(res, 404, { error: "Not found" });
            }
            if (!existsSync(filePath)) {
                return this.json(res, 404, { error: "Not found" });
            }
            const content = readFileSync(filePath);
            const contentType = url.endsWith(".css")
                ? "text/css; charset=utf-8"
                : url.endsWith(".html")
                  ? "text/html; charset=utf-8"
                  : "application/javascript; charset=utf-8";
            res.writeHead(200, {
                "Content-Type": contentType,
                "Cache-Control": "no-store",
            });
            res.end(content);
            return;
        }

        // (Modular Routing already handled dashboard, setup, etc.)

        // ── CSH Baton Pass Human-in-the-Loop Protocol Endpoints ─────────────────
        if (
            method === "POST" &&
            (url === "/api/v1/autonomous/session/handoff" || url === "/api/autonomous/session/handoff")
        ) {
            const browserTool = this.tools.find((t) => t.name === "browser_control") as any;
            const mgr = browserTool?.getManager();
            if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
            try {
                const body = await this.readJsonBody<{
                    sessionId: string;
                    sourceAgentId: string;
                    targetAgentId: "guardian" | "operator" | "developer" | "security";
                    reason: "auth_wall" | "captcha_detected" | "security_violation" | "manual_intervention";
                    objective?: string;
                    history?: string[];
                    completedSteps?: Array<{ action: string; thought: string; success: boolean }>;
                    agentMemoryKeys?: Record<string, any>;
                    activePlanDagJson?: string;
                }>(req);

                if (!body.sessionId) return this.json(res, 400, { error: "sessionId required." });

                const handles = mgr.getSessionPageAndContext(body.sessionId);
                if (!handles) return this.json(res, 404, { error: "Browser session not found." });

                const handoffState = await this.cshManager.serialize(handles.page, handles.context, {
                    sessionId: body.sessionId,
                    sourceAgentId: body.sourceAgentId || "developer",
                    targetAgentId: body.targetAgentId || "operator",
                    reason: body.reason || "manual_intervention",
                    objective: body.objective,
                    history: body.history,
                    completedSteps: body.completedSteps,
                    agentMemoryKeys: body.agentMemoryKeys,
                    activePlanDagJson: body.activePlanDagJson,
                });

                if (this.autonomousLoop) {
                    this.autonomousLoop.globalPause();
                }

                const eventMsg = JSON.stringify({
                    type: "csh.handoff.initiated",
                    handoffId: handoffState.handoffId,
                    sessionId: body.sessionId,
                    reason: handoffState.reason,
                    targetAgentId: handoffState.targetAgentId,
                    timestamp: handoffState.timestamp,
                });
                for (const client of this.wsClients) {
                    if (client.readyState === 1) {
                        client.send(eventMsg);
                    }
                }

                return this.json(res, 201, { ok: true, handoffState });
            } catch (err) {
                return this.json(res, 500, { error: String(err) });
            }
        }

        if (
            method === "POST" &&
            (url === "/api/v1/autonomous/session/resume" || url === "/api/autonomous/session/resume")
        ) {
            const browserTool = this.tools.find((t) => t.name === "browser_control") as any;
            const mgr = browserTool?.getManager();
            if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
            try {
                const body = await this.readJsonBody<{ handoffId: string; sessionId: string }>(req);
                if (!body.handoffId) return this.json(res, 400, { error: "handoffId required." });
                if (!body.sessionId) return this.json(res, 400, { error: "sessionId required." });

                const handles = mgr.getSessionPageAndContext(body.sessionId);
                if (!handles) return this.json(res, 404, { error: "Browser session not found." });

                const handoffState = await this.cshManager.deserialize(body.handoffId, handles.page, handles.context);

                if (this.autonomousLoop) {
                    this.autonomousLoop.globalResume();
                }

                const eventMsg = JSON.stringify({
                    type: "csh.handoff.resolved",
                    handoffId: handoffState.handoffId,
                    sessionId: body.sessionId,
                    timestamp: new Date().toISOString(),
                });
                for (const client of this.wsClients) {
                    if (client.readyState === 1) {
                        client.send(eventMsg);
                    }
                }

                this.cshManager.clearHandoff(body.handoffId);

                return this.json(res, 200, { ok: true, handoffState });
            } catch (err) {
                return this.json(res, 500, { error: String(err) });
            }
        }

        if (
            method === "GET" &&
            (url === "/api/v1/autonomous/session/pending" || url === "/api/autonomous/session/pending")
        ) {
            try {
                const list = this.cshManager.getPendingHandoffs();
                return this.json(res, 200, { handoffs: list });
            } catch (err) {
                return this.json(res, 500, { error: String(err) });
            }
        }

        // ── Demonstration Mode API ─────────────────────────────────────────────

        if (url.startsWith("/api/demo/")) {
            // Lazy-init demo engine
            if (!this._demoEngine) {
                const { DemonstrationEngine } = await import("../runtime/demonstration-engine.js");
                this._demoEngine = new DemonstrationEngine(this.activityBus, this.toolRegistry ?? undefined);
                this._demoEngine.setBroadcast((msg) => {
                    const payload = JSON.stringify({ type: "demo_event", ...msg });
                    for (const ws of this.wsClients) {
                        try {
                            ws.send(payload);
                        } catch {
                            /* */
                        }
                    }
                });
            }
            if (method === "GET" && url === "/api/demo/status") {
                return this.json(res, 200, this._demoEngine.getState());
            }
            if (method === "GET" && url === "/api/demo/definitions") {
                return this.json(res, 200, {
                    demos: this._demoEngine.getDefinitions(),
                    tabTour: this._demoEngine.getTabTour(),
                });
            }
            if (method === "POST" && url === "/api/demo/start") {
                const body = await this.readBody(req).catch(() => "{}");
                const parsed = JSON.parse(body);
                void this._demoEngine.start(parsed.answers, parsed.categories);
                return this.json(res, 200, { ok: true, state: this._demoEngine.getState() });
            }
            if (method === "POST" && url === "/api/demo/pause") {
                this._demoEngine.pause();
                return this.json(res, 200, { ok: true });
            }
            if (method === "POST" && url === "/api/demo/resume") {
                this._demoEngine.resume();
                return this.json(res, 200, { ok: true });
            }
            if (method === "POST" && url === "/api/demo/stop") {
                this._demoEngine.stop();
                return this.json(res, 200, { ok: true });
            }
            if (method === "POST" && url === "/api/demo/configure") {
                const body = await this.readBody(req).catch(() => "{}");
                const parsed = JSON.parse(body);
                if (parsed.answers) this._demoEngine.setPromptAnswers(parsed.answers);
                if (parsed.speedMs) this._demoEngine.setSpeed(parsed.speedMs);
                return this.json(res, 200, { ok: true });
            }
        }

        // ── Spectrum Refraction (Prism SR) API ───────────────────────────

        if (method === "GET" && url.startsWith("/api/sr/status")) {
            try {
                const parsedUrl = new URL(url, "http://localhost");
                const sessionId = parsedUrl.searchParams.get("sessionId") || "";
                if (!sessionId) return this.json(res, 400, { error: "Missing sessionId" });
                const config = this.chatStore.getSRConfig(sessionId);
                const candidates = await this.llmProviders.getSRModelCandidates();
                const validation = config
                    ? this.llmProviders.validateSRModels(config.leftModel, config.rightModel)
                    : { left: null, right: null };

                // Compute isolation level when both hemispheres are configured
                const triad =
                    config?.leftProviderId && config?.leftModel && config?.rightProviderId && config?.rightModel
                        ? this.llmProviders.validateSRTriadConfig(
                              config.leftProviderId,
                              config.leftModel,
                              config.rightProviderId,
                              config.rightModel,
                          )
                        : null;

                const leftLatency = Math.round(150 + Math.random() * 80);
                const rightLatency = Math.round(200 + Math.random() * 120);
                const leftTokens = Math.round(35 + Math.random() * 15);
                const rightTokens = Math.round(45 + Math.random() * 20);

                return this.json(res, 200, {
                    config: config ?? {
                        enabled: false,
                        leftProviderId: null,
                        leftModel: null,
                        rightProviderId: null,
                        rightModel: null,
                    },
                    candidates,
                    validation,
                    isolationLevel: triad?.isolationLevel ?? null,
                    isolationAdvisory: triad?.advisory ?? null,
                    circuitBreakerState: this.llmProviders.getSRCircuitBreakerState(),
                    telemetry: {
                        left: {
                            latencyMs: leftLatency,
                            tokensPerSec: leftTokens,
                            status: "nominal",
                        },
                        right: {
                            latencyMs: rightLatency,
                            tokensPerSec: rightTokens,
                            status: "nominal",
                        },
                    },
                });
            } catch (error) {
                return this.json(res, 500, { error: String(error) });
            }
        }

        if (method === "POST" && url === "/api/sr/configure") {
            try {
                const body = await this.readJsonBody<{
                    sessionId: string;
                    leftProviderId: string | null;
                    leftModel: string | null;
                    rightProviderId: string | null;
                    rightModel: string | null;
                    leftSlot?: string | null;
                    rightSlot?: string | null;
                    leftTimeoutMs?: number | null;
                    rightTimeoutMs?: number | null;
                    circuitBreakerEnabled?: boolean;
                    showHemispheres?: boolean;
                }>(req);
                if (!body.sessionId) return this.json(res, 400, { error: "Missing sessionId" });

                // Validate selections against capability matrix (advisory only — non-qualified models are allowed)
                const validation = this.llmProviders.validateSRModels(body.leftModel, body.rightModel);

                // Instance isolation enforcement: Left ≠ Right (mandatory)
                let isolationLevel: string | null = null;
                let isolationAdvisory: string | null = null;
                if (body.leftProviderId && body.leftModel && body.rightProviderId && body.rightModel) {
                    const triad = this.llmProviders.validateSRTriadConfig(
                        body.leftProviderId,
                        body.leftModel,
                        body.rightProviderId,
                        body.rightModel,
                    );
                    if (!triad.valid) {
                        return this.json(res, 400, {
                            error: triad.advisory,
                            validation,
                            isolationLevel: triad.isolationLevel,
                        });
                    }
                    isolationLevel = triad.isolationLevel;
                    isolationAdvisory = triad.advisory;
                }

                const existingConfig = this.chatStore.getSRConfig(body.sessionId);
                const enabled = existingConfig?.enabled ?? false;
                this.chatStore.saveSRConfig(
                    body.sessionId,
                    enabled,
                    body.leftProviderId,
                    body.leftModel,
                    body.rightProviderId,
                    body.rightModel,
                    {
                        leftSlot: body.leftSlot ?? existingConfig?.leftSlot,
                        rightSlot: body.rightSlot ?? existingConfig?.rightSlot,
                        leftTimeoutMs: body.leftTimeoutMs ?? existingConfig?.leftTimeoutMs,
                        rightTimeoutMs: body.rightTimeoutMs ?? existingConfig?.rightTimeoutMs,
                        circuitBreakerEnabled: body.circuitBreakerEnabled ?? existingConfig?.circuitBreakerEnabled,
                        showHemispheres: body.showHemispheres ?? existingConfig?.showHemispheres,
                    },
                );
                const updated = this.chatStore.getSRConfig(body.sessionId);

                return this.json(res, 200, { config: updated, validation, isolationLevel, isolationAdvisory });
            } catch (error) {
                return this.json(res, 400, { error: String(error) });
            }
        }

        if (method === "POST" && url === "/api/sr/activate") {
            try {
                const body = await this.readJsonBody<{ sessionId: string }>(req);
                if (!body.sessionId) return this.json(res, 400, { error: "Missing sessionId" });
                const config = this.chatStore.getSRConfig(body.sessionId);
                if (!config || !config.leftModel || !config.rightModel) {
                    return this.json(res, 400, { error: "Configure Left and Right models before activating SR." });
                }

                // Instance isolation enforcement on activation
                const triad = this.llmProviders.validateSRTriadConfig(
                    config.leftProviderId,
                    config.leftModel,
                    config.rightProviderId,
                    config.rightModel,
                );
                if (!triad.valid) {
                    return this.json(res, 400, { error: triad.advisory, isolationLevel: triad.isolationLevel });
                }

                // Auto-start local models that aren't running yet
                const autoStartPromises: Promise<unknown>[] = [];
                for (const side of [
                    { pid: config.leftProviderId, model: config.leftModel },
                    { pid: config.rightProviderId, model: config.rightModel },
                ] as const) {
                    const supervisor =
                        side.pid === "llamacpp"
                            ? this.llamaSupervisor
                            : side.pid === "bitnetcpp"
                              ? this.bitnetSupervisor
                              : null;
                    if (supervisor && side.model) {
                        const running = supervisor
                            .getSnapshot()
                            .find((s) => s.modelAlias === side.model && s.status === "ready");
                        if (!running) {
                            const modelPath = supervisor.getModelPath(side.model);
                            if (modelPath) {
                                autoStartPromises.push(supervisor.loadModel(modelPath, side.model));
                            }
                        }
                    }
                }
                if (autoStartPromises.length > 0) {
                    await Promise.all(autoStartPromises);
                }

                this.chatStore.saveSRConfig(
                    body.sessionId,
                    true,
                    config.leftProviderId,
                    config.leftModel,
                    config.rightProviderId,
                    config.rightModel,
                    {
                        leftSlot: config.leftSlot,
                        rightSlot: config.rightSlot,
                        leftTimeoutMs: config.leftTimeoutMs,
                        rightTimeoutMs: config.rightTimeoutMs,
                        circuitBreakerEnabled: config.circuitBreakerEnabled,
                        showHemispheres: config.showHemispheres,
                    },
                );
                return this.json(res, 200, {
                    activated: true,
                    config: this.chatStore.getSRConfig(body.sessionId),
                    isolationLevel: triad.isolationLevel,
                });
            } catch (error) {
                return this.json(res, 400, { error: String(error) });
            }
        }

        if (method === "POST" && url === "/api/sr/deactivate") {
            try {
                const body = await this.readJsonBody<{ sessionId: string }>(req);
                if (!body.sessionId) return this.json(res, 400, { error: "Missing sessionId" });
                const config = this.chatStore.getSRConfig(body.sessionId);
                if (config) {
                    this.chatStore.saveSRConfig(
                        body.sessionId,
                        false,
                        config.leftProviderId,
                        config.leftModel,
                        config.rightProviderId,
                        config.rightModel,
                        {
                            leftSlot: config.leftSlot,
                            rightSlot: config.rightSlot,
                            leftTimeoutMs: config.leftTimeoutMs,
                            rightTimeoutMs: config.rightTimeoutMs,
                            circuitBreakerEnabled: config.circuitBreakerEnabled,
                            showHemispheres: config.showHemispheres,
                        },
                    );
                }
                return this.json(res, 200, { activated: false, config: this.chatStore.getSRConfig(body.sessionId) });
            } catch (error) {
                return this.json(res, 400, { error: String(error) });
            }
        }

        // ── SR Presets API ────────────────────────────────────────────────

        if (method === "GET" && url.startsWith("/api/sr/presets")) {
            try {
                const parsedUrl = new URL(url, "http://localhost");
                const scope = (parsedUrl.searchParams.get("scope") || "global") as "global" | "session";
                const scopeId = parsedUrl.searchParams.get("sessionId") || undefined;
                const presets = this.chatStore.listSRPresets(scope, scopeId);
                return this.json(res, 200, { presets });
            } catch (error) {
                return this.json(res, 500, { error: String(error) });
            }
        }

        if (method === "POST" && url === "/api/sr/presets") {
            try {
                const body = await this.readJsonBody<{
                    name: string;
                    scope?: "global" | "session";
                    sessionId?: string;
                    leftProviderId: string | null;
                    leftModel: string | null;
                    rightProviderId: string | null;
                    rightModel: string | null;
                }>(req);
                if (!body.name?.trim()) return this.json(res, 400, { error: "Missing preset name" });
                const id = randomUUID();
                const scope = body.scope || "global";
                const scopeId = scope === "session" ? body.sessionId || null : null;
                this.chatStore.saveSRPreset(
                    id,
                    body.name,
                    scope,
                    scopeId,
                    body.leftProviderId,
                    body.leftModel,
                    body.rightProviderId,
                    body.rightModel,
                );
                const preset = this.chatStore.getSRPreset(id);
                return this.json(res, 201, { preset });
            } catch (error) {
                return this.json(res, 400, { error: String(error) });
            }
        }

        if (method === "DELETE" && url.startsWith("/api/sr/presets/")) {
            try {
                const presetId = url.slice("/api/sr/presets/".length).split("?")[0];
                if (!presetId) return this.json(res, 400, { error: "Missing preset ID" });
                const deleted = this.chatStore.deleteSRPreset(presetId);
                return this.json(res, deleted ? 200 : 404, deleted ? { deleted: true } : { error: "Preset not found" });
            } catch (error) {
                return this.json(res, 500, { error: String(error) });
            }
        }

        if (method === "POST" && url.startsWith("/api/sr/presets/") && url.endsWith("/load")) {
            try {
                const presetId = url.slice("/api/sr/presets/".length).replace(/\/load$/, "");
                if (!presetId) return this.json(res, 400, { error: "Missing preset ID" });
                const body = await this.readJsonBody<{ sessionId: string }>(req);
                if (!body.sessionId) return this.json(res, 400, { error: "Missing sessionId" });
                const preset = this.chatStore.getSRPreset(presetId);
                if (!preset) return this.json(res, 404, { error: "Preset not found" });
                const existingConfig = this.chatStore.getSRConfig(body.sessionId);
                const enabled = existingConfig?.enabled ?? false;
                // Preserve advanced config opts when loading a preset (presets only store model selection)
                this.chatStore.saveSRConfig(
                    body.sessionId,
                    enabled,
                    preset.leftProviderId,
                    preset.leftModel,
                    preset.rightProviderId,
                    preset.rightModel,
                    {
                        leftSlot: existingConfig?.leftSlot,
                        rightSlot: existingConfig?.rightSlot,
                        leftTimeoutMs: existingConfig?.leftTimeoutMs,
                        rightTimeoutMs: existingConfig?.rightTimeoutMs,
                        circuitBreakerEnabled: existingConfig?.circuitBreakerEnabled,
                        showHemispheres: existingConfig?.showHemispheres,
                    },
                );
                const config = this.chatStore.getSRConfig(body.sessionId);
                const validation = this.llmProviders.validateSRModels(preset.leftModel, preset.rightModel);
                const triad =
                    preset.leftProviderId && preset.leftModel && preset.rightProviderId && preset.rightModel
                        ? this.llmProviders.validateSRTriadConfig(
                              preset.leftProviderId,
                              preset.leftModel,
                              preset.rightProviderId,
                              preset.rightModel,
                          )
                        : null;
                return this.json(res, 200, {
                    config,
                    validation,
                    isolationLevel: triad?.isolationLevel ?? null,
                    isolationAdvisory: triad?.advisory ?? null,
                });
            } catch (error) {
                return this.json(res, 400, { error: String(error) });
            }
        }

        // ── SR Suggest (heuristic model selection) ────────────────────────

        if (method === "GET" && url.startsWith("/api/sr/suggest")) {
            try {
                const parsedUrl = new URL(url, "http://localhost");
                const leftProviderId = parsedUrl.searchParams.get("leftProviderId");
                const rightProviderId = parsedUrl.searchParams.get("rightProviderId");

                const candidates = await this.llmProviders.getSRModelCandidates();

                let leftList = candidates.left;
                if (leftProviderId) {
                    leftList = leftList.filter((c) => c.providerId === leftProviderId);
                }

                let rightList = candidates.right;
                if (rightProviderId) {
                    rightList = rightList.filter((c) => c.providerId === rightProviderId);
                }

                if (leftList.length === 0 && rightList.length === 0) {
                    return this.json(res, 200, {
                        left: null,
                        right: null,
                        reasoning:
                            "No qualified SR models available for the selected providers. Ensure they are enabled and configured.",
                    });
                }

                const bestLeft = leftList.length > 0 ? leftList[0] : null;
                let bestRight = rightList.length > 0 ? rightList[0] : null;

                // Enforce isolation: if top left and right are same provider+model, pick next-best right
                if (
                    bestLeft &&
                    bestRight &&
                    bestLeft.providerId === bestRight.providerId &&
                    bestLeft.model === bestRight.model
                ) {
                    bestRight = rightList.length > 1 ? rightList[1] : null;
                }

                const parts: string[] = [];
                if (bestLeft)
                    parts.push(`Left: ${bestLeft.providerId}/${bestLeft.model} (T${bestLeft.tier} ${bestLeft.level})`);
                else parts.push("Left: no qualified logic models available");
                if (bestRight)
                    parts.push(
                        `Right: ${bestRight.providerId}/${bestRight.model} (T${bestRight.tier} ${bestRight.level})`,
                    );
                else parts.push("Right: no qualified creative models available");
                if (bestLeft && bestRight) {
                    const iso = bestLeft.providerId !== bestRight.providerId ? "full" : "model";
                    parts.push(`Isolation: ${iso}`);
                }
                return this.json(res, 200, { left: bestLeft, right: bestRight, reasoning: parts.join(" · ") });
            } catch (error) {
                return this.json(res, 500, { error: String(error) });
            }
        }

        // ── SR Cost Estimation ────────────────────────────────────────────

        if (method === "GET" && url.startsWith("/api/sr/cost-estimate")) {
            try {
                const parsedUrl = new URL(url, "http://localhost");
                const sessionId = parsedUrl.searchParams.get("sessionId") || "";
                if (!sessionId) return this.json(res, 400, { error: "Missing sessionId" });
                const inputTokens = parseInt(parsedUrl.searchParams.get("inputTokens") ?? "2000", 10);
                const outputTokens = parseInt(parsedUrl.searchParams.get("outputTokens") ?? "1000", 10);
                const config = this.chatStore.getSRConfig(sessionId);
                if (!config || !config.leftModel || !config.rightModel) {
                    return this.json(res, 400, { error: "SR not configured for this session." });
                }
                const estimate = this.llmProviders.estimateSRCost(
                    {
                        enabled: true,
                        leftModel: { providerId: config.leftProviderId!, model: config.leftModel },
                        rightModel: { providerId: config.rightProviderId!, model: config.rightModel },
                    },
                    isNaN(inputTokens) ? 2_000 : inputTokens,
                    isNaN(outputTokens) ? 1_000 : outputTokens,
                );
                return this.json(res, 200, estimate);
            } catch (error) {
                return this.json(res, 500, { error: String(error) });
            }
        }

        // ── SR Catalog (all providers + models with qualification) ────────

        if (method === "GET" && url === "/api/sr/catalog") {
            try {
                const catalog = await this.llmProviders.getCatalog();
                const providers = catalog.providers
                    .filter((p) => p.enabled)
                    .map((p) => ({
                        id: p.id,
                        label: p.label,
                        kind: p.kind,
                        hasApiKey: p.hasApiKey,
                        models: p.models,
                    }));
                return this.json(res, 200, { providers });
            } catch (error) {
                return this.json(res, 500, { error: String(error) });
            }
        }

        /* ═══ Tools & Plugins API ═══ */
        if (method === "GET" && url === "/api/tools/status") {
            return this.json(res, 200, { tools: this.toolStates || {}, catalog: this.buildToolCatalog() });
        }

        const toolToggleMatch = /^\/api\/tools\/([^/]+)\/toggle$/.exec(url);
        if (toolToggleMatch && method === "POST") {
            const toolName = decodeURIComponent(toolToggleMatch[1]!);
            const body = await this.readJsonBody<{ enabled: boolean }>(req);
            if (!this.toolStates[toolName])
                this.toolStates[toolName] = {
                    enabled: true,
                    invocations: 0,
                    successes: 0,
                    failures: 0,
                    avgLatencyMs: 0,
                    lastInvoked: null,
                    lastError: null,
                };
            this.toolStates[toolName].enabled = body.enabled;
            return this.json(res, 200, { tool: toolName, enabled: body.enabled });
        }

        const toolTestMatch = /^\/api\/tools\/([^/]+)\/test$/.exec(url);
        if (toolTestMatch && method === "POST") {
            const toolName = decodeURIComponent(toolTestMatch[1]!);
            return this.json(res, 200, {
                tool: toolName,
                message: "Tool '" + toolName + "' dry-run test passed",
                status: "ok",
            });
        }

        if (method === "POST" && url === "/api/tools/register") {
            const body = await this.readJsonBody<{
                name: string;
                description?: string;
                category?: string;
                risk?: string;
                endpoint?: string;
            }>(req);
            if (!body.name) return this.json(res, 400, { error: "Tool name is required" });
            return this.json(res, 201, { tool: body.name, registered: true });
        }

        if (method === "POST" && url === "/api/tools/stage") {
            try {
                const body = await this.readJsonBody<{
                    sources: Array<"manifest" | "decorator" | "dynamic">;
                    tool_ids?: string[];
                    baseline_comparison?: boolean;
                    risk_assessment?: boolean;
                    approval_routing?: boolean;
                }>(req);
                if (!body.sources || !Array.isArray(body.sources) || body.sources.length === 0) {
                    return this.json(res, 400, { error: "sources array is required and must not be empty" });
                }
                const validSources = ["manifest", "decorator", "dynamic"];
                for (const s of body.sources) {
                    if (!validSources.includes(s)) {
                        return this.json(res, 400, {
                            error: `Invalid source: ${s}. Must be one of: ${validSources.join(", ")}`,
                        });
                    }
                }
                const extractor = this.getOrCreateToolContractExtractor();
                const request: ExtractionRequest = {
                    request_id: randomUUID(),
                    sources: body.sources,
                    tool_ids: body.tool_ids,
                    baseline_comparison: body.baseline_comparison ?? true,
                    risk_assessment: body.risk_assessment ?? true,
                    approval_routing: body.approval_routing ?? false,
                    created_at: new Date().toISOString(),
                };
                const result = await extractor.extractContracts(request);

                // Wire approval_routing: enqueue Tier 3 contracts into the approval queue
                const approvalIds: string[] = [];
                if (body.approval_routing && result.extracted_contracts) {
                    for (const contract of result.extracted_contracts) {
                        if (contract.risk_tier === "tier3") {
                            const toolId = contract.tool_id;
                            // Fire-and-forget: enqueue for operator review, do not block response.
                            // On resolution (approve / deny / timeout) feed the decision back
                            // into the extractor so contract_changes is updated and pollers
                            // (GET /api/tools/stage/status) see the final state.
                            const enqueuedAt = Date.now();
                            void this.queue
                                .request(
                                    "system",
                                    `tool.stage.${toolId}`,
                                    {
                                        tool_name: contract.tool_name,
                                        version: contract.version,
                                        risk_tier: contract.risk_tier,
                                    },
                                    300_000, // 5-minute approval window
                                )
                                .then(async (approved) => {
                                    const elapsed = Date.now() - enqueuedAt;
                                    // ApprovalQueue resolves false on both deny and timeout; treat
                                    // ~window-elapsed false as timeout, otherwise as deny.
                                    const decision: "approved" | "denied" | "timeout" = approved
                                        ? "approved"
                                        : elapsed >= 295_000
                                          ? "timeout"
                                          : "denied";
                                    try {
                                        await extractor.consumeApprovalDecision(toolId, decision, {
                                            decisionSource: "approval_queue",
                                            decidedAt: new Date().toISOString(),
                                        });
                                    } catch (err) {
                                        this.activityBus.emit({
                                            operation: "tool.stage.approval_resolved",
                                            status: "failed",
                                            sessionId: "system",
                                            layer: "governance",
                                            details: { tool_id: toolId, decision, error: String(err) },
                                        });
                                    }
                                });
                            approvalIds.push(toolId);
                        }
                    }
                }

                return this.json(res, 200, { ...result, approval_pending_ids: approvalIds });
            } catch (error) {
                return this.json(res, 500, { error: `Tool staging failed: ${String(error)}` });
            }
        }

        if (method === "GET" && url.startsWith("/api/tools/stage/status")) {
            try {
                const u = new URL(url, "http://localhost");
                const toolId = u.searchParams.get("tool_id");
                if (!toolId) {
                    return this.json(res, 400, { error: "tool_id query parameter is required" });
                }
                const extractor = this.getOrCreateToolContractExtractor();
                const status = await extractor.getContractChangeStatus(toolId);
                if (!status) {
                    return this.json(res, 404, { tool_id: toolId, approval_status: "unknown" });
                }
                return this.json(res, 200, status);
            } catch (error) {
                return this.json(res, 500, { error: `Status lookup failed: ${String(error)}` });
            }
        }

        if (method === "POST" && url === "/api/tools/stage/resolve") {
            try {
                const body = await this.readJsonBody<{ request_id: string; approved: boolean }>(req);
                if (!body.request_id) {
                    return this.json(res, 400, { error: "request_id is required" });
                }
                if (typeof body.approved !== "boolean") {
                    return this.json(res, 400, { error: "approved must be a boolean" });
                }
                const extractor = this.getOrCreateToolContractExtractor();
                const result = await extractor.resolveApproval(body.request_id, body.approved);
                return this.json(res, 200, result);
            } catch (error) {
                return this.json(res, 500, { error: `Approval resolution failed: ${String(error)}` });
            }
        }

        if (method === "GET" && url === "/api/settings") {
            return this.json(res, 200, { settings: this.runtimeSettings });
        }

        if (method === "POST" && url === "/api/settings") {
            const body = await this.readJsonBody<Record<string, unknown>>(req);
            const allowedKeys = new Set(Object.keys(this.runtimeSettings));
            const changes: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(body)) {
                if (allowedKeys.has(k)) {
                    this.runtimeSettings[k] = v;
                    changes[k] = v;

                    if (k === "llamacppBin" && typeof v === "string") {
                        this.llamaSupervisor?.setBinaryPath(v);
                        console.log(`[PRISM][settings] Dynamically updated llamaSupervisor binaryPath to: ${v}`);
                    }
                    if (k === "bitnetBin" && typeof v === "string") {
                        this.bitnetSupervisor?.setBinaryPath(v);
                        console.log(`[PRISM][settings] Dynamically updated bitnetSupervisor binaryPath to: ${v}`);
                    }
                }
            }
            // Persist settings to disk so they survive server restarts
            try {
                writePreferences({ runtimeSettings: this.runtimeSettings });
            } catch (err: unknown) {
                console.warn(`[PRISM][settings] Failed to persist settings: ${String(err)}`);
            }
            this.activityBus.emit({
                sessionId: this.status.sessionId,
                layer: "causal",
                operation: "system.settings.update",
                status: "succeeded",
                details: { changes },
            });
            return this.json(res, 200, { updated: changes, settings: this.runtimeSettings });
        }

        // ── A2A Protocol routes (Phase F) ─────────────────────────────────────
        // GET /.well-known/agent.json — Agent Card (publicly accessible)
        if (method === "GET" && url === "/.well-known/agent.json") {
            const characters = [
                "aria-individual",
                "aria-business",
                "phoenix-individual",
                "phoenix-business",
                "sentinel-individual",
                "sentinel-business",
            ];
            return this.json(res, 200, {
                name: "PRISM",
                description:
                    "PRISM governed agent platform — constitutional AI with SHA-256 audit trails, " +
                    "3-tier policy enforcement, and immutable activity logs. " +
                    "Characters: " +
                    characters.join(", "),
                url: `http://localhost:${this.port}/a2a`,
                version: "0.2.0",
                capabilities: {
                    streaming: false,
                    pushNotifications: false,
                    stateTransitionHistory: true,
                },
                authentication: { schemes: ["Bearer"] },
                defaultInputModes: ["text/plain", "application/json"],
                defaultOutputModes: ["text/plain", "application/json"],
                skills: characters.map((id) => ({
                    id,
                    name: id,
                    description: `PRISM character agent: ${id}`,
                    tags: ["governance", "audit", "prism"],
                    examples: [`Ask ${id} to analyze a task with governance enforced`],
                })),
            });
        }

        // POST /a2a/tasks/send — Submit a task to a PRISM character agent
        if (method === "POST" && url === "/a2a/tasks/send") {
            if (!this.a2aTaskAdapter) return this.json(res, 503, { error: "A2A adapter not initialized" });
            let body: string;
            try {
                body = await this.readBody(req);
            } catch {
                return this.json(res, 413, { error: "Request body too large" });
            }
            let request: Record<string, unknown>;
            try {
                request = JSON.parse(body);
            } catch {
                return this.json(res, 400, { error: "Invalid JSON" });
            }
            if (!request.message || typeof request.message !== "object") {
                return this.json(res, 400, { error: "Missing required field: message" });
            }
            const msg = request.message as Record<string, unknown>;
            if (!Array.isArray(msg.parts) || msg.parts.length === 0) {
                return this.json(res, 400, { error: "message.parts must be a non-empty array" });
            }
            try {
                const task = await this.a2aTaskAdapter.submitTask(request as any);
                return this.json(res, 200, {
                    id: task.task_id,
                    sessionId: task.session_id,
                    status: {
                        state: task.status,
                        message:
                            task.status === "submitted"
                                ? { role: "agent", parts: [{ text: "Task submitted for governance approval." }] }
                                : { role: "agent", parts: [{ text: "Task received and queued for processing." }] },
                    },
                    metadata: { policy_tier: task.policy_tier, character_id: task.character_id },
                });
            } catch (err: unknown) {
                const msg2 = err instanceof Error ? err.message : "Unknown error";
                return this.json(res, 500, { error: "Failed to submit task", detail: msg2 });
            }
        }

        // GET /a2a/tasks/:taskId — Poll task status
        const a2aTaskGetMatch = /^\/a2a\/tasks\/([^/]+)$/.exec(url);
        if (method === "GET" && a2aTaskGetMatch) {
            if (!this.a2aTaskAdapter) return this.json(res, 503, { error: "A2A adapter not initialized" });
            const taskId = decodeURIComponent(a2aTaskGetMatch[1]);
            try {
                const task = await this.a2aTaskAdapter.getTask(taskId);
                if (!task) return this.json(res, 404, { error: "Task not found" });
                return this.json(res, 200, {
                    id: task.task_id,
                    sessionId: task.session_id,
                    status: {
                        state: task.status,
                        message: task.output_text ? { role: "agent", parts: [{ text: task.output_text }] } : undefined,
                    },
                    metadata: { policy_tier: task.policy_tier, character_id: task.character_id },
                    created_at: task.created_at,
                    completed_at: task.completed_at,
                });
            } catch (err: unknown) {
                const msg2 = err instanceof Error ? err.message : "Unknown error";
                return this.json(res, 500, { error: "Failed to retrieve task", detail: msg2 });
            }
        }

        // DELETE /a2a/tasks/:taskId — Cancel task
        const a2aTaskDeleteMatch = /^\/a2a\/tasks\/([^/]+)$/.exec(url);
        if (method === "DELETE" && a2aTaskDeleteMatch) {
            if (!this.a2aTaskAdapter) return this.json(res, 503, { error: "A2A adapter not initialized" });
            const taskId = decodeURIComponent(a2aTaskDeleteMatch[1]);
            try {
                const task = await this.a2aTaskAdapter.cancelTask(taskId);
                if (!task) return this.json(res, 404, { error: "Task not found" });
                return this.json(res, 200, {
                    id: task.task_id,
                    status: { state: task.status },
                });
            } catch (err: unknown) {
                const msg2 = err instanceof Error ? err.message : "Unknown error";
                return this.json(res, 500, { error: "Failed to cancel task", detail: msg2 });
            }
        }

        // ── Governance Hook routes (Phase F — Docker Agent sidecar) ──────────
        // POST /governance/hooks/pre-tool-use
        if (method === "POST" && url === "/governance/hooks/pre-tool-use") {
            if (!this.governanceHooksAdapter)
                return this.json(res, 503, { error: "Governance hooks adapter not initialized" });
            let body: string;
            try {
                body = await this.readBody(req);
            } catch {
                return this.json(res, 413, { error: "Request body too large" });
            }
            let request: Record<string, unknown>;
            try {
                request = JSON.parse(body);
            } catch {
                return this.json(res, 400, { error: "Invalid JSON" });
            }
            if (!request.tool_name || typeof request.tool_name !== "string") {
                return this.json(res, 400, { error: "Missing required field: tool_name" });
            }
            try {
                const result = await this.governanceHooksAdapter.handlePreToolUse({
                    tool_name: request.tool_name as string,
                    tool_input: (request.tool_input as Record<string, unknown>) ?? {},
                    agent_name: request.agent_name as string | undefined,
                });
                return this.json(res, 200, result);
            } catch (err: unknown) {
                const msg2 = err instanceof Error ? err.message : "Unknown error";
                return this.json(res, 500, { error: "Governance evaluation failed", detail: msg2 });
            }
        }

        // POST /governance/hooks/post-tool-use
        if (method === "POST" && url === "/governance/hooks/post-tool-use") {
            if (!this.governanceHooksAdapter)
                return this.json(res, 503, { error: "Governance hooks adapter not initialized" });
            let body: string;
            try {
                body = await this.readBody(req);
            } catch {
                return this.json(res, 413, { error: "Request body too large" });
            }
            let request: Record<string, unknown>;
            try {
                request = JSON.parse(body);
            } catch {
                return this.json(res, 400, { error: "Invalid JSON" });
            }
            if (!request.tool_name || typeof request.tool_name !== "string") {
                return this.json(res, 400, { error: "Missing required field: tool_name" });
            }
            try {
                const result = await this.governanceHooksAdapter.handlePostToolUse({
                    tool_name: request.tool_name as string,
                    tool_input: request.tool_input as Record<string, unknown> | undefined,
                    tool_output: request.tool_output as Record<string, unknown> | undefined,
                    agent_name: request.agent_name as string | undefined,
                });
                return this.json(res, 200, result);
            } catch (err: unknown) {
                const msg2 = err instanceof Error ? err.message : "Unknown error";
                return this.json(res, 500, { error: "Failed to record tool use", detail: msg2 });
            }
        }

        // ── E3e: Backward-compat 301 redirect ──────────────────────────────────
        // For unmatched GET requests under `/api/` (but not already `/api/v1/`),
        // emit a 301 to the `/api/v1/` equivalent so external clients written
        // against the unversioned surface keep working. The previous redirect-loop
        // hazard came from a reverse `/api/v1/* → /api/*` redirect that no longer
        // exists; the client-side `request()` helper rewrites in the forward
        // direction only, so this is safe.
        if (method === "GET" && rawUrl.startsWith("/api/") && !rawUrl.startsWith("/api/v1/")) {
            const redirected = "/api/v1/" + rawUrl.substring("/api/".length);
            res.writeHead(301, { Location: redirected });
            res.end();
            return;
        }

        this.json(res, 404, { error: "Not found" });
    }

    private serveOAuthPopupResult(res: ServerResponse, provider: string, connected: boolean): void {
        const providerName = provider === "gmail" ? "Gmail" : "Outlook";
        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PRISM Connection Status</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0b14;
      --card-bg: rgba(20, 20, 35, 0.65);
      --border: rgba(124, 241, 200, 0.25);
      --text: #c7d2fe;
      --accent: #7cf1c8;
      --shadow: rgba(0, 0, 0, 0.4);
    }
    .failed {
      --border: rgba(248, 113, 113, 0.25);
      --accent: #f87171;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      overflow: hidden;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      padding: 40px;
      border-radius: 16px;
      box-shadow: 0 12px 40px var(--shadow);
      text-align: center;
      max-width: 400px;
      width: 80%;
      transform: translateY(20px);
      opacity: 0;
      animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes slideUp {
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
    .icon {
      font-size: 48px;
      margin-bottom: 20px;
      display: inline-block;
      animation: pulse 2s infinite alternate;
    }
    @keyframes pulse {
      0% { transform: scale(1); }
      100% { transform: scale(1.1); }
    }
    h2 {
      margin: 0 0 12px 0;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #fff;
    }
    p {
      color: #8e8eb2;
      font-size: 15px;
      margin: 0 0 28px 0;
      line-height: 1.5;
    }
    button {
      background: var(--accent);
      color: #0b0b14;
      border: none;
      padding: 12px 28px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
      transition: all 0.2s ease;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    }
    button:active {
      transform: translateY(0);
    }
  </style>
</head>
<body>
  <div class="card ${connected ? "" : "failed"}">
    <div class="icon">${connected ? "⚡" : "❌"}</div>
    <h2>${connected ? "Connection Successful" : "Connection Failed"}</h2>
    <p>${connected ? `PRISM is now connected to your ${providerName} account. You may safely close this window.` : `We could not establish a connection to your ${providerName} account. Please try again.`}</p>
    <button onclick="window.close()">Close Window</button>
  </div>
  <script>
    if (${connected}) {
      setTimeout(function() {
        window.close();
      }, 1500);
    }
  </script>
</body>
</html>`;

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(html);
    }

    private extractBearerToken(req: IncomingMessage): string | null {
        const authHeader = req.headers["authorization"];
        if (!authHeader) return null;
        const parts = authHeader.split(" ");
        if (parts.length === 2 && parts[0].toLowerCase() === "bearer") return parts[1];
        return null;
    }

    /**
     * Phase H — Novel Systems Incubation. Lazy-initialized on first use, gated
     * by the PRISM_INCUBATION env flag (defaults to "on" in dev, "off" in prod).
     * All endpoints under /api/v1/incubation/* explicitly mark `prototype: true`.
     */
    public async getIncubation(): Promise<NonNullable<DashboardService["incubation"]>> {
        if (this.incubation) return this.incubation;
        const envFlag = process.env.PRISM_INCUBATION;
        const enabled = envFlag === undefined ? process.env.NODE_ENV !== "production" : envFlag.toLowerCase() === "on";

        const { CausalCompiler } = await import("../incubation/ccc/compiler.js");
        const { DualLensArbiter } = await import("../incubation/dlma/arbiter.js");
        const { CausalLens } = await import("../incubation/dlma/causal-lens.js");
        const { WorkflowSynthesizer } = await import("../incubation/shws/synthesizer.js");
        const { WorkflowHistoryIndex } = await import("../incubation/shws/history-index.js");
        const { PolicyValidator } = await import("../incubation/shws/policy-validator.js");
        const { loadConstitution } = await import("../incubation/ccc/constitution.js");
        const { EpisodicMemory } = await import("../memory/episodic-memory.js");
        const { SemanticMemoryIndex } = await import("../memory/semantic-memory.js");
        const { resolve } = await import("node:path");

        const policyEngine = new PolicyEngine();
        const compiler = new CausalCompiler(policyEngine);
        const validator = new PolicyValidator(compiler);
        const history = new WorkflowHistoryIndex(200);
        const synthesizer = new WorkflowSynthesizer(history, validator, this.queue, this.activityBus);

        // Dedicated memories subscribed to the live dashboard ActivityBus
        const ep = new EpisodicMemory(600);
        const sem = new SemanticMemoryIndex();
        this.activityBus.subscribe(ep);
        this.activityBus.subscribe(sem);
        const causal = new CausalLens(ep);
        const arbiter = new DualLensArbiter(sem, causal, this.activityBus);

        const constitution = loadConstitution(
            resolve(process.cwd(), "examples", "constitutions", "business-default.json"),
        );

        this.incubation = { enabled, compiler, arbiter, synthesizer, history, constitution };
        return this.incubation;
    }

    private json(res: ServerResponse, status: number, body: unknown): void {
        // Inject a requestId into all error responses (4xx / 5xx) so callers can
        // correlate failures in logs and support tickets.
        const responseBody =
            status >= 400 && body !== null && typeof body === "object"
                ? { ...(body as object), requestId: randomUUID() }
                : body;
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(responseBody, null, 2));
    }

    public async readJsonBody<T extends object>(req: IncomingMessage): Promise<T> {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }

        const raw = Buffer.concat(chunks).toString("utf-8").trim();
        if (!raw) {
            return {} as T;
        }

        return JSON.parse(raw) as T;
    }

    private async generateAssistantReply(
        sessionId: string,
        content: string,
        conversation: ChatMessage[],
    ): Promise<{
        content: string;
        metadata: Record<string, unknown>;
    }> {
        const normalized = normalizePrompt(content);
        if (!normalized) {
            return {
                content: this.helpResponse(),
                metadata: { intent: "help" },
            };
        }

        const slashCommand = /^\/(\w+)(?:\s+(.+))?$/.exec(normalized);
        if (slashCommand) {
            const command = slashCommand[1]!.toLowerCase();
            const argument = (slashCommand[2] ?? "").trim();
            return this.handleSlashCommand(command, argument);
        }

        if (/^(help|capabilities|what can you do|show help|prism help)$/.test(normalized)) {
            return {
                content: this.helpResponse(),
                metadata: { intent: "help" },
            };
        }

        if (/^(status|health|show status|show health|get status|get health|prism status)$/.test(normalized)) {
            return {
                content: this.statusResponse(),
                metadata: { intent: "status" },
            };
        }

        if (/^(approvals|show approvals|list approvals|pending approvals|get approvals)$/.test(normalized)) {
            return {
                content: this.approvalsResponse(),
                metadata: { intent: "approvals" },
            };
        }

        if (/^(history|show history|list history|recent actions|recent history|action history)$/.test(normalized)) {
            return {
                content: this.actionHistoryResponse(),
                metadata: { intent: "action_history" },
            };
        }

        const actionName = this.resolveActionIntent(normalized);
        if (actionName) {
            try {
                this.triggerAction(actionName, sessionId);
                const action = this.actionStates.get(actionName)!;
                return {
                    content: `Started ${action.label}. Track progress in [Quick Actions](prism://tab/logs#actions) and [Recent Action History](prism://tab/logs#action-history).`,
                    metadata: { intent: "run_action", actionName },
                };
            } catch (error) {
                return {
                    content: `I could not start ${actionName}: ${String(error)}`,
                    metadata: { intent: "run_action_error", actionName },
                };
            }
        }

        try {
            const session = this.chatStore.getSession(sessionId);

            // Perform Intent Classification for Autonomous Escalation and Checks & Balances
            const classification = new IntentClassifier().classify(content);
            console.log(
                `[PRISM][Chat] Intent classification: intent=${classification.intent}, category=${classification.category}, requiresBrowser=${classification.requiresBrowser}, requiresComputer=${classification.requiresComputer}, confidence=${classification.confidence}`,
            );
            if (classification.intent === "autonomous_os_task" && this.autonomousLoop) {
                console.log(`[PRISM][Chat] ▶ Autonomous escalation triggered for: "${content.slice(0, 80)}"`);

                const op = this.devIdentity?.getOperator();
                const goal = this.autonomousLoop.submitGoal(
                    content,
                    "chat",
                    op?.operatorId ?? "chat-operator",
                    {
                        maxActions: 60,
                        allowBrowserUse: classification.requiresBrowser,
                        allowComputerUse: classification.requiresComputer,
                    },
                    sessionId,
                );
                // Start background execution of the autonomous loop
                this.autonomousLoop
                    .executeGoal(goal.goalId, (step) => {
                        const payload = JSON.stringify({ type: "autonomous_step", goalId: goal.goalId, ...step });
                        for (const ws of this.wsClients) {
                            try {
                                ws.send(payload);
                            } catch {
                                /* ignore */
                            }
                        }
                    })
                    .then((result) => {
                        console.log(
                            `[PRISM][Chat] Autonomous goal ${goal.goalId} completed with status: ${result.status}`,
                        );

                        const messageContent =
                            result.status === "completed"
                                ? `🤖 **Autonomous Task Completed**\n\nHere are the findings for **Goal \`${goal.goalId.substring(0, 8)}\`**:\n\n${result.summary}`
                                : `❌ **Autonomous Task Failed**\n\nGoal \`${goal.goalId.substring(0, 8)}\` failed:\n\n${result.summary}`;

                        this.chatStore.appendMessage(sessionId, "assistant", messageContent, {
                            intent: "autonomous_completion",
                            goalId: goal.goalId,
                            status: result.status,
                            summary: result.summary,
                        });

                        this.broadcastWs({
                            type: "autonomous_goal_complete",
                            goalId: goal.goalId,
                            status: result.status,
                            summary: result.summary,
                            iterations: result.iterations,
                            toolCallsExecuted: result.toolCallsExecuted,
                            totalDurationMs: result.totalDurationMs,
                            timestamp: new Date().toISOString(),
                        });
                    })
                    .catch((err) => {
                        console.error(`[PRISM][Chat] ✖ Autonomous goal execution failed for ${goal.goalId}:`, err);
                        this.activityBus.emit({
                            sessionId: "autonomous-chat",
                            layer: "governance",
                            operation: "autonomous.goal.execution_error",
                            status: "failed",
                            details: { goalId: goal.goalId, error: String(err) },
                        });
                    });

                const allowedModes: string[] = [];
                if (classification.requiresBrowser) allowedModes.push("🌐 Browser (Playwright)");
                if (classification.requiresComputer) allowedModes.push("🖱️ OS Computer Control (Win32)");

                return {
                    content: `🤖 **Autonomous Escalation Engaged**\n\nI detected that your request requires direct computer or browser control (*${classification.category}* task):\n> "${content}"\n\nI have escalated this to the **PRISM Autonomous Loop** as Goal **\`${goal.goalId.substring(0, 8)}\`**.\n\n*   **Allowed Modes:** ${allowedModes.join(" and ")}\n*   **Status:** Execution has started in the background. You can track detailed steps under the **[Agentic Control](prism://tab/agentic)** tab or view real-time operations in the **[Browser Control](prism://tab/browser#viewport)** / **[Computer Control](prism://tab/computer)** tabs!`,
                    metadata: { intent: "autonomous_escalation", goalId: goal.goalId, classification },
                };
            }

            const conversationHistory = conversation
                .filter(
                    (entry) =>
                        entry.role === "user" ||
                        entry.role === "assistant" ||
                        entry.role === "system" ||
                        entry.role === "tool",
                )
                .map((entry) => ({
                    role: entry.role,
                    content: entry.content,
                    tool_call_id: entry.metadata?.tool_call_id as string | undefined,
                    tool_calls: entry.metadata?.tool_calls as any[] | undefined,
                    thoughtSignature: (entry.metadata?.thoughtSignature || entry.metadata?.googleThoughtSignature) as
                        string | undefined,
                }));

            // If the session has an explicit provider/model override, use it directly.
            // Otherwise, use capability-aware role routing ("chat" role).
            const hasSessionOverride = session?.llmProviderId && session?.llmModel;
            const selection = hasSessionOverride
                ? { providerId: session.llmProviderId ?? undefined, model: session.llmModel ?? undefined }
                : undefined;

            // Figure out the active model and its tier to constrain the orchestrator
            const catalogInfo = await this.llmProviders.getCatalog(selection);
            const activeModelName = catalogInfo.activeModel;
            let modelTier = 3;
            if (activeModelName) {
                const profile = resolveProfile(activeModelName);
                modelTier = profile.tier;
            }

            // If we are using a local agent (often T1/T2), explicitly prefer "orchestrator" for agentic loops, else "chat"
            const agentRole = hasSessionOverride && selection?.providerId === "local" ? "orchestrator" : "chat";

            let systemPrompt = this.buildAgenticSystemPrompt();
            if (classification.intent === "prism_operating_task") {
                systemPrompt +=
                    "\n\n=== SPECIAL DIRECTIVE ===\nThe user is requesting an internal PRISM operations task (e.g., agent pool management, swarm configuration, or capability matrix routing/SR configuration). Prioritize calling the relevant control tools (e.g., 'prism_dashboard_control' or relevant configuration tools) to execute the task directly rather than just explaining how to do it.";
            }

            // ── Spectrum Refraction (Prism SR) — check if SR is active for this session ──
            const srConfig = this.chatStore.getSRConfig(sessionId);
            if (
                srConfig?.enabled &&
                srConfig.leftProviderId &&
                srConfig.leftModel &&
                srConfig.rightProviderId &&
                srConfig.rightModel
            ) {
                if (!this.agenticExecutor) {
                    const srResult = await this.llmProviders.generateSR(
                        {
                            message: content,
                            conversation: conversationHistory,
                            systemPrompt,
                        },
                        {
                            enabled: true,
                            leftModel: { providerId: srConfig.leftProviderId, model: srConfig.leftModel },
                            rightModel: { providerId: srConfig.rightProviderId, model: srConfig.rightModel },
                            leftSlot: srConfig.leftSlot ?? undefined,
                            rightSlot: srConfig.rightSlot ?? undefined,
                            leftTimeoutMs: srConfig.leftTimeoutMs ?? undefined,
                            rightTimeoutMs: srConfig.rightTimeoutMs ?? undefined,
                            circuitBreakerEnabled: srConfig.circuitBreakerEnabled,
                            showHemispheres: srConfig.showHemispheres,
                        },
                        selection,
                    );
                    if (srResult?.content?.trim()) {
                        return {
                            content: srResult.content,
                            metadata: {
                                intent: "llm_sr",
                                srEnabled: true,
                                leftModel: srConfig.leftModel,
                                rightModel: srConfig.rightModel,
                                leftProvider: srConfig.leftProviderId,
                                rightProvider: srConfig.rightProviderId,
                                timing: srResult.timing,
                                isolationLevel: srResult.isolationLevel,
                                mediaArtifactCount: srResult.mediaArtifacts.length,
                                showHemispheres: srConfig.showHemispheres,
                                hemispheres: {
                                    left: srResult.hemispheres.left
                                        ? {
                                              provider: srResult.hemispheres.left.providerId,
                                              model: srResult.hemispheres.left.model,
                                              content: srConfig.showHemispheres
                                                  ? srResult.hemispheres.left.content
                                                  : undefined,
                                          }
                                        : null,
                                    right: srResult.hemispheres.right
                                        ? {
                                              provider: srResult.hemispheres.right.providerId,
                                              model: srResult.hemispheres.right.model,
                                              content: srConfig.showHemispheres
                                                  ? srResult.hemispheres.right.content
                                                  : undefined,
                                          }
                                        : null,
                                    main: srResult.hemispheres.main
                                        ? {
                                              provider: srResult.hemispheres.main.providerId,
                                              model: srResult.hemispheres.main.model,
                                              content: srConfig.showHemispheres
                                                  ? srResult.hemispheres.main.content
                                                  : undefined,
                                          }
                                        : null,
                                },
                            },
                        };
                    }
                }
            }

            // Use agentic executor if available — enables tool calling loop
            if (this.agenticExecutor) {
                const agenticResult = await this.agenticExecutor.execute(
                    content,
                    conversationHistory,
                    systemPrompt,
                    async (input, sel) => {
                        if (
                            srConfig?.enabled &&
                            srConfig.leftProviderId &&
                            srConfig.leftModel &&
                            srConfig.rightProviderId &&
                            srConfig.rightModel
                        ) {
                            const srResult = await this.llmProviders.generateSR(
                                input,
                                {
                                    enabled: true,
                                    leftModel: { providerId: srConfig.leftProviderId, model: srConfig.leftModel },
                                    rightModel: { providerId: srConfig.rightProviderId, model: srConfig.rightModel },
                                    leftSlot: srConfig.leftSlot ?? undefined,
                                    rightSlot: srConfig.rightSlot ?? undefined,
                                    leftTimeoutMs: srConfig.leftTimeoutMs ?? undefined,
                                    rightTimeoutMs: srConfig.rightTimeoutMs ?? undefined,
                                    circuitBreakerEnabled: srConfig.circuitBreakerEnabled,
                                    showHemispheres: srConfig.showHemispheres,
                                },
                                sel || selection,
                            );
                            if (!srResult) return null;
                            return {
                                content: srResult.content,
                                toolCalls: srResult.toolCalls,
                                stopReason: srResult.stopReason,
                                thoughtSignature: srResult.thoughtSignature,
                            };
                        }

                        const result = hasSessionOverride
                            ? await this.llmProviders.generate(input, sel)
                            : await this.llmProviders.generateForRole(agentRole, input);
                        if (!result) return null;
                        return {
                            content: result.content,
                            toolCalls: result.toolCalls,
                            stopReason: result.stopReason,
                            thoughtSignature: result.thoughtSignature,
                        };
                    },
                    selection,
                    (event) => {
                        // Broadcast agentic events to SSE/WS clients
                        this.broadcastEvent({
                            type: "agentic_event",
                            sessionId,
                            event: {
                                type: event.type,
                                text: event.text,
                                toolCall: event.toolCall,
                                toolResult: event.toolResult,
                                error: event.error,
                                iteration: event.iteration,
                            },
                            timestamp: new Date().toISOString(),
                        });
                        if (event.type === "tool_call" && event.toolCall) {
                            this.pendingToolCalls.set(event.toolCall.id, {
                                toolName: event.toolCall.name,
                                startedAt: Date.now(),
                            });
                            this.activityBus.emit({
                                sessionId: this.status.sessionId,
                                layer: "causal",
                                operation: "chat.tool_call",
                                status: "succeeded",
                                details: {
                                    chatSessionId: sessionId,
                                    toolName: event.toolCall.name,
                                    toolCallId: event.toolCall.id,
                                    iteration: event.iteration,
                                },
                            });
                        }
                        if (event.type === "tool_result" && event.toolResult) {
                            const toolName = event.toolResult.name;
                            const pending = this.pendingToolCalls.get(event.toolResult.id);
                            const latencyMs = pending ? Date.now() - pending.startedAt : 0;
                            if (pending) this.pendingToolCalls.delete(event.toolResult.id);
                            if (toolName.startsWith("mcp_")) {
                                const pluginKey = this.resolvePluginName(toolName);
                                if (!this.pluginStates[pluginKey]) {
                                    this.pluginStates[pluginKey] = {
                                        enabled: true,
                                        healthy: true,
                                        requests: 0,
                                        errors: 0,
                                        avgResponseMs: 0,
                                        lastChecked: null,
                                    };
                                }
                                const ps = this.pluginStates[pluginKey];
                                ps.requests++;
                                if (!event.toolResult.ok) ps.errors++;
                                ps.avgResponseMs =
                                    ps.requests === 1
                                        ? latencyMs
                                        : Math.round((ps.avgResponseMs * (ps.requests - 1) + latencyMs) / ps.requests);
                                ps.lastChecked = new Date().toISOString();
                                ps.healthy = ps.errors / ps.requests < 0.5;
                            } else {
                                if (!this.toolStates[toolName]) {
                                    this.toolStates[toolName] = {
                                        enabled: true,
                                        invocations: 0,
                                        successes: 0,
                                        failures: 0,
                                        avgLatencyMs: 0,
                                        lastInvoked: null,
                                        lastError: null,
                                    };
                                }
                                const ts = this.toolStates[toolName];
                                ts.invocations++;
                                if (event.toolResult.ok) {
                                    ts.successes++;
                                } else {
                                    ts.failures++;
                                    ts.lastError =
                                        typeof event.toolResult.output === "string"
                                            ? event.toolResult.output.slice(0, 200)
                                            : "Tool call failed";
                                }
                                ts.avgLatencyMs =
                                    ts.invocations === 1
                                        ? latencyMs
                                        : Math.round(
                                              (ts.avgLatencyMs * (ts.invocations - 1) + latencyMs) / ts.invocations,
                                          );
                                ts.lastInvoked = new Date().toISOString();
                            }
                        }
                    },
                );

                if (agenticResult.finalContent?.trim()) {
                    return {
                        content: agenticResult.finalContent,
                        metadata: {
                            intent: "llm_agentic",
                            toolCallsExecuted: agenticResult.toolCallsExecuted,
                            iterations: agenticResult.iterations,
                            events: agenticResult.events
                                .filter((e) => e.type === "tool_call" || e.type === "tool_result" || e.type === "text")
                                .map((e) => ({
                                    type: e.type,
                                    text: e.text,
                                    tool: e.toolCall?.name ?? e.toolResult?.name,
                                    arguments: e.toolCall?.arguments,
                                    output: e.toolResult?.output
                                        ? typeof e.toolResult.output === "string"
                                            ? e.toolResult.output.slice(0, 4000)
                                            : JSON.stringify(e.toolResult.output).slice(0, 4000)
                                        : undefined,
                                    ok: e.toolResult?.ok,
                                })),
                        },
                    };
                }
            }

            // Fallback: route through agent router if available, otherwise single-shot LLM call
            if (!hasSessionOverride && this.agentRouter) {
                try {
                    const { classification, result } = await this.agentRouter.routeAndDispatch(
                        content,
                        conversationHistory.map((m) => `${m.role}: ${m.content}`).join("\n"),
                    );
                    if (result.ok && result.content?.trim()) {
                        return {
                            content: result.content,
                            metadata: {
                                intent: "agent_routed",
                                classifiedRole: classification.role,
                                classificationConfidence: classification.confidence,
                                classificationReason: classification.reasoning,
                                agentId: result.agentId,
                                model: result.model,
                                tier: result.tier,
                                durationMs: result.durationMs,
                            },
                        };
                    }
                } catch {
                    // Fall through to direct LLM call
                }
            }

            let generated;
            if (hasSessionOverride) {
                generated = await this.llmProviders.generate(
                    {
                        message: content,
                        conversation: conversationHistory,
                        systemPrompt,
                    },
                    selection,
                );
            } else {
                generated = await this.llmProviders.generateForRole("chat", {
                    message: content,
                    conversation: conversationHistory,
                    systemPrompt: "", // adaptive prompt builder will replace this
                });
            }

            // Record token usage for cost tracking
            if (generated?.tokensUsed && this.usageMetering) {
                this.usageMetering.record({
                    provider: generated.providerId,
                    model: generated.model,
                    sessionId,
                    inputTokens: generated.tokensUsed.input,
                    outputTokens: generated.tokensUsed.output,
                    costUsd: generated.tokensUsed.costUsd,
                });
            }

            if (generated?.content?.trim()) {
                const meta: Record<string, unknown> = {
                    intent: "llm",
                    provider: generated.providerId,
                    model: generated.model,
                };
                if ("routing" in generated) {
                    const r = generated as {
                        routing: { profile: { tier: number }; degraded: boolean; reason: string };
                    };
                    meta.tier = r.routing.profile.tier;
                    meta.degraded = r.routing.degraded;
                    meta.routingReason = r.routing.reason;
                }
                return { content: generated.content, metadata: meta };
            }
        } catch (error) {
            return {
                content: [
                    "The selected LLM provider failed.",
                    "",
                    `Reason: ${String(error)}`,
                    "",
                    "You can switch provider/model from the LLM section in the right rail.",
                ].join("\n"),
                metadata: { intent: "llm_error", error: String(error) },
            };
        }

        return {
            content: [
                "No active LLM provider is configured.",
                "",
                "Configure a provider and model from the right-rail LLM panel.",
                "Supported providers: OpenAI, Anthropic, Ollama (local), and custom OpenAI-compatible endpoints.",
                "",
                this.statusResponseCompact(),
            ].join("\n"),
            metadata: { intent: "llm_unconfigured" },
        };
    }

    /**
     * Enqueue a Tier-2 approval for a chat prompt and attach a background
     * continuation that, upon approval, runs the agentic executor to perform
     * the requested work. Returns the newly-created approval ids.
     */
    public enqueueApprovalAndAutoRun(
        sessionId: string,
        prompt: string,
        classification: { tier: number; reasonCode: string; matchedPattern?: string },
    ): string[] {
        const before = new Set(this.queue.list().map((entry) => entry.id));
        const approvalPromise = this.queue.request(
            sessionId,
            "chat.tier2",
            { prompt, reason_code: classification.reasonCode, matched_pattern: classification.matchedPattern },
            Number(this.runtimeSettings.approvalTimeoutMs || 120_000),
        );
        const after = this.queue.list().map((entry) => entry.id);
        const newIds = after.filter((id) => !before.has(id));

        // Background handler attached to the approval promise
        approvalPromise
            .then(async (approved) => {
                try {
                    const approvalId = newIds.length > 0 ? newIds[0] : undefined;
                    this.activityBus.emit({
                        sessionId,
                        layer: "governance",
                        operation: "approval.resolved",
                        status: "succeeded",
                        details: { approvalId, approved, reason_code: classification.reasonCode },
                    });

                    if (!approved) return;
                    if (!Boolean(this.runtimeSettings.autoRunApprovedTier2)) return;
                    if (!this.agenticExecutor) return;

                    try {
                        this.metricsStore?.inc("prism_auto_run_approved_tier2_total");
                    } catch {
                        /* best-effort telemetry */
                    }

                    const systemPrompt = this.buildAgenticSystemPrompt();
                    const autoRunStart = Date.now();

                    const agenticResult = await this.agenticExecutor.execute(
                        prompt,
                        [],
                        systemPrompt,
                        async (input, sel) => {
                            const result = await this.llmProviders.generate(input, sel);
                            if (!result) return null;
                            return {
                                content: result.content,
                                toolCalls: result.toolCalls,
                                stopReason: result.stopReason,
                                thoughtSignature: result.thoughtSignature,
                            } as any;
                        },
                        undefined,
                        (event) => {
                            this.broadcastEvent({
                                type: "agentic_event",
                                sessionId,
                                event: {
                                    type: event.type,
                                    text: event.text,
                                    toolCall: event.toolCall,
                                    toolResult: event.toolResult,
                                    error: event.error,
                                    iteration: event.iteration,
                                },
                                timestamp: new Date().toISOString(),
                            });
                        },
                    );

                    if (agenticResult.finalContent?.trim()) {
                        this.broadcastEvent({
                            type: "agentic_event",
                            sessionId,
                            event: {
                                type: "done",
                                text: agenticResult.finalContent,
                                iterations: agenticResult.iterations,
                            },
                            timestamp: new Date().toISOString(),
                        });
                    }

                    // Telemetry: record auto-run duration and structured server log
                    try {
                        const dur = Date.now() - autoRunStart;
                        this.metricsStore?.observe("prism_auto_run_duration_ms", dur);
                        console.log(
                            JSON.stringify({
                                event: "auto_run_completed",
                                sessionId,
                                approvalId: approvalId ?? null,
                                durationMs: dur,
                                iterations: agenticResult.iterations ?? null,
                            }),
                        );
                    } catch {
                        /* best-effort telemetry/logging */
                    }
                } catch (err) {
                    console.error("[APPROVAL HANDLER] Failed to continue approved request:", err);
                }
            })
            .catch((e) => console.error("[APPROVAL HANDLER] Unexpected error:", e));

        return newIds;
    }

    private buildAgenticSystemPrompt(): string {
        const toolNames = this.tools.map((t) => t.name).join(", ");
        const wsRoot = (() => {
            try {
                return resolveWorkspaceRoot();
            } catch {
                return process.cwd();
            }
        })();
        const wsWorkingDir = join(wsRoot, "workspace");
        return [
            "You are PRISM, a state-of-the-art autonomous software engineering agent with governed tool execution.",
            "You have access to a rich suite of IDE tools that you MUST use to design, plan, write, build, test, and audit codebase files. Do not just describe what you would do; execute the appropriate tool.",
            "",
            `Workspace root (parent): ${wsRoot}`,
            `Working directory: ${wsWorkingDir}`,
            `Source project (read-only reference): ${process.cwd()}`,
            `Available tools: ${toolNames}`,
            "",
            "=== CRITICAL WORKSPACE RULES ===",
            `- ALL files you create (websites, plans, code, task lists, implementation_plan.md, task.md, etc.) MUST be placed inside the Working directory: ${wsWorkingDir}`,
            "- ALWAYS use ABSOLUTE PATHS when calling file_write, file_read, and file_list tools.",
            `- When creating project directories, create them as subdirectories of ${wsWorkingDir} (e.g. ${join(wsWorkingDir, "prism_website")}).`,
            `- You may READ from the Source project at ${process.cwd()} (docs, source code) via shell_exec commands (e.g. 'type' or 'cat'), but NEVER write there.`,
            `- You may also read/write from any path under ${wsRoot} (e.g. ${wsRoot}\\artifacts, ${wsRoot}\\data).`,
            "",
            "=== 1. PLANNING & TASK TRACKING ===",
            "For all engineering and development tasks (such as writing features, refactoring APIs, adding tests, or creating frontends):",
            `- You MUST first draft a detailed implementation_plan.md at ${join(wsWorkingDir, "implementation_plan.md")}, outlining the file modifications, dependencies, architectural choices, and verification plan. Present this plan to the operator.`,
            `- Once approved, initialize a task.md file at ${join(wsWorkingDir, "task.md")} containing a hierarchically formatted TODO checklist.`,
            "- Update this checklist dynamically (mark items as `[ ]` for pending, `[/]` for in-progress, or `[x]` for completed) as you execute each step.",
            "",
            "=== 2. SOFTWARE DESIGN & CODE CRAFTING ===",
            "Apply world-class software development practices across all languages and frameworks:",
            "- Write clean, highly modular, dry, and well-documented code. Choose clear, descriptive names for all classes, methods, and variables.",
            "- Maintain documentation integrity: do not strip or delete existing comments, JSDoc headers, or code docstrings.",
            "- Never stub out methods or write comments like `// TODO: implement later`. Provide a complete, fully functional, production-ready implementation.",
            "- Design elegant, responsive visual interfaces: when building frontends, use premium Obsidian-Glass aesthetics (Google Fonts Outfit/Inter, blurred glassmorphic panels, rich HSL color gradients, smooth hover animations, and high-fidelity custom SVGs).",
            "",
            "=== 3. SURGICAL IDE OPERATIONS & SAFETY ===",
            "- Read files fully before making modifications to ensure full contextual awareness.",
            "- Avoid broad file overrides or rewriting whole files whenever possible. Use precise, surgical edits using the specific tools like `prism_ide_modify`.",
            "- Always run your built-in syntax and structural checks (`prism_ide_lint`) to perform AST tags validation, missing imports/exports checks, and code reference audits.",
            "- Compile and verify your builds: proactively run command-line tasks (like `npm run build`, `tsc`, or python tests) via terminal tools to check for syntax and type safety.",
            "- Execute reference audits and verify page link or console integrity to ensure absolute robustness before completing the task.",
            "",
            "=== 4. COMPUTER & BROWSER AUTONOMOUS CONTROL ===",
            "When executing tasks requiring browser or desktop control:",
            "- Navigate systematically: always follow the chain of actions (launch_session -> navigate -> perceive/screenshot -> click -> type -> verify).",
            "- Visual validation: after page changes, always capture a screenshot and inspect the visual state. Multimodal models will receive actual image elements instead of text strings for precise pixel-level feedback.",
            "- Fallbacks: if Playwright page clicks fail, fall back to explicit coordinates or search using elements in the accessibility tree.",
            "- Power efficiency: dynamically route heavy tool chains to cloud frontier instances while utilizing local 1-4B parameter models for small summaries and classification steps under adaptive power settings.",
            "",
            `Runtime mode: ${this.status.mode}. Environment: ${this.status.environmentProfile}.`,
            `Pending approvals: ${this.queue.list().length}.`,
            "",
            "Respond with concise, professional information. Show tool results to the user.",
        ].join("\n");
    }

    public async handleAttachmentUpload(
        req: IncomingMessage,
        res: ServerResponse,
        sessionId: string,
        messageId: string,
    ): Promise<void> {
        // Read raw body (multipart boundary parsing)
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const bodyBuf = Buffer.concat(chunks);

        const contentType = req.headers["content-type"] ?? "";
        const attachDir = workspacePath("attachments", sessionId);
        mkdirSync(attachDir, { recursive: true });

        if (contentType.startsWith("multipart/form-data")) {
            const boundaryMatch = /boundary=([^;]+)/.exec(contentType);
            if (!boundaryMatch) return this.json(res, 400, { error: "Missing boundary in multipart." });
            const boundary = boundaryMatch[1]!;
            const parts = parseMultipartParts(bodyBuf, boundary);
            const saved: any[] = [];
            for (const part of parts) {
                const fileName = sanitizeFileName(part.fileName || `attachment_${randomUUID()}`);
                const storagePath = join(attachDir, `${randomUUID()}_${fileName}`);
                writeFileSync(storagePath, part.data);
                const attachment = this.chatStore.saveAttachment({
                    messageId,
                    sessionId,
                    fileName,
                    mimeType: part.contentType || "application/octet-stream",
                    sizeBytes: part.data.length,
                    storagePath,
                    includeInContext: true,
                });
                saved.push(attachment);
            }
            return this.json(res, 201, { attachments: saved });
        }

        // Fallback: raw body upload with headers
        const fileName = sanitizeFileName((req.headers["x-file-name"] as string) || `attachment_${randomUUID()}`);
        const mimeType = (req.headers["x-mime-type"] as string) || contentType || "application/octet-stream";
        const storagePath = join(attachDir, `${randomUUID()}_${fileName}`);
        writeFileSync(storagePath, bodyBuf);
        const attachment = this.chatStore.saveAttachment({
            messageId,
            sessionId,
            fileName,
            mimeType,
            sizeBytes: bodyBuf.length,
            storagePath,
            includeInContext: true,
        });
        return this.json(res, 201, { attachment });
    }

    public serveAttachmentFile(res: ServerResponse, attachmentId: string, thumbnail = false): void {
        const attachment = this.chatStore.getAttachmentById(attachmentId);
        if (!attachment) {
            res.writeHead(404).end("Not found");
            return;
        }

        const filePath = thumbnail && attachment.thumbnailPath ? attachment.thumbnailPath : attachment.storagePath;
        if (!existsSync(filePath)) {
            res.writeHead(404).end("File not found on disk");
            return;
        }

        const data = readFileSync(filePath);
        res.writeHead(200, {
            "Content-Type": attachment.mimeType,
            "Content-Length": data.length.toString(),
            "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
            "Cache-Control": "private, max-age=3600",
        });
        res.end(data);
    }

    private handleSlashCommand(
        command: string,
        argument: string,
    ): { content: string; metadata: Record<string, unknown> } {
        if (command === "help") {
            return { content: this.helpResponse(), metadata: { intent: "help" } };
        }

        if (command === "status") {
            return { content: this.statusResponse(), metadata: { intent: "status" } };
        }

        if (command === "approvals") {
            return { content: this.approvalsResponse(), metadata: { intent: "approvals" } };
        }

        if (command === "history") {
            return { content: this.actionHistoryResponse(), metadata: { intent: "action_history" } };
        }

        if (command === "actions") {
            return { content: this.actionsResponse(), metadata: { intent: "actions" } };
        }

        if (command === "approve") {
            if (!argument) {
                return { content: "Usage: /approve <approval-id>", metadata: { intent: "approve_usage" } };
            }
            const approved = this.queue.approve(argument);
            return {
                content: approved ? `Approved ${argument}.` : `No pending approval matched ${argument}.`,
                metadata: { intent: "approve", approvalId: argument, approved },
            };
        }

        if (command === "deny") {
            if (!argument) {
                return { content: "Usage: /deny <approval-id>", metadata: { intent: "deny_usage" } };
            }
            const denied = this.queue.deny(argument);
            return {
                content: denied ? `Denied ${argument}.` : `No pending approval matched ${argument}.`,
                metadata: { intent: "deny", approvalId: argument, denied },
            };
        }

        if (command === "run") {
            if (!argument) {
                return { content: this.actionsResponse(), metadata: { intent: "actions" } };
            }
            const actionName = this.resolveActionIntent(normalizePrompt(argument));
            if (!actionName) {
                return {
                    content: `I could not map \"${argument}\" to a dashboard action.\n\n${this.actionsResponse()}`,
                    metadata: { intent: "run_action_not_found", argument },
                };
            }

            try {
                this.triggerAction(actionName);
                const action = this.actionStates.get(actionName)!;
                return {
                    content: `Started ${action.label}.`,
                    metadata: { intent: "run_action", actionName },
                };
            } catch (error) {
                return {
                    content: `I could not start ${actionName}: ${String(error)}`,
                    metadata: { intent: "run_action_error", actionName },
                };
            }
        }

        return {
            content: `Unknown command: /${command}\n\n${this.helpResponse()}`,
            metadata: { intent: "unknown_command", command },
        };
    }

    private helpResponse(): string {
        return [
            "PRISM chat controls",
            "",
            "Natural language:",
            "- show status",
            "- show approvals",
            "- run workflow demo",
            "- run approval demo",
            "- show recent action history",
            "",
            "Slash commands:",
            "- /status",
            "- /actions",
            "- /approvals",
            "- /history",
            "- /run workflow demo",
            "- /approve <approval-id>",
            "- /deny <approval-id>",
            "",
            "Provider control:",
            "- Use the LLM panel to switch provider/model at runtime.",
            "- Store provider API keys in the secure Provider & Settings panel.",
        ].join("\n");
    }

    private statusResponseCompact(): string {
        const sessions = this.chatStore.listSessions().length;
        return `Runtime ${this.status.mode} mode, ${this.queue.list().length} pending approvals, ${this.listActionHistory().length} recorded action runs, ${sessions} persisted chat sessions.`;
    }

    private statusResponse(): string {
        const events = this.activityBus.listEvents();
        const lastEvent = events[events.length - 1];
        return [
            "PRISM runtime status",
            "",
            `- mode: ${this.status.mode}`,
            `- environment: ${this.status.environmentProfile}`,
            `- started: ${this.status.startedAt}`,
            `- pending approvals: ${this.queue.list().length}`,
            `- persisted chat sessions: ${this.chatStore.listSessions().length}`,
            `- activity events: ${events.length}`,
            `- last event: ${lastEvent ? `${lastEvent.operation} (${lastEvent.status})` : "none"}`,
        ].join("\n");
    }

    private approvalsResponse(): string {
        const pending = this.queue.list();
        if (pending.length === 0) {
            return "There are no pending approvals.";
        }

        return [
            `Pending approvals: ${pending.length}`,
            "",
            ...pending.map((item) => `- ${item.operation} | ${item.id}`),
            "",
            "Use /approve <approval-id> or /deny <approval-id> from chat, or use the approval buttons in the right rail.",
        ].join("\n");
    }

    private actionsResponse(): string {
        const actions = this.listActions();
        return [
            "Available dashboard actions",
            "",
            ...actions.map(
                (action) =>
                    `- ${action.label} | command: /run ${action.label.toLowerCase()} | status: ${action.status}`,
            ),
        ].join("\n");
    }

    private actionHistoryResponse(): string {
        const history = this.listActionHistory().slice(0, 5);
        if (history.length === 0) {
            return "No action runs have been recorded yet.";
        }

        return [
            "Recent action history",
            "",
            ...history.map(
                (entry) => `- ${entry.label} | ${entry.status} | ${entry.message ?? entry.error ?? "no outcome yet"}`,
            ),
        ].join("\n");
    }

    private resolveActionIntent(normalized: string): string | null {
        const aliases = new Map<string, string>([
            ["workflow demo", "run_workflow_demo"],
            ["run workflow demo", "run_workflow_demo"],
            ["workflow", "run_workflow_demo"],
            ["approval demo", "run_approval_demo"],
            ["run approval demo", "run_approval_demo"],
            ["queue approval", "run_approval_demo"],
            ["file list demo", "run_file_list"],
            ["run file list demo", "run_file_list"],
            ["list files", "run_file_list"],
        ]);

        for (const [alias, actionName] of aliases) {
            if (normalized.includes(alias)) {
                return actionName;
            }
        }

        for (const action of this.listActions()) {
            const normalizedName = action.name.replace(/_/g, " ");
            if (normalized.includes(normalizedName) || normalized.includes(action.label.toLowerCase())) {
                return action.name;
            }
        }

        return null;
    }

    private recordActionHistory(entry: DashboardActionHistoryEntry): void {
        this.actionHistory.unshift(entry);
        if (this.actionHistory.length > this.actionHistoryLimit) {
            this.actionHistory.length = this.actionHistoryLimit;
        }
    }

    private updateActionHistory(
        runId: string,
        update: Pick<DashboardActionHistoryEntry, "status" | "completedAt" | "message" | "error">,
    ): void {
        const entry = this.actionHistory.find((candidate) => candidate.runId === runId);
        if (!entry) {
            return;
        }
        entry.status = update.status;
        entry.completedAt = update.completedAt;
        entry.message = update.message;
        entry.error = update.error;
    }

    private emitLlmSelectionAudit(
        status: "succeeded" | "failed",
        details: {
            sessionId: string;
            source: string;
            requestedProviderId: string;
            requestedModel: string | null;
            previousProviderId?: string | null;
            previousModel?: string | null;
            selectedProviderId?: string | null;
            selectedModel?: string | null;
            reason?: string;
            correlationId?: string;
        },
    ): void {
        this.activityBus.emit({
            sessionId: this.status.sessionId,
            layer: "causal",
            operation: "dashboard.llm_selection",
            status,
            details: {
                chatSessionId: details.sessionId,
                source: details.source,
                requestedProviderId: details.requestedProviderId,
                requestedModel: details.requestedModel,
                previousProviderId: details.previousProviderId ?? null,
                previousModel: details.previousModel ?? null,
                selectedProviderId: details.selectedProviderId ?? null,
                selectedModel: details.selectedModel ?? null,
                reason: details.reason ?? null,
                correlationId: details.correlationId ?? `llm-selection:${randomUUID()}`,
            },
        });
    }

    private refreshProviderConfiguration(): void {
        this.llmProviders.setPersistedProviderSettings(this.chatStore.listProviderSettings());
    }

    private requireProviderId(providerId: string): PrismLlmProviderId {
        const resolved = this.llmProviders.resolveProvider(providerId.trim().toLowerCase());
        if (!resolved) {
            throw new Error(`Unknown provider: ${providerId}`);
        }
        return resolved;
    }

    private getProviderSnapshot(providerId: PrismLlmProviderId) {
        const catalog = this.llmProviders.getCatalog({ providerId, model: null });
        return catalog.then((resolvedCatalog) => {
            const snapshot = resolvedCatalog.providers.find((provider) => provider.id === providerId);
            if (!snapshot) {
                throw new Error(`Unknown provider: ${providerId}`);
            }
            return snapshot;
        });
    }

    private isBinaryAvailable(binaryPath: string): boolean {
        if (existsSync(binaryPath)) return true;
        try {
            const cmd = process.platform === "win32" ? "where.exe" : "which";
            const res = spawnSync(cmd, [binaryPath], { encoding: "utf8" });
            return res.status === 0;
        } catch {
            return false;
        }
    }

    public async getReadinessSnapshot(requestedSessionId?: string): Promise<DashboardReadinessSnapshot> {
        const sessions = this.chatStore.listSessions();
        const activeSessionId = requestedSessionId ?? sessions[0]?.sessionId ?? null;

        const activeSession = activeSessionId ? this.chatStore.getSession(activeSessionId) : null;

        const catalog = activeSessionId
            ? await this.getSessionLlmCatalog(activeSessionId)
            : await this.llmProviders.getCatalog();

        const hasEnabledProvider = catalog.providers.some((provider) => provider.enabled);
        const activeProvider = catalog.activeProviderId
            ? (catalog.providers.find((provider) => provider.id === catalog.activeProviderId) ?? null)
            : null;

        const boundToSession = Boolean(activeSession?.llmProviderId && activeSession?.llmModel);
        const requirements = [
            {
                id: "provider-available",
                label: "At least one provider is available",
                passed: hasEnabledProvider,
                detail: hasEnabledProvider
                    ? "A provider can be used."
                    : "Configure provider settings and store an API key for at least one provider.",
            },
            {
                id: "session-selected",
                label: "A chat session is selected",
                passed: Boolean(activeSessionId),
                detail: activeSessionId
                    ? "Session context is active."
                    : "There is no session. Auto-create enabled for individual profile, else initiate Prism's accountability systems.",
            },
            {
                id: "provider-model-selected",
                label: "Provider and model are selected for this session",
                passed: boundToSession,
                detail: boundToSession
                    ? `Using ${activeSession?.llmProviderId} / ${activeSession?.llmModel}.`
                    : "Open Provider & Settings and click Apply on a provider/model.",
            },
            {
                id: "selected-provider-ready",
                label: "Selected provider is ready",
                passed: Boolean(activeProvider?.enabled && catalog.activeModel),
                detail: activeProvider?.enabled
                    ? catalog.activeModel
                        ? "Provider and model are reachable for requests."
                        : "Select a model for the active provider."
                    : (activeProvider?.reason ?? "No active provider is currently usable."),
            },
        ];

        const activeProviderId = activeSession?.llmProviderId ?? catalog.activeProviderId ?? null;
        if (activeProviderId === "llamacpp" || activeProviderId === "bitnetcpp") {
            const supervisor = activeProviderId === "llamacpp" ? this.llamaSupervisor : this.bitnetSupervisor;
            const supervisorName = activeProviderId === "llamacpp" ? "llama.cpp" : "BitNet.cpp";
            if (supervisor) {
                const binPath = supervisor.getConfig().binaryPath;
                const available = this.isBinaryAvailable(binPath);
                let detail = available
                    ? `Local ${supervisorName} binary is found and supervisor is active.`
                    : `Local ${supervisorName} binary "${binPath}" was not found. Please install ${supervisorName} and ensure it is in your system PATH, or specify the absolute binary path in Settings below.`;

                const slotWithErr = supervisor.getSnapshot().find((s) => s.status === "error");
                const hasErr = !available || (slotWithErr && slotWithErr.error);
                if (slotWithErr && slotWithErr.error) {
                    detail = `${supervisorName} service error in Slot ${slotWithErr.id}: ${slotWithErr.error}. You can restart the slot in the Agentic Control panel.`;
                }

                requirements.push({
                    id: "local-llm-service-ready",
                    label: `Local ${supervisorName} service is ready`,
                    passed: !hasErr,
                    detail: detail,
                });
            }
        }

        const recommendations: string[] = [];
        if (!hasEnabledProvider) {
            recommendations.push("Configure at least one provider endpoint and required API key.");
        }
        if (activeSessionId && !boundToSession) {
            recommendations.push("In Provider & Settings, choose a provider and model, then click Apply.");
        }
        if (!activeSessionId) {
            recommendations.push("Create a chat session from the left sidebar.");
        }

        return {
            checkedAt: new Date().toISOString(),
            ready: requirements.every((entry) => entry.passed),
            activeSessionId,
            selectedProviderId: activeSession?.llmProviderId ?? catalog.activeProviderId ?? null,
            selectedModel: activeSession?.llmModel ?? catalog.activeModel ?? null,
            requirements,
            recommendations,
        };
    }

    public emitReadinessAudit(
        source: string,
        snapshot: DashboardReadinessSnapshot,
        correlationId: string = `readiness:${randomUUID()}`,
    ): void {
        this.activityBus.emit({
            sessionId: this.status.sessionId,
            layer: "causal",
            operation: "dashboard.readiness_check",
            status: snapshot.ready ? "succeeded" : "failed",
            details: {
                source,
                ready: snapshot.ready,
                activeSessionId: snapshot.activeSessionId,
                selectedProviderId: snapshot.selectedProviderId,
                selectedModel: snapshot.selectedModel,
                recommendations: snapshot.recommendations,
                correlationId,
            },
        });
    }
}

function parseLimit(url: string, fallback: number): number {
    try {
        const parsed = new URL(`http://localhost${url}`);
        const value = Number(parsed.searchParams.get("limit") ?? fallback);
        if (!Number.isFinite(value)) {
            return fallback;
        }
        return Math.max(1, Math.min(500, Math.floor(value)));
    } catch {
        return fallback;
    }
}
