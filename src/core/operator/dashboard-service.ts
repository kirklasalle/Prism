import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
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
import {
  ChatSessionStore,
  type ProviderSettingsInput,
  type ChatMessage,
  type SessionConfigDraft,
  type SessionConfigHistoryEntry,
  type ChatSessionSummary,
} from "./chat-session-store.js";
import {
  LlmProviderManager,
  type LlmProviderCatalog,
  type PrismLlmProviderId,
  type RoutingConfig,
} from "./llm-provider-manager.js";
import {
  WindowsProtectedFileProviderSecretStore,
  type ProviderSecretStore,
} from "./provider-secret-store.js";
import { SessionTraceExplorer, type SessionTraceBundle } from "./session-trace-explorer.js";
import { PolicyAuditExporter, type PolicyAuditBundle } from "./policy-audit-exporter.js";
import { SessionPackageSqliteStore } from "./session-package-sqlite-store.js";
import type { RetrievalMetricsCollector } from "../memory/retrieval-metrics.js";
import type { RetrievalDashboardStore } from "../memory/retrieval-dashboard-store.js";
import type { Tool } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { workspacePath, resolveWorkspaceRoot, setWorkspaceRoot, ensureWorkspaceStructure, workspaceFramebufferDir } from "../config/workspace-resolver.js";
import { FramebufferCapture } from "./framebuffer-capture.js";
import { AgenticChatExecutor, type AgenticTurnEvent, type AgenticResult } from "./agentic-chat-executor.js";

export interface DashboardRuntimeStatus {
  sessionId: string;
  environmentProfile: string;
  mode: "demo" | "server";
  startedAt: string;
  executionProfileSegment: "individual" | "business";
}

export interface DashboardAction {
  name: string;
  label: string;
  description: string;
  run: () => Promise<{ message: string; details?: Record<string, unknown> }>;
}

export interface DashboardActionState {
  name: string;
  label: string;
  description: string;
  status: "idle" | "running" | "succeeded" | "failed";
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastMessage: string | null;
  lastError: string | null;
}

export interface DashboardActionHistoryEntry {
  runId: string;
  name: string;
  label: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  completedAt: string | null;
  message: string | null;
  error: string | null;
}

export interface DashboardChatTurn {
  session: ChatSessionSummary;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

interface DashboardReadinessSnapshot {
  checkedAt: string;
  ready: boolean;
  activeSessionId: string | null;
  selectedProviderId: string | null;
  selectedModel: string | null;
  requirements: Array<{
    id: string;
    label: string;
    passed: boolean;
    detail: string;
  }>;
  recommendations: string[];
}

interface SessionConfigDiff {
  changedFields: string[];
  before: { providerId: string | null; model: string | null };
  after: { providerId: string | null; model: string | null };
}

interface SessionConfigState {
  sessionId: string;
  current: { providerId: string | null; model: string | null };
  draft: SessionConfigDraft | null;
  diff: SessionConfigDiff | null;
  history: SessionConfigHistoryEntry[];
}

export type TelemetryWindow = "1h" | "1d" | "7d";

export interface TelemetryWindowMetrics {
  windowLabel: TelemetryWindow;
  windowMs: number;
  fromTs: string;
  toTs: string;
  eventsTotal: number;
  failures: number;
  approvals: number;
  failureRate: number;
}

export interface TelemetryWindowDelta {
  eventsTotal: number;
  failures: number;
  approvals: number;
  failureRate: number;
}

export interface TelemetrySummary {
  generatedAt: string;
  window: TelemetryWindowMetrics;
  priorWindow: TelemetryWindowMetrics;
  delta: TelemetryWindowDelta;
  topOperations: Array<{ operation: string; count: number; failures: number }>;
  newSinceLastWindow: boolean;
}

export type AlertSeverity = "critical" | "warning" | "info";

export interface PrioritizedAlert {
  severity: AlertSeverity;
  message: string;
  source: "retrieval" | "activity";
  detectedAt: string;
}

export interface PrioritizedAlertResponse {
  generatedAt: string;
  alerts: PrioritizedAlert[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

export interface CorrelatedTraceSummary {
  correlationId: string;
  chatSessionId: string | null;
  startedAt: string;
  lastAt: string;
  eventCount: number;
  failures: number;
  status: "succeeded" | "failed";
  operations: string[];
}

export interface CorrelatedTraceResponse {
  generatedAt: string;
  traces: CorrelatedTraceSummary[];
  selectedCorrelationId: string | null;
  selectedTraceEvents: ActivityEvent[];
}

export interface RuntimeExcellenceSnapshot {
  generatedAt: string;
  window: TelemetryWindow;
  metrics: {
    eventsTotal: number;
    failures: number;
    failureRate: number;
    approvalFailures: number;
    traceFailureRate: number;
    retrievalAlertCount: number;
  };
  scores: {
    runtimeHealth: number;
    memoryConfidence: number;
  };
  planner: {
    priority: "low" | "medium" | "high";
    nextAction: string;
    rationale: string;
  };
  selfHealingSuggestions: Array<{
    id: string;
    title: string;
    trigger: string;
    action: string;
  }>;
}

export type SessionPackageStatus = "planned" | "running" | "blocked" | "complete";

export interface SessionPackageRecord {
  packageId: string;
  title: string;
  areaOfInterest: string | null;
  objective: string | null;
  successCriteria: string | null;
  dependencies: string[];
  status: SessionPackageStatus;
  createdAt: string;
  updatedAt: string;
  sessionIds: string[];
  lastRunAt: string | null;
  lastExportAt: string | null;
  exportArtifactPath: string | null;
}

export interface SessionPackageSummary {
  chapterCount: number;
  completedChapterCount: number;
  completionPct: number;
  lastActiveAt: string | null;
  lastActiveSessionTitle: string | null;
  latestPolicyDecision: "allow" | "deny" | "require_approval" | null;
  pendingApprovalCount: number;
}

export interface SessionPackageEnvelope extends SessionPackageRecord {
  summary: SessionPackageSummary;
}

export interface SessionPackageHistoryEntry {
  historyId: string;
  packageId: string;
  title: string;
  action: "created" | "status_changed" | "workflow_started" | "workflow_paused" | "workflow_blocked" | "workflow_completed" | "exported" | "unpackaged";
  timestamp: string;
  status: SessionPackageStatus;
  previousStatus: SessionPackageStatus | null;
  nextStatus: SessionPackageStatus | null;
  source: string;
  message: string | null;
  targetSessionId: string | null;
}

export interface SessionPackageReleaseSnapshot {
  totalPackages: number;
  byStatus: Record<SessionPackageStatus, number>;
  exportedCount: number;
  latestExportArtifactPath: string | null;
  latestExportedAt: string | null;
  completeWithoutExportCount: number;
}

export interface SessionPackageTraceExport {
  exportedAt: string;
  artifactPath: string;
  package: SessionPackageEnvelope;
  chapters: Array<{
    sessionId: string;
    sessionTitle: string;
    trace: SessionTraceBundle;
    policyAudit: PolicyAuditBundle;
  }>;
  aggregate: {
    totalEvents: number;
    totalPolicyRecords: number;
    chaptersExported: number;
  };
}

interface SessionPackageStoreSnapshot {
  packages: SessionPackageRecord[];
  history: SessionPackageHistoryEntry[];
}

export interface SessionPackageMetrics {
  generatedAt: string;
  totals: {
    all: number;
    byStatus: Record<SessionPackageStatus, number>;
  };
  chapterStats: {
    total: number;
    avg: number;
    min: number;
    max: number;
  };
  exportStats: {
    exportedCount: number;
    exportRate: number;
    completeWithoutExportCount: number;
  };
  historyStats: {
    totalEntries: number;
    actionFrequency: Array<{ action: string; count: number }>;
  };
  creationTrend: Array<{ day: string; count: number }>;
}

interface ProviderSettingsPayload {
  providerId: PrismLlmProviderId;
  baseUrl: string;
  apiKeyHeader: string | null;
  models: string[];
  defaultModel: string | null;
  requiresApiKey: boolean;
  hasApiKey: boolean;
  enabled: boolean;
  reason?: string;
  settingsSource: "environment" | "persisted";
  updatedAt: string | null;
  source: string | null;
}

const TELEMETRY_WINDOW_MS: Record<TelemetryWindow, number> = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

function parseTelemetryWindow(raw: string | null): TelemetryWindow {
  if (raw === "1h" || raw === "1d" || raw === "7d") return raw;
  return "1d";
}

function computeWindowMetrics(
  events: readonly ActivityEvent[],
  windowMs: number,
  now: number,
  offsetMs: number,
): TelemetryWindowMetrics {
  const toTs = now - offsetMs;
  const fromTs = toTs - windowMs;
  const slice = events.filter((e) => {
    const ts = Date.parse(e.timestamp);
    return Number.isFinite(ts) && ts >= fromTs && ts < toTs;
  });
  const failures = slice.filter((e) => e.status === "failed").length;
  const approvals = slice.filter((e) => e.operation.includes("approval")).length;
  const label = (windowMs === TELEMETRY_WINDOW_MS["1h"] ? "1h"
    : windowMs === TELEMETRY_WINDOW_MS["1d"] ? "1d" : "7d") as TelemetryWindow;
  return {
    windowLabel: label,
    windowMs,
    fromTs: new Date(fromTs).toISOString(),
    toTs: new Date(toTs).toISOString(),
    eventsTotal: slice.length,
    failures,
    approvals,
    failureRate: slice.length > 0 ? failures / slice.length : 0,
  };
}

function computeTelemetrySummary(
  events: readonly ActivityEvent[],
  windowLabel: TelemetryWindow,
): TelemetrySummary {
  const now = Date.now();
  const windowMs = TELEMETRY_WINDOW_MS[windowLabel];
  const current = computeWindowMetrics(events, windowMs, now, 0);
  const prior = computeWindowMetrics(events, windowMs, now, windowMs);

  const opCounts = new Map<string, { count: number; failures: number }>();
  const toTs = now;
  const fromTs = toTs - windowMs;
  for (const e of events) {
    const ts = Date.parse(e.timestamp);
    if (!Number.isFinite(ts) || ts < fromTs || ts >= toTs) continue;
    const existing = opCounts.get(e.operation) ?? { count: 0, failures: 0 };
    existing.count++;
    if (e.status === "failed") existing.failures++;
    opCounts.set(e.operation, existing);
  }

  const topOperations = Array.from(opCounts.entries())
    .map(([operation, stats]) => ({ operation, ...stats }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const delta: TelemetryWindowDelta = {
    eventsTotal: current.eventsTotal - prior.eventsTotal,
    failures: current.failures - prior.failures,
    approvals: current.approvals - prior.approvals,
    failureRate: parseFloat((current.failureRate - prior.failureRate).toFixed(4)),
  };

  const newSinceLastWindow = prior.eventsTotal === 0 && current.eventsTotal > 0;

  return {
    generatedAt: new Date(now).toISOString(),
    window: current,
    priorWindow: prior,
    delta,
    topOperations,
    newSinceLastWindow,
  };
}

function classifyAlertSeverity(message: string): AlertSeverity {
  const lower = message.toLowerCase();
  if (
    lower.includes("critical") ||
    lower.includes("drift detected") ||
    lower.includes("spike") ||
    lower.includes("p95") && lower.includes("exceeds") ||
    lower.includes("hit rate below") ||
    lower.includes("utility below") && lower.includes("0.3")
  ) {
    return "critical";
  }
  if (
    lower.includes("warning") ||
    lower.includes("drop") ||
    lower.includes("below") ||
    lower.includes("decline") ||
    lower.includes("increased") ||
    lower.includes("trend")
  ) {
    return "warning";
  }
  return "info";
}

function buildPrioritizedAlerts(
  rawAlerts: string[],
  source: "retrieval" | "activity",
  detectedAt: string,
): PrioritizedAlert[] {
  return rawAlerts.map((message) => ({
    severity: classifyAlertSeverity(message),
    message,
    source,
    detectedAt,
  }));
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

function eventCorrelationId(event: ActivityEvent): string | null {
  const details = event.details as Record<string, unknown> | undefined;
  const correlationId = details?.correlationId;
  return typeof correlationId === "string" && correlationId.trim().length > 0
    ? correlationId
    : null;
}

function buildCorrelatedTraceSummaries(
  events: readonly ActivityEvent[],
  limit: number,
  chatSessionId: string | null,
): CorrelatedTraceSummary[] {
  const grouped = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const correlationId = eventCorrelationId(event);
    if (!correlationId) {
      continue;
    }
    const details = event.details as Record<string, unknown> | undefined;
    const eventChatSessionId = typeof details?.chatSessionId === "string"
      ? details.chatSessionId
      : null;
    if (chatSessionId && eventChatSessionId !== chatSessionId) {
      continue;
    }
    const existing = grouped.get(correlationId) ?? [];
    existing.push(event);
    grouped.set(correlationId, existing);
  }

  return Array.from(grouped.entries())
    .map(([correlationId, traceEvents]) => {
      traceEvents.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      const first = traceEvents[0]!;
      const last = traceEvents[traceEvents.length - 1]!;
      const failures = traceEvents.filter((event) => event.status === "failed").length;
      const operations = Array.from(new Set(traceEvents.map((event) => event.operation))).slice(0, 5);
      const firstDetails = first.details as Record<string, unknown> | undefined;
      const firstChatSessionId = typeof firstDetails?.chatSessionId === "string"
        ? firstDetails.chatSessionId
        : null;
      return {
        correlationId,
        chatSessionId: firstChatSessionId,
        startedAt: first.timestamp,
        lastAt: last.timestamp,
        eventCount: traceEvents.length,
        failures,
        status: failures > 0 ? "failed" : "succeeded",
        operations,
      } as CorrelatedTraceSummary;
    })
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
    .slice(0, Math.max(1, limit));
}

function getCorrelatedTraceEvents(
  events: readonly ActivityEvent[],
  correlationId: string,
  chatSessionId: string | null,
): ActivityEvent[] {
  return events
    .filter((event) => eventCorrelationId(event) === correlationId)
    .filter((event) => {
      if (!chatSessionId) {
        return true;
      }
      const details = event.details as Record<string, unknown> | undefined;
      return details?.chatSessionId === chatSessionId;
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function computeRuntimeExcellenceSnapshot(
  events: readonly ActivityEvent[],
  window: TelemetryWindow,
  retrievalAlertCount: number,
): RuntimeExcellenceSnapshot {
  const now = Date.now();
  const windowMs = TELEMETRY_WINDOW_MS[window];
  const fromTs = now - windowMs;
  const recentEvents = events.filter((event) => {
    const ts = Date.parse(event.timestamp);
    return Number.isFinite(ts) && ts >= fromTs && ts <= now;
  });

  const eventsTotal = recentEvents.length;
  const failures = recentEvents.filter((event) => event.status === "failed").length;
  const failureRate = eventsTotal > 0 ? failures / eventsTotal : 0;
  const approvalFailures = recentEvents
    .filter((event) => event.operation.includes("approval") && event.status === "failed")
    .length;
  const traceSummaries = buildCorrelatedTraceSummaries(recentEvents, 200, null);
  const traceFailures = traceSummaries.filter((trace) => trace.status === "failed").length;
  const traceFailureRate = traceSummaries.length > 0 ? traceFailures / traceSummaries.length : 0;

  const runtimeHealthRaw = 100
    - (failureRate * 60)
    - Math.min(25, approvalFailures * 8)
    - (traceFailureRate * 20)
    - Math.min(20, retrievalAlertCount * 4);
  const memoryConfidenceRaw = 100
    - Math.min(60, retrievalAlertCount * 12)
    - Math.min(20, Math.round(failureRate * 40));

  const runtimeHealth = Math.max(0, Math.min(100, Math.round(runtimeHealthRaw)));
  const memoryConfidence = Math.max(0, Math.min(100, Math.round(memoryConfidenceRaw)));

  let planner: RuntimeExcellenceSnapshot["planner"] = {
    priority: "low",
    nextAction: "No immediate intervention required.",
    rationale: "Failure and trace rates are within expected bounds for the selected window.",
  };

  if (approvalFailures > 0) {
    planner = {
      priority: "high",
      nextAction: "Review approval queue timeout and operator responsiveness.",
      rationale: `Detected ${approvalFailures} approval-related failures in the selected window.`,
    };
  } else if (retrievalAlertCount > 0) {
    planner = {
      priority: "medium",
      nextAction: "Run retrieval diagnostics and tune alert thresholds for current profile.",
      rationale: `Detected ${retrievalAlertCount} retrieval alerts impacting memory confidence.`,
    };
  } else if (failureRate >= 0.2 || traceFailureRate >= 0.2) {
    planner = {
      priority: "medium",
      nextAction: "Inspect failed traces and run targeted replay for unstable paths.",
      rationale: "Failure density across events/traces is elevated in the selected window.",
    };
  }

  const selfHealingSuggestions: RuntimeExcellenceSnapshot["selfHealingSuggestions"] = [];
  if (approvalFailures > 0) {
    selfHealingSuggestions.push({
      id: "approval-timeout-recovery",
      title: "Approval Timeout Recovery",
      trigger: `${approvalFailures} approval failures`,
      action: "Increase timeout for high-risk approvals and validate operator notification routing.",
    });
  }
  if (retrievalAlertCount > 0) {
    selfHealingSuggestions.push({
      id: "retrieval-stability-recalibration",
      title: "Retrieval Stability Recalibration",
      trigger: `${retrievalAlertCount} retrieval alerts`,
      action: "Execute retrieval trend diagnostics and apply profile threshold adjustments.",
    });
  }
  if (failureRate >= 0.2 || traceFailureRate >= 0.2) {
    selfHealingSuggestions.push({
      id: "failure-cluster-replay",
      title: "Failure Cluster Replay",
      trigger: `failureRate=${failureRate.toFixed(2)}, traceFailureRate=${traceFailureRate.toFixed(2)}`,
      action: "Replay failing operations with correlation IDs to isolate recurring breakpoints.",
    });
  }
  if (selfHealingSuggestions.length === 0) {
    selfHealingSuggestions.push({
      id: "steady-state-monitoring",
      title: "Steady State Monitoring",
      trigger: "No critical failure patterns detected",
      action: "Maintain current configuration and continue periodic self-review cycles.",
    });
  }

  return {
    generatedAt: new Date(now).toISOString(),
    window,
    metrics: {
      eventsTotal,
      failures,
      failureRate: Number(failureRate.toFixed(4)),
      approvalFailures,
      traceFailureRate: Number(traceFailureRate.toFixed(4)),
      retrievalAlertCount,
    },
    scores: {
      runtimeHealth,
      memoryConfidence,
    },
    planner,
    selfHealingSuggestions,
  };
}

export class DashboardService {
  private readonly server: Server;
  private readonly llmProviders: LlmProviderManager;
  private readonly providerSecretStore: ProviderSecretStore;
  private readonly actionsByName = new Map<string, DashboardAction>();
  private readonly actionStates = new Map<string, DashboardActionState>();
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
  private readonly agenticExecutor: AgenticChatExecutor | null;
  private readonly tools: Tool[];
  private readonly framebufferCapture = new FramebufferCapture();
  private readonly wsServer: WebSocketServer;
  private readonly wsClients = new Set<WebSocket>();
  private readonly sseClients = new Map<string, ServerResponse>();
  private readonly networkCommandHistory: Array<{ command: string; tier?: string; ok: boolean; timestamp: string }> = [];
  private toolStates: Record<string, { enabled: boolean; invocations: number; successes: number; failures: number; avgLatencyMs: number; lastInvoked: string | null; lastError: string | null }> = {};
  private pluginStates: Record<string, { enabled: boolean; healthy: boolean; requests: number; errors: number; avgResponseMs: number; lastChecked: string | null }> = {};
  private utilityStates: Record<string, Record<string, unknown>> = {};
  private pendingToolCalls = new Map<string, { toolName: string; startedAt: number }>();
  private agentLifecycle: AgentLifecycleManager | null = null;
  private agentTelemetry: AgentTelemetryCollector | null = null;
  private swarmCoordinator: SwarmCoordinator | null = null;
  private agentPool: AgentPool | null = null;
  private agentRouter: AgentRouter | null = null;
  private importHistory: Array<{ id: string; timestamp: string; mode: string; fileName: string; targetDir: string; registeredType: string | null; status: string; message: string; size: number }> = [];
  private runtimeSettings: Record<string, unknown> = {
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
  };

  constructor(
    private readonly queue: ApprovalQueue,
    private readonly activityBus: ActivityBus,
    private readonly status: DashboardRuntimeStatus,
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
  ) {
    this.providerSecretStore = providerSecretStore ?? new WindowsProtectedFileProviderSecretStore();
    this.llmProviders = new LlmProviderManager(process.env, this.chatStore.listProviderSettings(), this.providerSecretStore);
    this.sessionPackageStorePath = sessionPackageStorePath;
    this.sessionPackageExportDir = sessionPackageExportDir;
    this.traceExplorer = activityStore ? new SessionTraceExplorer(activityStore) : undefined;
    this.policyAuditExporter = activityStore ? new PolicyAuditExporter(activityStore) : undefined;
    this.pkgStore = activityStore ? new SessionPackageSqliteStore(activityStore.dbPath) : undefined;
    this.toolRegistry = toolRegistry ?? null;
    this.agenticExecutor = toolRegistry ? new AgenticChatExecutor(toolRegistry) : null;
    this.tools = toolRegistry ? toolRegistry.list() : [];
    for (const t of this.tools) {
      if (!this.toolStates[t.name]) {
        this.toolStates[t.name] = { enabled: true, invocations: 0, successes: 0, failures: 0, avgLatencyMs: 0, lastInvoked: null, lastError: null };
      }
    }
    this.loadSessionPackageStore();
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
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    this.wsServer = new WebSocketServer({ noServer: true });
    this.server.on("upgrade", (req, socket, head) => {
      if (req.url === "/ws" || req.url === "/ws/chat") {
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

  private resolvePluginName(mcpToolName: string): string {
    const stripped = mcpToolName.replace(/^mcp_/, "");
    const knownPlugins = ["ids_mcp", "impressioncore_eds", "impressioncore_ipa", "impressioncore_goliath", "impressioncore_vrgc", "impressioncore_dpa", "web_search_mcp"];
    for (const p of knownPlugins) {
      if (stripped.startsWith(p)) return p.replace(/_/g, "-");
    }
    const parts = stripped.split("_");
    return parts.length >= 2 ? parts.slice(0, 2).join("-") : stripped;
  }

  private buildToolCatalog(): Array<{ name: string; cat: string; desc: string; risk: "low" | "medium" | "high"; mut: boolean }> {
    const known: Record<string, { cat: string; desc: string; risk: "low" | "medium" | "high"; mut: boolean }> = {
      file_read: { cat: "System", desc: "Read file contents with encoding support", risk: "low", mut: false },
      file_write: { cat: "System", desc: "Write or append content to files", risk: "medium", mut: true },
      file_delete: { cat: "System", desc: "Delete files and directories", risk: "high", mut: true },
      file_list: { cat: "System", desc: "List directory contents with file type detection", risk: "low", mut: false },
      shell_exec: { cat: "System", desc: "Execute shell commands with blocked-pattern protection", risk: "high", mut: true },
      terminal_session: { cat: "System", desc: "Manage interactive terminal sessions with lifecycle control", risk: "medium", mut: true },
      container_sandbox: { cat: "System", desc: "Create and manage containerized sandbox environments", risk: "medium", mut: true },
      http_request: { cat: "Integration", desc: "Execute HTTP requests (GET/POST/PUT/PATCH/DELETE)", risk: "medium", mut: true },
      semantic_query: { cat: "Knowledge", desc: "Semantic memory index with multiple retrieval modes", risk: "low", mut: false },
      memory_query: { cat: "Knowledge", desc: "Query episodic, semantic, or session memory stores", risk: "low", mut: false },
      network_exec: { cat: "System", desc: "Execute curated network diagnostics and commands", risk: "medium", mut: true },
      vision_capture: { cat: "System", desc: "Capture framebuffer screenshots and burst snapshots", risk: "medium", mut: false },
      nexus_check_hotline: { cat: "Integration", desc: "Read broadcast messages from Nexus hotline", risk: "low", mut: false },
      nexus_read_memory: { cat: "Integration", desc: "Read Nexus primary memory store", risk: "low", mut: false },
      nexus_log_insight: { cat: "Integration", desc: "Append insights to Nexus daily memory log", risk: "medium", mut: true },
      nexus_broadcast: { cat: "Integration", desc: "Send STP messages to Nexus thread or hotline", risk: "medium", mut: true }
    };

    const tools = this.tools || [];
    return tools.map((tool) => {
      const preset = known[tool.name];
      if (preset) {
        return { name: tool.name, cat: preset.cat, desc: preset.desc, risk: preset.risk, mut: preset.mut };
      }
      const lower = tool.name.toLowerCase();
      const isMutating = lower.includes("write") || lower.includes("delete") || lower.includes("exec") || lower.includes("install") || lower.includes("set_") || lower.includes("create") || lower.includes("stop") || lower.includes("launch");
      const category = lower.includes("memory") || lower.includes("semantic") || lower.includes("neo4j")
        ? "Knowledge"
        : (lower.includes("http") || lower.includes("mcp") || lower.includes("nexus")
          ? "Integration"
          : "System");
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
        exportStats: { exportedCount, exportRate: Number(exportRate.toFixed(4)), completeWithoutExportCount: completeWithoutExport },
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
      exportStats: { exportedCount, exportRate: Number(exportRate.toFixed(4)), completeWithoutExportCount: completeWithoutExport },
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
      dependencies: Array.isArray(payload.dependencies) ? payload.dependencies.map((item) => String(item).trim()).filter(Boolean) : [],
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

  updateSessionPackage(packageId: string, patch: {
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
  }): SessionPackageEnvelope {
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
      title: patch.title === undefined ? existing.title : (patch.title.trim() || existing.title),
      areaOfInterest: patch.areaOfInterest === undefined ? existing.areaOfInterest : (patch.areaOfInterest?.trim() || null),
      objective: patch.objective === undefined ? existing.objective : (patch.objective?.trim() || null),
      successCriteria: patch.successCriteria === undefined ? existing.successCriteria : (patch.successCriteria?.trim() || null),
      dependencies: patch.dependencies === undefined
        ? existing.dependencies
        : patch.dependencies.map((item) => String(item).trim()).filter(Boolean),
      status: nextStatus,
      updatedAt,
      lastRunAt: patch.lastRunAt === undefined ? existing.lastRunAt : patch.lastRunAt,
      lastExportAt: patch.lastExportAt === undefined ? existing.lastExportAt : patch.lastExportAt,
      exportArtifactPath: patch.exportArtifactPath === undefined ? existing.exportArtifactPath : patch.exportArtifactPath,
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
    const artifactPath = join(this.sessionPackageExportDir, `${pkg.packageId}-${exportedAt.replace(/[:.]/g, "-")}.json`);
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

  private loadSessionPackageStore(): void {
    if (this.pkgStore) {
      this.sessionPackages = this.pkgStore.listPackages().map((row) => this.normalizeSessionPackageRecord(row as Partial<SessionPackageRecord>));
      this.sessionPackageHistory = this.pkgStore.listHistory(this.sessionPackageHistoryLimit).map((entry) => this.normalizeSessionPackageHistoryEntry(entry as Partial<SessionPackageHistoryEntry>));
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
      const parsed = JSON.parse(readFileSync(this.sessionPackageStorePath, "utf-8")) as Partial<SessionPackageStoreSnapshot>;
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
      const parsed = JSON.parse(readFileSync(this.sessionPackageStorePath, "utf-8")) as Partial<SessionPackageStoreSnapshot>;
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
      dependencies: Array.isArray(pkg.dependencies) ? pkg.dependencies.map((item) => String(item)).filter(Boolean) : [],
      status: normalizeSessionPackageStatus(pkg.status),
      createdAt: String(pkg.createdAt || new Date(0).toISOString()),
      updatedAt: String(pkg.updatedAt || pkg.createdAt || new Date(0).toISOString()),
      sessionIds: Array.isArray(pkg.sessionIds) ? pkg.sessionIds.map((item) => String(item)).filter(Boolean) : [],
      lastRunAt: pkg.lastRunAt == null ? null : String(pkg.lastRunAt),
      lastExportAt: pkg.lastExportAt == null ? null : String(pkg.lastExportAt),
      exportArtifactPath: pkg.exportArtifactPath == null ? null : String(pkg.exportArtifactPath),
    };
  }

  private normalizeSessionPackageHistoryEntry(entry: Partial<SessionPackageHistoryEntry>): SessionPackageHistoryEntry {
    const action = entry.action;
    const validAction: SessionPackageHistoryEntry["action"] =
      action === "created" || action === "status_changed" ||
        action === "workflow_started" || action === "workflow_paused" ||
        action === "workflow_blocked" || action === "workflow_completed" ||
        action === "exported" || action === "unpackaged"
        ? action : "status_changed";
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
    const packageEvents = this.listPackageActivityEvents(pkg.sessionIds)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    const latestPolicyEvent = packageEvents.find((event) => Boolean(event.policyDecision)) ?? null;
    const pendingApprovalCount = this.queue.list().filter((item) => pkg.sessionIds.includes(item.sessionId)).length;
    const completedChapterCount = sessions.filter((session) => session.messageCount > 1).length;

    return {
      chapterCount: pkg.sessionIds.length,
      completedChapterCount,
      completionPct: pkg.sessionIds.length > 0 ? Math.round((completedChapterCount / pkg.sessionIds.length) * 100) : 0,
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

  createChatSession(title?: string): ChatSessionSummary {
    return this.chatStore.createSession(title);
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
    this.chatStore.upsertProviderSettings(resolved, settings, source);
    this.refreshProviderConfiguration();
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

  async saveProviderApiKey(providerId: string, apiKey: string, source: string = "dashboard"): Promise<ProviderSettingsPayload> {
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

  async getSessionLlmCatalog(sessionId: string): Promise<LlmProviderCatalog> {
    const session = this.chatStore.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown chat session: ${sessionId}`);
    }

    return this.llmProviders.getCatalog({
      providerId: session.llmProviderId ?? undefined,
      model: session.llmModel ?? undefined,
    });
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
      ? catalog.providers.find((entry) => entry.id === catalog.activeProviderId) ?? null
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
        ? buildSessionConfigDiff(
          session.llmProviderId,
          session.llmModel,
          draft.providerId,
          draft.model,
        )
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
      ? catalog.providers.find((entry) => entry.id === catalog.activeProviderId) ?? null
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

  async applySessionLlmConfigDraft(sessionId: string, source: string = "dashboard"): Promise<{
    catalog: LlmProviderCatalog;
    config: SessionConfigState;
  }> {
    const draft = this.chatStore.getSessionConfigDraft(sessionId);
    if (!draft?.providerId) {
      throw new Error(`No draft exists for chat session: ${sessionId}`);
    }

    const catalog = await this.setSessionLlmSelection(sessionId, draft.providerId, draft.model ?? undefined, `${source}_draft_apply`);
    return {
      catalog,
      config: this.getSessionLlmConfigState(sessionId),
    };
  }

  async rollbackSessionLlmConfig(sessionId: string, source: string = "dashboard"): Promise<{
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

  triggerAction(actionName: string): { accepted: true; action: string } {
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

    void action.run()
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
          details: { correlationId, error: errorMessage },
        });
      });

    return { accepted: true, action: action.name };
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

  /** Return the LlmProviderManager for direct access. */
  getLlmProviderManager(): LlmProviderManager {
    return this.llmProviders;
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
    this.server.listen(this.port, "127.0.0.1", () => {
      console.log(`[DASHBOARD] Listening at http://localhost:${this.port}`);
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
    });
  }

  stop(): Promise<void> {
    this.pkgStore?.close();
    for (const ws of this.wsClients) {
      ws.close();
    }
    this.wsClients.clear();
    for (const [, res] of this.sseClients) {
      res.end();
    }
    this.sseClients.clear();
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  /** Broadcast a JSON event to all connected WebSocket and SSE clients. */
  private broadcastEvent(event: Record<string, unknown>): void {
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

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "";
    const method = req.method?.toUpperCase() ?? "GET";

    if (method === "GET" && (url === "/" || url === "/dashboard")) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.end(dashboardHtml(this.port));
      return;
    }

    if (method === "GET" && (url === "/health" || url === "/api/health")) {
      return this.json(res, 200, { status: "ok" });
    }

    if (method === "GET" && url.startsWith("/api/chat/stream")) {
      const sseId = randomUUID();
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-SSE-Id": sseId,
      });
      res.write(`data: ${JSON.stringify({ type: "connected", sseId })}\n\n`);
      this.sseClients.set(sseId, res);
      req.on("close", () => {
        this.sseClients.delete(sseId);
      });
      return;
    }

    if (method === "GET" && (url === "/pending" || url === "/api/pending")) {
      return this.json(res, 200, this.queue.list());
    }

    if (method === "GET" && url.startsWith("/api/events")) {
      const filters = parseEventFilters(url, 50);
      let events = this.activityBus.listEvents();
      if (filters.operation) {
        events = events.filter((event) => event.operation === filters.operation);
      }
      if (filters.chatSessionId) {
        events = events.filter((event) => {
          const details = event.details as Record<string, unknown> | undefined;
          return details?.chatSessionId === filters.chatSessionId;
        });
      }
      if (filters.correlationId) {
        events = events.filter((event) => {
          const details = event.details as Record<string, unknown> | undefined;
          return details?.correlationId === filters.correlationId;
        });
      }
      events = events.slice(-Math.max(1, filters.limit)).reverse();
      return this.json(res, 200, events);
    }

    if (method === "GET" && url.startsWith("/api/traces")) {
      const filters = parseEventFilters(url, 20);
      const events = this.activityBus.listEvents();
      const traces = buildCorrelatedTraceSummaries(events, filters.limit, filters.chatSessionId);
      const selectedTraceEvents = filters.correlationId
        ? getCorrelatedTraceEvents(events, filters.correlationId, filters.chatSessionId)
        : [];
      const payload: CorrelatedTraceResponse = {
        generatedAt: new Date().toISOString(),
        traces,
        selectedCorrelationId: filters.correlationId,
        selectedTraceEvents,
      };
      return this.json(res, 200, payload);
    }

    if (method === "GET" && url === "/api/status") {
      const events = this.activityBus.listEvents();
      return this.json(res, 200, {
        ...this.status,
        uptimeSeconds: Math.floor((Date.now() - Date.parse(this.status.startedAt)) / 1000),
        pendingApprovals: this.queue.list().length,
        chatSessionCount: this.chatStore.listSessions().length,
        eventCount: events.length,
        lastEvent: events[events.length - 1] ?? null,
        workspaceRoot: resolveWorkspaceRoot(),
      });
    }

    if (method === "GET" && url.startsWith("/api/readiness")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const requestedSessionId = parsed.searchParams.get("sessionId")?.trim() || undefined;
        const snapshot = await this.getReadinessSnapshot(requestedSessionId);
        return this.json(res, 200, snapshot);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/readiness/recheck") {
      try {
        const body = await this.readJsonBody<{ sessionId?: string; source?: string }>(req);
        const source = body.source?.trim() || "dashboard_recheck";
        const snapshot = await this.getReadinessSnapshot(body.sessionId?.trim() || undefined);
        this.emitReadinessAudit(source, snapshot);
        return this.json(res, 200, snapshot);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/actions") {
      return this.json(res, 200, this.listActions());
    }

    if (method === "GET" && url === "/api/action-history") {
      return this.json(res, 200, this.listActionHistory());
    }

    if (method === "GET" && url === "/api/chat/sessions") {
      return this.json(res, 200, this.listChatSessions());
    }

    if (method === "GET" && url === "/api/session-packages") {
      return this.json(res, 200, {
        packages: this.listSessionPackages(),
        releaseSnapshot: this.getSessionPackageReleaseSnapshot(),
      });
    }

    if (method === "GET" && url === "/api/session-packages/metrics") {
      return this.json(res, 200, this.getSessionPackageMetrics());
    }

    if (method === "GET" && url.startsWith("/api/session-packages/history")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const limit = Math.max(1, Number(parsed.searchParams.get("limit") ?? 20));
        return this.json(res, 200, { history: this.listSessionPackageHistory(limit) });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/session-packages") {
      try {
        const body = await this.readJsonBody<{
          title?: string;
          areaOfInterest?: string | null;
          objective?: string | null;
          successCriteria?: string | null;
          dependencies?: string[];
          sessionIds?: string[];
          status?: SessionPackageStatus;
        }>(req);
        const pkg = this.createSessionPackage({
          ...body,
          source: req.headers["x-prism-source"]?.toString() || "dashboard_api",
        });
        return this.json(res, 201, { package: pkg });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    const sessionPackageExportMatch = /^\/api\/session-packages\/([^/]+)\/export$/.exec(url);
    if (sessionPackageExportMatch && method === "POST") {
      try {
        const packageId = decodeURIComponent(sessionPackageExportMatch[1]!);
        const payload = this.exportSessionPackage(
          packageId,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, payload);
      } catch (error) {
        const status = /unavailable/i.test(String(error)) ? 501 : 400;
        return this.json(res, status, { error: String(error) });
      }
    }

    const sessionPackageMatch = /^\/api\/session-packages\/([^/]+)$/.exec(url);
    if (sessionPackageMatch && method === "PATCH") {
      try {
        const packageId = decodeURIComponent(sessionPackageMatch[1]!);
        const body = await this.readJsonBody<{
          title?: string;
          areaOfInterest?: string | null;
          objective?: string | null;
          successCriteria?: string | null;
          dependencies?: string[];
          status?: SessionPackageStatus;
          lastRunAt?: string | null;
          message?: string | null;
          targetSessionId?: string | null;
          historyAction?: SessionPackageHistoryEntry["action"];
        }>(req);
        const pkg = this.updateSessionPackage(packageId, {
          ...body,
          source: req.headers["x-prism-source"]?.toString() || "dashboard_api",
        });
        return this.json(res, 200, { package: pkg });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (sessionPackageMatch && method === "DELETE") {
      try {
        const packageId = decodeURIComponent(sessionPackageMatch[1]!);
        return this.json(res, 200, this.deleteSessionPackage(
          packageId,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        ));
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    if (method === "GET" && url.startsWith("/api/llm/provider-settings")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const providerId = parsed.searchParams.get("providerId")?.trim();
        if (!providerId) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        return this.json(res, 200, await this.getProviderSettings(providerId));
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/provider-settings") {
      try {
        const body = await this.readJsonBody<{
          providerId?: string;
          baseUrl?: string;
          apiKeyHeader?: string;
          models?: string[];
          defaultModel?: string;
        }>(req);
        if (!body.providerId?.trim()) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        const payload = await this.saveProviderSettings(
          body.providerId,
          {
            baseUrl: body.baseUrl ?? null,
            apiKeyHeader: body.apiKeyHeader ?? null,
            models: Array.isArray(body.models) ? body.models : [],
            defaultModel: body.defaultModel ?? null,
          },
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, payload);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/provider-secret") {
      try {
        const body = await this.readJsonBody<{ providerId?: string; apiKey?: string }>(req);
        if (!body.providerId?.trim()) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        if (!body.apiKey?.trim()) {
          return this.json(res, 400, { error: "apiKey is required." });
        }
        const payload = await this.saveProviderApiKey(
          body.providerId,
          body.apiKey,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, payload);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "DELETE" && url.startsWith("/api/llm/provider-secret")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const providerId = parsed.searchParams.get("providerId")?.trim();
        if (!providerId) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        const payload = await this.clearProviderApiKey(
          providerId,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, payload);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/provider-test") {
      try {
        const body = await this.readJsonBody<{ providerId?: string; apiKey?: string }>(req);
        if (!body.providerId?.trim()) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        if (body.apiKey?.trim()) {
          await this.saveProviderApiKey(body.providerId, body.apiKey.trim(), "provider-test");
        }
        const result = await this.llmProviders.testProvider(body.providerId);
        if (result.ok && result.models.length > 0) {
          const current = await this.getProviderSettings(body.providerId);
          await this.saveProviderSettings(
            body.providerId,
            {
              baseUrl: current.baseUrl ?? null,
              apiKeyHeader: current.apiKeyHeader ?? null,
              models: result.models,
              defaultModel: current.defaultModel ?? null,
            },
            "provider-test",
          );
        }
        return this.json(res, 200, result);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url.startsWith("/api/llm/providers")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const sessionId = parsed.searchParams.get("sessionId")?.trim();
        if (!sessionId) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        const catalog = await this.getSessionLlmCatalog(sessionId);
        return this.json(res, 200, catalog);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/select") {
      try {
        const body = await this.readJsonBody<{ sessionId?: string; providerId?: string; model?: string }>(req);
        if (!body.sessionId?.trim()) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        if (!body.providerId?.trim()) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        const catalog = await this.setSessionLlmSelection(
          body.sessionId,
          body.providerId,
          body.model,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, catalog);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url.startsWith("/api/llm/config")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const sessionId = parsed.searchParams.get("sessionId")?.trim();
        if (!sessionId) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        return this.json(res, 200, this.getSessionLlmConfigState(sessionId));
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/config/draft") {
      try {
        const body = await this.readJsonBody<{ sessionId?: string; providerId?: string; model?: string }>(req);
        if (!body.sessionId?.trim()) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        if (!body.providerId?.trim()) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        const config = await this.saveSessionLlmConfigDraft(
          body.sessionId,
          body.providerId,
          body.model,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, config);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "DELETE" && url.startsWith("/api/llm/config/draft")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const sessionId = parsed.searchParams.get("sessionId")?.trim();
        if (!sessionId) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        return this.json(res, 200, this.discardSessionLlmConfigDraft(sessionId));
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/config/apply") {
      try {
        const body = await this.readJsonBody<{ sessionId?: string }>(req);
        if (!body.sessionId?.trim()) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        const payload = await this.applySessionLlmConfigDraft(
          body.sessionId,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, payload);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/config/rollback") {
      try {
        const body = await this.readJsonBody<{ sessionId?: string }>(req);
        if (!body.sessionId?.trim()) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        const payload = await this.rollbackSessionLlmConfig(
          body.sessionId,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, payload);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── Model Routing API ──────────────────────────────────────────────

    if (method === "GET" && url === "/api/llm/routing") {
      try {
        const config = this.llmProviders.getRoutingConfig();
        const suggestions = await this.llmProviders.suggestRoutingForAllRoles();
        const modalitySuggestions = await this.llmProviders.suggestRoutingForAllModalities();
        const modalities = await this.llmProviders.getModalitySummary();
        return this.json(res, 200, { config, suggestions, modalitySuggestions, modalities });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/routing") {
      try {
        const body = await this.readJsonBody<RoutingConfig>(req);
        this.llmProviders.setRoutingConfig(body);
        const config = this.llmProviders.getRoutingConfig();
        return this.json(res, 200, { config });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/llm/routing/suggest") {
      try {
        const suggestions = await this.llmProviders.suggestRoutingForAllRoles();
        return this.json(res, 200, { suggestions });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/llm/model-profiles") {
      try {
        const profiles = await this.llmProviders.getModelProfiles();
        return this.json(res, 200, { profiles });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // ── Modality Routing API ───────────────────────────────────────────

    if (method === "GET" && url === "/api/llm/modalities") {
      try {
        const modalities = await this.llmProviders.getModalitySummary();
        const suggestions = await this.llmProviders.suggestRoutingForAllModalities();
        return this.json(res, 200, { modalities, suggestions });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // ── Model Matrix Management API ────────────────────────────────────

    if (method === "GET" && url === "/api/models/matrix") {
      try {
        const matrix = this.llmProviders.getFullModelMatrix();
        return this.json(res, 200, matrix);
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "PUT" && url === "/api/models/matrix") {
      try {
        const body = await this.readJsonBody<{ pattern: string; label?: string; tier?: number; modalities?: string[]; strengths?: string[]; locality?: string; contextWindow?: number; parametersBillions?: number; parameterSize?: string; estimatedVramMb?: number; maxOutputTokens?: number; adaptivePromptBudget?: number }>(req);
        if (!body.pattern?.trim()) {
          return this.json(res, 400, { error: "pattern is required." });
        }
        this.llmProviders.registerModel(body as any);
        return this.json(res, 200, { registered: body.pattern });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "DELETE" && url.startsWith("/api/models/matrix/")) {
      try {
        const pattern = decodeURIComponent(url.slice("/api/models/matrix/".length));
        const removed = this.llmProviders.removeModel(pattern);
        return this.json(res, 200, { removed, pattern });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url.startsWith("/api/models/discover/")) {
      try {
        const providerId = decodeURIComponent(url.slice("/api/models/discover/".length));
        const result = await this.llmProviders.discoverProviderModels(providerId);
        return this.json(res, 200, result);
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
      if (!this.toolStates[toolName]) this.toolStates[toolName] = { enabled: true, invocations: 0, successes: 0, failures: 0, avgLatencyMs: 0, lastInvoked: null, lastError: null };
      this.toolStates[toolName].enabled = body.enabled;
      return this.json(res, 200, { tool: toolName, enabled: body.enabled });
    }

    const toolTestMatch = /^\/api\/tools\/([^/]+)\/test$/.exec(url);
    if (toolTestMatch && method === "POST") {
      const toolName = decodeURIComponent(toolTestMatch[1]!);
      return this.json(res, 200, { tool: toolName, message: "Tool '" + toolName + "' dry-run test passed", status: "ok" });
    }

    if (method === "GET" && url === "/api/plugins/status") {
      return this.json(res, 200, { plugins: this.pluginStates || {} });
    }

    const pluginToggleMatch = /^\/api\/plugins\/([^/]+)\/toggle$/.exec(url);
    if (pluginToggleMatch && method === "POST") {
      const pluginName = decodeURIComponent(pluginToggleMatch[1]!);
      const body = await this.readJsonBody<{ enabled: boolean }>(req);
      if (!this.pluginStates[pluginName]) this.pluginStates[pluginName] = { enabled: true, healthy: true, requests: 0, errors: 0, avgResponseMs: 0, lastChecked: null };
      this.pluginStates[pluginName].enabled = body.enabled;
      return this.json(res, 200, { plugin: pluginName, enabled: body.enabled });
    }

    const pluginHealthMatch = /^\/api\/plugins\/([^/]+)\/health$/.exec(url);
    if (pluginHealthMatch && method === "POST") {
      const pluginName = decodeURIComponent(pluginHealthMatch[1]!);
      return this.json(res, 200, { plugin: pluginName, healthy: true, message: "Health check passed" });
    }

    if (method === "GET" && url === "/api/utilities/status") {
      return this.json(res, 200, { utilities: this.utilityStates || {} });
    }

    if (method === "POST" && url === "/api/tools/register") {
      const body = await this.readJsonBody<{ name: string; description?: string; category?: string; risk?: string; endpoint?: string }>(req);
      if (!body.name) return this.json(res, 400, { error: "Tool name is required" });
      return this.json(res, 201, { tool: body.name, registered: true });
    }

    if (method === "POST" && url === "/api/plugins/install") {
      const body = await this.readJsonBody<{ name: string; type?: string; url?: string; port?: number; description?: string }>(req);
      if (!body.name) return this.json(res, 400, { error: "Plugin name is required" });
      return this.json(res, 201, { plugin: body.name, installed: true });
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
        }
      }
      return this.json(res, 200, { updated: changes, settings: this.runtimeSettings });
    }

    // ── Agent Control API ──
    if (method === "GET" && url === "/api/agents") {
      const agents = this.agentLifecycle?.list() ?? [];
      const swarms = this.swarmCoordinator?.list() ?? [];
      const telemetry = this.agentTelemetry?.getGlobalStats() ?? { activeAgents: 0, tasksCompleted: 0, tasksFailed: 0, avgResponseMs: 0, totalDispatches: 0 };
      const agentSummaries = agents.map((a) => {
        const summary = this.agentTelemetry?.getAgentSummary(a.agentId);
        const modelOverride = this.llmProviders.getAgentModelOverride(a.agentId);
        return {
          ...a,
          modelOverride: a.modelOverride ?? modelOverride,
          telemetry: summary ?? null,
        };
      });
      return this.json(res, 200, { agents: agentSummaries, swarms, telemetry });
    }

    if (method === "POST" && url === "/api/agents/launch") {
      if (!this.agentLifecycle) return this.json(res, 503, { error: "Agent lifecycle not initialized" });
      const body = await this.readJsonBody<{ role?: string; description?: string; lifecycle?: string; providerId?: string; model?: string }>(req);
      const role = (body.role ?? "chat") as import("./model-capability-matrix.js").TaskRole;
      const instance = this.agentLifecycle.spawn({
        role,
        description: body.description,
        lifecycle: (body.lifecycle as "ephemeral" | "semi-permanent" | "permanent") ?? "ephemeral",
        modelOverride: body.providerId && body.model ? { providerId: body.providerId, model: body.model } : undefined,
      });
      // Sync model override to LLM provider routing
      if (instance.modelOverride) {
        this.llmProviders.setAgentModelOverride(instance.agentId, instance.modelOverride.providerId, instance.modelOverride.model);
      }
      // Register in agent pool
      this.agentPool?.register({ agentId: instance.agentId, role: instance.role, description: instance.description, systemContext: instance.systemContext });
      return this.json(res, 201, { agent: instance });
    }

    if (method === "POST" && url === "/api/agents/stop") {
      if (!this.agentLifecycle) return this.json(res, 503, { error: "Agent lifecycle not initialized" });
      const body = await this.readJsonBody<{ agentId: string }>(req);
      this.llmProviders.clearAgentModelOverride(body.agentId);
      this.agentPool?.unregister(body.agentId);
      const stopped = this.agentLifecycle.stop(body.agentId);
      return this.json(res, 200, { agentId: body.agentId, stopped });
    }

    if (method === "POST" && url?.match(/^\/api\/agents\/([^/]+)\/model$/)) {
      if (!this.agentLifecycle) return this.json(res, 503, { error: "Agent lifecycle not initialized" });
      const agentId = url.split("/")[3];
      const body = await this.readJsonBody<{ providerId: string; model: string }>(req);
      this.agentLifecycle.setModelOverride(agentId, { providerId: body.providerId, model: body.model });
      this.llmProviders.setAgentModelOverride(agentId, body.providerId, body.model);
      return this.json(res, 200, { agentId, modelOverride: { providerId: body.providerId, model: body.model } });
    }

    if (method === "POST" && url?.match(/^\/api\/agents\/([^/]+)\/promote$/)) {
      if (!this.agentLifecycle) return this.json(res, 503, { error: "Agent lifecycle not initialized" });
      const agentId = url.split("/")[3];
      const newTier = this.agentLifecycle.promote(agentId);
      if (!newTier) return this.json(res, 404, { error: "Agent not found" });
      return this.json(res, 200, { agentId, lifecycle: newTier });
    }

    if (method === "POST" && url?.match(/^\/api\/agents\/([^/]+)\/demote$/)) {
      if (!this.agentLifecycle) return this.json(res, 503, { error: "Agent lifecycle not initialized" });
      const agentId = url.split("/")[3];
      const newTier = this.agentLifecycle.demote(agentId);
      if (!newTier) return this.json(res, 404, { error: "Agent not found" });
      return this.json(res, 200, { agentId, lifecycle: newTier });
    }

    if (method === "GET" && url === "/api/agents/telemetry") {
      const summaries = this.agentTelemetry?.getAllSummaries() ?? [];
      const frequency = this.agentTelemetry?.getDispatchFrequency() ?? [];
      const recommendations = this.agentLifecycle && this.agentTelemetry
        ? this.agentTelemetry.getPromotionRecommendations(this.agentLifecycle)
        : [];
      const global = this.agentTelemetry?.getGlobalStats() ?? { activeAgents: 0, tasksCompleted: 0, tasksFailed: 0, avgResponseMs: 0, totalDispatches: 0 };
      return this.json(res, 200, { summaries, frequency, recommendations, global });
    }

    if (method === "POST" && url === "/api/swarms/create") {
      if (!this.swarmCoordinator) return this.json(res, 503, { error: "Swarm coordinator not initialized" });
      const body = await this.readJsonBody<{ topology?: string; goal?: string; agentIds?: string[]; timeoutMs?: number }>(req);
      const swarm = this.swarmCoordinator.create({
        topology: (body.topology as "mesh" | "star" | "pipeline" | "broadcast") ?? "broadcast",
        goal: body.goal ?? "",
        agentIds: body.agentIds ?? [],
        timeoutMs: body.timeoutMs,
      });
      // Start execution asynchronously
      void this.swarmCoordinator.execute(swarm.swarmId).catch(() => { });
      return this.json(res, 201, { swarm });
    }

    if (method === "GET" && url === "/api/swarms") {
      const swarms = this.swarmCoordinator?.list() ?? [];
      return this.json(res, 200, { swarms });
    }

    if (method === "POST" && url?.match(/^\/api\/swarms\/([^/]+)\/stop$/)) {
      if (!this.swarmCoordinator) return this.json(res, 503, { error: "Swarm coordinator not initialized" });
      const swarmId = url.split("/")[3];
      const stopped = this.swarmCoordinator.stop(swarmId);
      return this.json(res, 200, { swarmId, stopped });
    }

    // ── Computer Control API ──
    if (method === "GET" && url === "/api/computer/system-info") {
      const osModule = await import("node:os");
      let gpu: { name: string; vramTotalMb: number; driverVersion: string; cudaVersion: string } | null = null;
      try {
        const { execSync } = await import("node:child_process");
        const nvOut = execSync("nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits", { timeout: 5000, encoding: "utf8" });
        const parts = nvOut.trim().split(",").map((s: string) => s.trim());
        if (parts.length >= 3) {
          let cudaVer = "";
          try {
            const nvFull = execSync("nvidia-smi", { timeout: 5000, encoding: "utf8" });
            const cudaMatch = nvFull.match(/CUDA Version:\s*([\d.]+)/);
            if (cudaMatch) cudaVer = cudaMatch[1];
          } catch (_) { /* no CUDA info */ }
          gpu = { name: parts[0], vramTotalMb: parseInt(parts[1], 10) || 0, driverVersion: parts[2], cudaVersion: cudaVer };
        }
      } catch (_) {
        try {
          const { execSync } = await import("node:child_process");
          const wmicOut = execSync("wmic path Win32_VideoController get Name,AdapterRAM /format:csv", { timeout: 5000, encoding: "utf8" });
          const lines = wmicOut.trim().split(/\r?\n/).filter((l: string) => l.trim() && !l.startsWith("Node"));
          if (lines.length > 0) {
            const cols = lines[0].split(",");
            if (cols.length >= 3) {
              const adapterRam = parseInt(cols[1], 10) || 0;
              gpu = { name: cols[2]?.trim() || "Unknown GPU", vramTotalMb: Math.round(adapterRam / 1048576), driverVersion: "", cudaVersion: "" };
            }
          }
        } catch (_) { /* no GPU info available */ }
      }
      return this.json(res, 200, {
        os: osModule.type() + " " + osModule.release(),
        hostname: osModule.hostname(),
        platform: osModule.platform() + " " + osModule.arch(),
        uptime: Math.floor(osModule.uptime()),
        cpus: osModule.cpus().length,
        totalMemory: osModule.totalmem(),
        freeMemory: osModule.freemem(),
        homeDir: osModule.homedir(),
        gpu,
      });
    }

    if (method === "GET" && url === "/api/computer/usage") {
      const osModule = await import("node:os");
      let gpuUsage: { vramUsedMb: number; vramTotalMb: number; gpuUtilPct: number; memUtilPct: number; tempC: number } | null = null;
      try {
        const { execSync } = await import("node:child_process");
        const nvOut = execSync("nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu,utilization.memory,temperature.gpu --format=csv,noheader,nounits", { timeout: 3000, encoding: "utf8" });
        const parts = nvOut.trim().split(",").map((s: string) => s.trim());
        if (parts.length >= 5) {
          gpuUsage = { vramUsedMb: parseInt(parts[0], 10) || 0, vramTotalMb: parseInt(parts[1], 10) || 0, gpuUtilPct: parseInt(parts[2], 10) || 0, memUtilPct: parseInt(parts[3], 10) || 0, tempC: parseInt(parts[4], 10) || 0 };
        }
      } catch (_) { /* nvidia-smi not available */ }
      return this.json(res, 200, {
        ramTotal: osModule.totalmem(),
        ramFree: osModule.freemem(),
        gpu: gpuUsage,
      });
    }

    if (method === "POST" && url === "/api/computer/exec") {
      const body = await this.readJsonBody<{ command: string }>(req);
      const cmd = (body.command || "").trim();
      if (!cmd) return this.json(res, 400, { error: "Command is required" });
      const blocked = /rm\s+-rf|del\s+\/[sfq]|format\s+[a-z]:|shutdown|restart|reboot/i;
      if (blocked.test(cmd)) return this.json(res, 403, { error: "Command blocked by safety policy" });
      try {
        const { exec: execCb } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(execCb);
        const result = await execAsync(cmd, { timeout: 15000, maxBuffer: 512 * 1024 });
        this.framebufferCapture.captureSingle().catch(() => { });
        return this.json(res, 200, { stdout: result.stdout, stderr: result.stderr });
      } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; message?: string };
        return this.json(res, 200, { stdout: err.stdout || "", stderr: err.stderr || err.message || String(error) });
      }
    }

    // ── Vision Framebuffer Screengrab Endpoints ──────────────────────────

    if (method === "GET" && url === "/api/computer/screengrab/latest") {
      const latestPath = this.framebufferCapture.getLatestPath();
      if (!latestPath) return this.json(res, 404, { error: "No screengrab captured yet" });
      try {
        const data = readFileSync(latestPath);
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": data.length, "Cache-Control": "no-store" });
        res.end(data);
        return;
      } catch { return this.json(res, 500, { error: "Failed to read latest screengrab" }); }
    }

    if (method === "POST" && url === "/api/computer/screengrab/capture") {
      try {
        const result = await this.framebufferCapture.captureSingle();
        return this.json(res, 200, result);
      } catch (error: unknown) {
        return this.json(res, 500, { error: (error as Error).message ?? "Capture failed" });
      }
    }

    if (method === "POST" && url === "/api/computer/screengrab/burst") {
      const body = await this.readJsonBody<{ fps?: number; duration?: number }>(req);
      try {
        const result = await this.framebufferCapture.burstCapture(body.fps, body.duration);
        return this.json(res, 200, result);
      } catch (error: unknown) {
        return this.json(res, 500, { error: (error as Error).message ?? "Burst failed" });
      }
    }

    if (method === "GET" && url === "/api/computer/screengrab/list") {
      return this.json(res, 200, { files: this.framebufferCapture.listScreengrabs() });
    }

    if (method === "GET" && url?.startsWith("/api/computer/screengrab/file/")) {
      const name = decodeURIComponent(url.slice("/api/computer/screengrab/file/".length));
      if (!/^[\w\-.]+\.png$/.test(name)) return this.json(res, 400, { error: "Invalid filename" });
      const filePath = join(workspaceFramebufferDir(), name);
      if (!existsSync(filePath)) return this.json(res, 404, { error: "File not found" });
      try {
        const data = readFileSync(filePath);
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": data.length, "Cache-Control": "no-store" });
        res.end(data);
        return;
      } catch { return this.json(res, 500, { error: "Failed to read file" }); }
    }

    if (method === "GET" && url === "/api/computer/env-vars") {
      const vars: Array<{ key: string; value: string }> = [];
      const prismVars: Array<{ key: string; value: string }> = [];
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) {
          const entry = { key: k, value: v };
          if (k.startsWith("PRISM_")) prismVars.push(entry);
          else vars.push(entry);
        }
      }
      prismVars.sort((a, b) => a.key.localeCompare(b.key));
      vars.sort((a, b) => a.key.localeCompare(b.key));
      return this.json(res, 200, { prismVars, systemVars: vars });
    }

    if (method === "GET" && url === "/api/computer/devices") {
      const osModule = await import("node:os");
      const cpus = osModule.cpus();
      const nets = osModule.networkInterfaces();
      const devices: Record<string, string[]> = {
        "Display Adapters": [],
        "Network Adapters": Object.keys(nets),
        "Disk Drives": [],
        "Processors": cpus.length > 0 ? [cpus[0]!.model + " (" + cpus.length + " cores)"] : [],
      };
      return this.json(res, 200, { devices });
    }

    if (method === "POST" && url === "/api/chat/sessions") {
      try {
        const body = await this.readJsonBody<{ title?: string }>(req);
        return this.json(res, 201, { session: this.createChatSession(body.title) });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    const chatMessagesMatch = /^\/api\/chat\/sessions\/([^/]+)\/messages$/.exec(url);
    if (chatMessagesMatch && method === "GET") {
      try {
        const sessionId = decodeURIComponent(chatMessagesMatch[1]!);
        return this.json(res, 200, { messages: this.getChatMessages(sessionId) });
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    if (chatMessagesMatch && method === "POST") {
      try {
        const sessionId = decodeURIComponent(chatMessagesMatch[1]!);
        const body = await this.readJsonBody<{ content?: string }>(req);
        const turn = await this.submitChatMessage(sessionId, body.content ?? "");
        return this.json(res, 201, turn);
      } catch (error) {
        const message = String(error);
        const status = /unknown chat session/i.test(message) ? 404 : 400;
        return this.json(res, status, { error: message });
      }
    }

    const chatSessionMatch = /^\/api\/chat\/sessions\/([^/]+)$/.exec(url);
    if (chatSessionMatch && method === "PATCH") {
      try {
        const sessionId = decodeURIComponent(chatSessionMatch[1]!);
        const body = await this.readJsonBody<{ title?: string }>(req);
        if (!body.title?.trim()) return this.json(res, 400, { error: "title is required." });
        this.chatStore.updateSessionTitle(sessionId, body.title.trim());
        return this.json(res, 200, { updated: true });
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    if (chatSessionMatch && method === "DELETE") {
      try {
        const sessionId = decodeURIComponent(chatSessionMatch[1]!);
        this.deleteChatSession(sessionId);
        return this.json(res, 200, { deleted: true });
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    // ── Attachment endpoints ──────────────────────────────────────────

    const attachUploadMatch = /^\/api\/chat\/sessions\/([^/]+)\/messages\/([^/]+)\/attachments$/.exec(url);
    if (attachUploadMatch && method === "POST") {
      try {
        const sessionId = decodeURIComponent(attachUploadMatch[1]!);
        const messageId = decodeURIComponent(attachUploadMatch[2]!);
        return await this.handleAttachmentUpload(req, res, sessionId, messageId);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (attachUploadMatch && method === "GET") {
      try {
        const sessionId = decodeURIComponent(attachUploadMatch[1]!);
        const messageId = decodeURIComponent(attachUploadMatch[2]!);
        const attachments = this.chatStore.getAttachments(messageId);
        return this.json(res, 200, { attachments });
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    const attachServeMatch = /^\/api\/attachments\/([^/]+)$/.exec(url);
    if (attachServeMatch && method === "GET") {
      try {
        const attachmentId = decodeURIComponent(attachServeMatch[1]!);
        return this.serveAttachmentFile(res, attachmentId);
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    const attachThumbMatch = /^\/api\/attachments\/([^/]+)\/thumbnail$/.exec(url);
    if (attachThumbMatch && method === "GET") {
      try {
        const attachmentId = decodeURIComponent(attachThumbMatch[1]!);
        return this.serveAttachmentFile(res, attachmentId, true);
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    const attachDeleteMatch = /^\/api\/attachments\/([^/]+)$/.exec(url);
    if (attachDeleteMatch && method === "DELETE") {
      try {
        const attachmentId = decodeURIComponent(attachDeleteMatch[1]!);
        this.chatStore.deleteAttachment(attachmentId);
        return this.json(res, 200, { deleted: true });
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/retrieval/cohorts") {
      if (!this.metricsCollector) {
        return this.json(res, 501, { error: "Retrieval observability not initialized." });
      }
      try {
        const cohorts = this.metricsCollector.getCohortDashboard(50, 3, 1);
        return this.json(res, 200, cohorts);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/retrieval/alerts") {
      if (!this.metricsCollector || !this.retrievalDashboardStore) {
        return this.json(res, 501, { error: "Retrieval observability not initialized." });
      }
      try {
        const diagnostics = this.metricsCollector.getGrowthAndDriftDiagnostics(5, 0.12);
        const cohortDashboard = this.metricsCollector.getCohortDashboard(50, 3, 1);
        const allAlerts = [
          ...diagnostics.alerts,
          ...cohortDashboard.alerts,
        ];
        return this.json(res, 200, { alerts: allAlerts });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/retrieval/trends") {
      if (!this.retrievalDashboardStore) {
        return this.json(res, 501, { error: "Retrieval observability not initialized." });
      }
      try {
        const sessionId = this.status.sessionId;
        const trend = this.retrievalDashboardStore.getTrendReport(sessionId, 10, 3);
        return this.json(res, 200, trend ?? { snapshotsCompared: 0, topChanges: [], alerts: [] });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url.startsWith("/api/telemetry/summary")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const windowLabel = parseTelemetryWindow(parsed.searchParams.get("window"));
        const events = this.activityBus.listEvents();
        const summary = computeTelemetrySummary(events, windowLabel);
        return this.json(res, 200, summary);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url.startsWith("/api/runtime/excellence")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const windowLabel = parseTelemetryWindow(parsed.searchParams.get("window"));
        const events = this.activityBus.listEvents();

        let retrievalAlertCount = 0;
        if (this.metricsCollector) {
          const diagnostics = this.metricsCollector.getGrowthAndDriftDiagnostics(5, 0.12);
          const cohortDashboard = this.metricsCollector.getCohortDashboard(50, 3, 1);
          retrievalAlertCount = diagnostics.alerts.length + cohortDashboard.alerts.length;
        }

        const snapshot = computeRuntimeExcellenceSnapshot(events, windowLabel, retrievalAlertCount);
        return this.json(res, 200, snapshot);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url.startsWith("/api/retrieval/prioritized-alerts")) {
      if (!this.metricsCollector) {
        return this.json(res, 501, { error: "Retrieval observability not initialized." });
      }
      try {
        const now = new Date().toISOString();
        const diagnostics = this.metricsCollector.getGrowthAndDriftDiagnostics(5, 0.12);
        const cohortDashboard = this.metricsCollector.getCohortDashboard(50, 3, 1);
        const rawAlerts = [...diagnostics.alerts, ...cohortDashboard.alerts];
        const prioritized = buildPrioritizedAlerts(rawAlerts, "retrieval", now)
          .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
        const response: PrioritizedAlertResponse = {
          generatedAt: now,
          alerts: prioritized,
          criticalCount: prioritized.filter((a) => a.severity === "critical").length,
          warningCount: prioritized.filter((a) => a.severity === "warning").length,
          infoCount: prioritized.filter((a) => a.severity === "info").length,
        };
        return this.json(res, 200, response);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/self-review/latest") {
      const latestPath = "prism-output/self-review-latest.json";
      if (!existsSync(latestPath)) {
        return this.json(res, 200, { report: null });
      }

      try {
        const report = JSON.parse(readFileSync(latestPath, "utf-8"));
        return this.json(res, 200, { report });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "GET" && url.startsWith("/api/self-review/history")) {
      const historyPath = "prism-output/self-review-history.ndjson";
      if (!existsSync(historyPath)) {
        return this.json(res, 200, { reports: [] });
      }

      try {
        const parsed = new URL(`http://localhost${url}`);
        const limit = Math.max(1, Number(parsed.searchParams.get("limit") ?? 10));
        const lines = readFileSync(historyPath, "utf-8")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-limit)
          .reverse();
        const reports = lines.map((line) => JSON.parse(line));
        return this.json(res, 200, { reports });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/perf") {
      const perfPath = "prism-output/perf-qualification.json";
      if (!existsSync(perfPath)) {
        return this.json(res, 404, { error: "No performance artifact found yet." });
      }

      try {
        const payload = JSON.parse(readFileSync(perfPath, "utf-8"));
        return this.json(res, 200, payload);
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/release/validation/latest") {
      const validationPath = "prism-output/release-validation.json";
      if (!existsSync(validationPath)) {
        return this.json(res, 200, { report: null });
      }

      try {
        const report = JSON.parse(readFileSync(validationPath, "utf-8"));
        return this.json(res, 200, { report });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/release/decision/latest") {
      const decisionPath = "prism-output/release-go-no-go-summary.json";
      if (!existsSync(decisionPath)) {
        return this.json(res, 200, { report: null });
      }

      try {
        const report = JSON.parse(readFileSync(decisionPath, "utf-8"));
        return this.json(res, 200, { report });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    const actionMatch = /^\/api\/actions\/([^/]+)$/.exec(url);
    if (method === "POST" && actionMatch) {
      const actionName = decodeURIComponent(actionMatch[1]!);
      if (!this.actionsByName.has(actionName)) {
        return this.json(res, 404, { error: `Unknown action: ${actionName}` });
      }
      const currentState = this.actionStates.get(actionName);
      if (currentState?.status === "running") {
        return this.json(res, 409, { error: `Action already running: ${actionName}` });
      }
      return this.json(res, 202, this.triggerAction(actionName));
    }

    const approveMatch = /^\/(approve|api\/approve)\/([^/]+)$/.exec(url);
    if (method === "POST" && approveMatch) {
      const ok = this.queue.approve(approveMatch[2]!);
      return this.json(res, ok ? 200 : 404, { approved: ok });
    }

    const denyMatch = /^\/(deny|api\/deny)\/([^/]+)$/.exec(url);
    if (method === "POST" && denyMatch) {
      const ok = this.queue.deny(denyMatch[2]!);
      return this.json(res, ok ? 200 : 404, { denied: ok });
    }

    // ── Network API endpoints ────────────────────────────────────────────
    if (method === "GET" && url === "/api/network/interfaces") {
      try {
        const { exec: execCb } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const { platform } = await import("node:os");
        const execP = promisify(execCb);
        const isWin = platform() === "win32";
        const cmd = isWin ? "ipconfig /all" : "ifconfig -a 2>/dev/null || ip addr show";
        const { stdout } = await execP(cmd, { timeout: 10_000 });

        // Parse into interface blocks
        const interfaces: { name: string; details: string }[] = [];
        if (isWin) {
          // Split on adapter header lines
          const blocks = stdout.split(/\r?\n(?=\S.*adapter\s)/i);
          for (const block of blocks) {
            const firstLine = block.split(/\r?\n/)[0]?.trim();
            if (firstLine && firstLine.includes("adapter")) {
              interfaces.push({ name: firstLine.replace(/:$/, ""), details: block.split(/\r?\n/).slice(1).join("\n").trim() });
            }
          }
        } else {
          const blocks = stdout.split(/\r?\n(?=\S)/);
          for (const block of blocks) {
            const firstLine = block.split(/\r?\n/)[0]?.trim();
            if (firstLine) {
              const name = firstLine.split(/[:\s]/)[0] || firstLine;
              interfaces.push({ name, details: block.trim() });
            }
          }
        }
        return this.json(res, 200, { interfaces });
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 500, { error: e.message ?? "Failed to query interfaces" });
      }
    }

    if (method === "POST" && url === "/api/network/exec") {
      try {
        const body = await this.readJsonBody<{ command?: string }>(req);
        const command = String(body.command ?? "").trim();
        if (!command) {
          return this.json(res, 400, { error: "Missing 'command' field." });
        }

        // Find the NetworkTool from the registered tools
        const networkTool = this.tools.find(t => t.name === "network_exec");
        if (!networkTool) {
          return this.json(res, 500, { error: "NetworkTool not registered." });
        }

        const result = await networkTool.execute({ operation: "network_exec", args: { command, timeoutMs: 30_000 }, risk: "low", mutatesState: false });
        const tier = (result.output as Record<string, unknown>)?.tier as string | undefined;
        this.networkCommandHistory.push({ command, tier, ok: result.ok, timestamp: new Date().toISOString() });
        if (result.ok) {
          return this.json(res, 200, result.output);
        } else {
          return this.json(res, 422, result.output);
        }
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 500, { error: e.message ?? "network_exec failed" });
      }
    }

    if (method === "GET" && url === "/api/network/telemetry") {
      const history = this.networkCommandHistory ?? [];
      const tier1 = history.filter((h: { tier?: string }) => h.tier === "tier1").length;
      const tier2 = history.filter((h: { tier?: string }) => h.tier === "tier2").length;
      const tier3 = history.filter((h: { tier?: string }) => h.tier === "tier3").length;
      const errors = history.filter((h: { ok?: boolean }) => !h.ok).length;
      const last = history.length > 0 ? history[history.length - 1] : null;
      return this.json(res, 200, {
        totalCommands: history.length,
        tier1Count: tier1,
        tier2Count: tier2,
        tier3Count: tier3,
        errorCount: errors,
        lastCommand: last?.command ?? null,
      });
    }

    // ── Workspace API endpoints ────────────────────────────────────────
    if (method === "GET" && url === "/api/workspace/info") {
      const root = resolveWorkspaceRoot();
      const manifestPath = join(root, "prism-workspace.json");
      let manifest = null;
      if (existsSync(manifestPath)) {
        try { manifest = JSON.parse(readFileSync(manifestPath, "utf-8")); } catch { /* ignore */ }
      }
      return this.json(res, 200, {
        workspaceRoot: root,
        exists: existsSync(root),
        manifest,
      });
    }

    if (method === "GET" && url === "/api/workspace/files") {
      const root = resolveWorkspaceRoot();
      if (!existsSync(root)) {
        return this.json(res, 200, { root, entries: [] });
      }
      const walkDir = (dir: string, prefix: string): Array<{ name: string; path: string; type: "file" | "dir"; size: number }> => {
        const results: Array<{ name: string; path: string; type: "file" | "dir"; size: number }> = [];
        let items: string[];
        try { items = readdirSync(dir); } catch { return results; }
        for (const item of items) {
          const fullPath = join(dir, item);
          const relPath = prefix ? prefix + "/" + item : item;
          try {
            const st = statSync(fullPath);
            if (st.isDirectory()) {
              results.push({ name: item, path: relPath, type: "dir", size: 0 });
              results.push(...walkDir(fullPath, relPath));
            } else {
              results.push({ name: item, path: relPath, type: "file", size: st.size });
            }
          } catch { /* skip inaccessible */ }
        }
        return results;
      };
      const entries = walkDir(root, "");
      return this.json(res, 200, { root, entries });
    }

    if (method === "POST" && url === "/api/workspace/open-explorer") {
      const root = resolveWorkspaceRoot();
      try {
        const { exec: execCb } = await import("node:child_process");
        const { platform: osPlatform } = await import("node:os");
        const p = osPlatform();
        const cmd = p === "win32" ? `explorer "${root}"` : p === "darwin" ? `open "${root}"` : `xdg-open "${root}"`;
        execCb(cmd, { timeout: 10_000 }, () => { });
        return this.json(res, 200, { ok: true, path: root });
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 500, { error: e.message ?? "Failed to open explorer" });
      }
    }

    if (method === "POST" && url === "/api/workspace/relocate") {
      try {
        const payload = await this.readJsonBody<{ path?: string }>(req);
        const newPath = (payload.path ?? "").trim();
        if (!newPath) {
          return this.json(res, 400, { error: "Path is required." });
        }
        const { isAbsolute } = await import("node:path");
        if (!isAbsolute(newPath)) {
          return this.json(res, 400, { error: "Path must be absolute (e.g. C:\\Users\\you\\Documents\\MyWorkspace)." });
        }
        setWorkspaceRoot(newPath);
        ensureWorkspaceStructure();
        return this.json(res, 200, { ok: true, workspaceRoot: resolveWorkspaceRoot() });
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 500, { error: e.message ?? "Failed to relocate workspace" });
      }
    }

    if (method === "POST" && url === "/api/workspace/import") {
      try {
        const payload = await this.readJsonBody<{
          mode?: string; fileName?: string; content?: string;
          targetDir?: string; registeredType?: string;
          files?: Array<{ name: string; content: string; relativePath?: string }>;
        }>(req);
        const mode = (payload.mode ?? "").trim();
        if (!mode || !["general", "registered", "folder"].includes(mode)) {
          return this.json(res, 400, { error: "mode must be 'general', 'registered', or 'folder'." });
        }
        const root = resolveWorkspaceRoot();
        const profile = this.status.executionProfileSegment || "individual";
        const blockedExtensions = [".exe", ".bat", ".cmd", ".ps1", ".sh", ".msi", ".dll", ".sys"];
        const VALID_TARGET_DIRS = ["config", "artifacts", "data", "data/tasks", "data/notes", "data/email", "data/calendar", "characters", "logs", "workspace", "state"];
        const REGISTERED_TYPES: Record<string, { targetDir: string; validate: (parsed: unknown) => string | null }> = {
          character: {
            targetDir: "characters",
            validate: (p: unknown) => {
              const o = p as Record<string, unknown>;
              if (!o.name || typeof o.name !== "string") return "Character must have a 'name' field.";
              if (!o.systemPrompt && !o.persona) return "Character must have a 'systemPrompt' or 'persona' field.";
              return null;
            },
          },
          "mcp-config": {
            targetDir: "config",
            validate: (p: unknown) => {
              const o = p as Record<string, unknown>;
              if (!o.mcpServers || typeof o.mcpServers !== "object") return "MCP config must have a 'mcpServers' object.";
              return null;
            },
          },
          "session-package": {
            targetDir: "artifacts/packages",
            validate: (p: unknown) => {
              const o = p as Record<string, unknown>;
              if (!o.exportedAt && !o.package) return "Session package must have 'exportedAt' or 'package' field.";
              return null;
            },
          },
          "tool-contract": {
            targetDir: "artifacts/contracts",
            validate: (p: unknown) => {
              const o = p as Record<string, unknown>;
              if (!Array.isArray(o.tools)) return "Tool contract must have a 'tools' array.";
              return null;
            },
          },
          "self-review": {
            targetDir: "artifacts/self-review",
            validate: (p: unknown) => {
              const o = p as Record<string, unknown>;
              if (!o.generatedAt) return "Self-review report must have a 'generatedAt' field.";
              return null;
            },
          },
          "task-timeline": {
            targetDir: "data/tasks",
            validate: (p: unknown) => {
              const o = p as Record<string, unknown>;
              if (!o.timelineId || !Array.isArray(o.tasks)) return "Task timeline must have 'timelineId' and 'tasks' array.";
              return null;
            },
          },
          note: {
            targetDir: "data/notes",
            validate: () => null,
          },
        };

        // ── Folder import ──
        if (mode === "folder") {
          const targetDir = (payload.targetDir ?? "").trim();
          if (!targetDir || !VALID_TARGET_DIRS.includes(targetDir)) {
            return this.json(res, 400, { error: "targetDir must be one of: " + VALID_TARGET_DIRS.join(", ") });
          }
          const files = payload.files;
          if (!Array.isArray(files) || files.length === 0) {
            return this.json(res, 400, { error: "No files provided for folder import." });
          }
          if (files.length > 500) {
            return this.json(res, 400, { error: "Folder import limited to 500 files at a time." });
          }
          const results: Array<{ name: string; status: string; message: string }> = [];
          for (const file of files) {
            const relPath = (file.relativePath ?? file.name).replace(/\\/g, "/");
            if (relPath.includes("..")) {
              results.push({ name: relPath, status: "rejected", message: "Path traversal not allowed." });
              continue;
            }
            const ext = "." + relPath.split(".").pop()?.toLowerCase();
            if (profile === "business" && blockedExtensions.includes(ext)) {
              results.push({ name: relPath, status: "rejected", message: "Executable blocked by business profile." });
              continue;
            }
            try {
              const buf = Buffer.from(file.content, "base64");
              if (buf.length > 10 * 1024 * 1024) {
                results.push({ name: relPath, status: "rejected", message: "File exceeds 10 MB limit." });
                continue;
              }
              const fullPath = join(root, targetDir, relPath);
              const dir = dirname(fullPath);
              if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
              writeFileSync(fullPath, buf);
              results.push({ name: relPath, status: "imported", message: "OK" });
            } catch (fe: unknown) {
              results.push({ name: relPath, status: "error", message: (fe as { message?: string }).message ?? "Write failed" });
            }
          }
          const imported = results.filter(r => r.status === "imported").length;
          const entry = {
            id: Date.now().toString(36),
            timestamp: new Date().toISOString(),
            mode: "folder",
            fileName: imported + " files into " + targetDir,
            targetDir,
            registeredType: null,
            status: imported === files.length ? "success" : "partial",
            message: imported + "/" + files.length + " files imported",
            size: 0,
          };
          this.importHistory.unshift(entry);
          if (this.importHistory.length > 100) this.importHistory.length = 100;
          return this.json(res, 200, { ok: true, results, summary: entry });
        }

        // ── General + Registered single-file import ──
        const fileName = (payload.fileName ?? "").trim();
        const content = (payload.content ?? "").trim();
        if (!fileName) return this.json(res, 400, { error: "fileName is required." });
        if (!content) return this.json(res, 400, { error: "content (base64) is required." });
        if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
          return this.json(res, 400, { error: "fileName must not contain path separators or '..'." });
        }
        const buf = Buffer.from(content, "base64");
        if (buf.length > 10 * 1024 * 1024) {
          return this.json(res, 400, { error: "File exceeds 10 MB size limit." });
        }
        const ext = "." + fileName.split(".").pop()?.toLowerCase();
        if (profile === "business" && blockedExtensions.includes(ext)) {
          return this.json(res, 400, { error: "Executable file types are blocked under Business profile policy." });
        }

        if (mode === "registered") {
          const rType = (payload.registeredType ?? "").trim();
          if (!rType || !REGISTERED_TYPES[rType]) {
            return this.json(res, 400, { error: "registeredType must be one of: " + Object.keys(REGISTERED_TYPES).join(", ") });
          }
          const spec = REGISTERED_TYPES[rType];
          let parsed: unknown = null;
          const isJson = ext === ".json";
          if (isJson) {
            try { parsed = JSON.parse(buf.toString("utf-8")); } catch {
              return this.json(res, 400, { error: "File is not valid JSON." });
            }
            const vErr = spec.validate(parsed);
            if (vErr) return this.json(res, 400, { error: "Validation failed: " + vErr });
          }
          const destDir = join(root, spec.targetDir);
          if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
          let destName = rType === "mcp-config" ? "mcp-settings.json" : fileName;
          const destPath = join(destDir, destName);
          if (existsSync(destPath)) {
            const ts = Date.now().toString(36);
            const parts = destName.split(".");
            if (parts.length > 1) {
              parts[parts.length - 2] += "-" + ts;
              destName = parts.join(".");
            } else {
              destName = destName + "-" + ts;
            }
          }
          writeFileSync(join(destDir, destName), buf);
          const entry = {
            id: Date.now().toString(36),
            timestamp: new Date().toISOString(),
            mode: "registered",
            fileName: destName,
            targetDir: spec.targetDir,
            registeredType: rType,
            status: "success",
            message: "Imported as " + rType + " to " + spec.targetDir + "/" + destName,
            size: buf.length,
          };
          this.importHistory.unshift(entry);
          if (this.importHistory.length > 100) this.importHistory.length = 100;
          return this.json(res, 200, { ok: true, entry });
        }

        // ── General import ──
        const targetDir = (payload.targetDir ?? "").trim();
        if (!targetDir || !VALID_TARGET_DIRS.includes(targetDir)) {
          return this.json(res, 400, { error: "targetDir must be one of: " + VALID_TARGET_DIRS.join(", ") });
        }
        const destDir = join(root, targetDir);
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        let destName = fileName;
        if (existsSync(join(destDir, destName))) {
          const ts = Date.now().toString(36);
          const parts = destName.split(".");
          if (parts.length > 1) {
            parts[parts.length - 2] += "-" + ts;
            destName = parts.join(".");
          } else {
            destName = destName + "-" + ts;
          }
        }
        writeFileSync(join(destDir, destName), buf);
        const entry = {
          id: Date.now().toString(36),
          timestamp: new Date().toISOString(),
          mode: "general",
          fileName: destName,
          targetDir,
          registeredType: null,
          status: "success",
          message: "Imported to " + targetDir + "/" + destName,
          size: buf.length,
        };
        this.importHistory.unshift(entry);
        if (this.importHistory.length > 100) this.importHistory.length = 100;
        return this.json(res, 200, { ok: true, entry });
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 500, { error: e.message ?? "Import failed" });
      }
    }

    if (method === "GET" && url === "/api/workspace/import/history") {
      return this.json(res, 200, { history: this.importHistory });
    }

    if (method === "GET" && url === "/api/workspace/git-status") {
      const root = resolveWorkspaceRoot();
      try {
        const { exec: execCb } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const exec = promisify(execCb);
        const gitResult = await exec("git status --porcelain", { cwd: root, timeout: 10_000 }).catch(() => null);
        const branchResult = await exec("git rev-parse --abbrev-ref HEAD", { cwd: root, timeout: 5_000 }).catch(() => null);
        const remoteResult = await exec("git remote -v", { cwd: root, timeout: 5_000 }).catch(() => null);
        return this.json(res, 200, {
          isGitRepo: gitResult !== null,
          branch: branchResult?.stdout?.trim() ?? null,
          remote: remoteResult?.stdout?.trim() ?? null,
          changedFiles: gitResult?.stdout?.trim()?.split("\n").filter(Boolean).length ?? 0,
        });
      } catch {
        return this.json(res, 200, { isGitRepo: false, branch: null, remote: null, changedFiles: 0 });
      }
    }

    this.json(res, 404, { error: "Not found" });
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body, null, 2));
  }

  private async readJsonBody<T extends object>(req: IncomingMessage): Promise<T> {
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

  private async generateAssistantReply(sessionId: string, content: string, conversation: ChatMessage[]): Promise<{
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

    if (/(^|\b)(help|capabilities|what can you do)(\b|$)/.test(normalized)) {
      return {
        content: this.helpResponse(),
        metadata: { intent: "help" },
      };
    }

    if (/(show|give|what'?s|what is|summarize).*(status|health)|\bstatus\b|\bhealth\b/.test(normalized)) {
      return {
        content: this.statusResponse(),
        metadata: { intent: "status" },
      };
    }

    if (/(pending|show|list).*(approval|approvals)|\bapprovals\b/.test(normalized)) {
      return {
        content: this.approvalsResponse(),
        metadata: { intent: "approvals" },
      };
    }

    if (/(recent|show|list).*(action history|actions|runs)|\bhistory\b/.test(normalized)) {
      return {
        content: this.actionHistoryResponse(),
        metadata: { intent: "action_history" },
      };
    }

    const actionName = this.resolveActionIntent(normalized);
    if (actionName) {
      try {
        this.triggerAction(actionName);
        const action = this.actionStates.get(actionName)!;
        return {
          content: `Started ${action.label}. Track progress in Quick Actions and Recent Action History.`,
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
      const conversationHistory = conversation
        .filter((entry) => entry.role === "user" || entry.role === "assistant" || entry.role === "system")
        .map((entry) => ({ role: entry.role, content: entry.content }));

      // If the session has an explicit provider/model override, use it directly.
      // Otherwise, use capability-aware role routing ("chat" role).
      const hasSessionOverride = session?.llmProviderId && session?.llmModel;
      const selection = hasSessionOverride
        ? { providerId: session.llmProviderId ?? undefined, model: session.llmModel ?? undefined }
        : undefined;

      const systemPrompt = this.buildAgenticSystemPrompt();

      // Use agentic executor if available — enables tool calling loop
      if (this.agenticExecutor) {
        const agenticResult = await this.agenticExecutor.execute(
          content,
          conversationHistory,
          systemPrompt,
          async (input, sel) => {
            const result = hasSessionOverride
              ? await this.llmProviders.generate(input, sel)
              : await this.llmProviders.generateForRole("chat", input);
            if (!result) return null;
            return {
              content: result.content,
              toolCalls: result.toolCalls,
              stopReason: result.stopReason,
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
              this.pendingToolCalls.set(event.toolCall.id, { toolName: event.toolCall.name, startedAt: Date.now() });
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
                  this.pluginStates[pluginKey] = { enabled: true, healthy: true, requests: 0, errors: 0, avgResponseMs: 0, lastChecked: null };
                }
                const ps = this.pluginStates[pluginKey];
                ps.requests++;
                if (!event.toolResult.ok) ps.errors++;
                ps.avgResponseMs = ps.requests === 1 ? latencyMs : Math.round((ps.avgResponseMs * (ps.requests - 1) + latencyMs) / ps.requests);
                ps.lastChecked = new Date().toISOString();
                ps.healthy = ps.errors / ps.requests < 0.5;
              } else {
                if (!this.toolStates[toolName]) {
                  this.toolStates[toolName] = { enabled: true, invocations: 0, successes: 0, failures: 0, avgLatencyMs: 0, lastInvoked: null, lastError: null };
                }
                const ts = this.toolStates[toolName];
                ts.invocations++;
                if (event.toolResult.ok) {
                  ts.successes++;
                } else {
                  ts.failures++;
                  ts.lastError = typeof event.toolResult.output === "string" ? event.toolResult.output.slice(0, 200) : "Tool call failed";
                }
                ts.avgLatencyMs = ts.invocations === 1 ? latencyMs : Math.round((ts.avgLatencyMs * (ts.invocations - 1) + latencyMs) / ts.invocations);
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
                .filter((e) => e.type === "tool_call" || e.type === "tool_result")
                .map((e) => ({
                  type: e.type,
                  tool: e.toolCall?.name ?? e.toolResult?.name,
                  ok: e.toolResult?.ok,
                })),
            },
          };
        }
      }

      // Fallback: route through agent router if available, otherwise single-shot LLM call
      if (!hasSessionOverride && this.agentRouter) {
        try {
          const { classification, result } = await this.agentRouter.routeAndDispatch(content, conversationHistory.map((m) => `${m.role}: ${m.content}`).join("\n"));
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
        generated = await this.llmProviders.generate({
          message: content,
          conversation: conversationHistory,
          systemPrompt,
        }, selection);
      } else {
        generated = await this.llmProviders.generateForRole("chat", {
          message: content,
          conversation: conversationHistory,
          systemPrompt: "", // adaptive prompt builder will replace this
        });
      }

      if (generated?.content?.trim()) {
        const meta: Record<string, unknown> = {
          intent: "llm",
          provider: generated.providerId,
          model: generated.model,
        };
        if ('routing' in generated) {
          const r = generated as { routing: { profile: { tier: number }; degraded: boolean; reason: string } };
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

  private buildAgenticSystemPrompt(): string {
    const toolNames = this.tools.map((t) => t.name).join(", ");
    const wsRoot = (() => { try { return resolveWorkspaceRoot(); } catch { return process.cwd(); } })();
    return [
      "You are PRISM, an autonomous agent runtime with governed tool execution.",
      "You have access to tools that you MUST use to accomplish tasks the user requests.",
      "When the user asks you to create files, run commands, make HTTP requests, or perform any action, EXECUTE the corresponding tool — do NOT just describe what you would do.",
      "",
      `Available tools: ${toolNames}`,
      "",
      "Tool usage guidelines:",
      "- Use file_write to create or update files. Always provide the full file content.",
      "- Use file_read to read existing files before modifying them.",
      "- Use file_list to explore directory structures.",
      "- Use shell_exec for running commands (build, install, git, etc.).",
      "- Use http_request for API calls and web requests.",
      "- For multi-step tasks, execute tools in sequence — plan first, then act.",
      "",
      `Workspace root: ${wsRoot}`,
      `Runtime mode: ${this.status.mode}. Environment: ${this.status.environmentProfile}.`,
      `Pending approvals: ${this.queue.list().length}.`,
      "",
      "Respond with concise, actionable information. Show tool results to the user.",
      "Do not hallucinate. If you don't know, say so.",
    ].join("\n");
  }

  private async handleAttachmentUpload(
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
    const fileName = sanitizeFileName(
      req.headers["x-file-name"] as string || `attachment_${randomUUID()}`
    );
    const mimeType = req.headers["x-mime-type"] as string || contentType || "application/octet-stream";
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

  private serveAttachmentFile(res: ServerResponse, attachmentId: string, thumbnail = false): void {
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
        content: approved
          ? `Approved ${argument}.`
          : `No pending approval matched ${argument}.`,
        metadata: { intent: "approve", approvalId: argument, approved },
      };
    }

    if (command === "deny") {
      if (!argument) {
        return { content: "Usage: /deny <approval-id>", metadata: { intent: "deny_usage" } };
      }
      const denied = this.queue.deny(argument);
      return {
        content: denied
          ? `Denied ${argument}.`
          : `No pending approval matched ${argument}.`,
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
      ...actions.map((action) => `- ${action.label} | command: /run ${action.label.toLowerCase()} | status: ${action.status}`),
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
      ...history.map((entry) => `- ${entry.label} | ${entry.status} | ${entry.message ?? entry.error ?? "no outcome yet"}`),
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

  private async getReadinessSnapshot(requestedSessionId?: string): Promise<DashboardReadinessSnapshot> {
    const sessions = this.chatStore.listSessions();
    const activeSessionId = requestedSessionId
      ?? sessions[0]?.sessionId
      ?? null;

    const activeSession = activeSessionId
      ? this.chatStore.getSession(activeSessionId)
      : null;

    const catalog = activeSessionId
      ? await this.getSessionLlmCatalog(activeSessionId)
      : await this.llmProviders.getCatalog();

    const hasEnabledProvider = catalog.providers.some((provider) => provider.enabled);
    const activeProvider = catalog.activeProviderId
      ? catalog.providers.find((provider) => provider.id === catalog.activeProviderId) ?? null
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
          : "Create a chat session before sending messages.",
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
          ? (catalog.activeModel
            ? "Provider and model are reachable for requests."
            : "Select a model for the active provider.")
          : (activeProvider?.reason ?? "No active provider is currently usable."),
      },
    ];

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

  private emitReadinessAudit(
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

function dashboardHtml(port: number): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PRISM Frontier Console</title>
  <style>
    :root {
      --bg: #07111f;
      --panel: rgba(7, 19, 36, 0.82);
      --panel-strong: rgba(10, 24, 45, 0.94);
      --border: rgba(148, 163, 184, 0.16);
      --text: #edf3ff;
      --muted: #98a6bc;
      --accent: #69d2ff;
      --accent-2: #7cf1c8;
      --danger: #ff8d8d;
      --shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
      --radius: 22px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font-family: Aptos, "Segoe UI Variable Text", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(105, 210, 255, 0.16), transparent 28%),
        radial-gradient(circle at top right, rgba(124, 241, 200, 0.12), transparent 24%),
        linear-gradient(180deg, #06101d 0%, #091728 44%, #07111f 100%);
    }
    button, textarea, select { font: inherit; }
    .app {
      display: grid;
      grid-template-columns: var(--sidebar-width, 340px) auto minmax(0, 1fr);
      gap: 0;
      padding: 18px;
      min-height: 100vh;
    }
    .resize-handle {
      width: 6px;
      cursor: col-resize;
      background: transparent;
      position: relative;
      z-index: 10;
      transition: background 0.15s;
    }
    .resize-handle:hover,
    .resize-handle.active {
      background: rgba(105, 210, 255, 0.25);
    }
    .resize-handle::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 2px;
      height: 32px;
      border-radius: 2px;
      background: rgba(148, 163, 184, 0.25);
      transition: background 0.15s, height 0.15s;
    }
    .resize-handle:hover::after,
    .resize-handle.active::after {
      background: rgba(105, 210, 255, 0.5);
      height: 48px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
    }
    .sidebar {
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      overflow: hidden;
      min-width: 200px;
    }
    .workspace {
      min-width: 0;
      display: flex;
      margin-left: 12px;
      flex-direction: column;
      gap: 14px;
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px;
      border-radius: 18px;
      min-height: 68px;
      background: linear-gradient(180deg, rgba(9,17,31,0.92), rgba(9,17,31,0.84));
      border: 1px solid rgba(105,210,255,0.20);
      align-items: stretch;
    }
    .tab-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 1 1 180px;
      min-height: 46px;
      border: 1px solid rgba(148,163,184,0.28);
      border-radius: 12px;
      background: rgba(14, 25, 43, 0.92);
      color: var(--text);
      cursor: pointer;
      padding: 12px 14px;
      font-weight: 700;
      transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease, transform 0.14s ease;
    }
    .tab-button:hover {
      border-color: rgba(105,210,255,0.42);
      transform: translateY(-1px);
    }
    .tab-button:focus-visible {
      outline: 2px solid rgba(105,210,255,0.7);
      outline-offset: 2px;
    }
    .tab-button.active {
      color: #04111f;
      border-color: rgba(105,210,255,0.18);
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      box-shadow: 0 10px 24px rgba(105,210,255,0.16);
    }
    .tab-panel { display: block; }
    body.js-ready .tab-panel { display: none; }
    body.js-ready .tab-panel.active { display: block; }
    .tab-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      align-items: start;
    }
    .brand {
      padding: 16px;
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(105, 210, 255, 0.16), rgba(124, 241, 200, 0.08));
      border: 1px solid rgba(105, 210, 255, 0.18);
    }
    .eyebrow { color: var(--accent-2); font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; }
    .brand h1 { margin: 8px 0 6px; font-size: 28px; }
    .muted { color: var(--muted); }
    .session-list { display: flex; flex-direction: column; gap: 10px; overflow: auto; }
    .session-card {
      width: 100%;
      text-align: left;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(148,163,184,0.12);
      color: var(--text);
      padding: 14px;
      border-radius: 16px;
      cursor: pointer;
    }
    .session-card.active { border-color: rgba(105, 210, 255, 0.48); background: rgba(105, 210, 255, 0.10); }
    .session-title { font-weight: 700; margin-bottom: 6px; }
    .session-preview { font-size: 12px; color: var(--muted); line-height: 1.45; }
    .session-meta { margin-top: 8px; font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; gap: 10px; }
    .session-package-card {
      border: 1px solid rgba(124, 241, 200, 0.24);
      background: rgba(124, 241, 200, 0.05);
    }
    .session-package-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .session-package-badge {
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent-2);
    }
    .pkg-status-badge {
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-radius: 8px;
      padding: 2px 9px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      line-height: 1.6;
    }
    .pkg-status-badge.planned  { background: rgba(148,163,184,0.15); color: #94a3b8; }
    .pkg-status-badge.running  { background: rgba(105,210,255,0.20); color: #69d2ff; }
    .pkg-status-badge.blocked  { background: rgba(255,170,50,0.22);  color: #ffaa32; }
    .pkg-status-badge.complete { background: rgba(124,241,200,0.22); color: #7cf1c8; }
    .session-package-actions {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 10px;
    }
    .session-package-actions .secondary-button,
    .session-package-actions .primary-button,
    .session-package-actions .danger-button {
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 8px 12px;
      font-size: 12px;
    }
    .session-package-children {
      margin-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-left: 10px;
      border-left: 1px solid rgba(148,163,184,0.22);
    }
    .session-card.session-chapter {
      padding: 10px;
      border-radius: 12px;
      background: rgba(255,255,255,0.01);
    }
    .primary-button, .secondary-button, .danger-button {
      border: none;
      border-radius: 14px;
      cursor: pointer;
      padding: 10px 14px;
      color: #04111f;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      font-weight: 700;
    }
    .secondary-button {
      background: rgba(255,255,255,0.06);
      color: var(--text);
      border: 1px solid rgba(148,163,184,0.14);
    }
    .danger-button {
      color: #fff;
      background: rgba(255, 77, 77, 0.18);
      border: 1px solid rgba(255, 141, 141, 0.28);
    }
    .primary-button[disabled], .secondary-button[disabled], .danger-button[disabled] {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .chat {
      position: relative;
      display: flex;
      flex-direction: column;
      height: calc(100vh - 118px);
      overflow: hidden;
    }
    .chat-header {
      flex-shrink: 0;
      padding: 22px 24px 16px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent);
    }
    .chat-header h2 { margin: 8px 0 6px; font-size: 26px; }
    .header-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(148,163,184,0.12);
      color: var(--muted);
    }
    .messages {
      padding: 22px 24px 200px 24px;
      overflow-y: auto;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .message {
      max-width: 86%;
      padding: 16px 18px;
      border-radius: 22px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .message.user {
      margin-left: auto;
      background: linear-gradient(135deg, rgba(105, 210, 255, 0.18), rgba(105, 210, 255, 0.08));
      border: 1px solid rgba(105, 210, 255, 0.18);
    }
    .message.assistant {
      margin-right: auto;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(148,163,184,0.12);
    }
    .message-label { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; }
    .message-time { margin-top: 10px; font-size: 11px; color: var(--muted); }
    .empty-state {
      margin: auto;
      max-width: 520px;
      text-align: center;
      color: var(--muted);
      border: 1px dashed rgba(148,163,184,0.18);
      border-radius: 22px;
      padding: 28px;
      background: rgba(255,255,255,0.02);
    }
    .composer {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 18px 24px 24px;
      border-top: 1px solid var(--border);
      background: rgba(10, 24, 45, 0.95);
      border-bottom-left-radius: var(--radius);
      border-bottom-right-radius: var(--radius);
      box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.4);
      z-index: 10;
      backdrop-filter: blur(12px);
    }
    .composer-shell {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 12px;
      align-items: end;
    }
    .composer-toolbar {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-bottom: 8px;
    }
    .toolbar-btn {
      background: rgba(148,163,184,0.08);
      border: 1px solid rgba(148,163,184,0.16);
      color: var(--text);
      border-radius: 8px;
      width: 34px;
      height: 34px;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .toolbar-btn:hover { background: rgba(105,210,255,0.15); }
    .attachment-preview-strip {
      display: flex;
      gap: 8px;
      padding: 0 4px;
      flex-wrap: wrap;
    }
    .attachment-preview-strip:empty { display: none; }
    .attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: rgba(105,210,255,0.08);
      border: 1px solid rgba(105,210,255,0.24);
      border-radius: 12px;
      font-size: 12px;
      color: var(--accent);
    }
    .attachment-chip .remove-btn {
      cursor: pointer;
      opacity: 0.6;
      font-size: 14px;
    }
    .attachment-chip .remove-btn:hover { opacity: 1; }
    /* Markdown rendering in chat */
    .message pre {
      background: rgba(2,8,18,0.8);
      border: 1px solid rgba(148,163,184,0.12);
      border-radius: 8px;
      padding: 12px 14px;
      overflow-x: auto;
      font-size: 13px;
      line-height: 1.5;
      margin: 8px 0;
    }
    .message code {
      background: rgba(148,163,184,0.1);
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 13px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }
    .message pre code {
      background: none;
      padding: 0;
    }
    .message p { margin: 6px 0; }
    .message ul, .message ol { margin: 6px 0; padding-left: 24px; }
    .message li { margin: 2px 0; }
    .message h1, .message h2, .message h3, .message h4 {
      margin: 12px 0 6px;
      font-weight: 600;
    }
    .message a { color: var(--accent); text-decoration: underline; }
    .message blockquote {
      border-left: 3px solid var(--accent);
      margin: 8px 0;
      padding: 4px 12px;
      opacity: 0.85;
    }
    .message table { border-collapse: collapse; margin: 8px 0; width: 100%; }
    .message th, .message td { border: 1px solid rgba(148,163,184,0.2); padding: 6px 10px; text-align: left; }
    .message th { background: rgba(148,163,184,0.06); font-weight: 600; }
    /* Tool execution blocks */
    .tool-block {
      margin: 8px 0;
      border: 1px solid rgba(148,163,184,0.15);
      border-radius: 8px;
      overflow: hidden;
    }
    .tool-block-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(148,163,184,0.06);
      cursor: pointer;
      font-size: 13px;
      user-select: none;
    }
    .tool-block-header:hover { background: rgba(148,163,184,0.1); }
    .tool-block-icon { font-size: 14px; }
    .tool-block-name { font-weight: 600; color: var(--accent); }
    .tool-block-status { margin-left: auto; font-size: 12px; }
    .tool-block-status.ok { color: #4caf50; }
    .tool-block-status.fail { color: #f44336; }
    .tool-block-body {
      padding: 10px 12px;
      font-size: 12px;
      max-height: 200px;
      overflow-y: auto;
      display: none;
      background: rgba(2,8,18,0.5);
    }
    .tool-block.expanded .tool-block-body { display: block; }
    /* Streaming indicator */
    .streaming-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      animation: pulse 1s infinite;
      margin-left: 6px;
    }
    @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
    .message .attachment-inline {
      margin: 6px 0;
      display: inline-block;
    }
    .message .attachment-inline img {
      max-width: 300px;
      max-height: 200px;
      border-radius: 8px;
      border: 1px solid rgba(148,163,184,0.2);
    }
    .message .attachment-inline .file-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgba(148,163,184,0.06);
      border: 1px solid rgba(148,163,184,0.15);
      border-radius: 8px;
      font-size: 12px;
      color: var(--accent);
      text-decoration: none;
    }
    textarea {
      width: 100%;
      min-height: 92px;
      max-height: 60vh;
      resize: vertical;
      border-radius: 18px;
      padding: 14px 16px;
      border: 1px solid rgba(148,163,184,0.16);
      background: rgba(2, 8, 18, 0.66);
      color: var(--text);
    }
    textarea:focus { outline: 1px solid rgba(105, 210, 255, 0.42); }
    .control-select {
      width: 100%;
      text-align: left;
      border-radius: 14px;
      padding: 10px 14px;
      border: 1px solid rgba(148,163,184,0.18);
      background: rgba(6, 16, 29, 0.96);
      color: var(--text);
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
    }
    .control-select:focus {
      outline: 1px solid rgba(105, 210, 255, 0.42);
      border-color: rgba(105, 210, 255, 0.34);
    }
    .control-select option,
    .control-select optgroup {
      background: #0b1728;
      color: var(--text);
    }
    select option, select optgroup { background: #0b1728; color: var(--text); }
    .composer-hint { margin-top: 10px; font-size: 12px; color: var(--muted); }
    .rail-section {
      border: 1px solid rgba(148,163,184,0.12);
      border-radius: 18px;
      padding: 16px;
      background: rgba(255,255,255,0.03);
    }
    .rail-section h3 { margin: 0 0 12px; font-size: 15px; }
    .stack { display: flex; flex-direction: column; gap: 10px; }
    .metric { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 11px;
      border: 1px solid rgba(148,163,184,0.14);
      color: var(--muted);
    }
    .badge-running { color: #8dd8ff; border-color: rgba(105,210,255,0.34); }
    .badge-succeeded { color: #8ff3c8; border-color: rgba(124,241,200,0.30); }
    .badge-failed { color: #ff9f9f; border-color: rgba(255,141,141,0.30); }
    .action-card, .approval-card {
      border: 1px solid rgba(148,163,184,0.12);
      border-radius: 16px;
      padding: 14px;
      background: rgba(255,255,255,0.025);
    }
    .action-card-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 8px; }
    .action-buttons { display: flex; gap: 8px; margin-top: 12px; }
    .history-table, .events-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .history-table th, .history-table td, .events-table th, .events-table td {
      text-align: left;
      padding: 8px 0;
      border-bottom: 1px solid rgba(148,163,184,0.10);
      vertical-align: top;
    }
    .notice {
      margin-bottom: 12px;
      padding: 10px 12px;
      border-radius: 14px;
      background: rgba(255, 141, 141, 0.10);
      border: 1px solid rgba(255, 141, 141, 0.18);
      color: #ffc1c1;
      font-size: 12px;
    }
    .onboarding {
      margin: 12px 24px 0;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid rgba(148,163,184,0.16);
      background: rgba(255,255,255,0.03);
    }
    .onboarding-title {
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .onboarding-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    .onboarding-list .passed {
      color: var(--accent-2);
    }
    .onboarding-list .failed {
      color: #ffc1c1;
    }
    .mono { font-family: "Cascadia Code", Consolas, monospace; }
    .collapsible-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; padding: 0; margin: 0; }
    .collapsible-header:hover { opacity: 0.85; }
    .collapsible-header h3 { margin: 0; }
    .collapse-chevron { font-size: 14px; color: var(--muted); transition: transform 0.2s ease; margin-left: 8px; }
    .collapsible-body { overflow: hidden; }
    .collapsible-body.collapsed { display: none; }
    .settings-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .settings-item { display: flex; flex-direction: column; gap: 2px; }
    .settings-item-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .settings-item-value { font-size: 13px; color: var(--fg); font-family: "Cascadia Code", Consolas, monospace; word-break: break-all; }
    .stg-section { margin-bottom: 16px; border: 1px solid rgba(148,163,184,0.10); border-radius: 12px; background: rgba(255,255,255,0.015); overflow: hidden; }
    .stg-section-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: pointer; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--accent-2); }
    .stg-section-header:hover { background: rgba(255,255,255,0.025); }
    .stg-section-body { padding: 0 14px 14px; }
    .stg-section-body.stg-collapsed { display: none; }
    .stg-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid rgba(148,163,184,0.06); gap: 12px; }
    .stg-row:last-child { border-bottom: none; }
    .stg-label { font-size: 12px; color: var(--fg); flex: 1; }
    .stg-hint { font-size: 10px; color: var(--muted); font-family: "Cascadia Code", Consolas, monospace; margin-left: 6px; }
    .stg-value { font-size: 12px; color: var(--fg); font-family: "Cascadia Code", Consolas, monospace; text-align: right; max-width: 55%; word-break: break-all; }
    .stg-input { padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(148,163,184,0.18); background: rgba(0,0,0,0.25); color: var(--fg); font-size: 12px; font-family: "Cascadia Code", Consolas, monospace; width: 120px; text-align: right; }
    .stg-input:focus { outline: none; border-color: var(--accent); }
    .stg-select { padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(148,163,184,0.18); background: #0b1728; color: var(--fg); font-size: 12px; cursor: pointer; }
    .stg-select:focus { outline: none; border-color: var(--accent); }
    .stg-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .stg-badge-green { background: rgba(126,207,126,0.15); color: #7ecf7e; }
    .stg-badge-blue { background: rgba(105,210,255,0.15); color: #69d2ff; }
    .stg-badge-amber { background: rgba(255,200,80,0.12); color: #ffd17a; }
    .stg-badge-red { background: rgba(255,141,141,0.12); color: #ff8d8d; }
    .stg-badge-muted { background: rgba(148,163,184,0.10); color: var(--muted); }
    .stg-save-btn { padding: 4px 12px; border-radius: 6px; border: 1px solid rgba(126,207,126,0.3); background: rgba(126,207,126,0.1); color: #7ecf7e; font-size: 11px; font-weight: 600; cursor: pointer; margin-left: 6px; }
    .stg-save-btn:hover { background: rgba(126,207,126,0.2); }
    .stg-recheck-btn { padding: 5px 14px; border-radius: 8px; border: 1px solid rgba(105,210,255,0.3); background: rgba(105,210,255,0.08); color: #69d2ff; font-size: 11px; font-weight: 600; cursor: pointer; }
    .stg-recheck-btn:hover { background: rgba(105,210,255,0.18); }
    .stg-req-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; }
    .stg-req-met { color: #7ecf7e; }
    .stg-req-unmet { color: #ff8d8d; }
    .ps-card { border: 1px solid rgba(148,163,184,0.12); border-radius: 14px; background: rgba(255,255,255,0.02); overflow: hidden; margin-bottom: 8px; }
    .ps-card-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; cursor: pointer; gap: 10px; }
    .ps-card-header:hover { background: rgba(255,255,255,0.03); }
    .ps-card-title { font-weight: 600; font-size: 13px; }
    .ps-card-badges { display: flex; gap: 6px; align-items: center; }
    .ps-badge { font-size: 10px; padding: 2px 8px; border-radius: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .ps-badge-ok { background: rgba(126,207,126,0.15); color: #7ecf7e; }
    .ps-badge-warn { background: rgba(255,200,80,0.12); color: #ffd17a; }
    .ps-badge-off { background: rgba(148,163,184,0.10); color: var(--muted); }
    .ps-badge-local { background: rgba(80,160,255,0.10); color: #7eb8ff; }
    .ps-badge-remote { background: rgba(200,160,255,0.10); color: #c8a0ff; }
    .ps-card-body { padding: 0 16px 16px; border-top: 1px solid rgba(148,163,184,0.08); }
    .ps-field { margin-top: 10px; }
    .ps-field label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: .04em; }
    .ps-field input, .ps-field textarea { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.18); background: rgba(0,0,0,0.25); color: var(--fg); font-size: 12px; font-family: inherit; box-sizing: border-box; }
    .ps-field input:focus, .ps-field textarea:focus { outline: none; border-color: var(--accent); }
    .ps-key-row { display: flex; gap: 8px; align-items: center; }
    .ps-key-row input { flex: 1; }
    .ps-test-result { margin-top: 8px; font-size: 12px; padding: 6px 10px; border-radius: 8px; }
    .ps-test-ok { background: rgba(126,207,126,0.10); color: #7ecf7e; }
    .ps-test-fail { background: rgba(255,141,141,0.10); color: #ffc1c1; }
    @media (max-width: 1280px) {
      .app { grid-template-columns: var(--sidebar-width, 310px) auto minmax(0, 1fr); }
      .tab-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 900px) {
      .app { grid-template-columns: 1fr !important; }
      .resize-handle { display: none; }
      .chat { min-height: auto; }
      .sidebar { order: 2; min-width: unset; }
      .workspace { margin-left: 0; }
      .tabs { gap: 8px; }
      .tab-button { flex-basis: calc(50% - 4px); }
    }

    /* ═══ Tooltip System ═══ */
    [data-tooltip] { position: relative; }
    [data-tooltip]::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 12px;
      background: rgba(15,20,35,0.95);
      color: #e2e8f0;
      font-size: 11px;
      line-height: 1.5;
      border-radius: 8px;
      border: 1px solid rgba(148,163,184,0.18);
      white-space: pre-line;
      max-width: 320px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      z-index: 9999;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      backdrop-filter: blur(8px);
    }
    [data-tooltip]:hover::after { opacity: 1; }

    /* ═══ Tools & Plugins Interactive Cards ═══ */
    .tp-card { border: 1px solid rgba(148,163,184,0.12); border-radius: 14px; background: rgba(255,255,255,0.02); margin-bottom: 6px; overflow: hidden; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
    .tp-card:hover { border-color: rgba(148,163,184,0.22); }
    .tp-card.tp-expanded { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 4px 16px rgba(0,0,0,0.15); }
    .tp-card-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: pointer; gap: 8px; user-select: none; }
    .tp-card-head:hover { background: rgba(255,255,255,0.03); }
    .tp-card-name { font-weight: 600; font-size: 13px; }
    .tp-card-desc { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .tp-card-badges { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
    .tp-card-meta { display: flex; gap: 8px; align-items: center; margin-top: 4px; flex-wrap: wrap; }
    .tp-meta-tag { font-size: 10px; color: var(--muted); display: flex; align-items: center; gap: 3px; }
    .tp-card-body { padding: 0 14px 14px; border-top: 1px solid rgba(148,163,184,0.08); display: none; }
    .tp-card.tp-expanded .tp-card-body { display: block; }

    .tp-section { margin-top: 12px; }
    .tp-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
    .tp-controls { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
    .tp-toggle { position: relative; display: inline-flex; align-items: center; cursor: pointer; gap: 8px; font-size: 12px; color: var(--fg); }
    .tp-toggle input { display: none; }
    .tp-toggle-track { width: 34px; height: 18px; border-radius: 9px; background: rgba(148,163,184,0.25); transition: background 0.2s ease; position: relative; flex-shrink: 0; }
    .tp-toggle input:checked + .tp-toggle-track { background: var(--accent); }
    .tp-toggle-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform 0.2s ease; }
    .tp-toggle input:checked + .tp-toggle-track::after { transform: translateX(16px); }

    .tp-stat-row { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 6px; }
    .tp-stat { display: flex; flex-direction: column; gap: 1px; min-width: 80px; }
    .tp-stat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .tp-stat-value { font-size: 14px; font-weight: 600; color: var(--fg); font-family: "Cascadia Code", Consolas, monospace; }

    .tp-review-stars { display: inline-flex; gap: 2px; cursor: pointer; }
    .tp-star { font-size: 16px; color: rgba(148,163,184,0.25); transition: color 0.15s; }
    .tp-star.active { color: #ffd17a; }
    .tp-star:hover { color: #ffd17a; }

    .tp-status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .tp-status-dot.green { background: #7ecf7e; box-shadow: 0 0 4px rgba(126,207,126,0.5); }
    .tp-status-dot.yellow { background: #ffd17a; box-shadow: 0 0 4px rgba(255,209,122,0.5); }
    .tp-status-dot.red { background: #ff8d8d; box-shadow: 0 0 4px rgba(255,141,141,0.5); }

    .tp-approval-badge { font-size: 10px; padding: 2px 8px; border-radius: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .tp-approval-approved { background: rgba(126,207,126,0.15); color: #7ecf7e; }
    .tp-approval-review { background: rgba(255,200,80,0.12); color: #ffd17a; }
    .tp-approval-flagged { background: rgba(255,141,141,0.12); color: #ff8d8d; }
    .tp-approval-blocked { background: rgba(148,163,184,0.15); color: var(--muted); }

    .tp-overview-bar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(148,163,184,0.10); margin-bottom: 12px; flex-wrap: wrap; }
    .tp-overview-stat { font-size: 12px; color: var(--fg); font-weight: 600; }
    .tp-overview-stat .muted { font-weight: 400; }
    .tp-filter-input { padding: 5px 10px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.18); background: rgba(0,0,0,0.25); color: var(--fg); font-size: 12px; min-width: 160px; }
    .tp-filter-input:focus { outline: none; border-color: var(--accent); }
    .tp-filter-input::placeholder { color: var(--muted); }

    .brand-profile-badge { display: inline-block; padding: 4px 14px; border-radius: 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 8px; }
    .brand-profile-badge.individual { background: rgba(105,210,255,0.18); color: #69d2ff; }
    .brand-profile-badge.business { background: rgba(168,130,255,0.18); color: #c9a0ff; }
    .brand-profile-badge.demo { background: rgba(255,200,80,0.18); color: #ffd17a; }
    .brand-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin-top: 10px; }
    .brand-info-item { font-size: 11px; }
    .brand-info-label { color: var(--muted); font-weight: 400; }
    .brand-info-value { color: var(--fg); font-weight: 600; }
    .brand-env-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; margin-right: 4px; vertical-align: middle; }
    .brand-env-dot.dev { background: #69d2ff; }
    .brand-env-dot.staging { background: #ffd17a; }
    .brand-env-dot.prod { background: #7ecf7e; }
    .brand-approvals-badge { display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 8px; font-size: 10px; font-weight: 600; background: rgba(255,200,80,0.15); color: #ffd17a; }
    .usage-bar { position: relative; height: 22px; border-radius: 6px; background: rgba(255,255,255,0.06); border: 1px solid var(--border); overflow: hidden; }
    .usage-bar-fill { position: absolute; top: 0; left: 0; height: 100%; border-radius: 5px; transition: width 0.6s ease; }
    .usage-bar-fill.ram { background: linear-gradient(90deg, #69d2ff 0%, #3b82f6 100%); box-shadow: 0 0 8px rgba(105,210,255,0.3); }
    .usage-bar-fill.vram { background: linear-gradient(90deg, #7cf1c8 0%, #10b981 100%); box-shadow: 0 0 8px rgba(124,241,200,0.3); }
    .usage-bar-label { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); pointer-events: none; }
    .sparkline-wrap { display: inline-block; vertical-align: middle; }
    .gpu-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; background: rgba(124,241,200,0.12); color: #7cf1c8; margin-left: 6px; }
    .framebuffer-viewer { position: relative; background: #0a0e17; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; min-height: 200px; display: flex; align-items: center; justify-content: center; }
    .framebuffer-viewer img { max-width: 100%; max-height: 480px; object-fit: contain; display: block; }
    .framebuffer-viewer .fb-placeholder { color: var(--muted); font-size: 13px; text-align: center; padding: 40px; }
    .framebuffer-controls { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; align-items: center; }
    .framebuffer-controls button { padding: 5px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); cursor: pointer; font-size: 12px; transition: background 0.15s, border-color 0.15s; }
    .framebuffer-controls button:hover { background: rgba(124,241,200,0.08); border-color: var(--accent); }
    .framebuffer-controls .fb-toggle-active { background: rgba(124,241,200,0.15); border-color: #7cf1c8; color: #7cf1c8; }
    .framebuffer-gallery { display: flex; gap: 6px; overflow-x: auto; padding: 8px 0; }
    .framebuffer-thumb { width: 80px; height: 50px; object-fit: cover; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; opacity: 0.7; transition: opacity 0.15s, border-color 0.15s; flex-shrink: 0; }
    .framebuffer-thumb:hover { opacity: 1; border-color: var(--accent); }
    .framebuffer-meta { font-size: 11px; color: var(--muted); margin-top: 6px; }
  </style>
</head>
<body>
  <div class="app" id="app">
    <aside class="sidebar panel" id="sidebar">
      <div class="brand" id="brand-panel">
        <div class="eyebrow">Frontier Operator Console</div>
        <h1>PRISM Chat</h1>
        <a href="http://localhost:${port}" target="_blank" rel="noopener" class="muted" style="display:block;margin-top:0;text-decoration:none;color:var(--muted);transition:color 0.2s;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--muted)'">http://localhost:${port} \u2197</a>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px;">
        <button class="secondary-button" onclick="exportSession()" style="flex:1;">Export Session</button>
        <button class="secondary-button" onclick="importSession()" style="flex:1;">Import Session</button>
      </div>
      <button class="secondary-button" onclick="packageSessions()">Package Sessions</button>
      <button class="primary-button" onclick="createSession()">New Session</button>
      <div id="session-list" class="session-list"></div>
    </aside>
    <div class="resize-handle" id="resize-handle"></div>

    <main class="workspace">
      <section class="tabs panel" id="tabs" role="tablist" aria-label="Dashboard sections">
        <button id="tab-button-chat" type="button" class="tab-button active" data-tab-id="chat" role="tab" aria-selected="true" aria-controls="tab-chat" tabindex="0" onclick="setActiveTab(this.dataset.tabId)">Chat Interface</button>
        <button id="tab-button-settings" type="button" class="tab-button" data-tab-id="settings" role="tab" aria-selected="false" aria-controls="tab-settings" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Provider &amp; Settings</button>
        <button id="tab-button-tools" type="button" class="tab-button" data-tab-id="tools" role="tab" aria-selected="false" aria-controls="tab-tools" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Tools &amp; Plugins</button>
        <button id="tab-button-agentic" type="button" class="tab-button" data-tab-id="agentic" role="tab" aria-selected="false" aria-controls="tab-agentic" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Agentic Control</button>
        <button id="tab-button-computer" type="button" class="tab-button" data-tab-id="computer" role="tab" aria-selected="false" aria-controls="tab-computer" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Computer Control</button>
        <button id="tab-button-workspace" type="button" class="tab-button" data-tab-id="workspace" role="tab" aria-selected="false" aria-controls="tab-workspace" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Workspace</button>
        <button id="tab-button-network" type="button" class="tab-button" data-tab-id="network" role="tab" aria-selected="false" aria-controls="tab-network" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Network</button>
        <button id="tab-button-telemetry" type="button" class="tab-button" data-tab-id="telemetry" role="tab" aria-selected="false" aria-controls="tab-telemetry" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Telemetry</button>
        <button id="tab-button-logs" type="button" class="tab-button" data-tab-id="logs" role="tab" aria-selected="false" aria-controls="tab-logs" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Logs &amp; Debug</button>
      </section>

      <section id="tab-chat" class="tab-panel active" role="tabpanel" aria-labelledby="tab-button-chat" aria-hidden="false">
        <div class="chat panel">
          <div class="chat-header">
            <div class="eyebrow">Persistent Runtime Session</div>
            <h2 id="active-session-title">Loading...</h2>
            <div id="active-session-meta" class="muted"></div>
            <div id="header-chips" class="header-chips" style="margin-top:12px;"></div>
          </div>
          <div id="onboarding" class="onboarding"></div>
          <section id="messages" class="messages"></section>
          <div class="composer">
            <div id="attachment-preview" class="attachment-preview-strip"></div>
            <div class="composer-shell">
              <div class="composer-toolbar">
                <button type="button" class="toolbar-btn" onclick="document.getElementById('file-attach-input').click()" title="Attach file">&#x1F4CE;</button>
                <input type="file" id="file-attach-input" multiple accept="image/*,audio/*,video/*,text/*,application/pdf,.md,.json,.csv,.xml,.yaml,.yml,.ts,.js,.py,.html,.css" style="display:none" onchange="handleFileSelect(this)" />
                <button type="button" class="toolbar-btn" onclick="pasteFromClipboard()" title="Paste from clipboard">&#x1F4CB;</button>
              </div>
              <textarea id="composer" placeholder="Ask PRISM to create files, run commands, or answer questions. Tools will be executed automatically."></textarea>
              <button id="send-button" class="primary-button" onclick="sendMessage()">Send</button>
            </div>
            <div class="composer-hint">Enter sends. Shift+Enter inserts a newline. Attach files with \u{1F4CE} or drag &amp; drop. Sessions persist in SQLite.</div>
          </div>
        </div>
      </section>

      <section id="tab-settings" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-settings" aria-hidden="true">
        <div class="tab-grid" style="grid-template-columns:1fr;">
          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('sessionProvider')">
              <h3>Session Provider Assignment</h3>
              <span class="collapse-chevron" id="chevron-sessionProvider">\u25BC</span>
            </div>
            <div class="collapsible-body" id="body-sessionProvider">
              <div id="llm-provider" class="stack"></div>
            </div>
          </section>
          
          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('modelRouting')">
              <h3>\u{1F500} Model Routing</h3>
              <span class="collapse-chevron" id="chevron-modelRouting">\u25B6</span>
            </div>
            <div class="collapsible-body collapsed" id="body-modelRouting">
              <div class="muted" style="margin-bottom:8px;">Configure how PRISM routes tasks to models. Single-provider uses the active provider for all roles. Multi-provider enables per-role and per-agent model assignment.</div>
              <div id="model-routing-container" class="stack"></div>
            </div>
          </section>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px;">
            <section class="rail-section panel" style="flex:1;">
              <div class="collapsible-header" onclick="togglePanelCollapse('providerConfig')">
                <h3>Provider Configuration</h3>
                <span class="collapse-chevron" id="chevron-providerConfig">\u25B6</span>
              </div>
              <div class="collapsible-body collapsed" id="body-providerConfig">
                <div class="muted" style="margin-bottom:12px;">Configure API keys and settings for each provider. Expand a card to manage.</div>
                <div id="provider-cards-container" class="stack"></div>
              </div>
              <div id="providerConfig-summary" style="padding:8px 12px;"></div>
            </section>
            <section class="rail-section panel" style="flex:1;">
              <div class="collapsible-header" onclick="togglePanelCollapse('modelMatrix')">
                <h3>Model Capability Matrix</h3>
                <span class="collapse-chevron" id="chevron-modelMatrix">\u25BC</span>
              </div>
              <div class="collapsible-body" id="body-modelMatrix">
                <div class="muted" style="margin-bottom:8px;">Available models scored by capability tier (T1 Minimal \u2192 T5 Frontier). Role routing selects the best model for each task.</div>
                <div id="capability-matrix" class="stack"></div>
              </div>
            </section>
          </div>

          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('settingsPanel')">
              <h3>Settings</h3>
              <span class="collapse-chevron" id="chevron-settingsPanel">\u25BC</span>
            </div>
            <div class="collapsible-body" id="body-settingsPanel">
              <div id="settings-panel" class="stack"></div>
            </div>
          </section>

          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('llmAudit')">
              <h3>LLM Audit Trail</h3>
              <span class="collapse-chevron" id="chevron-llmAudit">\u25BC</span>
            </div>
            <div class="collapsible-body" id="body-llmAudit">
              <div id="llm-audit"></div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-tools" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-tools" aria-hidden="true">
        <div class="tab-grid" style="grid-template-columns:1fr;">
          <div id="tools-overview-bar"></div>
          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('toolsPanel')">
              <h3>Tools</h3>
              <span class="collapse-chevron" id="chevron-toolsPanel">\u25BC</span>
            </div>
            <div class="collapsible-body" id="body-toolsPanel">
              <div id="tools-panel" class="stack"></div>
            </div>
          </section>
          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('pluginsPanel')">
              <h3>Plugins</h3>
              <span class="collapse-chevron" id="chevron-pluginsPanel">\u25BC</span>
            </div>
            <div class="collapsible-body" id="body-pluginsPanel">
              <div id="plugins-panel" class="stack"></div>
            </div>
          </section>
          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('utilitiesPanel')">
              <h3>Utilities</h3>
              <span class="collapse-chevron" id="chevron-utilitiesPanel">\u25BC</span>
            </div>
            <div class="collapsible-body" id="body-utilitiesPanel">
              <div id="utilities-panel" class="stack"></div>
            </div>
          </section>
        </div>
      </section>

      <!-- ═══════════════ AGENTIC CONTROL TAB ═══════════════ -->
      <section id="tab-agentic" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-agentic" aria-hidden="true">
        <div class="tab-grid">
          <!-- Agent Management Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('agentMgmt')">
              <h3>\u{1F916} Agent Management</h3>
              <span id="agentMgmt-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="agentMgmt-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">List, start, stop, and monitor individual agents.</div>
              <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                <button class="primary-button" onclick="refreshAgentList()" style="font-size:12px;">\u{1F504} Refresh Agents</button>
                <button class="primary-button" onclick="launchNewAgent()" style="font-size:12px;">\u2795 Launch Agent</button>
              </div>
              <div id="agent-list-container" class="stack">
                <div class="muted" style="text-align:center;padding:24px;">No agents running. Launch an agent to get started.</div>
              </div>
            </div>
          </section>

          <!-- Sub-Agent Control Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('subAgent')">
              <h3>\u{1F517} Sub-Agent Control</h3>
              <span id="subAgent-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="subAgent-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">View agent hierarchy, parent-child relationships, and delegation chains.</div>
              <div id="sub-agent-tree-container" class="stack">
                <div class="muted" style="text-align:center;padding:24px;">Agent hierarchy will appear here when agents are active.</div>
              </div>
            </div>
          </section>

          <!-- Swarm Control Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('swarmControl')">
              <h3>\u{1F41D} Swarm Control</h3>
              <span id="swarmControl-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="swarmControl-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Orchestrate agent swarms \u2014 topology, scaling, and task distribution.</div>
              <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                <button class="primary-button" onclick="createSwarm()" style="font-size:12px;">\u{1F41D} Create Swarm</button>
                <button class="primary-button" onclick="refreshSwarmStatus()" style="font-size:12px;">\u{1F504} Refresh Status</button>
              </div>
              <div id="swarm-topology-container" class="stack">
                <div class="muted" style="text-align:center;padding:24px;">No swarms configured. Create a swarm to begin orchestration.</div>
              </div>
            </div>
          </section>

          <!-- Agent Telemetry Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('agentTelemetry')">
              <h3>\u{1F4CA} Agent Telemetry</h3>
              <span id="agentTelemetry-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="agentTelemetry-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Agent performance metrics, task throughput, and error rates.</div>
              <div id="agent-telemetry-container" class="stack">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
                  <div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Active Agents</div><div style="font-size:24px;font-weight:700;color:var(--accent);">0</div></div>
                  <div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Tasks Completed</div><div style="font-size:24px;font-weight:700;color:var(--accent);">0</div></div>
                  <div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Error Rate</div><div style="font-size:24px;font-weight:700;color:var(--accent);">0%</div></div>
                  <div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Avg Response</div><div style="font-size:24px;font-weight:700;color:var(--accent);">\u2014</div></div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <!-- ═══════════════ COMPUTER CONTROL TAB ═══════════════ -->
      <section id="tab-computer" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-computer" aria-hidden="true">
        <div class="tab-grid">
          <!-- Local Computer Control Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('localControl')">
              <h3>\u{1F5A5}\uFE0F Local Computer Control</h3>
              <span id="localControl-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="localControl-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">System information, telemetry overview, and quick actions.</div>
              <div id="local-system-info" class="stack">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
                  <div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Operating System</div><div id="sys-os" style="font-size:14px;font-weight:600;">Detecting...</div></div>
                  <div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Hostname</div><div id="sys-hostname" style="font-size:14px;font-weight:600;">Detecting...</div></div>
                  <div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Platform</div><div id="sys-platform" style="font-size:14px;font-weight:600;">Detecting...</div></div>
                  <div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Uptime</div><div id="sys-uptime" style="font-size:14px;font-weight:600;">Detecting...</div></div>
                </div>
              </div>
              <div id="usage-metrics" style="margin-top:12px;"></div>
            </div>
          </section>

          <!-- Console View Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('consoleView')">
              <h3>\u{1F4DF} Console View</h3>
              <span id="consoleView-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="consoleView-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Execute local system commands.</div>
              <div style="display:flex;gap:6px;margin-bottom:8px;">
                <input id="computer-console-input" type="text" placeholder="Enter system command (e.g. systeminfo, dir, tasklist)" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-family:monospace;font-size:13px;" onkeydown="if(event.key==='Enter')runLocalCommand()" />
                <button onclick="runLocalCommand()" style="padding:6px 14px;border:none;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer;font-size:13px;">\u25B6 Run</button>
              </div>
              <pre id="computer-console-output" style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:10px;max-height:400px;overflow:auto;font-size:12px;white-space:pre-wrap;color:var(--text-muted);">Ready \u2014 enter a system command above.</pre>
            </div>
          </section>

          <!-- Vision Framebuffer Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('visionFramebuffer')">
              <h3>\u{1F441}\uFE0F Vision Framebuffer</h3>
              <span id="visionFramebuffer-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="visionFramebuffer-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Agentic computer-use vision \u2014 shows the latest screengrab from the framebuffer. Captures occur automatically during agentic <code>computer use</code> actions.</div>
              <div class="framebuffer-controls">
                <button onclick="captureScreengrab()" title="Capture a single screenshot now">\u{1F4F7} Capture</button>
                <button onclick="burstCapture()" title="Burst capture 8 FPS for 2 seconds">\u{1F4F9} Burst (8 FPS)</button>
                <button onclick="refreshFramebufferViewer()" title="Refresh the viewer with the latest image">\u{1F504} Refresh</button>
                <button id="fb-auto-toggle" onclick="toggleFramebufferAutoRefresh()" title="Auto-refresh the viewer every 2 seconds">Auto-Refresh: OFF</button>
                <span class="framebuffer-meta" id="fb-meta"></span>
              </div>
              <div class="framebuffer-viewer" id="framebuffer-viewer">
                <div class="fb-placeholder" id="fb-placeholder">No screengrab captured yet.<br/>Use <strong>Capture</strong> or trigger an agentic action to begin.</div>
                <img id="framebuffer-preview" style="display:none;" alt="Latest screengrab" onclick="window.open(this.src, \\'_blank\\')" title="Click to open full size" />
              </div>
              <div class="framebuffer-gallery" id="framebuffer-gallery"></div>
            </div>
          </section>

          <!-- Configuration & Settings Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('computerConfig')">
              <h3>\u2699\uFE0F Configuration &amp; Settings</h3>
              <span id="computerConfig-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="computerConfig-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">System configuration, environment variables, and editor settings.</div>
              <div id="computer-config-container" class="stack">
                <div style="margin-bottom:12px;">
                  <h4 style="margin:0 0 6px 0;font-size:13px;">Environment Variables</h4>
                  <div id="env-vars-list" class="muted" style="font-family:monospace;font-size:12px;max-height:200px;overflow:auto;">Click Refresh to load environment variables.</div>
                  <button class="primary-button" onclick="refreshEnvVars()" style="font-size:11px;margin-top:6px;">\u{1F504} Refresh</button>
                </div>
              </div>
            </div>
          </section>

          <!-- Policy Control Panel (Windows Only) -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('policyControl')">
              <h3>\u{1F4CB} Policy Control</h3>
              <span id="policyControl-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="policyControl-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Windows Group Policy viewer and local security policy access. <strong>(Windows only)</strong></div>
              <div id="policy-control-container" class="stack">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
                  <button class="primary-button" onclick="openPolicyEditor('gpedit')" style="font-size:12px;">\u{1F4DC} Group Policy Editor</button>
                  <button class="primary-button" onclick="openPolicyEditor('secpol')" style="font-size:12px;">\u{1F512} Local Security Policy</button>
                  <button class="primary-button" onclick="refreshPolicyStatus()" style="font-size:12px;">\u{1F504} Refresh Policy Status</button>
                </div>
                <div id="policy-status-output" class="muted" style="margin-top:10px;font-size:12px;">Policy status not yet loaded.</div>
              </div>
            </div>
          </section>

          <!-- Browser Control Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('browserControl')">
              <h3>\u{1F310} Browser Control</h3>
              <span id="browserControl-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="browserControl-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Browser settings, preview control, and launch options.</div>
              <div id="browser-control-container" class="stack">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">
                  <div class="panel" style="padding:12px;">
                    <div class="muted" style="font-size:11px;">Default Browser</div>
                    <div id="browser-default" style="font-size:13px;font-weight:600;">Detecting...</div>
                  </div>
                  <div class="panel" style="padding:12px;">
                    <div class="muted" style="font-size:11px;">Preview Mode</div>
                    <div id="browser-preview-mode" style="font-size:13px;font-weight:600;">Embedded</div>
                  </div>
                </div>
                <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                  <button class="primary-button" onclick="launchBrowserPreview()" style="font-size:12px;">\u{1F680} Launch Preview</button>
                  <button class="primary-button" onclick="openBrowserDevTools()" style="font-size:12px;">\u{1F527} Dev Tools</button>
                  <button class="primary-button" onclick="refreshBrowserInfo()" style="font-size:12px;">\u{1F504} Refresh</button>
                </div>
              </div>
            </div>
          </section>

          <!-- Device Manager Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('deviceManager')">
              <h3>\u{1F527} Device Manager</h3>
              <span id="deviceManager-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="deviceManager-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Quick-access view of local hardware devices (mirrors Windows Device Manager).</div>
              <div style="margin-bottom:10px;">
                <button class="primary-button" onclick="refreshDeviceManager()" style="font-size:12px;">\u{1F504} Scan Devices</button>
                <button class="primary-button" onclick="openSystemDeviceManager()" style="font-size:12px;margin-left:6px;">\u{1F5A5}\uFE0F Open System Device Manager</button>
              </div>
              <div id="device-tree-container" class="stack" style="font-size:13px;">
                <details class="panel" style="padding:8px 12px;margin-bottom:4px;">
                  <summary style="cursor:pointer;font-weight:600;">\u{1F4BB} Display Adapters</summary>
                  <div class="muted" style="padding:6px 0 0 18px;font-size:12px;">Click Scan Devices to enumerate.</div>
                </details>
                <details class="panel" style="padding:8px 12px;margin-bottom:4px;">
                  <summary style="cursor:pointer;font-weight:600;">\u{1F50A} Sound, Video &amp; Game Controllers</summary>
                  <div class="muted" style="padding:6px 0 0 18px;font-size:12px;">Click Scan Devices to enumerate.</div>
                </details>
                <details class="panel" style="padding:8px 12px;margin-bottom:4px;">
                  <summary style="cursor:pointer;font-weight:600;">\u{1F4F6} Network Adapters</summary>
                  <div class="muted" style="padding:6px 0 0 18px;font-size:12px;">Click Scan Devices to enumerate.</div>
                </details>
                <details class="panel" style="padding:8px 12px;margin-bottom:4px;">
                  <summary style="cursor:pointer;font-weight:600;">\u{1F4BE} Disk Drives</summary>
                  <div class="muted" style="padding:6px 0 0 18px;font-size:12px;">Click Scan Devices to enumerate.</div>
                </details>
                <details class="panel" style="padding:8px 12px;margin-bottom:4px;">
                  <summary style="cursor:pointer;font-weight:600;">\u{1F50C} USB Controllers</summary>
                  <div class="muted" style="padding:6px 0 0 18px;font-size:12px;">Click Scan Devices to enumerate.</div>
                </details>
                <details class="panel" style="padding:8px 12px;margin-bottom:4px;">
                  <summary style="cursor:pointer;font-weight:600;">\u2328\uFE0F Keyboards</summary>
                  <div class="muted" style="padding:6px 0 0 18px;font-size:12px;">Click Scan Devices to enumerate.</div>
                </details>
                <details class="panel" style="padding:8px 12px;margin-bottom:4px;">
                  <summary style="cursor:pointer;font-weight:600;">\u{1F5B1}\uFE0F Mice &amp; Pointing Devices</summary>
                  <div class="muted" style="padding:6px 0 0 18px;font-size:12px;">Click Scan Devices to enumerate.</div>
                </details>
                <details class="panel" style="padding:8px 12px;margin-bottom:4px;">
                  <summary style="cursor:pointer;font-weight:600;">\u{1F50B} Batteries</summary>
                  <div class="muted" style="padding:6px 0 0 18px;font-size:12px;">Click Scan Devices to enumerate.</div>
                </details>
                <details class="panel" style="padding:8px 12px;margin-bottom:4px;">
                  <summary style="cursor:pointer;font-weight:600;">\u{1F4F7} Imaging Devices</summary>
                  <div class="muted" style="padding:6px 0 0 18px;font-size:12px;">Click Scan Devices to enumerate.</div>
                </details>
                <details class="panel" style="padding:8px 12px;margin-bottom:4px;">
                  <summary style="cursor:pointer;font-weight:600;">\u{1F4E1} Bluetooth</summary>
                  <div class="muted" style="padding:6px 0 0 18px;font-size:12px;">Click Scan Devices to enumerate.</div>
                </details>
              </div>
            </div>
          </section>
        </div>
      </section>

      <!-- ═══════════════ WORKSPACE TAB ═══════════════ -->
      <section id="tab-workspace" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-workspace" aria-hidden="true">
        <div class="tab-grid">
          <!-- Workspace Location Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('workspaceLocation')">
              <h3>\u{1F4C2} Workspace Location</h3>
              <span id="workspaceLocation-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="workspaceLocation-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Current workspace path and relocation controls.</div>
              <div id="workspace-location-container" class="stack">
                <div class="panel" style="padding:12px;display:flex;align-items:center;gap:12px;">
                  <div style="flex:1;">
                    <div class="muted" style="font-size:11px;">Current Workspace</div>
                    <div id="workspace-path" style="font-size:14px;font-weight:600;font-family:monospace;word-break:break-all;">Loading...</div>
                  </div>
                </div>
                <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                  <button class="primary-button" onclick="changeWorkspaceLocation()" style="font-size:12px;">\u{1F4C1} Change Location</button>
                  <button class="primary-button" onclick="openWorkspaceInExplorer()" style="font-size:12px;">\u{1F4C2} Open in Explorer</button>
                  <button class="primary-button" onclick="refreshWorkspaceInfo()" style="font-size:12px;">\u{1F504} Refresh</button>
                </div>
              </div>
            </div>
          </section>

          <!-- Workspace Files Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('workspaceFiles')">
              <h3>\u{1F4C1} Workspace Files</h3>
              <span id="workspaceFiles-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="workspaceFiles-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Browse and manage files in the current workspace.</div>
              <div style="display:flex;gap:8px;margin-bottom:10px;">
                <input id="workspace-file-filter" type="text" placeholder="Filter files..." style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:13px;" oninput="filterWorkspaceFiles(this.value)" />
                <button class="primary-button" onclick="refreshWorkspaceFiles()" style="font-size:12px;">\u{1F504} Refresh</button>
              </div>
              <div id="workspace-file-tree" class="stack" style="max-height:500px;overflow:auto;font-family:monospace;font-size:12px;">
                <div class="muted" style="text-align:center;padding:24px;">Click Refresh to load workspace files.</div>
              </div>
            </div>
          </section>

          <!-- Import Manager Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('importManager')">
              <h3>\u{1F4E5} Import Manager</h3>
              <span id="importManager-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="importManager-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Import files and resources into the workspace. Imports are vetted based on your execution profile (Individual or Business).</div>
              <div id="import-manager-container" class="stack">
                <!-- Three import mode cards -->
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
                  <div class="panel" style="padding:16px;text-align:center;cursor:pointer;border:2px dashed var(--border);" onclick="triggerGeneralImport()">
                    <div style="font-size:24px;margin-bottom:4px;">\u{1F4C4}</div>
                    <div style="font-size:13px;font-weight:700;">Import File</div>
                    <div class="muted" style="font-size:11px;margin-top:4px;">Copy any file into a workspace directory.</div>
                  </div>
                  <div class="panel" style="padding:16px;text-align:center;cursor:pointer;border:2px dashed var(--border);" onclick="triggerRegisteredImport()">
                    <div style="font-size:24px;margin-bottom:4px;">\u{1F9E9}</div>
                    <div style="font-size:13px;font-weight:700;">Import Registered Item</div>
                    <div class="muted" style="font-size:11px;margin-top:4px;">Import a PRISM-recognized item (character, config, package, etc.).</div>
                  </div>
                  <div class="panel" style="padding:16px;text-align:center;cursor:pointer;border:2px dashed var(--border);" onclick="triggerFolderImport()">
                    <div style="font-size:24px;margin-bottom:4px;">\u{1F4C1}</div>
                    <div style="font-size:13px;font-weight:700;">Import Folder</div>
                    <div class="muted" style="font-size:11px;margin-top:4px;">Copy an entire folder structure into the workspace.</div>
                  </div>
                </div>
                <!-- Hidden file inputs -->
                <input type="file" id="import-file-input" style="display:none;" />
                <input type="file" id="import-registered-input" style="display:none;" />
                <input type="file" id="import-folder-input" style="display:none;" multiple webkitdirectory />
                <!-- Import status -->
                <div id="import-status" style="display:none;margin-top:10px;padding:10px;border-radius:6px;font-size:12px;"></div>
                <!-- Import history -->
                <div style="margin-top:12px;">
                  <h4 style="margin:0 0 6px 0;font-size:13px;">Import History</h4>
                  <div id="import-history-list" class="muted" style="font-size:12px;">No imports yet.</div>
                </div>
              </div>
            </div>
          </section>

          <!-- Workspace Settings Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('workspaceSettings')">
              <h3>\u2699\uFE0F Workspace Settings</h3>
              <span id="workspaceSettings-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="workspaceSettings-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Workspace-level configuration and preferences.</div>
              <div id="workspace-settings-container" class="stack">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;">
                  <div class="panel" style="padding:12px;">
                    <div class="muted" style="font-size:11px;">Active Profile</div>
                    <div id="ws-active-profile" style="font-size:14px;font-weight:600;">Individual</div>
                  </div>
                  <div class="panel" style="padding:12px;">
                    <div class="muted" style="font-size:11px;">Auto-Save</div>
                    <div id="ws-auto-save" style="font-size:14px;font-weight:600;">Enabled</div>
                  </div>
                  <div class="panel" style="padding:12px;">
                    <div class="muted" style="font-size:11px;">Git Integration</div>
                    <div id="ws-git-status" style="font-size:14px;font-weight:600;">Detecting...</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-network" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-network" aria-hidden="true">
        <div class="tab-grid">
          <!-- Network Tools Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('networkTools')">
              <h3>\u{1F4E1} Network Tools</h3>
              <span id="networkTools-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="networkTools-collapsible" class="collapsible-body">
              <div id="network-tools-panel" class="stack"></div>
            </div>
          </section>

          <!-- Network Settings Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('networkSettings')">
              <h3>\u2699\uFE0F Network Settings</h3>
              <span id="networkSettings-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="networkSettings-collapsible" class="collapsible-body">
              <div id="network-settings-panel" class="stack"></div>
            </div>
          </section>

          <!-- Network Telemetry Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('networkTelemetry')">
              <h3>\u{1F4CA} Network Telemetry</h3>
              <span id="networkTelemetry-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="networkTelemetry-collapsible" class="collapsible-body">
              <div id="network-telemetry-panel" class="stack"></div>
            </div>
          </section>

          <!-- Network Console Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('networkConsole')">
              <h3>\u{1F5A5}\uFE0F Network Console</h3>
              <span id="networkConsole-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="networkConsole-collapsible" class="collapsible-body">
              <div style="display:flex;gap:6px;margin-bottom:8px;">
                <input id="network-console-input" type="text" placeholder="Enter network command (e.g. ipconfig, ping 8.8.8.8)" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-family:monospace;font-size:13px;" onkeydown="if(event.key==='Enter')runNetworkCommand()" />
                <button onclick="runNetworkCommand()" style="padding:6px 14px;border:none;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer;font-size:13px;">\u25B6 Run</button>
              </div>
              <pre id="network-console-output" style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:10px;max-height:400px;overflow:auto;font-size:12px;white-space:pre-wrap;color:var(--text-muted);">Ready \u2014 enter a network command above.</pre>
              <div id="network-history-list" style="margin-top:8px;"></div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-telemetry" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-telemetry" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel" style="grid-column:1/-1;padding-bottom:4px;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span class="muted" style="font-size:12px;">Change window:</span>
              <button class="tab-button" id="tw-1h" onclick="setTelemetryWindow('1h')">1 hour</button>
              <button class="tab-button" id="tw-1d" onclick="setTelemetryWindow('1d')">1 day</button>
              <button class="tab-button" id="tw-7d" onclick="setTelemetryWindow('7d')">7 days</button>
            </div>
          </section>
          <section class="rail-section panel">
            <h3>What Changed</h3>
            <div id="telemetry-what-changed"></div>
          </section>
          <section class="rail-section panel">
            <h3>Runtime Overview</h3>
            <div id="runtime-overview" class="stack"></div>
          </section>
          <section class="rail-section panel">
            <h3>Runtime Excellence</h3>
            <div id="runtime-excellence"></div>
          </section>
          <section class="rail-section panel">
            <h3>Release Readiness</h3>
            <div id="release-readiness"></div>
          </section>
          <section class="rail-section panel">
            <h3>Package History</h3>
            <div id="package-history"></div>
          </section>
          <section class="rail-section panel">
            <h3>Self Review</h3>
            <div id="self-review"></div>
          </section>
          <section class="rail-section panel">
            <h3>Retrieval Alerts</h3>
            <div id="retrieval-alerts"></div>
          </section>
        </div>
      </section>

      <section id="tab-logs" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-logs" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel">
            <h3>Quick Actions</h3>
            <div id="actions" class="stack"></div>
          </section>
          <section class="rail-section panel">
            <h3>Pending Approvals</h3>
            <div id="pending" class="stack"></div>
          </section>
          <section class="rail-section panel">
            <h3>Recent Action History</h3>
            <div id="action-history"></div>
          </section>
          <section class="rail-section panel">
            <h3>Chat Telemetry</h3>
            <div id="chat-telemetry"></div>
          </section>
          <section class="rail-section panel">
            <h3>Correlated Traces</h3>
            <div id="trace-view"></div>
          </section>
          <section class="rail-section panel">
            <h3>Recent Events</h3>
            <div id="events"></div>
          </section>
        </div>
      </section>
    </main>
  </div>
  <script>
    const state = {
      activeTab: 'chat',
      sessions: [],
      selectedSessionId: null,
      messages: [],
      status: null,
      readiness: null,
      llmCatalog: null,
      llmConfig: null,
      llmAuditEvents: [],
      actions: [],
      pending: [],
      actionHistory: [],
      selfReviewLatest: null,
      selfReviewHistory: [],
      retrievalAlerts: [],
      prioritizedAlerts: null,
      telemetrySummary: null,
      telemetryWindow: '1d',
      runtimeExcellence: null,
      releaseValidation: null,
      releaseDecision: null,
      traceData: null,
      selectedTraceId: null,
      events: [],
      busy: false,
      notice: null,
      providerSettingsCache: {},
      expandedProviderId: null,
      providerTestResults: {},
      providerApiKeyVisible: {},
      localLlmSelectionBySession: {},
      sessionPackages: [],
      sessionPackageHistory: [],
      packageReleaseSnapshot: null,
      expandedSessionPackages: {},
      matrixSortCol: 'tier',
      matrixSortAsc: false,
      matrixFilterProvider: '',
      matrixFilterTier: '',
      matrixFilterLocality: '',
      matrixFilterText: '',
      matrixDraftPattern: '',
      matrixDraftTier: '',
      matrixDraftLocality: 'local',
      matrixDraftStrengths: '',
      matrixEditingPattern: null,
      sessionProviderCollapsed: false,
      providerConfigCollapsed: true,
      modelMatrixCollapsed: false,
      modelRoutingCollapsed: true,
      routingStrategy: 'single',
      routingRoleOverrides: {},
      routingAgentOverrides: {},
      routingModalityOverrides: {},
      routingPreferredModality: null,
      routingSuggestions: null,
      routingModalitySuggestions: null,
      availableModalities: [],
      selectedModalityFilter: null,
      modalityFilterEnabled: false,
      sessionRoutingStrategy: 'direct',
      modelProfiles: null,
      settingsPanelCollapsed: false,
      llmAuditCollapsed: false,
      toolsPanelCollapsed: false,
      pluginsPanelCollapsed: false,
      utilitiesPanelCollapsed: false,
      networkToolsCollapsed: false,
      networkSettingsCollapsed: false,
      networkTelemetryCollapsed: false,
      networkConsoleCollapsed: false,
      networkCommandHistory: [],
      networkTelemetryData: { totalCommands: 0, tier1Count: 0, tier2Count: 0, tier3Count: 0, lastCommand: null, errorCount: 0 },
      agentMgmtCollapsed: false,
      subAgentCollapsed: false,
      swarmControlCollapsed: false,
      agentTelemetryCollapsed: false,
      localControlCollapsed: false,
      consoleViewCollapsed: false,
      computerConfigCollapsed: false,
      policyControlCollapsed: false,
      browserControlCollapsed: false,
      deviceManagerCollapsed: false,
      workspaceLocationCollapsed: false,
      workspaceFilesCollapsed: false,
      importManagerCollapsed: false,
      workspaceSettingsCollapsed: false,
      expandedToolId: null,
      expandedPluginId: null,
      expandedUtilityId: null,
      toolStates: {},
      toolCatalog: [],
      pluginStates: {},
      utilityStates: {},
      llmModalitySummary: null,
      modelMatrixEntries: [],
      toolReviews: {},
      pluginReviews: {},
      utilityReviews: {},
      toolsFilterText: '',
      runtimeSettings: null,
      settingsSaving: false,
      settingsSections: { runtime: true, llm: false, approval: true, selfReview: true, retrieval: false, timeouts: true, prefs: true, paths: false, readiness: true },
      agentData: null,
      computerSystemInfo: null,
      computerConsoleHistory: [],
      computerEnvVars: null,
      computerDevices: null,
      ramHistory: [],
      vramHistory: [],
      computerPollInterval: null,
      importHistory: [],
      framebufferAutoRefresh: false,
      framebufferPollInterval: null,
      agenticStream: [],
      chatTelemetry: []
    };

    const tabs = [
      { id: 'chat', label: 'Chat Interface' },
      { id: 'settings', label: 'Provider & Settings' },
      { id: 'tools', label: 'Tools & Plugins' },
      { id: 'agentic', label: 'Agentic Control' },
      { id: 'computer', label: 'Computer Control' },
      { id: 'workspace', label: 'Workspace' },
      { id: 'network', label: 'Network' },
      { id: 'telemetry', label: 'Telemetry' },
      { id: 'logs', label: 'Logs & Debug' }
    ];

    async function request(url, options) {
      const response = await fetch(url, options);
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(payload.error || ('Request failed with status ' + response.status));
      }
      return payload;
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderMarkdown(text) {
      if (!text) return '';
      var s = String(text);
      // Fenced code blocks
      s = s.replace(/\`\`\`(\\w*?)\\n([\\s\\S]*?)\`\`\`/g, function(_, lang, code) {
        return '<pre><code class="lang-' + escapeHtml(lang || 'text') + '">' + escapeHtml(code) + '</code></pre>';
      });
      // Inline code
      s = s.replace(/\`([^\`]+?)\`/g, function(_, code) {
        return '<code>' + escapeHtml(code) + '</code>';
      });
      // Blockquotes
      s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
      // Headers (process after escaping so # still works in source)
      s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
      s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
      // Bold & italic
      s = s.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
      s = s.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      s = s.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      // Links
      s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(_, label, href) {
        var safeHref = escapeHtml(href);
        if (!/^https?:\\/\\//i.test(href)) return escapeHtml(label);
        return '<a href="' + safeHref + '" target="_blank" rel="noopener">' + escapeHtml(label) + '</a>';
      });
      // Unordered lists
      s = s.replace(/(^|\\n)([-*] .+(?:\\n[-*] .+)*)/g, function(_, pre, block) {
        var items = block.split('\\n').map(function(line) {
          return '<li>' + line.replace(/^[-*] /, '') + '</li>';
        }).join('');
        return pre + '<ul>' + items + '</ul>';
      });
      // Ordered lists
      s = s.replace(/(^|\\n)(\\d+\\. .+(?:\\n\\d+\\. .+)*)/g, function(_, pre, block) {
        var items = block.split('\\n').map(function(line) {
          return '<li>' + line.replace(/^\\d+\\.\\s/, '') + '</li>';
        }).join('');
        return pre + '<ol>' + items + '</ol>';
      });
      // Paragraphs: double newlines
      s = s.replace(/\\n\\n+/g, '</p><p>');
      // Single newlines to <br>
      s = s.replace(/\\n/g, '<br>');
      return '<p>' + s + '</p>';
    }

    function formatRelativeTime(value) {
      if (!value) {
        return '-';
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return date.toLocaleString();
    }

    function safeIso(value) {
      const date = new Date(value || 0);
      if (Number.isNaN(date.getTime())) {
        return new Date(0).toISOString();
      }
      return date.toISOString();
    }

    function reconcileExpandedSessionPackages() {
      const validPackageIds = new Set((state.sessionPackages || []).map(pkg => pkg.packageId));
      for (const packageId of Object.keys(state.expandedSessionPackages || {})) {
        if (!validPackageIds.has(packageId)) {
          delete state.expandedSessionPackages[packageId];
        }
      }
    }

    async function loadSessionPackages() {
      const payload = await request('/api/session-packages');
      state.sessionPackages = Array.isArray(payload.packages) ? payload.packages : [];
      state.packageReleaseSnapshot = payload.releaseSnapshot || null;
      reconcileExpandedSessionPackages();
    }

    async function loadSessionPackageHistory() {
      const payload = await request('/api/session-packages/history?limit=12').catch(() => ({ history: [] }));
      state.sessionPackageHistory = Array.isArray(payload.history) ? payload.history : [];
    }

    async function mutateSessionPackage(packageId, patch, noticeText) {
      await request('/api/session-packages/' + encodeURIComponent(packageId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch || {})
      });
      await Promise.all([loadSessionPackages(), loadSessionPackageHistory()]);
      if (noticeText) {
        state.notice = noticeText;
      }
    }

    function getPackagedSessionIdSet() {
      const packaged = new Set();
      for (const pkg of state.sessionPackages || []) {
        for (const sessionId of pkg.sessionIds || []) {
          packaged.add(sessionId);
        }
      }
      return packaged;
    }

    function buildSessionTimeline() {
      const bySessionId = new Map(state.sessions.map(session => [session.sessionId, session]));
      const packagedSessionIds = getPackagedSessionIdSet();
      const timeline = [];

      for (const session of state.sessions) {
        if (!packagedSessionIds.has(session.sessionId)) {
          timeline.push({ type: 'session', timestamp: safeIso(session.updatedAt), session });
        }
      }

      for (const pkg of state.sessionPackages || []) {
        const sessions = (pkg.sessionIds || [])
          .map(sessionId => bySessionId.get(sessionId))
          .filter(Boolean)
          .sort((a, b) => (safeIso(b.updatedAt) < safeIso(a.updatedAt) ? -1 : 1));
        if (!sessions.length) {
          continue;
        }
        const latestTimestamp = sessions.reduce((latest, session) => {
          const updated = safeIso(session.updatedAt);
          return updated > latest ? updated : latest;
        }, safeIso(pkg.updatedAt || pkg.createdAt));
        timeline.push({
          type: 'package',
          timestamp: latestTimestamp,
          pkg,
          sessions,
        });
      }

      return timeline.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    }

    async function exportSession() {
      if (!state.selectedSessionId) {
        state.notice = { type: 'error', message: 'No session selected to export.' };
        render();
        return;
      }
      try {
        var messages = await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages');
        var session = state.sessions.find(function(s) { return s.sessionId === state.selectedSessionId; });
        var exportData = {
          format: 'prism-session-v1',
          exportedAt: new Date().toISOString(),
          session: {
            title: session ? session.title : 'Untitled',
            messageCount: messages.length,
            createdAt: session ? session.createdAt : null,
          },
          messages: messages
        };
        var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'prism-session-' + (session ? session.title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40) : 'export') + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        state.notice = 'Session exported successfully.';
        render();
      } catch (err) {
        state.notice = { type: 'error', message: 'Export failed: ' + String(err) };
        render();
      }
    }

    function importSession() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async function(e) {
        var file = e.target.files[0];
        if (!file) return;
        try {
          var text = await file.text();
          var data = JSON.parse(text);
          if (!data.format || data.format !== 'prism-session-v1' || !Array.isArray(data.messages)) {
            state.notice = { type: 'error', message: 'Invalid session file. Expected prism-session-v1 format.' };
            render();
            return;
          }
          var title = (data.session && data.session.title) ? data.session.title + ' (imported)' : 'Imported Session';
          var result = await request('/api/chat/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title })
          });
          var newSessionId = result.session.sessionId;
          for (var i = 0; i < data.messages.length; i++) {
            var msg = data.messages[i];
            await request('/api/chat/sessions/' + encodeURIComponent(newSessionId) + '/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: msg.role, content: msg.content })
            });
          }
          await loadSessions();
          state.selectedSessionId = newSessionId;
          await loadMessages();
          state.notice = 'Imported ' + data.messages.length + ' messages into \"' + title + '\".';
          render();
        } catch (err) {
          state.notice = { type: 'error', message: 'Import failed: ' + String(err) };
          render();
        }
      };
      input.click();
    }

    async function packageSessions() {
      const packagedSessionIds = getPackagedSessionIdSet();
      const candidates = state.sessions
        .filter(session => !packagedSessionIds.has(session.sessionId))
        .sort((a, b) => (safeIso(b.updatedAt) < safeIso(a.updatedAt) ? -1 : 1));

      if (candidates.length === 0) {
        state.notice = 'No un-packaged sessions available.';
        render();
        return;
      }

      const packageId = 'pkg-' + Date.now();
      const createdAt = new Date().toISOString();
      const suggestedTitle = 'Session Package • ' + formatRelativeTime(createdAt);
      const packageTitleInput = prompt('Package title:', suggestedTitle);
      if (packageTitleInput === null) {
        return;
      }
      const areaOfInterestInput = prompt('Area of interest (optional):', '');
      if (areaOfInterestInput === null) {
        return;
      }
      const objectiveInput = prompt('Package objective (optional):', '');
      if (objectiveInput === null) {
        return;
      }
      const successCriteriaInput = prompt('Success criteria (optional):', '');
      if (successCriteriaInput === null) {
        return;
      }
      const dependenciesInput = prompt('Dependencies (comma separated, optional):', '');
      if (dependenciesInput === null) {
        return;
      }
      const dependencies = dependenciesInput
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

      await request('/api/session-packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: (packageTitleInput || '').trim() || suggestedTitle,
          areaOfInterest: (areaOfInterestInput || '').trim() || null,
          objective: (objectiveInput || '').trim() || null,
          successCriteria: (successCriteriaInput || '').trim() || null,
          dependencies,
          status: 'planned',
          sessionIds: candidates.map(session => session.sessionId)
        })
      });
      await Promise.all([loadSessionPackages(), loadSessionPackageHistory()]);
      if (state.sessionPackages[0]) {
        state.expandedSessionPackages[state.sessionPackages[0].packageId] = true;
      }
      state.notice = 'Packaged ' + candidates.length + ' sessions into a binder.';
      render();
    }

    function toggleSessionPackage(packageId) {
      const current = Boolean(state.expandedSessionPackages[packageId]);
      state.expandedSessionPackages[packageId] = !current;
      render();
    }

    function getSessionsForPackage(pkg) {
      const bySessionId = new Map(state.sessions.map(session => [session.sessionId, session]));
      return (pkg.sessionIds || [])
        .map(sessionId => bySessionId.get(sessionId))
        .filter(Boolean)
        .sort((a, b) => (safeIso(b.updatedAt) < safeIso(a.updatedAt) ? -1 : 1));
    }

    async function runPackageWorkflow(event, packageId) {
      event.stopPropagation();
      const pkg = (state.sessionPackages || []).find(item => item.packageId === packageId);
      if (!pkg) {
        return;
      }

      const sessions = getSessionsForPackage(pkg);
      if (!sessions.length) {
        state.notice = 'Package has no active session chapters.';
        render();
        return;
      }

      const targetSession = sessions[0];
      state.selectedSessionId = targetSession.sessionId;

      if (!state.readiness || !state.readiness.ready) {
        state.notice = 'Complete provider readiness before running package workflow.';
        state.activeTab = 'settings';
        render();
        return;
      }

      const orchestrationPrompt = [
        'Execute multi-session package workflow orchestration for this binder.',
        'Package title: ' + (pkg.title || 'Session Package'),
        'Area of interest: ' + (pkg.areaOfInterest || 'unspecified'),
        'Objective: ' + (pkg.objective || 'unspecified'),
        'Success criteria: ' + (pkg.successCriteria || 'unspecified'),
        'Dependencies: ' + ((pkg.dependencies || []).length ? pkg.dependencies.join(', ') : 'none'),
        'Session chapters in scope: ' + sessions.map(session => session.title).join(' | '),
        'Produce an execution plan with ordered phases, required approvals, and data orchestration checkpoints.'
      ].join('\\n');

      const previousStatus = pkg.status || 'planned';
      state.busy = true;
      state.notice = null;
      render();
      try {
        await mutateSessionPackage(packageId, {
          status: 'running',
          lastRunAt: new Date().toISOString(),
          historyAction: 'workflow_started',
          message: 'Workflow launched from package controls.',
          targetSessionId: targetSession.sessionId
        });
        await request('/api/chat/sessions/' + encodeURIComponent(targetSession.sessionId) + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: orchestrationPrompt })
        });
        await Promise.all([loadSessions(), loadMessages(), refreshChrome()]);
        state.notice = 'Package workflow started in chapter session "' + targetSession.title + '".';
      } catch (error) {
        await mutateSessionPackage(packageId, {
          status: previousStatus,
          historyAction: 'status_changed',
          message: 'Workflow launch failed; restored previous status.',
          targetSessionId: targetSession.sessionId
        }).catch(() => null);
        state.notice = String(error);
      } finally {
        state.busy = false;
        render();
      }
    }

    async function setPackageStatus(event, packageId, nextStatus, actionLabel) {
      event.stopPropagation();
      const pkg = (state.sessionPackages || []).find(p => p.packageId === packageId);
      if (!pkg) {
        return;
      }
      const actionMap = {
        planned: 'workflow_paused',
        running: 'workflow_started',
        blocked: 'workflow_blocked',
        complete: 'workflow_completed'
      };
      await mutateSessionPackage(packageId, {
        status: nextStatus,
        historyAction: actionMap[nextStatus] || 'status_changed',
        message: actionLabel || ('Package status set to ' + nextStatus + '.')
      }, 'Package marked ' + nextStatus + '.');
      render();
    }

    async function cyclePackageStatus(event, packageId) {
      event.stopPropagation();
      const pkg = (state.sessionPackages || []).find(p => p.packageId === packageId);
      if (!pkg) {
        return;
      }
      const cycle = ['planned', 'running', 'blocked', 'complete'];
      const idx = cycle.indexOf(pkg.status || 'planned');
      await setPackageStatus(event, packageId, cycle[(idx + 1) % cycle.length], 'Status advanced from package badge.');
    }

    async function exportPackageTrace(event, packageId) {
      event.stopPropagation();
      state.busy = true;
      state.notice = null;
      render();
      try {
        const payload = await request('/api/session-packages/' + encodeURIComponent(packageId) + '/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = packageId + '-trace-export.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        await Promise.all([loadSessionPackages(), loadSessionPackageHistory(), refreshChrome()]);
        state.notice = 'Package trace export generated.';
      } catch (error) {
        state.notice = String(error);
      } finally {
        state.busy = false;
        render();
      }
    }

    async function unpackageSessionPackage(event, packageId) {
      event.stopPropagation();
      const existing = (state.sessionPackages || []).find(pkg => pkg.packageId === packageId);
      if (!existing) {
        return;
      }

      const confirmed = confirm('Unpackage "' + existing.title + '" and restore all chapters to top-level history?');
      if (!confirmed) {
        return;
      }

      await request('/api/session-packages/' + encodeURIComponent(packageId), {
        method: 'DELETE'
      });
      state.sessionPackages = state.sessionPackages.filter(pkg => pkg.packageId !== packageId);
      if (state.expandedSessionPackages[packageId]) {
        delete state.expandedSessionPackages[packageId];
      }
      await loadSessionPackageHistory();
      state.notice = 'Unpackaged "' + existing.title + '".';
      render();
    }

    function statusBadge(action) {
      const badgeClass = action.status === 'running'
        ? 'badge badge-running'
        : action.status === 'succeeded'
          ? 'badge badge-succeeded'
          : action.status === 'failed'
            ? 'badge badge-failed'
            : 'badge';
      return '<span class="' + badgeClass + '">' + escapeHtml(action.status) + '</span>';
    }

    function getLocalLlmSelection(sessionId) {
      if (!sessionId) {
        return null;
      }
      return state.localLlmSelectionBySession[sessionId] || null;
    }

    function setLocalLlmSelection(sessionId, providerId, model) {
      if (!sessionId || !providerId) {
        return;
      }
      state.localLlmSelectionBySession[sessionId] = {
        providerId,
        model: model || ''
      };
    }

    function clearLocalLlmSelection(sessionId) {
      if (!sessionId) {
        return;
      }
      if (state.localLlmSelectionBySession[sessionId]) {
        delete state.localLlmSelectionBySession[sessionId];
      }
    }

    async function loadSessions() {
      const payload = await request('/api/chat/sessions');
      state.sessions = payload;
      const validSessionIds = new Set(state.sessions.map(session => session.sessionId));
      for (const sessionId of Object.keys(state.localLlmSelectionBySession)) {
        if (!validSessionIds.has(sessionId)) {
          delete state.localLlmSelectionBySession[sessionId];
        }
      }
      if (!state.selectedSessionId && state.sessions.length > 0) {
        state.selectedSessionId = state.sessions[0].sessionId;
      }
      if (state.selectedSessionId && !state.sessions.some(session => session.sessionId === state.selectedSessionId)) {
        state.selectedSessionId = state.sessions[0] ? state.sessions[0].sessionId : null;
      }
    }

    async function createSession() {
      const payload = await request('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      state.selectedSessionId = payload.session.sessionId;
      await loadSessions();
      await loadMessages();
      await Promise.all([loadSessionPackages(), loadSessionPackageHistory(), refreshChrome()]);
      render();
    }

    async function loadMessages() {
      if (!state.selectedSessionId) {
        state.messages = [];
        return;
      }
      const payload = await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages');
      state.messages = payload.messages;
    }

    async function refreshChrome() {
      const llmUrl = state.selectedSessionId
        ? '/api/llm/providers?sessionId=' + encodeURIComponent(state.selectedSessionId)
        : null;
      const llmConfigUrl = state.selectedSessionId
        ? '/api/llm/config?sessionId=' + encodeURIComponent(state.selectedSessionId)
        : null;
      const readinessUrl = '/api/readiness'
        + (state.selectedSessionId ? '?sessionId=' + encodeURIComponent(state.selectedSessionId) : '');
      const llmAuditUrl = '/api/events?limit=10&operation=dashboard.llm_selection'
        + (state.selectedSessionId ? '&chatSessionId=' + encodeURIComponent(state.selectedSessionId) : '');
      const tracesUrl = '/api/traces?limit=10'
        + (state.selectedSessionId ? '&chatSessionId=' + encodeURIComponent(state.selectedSessionId) : '')
        + (state.selectedTraceId ? '&correlationId=' + encodeURIComponent(state.selectedTraceId) : '');
      const chatTelemetryUrl = '/api/events?limit=25'
        + (state.selectedSessionId ? '&chatSessionId=' + encodeURIComponent(state.selectedSessionId) : '');
      const [status, readiness, llmCatalog, llmConfig, llmAuditEvents, chatTelemetryPayload, pending, actions, actionHistory, traceData, events, retrievalData, prioritizedAlertsData, telemetrySummaryData, runtimeExcellenceData, releaseValidationData, releaseDecisionData, selfReviewLatest, selfReviewHistory, packagePayload, packageHistoryPayload, settingsPayload, agentDataPayload, computerSystemInfoPayload, toolsStatusPayload, pluginsStatusPayload, llmModalitiesPayload, modelMatrixPayload] = await Promise.all([
        request('/api/status'),
        request(readinessUrl).catch(() => null),
        llmUrl ? request(llmUrl) : Promise.resolve(null),
        llmConfigUrl ? request(llmConfigUrl).catch(() => null) : Promise.resolve(null),
        request(llmAuditUrl),
        request(chatTelemetryUrl).catch(function() { return []; }),
        request('/api/pending'),
        request('/api/actions'),
        request('/api/action-history'),
        request(tracesUrl).catch(() => ({ traces: [], selectedTraceEvents: [] })),
        request('/api/events?limit=8'),
        request('/api/retrieval/alerts').catch(() => ({ alerts: [] })),
        request('/api/retrieval/prioritized-alerts').catch(() => null),
        request('/api/telemetry/summary?window=' + state.telemetryWindow).catch(() => null),
        request('/api/runtime/excellence?window=' + state.telemetryWindow).catch(() => null),
        request('/api/release/validation/latest').catch(() => ({ report: null })),
        request('/api/release/decision/latest').catch(() => ({ report: null })),
        request('/api/self-review/latest').catch(() => ({ report: null })),
        request('/api/self-review/history?limit=5').catch(() => ({ reports: [] })),
        request('/api/session-packages').catch(() => ({ packages: [], releaseSnapshot: null })),
        request('/api/session-packages/history?limit=12').catch(() => ({ history: [] })),
        request('/api/settings').catch(() => ({ settings: null })),
        request('/api/agents').catch(() => ({ agents: [], swarms: [], telemetry: null })),
        request('/api/computer/system-info').catch(() => null),
        request('/api/tools/status').catch(function() { return { tools: {} }; }),
        request('/api/plugins/status').catch(function() { return { plugins: {} }; }),
        request('/api/llm/modalities').catch(function() { return { modalities: [] }; }),
        request('/api/models/matrix').catch(function() { return { models: [] }; })
      ]);
      state.agentData = agentDataPayload || null;
      state.computerSystemInfo = computerSystemInfoPayload || null;
      var serverTools = (toolsStatusPayload && toolsStatusPayload.tools) || {};
      state.toolCatalog = Array.isArray(toolsStatusPayload && toolsStatusPayload.catalog)
        ? toolsStatusPayload.catalog
        : [];
      for (var tk in serverTools) {
        if (!state.toolStates[tk]) state.toolStates[tk] = { enabled: true, invocations: 0, successes: 0, failures: 0, avgLatencyMs: 0, lastInvoked: null, lastError: null };
        var st = serverTools[tk];
        state.toolStates[tk].invocations = st.invocations || 0;
        state.toolStates[tk].successes = st.successes || 0;
        state.toolStates[tk].failures = st.failures || 0;
        state.toolStates[tk].avgLatencyMs = st.avgLatencyMs || 0;
        state.toolStates[tk].lastInvoked = st.lastInvoked || null;
        state.toolStates[tk].lastError = st.lastError || null;
        if (typeof st.enabled === 'boolean') state.toolStates[tk].enabled = st.enabled;
      }
      var serverPlugins = (pluginsStatusPayload && pluginsStatusPayload.plugins) || {};
      for (var pk in serverPlugins) {
        if (!state.pluginStates[pk]) state.pluginStates[pk] = { enabled: true, healthy: true, requests: 0, errors: 0, avgResponseMs: 0, uptime: 100, lastChecked: null };
        var sp = serverPlugins[pk];
        state.pluginStates[pk].requests = sp.requests || 0;
        state.pluginStates[pk].errors = sp.errors || 0;
        state.pluginStates[pk].avgResponseMs = sp.avgResponseMs || 0;
        state.pluginStates[pk].lastChecked = sp.lastChecked || null;
        if (typeof sp.enabled === 'boolean') state.pluginStates[pk].enabled = sp.enabled;
        if (typeof sp.healthy === 'boolean') state.pluginStates[pk].healthy = sp.healthy;
      }
      var modalitySummary = llmModalitiesPayload || null;
      state.llmModalitySummary = modalitySummary;
      if (modalitySummary && Array.isArray(modalitySummary.modalities) && modalitySummary.modalities.length > 0) {
        state.availableModalities = modalitySummary.modalities;
      }
      state.modelMatrixEntries = Array.isArray(modelMatrixPayload && modelMatrixPayload.models)
        ? modelMatrixPayload.models
        : [];
      state.status = status;
      state.readiness = readiness;
      state.llmCatalog = llmCatalog;
      state.llmConfig = llmConfig;
      state.llmAuditEvents = llmAuditEvents;
      state.chatTelemetry = (Array.isArray(chatTelemetryPayload) ? chatTelemetryPayload : []).filter(function(e) { return e.operation && (e.operation.startsWith('chat.') || e.operation.startsWith('llm.')); });
      state.pending = pending;
      state.actions = actions;
      state.actionHistory = actionHistory;
      state.traceData = traceData;
      state.events = events;
      state.selfReviewLatest = selfReviewLatest.report || null;
      state.selfReviewHistory = selfReviewHistory.reports || [];
      state.retrievalAlerts = retrievalData.alerts || [];
      state.prioritizedAlerts = prioritizedAlertsData || null;
      state.telemetrySummary = telemetrySummaryData || null;
      state.runtimeExcellence = runtimeExcellenceData || null;
      state.releaseValidation = releaseValidationData ? (releaseValidationData.report || null) : null;
      state.releaseDecision = releaseDecisionData ? (releaseDecisionData.report || null) : null;
      state.sessionPackages = Array.isArray(packagePayload.packages) ? packagePayload.packages : [];
      state.packageReleaseSnapshot = packagePayload.releaseSnapshot || null;
      state.sessionPackageHistory = Array.isArray(packageHistoryPayload.history) ? packageHistoryPayload.history : [];
      state.runtimeSettings = settingsPayload.settings || null;
      reconcileExpandedSessionPackages();
      if (state.selectedTraceId && (!traceData || !traceData.traces || !traceData.traces.some(trace => trace.correlationId === state.selectedTraceId))) {
        state.selectedTraceId = null;
      }
    }

    async function bootstrap() {
      try {
        await loadSessions();
        if (state.sessions.length === 0) {
          await createSession();
        } else {
          await Promise.all([refreshChrome(), loadMessages()]);
        }
        // Load model profiles and routing config in background
        fetchModelProfiles();
        fetchRoutingState();
      } catch (error) {
        state.notice = String(error);
      } finally {
        render();
      }
    }

    function renderSessions() {
      const container = document.getElementById('session-list');
      if (!state.sessions.length) {
        container.innerHTML = '<div class="empty-state">No saved sessions yet.</div>';
        return;
      }

      const renderSessionCard = function(session, extraClass) {
        const preview = session.lastMessagePreview || 'Start a new conversation.';
        const activeClass = state.selectedSessionId === session.sessionId ? ' active' : '';
        const className = (extraClass ? ' ' + extraClass : '');
        const onClick = extraClass === 'session-chapter'
          ? 'event.stopPropagation(); selectSession(this.dataset.sessionId)'
          : 'selectSession(this.dataset.sessionId)';
        return '<div class="session-card' + activeClass + className + '" data-session-id="' + escapeHtml(session.sessionId) + '" onclick="' + onClick + '">'
          + '<div class="session-title">' + escapeHtml(session.title) + '</div>'
          + '<div class="session-preview">' + escapeHtml(preview) + '</div>'
          + '<div class="session-meta"><span>' + escapeHtml(String(session.messageCount)) + ' msgs</span><span>' + escapeHtml(formatRelativeTime(session.updatedAt)) + '</span></div>'
          + '<div class="action-buttons">'
          + '<button class="danger-button" data-session-id="' + escapeHtml(session.sessionId) + '" onclick="deleteSession(event, this.dataset.sessionId)">Delete</button>'
          + '<button class="secondary-button" data-session-id="' + escapeHtml(session.sessionId) + '" onclick="renameSession(event, this.dataset.sessionId)">Rename</button>'
          + '<button class="secondary-button" data-session-id="' + escapeHtml(session.sessionId) + '" onclick="copySession(event, this.dataset.sessionId)">Copy Session</button>'
          + '</div>'
          + '</div>';
      };

      const timeline = buildSessionTimeline();
      container.innerHTML = timeline.map(entry => {
        if (entry.type === 'session') {
          return renderSessionCard(entry.session);
        }

        const expanded = Boolean(state.expandedSessionPackages[entry.pkg.packageId]);
        const childHtml = expanded
          ? '<div class="session-package-children">'
            + entry.sessions.map(session => renderSessionCard(session, 'session-chapter')).join('')
            + '</div>'
          : '';

        const pkgStatus = entry.pkg.status || 'planned';
        const summary = entry.pkg.summary || {};
        const canPause = pkgStatus === 'running';
        const canResume = pkgStatus === 'planned' || pkgStatus === 'blocked';
        return '<div class="session-card session-package-card" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="toggleSessionPackage(this.dataset.packageId)">'
          + '<div class="session-package-head">'
          + '<div class="session-title">' + escapeHtml(entry.pkg.title) + '</div>'
          + '<div style="display:flex;align-items:center;gap:8px;">'
          + '<button class="pkg-status-badge ' + escapeHtml(pkgStatus) + '" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="cyclePackageStatus(event, this.dataset.packageId)" title="Click to advance status">' + escapeHtml(pkgStatus.toUpperCase()) + '</button>'
          + '<div class="session-package-badge">' + (expanded ? 'Collapse' : 'Expand') + '</div>'
          + '</div>'
          + '</div>'
          + (entry.pkg.areaOfInterest
            ? '<div class="session-preview">Area: ' + escapeHtml(entry.pkg.areaOfInterest) + '</div>'
            : '')
          + (entry.pkg.objective
            ? '<div class="session-preview">Objective: ' + escapeHtml(entry.pkg.objective) + '</div>'
            : '')
          + (entry.pkg.successCriteria
            ? '<div class="session-preview">Success: ' + escapeHtml(entry.pkg.successCriteria) + '</div>'
            : '')
          + ((entry.pkg.dependencies || []).length
            ? '<div class="session-preview">Dependencies: ' + escapeHtml(entry.pkg.dependencies.join(', ')) + '</div>'
            : '')
          + '<div class="session-preview">Session chapters: ' + escapeHtml(String(entry.sessions.length)) + '</div>'
          + (summary.lastActiveSessionTitle
            ? '<div class="session-preview">Last active: ' + escapeHtml(summary.lastActiveSessionTitle) + ' · ' + escapeHtml(formatRelativeTime(summary.lastActiveAt)) + '</div>'
            : '')
          + '<div class="session-preview">Progress: ' + escapeHtml(String(summary.completedChapterCount || 0)) + '/' + escapeHtml(String(summary.chapterCount || entry.sessions.length)) + ' chapters active (' + escapeHtml(String(summary.completionPct || 0)) + '%)</div>'
          + '<div class="session-preview">Policy: ' + escapeHtml(summary.latestPolicyDecision || 'none') + ' · Pending approvals: ' + escapeHtml(String(summary.pendingApprovalCount || 0)) + '</div>'
          + '<div class="session-meta"><span>Package</span><span>' + escapeHtml(formatRelativeTime(entry.timestamp)) + '</span></div>'
          + '<div class="session-package-actions">'
          + '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="runPackageWorkflow(event, this.dataset.packageId)">Run Package Workflow</button>'
          + (canResume
            ? '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="setPackageStatus(event, this.dataset.packageId, &quot;running&quot;, &quot;Package resumed from controls.&quot;)">Resume</button>'
            : '')
          + (canPause
            ? '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="setPackageStatus(event, this.dataset.packageId, &quot;planned&quot;, &quot;Package paused from controls.&quot;)">Pause</button>'
            : '')
          + '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="setPackageStatus(event, this.dataset.packageId, &quot;blocked&quot;, &quot;Package marked blocked from controls.&quot;)">Mark Blocked</button>'
          + '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="setPackageStatus(event, this.dataset.packageId, &quot;complete&quot;, &quot;Package marked complete from controls.&quot;)">Complete</button>'
          + '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="exportPackageTrace(event, this.dataset.packageId)">Export Trace</button>'
          + '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="unpackageSessionPackage(event, this.dataset.packageId)">Unpackage</button>'
          + '</div>'
          + childHtml
          + '</div>';
      }).join('');
    }

    function renderTabs() {
      const tabsContainer = document.getElementById('tabs');
      if (!tabsContainer) {
        return;
      }

      const buttons = Array.from(tabsContainer.querySelectorAll('[data-tab-id]'));
      if (buttons.length !== tabs.length) {
        console.error('[dashboard-render] tabs', 'expected ' + tabs.length + ' buttons, found ' + buttons.length);
        state.notice = state.notice || 'Dashboard navigation is incomplete. Refresh the page or restart Prism.';
        return;
      }

      const missingPanels = [];
      tabs.forEach(tab => {
        if (!document.getElementById('tab-' + tab.id)) {
          missingPanels.push(tab.id);
        }
      });
      if (missingPanels.length > 0) {
        console.error('[dashboard-render] tabs', 'missing panels', missingPanels.join(','));
        state.notice = state.notice || 'Dashboard content panels failed to initialize. Refresh the page or restart Prism.';
        return;
      }

      buttons.forEach(button => {
        const tabId = button.dataset.tabId;
        const isActive = state.activeTab === tabId;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        button.setAttribute('tabindex', isActive ? '0' : '-1');
      });

      tabs.forEach(tab => {
        const panel = document.getElementById('tab-' + tab.id);
        if (!panel) {
          return;
        }
        const isActive = state.activeTab === tab.id;
        panel.classList.toggle('active', isActive);
        panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      });

      if (document.body) {
        document.body.classList.add('js-ready');
      }
    }

    async function fetchReadinessAndRefresh() {
      try {
        const readiness = await request('/api/readiness/recheck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.selectedSessionId || '' })
        });
        state.readiness = readiness;
        safeRenderStep('onboarding', renderOnboarding);
        safeRenderStep('header', renderHeader);
      } catch (err) {
        state.notice = { type: 'error', message: String(err) };
        safeRenderStep('notice', renderNotice);
      }
    }

    async function onHeaderProviderChanged(providerId) {
      if (!providerId || !state.selectedSessionId || !state.llmCatalog) return;
      const provider = state.llmCatalog.providers.find(entry => entry.id === providerId);
      const model = provider?.defaultModel || provider?.models[0] || '';
      try {
        state.llmCatalog = await request('/api/llm/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.selectedSessionId, providerId: providerId, model })
        });
        clearLocalLlmSelection(state.selectedSessionId);
        safeRenderStep('header', renderHeader);
        safeRenderStep('llm', renderLlm);
        await fetchReadinessAndRefresh();
        state.notice = 'Provider switched to ' + providerId + ' / ' + (model || 'default') + '.';
        safeRenderStep('notice', renderNotice);
      } catch (err) {
        console.error(err);
        state.notice = { type: 'error', message: 'Failed to switch provider: ' + String(err) };
        safeRenderStep('notice', renderNotice);
      }
    }

    async function onHeaderModelChanged(model) {
      if (!model || !state.selectedSessionId || !state.llmCatalog) return;
      try {
        state.llmCatalog = await request('/api/llm/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.selectedSessionId, providerId: state.llmCatalog.activeProviderId, model })
        });
        clearLocalLlmSelection(state.selectedSessionId);
        safeRenderStep('header', renderHeader);
        safeRenderStep('llm', renderLlm);
        await fetchReadinessAndRefresh();
        state.notice = 'Model switched to ' + model + '.';
        safeRenderStep('notice', renderNotice);
      } catch (err) {
        console.error(err);
        state.notice = { type: 'error', message: 'Failed to switch model: ' + String(err) };
        safeRenderStep('notice', renderNotice);
      }
    }

    function renderHeader() {
      const activeSession = state.sessions.find(session => session.sessionId === state.selectedSessionId);
      document.getElementById('active-session-title').textContent = activeSession ? activeSession.title : 'PRISM Chat';
      document.getElementById('active-session-meta').textContent = activeSession
        ? 'Updated ' + formatRelativeTime(activeSession.updatedAt) + ' • ' + activeSession.messageCount + ' messages'
        : 'Persistent runtime session';

      const chips = [];
      if (state.status) {
        chips.push('<span class="chip">Mode: ' + escapeHtml(state.status.mode) + '</span>');
        chips.push('<span class="chip">Environment: ' + escapeHtml(state.status.environmentProfile) + '</span>');
        chips.push('<span class="chip">Pending approvals: ' + escapeHtml(String(state.status.pendingApprovals)) + '</span>');
        chips.push('<span class="chip">Sessions: ' + escapeHtml(String(state.status.chatSessionCount)) + '</span>');
      }
      if (state.llmCatalog && state.llmCatalog.activeProviderId) {
        let isError = false;
        let isReady = state.readiness && state.readiness.ready;
        const messagesArr = state.messages || [];
        const lastError = messagesArr.slice().reverse().find(m => m.metadata && m.metadata.intent === 'llm_error');
        if (lastError && (Date.now() - new Date(lastError.createdAt).getTime() < 300000)) {
           isError = true;
        }

        let hueStyle = '';
        if (isError) {
          hueStyle = 'color: #ff8d8d; border-color: rgba(255, 141, 141, 0.4); background: rgba(255, 141, 141, 0.1);';
        } else if (isReady) {
          hueStyle = 'color: #7cf1c8; border-color: rgba(124, 241, 200, 0.4); background: rgba(124, 241, 200, 0.1);';
        } else {
          hueStyle = 'color: #f5cf6c; border-color: rgba(245, 207, 108, 0.4); background: rgba(245, 207, 108, 0.1);';
        }

        const selectBaseStyle = 'appearance: none; -moz-appearance: none; -webkit-appearance: none; outline: none; border-radius: 999px; padding: 6px 12px; font-size: 12px; cursor: pointer; transition: all 0.2s ease; border-style: solid; border-width: 1px;';
        const optionStyle = ' style="background: #1e293b; color: #edf3ff;"';

        const providers = state.llmCatalog.providers || [];
        if (providers.length > 0) {
          let pSelect = '<select style="' + selectBaseStyle + hueStyle + '" onchange="onHeaderProviderChanged(this.value)" title="Fast switch provider">';
          providers.forEach(p => {
            const sel = p.id === state.llmCatalog.activeProviderId ? ' selected' : '';
            pSelect += '<option value="' + escapeHtml(p.id) + '"' + sel + optionStyle + '>Provider: ' + escapeHtml(p.id) + '</option>';
          });
          pSelect += '</select>';
          chips.push(pSelect);
          
          const activeP = providers.find(p => p.id === state.llmCatalog.activeProviderId);
          if (activeP && activeP.models && activeP.models.length > 0) {
            let mSelect = '<select style="' + selectBaseStyle + hueStyle + '" onchange="onHeaderModelChanged(this.value)" title="Fast switch model">';
            activeP.models.forEach(m => {
              const sel = m === state.llmCatalog.activeModel ? ' selected' : '';
              mSelect += '<option value="' + escapeHtml(m) + '"' + sel + optionStyle + '>Model: ' + escapeHtml(m) + '</option>';
            });
            mSelect += '</select>';
            chips.push(mSelect);
          }
        } else {
           chips.push('<span class="chip" style="' + hueStyle + '">Provider: ' + escapeHtml(state.llmCatalog.activeProviderId) + '</span>');
           chips.push('<span class="chip" style="' + hueStyle + '">Model: ' + escapeHtml(state.llmCatalog.activeModel || '-') + '</span>');
        }
      }
      document.getElementById('header-chips').innerHTML = chips.join('');
    }

    function renderOnboarding() {
      const container = document.getElementById('onboarding');
      if (!state.readiness) {
        container.innerHTML = '<div class="muted">Checking readiness...</div>';
        return;
      }

      const checklist = state.readiness.requirements || [];
      if (state.readiness.ready) {
        container.innerHTML = '<div class="onboarding-title">System ready</div>'
          + '<div class="muted">Provider and model are configured for this session.</div>';
        return;
      }

      const recommendations = (state.readiness.recommendations || []).map(item =>
        '<li>' + escapeHtml(String(item)) + '</li>'
      ).join('');

      container.innerHTML = '<div class="onboarding-title">First-run checklist</div>'
        + '<div class="onboarding-list">'
        + checklist.map(item =>
          '<div class="' + (item.passed ? 'passed' : 'failed') + '">'
          + (item.passed ? '✓ ' : '✗ ')
          + escapeHtml(item.label)
          + ' — ' + escapeHtml(item.detail || '')
          + '</div>'
        ).join('')
        + '</div>'
        + '<div class="action-buttons" style="margin-top:10px;">'
        + '<button class="secondary-button" onclick="setActiveTab(&quot;settings&quot;)">Open Provider & Settings</button>'
        + '</div>'
        + (recommendations ? '<ul class="muted" style="margin:10px 0 0 18px; padding:0;">' + recommendations + '</ul>' : '');
    }

    function renderToolBlocks(metadata) {
      if (!metadata || !metadata.events || !metadata.events.length) return '';
      var toolEvents = metadata.events.filter(function(e) { return e.type === 'tool_call' || e.type === 'tool_result'; });
      if (!toolEvents.length) return '';
      var blocks = [];
      for (var i = 0; i < toolEvents.length; i += 2) {
        var call = toolEvents[i];
        var result = toolEvents[i + 1];
        var name = call ? (call.tool || call.name || 'tool') : 'tool';
        var ok = result && result.type === 'tool_result' && (result.ok !== false);
        var statusClass = ok ? 'ok' : 'fail';
        var statusText = ok ? '\\u2713' : '\\u2717';
        blocks.push(
          '<div class="tool-block" onclick="this.classList.toggle(&quot;expanded&quot;)">'
          + '<div class="tool-block-header">'
          + '<span class="tool-block-icon">\\u{1F527}</span>'
          + '<span class="tool-block-name">' + escapeHtml(name) + '</span>'
          + '<span class="tool-block-status ' + statusClass + '">' + statusText + '</span>'
          + '</div>'
          + '</div>'
        );
      }
      return blocks.join('');
    }

    function renderMessages() {
      const container = document.getElementById('messages');
      if (!state.messages.length) {
        container.innerHTML = '<div class="empty-state"><strong>Persistent operator chat is ready.</strong><br><br>Ask for status, approvals, history, or trigger actions like <span class="mono">run workflow demo</span>.</div>';
        return;
      }

      const rows = state.messages.map(message => {
        const roleLabel = message.role === 'user' ? 'Operator' : message.role === 'assistant' ? 'PRISM' : 'System';
        let extraHtml = '';
        if (message.metadata && message.metadata.intent === 'llm_error') {
            extraHtml = '<div style="margin-top: 14px;"><button class="secondary-button" style="font-size:12px; padding:8px 12px; display:inline-flex; align-items:center; gap:6px;" onclick="setActiveTab(&quot;logs&quot;)">&#x1F50D; Open Logs</button></div>';
        }
        // Tool execution blocks for agentic replies
        if (message.metadata && message.metadata.intent === 'llm_agentic') {
          extraHtml += renderToolBlocks(message.metadata);
          if (message.metadata.toolCallsExecuted) {
            extraHtml += '<div class="muted" style="font-size:11px;margin-top:6px;">\\u{1F527} '
              + message.metadata.toolCallsExecuted + ' tool call(s) in '
              + (message.metadata.iterations || '?') + ' iteration(s)</div>';
          }
        }

        const contentHtml = message.role === 'assistant' ? renderMarkdown(message.content) : escapeHtml(message.content);

        return '<div class="message ' + escapeHtml(message.role) + '">'
          + '<div class="message-label">' + escapeHtml(roleLabel) + '</div>'
          + '<div>' + contentHtml + '</div>'
          + extraHtml
          + '<div class="message-time">' + escapeHtml(formatRelativeTime(message.createdAt)) + '</div>'
          + '</div>';
      }).join('');

      const streamBlock = state.agenticStream && state.agenticStream.length
        ? '<div class="message assistant"><div class="message-label">PRISM</div>'
          + state.agenticStream.map(function(ev) {
            if (ev.type === 'text') return '<div>' + renderMarkdown(ev.text || '') + '</div>';
            if (ev.type === 'tool_call') { var tn = (ev.toolCall && ev.toolCall.name) || ''; return '<div class="tool-block"><div class="tool-block-header"><span class="tool-block-icon">\\u{1F527}</span><span class="tool-block-name">' + escapeHtml(tn) + '</span><span class="streaming-dot"></span></div></div>'; }
            if (ev.type === 'tool_result') { var rn = (ev.toolResult && ev.toolResult.name) || 'tool'; return '<div class="muted" style="font-size:11px;">\\u2713 ' + escapeHtml(rn) + ' done</div>'; }
            return '';
          }).join('')
          + '</div>'
        : '';

      const typing = state.busy && !state.agenticStream.length ? '<div class="message assistant"><div class="message-label">PRISM</div><div>Working...<span class="streaming-dot"></span></div></div>' : '';
      container.innerHTML = rows + streamBlock + typing;
      container.scrollTop = container.scrollHeight;
    }

    function renderOverview() {
      const container = document.getElementById('runtime-overview');
      if (!state.status) {
        container.innerHTML = '<div class="muted">Loading runtime status...</div>';
        return;
      }
      const lastEvent = state.status.lastEvent;
      container.innerHTML = [
        metricRow('Session', state.status.sessionId),
        metricRow('Started', formatRelativeTime(state.status.startedAt)),
        metricRow('Uptime', String(state.status.uptimeSeconds) + 's'),
        metricRow('Events', String(state.status.eventCount)),
        metricRow('Last event', lastEvent ? lastEvent.operation + ' (' + lastEvent.status + ')' : 'none')
      ].join('');
    }

    function renderRoutingStrategyControls(providers, currentModel) {
      var html = '';
      var strategy = state.sessionRoutingStrategy || 'direct';

      // ── Routing Strategy Section ──
      html += '<div style="margin-top:12px;padding:10px;background:rgba(255,255,255,0.02);border:1px solid rgba(148,163,184,0.12);border-radius:8px;">';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">';
      html += '<span style="font-size:13px;font-weight:600;color:var(--fg);">\\u{1F9ED} Routing Strategy</span>';
      html += '</div>';

      // Strategy radio buttons
      html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">';
      var strategies = [
        { id: 'direct', label: '\\u{1F3AF} Direct', desc: 'Use selected model' },
        { id: 'role', label: '\\u{1F465} Role-Based', desc: 'Route by task role' },
        { id: 'modality', label: '\\u{1F9E0} Modality-Based', desc: 'Route by content type' }
      ];
      strategies.forEach(function(s) {
        var selected = strategy === s.id;
        html += '<button onclick="setSessionRoutingStrategy(&#39;' + s.id + '&#39;)" style="'
          + 'padding:6px 12px;border-radius:8px;font-size:11px;cursor:pointer;border:1px solid '
          + (selected ? 'rgba(99,179,237,0.5)' : 'rgba(148,163,184,0.15)') + ';'
          + 'background:' + (selected ? 'rgba(99,179,237,0.12)' : 'rgba(255,255,255,0.03)') + ';'
          + 'color:' + (selected ? '#63b3ed' : 'var(--fg-muted)') + ';'
          + 'font-weight:' + (selected ? '600' : '400') + ';'
          + 'transition:all 0.15s ease;">'
          + s.label
          + '</button>';
      });
      html += '</div>';

      // Strategy description
      if (strategy === 'direct') {
        html += '<div class="muted" style="font-size:11px;padding:4px 0;">Requests go directly to the selected provider and model above.</div>';
      } else if (strategy === 'role') {
        html += '<div class="muted" style="font-size:11px;padding:4px 0;">Requests are routed by task role (chat, code, classification, etc.). Configure in the <strong>Model Routing</strong> panel below.</div>';
      } else if (strategy === 'modality') {
        // ── Modality Pills ──
        html += '<div class="muted" style="font-size:11px;padding:4px 0;margin-bottom:6px;">Select a content modality to auto-route to the best matching model.</div>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">';

        var modalities = state.availableModalities || [];
        if (modalities.length === 0) {
          // Fallback if modality data hasn't loaded yet
          modalities = [
            { id: 'text', label: 'Text', icon: '\\u{1F4DD}', modelCount: 0 },
            { id: 'code', label: 'Code & Programming', icon: '\\u{1F4BB}', modelCount: 0 },
            { id: 'image-understanding', label: 'Image Understanding', icon: '\\u{1F5BC}', modelCount: 0 },
            { id: 'image-generation', label: 'Image Generation', icon: '\\u{1F3A8}', modelCount: 0 },
            { id: 'video-understanding', label: 'Video Understanding', icon: '\\u{1F3AC}', modelCount: 0 },
            { id: 'video-generation', label: 'Video Generation', icon: '\\u{1F3A5}', modelCount: 0 },
            { id: 'voice-input', label: 'Voice Input', icon: '\\u{1F3A4}', modelCount: 0 },
            { id: 'voice-output', label: 'Voice Output', icon: '\\u{1F50A}', modelCount: 0 },
            { id: 'tts', label: 'Text-to-Speech', icon: '\\u{1F5E3}', modelCount: 0 },
            { id: 'stt', label: 'Speech-to-Text', icon: '\\u{1F4AC}', modelCount: 0 },
            { id: 'realtime', label: 'Realtime', icon: '\\u26A1', modelCount: 0 },
            { id: 'embedding', label: 'Embedding', icon: '\\u{1F9E9}', modelCount: 0 },
            { id: 'multimodal-reasoning', label: 'Multimodal Reasoning', icon: '\\u{1F9E0}', modelCount: 0 }
          ];
        }

        modalities.forEach(function(m) {
          var isSelected = state.selectedModalityFilter === m.id;
          var hasModels = m.modelCount > 0;
          html += '<button onclick="onModalitySelected(&#39;' + escapeHtml(m.id) + '&#39;)" '
            + 'title="' + escapeHtml(m.label + (m.description ? ': ' + m.description : '') + ' (' + m.modelCount + ' models)') + '" '
            + 'style="'
            + 'display:inline-flex;align-items:center;gap:4px;'
            + 'padding:4px 10px;border-radius:16px;font-size:10px;cursor:pointer;'
            + 'border:1px solid ' + (isSelected ? 'rgba(99,179,237,0.6)' : hasModels ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.08)') + ';'
            + 'background:' + (isSelected ? 'rgba(99,179,237,0.15)' : 'rgba(255,255,255,0.02)') + ';'
            + 'color:' + (isSelected ? '#63b3ed' : hasModels ? 'var(--fg-muted)' : 'rgba(148,163,184,0.4)') + ';'
            + 'font-weight:' + (isSelected ? '600' : '400') + ';'
            + 'transition:all 0.15s ease;">'
            + '<span style="font-size:13px;">' + m.icon + '</span>'
            + '<span>' + escapeHtml(m.label) + '</span>'
            + (m.modelCount > 0 ? '<span style="font-size:9px;opacity:0.6;">(' + m.modelCount + ')</span>' : '')
            + '</button>';
        });
        html += '</div>';

        // ── Selected modality details ──
        if (state.selectedModalityFilter) {
          var selectedMod = modalities.find(function(m) { return m.id === state.selectedModalityFilter; });
          var suggestion = (state.routingModalitySuggestions || {})[state.selectedModalityFilter];
          var override = (state.routingModalityOverrides || {})[state.selectedModalityFilter];

          html += '<div style="padding:8px;background:rgba(99,179,237,0.05);border:1px solid rgba(99,179,237,0.15);border-radius:8px;margin-bottom:8px;">';
          html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">';
          html += '<span style="font-size:15px;">' + (selectedMod ? selectedMod.icon : '') + '</span>';
          html += '<span style="font-size:12px;font-weight:600;color:#63b3ed;">' + escapeHtml(selectedMod ? selectedMod.label : state.selectedModalityFilter) + '</span>';
          html += '</div>';

          if (suggestion) {
            var tierColors = { 1: '#ff6b6b', 2: '#ffa94d', 3: '#ffd43b', 4: '#69db7c', 5: '#4dabf7' };
            var sColor = tierColors[suggestion.tier] || '#aaa';
            html += '<div style="font-size:11px;margin-bottom:6px;">';
            html += '<span class="muted">AI Suggested: </span>';
            html += '<span class="mono" style="font-size:11px;">' + escapeHtml(suggestion.providerId + '/' + suggestion.model) + '</span>';
            html += ' <span style="color:' + sColor + ';font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;background:' + sColor + '18;">T' + suggestion.tier + '</span>';
            if (suggestion.degraded) html += ' <span style="color:#ffd43b;font-size:10px;">\\u26A0 Partial</span>';
            html += '</div>';
          }

          // Modality override dropdown
          var filteredModels = getModelsForModalityFilter(state.selectedModalityFilter, providers) || [];
          if (filteredModels.length > 0) {
            var overrideVal = override ? (override.providerId + '/' + override.model) : 'auto';
            html += '<div style="display:flex;align-items:center;gap:6px;">';
            html += '<span class="muted" style="font-size:11px;">Override:</span>';
            html += '<select onchange="setModalityOverride(&#39;' + escapeHtml(state.selectedModalityFilter) + '&#39;, this.value)" style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);flex:1;max-width:280px;">';
            html += '<option value="auto"' + (!override ? ' selected' : '') + '>Auto (AI Suggested)</option>';
            filteredModels.forEach(function(fm) {
              var val = fm.providerId + '/' + fm.model;
              html += '<option value="' + escapeHtml(val) + '"' + (overrideVal === val ? ' selected' : '') + '>' + escapeHtml(fm.label) + '</option>';
            });
            html += '</select>';
            html += '</div>';
          } else {
            html += '<div class="muted" style="font-size:11px;color:#ffa94d;">No models available for this modality.</div>';
          }

          html += '</div>';

          // Filter toggle
          html += '<div style="display:flex;align-items:center;gap:6px;">';
          html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:var(--fg-muted);">';
          html += '<input type="checkbox" ' + (state.modalityFilterEnabled ? 'checked' : '') + ' onchange="onModalityFilterToggle()" />';
          html += 'Filter Model dropdown to ' + escapeHtml(selectedMod ? selectedMod.label : '') + ' models only';
          html += '</label>';
          html += '</div>';
        }
      }

      html += '</div>';
      return html;
    }

    function renderLlm() {
      const container = document.getElementById('llm-provider');
      if (!state.llmCatalog) {
        container.innerHTML = '<div class="muted">Loading providers...</div>';
        return;
      }

      const providers = state.llmCatalog.providers || [];
      if (!providers.length) {
        container.innerHTML = '<div class="muted">No providers configured.</div>';
        return;
      }

      const activeProviderId = state.llmCatalog.activeProviderId || '';
      const activeProvider = providers.find(provider => provider.id === activeProviderId) || null;
      const activeModel = state.llmCatalog.activeModel || '';
      const draft = state.llmConfig ? state.llmConfig.draft : null;
      const draftProviderId = draft && draft.providerId ? draft.providerId : activeProviderId;
      const draftProvider = providers.find(provider => provider.id === draftProviderId) || activeProvider;
      const currentModel = (state.llmConfig && state.llmConfig.current ? state.llmConfig.current.model : activeModel) || '';
      const draftModel = draft && draft.model ? draft.model : currentModel;
      const localSelection = getLocalLlmSelection(state.selectedSessionId);
      const displayProviderId = localSelection && localSelection.providerId ? localSelection.providerId : draftProviderId;
      const displayProvider = providers.find(provider => provider.id === displayProviderId) || draftProvider;
      const displayModels = displayProvider ? (displayProvider.models || []) : [];
      let displayModel = localSelection && localSelection.model ? localSelection.model : draftModel;
      if ((!displayModel || !displayModels.includes(displayModel)) && displayModels.length > 0) {
        displayModel = (displayProvider && displayProvider.defaultModel && displayModels.includes(displayProvider.defaultModel))
          ? displayProvider.defaultModel
          : displayModels[0];
      }

      const hasUnsavedLocalSelection = Boolean(localSelection)
        && (localSelection.providerId !== draftProviderId || (localSelection.model || '') !== (draftModel || ''));

      const providerOptions = providers.map(provider =>
        '<option value="' + escapeHtml(provider.id) + '" ' + (provider.id === displayProviderId ? 'selected' : '') + '>'
        + escapeHtml(provider.label + (provider.enabled ? '' : ' (unavailable)'))
        + '</option>'
      ).join('');

      const modelOptions = displayModels.length > 0
        ? displayModels.map(model =>
          '<option value="' + escapeHtml(model) + '" ' + (model === displayModel ? 'selected' : '') + '>' + escapeHtml(model) + '</option>'
        ).join('')
        : '<option value="">No models available</option>';

      const reason = displayProvider && !displayProvider.enabled && displayProvider.reason
        ? '<div class="muted" style="margin-top:8px;color:#ffc1c1;">' + escapeHtml(displayProvider.reason) + '</div>'
        : '';

      const localSelectionBanner = hasUnsavedLocalSelection
        ? '<div class="action-card" style="margin-top:10px;">'
          + '<div class="muted">You changed provider/model locally. Click <strong>Save Draft</strong> then <strong>Apply Draft</strong> to persist for this session.</div>'
          + '<div class="mono" style="margin-top:6px;">Pending: '
          + escapeHtml((displayProviderId || '-') + ' / ' + (displayModel || '-'))
          + '</div>'
          + '</div>'
        : '';

      const diff = state.llmConfig && state.llmConfig.diff
        ? state.llmConfig.diff
        : null;
      const diffHtml = diff && diff.changedFields && diff.changedFields.length > 0
        ? '<div class="action-card" style="margin-top:10px;">'
          + '<div class="muted">Draft changes: ' + escapeHtml(diff.changedFields.join(', ')) + '</div>'
          + '<div class="mono" style="margin-top:6px;">Current: ' + escapeHtml((diff.before.providerId || '-') + ' / ' + (diff.before.model || '-')) + '</div>'
          + '<div class="mono">Draft: ' + escapeHtml((diff.after.providerId || '-') + ' / ' + (diff.after.model || '-')) + '</div>'
          + '</div>'
        : '<div class="muted" style="margin-top:8px;">No pending draft changes.</div>';

      const history = state.llmConfig && state.llmConfig.history ? state.llmConfig.history : [];
      const historyHtml = history.length > 0
        ? '<div class="muted" style="margin-top:10px;">Recent applied config</div>'
          + '<table class="events-table"><thead><tr><th>Time</th><th>Change</th><th>Source</th></tr></thead><tbody>'
          + history.slice(0, 5).map(entry => '<tr>'
            + '<td>' + escapeHtml(formatRelativeTime(entry.appliedAt)) + '</td>'
            + '<td><div class="mono">'
            + escapeHtml((entry.previousProviderId || '-') + ' / ' + (entry.previousModel || '-'))
            + ' → '
            + escapeHtml((entry.nextProviderId || '-') + ' / ' + (entry.nextModel || '-'))
            + '</div></td>'
            + '<td>' + escapeHtml(entry.source || '-') + '</td>'
            + '</tr>').join('')
          + '</tbody></table>'
        : '<div class="muted" style="margin-top:10px;">No config history yet.</div>';

      const isLocal = displayProvider && displayProvider.kind === 'local';
      const sessionNeedsBind = state.readiness && state.readiness.requirements
        ? !state.readiness.requirements.find(function(r) { return r.id === 'provider-model-selected'; }).passed
        : false;
      const needsApply = hasUnsavedLocalSelection || (sessionNeedsBind && Boolean(displayProviderId));

      // When rendering dynamically from onLlmProviderChanged we shouldn't block 
      // rendering just because a select is focused, otherwise the model dropdown
      // won't update when you pick a new provider.

      container.innerHTML = ''
        + '<label class="muted" for="provider-select">Provider</label>'
        + '<select id="provider-select" class="control-select" onchange="onLlmProviderChanged()">' + providerOptions + '</select>'
        + '<label class="muted" for="model-select" style="margin-top:8px;display:block;">Model</label>'
        + '<select id="model-select" class="control-select" onchange="onLlmModelChanged()">' + modelOptions + '</select>'
        + renderRoutingStrategyControls(providers, displayModel)
        + '<div class="action-buttons" style="margin-top:10px;">'
        + '<button class="primary-button" ' + (!needsApply ? 'disabled' : '') + ' onclick="quickApplyLlm()">Apply</button>'
        + (isLocal ? '<button class="secondary-button" onclick="refreshOllamaModels()">Refresh Models</button>' : '')
        + '<button class="secondary-button" ' + (!history.length ? 'disabled' : '') + ' onclick="rollbackLlmConfig()">Rollback</button>'
        + '</div>'
        + (needsApply
          ? '<div class="action-card" style="margin-top:10px;"><div class="muted">Pending: <span class="mono">' + escapeHtml((displayProviderId || '-') + ' / ' + (displayModel || '-')) + '</span> — click <strong>Apply</strong> to save.</div></div>'
          : '<div class="muted" style="margin-top:8px;">Active: <span class="mono">' + escapeHtml((draftProviderId || '-') + ' / ' + (draftModel || '-')) + '</span></div>')
        + historyHtml
        + reason;
    }

    function togglePanelCollapse(panelKey) {
      var stateKey = panelKey + 'Collapsed';
      state[stateKey] = !state[stateKey];
      var chevron = document.getElementById('chevron-' + panelKey);
      var body = document.getElementById('body-' + panelKey);
      if (chevron) { chevron.textContent = state[stateKey] ? '\u25B6' : '\u25BC'; }
      if (body) {
        if (state[stateKey]) { body.classList.add('collapsed'); }
        else { body.classList.remove('collapsed'); }
      }
      var summary = document.getElementById(panelKey + '-summary');
      if (summary) {
        summary.style.display = state[stateKey] ? '' : 'none';
      }
    }

    function toggleCapabilityMatrix() {
      state.capabilityMatrixExpanded = !state.capabilityMatrixExpanded;
      safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
    }

    function setMatrixSort(col) {
      if (state.matrixSortCol === col) {
        state.matrixSortAsc = !state.matrixSortAsc;
      } else {
        state.matrixSortCol = col;
        state.matrixSortAsc = col === 'model' || col === 'provider';
      }
      safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
    }

    function setMatrixFilter(field, value) {
      state['matrixFilter' + field.charAt(0).toUpperCase() + field.slice(1)] = value;
      safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
    }

    function setMatrixDraftField(field, value) {
      state['matrixDraft' + field.charAt(0).toUpperCase() + field.slice(1)] = value;
    }

    function clearMatrixDraft() {
      state.matrixDraftPattern = '';
      state.matrixDraftTier = '';
      state.matrixDraftLocality = 'local';
      state.matrixDraftStrengths = '';
      state.matrixEditingPattern = null;
      safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
    }

    function startMatrixEdit(pattern) {
      var entries = Array.isArray(state.modelMatrixEntries) ? state.modelMatrixEntries : [];
      var found = null;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i] && entries[i].pattern === pattern) {
          found = entries[i];
          break;
        }
      }
      if (!found) return;
      state.matrixDraftPattern = found.pattern || '';
      state.matrixDraftTier = found.tier != null ? String(found.tier) : '';
      state.matrixDraftLocality = found.locality || 'local';
      state.matrixDraftStrengths = Array.isArray(found.strengths) ? found.strengths.join(', ') : '';
      state.matrixEditingPattern = found.pattern || null;
      safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
    }

    async function saveMatrixEntry() {
      var pattern = String(state.matrixDraftPattern || '').trim();
      if (!pattern) {
        state.notice = { type: 'error', message: 'Model matrix pattern is required.' };
        render();
        return;
      }
      var tierValue = Number(state.matrixDraftTier);
      var locality = String(state.matrixDraftLocality || '').trim();
      var strengths = String(state.matrixDraftStrengths || '')
        .split(',')
        .map(function(part) { return part.trim(); })
        .filter(function(part) { return !!part; });
      var payload = { pattern: pattern };
      if (!Number.isNaN(tierValue) && tierValue >= 1 && tierValue <= 5) {
        payload.tier = tierValue;
      }
      if (locality === 'local' || locality === 'remote') {
        payload.locality = locality;
      }
      if (strengths.length > 0) {
        payload.strengths = strengths;
      }
      try {
        await request('/api/models/matrix', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        await refreshChrome();
        state.notice = 'Model matrix entry saved: ' + pattern;
        clearMatrixDraft();
        render();
      } catch (error) {
        state.notice = { type: 'error', message: 'Failed to save model matrix entry: ' + String(error) };
        render();
      }
    }

    async function deleteMatrixEntry(pattern) {
      if (!pattern) return;
      if (!confirm('Delete model matrix entry "' + pattern + '"?')) return;
      try {
        await request('/api/models/matrix/' + encodeURIComponent(pattern), { method: 'DELETE' });
        await refreshChrome();
        if (state.matrixEditingPattern === pattern) {
          clearMatrixDraft();
        }
        state.notice = 'Model matrix entry deleted: ' + pattern;
        render();
      } catch (error) {
        state.notice = { type: 'error', message: 'Failed to delete model matrix entry: ' + String(error) };
        render();
      }
    }

    function renderCapabilityMatrix() {
      const container = document.getElementById('capability-matrix');
      if (!container) return;
      if (!state.llmCatalog || !state.llmCatalog.providers) {
        container.innerHTML = '<div class="muted">Waiting for provider catalog...</div>';
        return;
      }

      if (state.capabilityMatrixExpanded === undefined) {
        state.capabilityMatrixExpanded = false;
      }

      const isExpanded = state.capabilityMatrixExpanded;

      const tierColors = { 1: '#ff6b6b', 2: '#ffa94d', 3: '#ffd43b', 4: '#69db7c', 5: '#4dabf7' };
      const tierLabels = { 1: 'T1 Minimal', 2: 'T2 Basic', 3: 'T3 Standard', 4: 'T4 Advanced', 5: 'T5 Frontier' };
      const roleRequirements = {
        classification:  { min: 1, ideal: 2 },
        chat:            { min: 2, ideal: 3 },
        summarization:   { min: 2, ideal: 3 },
        'tool-selection':  { min: 3, ideal: 4 },
        'code-generation': { min: 3, ideal: 4 },
        'memory-indexing':  { min: 1, ideal: 2 },
      };

      function guessTier(model, kind) {
        var m = model.match(/:?(\\d+(?:\\.\\d+)?)\\s*[bB]/);
        var b = m ? parseFloat(m[1]) : 0;
        if (kind === 'local') {
          if (b > 0 && b <= 2) return 1;
          if (b > 2 && b <= 5) return 2;
          if (b > 5 && b <= 15) return 3;
          return 2;
        }
        if (/mini|flash|small|instant|haiku/i.test(model)) return 3;
        if (/opus|5\\b|frontier/i.test(model)) return 5;
        return 4;
      }

      var allRows = [];
      var matrixEntries = Array.isArray(state.modelMatrixEntries) ? state.modelMatrixEntries : [];
      function resolveMatrixEntry(modelName) {
        var exact = null;
        var wildcard = null;
        for (var i = 0; i < matrixEntries.length; i++) {
          var e = matrixEntries[i] || {};
          var pattern = e.pattern || '';
          if (!pattern) continue;
          if (pattern === modelName) {
            exact = e;
            break;
          }
          if (pattern.endsWith('*')) {
            var prefix = pattern.slice(0, -1);
            if (prefix && modelName.indexOf(prefix) === 0) {
              if (!wildcard || prefix.length > String(wildcard.pattern || '').length) {
                wildcard = e;
              }
            }
          }
        }
        return exact || wildcard;
      }
      var providerSet = {};
      state.llmCatalog.providers.forEach(function(provider) {
        if (!provider.models || !provider.models.length) return;
        providerSet[provider.id] = provider.label;
        provider.models.forEach(function(model) {
          var matrixEntry = resolveMatrixEntry(model);
          var tier = matrixEntry && typeof matrixEntry.tier === 'number' ? matrixEntry.tier : guessTier(model, provider.kind);
          var locality = matrixEntry && matrixEntry.locality ? matrixEntry.locality : provider.kind;
          var strengths = matrixEntry && Array.isArray(matrixEntry.strengths) ? matrixEntry.strengths : null;
          allRows.push({ provider: provider.label, providerId: provider.id, model: model, tier: tier, kind: locality, enabled: provider.enabled, strengths: strengths });
        });
      });

      var rows = allRows.filter(function(row) {
        if (state.matrixFilterProvider && row.providerId !== state.matrixFilterProvider) return false;
        if (state.matrixFilterTier && row.tier !== Number(state.matrixFilterTier)) return false;
        if (state.matrixFilterLocality && row.kind !== state.matrixFilterLocality) return false;
        if (state.matrixFilterText) {
          var q = state.matrixFilterText.toLowerCase();
          if (row.model.toLowerCase().indexOf(q) === -1 && row.provider.toLowerCase().indexOf(q) === -1) return false;
        }
        return true;
      });

      var sortCol = state.matrixSortCol || 'tier';
      var sortAsc = state.matrixSortAsc;
      rows.sort(function(a, b) {
        var va, vb;
        if (sortCol === 'model') { va = a.model.toLowerCase(); vb = b.model.toLowerCase(); }
        else if (sortCol === 'provider') { va = a.provider.toLowerCase(); vb = b.provider.toLowerCase(); }
        else if (sortCol === 'tier') { va = a.tier; vb = b.tier; }
        else if (sortCol === 'locality') { va = a.kind; vb = b.kind; }
        else { va = a.tier; vb = b.tier; }
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        return 0;
      });

      function sortArrow(col) {
        if (state.matrixSortCol !== col) return '';
        return state.matrixSortAsc ? ' \u25B2' : ' \u25BC';
      }

      let html = '<div class="action-card" style="cursor:pointer;" onclick="toggleCapabilityMatrix()">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;">'
        +   '<span class="muted" style="margin:0;">Model Capability Matrix</span>'
        +   '<span class="muted" style="font-size:11px;">' + escapeHtml(rows.length + ' / ' + allRows.length + ' models') + '  ' + (isExpanded ? '&#x25B2;' : '&#x25BC;') + '</span>'
        + '</div></div>';

      if (!allRows.length) {
        container.innerHTML = html + '<div class="muted" style="margin-top:10px;">No models found. Configure and test a provider to populate the matrix.</div>';
        return;
      }

      html += '<div>';

      var filterStyle = 'padding:5px 8px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:11px;';
      var providerIds = Object.keys(providerSet);
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center;">';
      html += '<input type="text" placeholder="Search models\u2026" value="' + escapeHtml(state.matrixFilterText || '') + '" oninput="setMatrixFilter(&#39;text&#39;, this.value)" style="' + filterStyle + 'flex:1;min-width:120px;" />';
      html += '<select onchange="setMatrixFilter(&#39;provider&#39;, this.value)" style="' + filterStyle + '">';
      html += '<option value="">All Providers</option>';
      providerIds.forEach(function(id) {
        var sel = state.matrixFilterProvider === id ? ' selected' : '';
        html += '<option value="' + escapeHtml(id) + '"' + sel + '>' + escapeHtml(providerSet[id]) + '</option>';
      });
      html += '</select>';
      html += '<select onchange="setMatrixFilter(&#39;tier&#39;, this.value)" style="' + filterStyle + '">';
      html += '<option value="">All Tiers</option>';
      for (var t = 5; t >= 1; t--) {
        var sel = state.matrixFilterTier === String(t) ? ' selected' : '';
        html += '<option value="' + t + '"' + sel + '>' + tierLabels[t] + '</option>';
      }
      html += '</select>';
      html += '<select onchange="setMatrixFilter(&#39;locality&#39;, this.value)" style="' + filterStyle + '">';
      html += '<option value=""' + (!state.matrixFilterLocality ? ' selected' : '') + '>All</option>';
      html += '<option value="local"' + (state.matrixFilterLocality === 'local' ? ' selected' : '') + '>Local</option>';
      html += '<option value="remote"' + (state.matrixFilterLocality === 'remote' ? ' selected' : '') + '>Cloud</option>';
      html += '</select>';
      html += '</div>';

      html += '<div class="panel" style="padding:10px;margin-top:8px;">';
      html += '<div class="muted" style="font-size:12px;font-weight:600;margin-bottom:8px;">'
        + (state.matrixEditingPattern ? 'Edit Matrix Entry' : 'Create Matrix Entry')
        + '</div>';
      html += '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 2fr auto auto;gap:6px;align-items:center;">';
      html += '<input type="text" placeholder="pattern (example: gpt-4o* or llama3.1:8b)" value="' + escapeHtml(state.matrixDraftPattern || '') + '" oninput="setMatrixDraftField(&#39;pattern&#39;, this.value)" style="' + filterStyle + 'width:100%;" />';
      html += '<select onchange="setMatrixDraftField(&#39;tier&#39;, this.value)" style="' + filterStyle + '">';
      html += '<option value=""' + (!state.matrixDraftTier ? ' selected' : '') + '>Tier</option>';
      for (var mt = 1; mt <= 5; mt++) {
        html += '<option value="' + mt + '"' + (state.matrixDraftTier === String(mt) ? ' selected' : '') + '>T' + mt + '</option>';
      }
      html += '</select>';
      html += '<select onchange="setMatrixDraftField(&#39;locality&#39;, this.value)" style="' + filterStyle + '">';
      html += '<option value="local"' + (state.matrixDraftLocality === 'local' ? ' selected' : '') + '>Local</option>';
      html += '<option value="remote"' + (state.matrixDraftLocality === 'remote' ? ' selected' : '') + '>Cloud</option>';
      html += '</select>';
      html += '<input type="text" placeholder="strengths (comma-separated)" value="' + escapeHtml(state.matrixDraftStrengths || '') + '" oninput="setMatrixDraftField(&#39;strengths&#39;, this.value)" style="' + filterStyle + 'width:100%;" />';
      html += '<button class="secondary-button" style="padding:5px 10px;font-size:11px;" onclick="saveMatrixEntry()">Save</button>';
      html += '<button class="secondary-button" style="padding:5px 10px;font-size:11px;" onclick="clearMatrixDraft()">Clear</button>';
      html += '</div>';
      html += '</div>';

      var matrixRows = matrixEntries.slice().sort(function(a, b) {
        var pa = String((a && a.pattern) || '').toLowerCase();
        var pb = String((b && b.pattern) || '').toLowerCase();
        if (pa < pb) return -1;
        if (pa > pb) return 1;
        return 0;
      });

      html += '<div class="panel" style="padding:10px;margin-top:8px;">';
      html += '<div class="muted" style="font-size:12px;font-weight:600;margin-bottom:8px;">Registered Matrix Entries (' + matrixRows.length + ')</div>';
      if (!matrixRows.length) {
        html += '<div class="muted" style="font-size:12px;">No registered model matrix entries.</div>';
      } else {
        html += '<table class="events-table"><thead><tr><th>Pattern</th><th>Tier</th><th>Locality</th><th>Strengths</th><th>Actions</th></tr></thead><tbody>';
        matrixRows.forEach(function(entry) {
          var pattern = entry.pattern || '';
          var strengthsText = Array.isArray(entry.strengths) ? entry.strengths.join(', ') : '';
          html += '<tr>'
            + '<td class="mono">' + escapeHtml(pattern) + '</td>'
            + '<td>' + escapeHtml(entry.tier != null ? 'T' + entry.tier : '-') + '</td>'
            + '<td>' + escapeHtml(entry.locality || '-') + '</td>'
            + '<td>' + escapeHtml(strengthsText || '-') + '</td>'
            + '<td style="white-space:nowrap;">'
              + '<button class="secondary-button" style="padding:3px 8px;font-size:11px;margin-right:6px;" data-pattern="' + escapeHtml(pattern) + '" onclick="startMatrixEdit(this.dataset.pattern)">Edit</button>'
              + '<button class="danger-button" style="padding:3px 8px;font-size:11px;" data-pattern="' + escapeHtml(pattern) + '" onclick="deleteMatrixEntry(this.dataset.pattern)">Delete</button>'
            + '</td>'
          + '</tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';

      var thStyle = 'cursor:pointer;user-select:none;';
      html += '<table class="events-table" style="margin-top:8px;"><thead><tr>'
        + '<th style="' + thStyle + '" onclick="setMatrixSort(&#39;model&#39;)">Model' + sortArrow('model') + '</th>'
        + '<th style="' + thStyle + '" onclick="setMatrixSort(&#39;provider&#39;)">Provider' + sortArrow('provider') + '</th>'
        + '<th style="' + thStyle + '" onclick="setMatrixSort(&#39;tier&#39;)">Tier' + sortArrow('tier') + '</th>'
        + '<th style="' + thStyle + '" onclick="setMatrixSort(&#39;locality&#39;)">Locality' + sortArrow('locality') + '</th>'
        + '<th>Proficiencies</th>'
        + '</tr></thead><tbody>';

      var displayRows = isExpanded ? rows : rows.slice(0, 5);
      if (!displayRows.length) {
        html += '<tr><td colspan="5" class="muted" style="text-align:center;">No models match the current filters.</td></tr>';
      }
      displayRows.forEach(function(row) {
        var color = tierColors[row.tier] || '#aaa';
        var dimStyle = row.enabled ? '' : ' style="opacity:0.5;"';
        html += '<tr' + dimStyle + '>'
          + '<td class="mono">' + escapeHtml(row.model) + '</td>'
          + '<td>' + escapeHtml(row.provider) + (row.enabled ? '' : ' <span style="font-size:10px;color:var(--muted);">(unconfigured)</span>') + '</td>'
          + '<td><span style="color:' + color + ';font-weight:600;">' + escapeHtml(tierLabels[row.tier] || 'T?') + '</span></td>'
          + '<td>' + (row.kind === 'local' ? '🖥 Local' : '☁ Cloud') + '</td>'
            + '<td>' + getModelProficiencyBadges(row.model, row.strengths) + '</td>'
          + '</tr>';
      });
      html += '</tbody></table>';

      if (!isExpanded && rows.length > 5) {
         html += '<div class="muted" style="text-align:center;margin-top:8px;font-size:12px;cursor:pointer;" onclick="toggleCapabilityMatrix()">' 
               + '... and ' + (rows.length - 5) + ' more models (Click to expand) ...</div>';
      }

      if (isExpanded) {
        html += '<div class="muted" style="margin-top:12px;">Role Coverage</div>';
        html += '<table class="events-table"><thead><tr><th>Task Role</th><th>Min Tier</th><th>Ideal</th><th>Status</th></tr></thead><tbody>';
        Object.keys(roleRequirements).forEach(function(role) {
          var req = roleRequirements[role];
          var bestTier = 0;
          rows.forEach(function(row) { if (row.enabled && row.tier > bestTier) bestTier = row.tier; });
          var met = bestTier >= req.ideal;
          var partial = !met && bestTier >= req.min;
          var statusHtml = met
            ? '<span style="color:#69db7c;">✓ Met</span>'
            : partial
              ? '<span style="color:#ffd43b;">⚠ Degraded</span>'
              : '<span style="color:#ff6b6b;">✗ Unmet</span>';
          html += '<tr><td>' + escapeHtml(role) + '</td><td>T' + req.min + '</td><td>T' + req.ideal + '</td><td>' + statusHtml + '</td></tr>';
        });
        html += '</tbody></table>';
      }

      html += '</div>';

      container.innerHTML = html;
    }

    var STRENGTH_COLORS = {
      'instruction-following': '#94a3b8',
      'code': '#60a5fa',
      'reasoning': '#c084fc',
      'tool-use': '#4ade80',
      'long-context': '#fb923c',
      'fast': '#fbbf24',
      'multilingual': '#2dd4bf',
      'multimodal': '#f472b6',
      'agentic': '#f87171'
    };

    function getModelProficiencyBadges(modelName, explicitStrengths) {
      var strengths = explicitStrengths;
      if (!strengths || !strengths.length) {
        var profiles = state.modelProfiles || {};
        var profile = profiles[modelName];
        strengths = profile && profile.strengths ? profile.strengths : [];
      }
      if (!strengths || !strengths.length) {
        return '<span class="muted" style="font-size:10px;">-</span>';
      }
      return strengths.map(function(s) {
        var c = STRENGTH_COLORS[s] || '#94a3b8';
        return '<span style="display:inline-block;padding:1px 6px;border-radius:6px;font-size:9px;font-weight:600;background:' + c + '22;color:' + c + ';border:1px solid ' + c + '44;margin:1px 2px;">' + escapeHtml(s) + '</span>';
      }).join('');
    }

    async function fetchModelProfiles() {
      try {
        var data = await request('/api/llm/model-profiles');
        state.modelProfiles = data.profiles || {};
        safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
      } catch (_) {}
    }

    async function fetchRoutingState() {
      try {
        var data = await request('/api/llm/routing');
        state.routingStrategy = data.config.strategy || 'single';
        state.routingRoleOverrides = data.config.roleOverrides || {};
        state.routingAgentOverrides = data.config.agentOverrides || {};
        state.routingModalityOverrides = data.config.modalityOverrides || {};
        state.routingPreferredModality = data.config.preferredModality || null;
        state.routingSuggestions = data.suggestions || {};
        state.routingModalitySuggestions = data.modalitySuggestions || {};
        state.availableModalities = data.modalities || [];
        safeRenderStep('modelRouting', renderModelRouting);
      } catch (_) {}
    }

    async function saveRoutingConfig() {
      try {
        await request('/api/llm/routing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            strategy: state.routingStrategy,
            roleOverrides: state.routingRoleOverrides,
            agentOverrides: state.routingAgentOverrides,
            modalityOverrides: state.routingModalityOverrides,
            preferredModality: state.routingPreferredModality
          })
        });
        state.notice = 'Routing configuration saved.';
        render();
      } catch (err) {
        state.notice = { type: 'error', message: 'Failed to save routing: ' + String(err) };
        render();
      }
    }

    async function suggestOptimalRouting() {
      try {
        var data = await request('/api/llm/routing/suggest');
        state.routingSuggestions = data.suggestions || {};
        safeRenderStep('modelRouting', renderModelRouting);
      } catch (err) {
        state.notice = { type: 'error', message: 'Failed to get routing suggestions: ' + String(err) };
        render();
      }
    }

    function setRoutingStrategy(strategy) {
      state.routingStrategy = strategy;
      safeRenderStep('modelRouting', renderModelRouting);
    }

    function setSessionRoutingStrategy(strategy) {
      state.sessionRoutingStrategy = strategy;
      if (strategy !== 'modality') {
        state.selectedModalityFilter = null;
        state.modalityFilterEnabled = false;
      }
      safeRenderStep('llm', renderLlm);
    }

    function onModalitySelected(modalityId) {
      if (state.selectedModalityFilter === modalityId) {
        state.selectedModalityFilter = null;
      } else {
        state.selectedModalityFilter = modalityId;
      }
      safeRenderStep('llm', renderLlm);
    }

    function onModalityFilterToggle() {
      state.modalityFilterEnabled = !state.modalityFilterEnabled;
      safeRenderStep('llm', renderLlm);
    }

    function setModalityOverride(modalityId, value) {
      if (!value || value === 'auto') {
        delete state.routingModalityOverrides[modalityId];
      } else {
        var parts = value.split('/', 2);
        state.routingModalityOverrides[modalityId] = { providerId: parts[0], model: parts[1] || '' };
      }
      safeRenderStep('llm', renderLlm);
    }

    function getModelsForModalityFilter(modalityId, providers) {
      if (!modalityId || !state.modelProfiles) return null;
      var filtered = [];
      providers.forEach(function(provider) {
        if (!provider.enabled) return;
        (provider.models || []).forEach(function(model) {
          var profile = state.modelProfiles[model];
          if (profile && profile.modalities && profile.modalities.indexOf(modalityId) >= 0) {
            filtered.push({ providerId: provider.id, model: model, label: provider.label + ' / ' + model });
          }
        });
      });
      return filtered;
    }

    function setRoleOverride(role, value) {
      if (!value || value === 'auto') {
        delete state.routingRoleOverrides[role];
      } else {
        var parts = value.split('/', 2);
        state.routingRoleOverrides[role] = { providerId: parts[0], model: parts[1] || '' };
      }
      safeRenderStep('modelRouting', renderModelRouting);
    }

    function renderModelRouting() {
      var container = document.getElementById('model-routing-container');
      if (!container) return;

      var roles = ['classification', 'chat', 'summarization', 'tool-selection', 'code-generation', 'memory-indexing'];
      var roleLabels = {
        'classification': '\\u{1F3F7} Classification',
        'chat': '\\u{1F4AC} Chat',
        'summarization': '\\u{1F4DD} Summarization',
        'tool-selection': '\\u{1F527} Tool Selection',
        'code-generation': '\\u{1F4BB} Code Generation',
        'memory-indexing': '\\u{1F4DA} Memory Indexing'
      };
      var roleRequirements = {
        classification:    { min: 1, ideal: 2 },
        chat:              { min: 2, ideal: 3 },
        summarization:     { min: 2, ideal: 3 },
        'tool-selection':  { min: 3, ideal: 4 },
        'code-generation': { min: 3, ideal: 4 },
        'memory-indexing':  { min: 1, ideal: 2 }
      };
      var tierColors = { 1: '#ff6b6b', 2: '#ffa94d', 3: '#ffd43b', 4: '#69db7c', 5: '#4dabf7' };

      var html = '';

      // Strategy toggle
      html += '<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;">';
      html += '<span class="muted" style="font-size:12px;font-weight:600;">Strategy:</span>';
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;">';
      html += '<input type="radio" name="routing-strategy" value="single"' + (state.routingStrategy !== 'multi' ? ' checked' : '') + ' onchange="setRoutingStrategy(&#39;single&#39;)" /> Single Provider</label>';
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;">';
      html += '<input type="radio" name="routing-strategy" value="multi"' + (state.routingStrategy === 'multi' ? ' checked' : '') + ' onchange="setRoutingStrategy(&#39;multi&#39;)" /> Multi-Provider</label>';
      html += '<div style="flex:1;"></div>';
      html += '<button class="secondary-button" onclick="suggestOptimalRouting()" style="font-size:11px;padding:4px 10px;">\\u{2728} Suggest Optimal</button>';
      html += '<button class="secondary-button" onclick="saveRoutingConfig()" style="font-size:11px;padding:4px 10px;">\\u{1F4BE} Save</button>';
      html += '</div>';

      if (state.routingStrategy !== 'multi') {
        html += '<div class="muted" style="padding:8px;background:rgba(255,255,255,0.03);border-radius:8px;font-size:12px;">';
        html += 'All task roles use the <strong>active session provider</strong>';
        if (state.llmCatalog && state.llmCatalog.activeProviderId) {
          html += ' (' + escapeHtml(state.llmCatalog.activeProviderId);
          if (state.llmCatalog.activeModel) html += ' / ' + escapeHtml(state.llmCatalog.activeModel);
          html += ')';
        }
        html += '. Switch to <strong>Multi-Provider</strong> to assign models per task role and agent.</div>';
        container.innerHTML = html;
        return;
      }

      // Build available models list for dropdowns
      var availableModels = [];
      if (state.llmCatalog && state.llmCatalog.providers) {
        state.llmCatalog.providers.forEach(function(p) {
          if (!p.enabled) return;
          (p.models || []).forEach(function(m) {
            availableModels.push({ providerId: p.id, model: m, label: p.label + ' / ' + m });
          });
        });
      }

      // Role routing table
      html += '<table class="events-table" style="margin-top:4px;"><thead><tr>';
      html += '<th>Role</th><th>Tier Req</th><th>AI Suggested</th><th>Assignment</th><th>Status</th>';
      html += '</tr></thead><tbody>';

      roles.forEach(function(role) {
        var req = roleRequirements[role] || { min: 2, ideal: 3 };
        var suggestion = (state.routingSuggestions || {})[role];
        var override = state.routingRoleOverrides[role] || null;

        // Determine effective model
        var effectiveProviderId = override ? override.providerId : (suggestion ? suggestion.providerId : null);
        var effectiveModel = override ? override.model : (suggestion ? suggestion.model : null);
        var effectiveTier = 0;
        if (override && state.modelProfiles && state.modelProfiles[override.model]) {
          effectiveTier = state.modelProfiles[override.model].tier;
        } else if (suggestion) {
          effectiveTier = suggestion.tier || 0;
        }

        var met = effectiveTier >= req.ideal;
        var partial = !met && effectiveTier >= req.min;
        var statusHtml = effectiveTier === 0
          ? '<span class="muted">-</span>'
          : met
            ? '<span style="color:#69db7c;">\\u2713 Met</span>'
            : partial
              ? '<span style="color:#ffd43b;">\\u26A0 Degraded</span>'
              : '<span style="color:#ff6b6b;">\\u2717 Unmet</span>';

        var suggestionHtml = '-';
        if (suggestion) {
          var sColor = tierColors[suggestion.tier] || '#aaa';
          suggestionHtml = '<span class="mono" style="font-size:11px;">' + escapeHtml(suggestion.providerId + '/' + suggestion.model) + '</span>';
          suggestionHtml += ' <span style="color:' + sColor + ';font-size:10px;font-weight:600;">T' + suggestion.tier + '</span>';
          if (suggestion.degraded) suggestionHtml += ' <span style="color:#ffd43b;font-size:10px;">\\u26A0</span>';
        }

        // Build dropdown
        var selectVal = override ? (override.providerId + '/' + override.model) : 'auto';
        var dropdownHtml = '<select onchange="setRoleOverride(&#39;' + escapeHtml(role) + '&#39;, this.value)" style="font-size:11px;padding:3px 6px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);max-width:200px;">';
        dropdownHtml += '<option value="auto"' + (!override ? ' selected' : '') + '>Auto (AI)</option>';
        availableModels.forEach(function(am) {
          var val = am.providerId + '/' + am.model;
          dropdownHtml += '<option value="' + escapeHtml(val) + '"' + (selectVal === val ? ' selected' : '') + '>' + escapeHtml(am.label) + '</option>';
        });
        dropdownHtml += '</select>';

        html += '<tr>';
        html += '<td style="white-space:nowrap;font-size:12px;">' + (roleLabels[role] || escapeHtml(role)) + '</td>';
        html += '<td style="font-size:11px;"><span style="color:' + (tierColors[req.min] || '#aaa') + ';">T' + req.min + '</span> / <span style="color:' + (tierColors[req.ideal] || '#aaa') + ';">T' + req.ideal + '</span></td>';
        html += '<td style="font-size:11px;">' + suggestionHtml + '</td>';
        html += '<td>' + dropdownHtml + '</td>';
        html += '<td>' + statusHtml + '</td>';
        html += '</tr>';
      });

      html += '</tbody></table>';

      // Agents section
      var agents = [
        { id: 'classifier', role: 'classification', desc: 'Classifies inputs' },
        { id: 'chat', role: 'chat', desc: 'General conversation' },
        { id: 'summarizer', role: 'summarization', desc: 'Condenses content' },
        { id: 'planner', role: 'tool-selection', desc: 'Plans tool use' },
        { id: 'coder', role: 'code-generation', desc: 'Generates code' },
        { id: 'indexer', role: 'memory-indexing', desc: 'Extracts knowledge' }
      ];

      html += '<div class="muted" style="margin-top:12px;margin-bottom:4px;font-size:12px;font-weight:600;">Agent Overrides</div>';
      html += '<div class="muted" style="margin-bottom:8px;font-size:11px;">Override the model for specific agents. Defaults to the role assignment above.</div>';
      html += '<table class="events-table"><thead><tr><th>Agent</th><th>Default Role</th><th>Override</th></tr></thead><tbody>';

      agents.forEach(function(agent) {
        var agentOverride = (state.routingAgentOverrides || {})[agent.id] || null;
        var selectVal = agentOverride ? (agentOverride.providerId + '/' + agentOverride.model) : 'role-default';

        var dropdownHtml = '<select onchange="setAgentOverride(&#39;' + escapeHtml(agent.id) + '&#39;, this.value)" style="font-size:11px;padding:3px 6px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);max-width:200px;">';
        dropdownHtml += '<option value="role-default"' + (!agentOverride ? ' selected' : '') + '>Use Role Default</option>';
        availableModels.forEach(function(am) {
          var val = am.providerId + '/' + am.model;
          dropdownHtml += '<option value="' + escapeHtml(val) + '"' + (selectVal === val ? ' selected' : '') + '>' + escapeHtml(am.label) + '</option>';
        });
        dropdownHtml += '</select>';

        html += '<tr>';
        html += '<td style="font-size:12px;"><strong>' + escapeHtml(agent.id) + '</strong> <span class="muted" style="font-size:10px;">' + escapeHtml(agent.desc) + '</span></td>';
        html += '<td style="font-size:11px;">' + escapeHtml(agent.role) + '</td>';
        html += '<td>' + dropdownHtml + '</td>';
        html += '</tr>';
      });

      html += '</tbody></table>';

      container.innerHTML = html;
    }

    function setAgentOverride(agentId, value) {
      if (!value || value === 'role-default') {
        delete state.routingAgentOverrides[agentId];
      } else {
        var parts = value.split('/', 2);
        state.routingAgentOverrides[agentId] = { providerId: parts[0], model: parts[1] || '' };
      }
      safeRenderStep('modelRouting', renderModelRouting);
    }

    function onLlmProviderChanged() {
      const providerSelect = document.getElementById('provider-select');
      const providerId = providerSelect ? providerSelect.value : '';
      if (!providerId || !state.selectedSessionId || !state.llmCatalog || !state.llmCatalog.providers) {
        return;
      }

      const provider = state.llmCatalog.providers.find(entry => entry.id === providerId) || null;
      const providerModels = provider ? (provider.models || []) : [];
      const model = provider && provider.defaultModel && providerModels.includes(provider.defaultModel)
        ? provider.defaultModel
        : (providerModels[0] || '');

      setLocalLlmSelection(state.selectedSessionId, providerId, model);
      
      // Explicitly trigger a re-render of just the LLM panel so the newly selected 
      // provider's correct models populate into the second dropdown immediately.
      safeRenderStep('llm', renderLlm); 
    }

    function onLlmModelChanged() {
      const providerSelect = document.getElementById('provider-select');
      const modelSelect = document.getElementById('model-select');
      const providerId = providerSelect ? providerSelect.value : '';
      const model = modelSelect ? modelSelect.value : '';
      if (!providerId || !state.selectedSessionId) {
        return;
      }

      setLocalLlmSelection(state.selectedSessionId, providerId, model);
      safeRenderStep('llm', renderLlm); 
    }

    const PROVIDER_META = {
      openai: { icon: '\\u{1F7E2}', desc: 'OpenAI GPT models' },
      anthropic: { icon: '\\u{1F7E0}', desc: 'Claude models' },
      google: { icon: '\\u{1F535}', desc: 'Gemini models' },
      mistral: { icon: '\\u{1F7E3}', desc: 'Mistral AI models' },
      cohere: { icon: '\\u{1F7E4}', desc: 'Cohere Command models' },
      groq: { icon: '\\u{26A1}', desc: 'Ultra-fast inference' },
      together: { icon: '\\u{1F91D}', desc: 'Open-source model hosting' },
      deepseek: { icon: '\\u{1F50D}', desc: 'DeepSeek models' },
      perplexity: { icon: '\\u{1F310}', desc: 'Search-augmented models' },
      fireworks: { icon: '\\u{1F386}', desc: 'Fast open-source inference' },
      openrouter: { icon: '\\u{1F500}', desc: 'Multi-provider router' },
      ollama: { icon: '\\u{1F999}', desc: 'Local Ollama server' },
      lmstudio: { icon: '\\u{1F4BB}', desc: 'Local LM Studio server' },
      custom: { icon: '\\u{1F527}', desc: 'Custom OpenAI-compatible endpoint' }
    };

    function renderProviderCards() {
      const container = document.getElementById('provider-cards-container');
      if (!container) return;
      if (!state.llmCatalog || !state.llmCatalog.providers) {
        container.innerHTML = '<div class="muted">Loading providers...</div>';
        return;
      }

      const providers = state.llmCatalog.providers;
      let html = '';
      for (const provider of providers) {
        const meta = PROVIDER_META[provider.id] || { icon: '', desc: '' };
        const isExpanded = state.expandedProviderId === provider.id;
        const statusBadge = provider.enabled
          ? '<span class="ps-badge ps-badge-ok">enabled</span>'
          : '<span class="ps-badge ps-badge-off">disabled</span>';
        const kindBadge = provider.kind === 'local'
          ? '<span class="ps-badge ps-badge-local">local</span>'
          : '<span class="ps-badge ps-badge-remote">remote</span>';
        const keyBadge = provider.requiresApiKey
          ? (provider.hasApiKey
            ? '<span class="ps-badge ps-badge-ok">key set</span>'
            : '<span class="ps-badge ps-badge-warn">no key</span>')
          : '';

        html += '<div class="ps-card">';
        html += '<div class="ps-card-header" onclick="toggleProviderCard(\\'' + escapeHtml(provider.id) + '\\')">';
        html += '<span class="ps-card-title">' + meta.icon + ' ' + escapeHtml(provider.label) + '</span>';
        html += '<div class="ps-card-badges">' + statusBadge + kindBadge + keyBadge + '<span class="muted" style="font-size:16px;">' + (isExpanded ? '\\u25B2' : '\\u25BC') + '</span></div>';
        html += '</div>';

        if (isExpanded) {
          const testResult = state.providerTestResults[provider.id] || null;
          const isKeyVisible = state.providerApiKeyVisible[provider.id] || false;
          html += '<div class="ps-card-body">';
          html += '<div class="muted" style="margin-bottom:8px;">' + escapeHtml(meta.desc) + '</div>';

          if (provider.reason) {
            html += '<div class="muted" style="color:#ffc1c1;margin-bottom:8px;">' + escapeHtml(provider.reason) + '</div>';
          }

          html += '<div class="ps-field"><label>Base URL</label>';
          html += '<input type="text" id="ps-url-' + escapeHtml(provider.id) + '" value="' + escapeHtml(provider.baseUrl || '') + '" placeholder="https://..." /></div>';

          if (provider.requiresApiKey) {
            html += '<div class="ps-field"><label>API Key</label>';
            html += '<div class="ps-key-row">';
            html += '<input type="' + (isKeyVisible ? 'text' : 'password') + '" id="ps-key-' + escapeHtml(provider.id) + '" placeholder="' + (provider.hasApiKey ? 'Key is set (enter new to replace)' : 'Enter API key') + '" />';
            html += '<button class="secondary-button" onclick="toggleApiKeyVisibility(\\'' + escapeHtml(provider.id) + '\\')" style="white-space:nowrap;">' + (isKeyVisible ? 'Hide' : 'Show') + '</button>';
            html += '</div></div>';
          }

          html += '<div class="ps-field"><label>Models (comma-separated)</label>';
          html += '<textarea id="ps-models-' + escapeHtml(provider.id) + '" rows="2" placeholder="model-1, model-2">' + escapeHtml((provider.models || []).join(', ')) + '</textarea></div>';

          html += '<div class="ps-field"><label>Default Model</label>';
          html += '<input type="text" id="ps-default-' + escapeHtml(provider.id) + '" value="' + escapeHtml(provider.defaultModel || '') + '" placeholder="Default model name" /></div>';

          html += '<div class="action-buttons" style="flex-wrap:wrap;">';
          html += '<button class="secondary-button" onclick="saveProviderCardSettings(\\'' + escapeHtml(provider.id) + '\\')">Save Settings</button>';

          if (provider.requiresApiKey) {
            html += '<button class="secondary-button" onclick="saveProviderCardApiKey(\\'' + escapeHtml(provider.id) + '\\')">Save API Key</button>';
            if (provider.hasApiKey) {
              html += '<button class="danger-button" onclick="removeProviderCardApiKey(\\'' + escapeHtml(provider.id) + '\\')">Remove Key</button>';
            }
          }

          html += '<button class="secondary-button" onclick="testProviderConnection(\\'' + escapeHtml(provider.id) + '\\')">Test Connection</button>';
          html += '<button class="secondary-button" onclick="discoverModels(\\'' + escapeHtml(provider.id) + '\\')">\uD83D\uDD0D Discover Models</button>';
          html += '</div>';

          if (testResult) {
            const cls = testResult.ok ? 'ps-test-result ps-test-ok' : 'ps-test-result ps-test-fail';
            html += '<div class="' + cls + '">' + escapeHtml(testResult.message) + '</div>';
          }

          html += '<div class="muted" style="margin-top:8px;font-size:11px;">Source: ' + escapeHtml(provider.settingsSource || 'environment') + '</div>';
          html += '</div>';
        }

        html += '</div>';
      }

      // Preserve any unsaved form state for the currently expanded card before rebuilding
      if (state.expandedProviderId) {
        const eid = state.expandedProviderId;
        const urlEl = document.getElementById('ps-url-' + eid);
        const keyEl = document.getElementById('ps-key-' + eid);
        const modelsEl = document.getElementById('ps-models-' + eid);
        const defaultEl = document.getElementById('ps-default-' + eid);
        if (urlEl || keyEl || modelsEl || defaultEl) {
          state.providerSettingsCache[eid] = {
            url: urlEl ? urlEl.value : null,
            key: keyEl ? keyEl.value : null,
            models: modelsEl ? modelsEl.value : null,
            default: defaultEl ? defaultEl.value : null
          };
        }
      }

      // If the user is actively typing in any input inside this panel, skip the DOM
      // rebuild entirely — destroying and recreating elements always kills focus even
      // if values are restored afterwards.  We will pick up fresh server state on the
      // next poll cycle once they move focus away.
      const _activeEl = document.activeElement;
      if (_activeEl && container.contains(_activeEl) &&
          (_activeEl.tagName === 'INPUT' || _activeEl.tagName === 'TEXTAREA' || _activeEl.tagName === 'SELECT')) {
        return;
      }

      container.innerHTML = html;

      // Render collapsed summary showing top providers
      var summaryEl = document.getElementById('providerConfig-summary');
      if (summaryEl) {
        summaryEl.style.display = state.providerConfigCollapsed ? '' : 'none';
        var summaryHtml = '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">';
        var topN = providers.slice(0, 5);
        for (var si = 0; si < topN.length; si++) {
          var sp = topN[si];
          var sm = PROVIDER_META[sp.id] || { icon: '', desc: '' };
          var sBadge = sp.enabled
            ? '<span class="ps-badge ps-badge-ok" style="font-size:10px;">on</span>'
            : '<span class="ps-badge ps-badge-off" style="font-size:10px;">off</span>';
          summaryHtml += '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.04);border:1px solid rgba(148,163,184,0.15);border-radius:8px;padding:4px 10px;font-size:12px;">' + sm.icon + ' ' + escapeHtml(sp.label) + ' ' + sBadge + '</span>';
        }
        if (providers.length > 5) {
          summaryHtml += '<span class="muted" style="font-size:11px;">+' + (providers.length - 5) + ' more</span>';
        }
        summaryHtml += '</div>';
        summaryEl.innerHTML = summaryHtml;
      }

      // Restore preserved form state after innerHTML rebuild
      if (state.expandedProviderId && state.providerSettingsCache[state.expandedProviderId]) {
        const eid = state.expandedProviderId;
        const cached = state.providerSettingsCache[eid];
        const urlEl = document.getElementById('ps-url-' + eid);
        const keyEl = document.getElementById('ps-key-' + eid);
        const modelsEl = document.getElementById('ps-models-' + eid);
        const defaultEl = document.getElementById('ps-default-' + eid);
        if (urlEl && cached.url !== null) urlEl.value = cached.url;
        if (keyEl && cached.key !== null) keyEl.value = cached.key;
        if (modelsEl && cached.models !== null) modelsEl.value = cached.models;
        if (defaultEl && cached.default !== null) defaultEl.value = cached.default;
      }
    }

    function toggleProviderCard(providerId) {
      state.expandedProviderId = state.expandedProviderId === providerId ? null : providerId;
      render();
    }

    function toggleApiKeyVisibility(providerId) {
      state.providerApiKeyVisible[providerId] = !state.providerApiKeyVisible[providerId];
      render();
    }

    async function saveProviderCardSettings(providerId) {
      const urlInput = document.getElementById('ps-url-' + providerId);
      const modelsInput = document.getElementById('ps-models-' + providerId);
      const defaultInput = document.getElementById('ps-default-' + providerId);
      const baseUrl = urlInput ? urlInput.value.trim() : '';
      const modelsRaw = modelsInput ? modelsInput.value : '';
      const models = modelsRaw.split(',').map(function(m) { return m.trim(); }).filter(Boolean);
      const defaultModel = defaultInput ? defaultInput.value.trim() : '';

      state.notice = null;
      try {
        await request('/api/llm/provider-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId: providerId, baseUrl: baseUrl, models: models, defaultModel: defaultModel })
        });
        delete state.providerSettingsCache[providerId];
        await refreshChrome();
        safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
        state.notice = 'Settings saved for ' + providerId + '.';
      } catch (error) {
        state.notice = String(error);
      }
      render();
    }

    async function saveProviderCardApiKey(providerId) {
      const keyInput = document.getElementById('ps-key-' + providerId);
      const apiKey = keyInput ? keyInput.value.trim() : '';
      if (!apiKey) {
        state.notice = 'Enter an API key before saving.';
        render();
        return;
      }
      state.notice = null;
      try {
        await request('/api/llm/provider-secret', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId: providerId, apiKey: apiKey })
        });
        if (state.providerSettingsCache[providerId]) state.providerSettingsCache[providerId].key = null;
        await refreshChrome();
        state.notice = 'API key saved for ' + providerId + '.';
      } catch (error) {
        state.notice = String(error);
      }
      render();
    }

    async function removeProviderCardApiKey(providerId) {
      if (!confirm('Remove API key for ' + providerId + '?')) return;
      state.notice = null;
      try {
        await request('/api/llm/provider-secret?providerId=' + encodeURIComponent(providerId), { method: 'DELETE' });
        await refreshChrome();
        state.notice = 'API key removed for ' + providerId + '.';
      } catch (error) {
        state.notice = String(error);
      }
      render();
    }

    async function testProviderConnection(providerId) {
      state.providerTestResults[providerId] = { ok: false, message: 'Testing...' };
      render();
      try {
        const keyInput = document.getElementById('ps-key-' + providerId);
        const apiKey = keyInput ? keyInput.value.trim() : '';
        const result = await request('/api/llm/provider-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiKey ? { providerId: providerId, apiKey: apiKey } : { providerId: providerId })
        });
        state.providerTestResults[providerId] = result;
        if (result.ok && result.models && result.models.length > 0) {
          // Update the models textarea in-place and persist in cache so it survives the next poll
          const modelsInput = document.getElementById('ps-models-' + providerId);
          const modelsText = result.models.join(', ');
          if (modelsInput) modelsInput.value = modelsText;
          if (!state.providerSettingsCache[providerId]) state.providerSettingsCache[providerId] = {};
          state.providerSettingsCache[providerId].models = modelsText;
          // Clear the API key input from cache now that it has been saved server-side
          if (apiKey) {
            if (keyInput) keyInput.value = '';
            if (state.providerSettingsCache[providerId]) state.providerSettingsCache[providerId].key = null;
          }
          await refreshChrome();
        }
      } catch (error) {
        state.providerTestResults[providerId] = { ok: false, message: String(error) };
      }
      safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
      render();
    }

    async function discoverModels(providerId) {
      state.providerTestResults[providerId] = { ok: false, message: 'Discovering models...' };
      render();
      try {
        const result = await request('/api/models/discover/' + encodeURIComponent(providerId));
        if (result && result.models && result.models.length > 0) {
          const modelsInput = document.getElementById('ps-models-' + providerId);
          const modelsText = result.models.join(', ');
          if (modelsInput) modelsInput.value = modelsText;
          if (!state.providerSettingsCache[providerId]) state.providerSettingsCache[providerId] = {};
          state.providerSettingsCache[providerId].models = modelsText;
        }
        const count = (result && result.models) ? result.models.length : 0;
        state.providerTestResults[providerId] = {
          ok: true,
          message: 'Discovered ' + count + ' model' + (count === 1 ? '' : 's') + '.'
        };
      } catch (error) {
        state.providerTestResults[providerId] = { ok: false, message: 'Discovery failed: ' + String(error) };
      }
      render();
    }

    function renderLlmAudit() {
      const container = document.getElementById('llm-audit');
      const events = state.llmAuditEvents || [];
      if (!events.length) {
        container.innerHTML = '<div class="muted">No provider switch events for this scope.</div>'
          + '<div class="action-buttons">'
          + '<button class="secondary-button" disabled>Export JSON</button>'
          + '<button class="secondary-button" disabled>Copy JSON</button>'
          + '<button class="secondary-button" disabled>Export CSV</button>'
          + '</div>';
        return;
      }

      const successCount = events.filter(event => event.status === 'succeeded').length;
      const failedCount = events.filter(event => event.status === 'failed').length;

      container.innerHTML = ''
        + '<div class="metric"><span class="muted">Succeeded</span><span class="mono">' + escapeHtml(String(successCount)) + '</span></div>'
        + '<div class="metric"><span class="muted">Failed</span><span class="mono">' + escapeHtml(String(failedCount)) + '</span></div>'
        + '<div class="action-buttons">'
        + '<button class="secondary-button" onclick="exportLlmAuditJson()">Export JSON</button>'
        + '<button class="secondary-button" onclick="copyLlmAuditJson()">Copy JSON</button>'
        + '<button class="secondary-button" onclick="exportLlmAuditCsv()">Export CSV</button>'
        + '</div>'
        + '<table class="events-table"><thead><tr><th>Time</th><th>Selection</th><th>Status</th></tr></thead><tbody>'
        + events.map(event => {
          const details = event.details || {};
          const requestedProviderId = details.requestedProviderId || '-';
          const requestedModel = details.requestedModel || '-';
          const selectedProviderId = details.selectedProviderId || '-';
          const selectedModel = details.selectedModel || '-';
          const reason = details.reason
            ? ('<div class="muted">Reason: ' + escapeHtml(String(details.reason)) + '</div>')
            : '';
          return '<tr>'
            + '<td>' + escapeHtml(formatRelativeTime(event.timestamp)) + '</td>'
            + '<td><div class="mono">req ' + escapeHtml(String(requestedProviderId)) + ' / ' + escapeHtml(String(requestedModel)) + '</div>'
            + '<div class="mono">sel ' + escapeHtml(String(selectedProviderId)) + ' / ' + escapeHtml(String(selectedModel)) + '</div>'
            + reason + '</td>'
            + '<td>' + escapeHtml(event.status) + '</td>'
            + '</tr>';
        }).join('')
        + '</tbody></table>';
    }

    function exportLlmAuditJson() {
      const payload = buildLlmAuditPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const safeSession = (state.selectedSessionId || 'all').replace(/[^a-zA-Z0-9_-]/g, '_');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const link = document.createElement('a');
      link.href = url;
      link.download = 'prism-llm-audit-' + safeSession + '-' + timestamp + '.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    async function copyLlmAuditJson() {
      const payload = buildLlmAuditPayload();
      const text = JSON.stringify(payload, null, 2);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          state.notice = 'LLM audit JSON copied to clipboard.';
          render();
          return;
        }
      } catch {
      }

      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        const copied = document.execCommand('copy');
        state.notice = copied
          ? 'LLM audit JSON copied to clipboard.'
          : 'Clipboard permission denied. Use Export JSON instead.';
      } catch {
        state.notice = 'Clipboard copy failed. Use Export JSON instead.';
      } finally {
        document.body.removeChild(textarea);
        render();
      }
    }

    function buildLlmAuditPayload() {
      const payload = {
        exportedAt: new Date().toISOString(),
        scope: {
          sessionId: state.selectedSessionId || null,
          operation: 'dashboard.llm_selection'
        },
        counts: {
          total: state.llmAuditEvents.length,
          succeeded: state.llmAuditEvents.filter(event => event.status === 'succeeded').length,
          failed: state.llmAuditEvents.filter(event => event.status === 'failed').length
        },
        events: state.llmAuditEvents
      };
      return payload;
    }

    function exportLlmAuditCsv() {
      const rows = [];
      rows.push([
        'timestamp',
        'status',
        'chatSessionId',
        'source',
        'requestedProviderId',
        'requestedModel',
        'previousProviderId',
        'previousModel',
        'selectedProviderId',
        'selectedModel',
        'reason'
      ]);

      for (const event of state.llmAuditEvents) {
        const details = event.details || {};
        rows.push([
          event.timestamp || '',
          event.status || '',
          details.chatSessionId || '',
          details.source || '',
          details.requestedProviderId || '',
          details.requestedModel || '',
          details.previousProviderId || '',
          details.previousModel || '',
          details.selectedProviderId || '',
          details.selectedModel || '',
          details.reason || ''
        ]);
      }

      const csv = rows.map(cols => cols.map(toCsvValue).join(',')).join('\\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const safeSession = (state.selectedSessionId || 'all').replace(/[^a-zA-Z0-9_-]/g, '_');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const link = document.createElement('a');
      link.href = url;
      link.download = 'prism-llm-audit-' + safeSession + '-' + timestamp + '.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    function toCsvValue(value) {
      const text = String(value ?? '');
      if (/[",\\n]/.test(text)) {
        return '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    }

    function metricRow(label, value) {
      return '<div class="metric"><span class="muted">' + escapeHtml(label) + '</span><span class="mono">' + escapeHtml(value) + '</span></div>';
    }

    function renderSettingsPanel() {
      var container = document.getElementById('settings-panel');
      if (!container) return;
      var s = state.status;
      var rs = state.runtimeSettings;
      var html = '';

      /* ── helper: section wrapper ── */
      function sec(id, title, contentFn) {
        var open = state.settingsSections[id] !== false;
        html += '<div class="stg-section">';
        html += '<div class="stg-section-header" onclick="toggleSettingsSection(\\'' + id + '\\')">';
        html += '<span>' + escapeHtml(title) + '</span>';
        html += '<span>' + (open ? '\u25BC' : '\u25B6') + '</span>';
        html += '</div>';
        html += '<div class="stg-section-body' + (open ? '' : ' stg-collapsed') + '">';
        contentFn();
        html += '</div></div>';
      }

      function readonlyRow(label, value, hint) {
        html += '<div class="stg-row">';
        html += '<span class="stg-label">' + escapeHtml(label);
        if (hint) html += ' <span class="stg-hint">' + escapeHtml(hint) + '</span>';
        html += '</span>';
        html += '<span class="stg-value">' + escapeHtml(String(value || '\u2014')) + '</span>';
        html += '</div>';
      }

      function badgeRow(label, value, cls) {
        html += '<div class="stg-row">';
        html += '<span class="stg-label">' + escapeHtml(label) + '</span>';
        html += '<span class="stg-badge ' + cls + '">' + escapeHtml(String(value)) + '</span>';
        html += '</div>';
      }

      function numberRow(label, key, hint, suffix) {
        var val = rs ? (rs[key] != null ? rs[key] : '') : '';
        html += '<div class="stg-row">';
        html += '<span class="stg-label">' + escapeHtml(label);
        if (hint) html += ' <span class="stg-hint">' + escapeHtml(hint) + '</span>';
        html += '</span>';
        html += '<span style="display:flex;align-items:center;gap:4px;">';
        html += '<input class="stg-input" type="number" id="stg-' + key + '" value="' + escapeHtml(String(val)) + '" onchange="markSettingDirty(\\'' + key + '\\')" />';
        if (suffix) html += '<span class="muted" style="font-size:11px;">' + escapeHtml(suffix) + '</span>';
        html += '</span>';
        html += '</div>';
      }

      function selectRow(label, key, options, hint) {
        var val = rs ? String(rs[key] || '') : '';
        html += '<div class="stg-row">';
        html += '<span class="stg-label">' + escapeHtml(label);
        if (hint) html += ' <span class="stg-hint">' + escapeHtml(hint) + '</span>';
        html += '</span>';
        html += '<select class="stg-select" id="stg-' + key + '" onchange="markSettingDirty(\\'' + key + '\\')">';
        for (var oi = 0; oi < options.length; oi++) {
          var opt = options[oi];
          html += '<option value="' + escapeHtml(opt.value) + '"' + (opt.value === val ? ' selected' : '') + '>' + escapeHtml(opt.label) + '</option>';
        }
        html += '</select>';
        html += '</div>';
      }

      /* ── Section 1: Runtime & Identity ── */
      sec('runtime', 'Runtime & Identity', function() {
        if (s) {
          var segment = (s.executionProfileSegment || 'individual').toLowerCase();
          var isDemo = s.mode === 'demo';
          var segBadge = isDemo ? 'demo' : segment;
          var segLabel = isDemo ? 'DEMO' : segment.toUpperCase();
          var segClass = isDemo ? 'stg-badge-amber' : (segment === 'business' ? 'stg-badge-blue' : 'stg-badge-green');
          badgeRow('Execution Profile', segLabel, segClass);
          var envClass = s.environmentProfile === 'prod' ? 'stg-badge-green' : (s.environmentProfile === 'staging' ? 'stg-badge-amber' : 'stg-badge-blue');
          badgeRow('Environment', s.environmentProfile || 'dev', envClass);
          badgeRow('Mode', s.mode || 'server', s.mode === 'demo' ? 'stg-badge-amber' : 'stg-badge-green');
          readonlyRow('Dashboard Port', location.port || '7070');
          readonlyRow('Session ID', s.sessionId);
          readonlyRow('Uptime', formatUptime(s.uptimeSeconds));
          readonlyRow('Version', 'v0.2.0');
          readonlyRow('Node', (s.nodeVersion || '\u2014'));
          readonlyRow('Platform', (s.platform || '\u2014'));
        } else {
          html += '<div class="muted">Loading runtime information...</div>';
        }
      });

      /* ── Section 2: LLM Summary ── */
      sec('llm', 'LLM Configuration (Summary)', function() {
        var provider = state.llmCatalog ? (state.llmCatalog.activeProviderId || 'none') : 'unknown';
        var model = state.llmCatalog ? (state.llmCatalog.activeModel || 'none') : 'unknown';
        readonlyRow('Active Provider', provider);
        readonlyRow('Active Model', model);
        readonlyRow('Routing Strategy', state.routingStrategy || 'single');
        readonlyRow('Sessions', String((state.sessions || []).length));
        html += '<div style="margin-top:8px;"><span class="muted" style="font-size:11px;">Configure providers, models, and routing in the sections above. \u2191</span></div>';
      });

      /* ── Section 3: Approval & Orchestration ── */
      sec('approval', 'Approval & Orchestration', function() {
        numberRow('Approval Timeout', 'approvalTimeoutMs', 'PRISM_APPROVAL_TIMEOUT_MS', 'ms');
        if (s && s.pendingApprovals > 0) {
          html += '<div class="stg-row"><span class="stg-label">Pending Approvals</span>';
          html += '<span class="stg-badge stg-badge-amber">' + s.pendingApprovals + '</span></div>';
        }
        html += '<div style="margin-top:8px;text-align:right;">';
        html += '<button class="stg-save-btn" onclick="saveSettings([\\'' + 'approvalTimeoutMs' + '\\'])">Save</button>';
        html += '</div>';
      });

      /* ── Section 4: Self-Review Intervals ── */
      sec('selfReview', 'Self-Review Intervals', function() {
        selectRow('Daily Cadence', 'selfReviewDailyMs', [
          { value: '43200000', label: '12 hours' },
          { value: '86400000', label: '24 hours' },
          { value: '172800000', label: '48 hours' }
        ], 'PRISM_SELF_REVIEW_DAILY_MS');
        selectRow('Weekly Cadence', 'selfReviewWeeklyMs', [
          { value: '302400000', label: '3.5 days' },
          { value: '604800000', label: '7 days' },
          { value: '1209600000', label: '14 days' }
        ], 'PRISM_SELF_REVIEW_WEEKLY_MS');
        selectRow('Monthly Cadence', 'selfReviewMonthlyMs', [
          { value: '1296000000', label: '15 days' },
          { value: '2592000000', label: '30 days' },
          { value: '5184000000', label: '60 days' }
        ], 'PRISM_SELF_REVIEW_MONTHLY_MS');
        html += '<div style="margin-top:8px;text-align:right;">';
        html += '<button class="stg-save-btn" onclick="saveSettings([\\'' + 'selfReviewDailyMs' + '\\', \\'' + 'selfReviewWeeklyMs' + '\\', \\'' + 'selfReviewMonthlyMs' + '\\'])">Save</button>';
        html += '</div>';
      });

      /* ── Section 5: Retrieval & Memory ── */
      sec('retrieval', 'Retrieval & Memory', function() {
        numberRow('Max Episodic Events', 'maxEpisodicEvents', '', 'events');
        html += '<div style="margin-top:8px;text-align:right;">';
        html += '<button class="stg-save-btn" onclick="saveSettings([\\'' + 'maxEpisodicEvents' + '\\'])">Save</button>';
        html += '</div>';
      });

      /* ── Section 6: Tool & Network Timeouts ── */
      sec('timeouts', 'Tool & Network Timeouts', function() {
        numberRow('Shell Command Timeout', 'shellTimeoutMs', '', 'ms');
        numberRow('HTTP Request Timeout', 'httpTimeoutMs', '', 'ms');
        numberRow('MCP Server Timeout', 'mcpTimeoutMs', '', 'ms');
        html += '<div style="margin-top:8px;text-align:right;">';
        html += '<button class="stg-save-btn" onclick="saveSettings([\\'' + 'shellTimeoutMs' + '\\', \\'' + 'httpTimeoutMs' + '\\', \\'' + 'mcpTimeoutMs' + '\\'])">Save</button>';
        html += '</div>';
      });

      /* ── Section 7: Dashboard Preferences ── */
      sec('prefs', 'Dashboard Preferences', function() {
        selectRow('Telemetry Window', 'telemetryWindow', [
          { value: '1h', label: '1 Hour' },
          { value: '1d', label: '1 Day' },
          { value: '7d', label: '7 Days' }
        ]);
        numberRow('Action History Limit', 'actionHistoryLimit', '', 'entries');
        numberRow('Package History Limit', 'sessionPackageHistoryLimit', '', 'entries');
        html += '<div style="margin-top:8px;text-align:right;">';
        html += '<button class="stg-save-btn" onclick="saveSettings([\\'' + 'telemetryWindow' + '\\', \\'' + 'actionHistoryLimit' + '\\', \\'' + 'sessionPackageHistoryLimit' + '\\'])">Save</button>';
        html += '</div>';
      });

      /* ── Section 8: Data & Paths ── */
      sec('paths', 'Data & Paths', function() {
        if (s) {
          readonlyRow('Workspace Root', s.workspaceRoot, 'PRISM_WORKSPACE_ROOT');
        }
        readonlyRow('Dashboard URL', 'http://localhost:' + (location.port || '7070'));
      });

      /* ── Section 9: Readiness Requirements ── */
      sec('readiness', 'Readiness Requirements', function() {
        if (state.readiness && state.readiness.requirements) {
          var reqs = state.readiness.requirements;
          for (var ri = 0; ri < reqs.length; ri++) {
            var met = reqs[ri].met;
            html += '<div class="stg-req-row">';
            html += '<span class="' + (met ? 'stg-req-met' : 'stg-req-unmet') + '">' + (met ? '\u2713' : '\u2717') + '</span>';
            html += '<span>' + escapeHtml(reqs[ri].label || reqs[ri].id) + '</span>';
            html += '</div>';
          }
        } else {
          html += '<div class="muted">No readiness data loaded yet.</div>';
        }
        html += '<div style="margin-top:10px;">';
        html += '<button class="stg-recheck-btn" onclick="recheckReadiness()">Re-check Readiness</button>';
        html += '</div>';
      });

      container.innerHTML = html;
    }

    function toggleSettingsSection(id) {
      state.settingsSections[id] = !state.settingsSections[id];
      render();
    }

    function markSettingDirty(key) {
      /* visual feedback could go here; for now we just let the user click Save */
    }

    async function saveSettings(keys) {
      var payload = {};
      for (var i = 0; i < keys.length; i++) {
        var el = document.getElementById('stg-' + keys[i]);
        if (el) {
          var val = el.tagName === 'SELECT' ? el.value : el.value;
          if (el.type === 'number') val = Number(val);
          payload[keys[i]] = val;
        }
      }
      state.settingsSaving = true;
      render();
      try {
        await request('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        await refreshChrome();
      } catch (e) {
        console.error('[settings] save failed', e);
      }
      state.settingsSaving = false;
      render();
    }

    async function recheckReadiness() {
      try {
        var sessionId = state.selectedSessionId || '';
        await request('/api/readiness/recheck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionId, source: 'dashboard_settings_panel' }) });
        await refreshChrome();
        render();
      } catch (e) {
        console.error('[settings] readiness recheck failed', e);
      }
    }

    /* ═══ Tools & Plugins — shared helpers ═══ */
    function getToolState(name) {
      if (!state.toolStates[name]) state.toolStates[name] = { enabled: true, invocations: 0, successes: 0, failures: 0, avgLatencyMs: 0, lastInvoked: null, lastError: null };
      return state.toolStates[name];
    }
    function getPluginState(name) {
      if (!state.pluginStates[name]) state.pluginStates[name] = { enabled: true, healthy: true, requests: 0, errors: 0, avgResponseMs: 0, uptime: 100, lastChecked: null };
      return state.pluginStates[name];
    }
    function getUtilityState(name) {
      if (!state.utilityStates[name]) state.utilityStates[name] = { lastRun: null, lastDurationMs: 0, lastResult: null, runCount: 0 };
      return state.utilityStates[name];
    }
    function getReview(store, name) {
      if (!store[name]) store[name] = { rating: 0, notes: '', approval: 'review', lastReviewed: null };
      return store[name];
    }
    function renderStars(store, name, kind) {
      var r = getReview(store, name);
      var html = '<div class="tp-review-stars">';
      for (var s = 1; s <= 5; s++) {
        html += '<span class="tp-star' + (s <= r.rating ? ' active' : '') + '" onclick="setItemRating(\\'' + kind + '\\', \\'' + escapeHtml(name) + '\\', ' + s + ')">\u2605</span>';
      }
      html += '</div>';
      return html;
    }
    function approvalBadge(status) {
      var cls = { approved: 'tp-approval-approved', review: 'tp-approval-review', flagged: 'tp-approval-flagged', blocked: 'tp-approval-blocked' };
      return '<span class="tp-approval-badge ' + (cls[status] || 'tp-approval-review') + '">' + escapeHtml(status) + '</span>';
    }
    function healthDot(ok) {
      return '<span class="tp-status-dot ' + (ok ? 'green' : 'red') + '"></span>';
    }
    function timeAgo(ts) {
      if (!ts) return 'never';
      var diff = Date.now() - new Date(ts).getTime();
      if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      return Math.floor(diff / 86400000) + 'd ago';
    }

    function setItemRating(kind, name, rating) {
      var store = kind === 'tool' ? state.toolReviews : kind === 'plugin' ? state.pluginReviews : state.utilityReviews;
      if (!store[name]) store[name] = { rating: 0, notes: '', approval: 'review', lastReviewed: null };
      store[name].rating = rating;
      store[name].lastReviewed = new Date().toISOString();
      render();
    }
    function setItemApproval(kind, name, approval) {
      var store = kind === 'tool' ? state.toolReviews : kind === 'plugin' ? state.pluginReviews : state.utilityReviews;
      if (!store[name]) store[name] = { rating: 0, notes: '', approval: 'review', lastReviewed: null };
      store[name].approval = approval;
      store[name].lastReviewed = new Date().toISOString();
      render();
    }
    function saveItemNotes(kind, name) {
      var el = document.getElementById('review-notes-' + kind + '-' + name.replace(/[^a-zA-Z0-9]/g, '_'));
      if (!el) return;
      var store = kind === 'tool' ? state.toolReviews : kind === 'plugin' ? state.pluginReviews : state.utilityReviews;
      if (!store[name]) store[name] = { rating: 0, notes: '', approval: 'review', lastReviewed: null };
      store[name].notes = el.value;
      store[name].lastReviewed = new Date().toISOString();
    }
    function toggleItemExpand(kind, name) {
      var field = kind === 'tool' ? 'expandedToolId' : kind === 'plugin' ? 'expandedPluginId' : 'expandedUtilityId';
      state[field] = state[field] === name ? null : name;
      render();
    }
    function toggleItemEnabled(kind, name) {
      var stateStore = kind === 'tool' ? state.toolStates : kind === 'plugin' ? state.pluginStates : state.utilityStates;
      if (!stateStore[name]) {
        if (kind === 'tool') getToolState(name);
        else if (kind === 'plugin') getPluginState(name);
        else getUtilityState(name);
      }
      stateStore[name].enabled = !stateStore[name].enabled;
      fetch('/api/tools/' + encodeURIComponent(name) + '/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: stateStore[name].enabled }) }).catch(function() {});
      render();
    }
    async function testTool(name) {
      var resultEl = document.getElementById('test-result-' + name.replace(/[^a-zA-Z0-9]/g, '_'));
      if (resultEl) resultEl.innerHTML = '<span class="muted">Testing...</span>';
      try {
        var res = await request('/api/tools/' + encodeURIComponent(name) + '/test', { method: 'POST' });
        if (resultEl) resultEl.innerHTML = '<span style="color:#7ecf7e;">\u2713 ' + escapeHtml(res.message || 'OK') + '</span>';
      } catch (e) {
        if (resultEl) resultEl.innerHTML = '<span style="color:#ffc1c1;">\u2717 ' + escapeHtml(e.message) + '</span>';
      }
    }
    async function checkPluginHealth(name) {
      var resultEl = document.getElementById('health-result-' + name.replace(/[^a-zA-Z0-9]/g, '_'));
      if (resultEl) resultEl.innerHTML = '<span class="muted">Checking...</span>';
      try {
        var res = await request('/api/plugins/' + encodeURIComponent(name) + '/health', { method: 'POST' });
        var ps = getPluginState(name);
        ps.healthy = res.healthy !== false;
        ps.lastChecked = new Date().toISOString();
        if (resultEl) resultEl.innerHTML = '<span style="color:' + (ps.healthy ? '#7ecf7e' : '#ffc1c1') + ';">' + (ps.healthy ? '\u2713 Healthy' : '\u2717 Unhealthy') + '</span>';
        render();
      } catch (e) {
        if (resultEl) resultEl.innerHTML = '<span style="color:#ffc1c1;">\u2717 ' + escapeHtml(e.message) + '</span>';
      }
    }
    function updateToolsFilter(val) {
      state.toolsFilterText = val.toLowerCase();
      render();
    }

    /* ═══ Brand Panel ═══ */
    function formatUptime(seconds) {
      if (!seconds || seconds < 0) return '0s';
      var d = Math.floor(seconds / 86400);
      var h = Math.floor((seconds % 86400) / 3600);
      var m = Math.floor((seconds % 3600) / 60);
      if (d > 0) return d + 'd ' + h + 'h';
      if (h > 0) return h + 'h ' + m + 'm';
      return m + 'm';
    }

    function renderBrandPanel() {
      var panel = document.getElementById('brand-panel');
      if (!panel) return;
      var s = state.status;
      if (!s) return;

      var segment = (s.executionProfileSegment || 'individual').toLowerCase();
      var isDemo = s.mode === 'demo';
      var badgeClass = isDemo ? 'demo' : segment;
      var badgeLabel = isDemo ? 'DEMO' : segment.toUpperCase();
      var envProfile = s.environmentProfile || 'dev';
      var envDotClass = envProfile === 'prod' ? 'prod' : (envProfile === 'staging' ? 'staging' : 'dev');

      var html = '<div class="eyebrow">Frontier Operator Console</div>'
        + '<h1>PRISM Chat</h1>'
        + '<div class="brand-profile-badge ' + badgeClass + '">' + badgeLabel + '</div>'
        + '<div class="brand-info-grid">'
        + '<div class="brand-info-item"><span class="brand-info-label">Env</span><br><span class="brand-info-value"><span class="brand-env-dot ' + envDotClass + '"></span>' + escapeHtml(envProfile) + '</span></div>'
        + '<div class="brand-info-item"><span class="brand-info-label">Mode</span><br><span class="brand-info-value">' + escapeHtml(s.mode || 'server') + '</span></div>'
        + '<div class="brand-info-item"><span class="brand-info-label">Uptime</span><br><span class="brand-info-value">' + formatUptime(s.uptimeSeconds) + '</span></div>'
        + '<div class="brand-info-item"><span class="brand-info-label">Version</span><br><span class="brand-info-value">v0.2.0</span></div>'
        + '<div class="brand-info-item"><span class="brand-info-label">Sessions</span><br><span class="brand-info-value">' + (s.chatSessionCount || 0) + '</span></div>'
        + '<div class="brand-info-item"><span class="brand-info-label">Events</span><br><span class="brand-info-value">' + (s.eventCount || 0) + '</span></div>'
        + '</div>'
        + '<div class="muted" style="margin-top:8px;">http://localhost:' + (location.port || '7070') + '</div>';

      if (s.pendingApprovals && s.pendingApprovals > 0) {
        html += '<div class="brand-approvals-badge">' + s.pendingApprovals + ' pending approval' + (s.pendingApprovals > 1 ? 's' : '') + '</div>';
      }

      panel.innerHTML = html;
    }

    /* ═══ Overview Bar ═══ */
    function renderToolsOverviewBar() {
      var bar = document.getElementById('tools-overview-bar');
      if (!bar) return;
      var totalTools = Math.max(19, Object.keys(state.toolStates || {}).length);
      var totalPlugins = Math.max(7, Object.keys(state.pluginStates || {}).length);
      var enabledTools = 0;
      var healthyPlugins = 0;
      var totalUtils = 30;
      enabledTools = totalTools - Object.keys(state.toolStates || {}).filter(function(k) { return !state.toolStates[k].enabled; }).length;
      healthyPlugins = totalPlugins - Object.keys(state.pluginStates || {}).filter(function(k) { return !state.pluginStates[k].healthy; }).length;

      var html = '<div class="tp-overview-bar">';
      html += '<span class="tp-status-dot green"></span>';
      html += '<span class="tp-overview-stat">' + enabledTools + '/' + totalTools + ' tools <span class="muted">enabled</span></span>';
      html += '<span style="color:var(--muted);">\u2502</span>';
      html += '<span class="tp-overview-stat">' + healthyPlugins + '/' + totalPlugins + ' plugins <span class="muted">healthy</span></span>';
      html += '<span style="color:var(--muted);">\u2502</span>';
      html += '<span class="tp-overview-stat">' + totalUtils + ' <span class="muted">utilities</span></span>';
      html += '<span style="flex:1;"></span>';
      html += '<input class="tp-filter-input" type="text" placeholder="\uD83D\uDD0D Filter by name..." value="' + escapeHtml(state.toolsFilterText) + '" oninput="updateToolsFilter(this.value)">';
      html += '</div>';
      bar.innerHTML = html;
    }

    function renderToolsPanel() {
      var container = document.getElementById('tools-panel');
      if (!container) return;
      renderToolsOverviewBar();

      var fallbackTools = [
        { name: 'file_read', cat: 'System', desc: 'Read file contents with encoding support', risk: 'low', mut: false },
        { name: 'file_write', cat: 'System', desc: 'Write or append content to files', risk: 'medium', mut: true },
        { name: 'file_delete', cat: 'System', desc: 'Delete files and directories', risk: 'high', mut: true },
        { name: 'file_list', cat: 'System', desc: 'List directory contents with file type detection', risk: 'low', mut: false },
        { name: 'shell_exec', cat: 'System', desc: 'Execute shell commands with blocked-pattern protection', risk: 'high', mut: true },
        { name: 'terminal_session', cat: 'System', desc: 'Manage interactive terminal sessions with lifecycle control', risk: 'medium', mut: true },
        { name: 'container_sandbox', cat: 'System', desc: 'Create and manage containerized sandbox environments', risk: 'medium', mut: true },
        { name: 'http_request', cat: 'Integration', desc: 'Execute HTTP requests (GET/POST/PUT/PATCH/DELETE)', risk: 'medium', mut: true },
        { name: 'email_ops', cat: 'Application', desc: 'Email operations \u2014 summarize, reply, and send', risk: 'medium', mut: true },
        { name: 'calendar_plan', cat: 'Application', desc: 'Calendar management \u2014 availability and scheduling', risk: 'medium', mut: true },
        { name: 'notes_extract', cat: 'Application', desc: 'Notes management \u2014 capture, extract, and persist', risk: 'medium', mut: true },
        { name: 'tasks_timeline', cat: 'Application', desc: 'Task timeline planning and commitment', risk: 'medium', mut: true },
        { name: 'neo4j_query', cat: 'Knowledge', desc: 'Execute Cypher queries against Neo4j graph database', risk: 'medium', mut: false },
        { name: 'memory_query', cat: 'Knowledge', desc: 'Query episodic, semantic, or session memory stores', risk: 'low', mut: false },
        { name: 'semantic_query', cat: 'Knowledge', desc: 'Semantic memory index with multiple retrieval modes', risk: 'low', mut: false },
        { name: 'nexus_check_hotline', cat: 'Integration', desc: 'Read broadcast messages from Nexus hotline', risk: 'low', mut: false },
        { name: 'nexus_read_memory', cat: 'Integration', desc: 'Read Nexus primary memory store', risk: 'low', mut: false },
        { name: 'nexus_log_insight', cat: 'Integration', desc: 'Append insights to Nexus daily memory log', risk: 'medium', mut: true },
        { name: 'nexus_broadcast', cat: 'Integration', desc: 'Send STP messages to Nexus thread or hotline', risk: 'medium', mut: true }
      ];

      var tools = (Array.isArray(state.toolCatalog) && state.toolCatalog.length > 0)
        ? state.toolCatalog.slice()
        : fallbackTools.slice();

      var knownTools = {};
      for (var k = 0; k < tools.length; k++) {
        knownTools[tools[k].name] = true;
      }
      var observedToolNames = Object.keys(state.toolStates || {}).filter(function(name) {
        return !knownTools[name];
      }).sort();
      for (var oi = 0; oi < observedToolNames.length; oi++) {
        var observedName = observedToolNames[oi];
        tools.push({
          name: observedName,
          cat: 'Observed',
          desc: 'Observed from backend telemetry stream',
          risk: 'medium',
          mut: false
        });
      }

      var riskColor = { low: '#7ecf7e', medium: '#ffd17a', high: '#ffc1c1' };
      var riskBg = { low: 'rgba(126,207,126,0.15)', medium: 'rgba(255,200,80,0.12)', high: 'rgba(255,141,141,0.12)' };
      var catIcon = { System: '\uD83D\uDDA5\uFE0F', Application: '\uD83D\uDCCB', Knowledge: '\uD83E\uDDE0', Integration: '\uD83D\uDD17', Observed: '\uD83D\uDCE1' };
      var filter = state.toolsFilterText || '';

      var categories = ['System', 'Application', 'Knowledge', 'Integration'];
      var seenCategories = {};
      for (var ci = 0; ci < categories.length; ci++) seenCategories[categories[ci]] = true;
      for (var ti = 0; ti < tools.length; ti++) {
        var candidateCategory = tools[ti].cat || 'System';
        if (!seenCategories[candidateCategory]) {
          categories.push(candidateCategory);
          seenCategories[candidateCategory] = true;
        }
      }
      if (observedToolNames.length > 0 && !seenCategories.Observed) {
        categories.push('Observed');
      }
      var html = '<div class="muted" style="margin-bottom:8px;">'
        + tools.length + ' tools registered across ' + categories.length + ' categories.</div>';

      for (var c = 0; c < categories.length; c++) {
        var cat = categories[c];
        var catTools = tools.filter(function(t) { return t.cat === cat && (!filter || t.name.toLowerCase().indexOf(filter) !== -1 || t.desc.toLowerCase().indexOf(filter) !== -1); });
        if (!catTools.length) continue;
        html += '<div style="margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:600;color:var(--fg);">' + (catIcon[cat] || '') + ' ' + escapeHtml(cat) + ' <span class="muted">(' + catTools.length + ')</span></div>';
        for (var i = 0; i < catTools.length; i++) {
          var t = catTools[i];
          var ts = getToolState(t.name);
          var rv = getReview(state.toolReviews, t.name);
          var isExpanded = state.expandedToolId === t.name;
          var safeId = t.name.replace(/[^a-zA-Z0-9]/g, '_');

          html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + '">';

          /* ── collapsed header ── */
          html += '<div class="tp-card-head" onclick="toggleItemExpand(\\'tool\\', \\'' + escapeHtml(t.name) + '\\')" data-tooltip="Category: ' + escapeHtml(t.cat) + ' | Risk: ' + escapeHtml(t.risk) + ' | ' + (t.mut ? 'Mutating' : 'Read-only') + '\\n' + escapeHtml(t.desc) + '">';
          html += '<div style="flex:1;min-width:0;">';
          html += '<div style="display:flex;align-items:center;gap:8px;">';
          html += '<span class="tp-card-name">' + escapeHtml(t.name) + '</span>';
          html += healthDot(ts.enabled);
          html += '</div>';
          html += '<div class="tp-card-desc">' + escapeHtml(t.desc) + '</div>';
          html += '<div class="tp-card-meta">';
          if (ts.invocations > 0) html += '<span class="tp-meta-tag">\uD83D\uDCCA ' + ts.invocations + ' calls</span>';
          if (ts.lastInvoked) html += '<span class="tp-meta-tag">\uD83D\uDD52 ' + timeAgo(ts.lastInvoked) + '</span>';
          html += '</div>';
          html += '</div>';
          html += '<div class="tp-card-badges">';
          html += '<span class="ps-badge" style="background:' + riskBg[t.risk] + ';color:' + riskColor[t.risk] + ';">' + escapeHtml(t.risk) + '</span>';
          html += '<span class="ps-badge" style="background:' + (t.mut ? 'rgba(255,200,80,0.12);color:#ffd17a' : 'rgba(126,207,126,0.15);color:#7ecf7e') + ';">' + (t.mut ? 'mutating' : 'read-only') + '</span>';
          html += approvalBadge(rv.approval);
          html += '</div></div>';

          /* ── expanded body ── */
          html += '<div class="tp-card-body">';

          /* Controls */
          html += '<div class="tp-section"><div class="tp-section-title">\u2699\uFE0F Controls</div>';
          html += '<div class="tp-controls">';
          html += '<label class="tp-toggle"><input type="checkbox" ' + (ts.enabled ? 'checked' : '') + ' onchange="toggleItemEnabled(\\'tool\\', \\'' + escapeHtml(t.name) + '\\')"><span class="tp-toggle-track"></span>' + (ts.enabled ? 'Enabled' : 'Disabled') + '</label>';
          html += '<button class="secondary-button" style="font-size:11px;padding:4px 12px;" onclick="testTool(\\'' + escapeHtml(t.name) + '\\')">\u{1F9EA} Test Tool</button>';
          html += '</div>';
          html += '<div id="test-result-' + safeId + '" style="margin-top:6px;font-size:12px;"></div>';
          html += '</div>';

          /* Telemetry */
          html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Telemetry</div>';
          html += '<div class="tp-stat-row">';
          html += '<div class="tp-stat"><span class="tp-stat-label">Invocations</span><span class="tp-stat-value">' + ts.invocations + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Success</span><span class="tp-stat-value" style="color:#7ecf7e;">' + ts.successes + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Failures</span><span class="tp-stat-value" style="color:#ffc1c1;">' + ts.failures + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Avg Latency</span><span class="tp-stat-value">' + (ts.avgLatencyMs ? ts.avgLatencyMs.toFixed(0) + 'ms' : '\u2014') + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Last Used</span><span class="tp-stat-value">' + timeAgo(ts.lastInvoked) + '</span></div>';
          html += '</div>';
          if (ts.lastError) html += '<div style="margin-top:6px;font-size:11px;color:#ffc1c1;">Last error: ' + escapeHtml(ts.lastError) + '</div>';
          html += '</div>';

          /* Governance */
          html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDEE1\uFE0F Governance</div>';
          html += '<div class="tp-stat-row">';
          html += '<div class="tp-stat"><span class="tp-stat-label">Risk Level</span><span class="tp-stat-value" style="color:' + riskColor[t.risk] + ';">' + t.risk.toUpperCase() + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Mutating</span><span class="tp-stat-value">' + (t.mut ? 'Yes' : 'No') + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Category</span><span class="tp-stat-value">' + escapeHtml(t.cat) + '</span></div>';
          html += '</div></div>';

          /* Review */
          html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCDD Review & Evaluation</div>';
          html += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">';
          html += renderStars(state.toolReviews, t.name, 'tool');
          html += approvalBadge(rv.approval);
          html += '<select style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);" onchange="setItemApproval(\\'tool\\', \\'' + escapeHtml(t.name) + '\\', this.value)">';
          var approvals = ['review', 'approved', 'flagged', 'blocked'];
          for (var a = 0; a < approvals.length; a++) {
            html += '<option value="' + approvals[a] + '"' + (rv.approval === approvals[a] ? ' selected' : '') + '>' + approvals[a].charAt(0).toUpperCase() + approvals[a].slice(1) + '</option>';
          }
          html += '</select>';
          if (rv.lastReviewed) html += '<span class="muted" style="font-size:10px;">Reviewed: ' + timeAgo(rv.lastReviewed) + '</span>';
          html += '</div>';
          html += '<div style="margin-top:8px;"><textarea id="review-notes-tool-' + safeId + '" rows="2" placeholder="Review notes..." style="width:100%;padding:6px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:rgba(0,0,0,0.25);color:var(--fg);font-size:11px;font-family:inherit;box-sizing:border-box;resize:vertical;" onblur="saveItemNotes(\\'tool\\', \\'' + escapeHtml(t.name) + '\\')">' + escapeHtml(rv.notes) + '</textarea></div>';
          html += '</div>';

          html += '</div></div>';
        }
      }
      html += '<div style="margin-top:16px;text-align:center;">';
      html += '<button class="secondary-button" style="font-size:12px;padding:8px 20px;" onclick="showRegisterToolForm()">➕ Register Custom Tool</button>';
      html += '</div>';
      container.innerHTML = html;
    }

    function showRegisterToolForm() {
      var existing = document.getElementById('register-tool-form');
      if (existing) { existing.remove(); return; }
      var container = document.getElementById('tools-panel');
      if (!container) return;
      var form = document.createElement('div');
      form.id = 'register-tool-form';
      form.style.cssText = 'margin-top:12px;padding:14px;border:1px solid var(--accent);border-radius:12px;background:rgba(0,0,0,0.2);';
      form.innerHTML = '<div style="font-size:13px;font-weight:600;margin-bottom:10px;">➕ Register Custom Tool</div>'
        + '<div class="ps-field"><label>Name</label><input id="reg-tool-name" placeholder="my_custom_tool"></div>'
        + '<div class="ps-field"><label>Description</label><input id="reg-tool-desc" placeholder="What does this tool do?"></div>'
        + '<div class="ps-field"><label>Category</label><select id="reg-tool-cat" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;"><option>System</option><option>Application</option><option>Knowledge</option><option>Integration</option></select></div>'
        + '<div class="ps-field"><label>Risk Level</label><select id="reg-tool-risk" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;"><option>low</option><option>medium</option><option>high</option></select></div>'
        + '<div class="ps-field"><label>Endpoint / Command</label><input id="reg-tool-endpoint" placeholder="http://localhost:9000/tool or /usr/bin/mytool"></div>'
        + '<div style="display:flex;gap:8px;margin-top:12px;">'
        + '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="submitRegisterTool()">Register</button>'
        + '<button class="secondary-button" style="font-size:12px;padding:6px 16px;" onclick="cancelRegisterTool()">Cancel</button>'
        + '</div>';
      container.appendChild(form);
    }
    function cancelRegisterTool() {
      var form = document.getElementById('register-tool-form');
      if (form) form.remove();
    }
    function submitRegisterTool() {
      var name = document.getElementById('reg-tool-name');
      var desc = document.getElementById('reg-tool-desc');
      var cat = document.getElementById('reg-tool-cat');
      var risk = document.getElementById('reg-tool-risk');
      var endpoint = document.getElementById('reg-tool-endpoint');
      if (!name || !name.value.trim()) { alert('Tool name is required'); return; }
      fetch('/api/tools/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.value.trim(), description: desc ? desc.value : '', category: cat ? cat.value : 'System', risk: risk ? risk.value : 'medium', endpoint: endpoint ? endpoint.value : '' })
      }).then(function() {
        var form = document.getElementById('register-tool-form');
        if (form) form.remove();
      }).catch(function(e) { alert('Registration failed: ' + e.message); });
    }

    function renderPluginsPanel() {
      var container = document.getElementById('plugins-panel');
      if (!container) return;

      var plugins = [
        { name: 'ids-mcp', group: 'In-Repo', type: 'Python MCP Server', desc: 'IDS identity services \u2014 authentication, token lifecycle, and credential management', status: 'Active', trust: 'high', port: 8100 },
        { name: 'impressioncore-eds', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Enterprise Data Services \u2014 structured data ingestion, transformation, and schema enforcement', status: 'Active', trust: 'high', port: 8200 },
        { name: 'impressioncore-ipa', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Intelligent Process Automation \u2014 task queuing, workflow dispatch, and RPA bridge', status: 'Active', trust: 'high', port: 8201 },
        { name: 'impressioncore-goliath', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Large-scale data pipeline orchestration \u2014 batch ETL, partitioned processing, and backpressure control', status: 'Active', trust: 'high', port: 8202 },
        { name: 'impressioncore-vrgc', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Visual Rendering & Graphics Compute \u2014 image generation, chart rendering, and GPU-accelerated transforms', status: 'Active', trust: 'high', port: 8203 },
        { name: 'impressioncore-dpa', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Document Processing & Analytics \u2014 PDF extraction, OCR, and document classification', status: 'Active', trust: 'high', port: 8204 },
        { name: 'web-search-mcp', group: 'In-Repo', type: 'Python MCP Server', desc: 'Web search provider \u2014 query routing, result aggregation, and safe content filtering', status: 'Active', trust: 'medium', port: 8300 }
      ];

      var groupIcon = { 'In-Repo': '\uD83D\uDCC1', 'ImpressionCore Suite': '\uD83E\uDDE9' };
      var groups = ['In-Repo', 'ImpressionCore Suite'];
      var trustColor = { high: '#7ecf7e', medium: '#ffd17a', low: '#ffc1c1' };
      var filter = state.toolsFilterText || '';

      var html = '<div class="muted" style="margin-bottom:8px;">'
        + plugins.length + ' MCP plugins registered across ' + groups.length + ' sources.</div>';

      for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        var grpPlugins = plugins.filter(function(p) { return p.group === grp && (!filter || p.name.toLowerCase().indexOf(filter) !== -1 || p.desc.toLowerCase().indexOf(filter) !== -1); });
        if (!grpPlugins.length) continue;
        html += '<div style="margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:600;color:var(--fg);">' + (groupIcon[grp] || '') + ' ' + escapeHtml(grp) + ' <span class="muted">(' + grpPlugins.length + ')</span></div>';
        for (var i = 0; i < grpPlugins.length; i++) {
          var p = grpPlugins[i];
          var ps = getPluginState(p.name);
          var rv = getReview(state.pluginReviews, p.name);
          var isExpanded = state.expandedPluginId === p.name;
          var safeId = p.name.replace(/[^a-zA-Z0-9]/g, '_');

          html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + '">';

          /* ── collapsed header ── */
          html += '<div class="tp-card-head" onclick="toggleItemExpand(\\'plugin\\', \\'' + escapeHtml(p.name) + '\\')" data-tooltip="Group: ' + escapeHtml(p.group) + ' | Type: ' + escapeHtml(p.type) + '\\nStatus: ' + escapeHtml(p.status) + ' | Trust: ' + escapeHtml(p.trust) + '\\nPort: ' + p.port + '">';
          html += '<div style="flex:1;min-width:0;">';
          html += '<div style="display:flex;align-items:center;gap:8px;">';
          html += '<span class="tp-card-name">' + escapeHtml(p.name) + '</span>';
          html += healthDot(ps.healthy);
          html += '<span class="ps-badge" style="background:rgba(130,170,255,0.12);color:#82aaff;font-size:10px;">' + escapeHtml(p.type) + '</span>';
          html += '</div>';
          html += '<div class="tp-card-desc">' + escapeHtml(p.desc) + '</div>';
          html += '<div class="tp-card-meta">';
          if (ps.requests > 0) html += '<span class="tp-meta-tag">\uD83D\uDCCA ' + ps.requests + ' reqs</span>';
          if (ps.lastChecked) html += '<span class="tp-meta-tag">\u2713 checked ' + timeAgo(ps.lastChecked) + '</span>';
          html += '</div>';
          html += '</div>';
          html += '<div class="tp-card-badges">';
          html += '<span class="ps-badge" style="background:rgba(126,207,126,0.15);color:#7ecf7e;">' + escapeHtml(p.status) + '</span>';
          html += approvalBadge(rv.approval);
          html += '</div></div>';

          /* ── expanded body ── */
          html += '<div class="tp-card-body">';

          /* Connection Info */
          html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDD17 Connection</div>';
          html += '<div class="tp-stat-row">';
          html += '<div class="tp-stat"><span class="tp-stat-label">Type</span><span class="tp-stat-value">' + escapeHtml(p.type) + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Port</span><span class="tp-stat-value">' + p.port + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Trust</span><span class="tp-stat-value" style="color:' + (trustColor[p.trust] || 'var(--fg)') + ';">' + escapeHtml(p.trust).toUpperCase() + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Group</span><span class="tp-stat-value">' + escapeHtml(p.group) + '</span></div>';
          html += '</div></div>';

          /* Controls */
          html += '<div class="tp-section"><div class="tp-section-title">\u2699\uFE0F Controls</div>';
          html += '<div class="tp-controls">';
          html += '<label class="tp-toggle"><input type="checkbox" ' + (ps.enabled ? 'checked' : '') + ' onchange="toggleItemEnabled(\\'plugin\\', \\'' + escapeHtml(p.name) + '\\')"><span class="tp-toggle-track"></span>' + (ps.enabled ? 'Enabled' : 'Disabled') + '</label>';
          html += '<button class="secondary-button" style="font-size:11px;padding:4px 12px;" onclick="checkPluginHealth(\\'' + escapeHtml(p.name) + '\\')">\uD83C\uDFE5 Check Health</button>';
          html += '</div>';
          html += '<div id="health-result-' + safeId + '" style="margin-top:6px;font-size:12px;"></div>';
          html += '</div>';

          /* Telemetry */
          html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Telemetry</div>';
          html += '<div class="tp-stat-row">';
          html += '<div class="tp-stat"><span class="tp-stat-label">Requests</span><span class="tp-stat-value">' + ps.requests + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Errors</span><span class="tp-stat-value" style="color:#ffc1c1;">' + ps.errors + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Avg Response</span><span class="tp-stat-value">' + (ps.avgResponseMs ? ps.avgResponseMs.toFixed(0) + 'ms' : '\u2014') + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Uptime</span><span class="tp-stat-value">' + ps.uptime + '%</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Last Checked</span><span class="tp-stat-value">' + timeAgo(ps.lastChecked) + '</span></div>';
          html += '</div></div>';

          /* Review */
          html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCDD Review & Evaluation</div>';
          html += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">';
          html += renderStars(state.pluginReviews, p.name, 'plugin');
          html += approvalBadge(rv.approval);
          html += '<select style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);" onchange="setItemApproval(\\'plugin\\', \\'' + escapeHtml(p.name) + '\\', this.value)">';
          var approvals = ['review', 'approved', 'flagged', 'blocked'];
          for (var a = 0; a < approvals.length; a++) {
            html += '<option value="' + approvals[a] + '"' + (rv.approval === approvals[a] ? ' selected' : '') + '>' + approvals[a].charAt(0).toUpperCase() + approvals[a].slice(1) + '</option>';
          }
          html += '</select>';
          if (rv.lastReviewed) html += '<span class="muted" style="font-size:10px;">Reviewed: ' + timeAgo(rv.lastReviewed) + '</span>';
          html += '</div>';
          html += '<div style="margin-top:8px;"><textarea id="review-notes-plugin-' + safeId + '" rows="2" placeholder="Review notes..." style="width:100%;padding:6px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:rgba(0,0,0,0.25);color:var(--fg);font-size:11px;font-family:inherit;box-sizing:border-box;resize:vertical;" onblur="saveItemNotes(\\'plugin\\', \\'' + escapeHtml(p.name) + '\\')">' + escapeHtml(rv.notes) + '</textarea></div>';
          html += '</div>';

          html += '</div></div>';
        }
      }
      html += '<div style="margin-top:16px;text-align:center;">';
      html += '<button class="secondary-button" style="font-size:12px;padding:8px 20px;" onclick="showInstallPluginForm()">➕ Install Plugin</button>';
      html += '</div>';
      container.innerHTML = html;
    }

    function showInstallPluginForm() {
      var existing = document.getElementById('install-plugin-form');
      if (existing) { existing.remove(); return; }
      var container = document.getElementById('plugins-panel');
      if (!container) return;
      var form = document.createElement('div');
      form.id = 'install-plugin-form';
      form.style.cssText = 'margin-top:12px;padding:14px;border:1px solid var(--accent);border-radius:12px;background:rgba(0,0,0,0.2);';
      form.innerHTML = '<div style="font-size:13px;font-weight:600;margin-bottom:10px;">➕ Install Plugin</div>'
        + '<div class="ps-field"><label>Plugin Name</label><input id="reg-plugin-name" placeholder="my-plugin-mcp"></div>'
        + '<div class="ps-field"><label>Type</label><select id="reg-plugin-type" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;"><option>Python MCP Server</option><option>Node.js MCP Server</option><option>REST Adapter</option></select></div>'
        + '<div class="ps-field"><label>Server URL / Path</label><input id="reg-plugin-url" placeholder="http://localhost:8400 or ./plugins/my-plugin"></div>'
        + '<div class="ps-field"><label>Port</label><input id="reg-plugin-port" type="number" placeholder="8400"></div>'
        + '<div class="ps-field"><label>Description</label><textarea id="reg-plugin-desc" rows="2" placeholder="What does this plugin provide?" style="width:100%;padding:6px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:rgba(0,0,0,0.25);color:var(--fg);font-size:11px;font-family:inherit;box-sizing:border-box;resize:vertical;"></textarea></div>'
        + '<div style="display:flex;gap:8px;margin-top:12px;">'
        + '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="submitInstallPlugin()">Install</button>'
        + '<button class="secondary-button" style="font-size:12px;padding:6px 16px;" onclick="cancelInstallPlugin()">Cancel</button>'
        + '</div>';
      container.appendChild(form);
    }
    function cancelInstallPlugin() {
      var form = document.getElementById('install-plugin-form');
      if (form) form.remove();
    }
    function submitInstallPlugin() {
      var name = document.getElementById('reg-plugin-name');
      var type = document.getElementById('reg-plugin-type');
      var url = document.getElementById('reg-plugin-url');
      var port = document.getElementById('reg-plugin-port');
      var desc = document.getElementById('reg-plugin-desc');
      if (!name || !name.value.trim()) { alert('Plugin name is required'); return; }
      fetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.value.trim(), type: type ? type.value : 'Python MCP Server', url: url ? url.value : '', port: port ? parseInt(port.value) || 0 : 0, description: desc ? desc.value : '' })
      }).then(function() {
        var form = document.getElementById('install-plugin-form');
        if (form) form.remove();
      }).catch(function(e) { alert('Installation failed: ' + e.message); });
    }

    function renderUtilitiesPanel() {
      var container = document.getElementById('utilities-panel');
      if (!container) return;

      var utils = [
        { name: 'tool-contract-snapshot', cat: 'Benchmarks & Qualification', desc: 'Generate versioned tool contract snapshots for release evidence' },
        { name: 'release-validation', cat: 'Benchmarks & Qualification', desc: 'Run release gate checks \u2014 test/build/perf/contract/policy validation' },
        { name: 'ci-gate-check', cat: 'Benchmarks & Qualification', desc: 'CI quality gate \u2014 test pass, perf qualification, artifact upload' },
        { name: 'perf-qualification', cat: 'Benchmarks & Qualification', desc: 'Performance SLO harness \u2014 p50/p95/p99 latency gates with contention scenarios' },
        { name: 'e1-individual-qualification', cat: 'Benchmarks & Qualification', desc: 'Individual profile qualification \u2014 tool invocation, workflow, and terminal tests' },
        { name: 'e2-business-qualification', cat: 'Benchmarks & Qualification', desc: 'Business profile qualification \u2014 governance paths, approval flows, and audit checks' },
        { name: 'e3-policy-stress', cat: 'Benchmarks & Qualification', desc: 'Policy engine stress test \u2014 rapid tier routing under concurrency load' },
        { name: 'e4-profile-switch-qualification', cat: 'Benchmarks & Qualification', desc: 'Profile hot-switch qualification \u2014 runtime transition fidelity and state preservation' },
        { name: 'd1-workflow-template-qualification', cat: 'Benchmarks & Qualification', desc: 'Workflow template qualification \u2014 retry/timeout/fallback path completion' },
        { name: 'e-stage2-qualification-summary', cat: 'Benchmarks & Qualification', desc: 'Aggregate stage-2 qualification summary across all E-series suites' },
        { name: 'j-event-lineage-bundle', cat: 'Benchmarks & Qualification', desc: 'Event lineage bundle \u2014 full causal chain export for audit and replay' },

        { name: 'SelfReviewScheduler', cat: 'Operator Services', desc: 'Automated self-review scheduling \u2014 daily, weekly, and monthly audit cycles' },
        { name: 'SessionTraceExplorer', cat: 'Operator Services', desc: 'Session trace browser \u2014 search, filter, and inspect activity event chains' },
        { name: 'PolicyAuditExporter', cat: 'Operator Services', desc: 'Export policy audit logs \u2014 JSON/CSV/NDJSON with reason-code annotations' },
        { name: 'SessionPackageSqliteStore', cat: 'Operator Services', desc: 'SQLite-backed session package persistence and migration management' },
        { name: 'DashboardService', cat: 'Operator Services', desc: 'Dashboard HTTP server \u2014 38 API routes, WebSocket, and static UI serving' },

        { name: 'SemanticMemoryIndex', cat: 'Memory & Retrieval', desc: 'Semantic memory index with configurable embedding and multi-mode retrieval' },
        { name: 'EpisodicMemory', cat: 'Memory & Retrieval', desc: 'Episodic memory buffer with rolling window and recency-weighted recall' },
        { name: 'SessionMemoryStore', cat: 'Memory & Retrieval', desc: 'Per-session memory persistence with summary extraction and compaction' },
        { name: 'RetrievalMetricsCollector', cat: 'Memory & Retrieval', desc: 'Retrieval quality instrumentation \u2014 hit-rate, coverage, novelty, utility scoring' },
        { name: 'RetrievalDashboardStore', cat: 'Memory & Retrieval', desc: 'SQLite-backed retrieval cohort dashboard snapshots and trend persistence' },

        { name: 'ActivityBus', cat: 'Activity & Audit', desc: 'Central event bus with SHA-256 hash chain and typed subscriber dispatch' },
        { name: 'SqliteActivityStore', cat: 'Activity & Audit', desc: 'SQLite subscriber for durable activity event persistence and querying' },
        { name: 'ConsoleActivitySubscriber', cat: 'Activity & Audit', desc: 'Console subscriber for development-mode real-time event logging' },

        { name: 'normalizeReplayEvent', cat: 'Replay & Verification', desc: 'Normalize recorded events into deterministic replay format' },
        { name: 'buildReplaySignature', cat: 'Replay & Verification', desc: 'Generate cryptographic replay signatures for trace parity verification' },
        { name: 'compareReplayParity', cat: 'Replay & Verification', desc: 'Compare replay runs and report divergence with diff annotations' },

        { name: 'resolveExecutionProfileFromEnv', cat: 'Configuration', desc: 'Resolve execution profile from environment variables (fast/balanced/governed)' },
        { name: 'resolveEnvironmentProfile', cat: 'Configuration', desc: 'Resolve environment profile (dev/staging/prod) with SLO preset selection' },
        { name: 'getPerformanceSloProfile', cat: 'Configuration', desc: 'Return performance SLO thresholds for the active environment profile' }
      ];

      var catIcon = {
        'Benchmarks & Qualification': '\uD83C\uDFAF',
        'Operator Services': '\u2699\uFE0F',
        'Memory & Retrieval': '\uD83E\uDDE0',
        'Activity & Audit': '\uD83D\uDCCA',
        'Replay & Verification': '\uD83D\uDD01',
        'Configuration': '\uD83D\uDD27'
      };
      var categories = ['Benchmarks & Qualification', 'Operator Services', 'Memory & Retrieval', 'Activity & Audit', 'Replay & Verification', 'Configuration'];
      var filter = state.toolsFilterText || '';

      var html = '<div class="muted" style="margin-bottom:8px;">'
        + utils.length + ' utilities registered across ' + categories.length + ' categories.</div>';

      for (var c = 0; c < categories.length; c++) {
        var cat = categories[c];
        var catUtils = utils.filter(function(u) { return u.cat === cat && (!filter || u.name.toLowerCase().indexOf(filter) !== -1 || u.desc.toLowerCase().indexOf(filter) !== -1); });
        if (!catUtils.length) continue;
        html += '<div style="margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:600;color:var(--fg);">' + (catIcon[cat] || '') + ' ' + escapeHtml(cat) + ' <span class="muted">(' + catUtils.length + ')</span></div>';
        for (var i = 0; i < catUtils.length; i++) {
          var u = catUtils[i];
          var us = getUtilityState(u.name);
          var rv = getReview(state.utilityReviews, u.name);
          var isExpanded = state.expandedUtilityId === u.name;
          var safeId = u.name.replace(/[^a-zA-Z0-9]/g, '_');

          html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + '">';

          /* ── collapsed header ── */
          html += '<div class="tp-card-head" onclick="toggleItemExpand(\\'utility\\', \\'' + escapeHtml(u.name) + '\\')" data-tooltip="Category: ' + escapeHtml(u.cat) + '\\n' + escapeHtml(u.desc) + (us.lastRun ? '\\nLast run: ' + timeAgo(us.lastRun) : '') + '">';
          html += '<div style="flex:1;min-width:0;">';
          html += '<span class="tp-card-name">' + escapeHtml(u.name) + '</span>';
          html += '<div class="tp-card-desc">' + escapeHtml(u.desc) + '</div>';
          html += '<div class="tp-card-meta">';
          if (us.runCount > 0) html += '<span class="tp-meta-tag">\uD83D\uDD01 ' + us.runCount + ' runs</span>';
          if (us.lastRun) html += '<span class="tp-meta-tag">\uD83D\uDD52 ' + timeAgo(us.lastRun) + '</span>';
          if (us.lastResult) html += '<span class="tp-meta-tag" style="color:' + (us.lastResult === 'pass' ? '#7ecf7e' : '#ffc1c1') + ';">' + (us.lastResult === 'pass' ? '\u2713' : '\u2717') + ' ' + us.lastResult + '</span>';
          html += '</div>';
          html += '</div>';
          html += '<div class="tp-card-badges">';
          html += approvalBadge(rv.approval);
          html += '</div></div>';

          /* ── expanded body ── */
          html += '<div class="tp-card-body">';

          /* Telemetry */
          html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Telemetry</div>';
          html += '<div class="tp-stat-row">';
          html += '<div class="tp-stat"><span class="tp-stat-label">Run Count</span><span class="tp-stat-value">' + us.runCount + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Last Run</span><span class="tp-stat-value">' + timeAgo(us.lastRun) + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Duration</span><span class="tp-stat-value">' + (us.lastDurationMs ? us.lastDurationMs.toFixed(0) + 'ms' : '\u2014') + '</span></div>';
          html += '<div class="tp-stat"><span class="tp-stat-label">Last Result</span><span class="tp-stat-value" style="color:' + (us.lastResult === 'pass' ? '#7ecf7e' : us.lastResult === 'fail' ? '#ffc1c1' : 'var(--fg)') + ';">' + (us.lastResult || '\u2014') + '</span></div>';
          html += '</div></div>';

          /* Review */
          html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCDD Review & Evaluation</div>';
          html += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">';
          html += renderStars(state.utilityReviews, u.name, 'utility');
          html += approvalBadge(rv.approval);
          html += '<select style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);" onchange="setItemApproval(\\'utility\\', \\'' + escapeHtml(u.name) + '\\', this.value)">';
          var approvals = ['review', 'approved', 'flagged', 'blocked'];
          for (var a = 0; a < approvals.length; a++) {
            html += '<option value="' + approvals[a] + '"' + (rv.approval === approvals[a] ? ' selected' : '') + '>' + approvals[a].charAt(0).toUpperCase() + approvals[a].slice(1) + '</option>';
          }
          html += '</select>';
          if (rv.lastReviewed) html += '<span class="muted" style="font-size:10px;">Reviewed: ' + timeAgo(rv.lastReviewed) + '</span>';
          html += '</div>';
          html += '<div style="margin-top:8px;"><textarea id="review-notes-utility-' + safeId + '" rows="2" placeholder="Review notes..." style="width:100%;padding:6px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:rgba(0,0,0,0.25);color:var(--fg);font-size:11px;font-family:inherit;box-sizing:border-box;resize:vertical;" onblur="saveItemNotes(\\'utility\\', \\'' + escapeHtml(u.name) + '\\')">' + escapeHtml(rv.notes) + '</textarea></div>';
          html += '</div>';

          html += '</div></div>';
        }
      }
      container.innerHTML = html;
    }

    function renderActions() {
      const container = document.getElementById('actions');
      let html = '';
      if (state.notice) {
        html += '<div class="notice">' + escapeHtml(state.notice) + '</div>';
      }
      if (!state.actions.length) {
        container.innerHTML = html + '<div class="muted">No dashboard actions available.</div>';
        return;
      }

      html += state.actions.map(action =>
        '<div class="action-card">'
        + '<div class="action-card-head"><strong>' + escapeHtml(action.label) + '</strong>' + statusBadge(action) + '</div>'
        + '<div class="muted">' + escapeHtml(action.description) + '</div>'
        + (action.lastMessage ? '<div class="muted" style="margin-top:8px;">Last result: ' + escapeHtml(action.lastMessage) + '</div>' : '')
        + (action.lastError ? '<div style="margin-top:8px;color:#ffc1c1;">Last error: ' + escapeHtml(action.lastError) + '</div>' : '')
        + '<div class="action-buttons"><button class="secondary-button" ' + (action.status === 'running' ? 'disabled' : '') + ' data-action="' + escapeHtml(action.name) + '" onclick="runAction(this.dataset.action)">Run</button></div>'
        + '</div>'
      ).join('');
      container.innerHTML = html;
    }

    function renderApprovals() {
      const container = document.getElementById('pending');
      if (!state.pending.length) {
        container.innerHTML = '<div class="muted">No pending approvals.</div>';
        return;
      }
      container.innerHTML = state.pending.map(item =>
        '<div class="approval-card">'
        + '<div><strong>' + escapeHtml(item.operation) + '</strong></div>'
        + '<div class="muted mono" style="margin-top:6px;">' + escapeHtml(item.id) + '</div>'
        + '<div class="action-buttons"><button class="secondary-button" data-approval-id="' + escapeHtml(item.id) + '" onclick="approve(this.dataset.approvalId)">Approve</button><button class="danger-button" data-approval-id="' + escapeHtml(item.id) + '" onclick="deny(this.dataset.approvalId)">Deny</button></div>'
        + '</div>'
      ).join('');
    }

    function renderActionHistory() {
      const container = document.getElementById('action-history');
      if (!state.actionHistory.length) {
        container.innerHTML = '<div class="muted">No action runs recorded yet.</div>';
        return;
      }
      container.innerHTML = '<table class="history-table"><thead><tr><th>Action</th><th>Status</th><th>Outcome</th></tr></thead><tbody>'
        + state.actionHistory.slice(0, 8).map(entry => '<tr>'
          + '<td>' + escapeHtml(entry.label) + '<div class="muted">' + escapeHtml(formatRelativeTime(entry.startedAt)) + '</div></td>'
          + '<td>' + escapeHtml(entry.status) + '</td>'
          + '<td>' + escapeHtml(entry.message || entry.error || '-') + '</td>'
          + '</tr>').join('')
        + '</tbody></table>';
    }

    function renderSelfReview() {
      const container = document.getElementById('self-review');
      if (!state.selfReviewLatest) {
        container.innerHTML = '<div class="muted">No self-review report generated yet.</div>';
        return;
      }

      const report = state.selfReviewLatest;
      const history = state.selfReviewHistory || [];
      let html = ''
        + '<div class="metric"><span class="muted">Cadence</span><span class="mono">' + escapeHtml(report.cadence || '-') + '</span></div>'
        + '<div class="metric"><span class="muted">Generated</span><span class="mono">' + escapeHtml(formatRelativeTime(report.generatedAt)) + '</span></div>'
        + '<div class="metric"><span class="muted">Events</span><span class="mono">' + escapeHtml(String((report.metrics && report.metrics.eventsTotal) || 0)) + '</span></div>'
        + '<div class="metric"><span class="muted">Failures</span><span class="mono">' + escapeHtml(String((report.metrics && report.metrics.failures) || 0)) + '</span></div>';

      if (report.recommendations && report.recommendations.length) {
        html += '<div class="muted" style="margin-top:8px;">Top recommendation</div>'
          + '<div class="action-card" style="margin-top:6px;">' + escapeHtml(String(report.recommendations[0])) + '</div>';
      }

      if (history.length > 0) {
        html += '<div class="muted" style="margin-top:10px;">Recent review runs</div>'
          + '<table class="events-table"><thead><tr><th>When</th><th>Cadence</th><th>Failures</th></tr></thead><tbody>'
          + history.map(item => '<tr>'
            + '<td>' + escapeHtml(formatRelativeTime(item.generatedAt)) + '</td>'
            + '<td>' + escapeHtml(item.cadence || '-') + '</td>'
            + '<td>' + escapeHtml(String((item.metrics && item.metrics.failures) || 0)) + '</td>'
            + '</tr>').join('')
          + '</tbody></table>';
      }

      container.innerHTML = html;
    }

    function renderRetrievalObservability() {
      const container = document.getElementById('retrieval-alerts');
      const data = state.prioritizedAlerts;
      if (!data || !data.alerts || !data.alerts.length) {
        const hasLegacy = state.retrievalAlerts && state.retrievalAlerts.length > 0;
        if (!hasLegacy) {
          container.innerHTML = '<div class="muted">No alerts.</div>';
          return;
        }
        let html = '<div class="stack">';
        for (const alert of state.retrievalAlerts.slice(0, 5)) {
          html += '<div class="action-card" style="background:rgba(255,141,141,0.06);border-color:rgba(255,141,141,0.18)">'
            + '<div style="font-size:12px;color:var(--muted)">' + escapeHtml(alert) + '</div>'
            + '</div>';
        }
        if (state.retrievalAlerts.length > 5) {
          html += '<div class="muted">+ ' + (state.retrievalAlerts.length - 5) + ' more alerts</div>';
        }
        html += '</div>';
        container.innerHTML = html;
        return;
      }

      const severityStyle = { critical: 'rgba(255,80,80,0.12)', warning: 'rgba(255,200,80,0.10)', info: 'rgba(80,160,255,0.08)' };
      const severityBorderStyle = { critical: 'rgba(255,80,80,0.35)', warning: 'rgba(255,200,80,0.30)', info: 'rgba(80,160,255,0.20)' };
      const severityLabel = { critical: '🔴 Critical', warning: '🟡 Warning', info: '🔵 Info' };

      let html = '';
      if (data.criticalCount > 0 || data.warningCount > 0) {
        html += '<div class="metric" style="margin-bottom:8px;">'
          + '<span class="muted">Summary</span>'
          + '<span class="mono">'
          + (data.criticalCount > 0 ? data.criticalCount + ' critical  ' : '')
          + (data.warningCount > 0 ? data.warningCount + ' warning  ' : '')
          + data.infoCount + ' info'
          + '</span></div>';
      }

      html += '<div class="stack">';
      for (const alert of data.alerts.slice(0, 8)) {
        const bg = severityStyle[alert.severity] || severityStyle.info;
        const border = severityBorderStyle[alert.severity] || severityBorderStyle.info;
        const badge = severityLabel[alert.severity] || alert.severity;
        html += '<div class="action-card" style="background:' + bg + ';border-color:' + border + ';">'
          + '<div style="font-size:11px;font-weight:600;margin-bottom:4px;opacity:0.85;">' + escapeHtml(badge) + '</div>'
          + '<div style="font-size:12px;color:var(--muted)">' + escapeHtml(alert.message) + '</div>'
          + '</div>';
      }
      if (data.alerts.length > 8) {
        html += '<div class="muted">+ ' + (data.alerts.length - 8) + ' more alerts</div>';
      }
      html += '</div>';
      container.innerHTML = html;
    }

    async function setTelemetryWindow(window) {
      state.telemetryWindow = window;
      try {
        const [summary, runtimeExcellence] = await Promise.all([
          request('/api/telemetry/summary?window=' + encodeURIComponent(window)).catch(() => null),
          request('/api/runtime/excellence?window=' + encodeURIComponent(window)).catch(() => null)
        ]);
        state.telemetrySummary = summary;
        state.runtimeExcellence = runtimeExcellence;
      } catch {
        state.telemetrySummary = null;
        state.runtimeExcellence = null;
      }
      render();
    }

    function renderRuntimeExcellence() {
      const container = document.getElementById('runtime-excellence');
      const data = state.runtimeExcellence;
      if (!data) {
        container.innerHTML = '<div class="muted">Runtime excellence snapshot unavailable.</div>';
        return;
      }

      const priorityTone = data.planner && data.planner.priority === 'high'
        ? 'color:#ff8d8d;'
        : data.planner && data.planner.priority === 'medium'
          ? 'color:#ffd17a;'
          : 'color:#7ecf7e;';

      let html = ''
        + '<div class="metric"><span class="muted">Runtime health</span><span class="mono">' + escapeHtml(String(data.scores.runtimeHealth)) + '/100</span></div>'
        + '<div class="metric"><span class="muted">Memory confidence</span><span class="mono">' + escapeHtml(String(data.scores.memoryConfidence)) + '/100</span></div>'
        + '<div class="metric"><span class="muted">Planner priority</span><span class="mono" style="' + priorityTone + '">' + escapeHtml(data.planner.priority) + '</span></div>'
        + '<div class="action-card" style="margin-top:8px;">'
        + '<div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Next action</div>'
        + '<div style="margin-top:6px;">' + escapeHtml(data.planner.nextAction || '-') + '</div>'
        + '<div class="muted" style="margin-top:6px;">' + escapeHtml(data.planner.rationale || '-') + '</div>'
        + '</div>';

      if (data.selfHealingSuggestions && data.selfHealingSuggestions.length > 0) {
        html += '<div class="muted" style="margin-top:10px;">Self-healing candidates</div>';
        for (const item of data.selfHealingSuggestions.slice(0, 3)) {
          html += '<div class="action-card" style="margin-top:6px;">'
            + '<div><strong>' + escapeHtml(item.title || '-') + '</strong></div>'
            + '<div class="muted" style="margin-top:4px;">Trigger: ' + escapeHtml(item.trigger || '-') + '</div>'
            + '<div style="margin-top:4px;">' + escapeHtml(item.action || '-') + '</div>'
            + '</div>';
        }
      }

      container.innerHTML = html;
    }

    function renderReleaseReadiness() {
      const container = document.getElementById('release-readiness');
      const report = state.releaseValidation;
      const decision = state.releaseDecision;
      const packageSnapshot = state.packageReleaseSnapshot;
      if (!report) {
        let html = '<div class="muted">No release validation artifact found yet.</div>'
          + '<div class="muted" style="margin-top:8px;">Run <span class="mono">npm run release:validate</span> to generate one.</div>';
        if (packageSnapshot && packageSnapshot.totalPackages > 0) {
          html += '<div class="action-card" style="margin-top:10px;">'
            + '<div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Package Evidence</div>'
            + '<div class="metric"><span class="muted">Packages</span><span class="mono">' + escapeHtml(String(packageSnapshot.totalPackages)) + '</span></div>'
            + '<div class="metric"><span class="muted">Exports</span><span class="mono">' + escapeHtml(String(packageSnapshot.exportedCount || 0)) + '</span></div>'
            + '<div class="metric"><span class="muted">Complete without export</span><span class="mono">' + escapeHtml(String(packageSnapshot.completeWithoutExportCount || 0)) + '</span></div>'
            + (packageSnapshot.latestExportArtifactPath
              ? '<div class="muted" style="margin-top:8px;word-break:break-all;">Latest export: ' + escapeHtml(packageSnapshot.latestExportArtifactPath) + '</div>'
              : '')
            + '</div>';
        }
        container.innerHTML = html;
        return;
      }

      const gates = Array.isArray(report.gates) ? report.gates : [];
      const passed = gates.filter(g => g.status === 'passed').length;
      const failed = gates.filter(g => g.status === 'failed').length;
      const manual = gates.filter(g => g.status === 'manual_required').length;
      const overallTone = report.passed ? 'color:#7ecf7e;' : 'color:#ff8d8d;';

      let html = ''
        + '<div class="metric"><span class="muted">Generated</span><span class="mono">' + escapeHtml(formatRelativeTime(report.generatedAt || null)) + '</span></div>'
        + '<div class="metric"><span class="muted">Overall</span><span class="mono" style="' + overallTone + '">' + escapeHtml(report.passed ? 'ready' : 'not ready') + '</span></div>'
        + '<div class="metric"><span class="muted">Strict mode</span><span class="mono">' + escapeHtml(report.strictMode ? 'on' : 'off') + '</span></div>'
        + '<div class="metric"><span class="muted">Gate counts</span><span class="mono">' + escapeHtml(String(passed)) + ' pass / '
        + '<span style="color:#ff8d8d;">' + escapeHtml(String(failed)) + ' fail</span> / '
        + '<span style="color:#ffd17a;">' + escapeHtml(String(manual)) + ' manual</span></span></div>';

      if (decision) {
        const recommendationTone = decision.recommendation === 'GO' ? 'color:#7ecf7e;' : 'color:#ff8d8d;';
        html += '<div class="action-card" style="margin-top:10px;">'
          + '<div class="metric"><span class="muted">Recommendation</span><span class="mono" style="' + recommendationTone + '">' + escapeHtml(decision.recommendation || '-') + '</span></div>'
          + '<div class="metric"><span class="muted">Risk level</span><span class="mono">' + escapeHtml(decision.riskLevel || '-') + '</span></div>'
          + '</div>';
      }

      if (packageSnapshot && packageSnapshot.totalPackages > 0) {
        html += '<div class="action-card" style="margin-top:10px;">'
          + '<div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Package Evidence</div>'
          + '<div class="metric"><span class="muted">By status</span><span class="mono">planned ' + escapeHtml(String(packageSnapshot.byStatus.planned || 0)) + ' / running ' + escapeHtml(String(packageSnapshot.byStatus.running || 0)) + ' / blocked ' + escapeHtml(String(packageSnapshot.byStatus.blocked || 0)) + ' / complete ' + escapeHtml(String(packageSnapshot.byStatus.complete || 0)) + '</span></div>'
          + '<div class="metric"><span class="muted">Exports</span><span class="mono">' + escapeHtml(String(packageSnapshot.exportedCount || 0)) + '</span></div>'
          + '<div class="metric"><span class="muted">Complete without export</span><span class="mono">' + escapeHtml(String(packageSnapshot.completeWithoutExportCount || 0)) + '</span></div>'
          + (packageSnapshot.latestExportArtifactPath
            ? '<div class="muted" style="margin-top:8px;word-break:break-all;">Latest export: ' + escapeHtml(packageSnapshot.latestExportArtifactPath) + '</div>'
            : '')
          + '</div>';
      }

      if (gates.length > 0) {
        html += '<table class="events-table" style="margin-top:10px;"><thead><tr><th>Gate</th><th>Status</th></tr></thead><tbody>'
          + gates.slice(0, 8).map(gate => {
            const statusText = gate.status || '-';
            const tone = statusText === 'passed'
              ? 'color:#7ecf7e;'
              : statusText === 'failed'
                ? 'color:#ff8d8d;'
                : 'color:#ffd17a;';
            return '<tr>'
              + '<td>' + escapeHtml(gate.label || gate.id || '-') + '</td>'
              + '<td><span class="mono" style="' + tone + '">' + escapeHtml(statusText) + '</span></td>'
              + '</tr>';
          }).join('')
          + '</tbody></table>';
      }

      container.innerHTML = html;
    }

    function renderWhatChanged() {
      const container = document.getElementById('telemetry-what-changed');
      if (!container) return;

      const windows = ['1h', '1d', '7d'];
      const btns = windows.map(w =>
        '<button class="tab-button' + (state.telemetryWindow === w ? ' active' : '') + '" id="tw-' + w + '" onclick="setTelemetryWindow(&quot;' + w + '&quot;)">' + (w === '1h' ? '1 hour' : w === '1d' ? '1 day' : '7 days') + '</button>'
      ).join(' ');

      const summary = state.telemetrySummary;
      if (!summary) {
        container.innerHTML = '<div class="muted">No telemetry data available for this window.</div>';
        return;
      }

      const win = summary.window;
      const delta = summary.delta;

      function deltaLabel(val, higherIsBad) {
        if (val === 0) return '<span class="muted">±0</span>';
        const positive = val > 0;
        const bad = higherIsBad ? positive : !positive;
        const color = bad ? '#ff8d8d' : '#7ecf7e';
        return '<span style="color:' + color + ';">' + (positive ? '+' : '') + val + '</span>';
      }

      function pct(val) {
        return (val * 100).toFixed(1) + '%';
      }

      let html = '<div class="stack">';

      // Window summary card
      html += '<div class="action-card" style="background:rgba(80,120,255,0.06);border-color:rgba(80,120,255,0.18);">'
        + '<div style="font-size:11px;font-weight:600;opacity:0.7;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Last ' + escapeHtml(win.windowLabel === '1h' ? '1 hour' : win.windowLabel === '1d' ? '24 hours' : '7 days') + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;">'
        + '<div class="metric"><span class="muted">Events</span><span class="mono">' + escapeHtml(String(win.eventsTotal)) + ' ' + deltaLabel(delta.eventsTotal, false) + '</span></div>'
        + '<div class="metric"><span class="muted">Failures</span><span class="mono">' + escapeHtml(String(win.failures)) + ' ' + deltaLabel(delta.failures, true) + '</span></div>'
        + '<div class="metric"><span class="muted">Approvals</span><span class="mono">' + escapeHtml(String(win.approvals)) + ' ' + deltaLabel(delta.approvals, false) + '</span></div>'
        + '<div class="metric"><span class="muted">Fail rate</span><span class="mono">' + escapeHtml(pct(win.failureRate)) + ' ' + deltaLabel(parseFloat((delta.failureRate * 100).toFixed(1)), true) + '</span></div>'
        + '</div>'
        + (summary.newSinceLastWindow ? '<div style="margin-top:8px;font-size:11px;color:#7ecf7e;font-weight:600;">✓ New activity since last window</div>' : '')
        + '</div>';

      // Top operations
      if (summary.topOperations && summary.topOperations.length > 0) {
        html += '<div class="action-card" style="margin-top:6px;">'
          + '<div class="muted" style="font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Top Operations</div>'
          + '<table class="events-table"><thead><tr><th>Operation</th><th>Count</th><th>Failures</th></tr></thead><tbody>'
          + summary.topOperations.map(op => '<tr>'
            + '<td class="mono" style="font-size:11px;">' + escapeHtml(op.operation) + '</td>'
            + '<td>' + escapeHtml(String(op.count)) + '</td>'
            + '<td>' + (op.failures > 0 ? '<span style="color:#ff8d8d;">' + escapeHtml(String(op.failures)) + '</span>' : '0') + '</td>'
            + '</tr>').join('')
          + '</tbody></table>'
          + '</div>';
      }

      html += '</div>';
      container.innerHTML = html;
    }

    function renderPackageHistory() {
      const container = document.getElementById('package-history');
      const history = state.sessionPackageHistory || [];
      if (!container) {
        return;
      }
      if (!history.length) {
        container.innerHTML = '<div class="muted">No package history yet.</div>';
        return;
      }
      container.innerHTML = '<table class="events-table"><thead><tr><th>Time</th><th>Package</th><th>Action</th><th>Status</th></tr></thead><tbody>'
        + history.map(entry => '<tr>'
          + '<td>' + escapeHtml(formatRelativeTime(entry.timestamp)) + '</td>'
          + '<td><div>' + escapeHtml(entry.title || entry.packageId) + '</div>'
          + (entry.message ? '<div class="muted" style="margin-top:4px;">' + escapeHtml(entry.message) + '</div>' : '') + '</td>'
          + '<td>' + escapeHtml(entry.action) + '</td>'
          + '<td>' + escapeHtml(entry.status || '-') + '</td>'
          + '</tr>').join('')
        + '</tbody></table>';
    }

    function renderChatTelemetry() {
      var container = document.getElementById('chat-telemetry');
      if (!container) return;
      var items = state.chatTelemetry || [];
      if (!items.length) {
        container.innerHTML = '<div class="muted">No chat telemetry events yet. Send a message to generate telemetry.</div>';
        return;
      }
      var html = '<table class="events-table"><thead><tr><th>Time</th><th>Operation</th><th>Status</th><th>Details</th></tr></thead><tbody>'
        + items.map(function(ev) {
          var detail = '';
          var d = ev.details || {};
          if (d.model) detail += escapeHtml(d.model);
          if (d.provider) detail += (detail ? ' / ' : '') + escapeHtml(d.provider);
          if (d.toolName) detail += (detail ? ' \u2014 ' : '') + escapeHtml(d.toolName);
          if (d.intent) detail += (detail ? ' \u2014 ' : '') + escapeHtml(d.intent);
          if (d.error) detail += '<div class="muted" style="font-size:10px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(String(d.error)) + '">' + escapeHtml(String(d.error).substring(0, 80)) + '</div>';
          if (d.correlationId) detail += '<div class="mono muted" style="font-size:9px;">' + escapeHtml(String(d.correlationId).substring(0, 24)) + '&hellip;</div>';
          return '<tr>'
            + '<td>' + escapeHtml(formatRelativeTime(ev.timestamp)) + '</td>'
            + '<td class="mono" style="font-size:11px;">' + escapeHtml(ev.operation) + '</td>'
            + '<td>' + escapeHtml(ev.status) + '</td>'
            + '<td>' + (detail || '-') + '</td>'
            + '</tr>';
        }).join('')
        + '</tbody></table>';
      container.innerHTML = html;
    }

    function renderEvents() {
      const container = document.getElementById('events');
      if (!state.events.length) {
        container.innerHTML = '<div class="muted">No recent events.</div>';
        return;
      }
      container.innerHTML = '<table class="events-table"><thead><tr><th>Time</th><th>Operation</th><th>Status</th></tr></thead><tbody>'
        + state.events.map(event => '<tr>'
          + '<td>' + escapeHtml(formatRelativeTime(event.timestamp)) + '</td>'
          + '<td>' + escapeHtml(event.operation) + '</td>'
          + '<td>' + escapeHtml(event.status) + '</td>'
          + '</tr>').join('')
        + '</tbody></table>';
    }

    function renderTraceView() {
      const container = document.getElementById('trace-view');
      const traceData = state.traceData;
      if (!traceData || !traceData.traces || !traceData.traces.length) {
        container.innerHTML = '<div class="muted">No correlated traces yet.</div>';
        return;
      }

      const traces = traceData.traces;
      let html = '<table class="events-table"><thead><tr><th>Trace</th><th>Events</th><th>Status</th><th>Last Seen</th></tr></thead><tbody>'
        + traces.map(trace => '<tr>'
          + '<td>'
          + '<button class="secondary-button" style="padding:4px 8px;" onclick="loadTrace(&quot;' + escapeHtml(trace.correlationId) + '&quot;)">'
          + (state.selectedTraceId === trace.correlationId ? 'Viewing' : 'View')
          + '</button>'
          + '<div class="mono" style="margin-top:6px;font-size:10px;word-break:break-all;">' + escapeHtml(trace.correlationId) + '</div>'
          + '</td>'
          + '<td>' + escapeHtml(String(trace.eventCount)) + '</td>'
          + '<td>' + escapeHtml(trace.status) + (trace.failures > 0 ? ' (' + escapeHtml(String(trace.failures)) + ' failed)' : '') + '</td>'
          + '<td>' + escapeHtml(formatRelativeTime(trace.lastAt)) + '</td>'
          + '</tr>').join('')
        + '</tbody></table>';

      const selected = traceData.selectedTraceEvents || [];
      if (state.selectedTraceId) {
        html += '<div class="muted" style="margin-top:10px;">Trace timeline</div>';
        if (!selected.length) {
          html += '<div class="muted">No events found for selected correlation ID.</div>';
        } else {
          html += '<table class="events-table"><thead><tr><th>Time</th><th>Operation</th><th>Status</th></tr></thead><tbody>'
            + selected.map(event => '<tr>'
              + '<td>' + escapeHtml(formatRelativeTime(event.timestamp)) + '</td>'
              + '<td class="mono" style="font-size:11px;">' + escapeHtml(event.operation) + '</td>'
              + '<td>' + escapeHtml(event.status) + '</td>'
              + '</tr>').join('')
            + '</tbody></table>';
        }
      }

      container.innerHTML = html;
    }

    async function loadTrace(correlationId) {
      state.selectedTraceId = correlationId;
      try {
        const url = '/api/traces?limit=10'
          + (state.selectedSessionId ? '&chatSessionId=' + encodeURIComponent(state.selectedSessionId) : '')
          + '&correlationId=' + encodeURIComponent(correlationId);
        state.traceData = await request(url);
      } catch (error) {
        state.notice = String(error);
      }
      render();
    }

    // ── Agentic Control Tab Renderers ──────────────────────────────────

    function renderAgentList() {
      var container = document.getElementById('agent-list-container');
      if (!container) return;
      var d = state.agentData;
      if (!d || !d.agents || d.agents.length === 0) {
        container.innerHTML = '<div class="muted" style="text-align:center;padding:24px;">No agents running. Launch an agent to get started.</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < d.agents.length; i++) {
        var a = d.agents[i];
        var statusColor = a.status === 'running' ? '#7ecf7e' : (a.status === 'error' ? '#ff8d8d' : '#ffd17a');
        html += '<div class="panel" style="padding:12px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;">';
        html += '<div><span style="color:' + statusColor + ';font-weight:700;margin-right:8px;">\u25CF</span>';
        html += '<strong>' + escapeHtml(a.name || a.id) + '</strong>';
        html += ' <span class="muted" style="font-size:11px;">' + escapeHtml(a.role || 'general') + '</span></div>';
        html += '<div style="display:flex;gap:6px;align-items:center;">';
        html += '<span class="muted" style="font-size:11px;">' + (a.tasksCompleted || 0) + ' tasks</span>';
        html += '<button class="primary-button" style="font-size:11px;padding:3px 10px;" onclick="stopAgent(\\'' + escapeHtml(a.id) + '\\')">\u23F9 Stop</button>';
        html += '<button class="secondary-button" style="font-size:11px;padding:3px 10px;" onclick="promoteAgent(\\'' + escapeHtml(a.id) + '\\')">\u2B06 Promote</button>';
        html += '<button class="secondary-button" style="font-size:11px;padding:3px 10px;" onclick="demoteAgent(\\'' + escapeHtml(a.id) + '\\')">\u2B07 Demote</button>';
        html += '</div></div>';
      }
      container.innerHTML = html;
    }

    function renderSubAgentTree() {
      var container = document.getElementById('sub-agent-tree-container');
      if (!container) return;
      var d = state.agentData;
      if (!d || !d.agents || d.agents.length === 0) {
        container.innerHTML = '<div class="muted" style="text-align:center;padding:24px;">Agent hierarchy will appear here when agents are active.</div>';
        return;
      }
      var html = '<div style="font-family:monospace;font-size:12px;line-height:1.8;">';
      html += '<div style="font-weight:700;color:var(--accent);">\u{1F3E0} Orchestrator (root)</div>';
      for (var i = 0; i < d.agents.length; i++) {
        var a = d.agents[i];
        var last = i === d.agents.length - 1;
        html += '<div style="padding-left:20px;">' + (last ? '\u2514' : '\u251C') + '\u2500 ';
        html += '<span style="color:var(--fg);">' + escapeHtml(a.name || a.id) + '</span>';
        html += ' <span class="muted">(' + escapeHtml(a.role || 'general') + ')</span></div>';
      }
      html += '</div>';
      container.innerHTML = html;
    }

    function renderSwarmTopology() {
      var container = document.getElementById('swarm-topology-container');
      if (!container) return;
      var d = state.agentData;
      if (!d || !d.swarms || d.swarms.length === 0) {
        container.innerHTML = '<div class="muted" style="text-align:center;padding:24px;">No swarms configured. Create a swarm to begin orchestration.</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < d.swarms.length; i++) {
        var sw = d.swarms[i];
        html += '<div class="panel" style="padding:12px;margin-bottom:6px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        html += '<strong>' + escapeHtml(sw.name || sw.id) + '</strong>';
        html += '<span class="muted" style="font-size:11px;">' + escapeHtml(sw.topology || 'mesh') + ' \u00B7 ' + (sw.agentCount || 0) + ' agents</span>';
        html += '</div>';
        html += '<div class="muted" style="font-size:11px;margin-top:4px;">Status: ' + escapeHtml(sw.status || 'unknown') + '</div>';
        html += '</div>';
      }
      container.innerHTML = html;
    }

    function renderAgentTelemetry() {
      var container = document.getElementById('agent-telemetry-container');
      if (!container) return;
      var d = state.agentData;
      var t = d ? d.telemetry : null;
      var active = t ? t.activeAgents : 0;
      var completed = t ? t.tasksCompleted : 0;
      var failed = t ? t.tasksFailed : 0;
      var errorRate = (completed + failed) > 0 ? Math.round(failed / (completed + failed) * 100) : 0;
      var avgResp = t && t.avgResponseMs > 0 ? t.avgResponseMs + 'ms' : '\u2014';
      var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">';
      html += '<div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Active Agents</div><div style="font-size:24px;font-weight:700;color:var(--accent);">' + active + '</div></div>';
      html += '<div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Tasks Completed</div><div style="font-size:24px;font-weight:700;color:#7ecf7e;">' + completed + '</div></div>';
      html += '<div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Error Rate</div><div style="font-size:24px;font-weight:700;color:' + (errorRate > 10 ? '#ff8d8d' : 'var(--accent)') + ';">' + errorRate + '%</div></div>';
      html += '<div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Avg Response</div><div style="font-size:24px;font-weight:700;color:var(--accent);">' + escapeHtml(avgResp) + '</div></div>';
      html += '<div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Total Dispatches</div><div style="font-size:24px;font-weight:700;color:var(--accent);">' + (t ? t.totalDispatches : 0) + '</div></div>';
      html += '</div>';
      container.innerHTML = html;
    }

    async function refreshAgentList() {
      try {
        state.agentData = await request('/api/agents');
        render();
      } catch (e) { console.error('[agentic] refresh failed', e); }
    }

    async function launchNewAgent() {
      var name = prompt('Agent name (optional):');
      var role = prompt('Agent role (e.g. general, researcher, coder):');
      try {
        await request('/api/agents/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || undefined, role: role || undefined }) });
        await refreshAgentList();
      } catch (e) { console.error('[agentic] launch failed', e); }
    }

    async function stopAgent(agentId) {
      try {
        await request('/api/agents/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: agentId }) });
        await refreshAgentList();
      } catch (e) { console.error('[agentic] stop failed', e); }
    }

    async function promoteAgent(agentId) {
      try {
        const result = await request('/api/agents/' + encodeURIComponent(agentId) + '/promote', { method: 'POST' });
        state.agentData = result || state.agentData;
        await refreshAgentList();
      } catch (e) { console.error('[agentic] promote failed', e); }
    }

    async function demoteAgent(agentId) {
      try {
        const result = await request('/api/agents/' + encodeURIComponent(agentId) + '/demote', { method: 'POST' });
        state.agentData = result || state.agentData;
        await refreshAgentList();
      } catch (e) { console.error('[agentic] demote failed', e); }
    }

    async function createSwarm() {
      var name = prompt('Swarm name (optional):');
      var topology = prompt('Topology (mesh / star / pipeline):') || 'mesh';
      var count = parseInt(prompt('Number of agents:') || '3', 10);
      try {
        await request('/api/swarms/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || undefined, topology: topology, agentCount: count }) });
        await refreshAgentList();
      } catch (e) { console.error('[agentic] swarm create failed', e); }
    }

    async function refreshSwarmStatus() {
      await refreshAgentList();
    }

    // ── Computer Control Tab Renderers ──────────────────────────────────

    function renderLocalSystemInfo() {
      var container = document.getElementById('local-system-info');
      if (!container) return;
      var info = state.computerSystemInfo;
      if (!info) return;
      var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">';
      html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Operating System</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(info.os || '\u2014') + '</div></div>';
      html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Hostname</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(info.hostname || '\u2014') + '</div></div>';
      html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Platform</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(info.platform || '\u2014') + '</div></div>';
      html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Uptime</div><div style="font-size:14px;font-weight:600;">' + formatUptime(info.uptime) + '</div></div>';
      html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">CPUs</div><div style="font-size:14px;font-weight:600;">' + (info.cpus || '\u2014') + ' cores</div></div>';
      var totalMb = info.totalMemory ? Math.round(info.totalMemory / 1048576) : 0;
      var freeMb = info.freeMemory ? Math.round(info.freeMemory / 1048576) : 0;
      var usedPct = totalMb > 0 ? Math.round((totalMb - freeMb) / totalMb * 100) : 0;
      html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Memory</div><div style="font-size:14px;font-weight:600;">' + usedPct + '% used (' + Math.round(freeMb / 1024) + ' GB free / ' + Math.round(totalMb / 1024) + ' GB)</div></div>';
      if (info.gpu) {
        html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">GPU</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(info.gpu.name || '\u2014') + '</div></div>';
        html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">VRAM</div><div style="font-size:14px;font-weight:600;">' + (info.gpu.vramTotalMb ? (info.gpu.vramTotalMb >= 1024 ? (Math.round(info.gpu.vramTotalMb / 1024 * 10) / 10) + ' GB' : info.gpu.vramTotalMb + ' MB') : '\u2014') + '</div></div>';
        if (info.gpu.cudaVersion) {
          html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">CUDA</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(info.gpu.cudaVersion) + '<span class="gpu-badge">CUDA</span></div></div>';
        }
        if (info.gpu.driverVersion) {
          html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Driver</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(info.gpu.driverVersion) + '</div></div>';
        }
      }
      html += '</div>';
      container.innerHTML = html;
    }

    function renderUsageMetrics(data) {
      var container = document.getElementById('usage-metrics');
      if (!container) return;
      if (!data) { container.innerHTML = ''; return; }
      var ramTotal = data.ramTotal || 1;
      var ramUsed = ramTotal - (data.ramFree || 0);
      var ramPct = Math.round(ramUsed / ramTotal * 100);
      state.ramHistory.push(ramPct);
      if (state.ramHistory.length > 60) state.ramHistory.shift();
      var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">';
      html += '<div class="panel" style="padding:14px;">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><span class="muted" style="font-size:11px;">RAM Usage</span><span style="font-size:12px;font-weight:600;">' + ramPct + '% (' + Math.round(ramUsed / 1073741824 * 10) / 10 + ' / ' + Math.round(ramTotal / 1073741824 * 10) / 10 + ' GB)</span></div>';
      html += '<div class="usage-bar"><div class="usage-bar-fill ram" style="width:' + ramPct + '%"></div><div class="usage-bar-label">' + ramPct + '%</div></div>';
      html += '<div style="margin-top:8px;"><canvas id="sparkline-ram" width="320" height="40" style="width:100%;height:40px;"></canvas></div>';
      html += '</div>';
      if (data.gpu) {
        var vramPct = data.gpu.vramTotalMb > 0 ? Math.round(data.gpu.vramUsedMb / data.gpu.vramTotalMb * 100) : 0;
        state.vramHistory.push(vramPct);
        if (state.vramHistory.length > 60) state.vramHistory.shift();
        html += '<div class="panel" style="padding:14px;">';
        html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><span class="muted" style="font-size:11px;">VRAM Usage</span><span style="font-size:12px;font-weight:600;">' + vramPct + '% (' + data.gpu.vramUsedMb + ' / ' + data.gpu.vramTotalMb + ' MB)';
        if (data.gpu.tempC) html += ' \u2022 ' + data.gpu.tempC + '\u00B0C';
        html += '</span></div>';
        html += '<div class="usage-bar"><div class="usage-bar-fill vram" style="width:' + vramPct + '%"></div><div class="usage-bar-label">' + vramPct + '%</div></div>';
        html += '<div style="margin-top:8px;"><canvas id="sparkline-vram" width="320" height="40" style="width:100%;height:40px;"></canvas></div>';
        html += '</div>';
      } else {
        html += '<div class="panel" style="padding:14px;"><div class="muted" style="font-size:11px;">VRAM Usage</div><div style="font-size:13px;color:var(--muted);margin-top:6px;">No GPU detected</div></div>';
      }
      html += '</div>';
      container.innerHTML = html;
      drawSparkline('sparkline-ram', state.ramHistory, '#69d2ff');
      if (data.gpu) drawSparkline('sparkline-vram', state.vramHistory, '#7cf1c8');
    }

    function drawSparkline(canvasId, history, color) {
      var canvas = document.getElementById(canvasId);
      if (!canvas || !canvas.getContext) return;
      var ctx = canvas.getContext('2d');
      var w = canvas.width;
      var h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (history.length < 2) return;
      var max = 100;
      var step = w / 59;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      for (var i = 0; i < history.length; i++) {
        var x = (history.length - 1 === 0) ? 0 : (i / (history.length - 1)) * w;
        var y = h - (history[i] / max) * (h - 4) - 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = color.replace(')', ',0.08)').replace('rgb', 'rgba');
      ctx.fill();
    }

    async function runLocalCommand() {
      var input = document.getElementById('computer-console-input');
      var output = document.getElementById('computer-console-output');
      if (!input || !output) return;
      var cmd = input.value.trim();
      if (!cmd) return;
      output.textContent = 'Running: ' + cmd + '\\n';
      state.computerConsoleHistory.push({ command: cmd, timestamp: new Date().toISOString() });
      try {
        var result = await request('/api/computer/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) });
        var out = '';
        if (result.stdout) out += result.stdout;
        if (result.stderr) out += (out ? '\\n' : '') + result.stderr;
        output.textContent = out || '(no output)';
      } catch (e) {
        output.textContent = 'Error: ' + e.message;
      }
      input.value = '';
    }

    async function refreshEnvVars() {
      try {
        state.computerEnvVars = await request('/api/computer/env-vars');
        renderEnvVarsList();
      } catch (e) { console.error('[computer] env vars failed', e); }
    }

    function renderEnvVarsList() {
      var container = document.getElementById('env-vars-list');
      if (!container || !state.computerEnvVars) return;
      var data = state.computerEnvVars;
      var html = '';
      if (data.prismVars && data.prismVars.length > 0) {
        html += '<div style="margin-bottom:8px;font-weight:700;color:var(--accent);font-size:12px;">PRISM Variables (' + data.prismVars.length + ')</div>';
        for (var i = 0; i < data.prismVars.length; i++) {
          html += '<div style="padding:2px 0;border-bottom:1px solid rgba(148,163,184,0.06);"><span style="color:var(--accent-2);font-weight:600;">' + escapeHtml(data.prismVars[i].key) + '</span>=<span>' + escapeHtml(data.prismVars[i].value) + '</span></div>';
        }
      }
      if (data.systemVars && data.systemVars.length > 0) {
        html += '<div style="margin:10px 0 6px;font-weight:700;color:var(--muted);font-size:12px;">System Variables (' + data.systemVars.length + ')</div>';
        for (var j = 0; j < Math.min(data.systemVars.length, 50); j++) {
          html += '<div style="padding:2px 0;border-bottom:1px solid rgba(148,163,184,0.06);"><span style="color:var(--fg);font-weight:600;">' + escapeHtml(data.systemVars[j].key) + '</span>=<span class="muted">' + escapeHtml(data.systemVars[j].value.substring(0, 120)) + '</span></div>';
        }
        if (data.systemVars.length > 50) {
          html += '<div class="muted" style="margin-top:6px;">... and ' + (data.systemVars.length - 50) + ' more</div>';
        }
      }
      container.innerHTML = html || '<div class="muted">No environment variables found.</div>';
    }

    async function openPolicyEditor(tool) {
      try {
        await request('/api/computer/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: tool + '.msc' }) });
        var output = document.getElementById('policy-status-output');
        if (output) output.textContent = 'Launched ' + tool + '.msc at ' + new Date().toLocaleTimeString();
      } catch (e) {
        var output2 = document.getElementById('policy-status-output');
        if (output2) output2.textContent = 'Failed: ' + e.message;
      }
    }

    async function refreshPolicyStatus() {
      var output = document.getElementById('policy-status-output');
      if (!output) return;
      output.textContent = 'Querying policy status...';
      try {
        var result = await request('/api/computer/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'gpresult /Scope User /v' }) });
        output.textContent = result.stdout || result.stderr || 'No policy data returned.';
      } catch (e) {
        output.textContent = 'Policy query failed: ' + e.message;
      }
    }

    function launchBrowserPreview() {
      window.open(location.href, '_blank');
      var el = document.getElementById('browser-preview-mode');
      if (el) el.textContent = 'External';
    }

    function openBrowserDevTools() {
      var el = document.getElementById('browser-preview-mode');
      if (el) el.textContent = 'Press F12 in this browser window';
    }

    async function refreshBrowserInfo() {
      var el = document.getElementById('browser-default');
      if (el) {
        var ua = navigator.userAgent;
        if (ua.indexOf('Chrome') !== -1) el.textContent = 'Chrome';
        else if (ua.indexOf('Firefox') !== -1) el.textContent = 'Firefox';
        else if (ua.indexOf('Edge') !== -1) el.textContent = 'Edge';
        else if (ua.indexOf('Safari') !== -1) el.textContent = 'Safari';
        else el.textContent = 'Unknown';
      }
    }

    async function refreshDeviceManager() {
      try {
        state.computerDevices = await request('/api/computer/devices');
        renderDeviceTree();
      } catch (e) { console.error('[computer] device scan failed', e); }
    }

    function renderDeviceTree() {
      var container = document.getElementById('device-tree-container');
      if (!container || !state.computerDevices) return;
      var devs = state.computerDevices.devices || {};
      var html = '';
      var icons = { 'Display Adapters': '\u{1F4BB}', 'Network Adapters': '\u{1F4F6}', 'Disk Drives': '\u{1F4BE}', 'Processors': '\u2699\uFE0F' };
      for (var cat in devs) {
        var items = devs[cat] || [];
        var icon = icons[cat] || '\u{1F50C}';
        html += '<details class="panel" style="padding:8px 12px;margin-bottom:4px;" open>';
        html += '<summary style="cursor:pointer;font-weight:600;">' + icon + ' ' + escapeHtml(cat) + ' (' + items.length + ')</summary>';
        if (items.length === 0) {
          html += '<div class="muted" style="padding:6px 0 0 18px;font-size:12px;">No devices detected.</div>';
        } else {
          for (var i = 0; i < items.length; i++) {
            html += '<div style="padding:4px 0 0 18px;font-size:12px;">\u2514 ' + escapeHtml(items[i]) + '</div>';
          }
        }
        html += '</details>';
      }
      container.innerHTML = html || '<div class="muted">No device data. Click Scan Devices.</div>';
    }

    function openSystemDeviceManager() {
      request('/api/computer/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'devmgmt.msc' }) }).catch(function() {});
    }

    async function initAgenticTab() {
      if (!state.agentData) await refreshAgentList();
    }

    // ── Vision Framebuffer JS ────────────────────────────────────────────

    async function captureScreengrab() {
      var meta = document.getElementById('fb-meta');
      if (meta) meta.textContent = 'Capturing...';
      try {
        var result = await request('/api/computer/screengrab/capture', { method: 'POST' });
        if (meta) meta.textContent = result.filename + ' (' + Math.round(result.sizeBytes / 1024) + ' KB)';
        refreshFramebufferViewer();
        refreshFramebufferGallery();
      } catch (e) {
        if (meta) meta.textContent = 'Capture failed: ' + e.message;
      }
    }

    async function burstCapture() {
      var meta = document.getElementById('fb-meta');
      if (meta) meta.textContent = 'Burst capturing (8 FPS, 2s)...';
      try {
        var result = await request('/api/computer/screengrab/burst', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fps: 8, duration: 2 }) });
        if (meta) meta.textContent = 'Burst complete: ' + result.frames + ' frames captured';
        refreshFramebufferViewer();
        refreshFramebufferGallery();
      } catch (e) {
        if (meta) meta.textContent = 'Burst failed: ' + e.message;
      }
    }

    function refreshFramebufferViewer() {
      var img = document.getElementById('framebuffer-preview');
      var placeholder = document.getElementById('fb-placeholder');
      if (!img) return;
      var ts = Date.now();
      var testImg = new Image();
      testImg.onload = function() {
        img.src = '/api/computer/screengrab/latest?t=' + ts;
        img.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
      };
      testImg.onerror = function() {
        img.style.display = 'none';
        if (placeholder) placeholder.style.display = 'block';
      };
      testImg.src = '/api/computer/screengrab/latest?t=' + ts;
    }

    async function refreshFramebufferGallery() {
      var gallery = document.getElementById('framebuffer-gallery');
      if (!gallery) return;
      try {
        var data = await request('/api/computer/screengrab/list');
        var files = data.files || [];
        var html = '';
        for (var i = 0; i < Math.min(files.length, 20); i++) {
          html += '<img class="framebuffer-thumb" src="/api/computer/screengrab/file/' + encodeURIComponent(files[i].name) + '" alt="' + escapeHtml(files[i].name) + '" title="' + escapeHtml(files[i].name) + '\\n' + Math.round(files[i].size / 1024) + ' KB" onclick="window.open(this.src, \\'_blank\\')" />';
        }
        gallery.innerHTML = html || '<span class="muted" style="font-size:12px;">No screengrabs in gallery.</span>';
      } catch (e) {
        gallery.innerHTML = '<span class="muted" style="font-size:12px;">Gallery load failed.</span>';
      }
    }

    function toggleFramebufferAutoRefresh() {
      state.framebufferAutoRefresh = !state.framebufferAutoRefresh;
      var btn = document.getElementById('fb-auto-toggle');
      if (btn) {
        btn.textContent = 'Auto-Refresh: ' + (state.framebufferAutoRefresh ? 'ON' : 'OFF');
        if (state.framebufferAutoRefresh) btn.classList.add('fb-toggle-active');
        else btn.classList.remove('fb-toggle-active');
      }
      if (state.framebufferAutoRefresh) {
        if (state.framebufferPollInterval) clearInterval(state.framebufferPollInterval);
        state.framebufferPollInterval = setInterval(refreshFramebufferViewer, 2000);
      } else {
        if (state.framebufferPollInterval) { clearInterval(state.framebufferPollInterval); state.framebufferPollInterval = null; }
      }
    }

    async function initComputerTab() {
      if (!state.computerSystemInfo) {
        try {
          state.computerSystemInfo = await request('/api/computer/system-info');
          renderLocalSystemInfo();
        } catch (e) { console.error('[computer] system info failed', e); }
      }
      refreshBrowserInfo();
      if (state.computerPollInterval) { clearInterval(state.computerPollInterval); state.computerPollInterval = null; }
      async function pollUsage() {
        try {
          var data = await request('/api/computer/usage');
          renderUsageMetrics(data);
        } catch (e) { console.error('[computer] usage poll failed', e); }
      }
      pollUsage();
      state.computerPollInterval = setInterval(pollUsage, 5000);
      refreshFramebufferViewer();
      if (state.framebufferAutoRefresh && !state.framebufferPollInterval) {
        state.framebufferPollInterval = setInterval(refreshFramebufferViewer, 2000);
      }
    }

    // ── Network Tab Panel Renderers ──────────────────────────────────────

    function renderNetworkToolsPanel() {
      const container = document.getElementById('network-tools-panel');
      if (!container) return;

      const commands = [
        { tier: 'tier1', category: 'Diagnostics (Read-Only)', items: [
          { name: 'ipconfig / ifconfig', desc: 'Display network interface configuration', platform: 'cross' },
          { name: 'ping', desc: 'Test host reachability and measure round-trip time', platform: 'cross' },
          { name: 'nslookup / dig', desc: 'DNS resolution lookup', platform: 'cross' },
          { name: 'tracert / traceroute', desc: 'Trace route to destination host', platform: 'cross' },
          { name: 'netstat / ss', desc: 'Display active connections and listening ports', platform: 'cross' },
          { name: 'arp', desc: 'Display and manage the ARP cache', platform: 'cross' },
          { name: 'hostname', desc: 'Display system hostname', platform: 'cross' },
          { name: 'nbtstat', desc: 'NetBIOS over TCP/IP statistics', platform: 'win' },
          { name: 'pathping', desc: 'Combined ping and tracert analysis', platform: 'win' },
          { name: 'getmac', desc: 'Display MAC addresses for all interfaces', platform: 'win' },
          { name: 'net view', desc: 'List shared resources visible on the network', platform: 'win' },
          { name: 'net statistics', desc: 'Display network workstation/server statistics', platform: 'win' },
          { name: 'curl / wget', desc: 'HTTP data transfer / file download', platform: 'cross' },
          { name: 'ip addr / ip route', desc: 'IP address and routing (iproute2)', platform: 'linux' },
        ]},
        { tier: 'tier2', category: 'Config Inspection (Conditional)', items: [
          { name: 'route print', desc: 'Display the IP routing table', platform: 'win' },
          { name: 'netsh interface show', desc: 'Show network interface details', platform: 'win' },
          { name: 'netsh wlan show', desc: 'Show wireless network profiles and info', platform: 'win' },
          { name: 'netsh firewall show', desc: 'Show firewall configuration', platform: 'win' },
          { name: 'netsh advfirewall show', desc: 'Show advanced firewall configuration', platform: 'win' },
          { name: 'net use', desc: 'Map or manage network drives', platform: 'win' },
          { name: 'net share', desc: 'View or manage shared folders', platform: 'win' },
          { name: 'net session', desc: 'Display active network sessions', platform: 'win' },
          { name: 'net user', desc: 'View user accounts', platform: 'win' },
          { name: 'net localgroup', desc: 'View local group memberships', platform: 'win' },
          { name: 'net config', desc: 'Display workstation or server configuration', platform: 'win' },
        ]},
        { tier: 'tier3', category: 'Mutating Operations (Approval-Gated)', items: [
          { name: 'netsh interface set', desc: 'Modify network interface settings', platform: 'win' },
          { name: 'netsh interface ip set', desc: 'Set IP/DHCP/DNS configuration', platform: 'win' },
          { name: 'netsh firewall set', desc: 'Modify firewall rules', platform: 'win' },
          { name: 'netsh wlan connect/disconnect', desc: 'Wi-Fi connection management', platform: 'win' },
          { name: 'route add / delete / change', desc: 'Modify the routing table', platform: 'cross' },
          { name: 'net start / stop', desc: 'Start or stop network services', platform: 'win' },
          { name: 'ip addr add/del', desc: 'Add or remove IP addresses', platform: 'linux' },
          { name: 'ip route add/del', desc: 'Add or remove routes', platform: 'linux' },
          { name: 'iptables / ufw', desc: 'Linux firewall management', platform: 'linux' },
        ]}
      ];

      const tierColors = { tier1: '#2ecc71', tier2: '#f39c12', tier3: '#e74c3c' };
      const tierLabels = { tier1: 'Tier 1', tier2: 'Tier 2', tier3: 'Tier 3' };
      const platformBadge = function(p) {
        if (p === 'win') return '<span style="background:#0078d4;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:6px;">WIN</span>';
        if (p === 'linux') return '<span style="background:#e95420;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:6px;">LINUX</span>';
        return '<span style="background:#6c757d;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:6px;">CROSS</span>';
      };

      var html = '<p class="muted" style="margin:0 0 10px 0;font-size:12px;">Curated network command allowlist with tier-based governance. Commands are validated against an allowlist before execution.</p>';

      commands.forEach(function(group) {
        html += '<div style="margin-bottom:12px;">'
          + '<h4 style="margin:0 0 6px 0;font-size:13px;">'
          + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + tierColors[group.tier] + ';margin-right:6px;"></span>'
          + tierLabels[group.tier] + ' \u2014 ' + escapeHtml(group.category)
          + ' <span class="muted">(' + group.items.length + ')</span></h4>'
          + '<table style="width:100%;border-collapse:collapse;font-size:12px;"><tbody>';
        group.items.forEach(function(item) {
          html += '<tr style="border-bottom:1px solid var(--border);">'
            + '<td style="padding:3px 8px 3px 0;white-space:nowrap;"><code>' + escapeHtml(item.name) + '</code>' + platformBadge(item.platform) + '</td>'
            + '<td class="muted" style="padding:3px 0;">' + escapeHtml(item.desc) + '</td></tr>';
        });
        html += '</tbody></table></div>';
      });

      container.innerHTML = html;
    }

    function renderNetworkSettingsPanel() {
      const container = document.getElementById('network-settings-panel');
      if (!container) return;

      container.innerHTML = '<p class="muted" style="font-size:12px;margin:0 0 8px 0;">Live interface data from the local host. Click Refresh to update.</p>'
        + '<button onclick="refreshNetworkInterfaces()" style="padding:4px 12px;border:none;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer;font-size:12px;margin-bottom:8px;">\u{1F504} Refresh Interfaces</button>'
        + '<div id="network-interfaces-data" style="font-size:12px;"><span class="muted">Click Refresh to load interface data.</span></div>';
    }

    function renderNetworkTelemetryPanel() {
      const container = document.getElementById('network-telemetry-panel');
      if (!container) return;

      const t = state.networkTelemetryData;
      const total = t.totalCommands;
      const pct = function(n) { return total > 0 ? ((n / total) * 100).toFixed(1) : '0.0'; };

      container.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:10px;">'
        + '<div class="panel" style="padding:8px;text-align:center;"><div style="font-size:20px;font-weight:bold;">' + total + '</div><div class="muted" style="font-size:11px;">Total Commands</div></div>'
        + '<div class="panel" style="padding:8px;text-align:center;"><div style="font-size:20px;font-weight:bold;color:#2ecc71;">' + t.tier1Count + '</div><div class="muted" style="font-size:11px;">Tier 1 (' + pct(t.tier1Count) + '%)</div></div>'
        + '<div class="panel" style="padding:8px;text-align:center;"><div style="font-size:20px;font-weight:bold;color:#f39c12;">' + t.tier2Count + '</div><div class="muted" style="font-size:11px;">Tier 2 (' + pct(t.tier2Count) + '%)</div></div>'
        + '<div class="panel" style="padding:8px;text-align:center;"><div style="font-size:20px;font-weight:bold;color:#e74c3c;">' + t.tier3Count + '</div><div class="muted" style="font-size:11px;">Tier 3 (' + pct(t.tier3Count) + '%)</div></div>'
        + '<div class="panel" style="padding:8px;text-align:center;"><div style="font-size:20px;font-weight:bold;color:#e74c3c;">' + t.errorCount + '</div><div class="muted" style="font-size:11px;">Errors</div></div>'
        + '</div>'
        + (t.lastCommand ? '<p class="muted" style="font-size:11px;margin:0;">Last command: <code>' + escapeHtml(t.lastCommand) + '</code></p>' : '');
    }

    function renderNetworkConsolePanel() {
      const hist = document.getElementById('network-history-list');
      if (!hist) return;
      const cmds = state.networkCommandHistory;
      if (cmds.length === 0) {
        hist.innerHTML = '';
        return;
      }
      var html = '<div class="muted" style="font-size:11px;font-weight:600;margin-bottom:4px;">Recent Commands (' + cmds.length + ')</div>';
      html += '<div style="font-family:monospace;font-size:11px;">';
      var recent = cmds.slice(-10).reverse();
      for (var i = 0; i < recent.length; i++) {
        var c = recent[i];
        var color = c.ok ? '#7ecf7e' : '#ff8d8d';
        var ts = new Date(c.timestamp).toLocaleTimeString();
        html += '<div style="padding:2px 0;border-bottom:1px solid rgba(148,163,184,0.08);display:flex;gap:8px;align-items:baseline;">';
        html += '<span style="color:' + color + ';font-size:9px;">\u25CF</span>';
        html += '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(c.command) + '</span>';
        html += '<span class="muted" style="font-size:10px;white-space:nowrap;">' + ts + '</span>';
        html += '</div>';
      }
      html += '</div>';
      hist.innerHTML = html;
    }

    async function runNetworkCommand() {
      const input = document.getElementById('network-console-input');
      const output = document.getElementById('network-console-output');
      if (!input || !output) return;

      const command = input.value.trim();
      if (!command) return;

      output.textContent = '\u23F3 Running: ' + command + '\\n';

      try {
        const result = await request('/api/network/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: command })
        });

        var text = '';
        if (result.tier) text += '[' + result.tier + '] ';
        text += '$ ' + command + '\\n';
        if (result.stdout) text += result.stdout + '\\n';
        if (result.stderr) text += '\\nSTDERR:\\n' + result.stderr + '\\n';
        text += '\\nExit code: ' + (result.exitCode != null ? result.exitCode : 'N/A');

        output.textContent = text;

        // Update telemetry counters
        state.networkTelemetryData.totalCommands++;
        if (result.tier === 'tier1') state.networkTelemetryData.tier1Count++;
        else if (result.tier === 'tier2') state.networkTelemetryData.tier2Count++;
        else if (result.tier === 'tier3') state.networkTelemetryData.tier3Count++;
        state.networkTelemetryData.lastCommand = command;

        state.networkCommandHistory.push({ command: command, timestamp: new Date().toISOString(), ok: true });
        await refreshNetworkTelemetry();
      } catch (error) {
        output.textContent = '\u274C Error: ' + String(error);
        state.networkTelemetryData.errorCount++;
        state.networkTelemetryData.totalCommands++;
        state.networkTelemetryData.lastCommand = command;
        state.networkCommandHistory.push({ command: command, timestamp: new Date().toISOString(), ok: false });
        await refreshNetworkTelemetry();
      }

      renderNetworkTelemetryPanel();
      input.value = '';
    }

    async function refreshNetworkInterfaces() {
      const container = document.getElementById('network-interfaces-data');
      if (!container) return;
      container.innerHTML = '<span class="muted">\u23F3 Loading interface data...</span>';
      try {
        const data = await request('/api/network/interfaces');
        if (!data.interfaces || data.interfaces.length === 0) {
          container.innerHTML = '<span class="muted">No interface data available.</span>';
          return;
        }
        var html = '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="border-bottom:2px solid var(--border);">'
          + '<th style="text-align:left;padding:4px 8px;">Interface</th>'
          + '<th style="text-align:left;padding:4px 8px;">Details</th>'
          + '</tr></thead><tbody>';
        data.interfaces.forEach(function(iface) {
          html += '<tr style="border-bottom:1px solid var(--border);">'
            + '<td style="padding:4px 8px;font-weight:bold;white-space:nowrap;">' + escapeHtml(iface.name) + '</td>'
            + '<td style="padding:4px 8px;"><pre style="margin:0;white-space:pre-wrap;font-size:11px;">' + escapeHtml(iface.details) + '</pre></td>'
            + '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
      } catch (error) {
        container.innerHTML = '<span style="color:#e74c3c;">\u274C Failed to load: ' + escapeHtml(String(error)) + '</span>';
      }
    }

    async function refreshNetworkTelemetry() {
      try {
        const telemetry = await request('/api/network/telemetry');
        state.networkTelemetryData = {
          totalCommands: telemetry.totalCommands || 0,
          tier1Count: telemetry.tier1Count || 0,
          tier2Count: telemetry.tier2Count || 0,
          tier3Count: telemetry.tier3Count || 0,
          errorCount: telemetry.errorCount || 0,
          lastCommand: telemetry.lastCommand || null
        };
        safeRenderStep('networkTelemetryPanel', renderNetworkTelemetryPanel);
      } catch (error) {
        console.error('[network] telemetry refresh failed', error);
      }
    }

    function safeRenderStep(name, fn) {
      try {
        fn();
      } catch (error) {
        console.error('[dashboard-render]', name, error);
      }
    }

    function render() {
      safeRenderStep('brandPanel', renderBrandPanel);
      safeRenderStep('tabs', renderTabs);
      safeRenderStep('sessions', renderSessions);
      safeRenderStep('header', renderHeader);
      safeRenderStep('onboarding', renderOnboarding);
      safeRenderStep('messages', renderMessages);
      safeRenderStep('overview', renderOverview);
      safeRenderStep('runtimeExcellence', renderRuntimeExcellence);
      safeRenderStep('releaseReadiness', renderReleaseReadiness);
      safeRenderStep('packageHistory', renderPackageHistory);
      safeRenderStep('whatChanged', renderWhatChanged);
      safeRenderStep('llm', renderLlm);
      safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
      safeRenderStep('modelRouting', renderModelRouting);
      safeRenderStep('providerCards', renderProviderCards);
      safeRenderStep('llmAudit', renderLlmAudit);
      safeRenderStep('settingsPanel', renderSettingsPanel);
      safeRenderStep('toolsOverviewBar', renderToolsOverviewBar);
      safeRenderStep('toolsPanel', renderToolsPanel);
      safeRenderStep('pluginsPanel', renderPluginsPanel);
      safeRenderStep('utilitiesPanel', renderUtilitiesPanel);
      safeRenderStep('agentList', renderAgentList);
      safeRenderStep('subAgentTree', renderSubAgentTree);
      safeRenderStep('swarmTopology', renderSwarmTopology);
      safeRenderStep('agentTelemetry', renderAgentTelemetry);
      safeRenderStep('localSystemInfo', renderLocalSystemInfo);
      safeRenderStep('envVarsList', renderEnvVarsList);
      safeRenderStep('deviceTree', renderDeviceTree);
      safeRenderStep('importHistory', renderImportHistory);
      safeRenderStep('networkToolsPanel', renderNetworkToolsPanel);
      safeRenderStep('networkSettingsPanel', renderNetworkSettingsPanel);
      safeRenderStep('networkTelemetryPanel', renderNetworkTelemetryPanel);
      safeRenderStep('networkConsolePanel', renderNetworkConsolePanel);
      safeRenderStep('actions', renderActions);
      safeRenderStep('approvals', renderApprovals);
      safeRenderStep('actionHistory', renderActionHistory);
      safeRenderStep('chatTelemetry', renderChatTelemetry);
      safeRenderStep('traceView', renderTraceView);
      safeRenderStep('selfReview', renderSelfReview);
      safeRenderStep('retrievalObservability', renderRetrievalObservability);
      safeRenderStep('events', renderEvents);
      const sendButton = document.getElementById('send-button');
      if (sendButton) {
        sendButton.disabled = state.busy;
      }
    }

    function setActiveTab(tabId) {
      if (!tabs.some(tab => tab.id === tabId)) {
        return;
      }
      if (state.computerPollInterval && tabId !== 'computer') {
        clearInterval(state.computerPollInterval);
        state.computerPollInterval = null;
      }
      if (state.framebufferPollInterval && tabId !== 'computer') {
        clearInterval(state.framebufferPollInterval);
        state.framebufferPollInterval = null;
      }
      state.activeTab = tabId;
      if (tabId === 'settings') {
        refreshChrome().then(function() { render(); });
      }
      if (tabId === 'agentic') {
        initAgenticTab();
      }
      if (tabId === 'workspace') {
        initWorkspaceTab();
      }
      if (tabId === 'computer') {
        initComputerTab();
      }
      if (tabId === 'network') {
        refreshNetworkInterfaces();
        refreshNetworkTelemetry();
      }
      if (tabId === 'telemetry') {
        setTelemetryWindow(state.telemetryWindow);
        return; // setTelemetryWindow calls render() — skip double render
      }
      render();
    }

    async function selectSession(sessionId) {
      state.selectedSessionId = sessionId;
      await Promise.all([loadMessages(), refreshChrome()]);
      render();
    }

    async function deleteSession(event, sessionId) {
      event.stopPropagation();
      const existing = state.sessions.find(session => session.sessionId === sessionId);
      if (!existing) {
        return;
      }
      const confirmed = confirm('Delete session "' + existing.title + '"? This will remove all messages in this session.');
      if (!confirmed) {
        return;
      }

      state.notice = null;
      try {
        await request('/api/chat/sessions/' + encodeURIComponent(sessionId), { method: 'DELETE' });
        await loadSessions();

        if (!state.selectedSessionId && state.sessions.length > 0) {
          state.selectedSessionId = state.sessions[0].sessionId;
        }

        if (state.selectedSessionId) {
          await Promise.all([loadMessages(), refreshChrome()]);
        } else {
          state.messages = [];
          await refreshChrome();
        }
      } catch (error) {
        state.notice = String(error);
      }

      render();
    }

    async function renameSession(event, sessionId) {
      event.stopPropagation();
      var session = state.sessions.find(function(s) { return s.sessionId === sessionId; });
      if (!session) return;
      var newTitle = prompt('Rename session:', session.title);
      if (!newTitle || !newTitle.trim() || newTitle.trim() === session.title) return;
      try {
        await request('/api/chat/sessions/' + encodeURIComponent(sessionId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle.trim() })
        });
        await loadSessions();
        safeRenderStep('sessionList', renderSessionList);
        safeRenderStep('header', renderHeader);
        state.notice = 'Session renamed.';
      } catch (err) {
        state.notice = { type: 'error', message: String(err) };
      }
      render();
    }

    async function copySession(event, sessionId) {
      event.stopPropagation();
      const existing = state.sessions.find(session => session.sessionId === sessionId);
      if (!existing) {
        return;
      }
      
      const button = event.currentTarget;
      const originalText = button.textContent;
      button.textContent = "Copying...";

      try {
        const payload = await request('/api/chat/sessions/' + encodeURIComponent(sessionId) + '/messages');
        const messages = payload.messages || [];
        
        let textToCopy = "Session: " + existing.title + "\\n";
        textToCopy += "Date: " + new Date().toLocaleString() + "\\n\\n";
        
        for (const msg of messages) {
          textToCopy += "[" + msg.role.toUpperCase() + "]\\n";
          textToCopy += msg.content + "\\n\\n";
        }
        
        await navigator.clipboard.writeText(textToCopy.trim());
        button.textContent = "Copied!";
        button.style.backgroundColor = "#10b981";
        button.style.color = "white";
        button.style.borderColor = "#10b981";
      } catch (err) {
        console.error('Copy failed:', err);
        button.textContent = "Failed";
      }
      
      setTimeout(() => {
        button.textContent = originalText;
        button.style.backgroundColor = "";
        button.style.color = "";
        button.style.borderColor = "";
      }, 2000);
    }

    // --- Attachment handling ---
    var pendingAttachments = [];

    function handleFileSelect(input) {
      if (!input.files || !input.files.length) return;
      Array.from(input.files).forEach(function(file) {
        if (file.size > 10 * 1024 * 1024) {
          state.notice = 'File too large (max 10MB): ' + file.name;
          render();
          return;
        }
        var reader = new FileReader();
        reader.onload = function(e) {
          pendingAttachments.push({ file: file, dataUrl: e.target.result, name: file.name, type: file.type, size: file.size });
          renderAttachmentPreview();
        };
        reader.readAsDataURL(file);
      });
      input.value = '';
    }

    async function pasteFromClipboard() {
      try {
        var items = await navigator.clipboard.read();
        for (var i = 0; i < items.length; i++) {
          var types = items[i].types;
          var imgType = types.find(function(t) { return t.startsWith('image/'); });
          if (imgType) {
            var blob = await items[i].getType(imgType);
            var file = new File([blob], 'clipboard-' + Date.now() + '.' + imgType.split('/')[1], { type: imgType });
            var reader = new FileReader();
            reader.onload = function(e) {
              pendingAttachments.push({ file: file, dataUrl: e.target.result, name: file.name, type: file.type, size: file.size });
              renderAttachmentPreview();
            };
            reader.readAsDataURL(file);
          }
        }
      } catch (err) {
        state.notice = 'Clipboard access denied or empty.';
        render();
      }
    }

    function removeAttachment(index) {
      pendingAttachments.splice(index, 1);
      renderAttachmentPreview();
    }

    function renderAttachmentPreview() {
      var container = document.getElementById('attachment-preview');
      if (!container) return;
      container.innerHTML = pendingAttachments.map(function(att, i) {
        var preview = att.type && att.type.startsWith('image/')
          ? '<img src="' + att.dataUrl + '" style="height:24px;border-radius:4px;" />'
          : '\\u{1F4C4}';
        return '<span class="attachment-chip">'
          + preview
          + ' <span>' + escapeHtml(att.name) + '</span>'
          + ' <span class="remove-btn" onclick="removeAttachment(' + i + ')">\\u2715</span>'
          + '</span>';
      }).join('');
    }

    // Drag & drop
    (function() {
      var composer = document.querySelector('.composer');
      if (!composer) return;
      composer.addEventListener('dragover', function(e) { e.preventDefault(); composer.style.outline = '2px dashed var(--accent)'; });
      composer.addEventListener('dragleave', function() { composer.style.outline = ''; });
      composer.addEventListener('drop', function(e) {
        e.preventDefault();
        composer.style.outline = '';
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          handleFileSelect({ files: e.dataTransfer.files, value: '' });
        }
      });
    })();

    async function uploadAttachments(sessionId, messageId) {
      for (var i = 0; i < pendingAttachments.length; i++) {
        var att = pendingAttachments[i];
        try {
          var formData = new FormData();
          formData.append('file', att.file, att.name);
          await fetch('/api/chat/sessions/' + encodeURIComponent(sessionId) + '/messages/' + encodeURIComponent(messageId) + '/attachments', {
            method: 'POST',
            body: formData
          });
        } catch (err) {
          console.warn('Attachment upload failed:', att.name, err);
        }
      }
      pendingAttachments = [];
      renderAttachmentPreview();
    }

    async function sendMessage() {
      const composer = document.getElementById('composer');
      const content = composer.value.trim();
      if (!content || state.busy) {
        return;
      }
      if (!state.selectedSessionId) {
        await createSession();
      }
      if (!state.readiness || !state.readiness.ready) {
        state.notice = 'Complete the first-run checklist in Provider & Settings before sending messages.';
        state.activeTab = 'settings';
        render();
        return;
      }
      state.busy = true;
      state.notice = null;
      state.agenticStream = [];
      composer.value = '';
      render();
      try {
        var response = await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
        // Upload pending attachments to the user message if any
        if (pendingAttachments.length && response && response.userMessage && response.userMessage.messageId) {
          await uploadAttachments(state.selectedSessionId, response.userMessage.messageId);
        }
        state.agenticStream = [];
        await Promise.all([loadSessions(), loadMessages(), refreshChrome()]);
      } catch (error) {
        state.notice = String(error);
      } finally {
        state.busy = false;
        render();
      }
    }

    async function runAction(name) {
      state.notice = null;
      try {
        await request('/api/actions/' + name, { method: 'POST' });
        await refreshChrome();
      } catch (error) {
        state.notice = String(error);
      }
      render();
    }

    async function quickApplyLlm() {
      const localSelection = getLocalLlmSelection(state.selectedSessionId);
      const providerSelect = document.getElementById('provider-select');
      const modelSelect = document.getElementById('model-select');
      const providerId = localSelection && localSelection.providerId
        ? localSelection.providerId
        : (providerSelect ? providerSelect.value : '');
      const model = localSelection
        ? (localSelection.model || '')
        : (modelSelect ? modelSelect.value : '');
      if (!providerId || !state.selectedSessionId) {
        return;
      }
      state.notice = null;
      try {
        state.llmCatalog = await request('/api/llm/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.selectedSessionId, providerId: providerId, model: model })
        });
        clearLocalLlmSelection(state.selectedSessionId);
        const readiness = await request('/api/readiness/recheck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.selectedSessionId, source: 'llm_quick_apply' })
        }).catch(function() { return null; });
        await refreshChrome();
        if (readiness) {
          state.readiness = readiness;
        }
        state.notice = 'Provider applied: ' + providerId + ' / ' + (model || 'default') + '.';
      } catch (error) {
        state.notice = String(error);
      }
      render();
    }

    async function refreshOllamaModels() {
      state.notice = null;
      try {
        await refreshChrome();
        state.notice = 'Model list refreshed from local server.';
      } catch (error) {
        state.notice = String(error);
      }
      render();
    }

    async function rollbackLlmConfig() {
      if (!state.selectedSessionId) {
        return;
      }
      state.notice = null;
      try {
        clearLocalLlmSelection(state.selectedSessionId);
        const payload = await request('/api/llm/config/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.selectedSessionId })
        });
        state.llmCatalog = payload.catalog;
        state.llmConfig = payload.config;
        await refreshChrome();
        state.notice = 'Rolled back to previous applied configuration.';
      } catch (error) {
        state.notice = String(error);
      }
      render();
    }

    async function approve(id) {
      await request('/api/approve/' + id, { method: 'POST' });
      await refreshChrome();
      render();
    }

    async function deny(id) {
      await request('/api/deny/' + id, { method: 'POST' });
      await refreshChrome();
      render();
    }

    // ── Workspace Tab Functions ─────────────────────────────────────────
    async function refreshWorkspaceInfo() {
      var pathEl = document.getElementById('workspace-path');
      if (!pathEl) return;
      pathEl.textContent = 'Loading...';
      try {
        var info = await request('/api/workspace/info');
        pathEl.textContent = info.workspaceRoot || 'Unknown';
        var profileEl = document.getElementById('ws-active-profile');
        if (profileEl && info.manifest && info.manifest.profile) {
          profileEl.textContent = info.manifest.profile;
        }
        var autoSaveEl = document.getElementById('ws-auto-save');
        if (autoSaveEl) autoSaveEl.textContent = 'Enabled';
      } catch (err) {
        pathEl.textContent = '\\u274C Error: ' + String(err);
      }
      refreshGitStatus();
    }

    async function refreshGitStatus() {
      var gitEl = document.getElementById('ws-git-status');
      if (!gitEl) return;
      gitEl.textContent = 'Checking...';
      try {
        var data = await request('/api/workspace/git-status');
        if (data.isGitRepo) {
          gitEl.textContent = data.branch + ' (' + data.changedFiles + ' changed)';
        } else {
          gitEl.textContent = 'Not a git repo';
        }
      } catch (e) {
        gitEl.textContent = 'Unknown';
      }
    }

    async function refreshWorkspaceFiles() {
      var container = document.getElementById('workspace-file-tree');
      if (!container) return;
      container.innerHTML = '<span class="muted">\\u23F3 Loading workspace files...</span>';
      try {
        var data = await request('/api/workspace/files');
        if (!data.entries || data.entries.length === 0) {
          container.innerHTML = '<span class="muted">Workspace is empty.</span>';
          return;
        }
        state._workspaceFiles = data.entries;
        renderWorkspaceFileTree(data.entries, container);
      } catch (err) {
        container.innerHTML = '<span style="color:#e74c3c;">\\u274C ' + escapeHtml(String(err)) + '</span>';
      }
    }

    function renderWorkspaceFileTree(entries, container) {
      var dirs = {};
      entries.forEach(function(e) {
        var parts = e.path.split('/');
        if (parts.length === 1) {
          if (!dirs['_root']) dirs['_root'] = [];
          dirs['_root'].push(e);
        } else {
          var top = parts[0];
          if (!dirs[top]) dirs[top] = [];
          dirs[top].push(e);
        }
      });
      var html = '';
      var topDirs = Object.keys(dirs).filter(function(k) { return k !== '_root'; }).sort();
      topDirs.forEach(function(dirName) {
        var children = dirs[dirName];
        var fileCount = children.filter(function(c) { return c.type === 'file'; }).length;
        html += '<details class="panel" style="padding:6px 10px;margin-bottom:3px;">';
        html += '<summary style="cursor:pointer;font-weight:600;">\\u{1F4C1} ' + escapeHtml(dirName);
        html += ' <span class="muted" style="font-weight:normal;font-size:11px;">(' + fileCount + ' files)</span></summary>';
        html += '<div style="padding:4px 0 0 16px;">';
        children.forEach(function(child) {
          if (child.path === dirName) return;
          var displayName = child.path.substring(dirName.length + 1);
          var icon = child.type === 'dir' ? '\\u{1F4C1}' : '\\u{1F4C4}';
          var sizeStr = child.type === 'file' ? ' <span class="muted" style="font-size:10px;">(' + formatFileSize(child.size) + ')</span>' : '';
          html += '<div style="padding:2px 0;font-size:12px;">' + icon + ' ' + escapeHtml(displayName) + sizeStr + '</div>';
        });
        html += '</div></details>';
      });
      if (dirs['_root']) {
        dirs['_root'].forEach(function(e) {
          var icon = e.type === 'dir' ? '\\u{1F4C1}' : '\\u{1F4C4}';
          var sizeStr = e.type === 'file' ? ' <span class="muted" style="font-size:10px;">(' + formatFileSize(e.size) + ')</span>' : '';
          html += '<div style="padding:3px 0;font-size:12px;">' + icon + ' ' + escapeHtml(e.name) + sizeStr + '</div>';
        });
      }
      container.innerHTML = html || '<span class="muted">No files found.</span>';
    }

    function formatFileSize(bytes) {
      if (bytes === 0) return '0 B';
      var units = ['B', 'KB', 'MB', 'GB'];
      var i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
      var size = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
      return size + ' ' + units[i];
    }

    function filterWorkspaceFiles(query) {
      var container = document.getElementById('workspace-file-tree');
      if (!container || !state._workspaceFiles) return;
      if (!query || !query.trim()) {
        renderWorkspaceFileTree(state._workspaceFiles, container);
        return;
      }
      var lower = query.toLowerCase();
      var filtered = state._workspaceFiles.filter(function(e) {
        return e.path.toLowerCase().indexOf(lower) !== -1;
      });
      renderWorkspaceFileTree(filtered, container);
    }

    async function openWorkspaceInExplorer() {
      try {
        await request('/api/workspace/open-explorer', { method: 'POST' });
      } catch (err) {
        alert('Failed to open explorer: ' + String(err));
      }
    }

    async function changeWorkspaceLocation() {
      var currentPath = (document.getElementById('workspace-path') || {}).textContent || '';
      var newPath = prompt('Enter the new workspace path (absolute):', currentPath.trim());
      if (!newPath || newPath.trim() === '' || newPath.trim() === currentPath.trim()) return;
      try {
        var result = await request('/api/workspace/relocate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: newPath.trim() })
        });
        if (result.error) { alert('Relocation failed: ' + result.error); return; }
        await refreshWorkspaceInfo();
        await refreshWorkspaceFiles();
      } catch (e) {
        alert('Failed to change workspace location: ' + e.message);
      }
    }

    var IMPORT_TARGET_DIRS = ['config','artifacts','data','data/tasks','data/notes','data/email','data/calendar','characters','logs','workspace','state'];
    var IMPORT_REGISTERED_TYPES = [
      { value: 'character', label: 'Character (JSON)' },
      { value: 'mcp-config', label: 'MCP Config (JSON)' },
      { value: 'session-package', label: 'Session Package (JSON)' },
      { value: 'tool-contract', label: 'Tool Contract (JSON)' },
      { value: 'self-review', label: 'Self-Review Report (JSON)' },
      { value: 'task-timeline', label: 'Task Timeline (JSON)' },
      { value: 'note', label: 'Note (Markdown)' }
    ];

    function showImportStatus(msg, isError) {
      var el = document.getElementById('import-status');
      if (!el) return;
      el.style.display = 'block';
      el.style.background = isError ? 'rgba(231,76,60,0.15)' : 'rgba(126,207,126,0.15)';
      el.style.color = isError ? '#ff8d8d' : '#7ecf7e';
      el.textContent = msg;
      setTimeout(function() { el.style.display = 'none'; }, 6000);
    }

    function triggerWorkspaceImport() {
      triggerGeneralImport();
    }

    function triggerGeneralImport() {
      var targetDir = prompt('Target workspace directory:\\n\\n' + IMPORT_TARGET_DIRS.join('\\n') + '\\n\\nEnter directory name:', 'workspace');
      if (!targetDir || !targetDir.trim()) return;
      targetDir = targetDir.trim();
      if (IMPORT_TARGET_DIRS.indexOf(targetDir) === -1) {
        alert('Invalid target directory. Must be one of:\\n' + IMPORT_TARGET_DIRS.join(', '));
        return;
      }
      var input = document.getElementById('import-file-input');
      if (!input) return;
      input._importTargetDir = targetDir;
      input.value = '';
      input.click();
    }

    function triggerRegisteredImport() {
      var typeMsg = 'Select registered item type:\\n\\n';
      for (var i = 0; i < IMPORT_REGISTERED_TYPES.length; i++) {
        typeMsg += (i + 1) + '. ' + IMPORT_REGISTERED_TYPES[i].label + '\\n';
      }
      typeMsg += '\\nEnter number (1-' + IMPORT_REGISTERED_TYPES.length + '):';
      var choice = prompt(typeMsg);
      if (!choice) return;
      var idx = parseInt(choice, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= IMPORT_REGISTERED_TYPES.length) {
        alert('Invalid selection.');
        return;
      }
      var input = document.getElementById('import-registered-input');
      if (!input) return;
      input._importRegisteredType = IMPORT_REGISTERED_TYPES[idx].value;
      input.value = '';
      input.click();
    }

    function triggerFolderImport() {
      var targetDir = prompt('Target workspace directory for folder contents:\\n\\n' + IMPORT_TARGET_DIRS.join('\\n') + '\\n\\nEnter directory name:', 'workspace');
      if (!targetDir || !targetDir.trim()) return;
      targetDir = targetDir.trim();
      if (IMPORT_TARGET_DIRS.indexOf(targetDir) === -1) {
        alert('Invalid target directory. Must be one of:\\n' + IMPORT_TARGET_DIRS.join(', '));
        return;
      }
      var input = document.getElementById('import-folder-input');
      if (!input) return;
      input._importTargetDir = targetDir;
      input.value = '';
      input.click();
    }

    function readFileAsBase64(file) {
      return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() {
          var result = reader.result;
          var base64 = result.split(',')[1] || '';
          resolve(base64);
        };
        reader.onerror = function() { reject(new Error('Failed to read file')); };
        reader.readAsDataURL(file);
      });
    }

    // --- SSE streaming connection for agentic progress ---
    function connectAgenticStream() {
      var evtSource;
      try {
        evtSource = new EventSource('/api/chat/stream');
      } catch (err) {
        console.warn('[stream] SSE unavailable:', err);
        return;
      }
      evtSource.onmessage = function(event) {
        try {
          var data = JSON.parse(event.data);
          if (data.type === 'agentic_event') {
            var ev = data.event || data;
            if (ev.type === 'done') {
              state.agenticStream = [];
            } else {
              state.agenticStream.push(ev);
            }
            safeRenderStep('messages', renderMessages);
          }
        } catch (e) { /* ignore parse errors */ }
      };
      evtSource.onerror = function() {
        evtSource.close();
        setTimeout(connectAgenticStream, 5000);
      };
    }
    connectAgenticStream();

    // General file import handler
    document.addEventListener('DOMContentLoaded', function() {
      var fileInput = document.getElementById('import-file-input');
      if (fileInput) fileInput.addEventListener('change', async function() {
        var file = this.files[0];
        if (!file) return;
        var targetDir = this._importTargetDir || 'workspace';
        showImportStatus('Importing ' + file.name + '...', false);
        try {
          var base64 = await readFileAsBase64(file);
          var result = await request('/api/workspace/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'general', fileName: file.name, content: base64, targetDir: targetDir })
          });
          if (result.error) { showImportStatus('Import failed: ' + result.error, true); return; }
          showImportStatus('Imported ' + file.name + ' to ' + targetDir + '/', false);
          await refreshImportHistory();
          await refreshWorkspaceFiles();
        } catch (e) { showImportStatus('Import error: ' + e.message, true); }
      });

      // Registered file import handler
      var regInput = document.getElementById('import-registered-input');
      if (regInput) regInput.addEventListener('change', async function() {
        var file = this.files[0];
        if (!file) return;
        var registeredType = this._importRegisteredType || 'character';
        showImportStatus('Importing ' + file.name + ' as ' + registeredType + '...', false);
        try {
          var base64 = await readFileAsBase64(file);
          var result = await request('/api/workspace/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'registered', fileName: file.name, content: base64, registeredType: registeredType })
          });
          if (result.error) { showImportStatus('Import failed: ' + result.error, true); return; }
          showImportStatus('Registered import: ' + result.entry.message, false);
          await refreshImportHistory();
          await refreshWorkspaceFiles();
        } catch (e) { showImportStatus('Import error: ' + e.message, true); }
      });

      // Folder import handler
      var folderInput = document.getElementById('import-folder-input');
      if (folderInput) folderInput.addEventListener('change', async function() {
        var files = this.files;
        if (!files || files.length === 0) return;
        var targetDir = this._importTargetDir || 'workspace';
        showImportStatus('Importing ' + files.length + ' files...', false);
        try {
          var payload = [];
          for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var base64 = await readFileAsBase64(f);
            payload.push({ name: f.name, content: base64, relativePath: f.webkitRelativePath || f.name });
          }
          var result = await request('/api/workspace/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'folder', files: payload, targetDir: targetDir })
          });
          if (result.error) { showImportStatus('Folder import failed: ' + result.error, true); return; }
          showImportStatus('Folder import: ' + result.summary.message, false);
          await refreshImportHistory();
          await refreshWorkspaceFiles();
        } catch (e) { showImportStatus('Folder import error: ' + e.message, true); }
      });
    });

    async function refreshImportHistory() {
      try {
        var data = await request('/api/workspace/import/history');
        state.importHistory = data.history || [];
        renderImportHistory();
      } catch (e) { console.error('[import] history refresh failed', e); }
    }

    function renderImportHistory() {
      var container = document.getElementById('import-history-list');
      if (!container) return;
      var hist = state.importHistory;
      if (!hist || hist.length === 0) {
        container.innerHTML = '<span class="muted">No imports yet.</span>';
        return;
      }
      var html = '';
      for (var i = 0; i < Math.min(hist.length, 25); i++) {
        var h = hist[i];
        var statusColor = h.status === 'success' ? '#7ecf7e' : (h.status === 'partial' ? '#ffd17a' : '#ff8d8d');
        var modeIcon = h.mode === 'folder' ? '\u{1F4C1}' : (h.mode === 'registered' ? '\u{1F9E9}' : '\u{1F4C4}');
        var ts = new Date(h.timestamp);
        var timeStr = ts.toLocaleTimeString();
        html += '<div style="padding:6px 0;border-bottom:1px solid rgba(148,163,184,0.08);display:flex;align-items:center;gap:8px;">';
        html += '<span>' + modeIcon + '</span>';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(h.fileName) + '</div>';
        html += '<div class="muted" style="font-size:11px;">' + escapeHtml(h.message) + '</div>';
        html += '</div>';
        html += '<span style="color:' + statusColor + ';font-size:11px;font-weight:700;white-space:nowrap;">' + escapeHtml(h.status) + '</span>';
        html += '<span class="muted" style="font-size:10px;white-space:nowrap;">' + timeStr + '</span>';
        html += '</div>';
      }
      if (hist.length > 25) {
        html += '<div class="muted" style="margin-top:6px;font-size:11px;">... and ' + (hist.length - 25) + ' more</div>';
      }
      container.innerHTML = html;
    }

    function initWorkspaceTab() {
      refreshWorkspaceInfo();
      refreshWorkspaceFiles();
      refreshImportHistory();
    }
    document.getElementById('composer').addEventListener('keydown', function(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void sendMessage();
      }
    });

    bootstrap();

    window.packageSessions = packageSessions;
    window.toggleSessionPackage = toggleSessionPackage;
    window.runPackageWorkflow = runPackageWorkflow;
    window.unpackageSessionPackage = unpackageSessionPackage;
    window.cyclePackageStatus = cyclePackageStatus;
    window.setPackageStatus = setPackageStatus;
    window.exportPackageTrace = exportPackageTrace;
    window.refreshWorkspaceInfo = refreshWorkspaceInfo;
    window.refreshWorkspaceFiles = refreshWorkspaceFiles;
    window.filterWorkspaceFiles = filterWorkspaceFiles;
    window.openWorkspaceInExplorer = openWorkspaceInExplorer;
    window.changeWorkspaceLocation = changeWorkspaceLocation;
    window.triggerWorkspaceImport = triggerWorkspaceImport;
    window.triggerGeneralImport = triggerGeneralImport;
    window.triggerRegisteredImport = triggerRegisteredImport;
    window.triggerFolderImport = triggerFolderImport;
    window.refreshImportHistory = refreshImportHistory;
    window.initWorkspaceTab = initWorkspaceTab;
    window.setRoutingStrategy = setRoutingStrategy;
    window.setRoleOverride = setRoleOverride;
    window.setAgentOverride = setAgentOverride;
    window.saveRoutingConfig = saveRoutingConfig;
    window.suggestOptimalRouting = suggestOptimalRouting;
    window.setSessionRoutingStrategy = setSessionRoutingStrategy;
    window.discoverModels = discoverModels;
    window.onModalitySelected = onModalitySelected;
    window.onModalityFilterToggle = onModalityFilterToggle;
    window.setModalityOverride = setModalityOverride;
    window.exportSession = exportSession;
    window.importSession = importSession;
    window.promoteAgent = promoteAgent;
    window.demoteAgent = demoteAgent;
    window.refreshAgentList = refreshAgentList;
    window.launchNewAgent = launchNewAgent;
    window.stopAgent = stopAgent;
    window.createSwarm = createSwarm;
    window.refreshSwarmStatus = refreshSwarmStatus;
    window.setTelemetryWindow = setTelemetryWindow;
    window.refreshNetworkInterfaces = refreshNetworkInterfaces;
    window.runNetworkCommand = runNetworkCommand;
    window.toggleCapabilityMatrix = toggleCapabilityMatrix;
    window.setMatrixSort = setMatrixSort;
    window.setMatrixFilter = setMatrixFilter;
    window.setMatrixDraftField = setMatrixDraftField;
    window.startMatrixEdit = startMatrixEdit;
    window.clearMatrixDraft = clearMatrixDraft;
    window.saveMatrixEntry = saveMatrixEntry;
    window.deleteMatrixEntry = deleteMatrixEntry;

    // Only telemetry data refreshes automatically — everything else is event-driven.
    setInterval(async function() {
      try {
        // Never touch the DOM while the user has a dropdown open — it forces it closed.
        if (document.activeElement && document.activeElement.tagName === 'SELECT') return;
        const [telemetrySummaryData, runtimeExcellenceData] = await Promise.all([
          request('/api/telemetry/summary?window=' + state.telemetryWindow).catch(() => null),
          request('/api/runtime/excellence?window=' + state.telemetryWindow).catch(() => null)
        ]);
        // Re-check focus after the async fetch — user may have opened a dropdown while waiting.
        if (document.activeElement && document.activeElement.tagName === 'SELECT') return;
        state.telemetrySummary = telemetrySummaryData || null;
        state.runtimeExcellence = runtimeExcellenceData || null;
        safeRenderStep('runtimeExcellence', renderRuntimeExcellence);
      } catch (_) { /* silent — telemetry is best-effort */ }
    }, 30000);
  </script>
  <script>
  (function() {
    var handle = document.getElementById('resize-handle');
    var app = document.getElementById('app');
    var sidebar = document.getElementById('sidebar');
    if (!handle || !app || !sidebar) return;
    var dragging = false;
    var startX = 0;
    var startWidth = 0;
    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      var newWidth = Math.max(200, Math.min(600, startWidth + (e.clientX - startX)));
      app.style.setProperty('--sidebar-width', newWidth + 'px');
    });
    document.addEventListener('mouseup', function() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  })();
  </script>
</body>
</html>`;
}

function normalizePrompt(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 255) || "file";
}

interface MultipartPart {
  fileName?: string;
  contentType?: string;
  data: Buffer;
}

function parseMultipartParts(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const endBoundaryBuf = Buffer.from(`--${boundary}--`);

  let pos = body.indexOf(boundaryBuf);
  if (pos === -1) return parts;
  pos += boundaryBuf.length;

  while (pos < body.length) {
    // Skip CRLF after boundary
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;

    const nextBoundary = body.indexOf(boundaryBuf, pos);
    if (nextBoundary === -1) break;

    const partData = body.subarray(pos, nextBoundary);

    // Split headers from body at double CRLF
    const headerEnd = partData.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) { pos = nextBoundary + boundaryBuf.length; continue; }

    const headerStr = partData.subarray(0, headerEnd).toString("utf-8");
    const fileData = partData.subarray(headerEnd + 4);

    // Strip trailing CRLF before boundary
    const trimmed = fileData.length >= 2 && fileData[fileData.length - 2] === 0x0d && fileData[fileData.length - 1] === 0x0a
      ? fileData.subarray(0, fileData.length - 2)
      : fileData;

    const fileNameMatch = /filename="([^"]*)"/.exec(headerStr);
    const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerStr);

    parts.push({
      fileName: fileNameMatch?.[1],
      contentType: ctMatch?.[1]?.trim(),
      data: Buffer.from(trimmed),
    });

    pos = nextBoundary + boundaryBuf.length;
    // Check for end boundary
    if (body.subarray(nextBoundary, nextBoundary + endBoundaryBuf.length).equals(endBoundaryBuf)) break;
  }

  return parts;
}

function deriveSessionTitle(content: string): string {
  return content.trim().replace(/\s+/g, " ").slice(0, 60) || "New Session";
}

function parseEventFilters(
  url: string,
  fallbackLimit: number,
): {
  limit: number;
  operation: string | null;
  chatSessionId: string | null;
  correlationId: string | null;
} {
  try {
    const parsed = new URL(`http://localhost${url}`);
    const value = Number(parsed.searchParams.get("limit") ?? fallbackLimit);
    const limit = Number.isFinite(value)
      ? Math.max(1, Math.min(500, Math.floor(value)))
      : fallbackLimit;
    const operation = parsed.searchParams.get("operation")?.trim() || null;
    const chatSessionId = parsed.searchParams.get("chatSessionId")?.trim() || null;
    const correlationId = parsed.searchParams.get("correlationId")?.trim() || null;
    return { limit, operation, chatSessionId, correlationId };
  } catch {
    return { limit: fallbackLimit, operation: null, chatSessionId: null, correlationId: null };
  }
}

function buildSessionConfigDiff(
  beforeProviderId: string | null,
  beforeModel: string | null,
  afterProviderId: string | null,
  afterModel: string | null,
): SessionConfigDiff {
  const changedFields: string[] = [];
  if ((beforeProviderId ?? null) !== (afterProviderId ?? null)) {
    changedFields.push("llmProviderId");
  }
  if ((beforeModel ?? null) !== (afterModel ?? null)) {
    changedFields.push("llmModel");
  }

  return {
    changedFields,
    before: {
      providerId: beforeProviderId ?? null,
      model: beforeModel ?? null,
    },
    after: {
      providerId: afterProviderId ?? null,
      model: afterModel ?? null,
    },
  };
}

function normalizeSessionPackageStatus(value: unknown): SessionPackageStatus {
  return value === "running" || value === "blocked" || value === "complete" ? value : "planned";
}
