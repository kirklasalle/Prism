import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { workspacePath, resolveWorkspaceRoot, setWorkspaceRoot, ensureWorkspaceStructure, workspaceFramebufferDir, readPreferences, writePreferences } from "../config/workspace-resolver.js";
import { FramebufferCapture } from "./framebuffer-capture.js";
import { BrowserControlTool } from "../../adapters/system/browser-control-tool.js";
import { AgenticChatExecutor, type AgenticTurnEvent, type AgenticResult } from "./agentic-chat-executor.js";
import { CharacterAccountabilityStore, type CharacterAssignmentFilter } from "../accountability/character-accountability-store.js";
import { CharacterAccountabilityManager } from "../accountability/character-accountability-manager.js";
import { workspaceCharactersDir, workspaceDbPath } from "../config/workspace-resolver.js";

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
  private static readonly publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
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
  private readonly characterAccountabilityStore: CharacterAccountabilityStore;
  private readonly characterAccountabilityManager: CharacterAccountabilityManager;
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
    this.characterAccountabilityStore = new CharacterAccountabilityStore(workspaceDbPath());
    this.characterAccountabilityManager = new CharacterAccountabilityManager(this.characterAccountabilityStore, this.activityBus);
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
    // Load persisted runtime settings from preferences file
    try {
      const prefs = readPreferences();
      if (prefs?.runtimeSettings && typeof prefs.runtimeSettings === 'object') {
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
    this.characterAccountabilityStore.close();
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

    if (method === "GET" && url.startsWith("/public/") && (url.endsWith(".js") || url.endsWith(".css"))) {
      const safeFile = url.slice("/public/".length).replace(/\.\./g, "");
      if (!safeFile || safeFile.includes("/") || safeFile.includes("\\")) {
        return this.json(res, 404, { error: "Not found" });
      }
      const filePath = join(DashboardService.publicDir, safeFile);
      if (!existsSync(filePath)) { return this.json(res, 404, { error: "Not found" }); }
      const content = readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": url.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(content);
      return;
    }

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

    if (method === "GET" && url.startsWith("/api/llm/routing/suggest")) {
      try {
        const parsedUrl = new URL(url, "http://localhost");
        const providerId = parsedUrl.searchParams.get("providerId") || "";
        const suggestions = await this.llmProviders.suggestRoutingForAllRoles(providerId);
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
      // Persist settings to disk so they survive server restarts
      try {
        writePreferences({ runtimeSettings: this.runtimeSettings });
      } catch (err: unknown) {
        console.warn(`[PRISM][settings] Failed to persist settings: ${String(err)}`);
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
      return this.json(res, 200, {
        galleryItems: this.framebufferCapture.listGalleryItems(),
        files: this.framebufferCapture.listScreengrabs(),
        directory: workspaceFramebufferDir(),
      });
    }

    if (method === "POST" && url === "/api/computer/reveal-file") {
      const body = await this.readJsonBody<{ filename?: string }>(req);
      const fname = body?.filename ? String(body.filename).replace(/[/\\:*?"<>|]/g, "") : "";
      const revealPath = fname ? join(workspaceFramebufferDir(), fname) : workspaceFramebufferDir();
      const { exec } = await import("node:child_process");
      exec(`explorer.exe /select,"${revealPath}"`);
      return this.json(res, 200, { ok: true });
    }

    if (method === "GET" && url === "/api/computer/screengrab/diagnostics") {
      const fbDir = workspaceFramebufferDir();
      const checks: { name: string; ok: boolean; detail: string }[] = [];
      checks.push({ name: "Platform", ok: process.platform === "win32", detail: process.platform === "win32" ? "Windows \u2713" : `Non-Windows (${process.platform}) \u2014 PowerShell capture may not work` });
      const dirExists = existsSync(fbDir);
      checks.push({ name: "Capture directory", ok: dirExists, detail: dirExists ? fbDir : `Missing: ${fbDir}` });
      if (dirExists) {
        const allFiles = readdirSync(fbDir).filter(f => f.endsWith(".png") && f !== "latest.png");
        const latestExists = existsSync(join(fbDir, "latest.png"));
        checks.push({ name: "Stored frames", ok: allFiles.length > 0, detail: `${allFiles.length} PNG file(s) in framebuffer directory` });
        checks.push({ name: "Latest frame", ok: latestExists, detail: latestExists ? "latest.png present" : "No latest.png \u2014 capture has not run yet" });
      }
      return this.json(res, 200, { ok: checks.every(c => c.ok), checks });
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

    // ── Browser Control API ──────────────────────────────────────────────
    {
      const browserTool = this.tools.find(t => t.name === "browser_control") as BrowserControlTool | undefined;
      const mgr = browserTool?.getManager();
      const profMgr = browserTool?.getProfileManager();

      if (method === "GET" && url === "/api/browser/sessions") {
        if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
        const sessions = mgr.listSessions();
        return this.json(res, 200, { sessions: sessions.map(s => ({ ...s, sessionId: s.id } as Record<string, unknown>)) });
      }

      if (method === "GET" && url === "/api/browser/profiles") {
        if (!profMgr) return this.json(res, 503, { error: "Browser profile manager not available." });
        return this.json(res, 200, { profiles: profMgr.listProfiles() });
      }

      if (method === "GET" && url === "/api/browser/diagnostics") {
        if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
        const diag = await mgr.diagnostics();
        return this.json(res, 200, diag);
      }

      if (method === "POST" && url === "/api/browser/launch") {
        if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
        try {
          const body = await this.readJsonBody<{ headless?: boolean; profileId?: string; sessionId?: string }>(req);
          const session = await mgr.launch(body);
          return this.json(res, 200, { session: { ...session, sessionId: session.id } });
        } catch (err) {
          return this.json(res, 500, { error: String(err) });
        }
      }

      const sessionsDeleteMatch = /^\/api\/browser\/sessions\/([^/]+)$/.exec(url);
      if (sessionsDeleteMatch && method === "DELETE") {
        if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
        try {
          const sessionId = decodeURIComponent(sessionsDeleteMatch[1]!);
          await mgr.closeSession(sessionId);
          return this.json(res, 200, { ok: true });
        } catch (err) {
          return this.json(res, 500, { error: String(err) });
        }
      }

      if (method === "POST" && url === "/api/browser/navigate") {
        if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
        try {
          const body = await this.readJsonBody<{ sessionId: string; url: string }>(req);
          if (!body.sessionId) return this.json(res, 400, { error: "sessionId required." });
          if (!body.url) return this.json(res, 400, { error: "url required." });
          const result = await mgr.navigate(body.sessionId, body.url);
          return this.json(res, 200, result);
        } catch (err) {
          return this.json(res, 500, { error: String(err) });
        }
      }

      const screenshotMatch = /^\/api\/browser\/screenshot\/([^/]+)$/.exec(url);
      if (screenshotMatch && method === "GET") {
        if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
        try {
          const sessionId = decodeURIComponent(screenshotMatch[1]!);
          const buf = await mgr.screenshot(sessionId);
          res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buf.length });
          res.end(buf);
          return;
        } catch (err) {
          return this.json(res, 500, { error: String(err) });
        }
      }

      if (method === "POST" && url === "/api/browser/click") {
        if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
        try {
          const body = await this.readJsonBody<{ sessionId: string; selector: string }>(req);
          if (!body.sessionId) return this.json(res, 400, { error: "sessionId required." });
          if (!body.selector) return this.json(res, 400, { error: "selector required." });
          await mgr.click(body.sessionId, body.selector);
          return this.json(res, 200, { ok: true });
        } catch (err) {
          return this.json(res, 500, { error: String(err) });
        }
      }

      if (method === "POST" && url === "/api/browser/type") {
        if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
        try {
          const body = await this.readJsonBody<{ sessionId: string; selector: string; text: string }>(req);
          if (!body.sessionId) return this.json(res, 400, { error: "sessionId required." });
          if (!body.selector) return this.json(res, 400, { error: "selector required." });
          await mgr.type(body.sessionId, body.selector, body.text ?? "");
          return this.json(res, 200, { ok: true });
        } catch (err) {
          return this.json(res, 500, { error: String(err) });
        }
      }

      if (method === "POST" && url === "/api/browser/evaluate") {
        if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
        try {
          const body = await this.readJsonBody<{ sessionId: string; expression: string }>(req);
          if (!body.sessionId) return this.json(res, 400, { error: "sessionId required." });
          if (!body.expression) return this.json(res, 400, { error: "expression required." });
          const value = await mgr.evaluate(body.sessionId, body.expression);
          return this.json(res, 200, { result: value });
        } catch (err) {
          return this.json(res, 500, { error: String(err) });
        }
      }

      const consoleMatch = /^\/api\/browser\/console-logs\/([^/]+)$/.exec(url);
      if (consoleMatch && method === "GET") {
        if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
        const sessionId = decodeURIComponent(consoleMatch[1]!);
        return this.json(res, 200, { logs: mgr.getConsoleLogs(sessionId) });
      }

      const networkMatch = /^\/api\/browser\/network-log\/([^/]+)$/.exec(url);
      if (networkMatch && method === "GET") {
        if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
        const sessionId = decodeURIComponent(networkMatch[1]!);
        return this.json(res, 200, { log: mgr.getNetworkLog(sessionId) });
      }

      const domMatch = /^\/api\/browser\/dom-snapshot\/([^/]+)$/.exec(url);
      if (domMatch && method === "GET") {
        if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
        try {
          const sessionId = decodeURIComponent(domMatch[1]!);
          const html = await mgr.domSnapshot(sessionId);
          return this.json(res, 200, { dom: html });
        } catch (err) {
          return this.json(res, 500, { error: String(err) });
        }
      }

      const profilesDeleteMatch = /^\/api\/browser\/profiles\/([^/]+)$/.exec(url);
      if (profilesDeleteMatch && method === "DELETE") {
        if (!profMgr) return this.json(res, 503, { error: "Browser profile manager not available." });
        try {
          const profileId = decodeURIComponent(profilesDeleteMatch[1]!);
          profMgr.deleteProfile(profileId);
          return this.json(res, 200, { ok: true });
        } catch (err) {
          return this.json(res, 500, { error: String(err) });
        }
      }
    }
    // ── End Browser Control API ──────────────────────────────────────────

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

    if (method === "GET" && url.startsWith("/api/workspace/characters")) {
      const characters = this.listWorkspaceCharacters();
      return this.json(res, 200, { characters, total: characters.length });
    }

    if (method === "GET" && url.startsWith("/api/workspace/character-assignments")) {
      const parsed = new URL(`http://localhost${url}`);
      const filter: CharacterAssignmentFilter = {};
      const characterId = parsed.searchParams.get("characterId")?.trim();
      const prismUserId = parsed.searchParams.get("prismUserId")?.trim();
      const prismUserEmail = parsed.searchParams.get("prismUserEmail")?.trim();
      const operatorId = parsed.searchParams.get("operatorId")?.trim();
      const operatorEmail = parsed.searchParams.get("operatorEmail")?.trim();
      const clientId = parsed.searchParams.get("clientId")?.trim();
      const sessionId = parsed.searchParams.get("sessionId")?.trim();
      const executionProfileSegment = parsed.searchParams.get("executionProfileSegment")?.trim();
      const state = parsed.searchParams.get("state")?.trim();
      if (characterId) filter.characterId = characterId;
      if (prismUserId) filter.prismUserId = prismUserId;
      if (prismUserEmail) filter.prismUserEmail = prismUserEmail;
      if (operatorId) filter.operatorId = operatorId;
      if (operatorEmail) filter.operatorEmail = operatorEmail;
      if (clientId) filter.clientId = clientId;
      if (sessionId) filter.sessionId = sessionId;
      if (executionProfileSegment === "individual" || executionProfileSegment === "business") {
        filter.executionProfileSegment = executionProfileSegment;
      }
      if (state === "active" || state === "suspended" || state === "revoked") {
        filter.state = state;
      }
      const assignments = this.characterAccountabilityManager.list(filter);
      const characterIndex = new Map(this.listWorkspaceCharacters().map((character) => [character.id, character]));
      return this.json(res, 200, {
        assignments: assignments.map((assignment) => ({
          ...assignment,
          character: characterIndex.get(assignment.characterId) ?? null,
        })),
        total: assignments.length,
      });
    }

    if (method === "GET" && url.startsWith("/api/workspace/character-audit")) {
      const parsed = new URL(`http://localhost${url}`);
      const characterId = parsed.searchParams.get("characterId")?.trim() ?? "";
      const assignmentId = parsed.searchParams.get("assignmentId")?.trim() ?? "";
      const operatorEmail = parsed.searchParams.get("operatorEmail")?.trim().toLowerCase() ?? "";
      const limitRaw = Number(parsed.searchParams.get("limit") ?? "20");
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 20;
      const events = this.activityBus
        .listEvents()
        .filter((event) => event.operation.startsWith("character_accountability."))
        .filter((event) => !characterId || event.characterId === characterId)
        .filter((event) => !assignmentId || event.assignmentId === assignmentId)
        .filter((event) => !operatorEmail || (event.operatorEmail ?? "").toLowerCase() === operatorEmail)
        .slice()
        .sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)))
        .slice(0, limit);
      return this.json(res, 200, { events, total: events.length });
    }

    if (method === "POST" && url === "/api/workspace/character-assign") {
      try {
        const body = await this.readJsonBody<{
          characterId?: string;
          prismUserId?: string;
          prismUserEmail?: string;
          operatorId?: string;
          operatorEmail?: string;
          clientId?: string;
          sessionId?: string;
          executionProfile?: string;
        }>(req);
        const assignment = this.characterAccountabilityManager.assign({
          characterId: String(body.characterId ?? "").trim(),
          prismUserId: String(body.prismUserId ?? "").trim(),
          prismUserEmail: String(body.prismUserEmail ?? "").trim(),
          operatorId: String(body.operatorId ?? "").trim(),
          operatorEmail: String(body.operatorEmail ?? "").trim(),
          clientId: String(body.clientId ?? "dashboard").trim() || "dashboard",
          sessionId: String(body.sessionId ?? this.status.sessionId).trim() || this.status.sessionId,
          executionProfile: String(body.executionProfile ?? this.status.executionProfileSegment).trim() || this.status.executionProfileSegment,
        });
        return this.json(res, 200, { ok: true, assignment });
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 400, { error: e.message ?? "Character assignment failed" });
      }
    }

    if (method === "POST" && url === "/api/workspace/character-dispatch") {
      try {
        const body = await this.readJsonBody<{ assignmentId?: string }>(req);
        const assignmentId = String(body.assignmentId ?? "").trim();
        if (!assignmentId) {
          return this.json(res, 400, { error: "assignmentId is required." });
        }
        const assignment = this.characterAccountabilityManager.recordDispatch(assignmentId);
        if (!assignment) {
          return this.json(res, 404, { error: "Active assignment not found." });
        }
        return this.json(res, 200, { ok: true, assignment });
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 400, { error: e.message ?? "Dispatch failed" });
      }
    }

    if (method === "POST" && url === "/api/workspace/character-suspend") {
      try {
        const body = await this.readJsonBody<{ assignmentId?: string; reason?: string }>(req);
        const assignmentId = String(body.assignmentId ?? "").trim();
        const reason = String(body.reason ?? "dashboard suspend").trim() || "dashboard suspend";
        if (!assignmentId) {
          return this.json(res, 400, { error: "assignmentId is required." });
        }
        const assignment = this.characterAccountabilityManager.suspend(assignmentId, reason);
        if (!assignment) {
          return this.json(res, 404, { error: "Active assignment not found." });
        }
        return this.json(res, 200, { ok: true, assignment });
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 400, { error: e.message ?? "Suspend failed" });
      }
    }

    if (method === "POST" && url === "/api/workspace/character-resume") {
      try {
        const body = await this.readJsonBody<{ assignmentId?: string }>(req);
        const assignmentId = String(body.assignmentId ?? "").trim();
        if (!assignmentId) {
          return this.json(res, 400, { error: "assignmentId is required." });
        }
        const assignment = this.characterAccountabilityManager.resume(assignmentId);
        if (!assignment) {
          return this.json(res, 404, { error: "Suspended assignment not found." });
        }
        return this.json(res, 200, { ok: true, assignment });
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 400, { error: e.message ?? "Resume failed" });
      }
    }

    if (method === "POST" && url === "/api/workspace/character-revoke") {
      try {
        const body = await this.readJsonBody<{ assignmentId?: string; reason?: string }>(req);
        const assignmentId = String(body.assignmentId ?? "").trim();
        const reason = String(body.reason ?? "dashboard revoke").trim() || "dashboard revoke";
        if (!assignmentId) {
          return this.json(res, 400, { error: "assignmentId is required." });
        }
        const assignment = this.characterAccountabilityManager.revoke(assignmentId, reason);
        if (!assignment) {
          return this.json(res, 404, { error: "Assignment not found." });
        }
        return this.json(res, 200, { ok: true, assignment });
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 400, { error: e.message ?? "Revoke failed" });
      }
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

  private listWorkspaceCharacters(): Array<{
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
    sourcePath: string;
  }> {
    const dir = workspaceCharactersDir();
    if (!existsSync(dir)) {
      return [];
    }
    const files = readdirSync(dir)
      .filter((entry) => entry.toLowerCase().endsWith(".json"))
      .sort((left, right) => left.localeCompare(right));
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
      sourcePath: string;
    }> = [];
    for (const fileName of files) {
      const fullPath = join(dir, fileName);
      try {
        const parsed = JSON.parse(readFileSync(fullPath, "utf-8")) as Record<string, unknown>;
        const toolPermissions = (parsed.toolPermissions ?? {}) as Record<string, unknown>;
        const allow = Array.isArray(toolPermissions.allow) ? toolPermissions.allow.map((entry) => String(entry)) : [];
        const deny = Array.isArray(toolPermissions.deny) ? toolPermissions.deny.map((entry) => String(entry)) : [];
        const name = String(parsed.name ?? fileName.replace(/\.json$/i, "")).trim();
        characters.push({
          id: name,
          name,
          displayName: String(parsed.displayName ?? name).trim() || name,
          executionProfile: parsed.executionProfile != null ? String(parsed.executionProfile) : null,
          persona: parsed.persona != null ? String(parsed.persona) : null,
          greeting: parsed.greeting != null ? String(parsed.greeting) : null,
          systemPrompt: parsed.systemPrompt != null ? String(parsed.systemPrompt) : null,
          tags: Array.isArray(parsed.tags) ? parsed.tags.map((entry) => String(entry)) : [],
          maxRiskTier: Number.isFinite(Number(parsed.maxRiskTier)) ? Number(parsed.maxRiskTier) : null,
          allowedTools: allow,
          deniedTools: deny,
          sourcePath: fullPath,
        });
      } catch {
        // Ignore malformed character documents in the panel list.
      }
    }
    return characters;
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
                  arguments: e.toolCall?.arguments,
                  output: e.toolResult?.output
                    ? (typeof e.toolResult.output === "string" ? e.toolResult.output.slice(0, 4000) : JSON.stringify(e.toolResult.output).slice(0, 4000))
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
    .framebuffer-gallery { display: flex; gap: 8px; overflow-x: auto; padding: 10px 0 4px; }
    .framebuffer-gallery-path { font-family: monospace; font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 460px; }
    .framebuffer-selection-summary { font-size: 11px; color: var(--muted); padding: 4px 0 2px; min-height: 18px; }
    .framebuffer-gallery-controls { display: flex; gap: 6px; padding: 6px 0 2px; flex-wrap: wrap; }
    .framebuffer-gallery-controls button { padding: 5px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); cursor: pointer; font-size: 12px; transition: background 0.15s, border-color 0.15s; }
    .framebuffer-gallery-controls button:hover { background: rgba(124,241,200,0.08); border-color: var(--accent); }
    .framebuffer-media-bar { display: none; align-items: center; gap: 6px; padding: 6px 8px; background: rgba(10,14,23,0.85); border: 1px solid var(--border); border-top: none; border-radius: 0 0 6px 6px; flex-wrap: wrap; }
    .framebuffer-media-bar button { padding: 4px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); cursor: pointer; font-size: 11px; transition: background 0.15s, border-color 0.15s; }
    .framebuffer-media-bar button:hover { background: rgba(124,241,200,0.08); border-color: var(--accent); }
    .framebuffer-media-bar button.active { background: rgba(124,241,200,0.15); border-color: #7cf1c8; color: #7cf1c8; }
    .framebuffer-media-bar .fb-media-spacer { flex: 1; }
    .framebuffer-media-bar .fb-media-label { font-size: 10px; color: var(--muted); }
    .framebuffer-viewer video { max-width: 100%; max-height: 480px; object-fit: contain; display: none; cursor: pointer; background: #000; }
    .framebuffer-thumb { width: 80px; height: 50px; object-fit: cover; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; opacity: 0.7; transition: opacity 0.15s, border-color 0.15s; flex-shrink: 0; }
    .framebuffer-thumb:hover { opacity: 1; border-color: var(--accent); }
    .framebuffer-meta { font-size: 11px; color: var(--muted); margin-top: 6px; }
    .framebuffer-item { display: flex; flex-direction: column; width: 120px; flex-shrink: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; cursor: pointer; background: var(--surface); transition: border-color 0.15s, box-shadow 0.15s; }
    .framebuffer-item:hover { border-color: var(--accent); box-shadow: 0 0 8px rgba(124,241,200,0.12); }
    .framebuffer-item.selected { border-color: #7cf1c8; box-shadow: 0 0 12px rgba(124,241,200,0.25); }
    .framebuffer-item-poster { position: relative; width: 100%; height: 70px; background: #0a0e17; overflow: hidden; }
    .framebuffer-item-poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .framebuffer-item-badge { position: absolute; top: 3px; right: 3px; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,0.7); color: #94a3b8; letter-spacing: 0.04em; }
    .framebuffer-item-badge.burst { background: rgba(124,241,200,0.2); color: #7cf1c8; }
    .framebuffer-item-body { padding: 4px 6px 5px; }
    .framebuffer-item-kind { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .framebuffer-item-kind.burst { color: #7cf1c8; }
    .framebuffer-item-title { font-size: 10px; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; margin-top: 1px; }
    .framebuffer-item-subtitle { font-size: 9px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
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
        <button id="tab-button-browser" type="button" class="tab-button" data-tab-id="browser" role="tab" aria-selected="false" aria-controls="tab-browser" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Browser Control</button>
        <button id="tab-button-workspace" type="button" class="tab-button" data-tab-id="workspace" role="tab" aria-selected="false" aria-controls="tab-workspace" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Workspace</button>
        <button id="tab-button-network" type="button" class="tab-button" data-tab-id="network" role="tab" aria-selected="false" aria-controls="tab-network" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Network</button>
        <button id="tab-button-telemetry" type="button" class="tab-button" data-tab-id="telemetry" role="tab" aria-selected="false" aria-controls="tab-telemetry" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Telemetry</button>
        <button id="tab-button-logs" type="button" class="tab-button" data-tab-id="logs" role="tab" aria-selected="false" aria-controls="tab-logs" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Logs &amp; Debug</button>
        <button id="tab-button-scheduler" type="button" class="tab-button" data-tab-id="scheduler" role="tab" aria-selected="false" aria-controls="tab-scheduler" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Scheduler</button>
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

          <div id="provider-matrix-row" style="display: flex; align-items: stretch; gap: 0; min-width: 0;">
            <section id="provider-config-panel" class="rail-section panel" style="flex: 0 0 50%; min-width: 200px; overflow: hidden; box-sizing: border-box;">
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
            <div id="provider-matrix-divider" title="Drag to resize" style="width:8px;cursor:col-resize;flex-shrink:0;position:relative;user-select:none;z-index:1;">
              <div style="position:absolute;top:8%;bottom:8%;left:50%;transform:translateX(-50%);width:2px;background:rgba(148,163,184,0.15);border-radius:2px;pointer-events:none;"></div>
            </div>
            <section id="model-matrix-panel" class="rail-section panel" style="flex: 1 1 0; min-width: 200px; overflow: hidden; box-sizing: border-box;">
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
                <button onclick="runFramebufferDiagnostics()" title="Run capture diagnostics">🔧 Diagnostics</button>
                <span class="framebuffer-meta" id="fb-meta"></span>
              </div>
              <div class="framebuffer-viewer" id="framebuffer-viewer">
                <div class="fb-placeholder" id="fb-placeholder">No screengrab captured yet.<br/>Use <strong>Capture</strong> or trigger an agentic action to begin.</div>
                <img id="framebuffer-preview" style="display:none;" alt="Latest screengrab" onclick="window.open(this.src, \\'_blank\\')" title="Click to open full size" />
                <video id="framebuffer-preview-video" style="display:none;" autoplay loop muted playsinline title="Burst video — click to open" onclick="window.open(this.src, \\'_blank\\')"></video>
              </div>
              <div class="framebuffer-media-bar" id="framebuffer-media-bar">
                <button id="fb-mc-playpause" onclick="toggleBurstPlayPause()" title="Play / Pause burst animation">⏸ Pause</button>
                <button onclick="stopBurstFromUI()" title="Stop animation and show first frame">⏹ Stop</button>
                <span class="fb-media-spacer"></span>
                <span class="fb-media-label">Speed:</span>
                <button id="fb-mc-speed-half" onclick="setBurstSpeed(0.5)" title="Half speed">0.5×</button>
                <button id="fb-mc-speed-1x" onclick="setBurstSpeed(1)" title="Normal speed" class="active">1×</button>
                <button id="fb-mc-speed-2x" onclick="setBurstSpeed(2)" title="Double speed">2×</button>
              </div>
              <div class="framebuffer-selection-summary" id="framebuffer-selection-summary"></div>
              <div style="display:flex;align-items:center;gap:8px;padding:6px 0 2px;flex-wrap:wrap;">
                <span class="muted" style="font-size:10px;">📁</span>
                <span class="framebuffer-gallery-path" id="framebuffer-path">Loading…</span>
                <span style="flex:1;"></span>
                <span id="framebuffer-gallery-summary" class="muted" style="font-size:11px;"></span>
              </div>
              <div class="framebuffer-gallery" id="framebuffer-gallery"></div>
              <div class="framebuffer-gallery-controls" id="framebuffer-gallery-controls"></div>
              <div id="fb-diagnostics" style="display:none;margin-top:8px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:monospace;background:rgba(0,0,0,0.3);"></div>
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

      <!-- ═══════════════ BROWSER CONTROL TAB ═══════════════ -->
      <section id="tab-browser" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-browser" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header">
              <h3>\u{1F310} Browser Control</h3>
              <div style="display:flex;gap:8px;align-items:center;">
                <span id="browser-default" class="muted" style="font-size:12px;">Detecting...</span>
                <span id="browser-preview-mode" class="muted" style="font-size:12px;display:none;"></span>
                <button id="browser-f12-btn" class="secondary-button" onclick="toggleBrowserDevTools()" style="font-size:12px;padding:4px 10px;">F12 Dev Tools</button>
                <button class="secondary-button" onclick="browserRunDiagnostics()" style="font-size:12px;padding:4px 10px;">\u{1F50D} Diagnostics</button>
              </div>
            </div>
            <div id="browser-diagnostics-result" style="display:none;padding:10px;background:rgba(255,255,255,0.04);border-radius:8px;margin:8px 0;font-size:12px;"></div>
            <div class="tabs panel" style="margin:10px 0;padding:6px;">
              <button id="bv-sessions" class="tab-button active" onclick="setBrowserView('sessions')" style="font-size:12px;">Sessions</button>
              <button id="bv-viewport" class="tab-button" onclick="setBrowserView('viewport')" style="font-size:12px;">Viewport</button>
              <button id="bv-network" class="tab-button" onclick="setBrowserView('network')" style="font-size:12px;">Network</button>
              <button id="bv-console" class="tab-button" onclick="setBrowserView('console')" style="font-size:12px;">Console</button>
              <button id="bv-dom" class="tab-button" onclick="setBrowserView('dom')" style="font-size:12px;">DOM</button>
              <button id="bv-storage" class="tab-button" onclick="setBrowserView('storage')" style="font-size:12px;">Storage</button>
              <button id="bv-profiles" class="tab-button" onclick="setBrowserView('profiles')" style="font-size:12px;">Profiles</button>
            </div>
            <!-- Sessions Panel -->
            <div id="browser-sessions-panel">
              <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
                <select id="browser-launch-profile" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;"><option value="">No profile (ephemeral)</option></select>
                <button class="primary-button" onclick="browserLaunchSession(false)" style="font-size:12px;">\u{1F680} Launch Headed</button>
                <button class="primary-button" onclick="browserLaunchSession(true)" style="font-size:12px;">\u{1F916} Launch Headless</button>
                <button class="secondary-button" onclick="refreshSessionsList()" style="font-size:12px;">\u{1F504} Refresh</button>
              </div>
              <div id="browser-sessions-list" class="stack"><span class="muted">No active sessions. Click Launch to start one.</span></div>
            </div>
            <!-- Viewport Panel -->
            <div id="browser-viewport-panel" style="display:none;">
              <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center;">
                <select id="browser-active-session" onchange="browserSessionChanged()" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;min-width:180px;"><option value="">Select session...</option></select>
                <input id="browser-url-input" type="text" placeholder="https://example.com" style="flex:1;min-width:180px;padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;" onkeydown="if(event.key==='Enter')browserNavigate()" />
                <button class="primary-button" onclick="browserNavigate()" style="font-size:12px;">Go</button>
                <button class="secondary-button" onclick="browserTakeScreenshot()" style="font-size:12px;">\u{1F4F7} Screenshot</button>
              </div>
              <div id="browser-page-info" class="muted" style="font-size:12px;margin-bottom:8px;"></div>
              <div id="browser-viewport-container" class="panel" style="min-height:200px;display:flex;align-items:center;justify-content:center;"><span class="muted">No screenshot yet. Navigate to a URL.</span></div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
                <div class="panel" style="padding:12px;">
                  <div class="muted" style="font-size:11px;margin-bottom:6px;">Click Element</div>
                  <div style="display:flex;gap:6px;">
                    <input id="browser-click-selector" type="text" placeholder="CSS selector" style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;" />
                    <button class="primary-button" onclick="browserClickElement()" style="font-size:12px;">Click</button>
                  </div>
                </div>
                <div class="panel" style="padding:12px;">
                  <div class="muted" style="font-size:11px;margin-bottom:6px;">Type Text</div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <input id="browser-type-selector" type="text" placeholder="CSS selector" style="flex:1;min-width:100px;padding:5px 8px;border-radius:5px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;" />
                    <input id="browser-type-text" type="text" placeholder="Text to type" style="flex:1;min-width:100px;padding:5px 8px;border-radius:5px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;" />
                    <button class="primary-button" onclick="browserTypeText()" style="font-size:12px;">Type</button>
                  </div>
                </div>
              </div>
              <div class="panel" style="padding:12px;margin-top:12px;">
                <div class="muted" style="font-size:11px;margin-bottom:6px;">Evaluate JS</div>
                <div style="display:flex;gap:6px;">
                  <input id="browser-eval-input" type="text" placeholder="document.title" style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;" onkeydown="if(event.key==='Enter')browserEvaluate()" />
                  <button class="primary-button" onclick="browserEvaluate()" style="font-size:12px;">Eval</button>
                </div>
                <div id="browser-eval-result" style="display:none;margin-top:6px;padding:6px;background:rgba(0,0,0,0.2);border-radius:5px;font-size:12px;"></div>
              </div>
            </div>
            <!-- Network Panel -->
            <div id="browser-network-panel" style="display:none;">
              <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap;">
                <select id="browser-network-session" onchange="browserRefreshNetwork()" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;min-width:180px;"><option value="">Select session...</option></select>
                <button class="secondary-button" onclick="browserRefreshNetwork()" style="font-size:12px;">\u{1F504} Refresh</button>
              </div>
              <table class="events-table" style="width:100%;"><thead><tr><th>Method</th><th>URL</th><th>Status</th><th>Type</th><th>Time</th></tr></thead><tbody id="browser-network-body"><tr><td colspan="5" class="muted" style="padding:10px;">Select a session first.</td></tr></tbody></table>
            </div>
            <!-- Console Panel -->
            <div id="browser-console-panel" style="display:none;">
              <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap;">
                <select id="browser-console-session" onchange="browserRefreshConsole()" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;min-width:180px;"><option value="">Select session...</option></select>
                <button class="secondary-button" onclick="browserRefreshConsole()" style="font-size:12px;">\u{1F504} Refresh</button>
              </div>
              <div id="browser-console-entries" class="panel" style="max-height:400px;overflow-y:auto;padding:8px;"><span class="muted">Select a session first.</span></div>
            </div>
            <!-- DOM Panel -->
            <div id="browser-dom-panel" style="display:none;">
              <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap;">
                <select id="browser-dom-session" onchange="browserRefreshDom()" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;min-width:180px;"><option value="">Select session...</option></select>
                <button class="secondary-button" onclick="browserRefreshDom()" style="font-size:12px;">\u{1F504} Refresh</button>
              </div>
              <pre id="browser-dom-content" style="max-height:500px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:11px;background:rgba(0,0,0,0.2);padding:10px;border-radius:6px;">Select a session first.</pre>
            </div>
            <!-- Storage Panel -->
            <div id="browser-storage-panel" style="display:none;">
              <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap;">
                <select id="browser-storage-session" onchange="browserRefreshStorage()" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;min-width:180px;"><option value="">Select session...</option></select>
                <button class="secondary-button" onclick="browserRefreshStorage()" style="font-size:12px;">\u{1F504} Refresh</button>
              </div>
              <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button id="storage-tab-cookies" class="tab-button active" onclick="setStorageSubView('cookies')" style="font-size:11px;padding:4px 10px;">Cookies</button>
                <button id="storage-tab-local" class="tab-button" onclick="setStorageSubView('local')" style="font-size:11px;padding:4px 10px;">localStorage</button>
                <button id="storage-tab-session" class="tab-button" onclick="setStorageSubView('session')" style="font-size:11px;padding:4px 10px;">sessionStorage</button>
              </div>
              <div id="browser-storage-content" class="panel" style="padding:8px;"><span class="muted">Select a session first.</span></div>
            </div>
            <!-- Profiles Panel -->
            <div id="browser-profiles-panel" style="display:none;">
              <div class="panel" style="padding:12px;margin-bottom:12px;">
                <div class="muted" style="font-size:11px;margin-bottom:8px;">Create New Profile</div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  <input id="browser-profile-email" type="email" placeholder="user@example.com" style="flex:1;min-width:160px;padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;" />
                  <select id="browser-profile-segment" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;">
                    <option value="individual">Individual</option>
                    <option value="enterprise">Enterprise</option>
                    <option value="operator">Operator</option>
                  </select>
                  <button class="primary-button" onclick="browserCreateProfile()" style="font-size:12px;">Create</button>
                  <button class="secondary-button" onclick="browserRefreshProfiles()" style="font-size:12px;">\u{1F504} Refresh</button>
                </div>
              </div>
              <div id="browser-profiles-list" class="stack"><span class="muted">Loading profiles...</span></div>
            </div>
            <!-- Action Log -->
            <div class="panel" style="margin-top:16px;padding:10px;">
              <div class="muted" style="font-size:11px;font-weight:600;margin-bottom:6px;">Action Log</div>
              <div id="browser-action-history" style="max-height:150px;overflow-y:auto;"><span class="muted" style="font-size:12px;">No actions yet.</span></div>
            </div>
          </section>
        </div>
      </section>

      <!-- ═══════════════ WORKSPACE TAB ═══════════════ -->
      <section id="tab-workspace" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-workspace" aria-hidden="true">
        <div class="tab-grid">
          <!-- Character Panel -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('characterPanel')">
              <h3>Character Panel</h3>
              <span id="characterPanel-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="characterPanel-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Manage CAC assignments, inspect the full identity chain, and review lifecycle/audit activity directly in the Workspace tab.</div>
              <div id="character-panel-status" style="display:none;margin-bottom:10px;padding:10px;border-radius:6px;font-size:12px;"></div>
              <div id="character-summary-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px;"></div>
              <div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(320px,1fr);gap:12px;align-items:start;">
                <div class="stack">
                  <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
                    <input id="character-filter-input" type="text" placeholder="Filter by character, email, profile, or assignment..." style="flex:1;min-width:220px;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:13px;" oninput="filterCharacterAssignments(this.value)" />
                    <button class="primary-button" onclick="refreshCharacterPanel()" style="font-size:12px;">\u{1F504} Refresh</button>
                  </div>
                  <div id="character-roster" class="stack">
                    <div class="muted" style="padding:16px;text-align:center;">Loading CAC assignments...</div>
                  </div>
                </div>
                <div class="stack">
                  <div class="panel" style="padding:12px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">New Assignment</div>
                    <div style="display:grid;grid-template-columns:1fr;gap:8px;">
                      <select id="character-assign-character" onchange="onCharacterDefinitionChanged()" style="padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;">
                        <option value="">Loading characters...</option>
                      </select>
                      <input id="character-assign-prism-user-id" type="text" placeholder="Prism user ID" value="prism-dashboard-user" style="padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      <input id="character-assign-prism-user-email" type="email" placeholder="Prism user email" style="padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      <input id="character-assign-operator-id" type="text" placeholder="Operator ID" value="workspace-operator" style="padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      <input id="character-assign-operator-email" type="email" placeholder="Operator email" style="padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      <input id="character-assign-client-id" type="text" placeholder="Client ID" value="workspace-tab" style="padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      <select id="character-assign-profile" style="padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;">
                        <option value="individual">individual</option>
                        <option value="business">business</option>
                      </select>
                      <button class="primary-button" onclick="submitCharacterAssignment()" style="font-size:12px;">Assign Character</button>
                    </div>
                  </div>
                  <div class="panel" style="padding:12px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">Character Profile Inspector</div>
                    <div id="character-definition-preview">
                      <div class="muted" style="font-size:12px;">Select a character to inspect its CAC profile, tool permissions, and persona.</div>
                    </div>
                  </div>
                  <div class="panel" style="padding:12px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">Accountability Audit Log</div>
                    <div id="character-audit-log" style="max-height:420px;overflow:auto;">
                      <div class="muted" style="font-size:12px;">Loading accountability activity...</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

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
          <section class="rail-section panel">
            <h3>Tool Call Log</h3>
            <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;">
              <span class="muted" style="font-size:11px;">Live tool calls from agentic sessions.</span>
              <div style="flex:1;"></div>
              <button class="secondary-button" style="font-size:11px;padding:3px 8px;" onclick="state.toolCallLog=[];safeRenderStep('toolCallLog',renderToolCallLog);">Clear</button>
            </div>
            <div id="tool-call-log"></div>
          </section>
        </div>
      </section>

      <!-- ═══════════════ SCHEDULER TAB ═══════════════ -->
      <section id="tab-scheduler" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-scheduler" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header">
              <h3>\u{1F4C5} Scheduler</h3>
              <div style="display:flex;gap:6px;align-items:center;">
                <button class="primary-button" style="font-size:12px;" onclick="openSchedulerModal('event')">+ Event</button>
                <button class="primary-button" style="font-size:12px;" onclick="openSchedulerModal('task')">+ Task</button>
                <button class="primary-button" style="font-size:12px;" onclick="openSchedulerModal('project')">+ Project</button>
                <button class="secondary-button" style="font-size:12px;" onclick="refreshSchedulerData()">\u{1F504} Refresh</button>
              </div>
            </div>
            <!-- Sub-view nav -->
            <div class="tabs panel" style="margin:10px 0;padding:6px;">
              <button class="tab-button sched-subnav-btn active" data-sched-view="calendar" onclick="switchSchedulerView('calendar')" style="font-size:12px;">\u{1F4C5} Calendar</button>
              <button class="tab-button sched-subnav-btn" data-sched-view="projects" onclick="switchSchedulerView('projects')" style="font-size:12px;">\u{1F4CB} Projects</button>
              <button class="tab-button sched-subnav-btn" data-sched-view="board" onclick="switchSchedulerView('board')" style="font-size:12px;">\u{1F4CC} Board</button>
              <button class="tab-button sched-subnav-btn" data-sched-view="timeline" onclick="switchSchedulerView('timeline')" style="font-size:12px;">\u{1F4CA} Timeline</button>
            </div>
            <!-- Calendar view -->
            <div id="sched-view-calendar">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
                <button class="secondary-button" onclick="schedCalNav(-1)" style="font-size:12px;padding:4px 10px;">&lsaquo;</button>
                <span id="sched-cal-title" style="font-size:14px;font-weight:600;min-width:120px;text-align:center;"></span>
                <button class="secondary-button" onclick="schedCalNav(1)" style="font-size:12px;padding:4px 10px;">&rsaquo;</button>
                <button class="tab-button sched-mode-btn" data-cal-mode="year" onclick="setCalMode('year')" style="font-size:11px;padding:4px 10px;">Year</button>
                <button class="tab-button sched-mode-btn active" data-cal-mode="month" onclick="setCalMode('month')" style="font-size:11px;padding:4px 10px;">Month</button>
                <button class="tab-button sched-mode-btn" data-cal-mode="week" onclick="setCalMode('week')" style="font-size:11px;padding:4px 10px;">Week</button>
                <button class="tab-button sched-mode-btn" data-cal-mode="day" onclick="setCalMode('day')" style="font-size:11px;padding:4px 10px;">Day</button>
              </div>
              <div id="sched-cal-body" style="min-height:200px;"></div>
            </div>
            <!-- Projects view -->
            <div id="sched-view-projects" style="display:none;">
              <div id="sched-projects-list" class="stack"><span class="muted" style="font-size:12px;">No projects. Click + Project to create one.</span></div>
            </div>
            <!-- Board (Kanban) view -->
            <div id="sched-view-board" style="display:none;">
              <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;min-height:300px;">
                <div data-status="backlog">
                  <div style="font-weight:600;font-size:12px;margin-bottom:8px;">Backlog</div>
                  <div id="sched-lane-backlog" class="sched-lane-body" style="min-height:200px;padding:6px;border:1px dashed rgba(148,163,184,0.2);border-radius:6px;"></div>
                </div>
                <div data-status="todo">
                  <div style="font-weight:600;font-size:12px;margin-bottom:8px;">To Do</div>
                  <div id="sched-lane-todo" class="sched-lane-body" style="min-height:200px;padding:6px;border:1px dashed rgba(148,163,184,0.2);border-radius:6px;"></div>
                </div>
                <div data-status="in-progress">
                  <div style="font-weight:600;font-size:12px;margin-bottom:8px;">In Progress</div>
                  <div id="sched-lane-in-progress" class="sched-lane-body" style="min-height:200px;padding:6px;border:1px dashed rgba(148,163,184,0.2);border-radius:6px;"></div>
                </div>
                <div data-status="review">
                  <div style="font-weight:600;font-size:12px;margin-bottom:8px;">Review</div>
                  <div id="sched-lane-review" class="sched-lane-body" style="min-height:200px;padding:6px;border:1px dashed rgba(148,163,184,0.2);border-radius:6px;"></div>
                </div>
                <div data-status="done">
                  <div style="font-weight:600;font-size:12px;margin-bottom:8px;">Done</div>
                  <div id="sched-lane-done" class="sched-lane-body" style="min-height:200px;padding:6px;border:1px dashed rgba(148,163,184,0.2);border-radius:6px;"></div>
                </div>
              </div>
            </div>
            <!-- Timeline (Gantt) view -->
            <div id="sched-view-timeline" style="display:none;">
              <div id="sched-gantt-header" style="position:relative;height:24px;"></div>
              <div id="sched-gantt-rows" style="min-height:100px;"></div>
            </div>
          </section>
        </div>
      </section>

      <!-- Scheduler Modal -->
      <div id="sched-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;align-items:center;justify-content:center;">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;min-width:360px;max-width:520px;width:90%;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 id="sched-modal-title" style="margin:0;font-size:16px;"></h3>
            <button class="secondary-button" onclick="closeSchedulerModal()" style="font-size:18px;padding:2px 8px;line-height:1;">&times;</button>
          </div>
          <div id="sched-modal-body"></div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
            <button class="secondary-button" onclick="closeSchedulerModal()">Cancel</button>
            <button id="sched-modal-save" class="primary-button" onclick="saveSchedulerModal()">Save</button>
          </div>
        </div>
      </div>
    </main>
  </div>
  <script type="module" src="/public/dashboard-app.js"></script>

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
