import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ActivityBus } from "../activity/bus.js";
import type { ActivityEvent } from "../activity/types.js";
import { SqliteActivityStore } from "../activity/sqlite-store.js";
import type { ApprovalQueue } from "../approval/approval-queue.js";
import type { LlmDelegate } from "../agents/agent-types.js";
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

export interface DashboardRuntimeStatus {
  sessionId: string;
  environmentProfile: string;
  mode: "demo" | "server";
  startedAt: string;
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
    sessionPackageStorePath: string = "prism-output/dashboard-session-packages.json",
    sessionPackageExportDir: string = "prism-output/packages",
  ) {
    this.providerSecretStore = providerSecretStore ?? new WindowsProtectedFileProviderSecretStore();
    this.llmProviders = new LlmProviderManager(process.env, this.chatStore.listProviderSettings(), this.providerSecretStore);
    this.sessionPackageStorePath = sessionPackageStorePath;
    this.sessionPackageExportDir = sessionPackageExportDir;
    this.traceExplorer = activityStore ? new SessionTraceExplorer(activityStore) : undefined;
    this.policyAuditExporter = activityStore ? new PolicyAuditExporter(activityStore) : undefined;
    this.pkgStore = activityStore ? new SessionPackageSqliteStore(activityStore.dbPath) : undefined;
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
      generateForRole: (role, input) => this.llmProviders.generateForRole(role, input),
    };
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
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
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

      let generated;
      if (hasSessionOverride) {
        generated = await this.llmProviders.generate({
          message: content,
          conversation: conversationHistory,
          systemPrompt: [
            "You are PRISM's operator console assistant.",
            "Use concise actionable responses.",
            "Do not invent runtime state.",
            `Runtime mode: ${this.status.mode}. Environment: ${this.status.environmentProfile}.`,
            `Pending approvals: ${this.queue.list().length}.`,
          ].join("\n"),
        }, {
          providerId: session.llmProviderId ?? undefined,
          model: session.llmModel ?? undefined,
        });
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
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: end;
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
  </style>
</head>
<body>
  <div class="app" id="app">
    <aside class="sidebar panel" id="sidebar">
      <div class="brand">
        <div class="eyebrow">Frontier Operator Console</div>
        <h1>PRISM Chat</h1>
        <div class="muted">http://localhost:${port}</div>
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
            <div class="composer-shell">
              <textarea id="composer" placeholder="Ask for status, approvals, history, or say 'run workflow demo'."></textarea>
              <button id="send-button" class="primary-button" onclick="sendMessage()">Send</button>
            </div>
            <div class="composer-hint">Enter sends. Shift+Enter inserts a newline. Sessions and messages persist in SQLite.</div>
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
          
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px;">
            <section class="rail-section panel" style="flex:1;">
              <div class="collapsible-header" onclick="togglePanelCollapse('providerConfig')">
                <h3>Provider Configuration</h3>
                <span class="collapse-chevron" id="chevron-providerConfig">\u25BC</span>
              </div>
              <div class="collapsible-body" id="body-providerConfig">
                <div class="muted" style="margin-bottom:12px;">Configure API keys and settings for each provider. Expand a card to manage.</div>
                <div id="provider-cards-container" class="stack"></div>
              </div>
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
      sessionProviderCollapsed: false,
      providerConfigCollapsed: false,
      modelMatrixCollapsed: false,
      settingsPanelCollapsed: false,
      llmAuditCollapsed: false,
      toolsPanelCollapsed: false,
      pluginsPanelCollapsed: false,
      utilitiesPanelCollapsed: false
    };

    const tabs = [
      { id: 'chat', label: 'Chat Interface' },
      { id: 'settings', label: 'Provider & Settings' },
      { id: 'tools', label: 'Tools & Plugins' },
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
      const [status, readiness, llmCatalog, llmConfig, llmAuditEvents, pending, actions, actionHistory, traceData, events, retrievalData, prioritizedAlertsData, telemetrySummaryData, runtimeExcellenceData, releaseValidationData, releaseDecisionData, selfReviewLatest, selfReviewHistory, packagePayload, packageHistoryPayload] = await Promise.all([
        request('/api/status'),
        request(readinessUrl).catch(() => null),
        llmUrl ? request(llmUrl) : Promise.resolve(null),
        llmConfigUrl ? request(llmConfigUrl).catch(() => null) : Promise.resolve(null),
        request(llmAuditUrl),
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
        request('/api/session-packages/history?limit=12').catch(() => ({ history: [] }))
      ]);
      state.status = status;
      state.readiness = readiness;
      state.llmCatalog = llmCatalog;
      state.llmConfig = llmConfig;
      state.llmAuditEvents = llmAuditEvents;
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
            extraHtml = '<div style="margin-top: 14px;"><button class="secondary-button" style="font-size:12px; padding:8px 12px; display:inline-flex; align-items:center; gap:6px;" onclick="setActiveTab(&quot;settings&quot;)">&#x1F50D; Open Settings / Logs </button></div>';
        }

        return '<div class="message ' + escapeHtml(message.role) + '">'
          + '<div class="message-label">' + escapeHtml(roleLabel) + '</div>'
          + '<div>' + escapeHtml(message.content) + '</div>'
          + extraHtml
          + '<div class="message-time">' + escapeHtml(formatRelativeTime(message.createdAt)) + '</div>'
          + '</div>';
      }).join('');

      const typing = state.busy ? '<div class="message assistant"><div class="message-label">PRISM</div><div>Working...</div></div>' : '';
      container.innerHTML = rows + typing;
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
      var providerSet = {};
      state.llmCatalog.providers.forEach(function(provider) {
        if (!provider.models || !provider.models.length) return;
        providerSet[provider.id] = provider.label;
        provider.models.forEach(function(model) {
          var tier = guessTier(model, provider.kind);
          allRows.push({ provider: provider.label, providerId: provider.id, model: model, tier: tier, kind: provider.kind, enabled: provider.enabled });
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

      var filterStyle = 'padding:5px 8px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:rgba(0,0,0,0.25);color:var(--fg);font-size:11px;';
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

      var thStyle = 'cursor:pointer;user-select:none;';
      html += '<table class="events-table" style="margin-top:8px;"><thead><tr>'
        + '<th style="' + thStyle + '" onclick="setMatrixSort(&#39;model&#39;)">Model' + sortArrow('model') + '</th>'
        + '<th style="' + thStyle + '" onclick="setMatrixSort(&#39;provider&#39;)">Provider' + sortArrow('provider') + '</th>'
        + '<th style="' + thStyle + '" onclick="setMatrixSort(&#39;tier&#39;)">Tier' + sortArrow('tier') + '</th>'
        + '<th style="' + thStyle + '" onclick="setMatrixSort(&#39;locality&#39;)">Locality' + sortArrow('locality') + '</th>'
        + '</tr></thead><tbody>';

      var displayRows = isExpanded ? rows : rows.slice(0, 5);
      if (!displayRows.length) {
        html += '<tr><td colspan="4" class="muted" style="text-align:center;">No models match the current filters.</td></tr>';
      }
      displayRows.forEach(function(row) {
        var color = tierColors[row.tier] || '#aaa';
        var dimStyle = row.enabled ? '' : ' style="opacity:0.5;"';
        html += '<tr' + dimStyle + '>'
          + '<td class="mono">' + escapeHtml(row.model) + '</td>'
          + '<td>' + escapeHtml(row.provider) + (row.enabled ? '' : ' <span style="font-size:10px;color:var(--muted);">(unconfigured)</span>') + '</td>'
          + '<td><span style="color:' + color + ';font-weight:600;">' + escapeHtml(tierLabels[row.tier] || 'T?') + '</span></td>'
          + '<td>' + (row.kind === 'local' ? '🖥 Local' : '☁ Cloud') + '</td>'
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
      var items = [];
      if (state.status) {
        items.push({ label: 'Uptime', value: (state.status.uptimeSeconds || 0) + 's' });
        items.push({ label: 'Event Count', value: String(state.status.eventCount || 0) });
        items.push({ label: 'Server Status', value: state.status.status || 'unknown' });
        if (state.status.version) items.push({ label: 'Version', value: state.status.version });
        if (state.status.nodeVersion) items.push({ label: 'Node Version', value: state.status.nodeVersion });
        if (state.status.platform) items.push({ label: 'Platform', value: state.status.platform });
      }
      if (state.readiness && state.readiness.requirements) {
        var reqs = state.readiness.requirements;
        for (var i = 0; i < reqs.length; i++) {
          items.push({ label: reqs[i].label || reqs[i].id, value: reqs[i].met ? '\u2713 Met' : '\u2717 Not met' });
        }
      }
      var activeProvider = state.llmCatalog ? (state.llmCatalog.activeProviderId || 'none') : 'unknown';
      var activeModel = state.llmCatalog ? (state.llmCatalog.activeModel || 'none') : 'unknown';
      items.push({ label: 'Active Provider', value: activeProvider });
      items.push({ label: 'Active Model', value: activeModel });
      items.push({ label: 'Active Tab', value: state.activeTab });
      items.push({ label: 'Sessions Count', value: String((state.sessions || []).length) });
      if (!items.length) {
        container.innerHTML = '<div class="muted">No system settings available.</div>';
        return;
      }
      var html = '<div class="muted" style="margin-bottom:12px;">System configuration and runtime information.</div>';
      html += '<div class="settings-grid">';
      for (var j = 0; j < items.length; j++) {
        html += '<div class="settings-item">';
        html += '<span class="settings-item-label">' + escapeHtml(items[j].label) + '</span>';
        html += '<span class="settings-item-value">' + escapeHtml(items[j].value) + '</span>';
        html += '</div>';
      }
      html += '</div>';
      container.innerHTML = html;
    }

    function renderToolsPanel() {
      var container = document.getElementById('tools-panel');
      if (!container) return;

      var tools = [
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

      var riskColor = { low: '#7ecf7e', medium: '#ffd17a', high: '#ffc1c1' };
      var riskBg = { low: 'rgba(126,207,126,0.15)', medium: 'rgba(255,200,80,0.12)', high: 'rgba(255,141,141,0.12)' };
      var catIcon = { System: '\uD83D\uDDA5\uFE0F', Application: '\uD83D\uDCCB', Knowledge: '\uD83E\uDDE0', Integration: '\uD83D\uDD17' };

      var categories = ['System', 'Application', 'Knowledge', 'Integration'];
      var html = '<div class="muted" style="margin-bottom:8px;">'
        + tools.length + ' built-in tools registered across ' + categories.length + ' categories.</div>';

      for (var c = 0; c < categories.length; c++) {
        var cat = categories[c];
        var catTools = tools.filter(function(t) { return t.cat === cat; });
        if (!catTools.length) continue;
        html += '<div style="margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:600;color:var(--fg);">' + (catIcon[cat] || '') + ' ' + escapeHtml(cat) + ' <span class="muted">(' + catTools.length + ')</span></div>';
        for (var i = 0; i < catTools.length; i++) {
          var t = catTools[i];
          html += '<div class="ps-card" style="margin-bottom:6px;">';
          html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;gap:8px;">';
          html += '<div style="flex:1;min-width:0;">';
          html += '<span style="font-weight:600;font-size:13px;">' + escapeHtml(t.name) + '</span>';
          html += '<div class="muted" style="font-size:11px;margin-top:2px;">' + escapeHtml(t.desc) + '</div>';
          html += '</div>';
          html += '<div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">';
          html += '<span class="ps-badge" style="background:' + riskBg[t.risk] + ';color:' + riskColor[t.risk] + ';">' + escapeHtml(t.risk) + '</span>';
          html += '<span class="ps-badge" style="background:' + (t.mut ? 'rgba(255,200,80,0.12);color:#ffd17a' : 'rgba(126,207,126,0.15);color:#7ecf7e') + ';">' + (t.mut ? 'mutating' : 'read-only') + '</span>';
          html += '</div></div></div>';
        }
      }
      container.innerHTML = html;
    }

    function renderPluginsPanel() {
      var container = document.getElementById('plugins-panel');
      if (!container) return;

      var plugins = [
        { name: 'ids-mcp', group: 'In-Repo', type: 'Python MCP Server', desc: 'IDS identity services \u2014 authentication, token lifecycle, and credential management', status: 'Active' },
        { name: 'impressioncore-eds', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Enterprise Data Services \u2014 structured data ingestion, transformation, and schema enforcement', status: 'Active' },
        { name: 'impressioncore-ipa', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Intelligent Process Automation \u2014 task queuing, workflow dispatch, and RPA bridge', status: 'Active' },
        { name: 'impressioncore-goliath', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Large-scale data pipeline orchestration \u2014 batch ETL, partitioned processing, and backpressure control', status: 'Active' },
        { name: 'impressioncore-vrgc', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Visual Rendering & Graphics Compute \u2014 image generation, chart rendering, and GPU-accelerated transforms', status: 'Active' },
        { name: 'impressioncore-dpa', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Document Processing & Analytics \u2014 PDF extraction, OCR, and document classification', status: 'Active' },
        { name: 'web-search-mcp', group: 'In-Repo', type: 'Python MCP Server', desc: 'Web search provider \u2014 query routing, result aggregation, and safe content filtering', status: 'Active' }
      ];

      var groupIcon = { 'In-Repo': '\uD83D\uDCC1', 'ImpressionCore Suite': '\uD83E\uDDE9' };
      var groups = ['In-Repo', 'ImpressionCore Suite'];

      var html = '<div class="muted" style="margin-bottom:8px;">'
        + plugins.length + ' MCP plugins registered across ' + groups.length + ' sources.</div>';

      for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        var grpPlugins = plugins.filter(function(p) { return p.group === grp; });
        if (!grpPlugins.length) continue;
        html += '<div style="margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:600;color:var(--fg);">' + (groupIcon[grp] || '') + ' ' + escapeHtml(grp) + ' <span class="muted">(' + grpPlugins.length + ')</span></div>';
        for (var i = 0; i < grpPlugins.length; i++) {
          var p = grpPlugins[i];
          html += '<div class="ps-card" style="margin-bottom:6px;">';
          html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;gap:8px;">';
          html += '<div style="flex:1;min-width:0;">';
          html += '<span style="font-weight:600;font-size:13px;">' + escapeHtml(p.name) + '</span>';
          html += '<span class="ps-badge" style="margin-left:8px;background:rgba(130,170,255,0.12);color:#82aaff;font-size:10px;">' + escapeHtml(p.type) + '</span>';
          html += '<div class="muted" style="font-size:11px;margin-top:2px;">' + escapeHtml(p.desc) + '</div>';
          html += '</div>';
          html += '<span class="ps-badge" style="background:rgba(126,207,126,0.15);color:#7ecf7e;">' + escapeHtml(p.status) + '</span>';
          html += '</div></div>';
        }
      }
      container.innerHTML = html;
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

      var html = '<div class="muted" style="margin-bottom:8px;">'
        + utils.length + ' utilities registered across ' + categories.length + ' categories.</div>';

      for (var c = 0; c < categories.length; c++) {
        var cat = categories[c];
        var catUtils = utils.filter(function(u) { return u.cat === cat; });
        if (!catUtils.length) continue;
        html += '<div style="margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:600;color:var(--fg);">' + (catIcon[cat] || '') + ' ' + escapeHtml(cat) + ' <span class="muted">(' + catUtils.length + ')</span></div>';
        for (var i = 0; i < catUtils.length; i++) {
          var u = catUtils[i];
          html += '<div class="ps-card" style="margin-bottom:6px;">';
          html += '<div style="padding:10px 14px;">';
          html += '<span style="font-weight:600;font-size:13px;">' + escapeHtml(u.name) + '</span>';
          html += '<div class="muted" style="font-size:11px;margin-top:2px;">' + escapeHtml(u.desc) + '</div>';
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

    function safeRenderStep(name, fn) {
      try {
        fn();
      } catch (error) {
        console.error('[dashboard-render]', name, error);
      }
    }

    function render() {
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
      safeRenderStep('providerCards', renderProviderCards);
      safeRenderStep('llmAudit', renderLlmAudit);
      safeRenderStep('settingsPanel', renderSettingsPanel);
      safeRenderStep('toolsPanel', renderToolsPanel);
      safeRenderStep('pluginsPanel', renderPluginsPanel);
      safeRenderStep('utilitiesPanel', renderUtilitiesPanel);
      safeRenderStep('actions', renderActions);
      safeRenderStep('approvals', renderApprovals);
      safeRenderStep('actionHistory', renderActionHistory);
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
      state.activeTab = tabId;
      if (tabId === 'settings') {
        refreshChrome().then(function() { render(); });
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
      composer.value = '';
      render();
      try {
        await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
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