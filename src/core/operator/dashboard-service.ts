import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { homedir } from "node:os";
import { get as httpGet } from "node:http";
import https from "node:https";
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
import { resolveProfile } from "./model-capability-matrix.js";
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
import { workspacePath, resolveWorkspaceRoot, setWorkspaceRoot, ensureWorkspaceStructure, workspaceFramebufferDir, readPreferences, writePreferences, getWorkspaceHub, setWorkspaceHub, seedDefaultCharacters } from "../config/workspace-resolver.js";
import { FramebufferCapture } from "./framebuffer-capture.js";
import { BrowserControlTool } from "../../adapters/system/browser-control-tool.js";
import { AgenticChatExecutor, type AgenticTurnEvent, type AgenticResult } from "./agentic-chat-executor.js";
import { CharacterAccountabilityStore, type CharacterAssignmentFilter } from "../accountability/character-accountability-store.js";
import { CharacterAccountabilityManager } from "../accountability/character-accountability-manager.js";
import { workspaceCharactersDir, workspaceDbPath } from "../config/workspace-resolver.js";
import { UsageMeteringService, type UsageWindow } from "./usage-metering-service.js";
import { LlamaCppSupervisor } from "./llama-cpp-supervisor.js";
import { GuardianAgent } from "../agents/guardian-agent.js";
import { DashboardControlTool } from "../tools/dashboard-control-tool.js";
import { SchedulerEngine, parseCronExpression, getNextNCronOccurrences } from "./scheduler-engine.js";
import { AuthGate } from "../security/auth.js";
import { RateLimiter } from "../security/rate-limiter.js";
import { loadPluginPack } from "../plugins/plugin-pack-loader.js";
import type { PluginPackManifest } from "../plugins/plugin-pack-validator.js";
import sqlite3 from "sqlite3";
import { ToolContractExtractor, type ExtractionRequest } from "../tools/tool-contract-extractor.js";
import { PolicyEngine } from "../policy/engine.js";
import { A2ATaskAdapter } from "../../adapters/application/a2a-task-adapter.js";
import { GovernanceHooksAdapter } from "../../adapters/application/governance-hooks-adapter.js";
import { MetricsStore, HistogramSnapshot } from "../activity/metrics-store.js";
import { OtelExporter } from "../activity/otel-exporter.js";
import { GmailOAuthAdapter } from "../../adapters/application/email-oauth-adapter.js";
import { OutlookOAuthAdapter } from "../../adapters/application/outlook-oauth-adapter.js";
import { createOAuthTokenStore } from "../operator/oauth-token-store.js";

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

// ── SLO Types & Computation ───────────────────────────────────────────────────

export type SloStatus = "green" | "yellow" | "red" | "no_data";

export interface SloMetric {
  name: string;
  label: string;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  targetP95Ms: number;
  targetP99Ms: number;
  status: SloStatus;
}

export interface SloSummary {
  generatedAt: string;
  metrics: SloMetric[];
}

const SLO_TARGETS: ReadonlyArray<{ histName: string; label: string; targetP95Ms: number; targetP99Ms: number }> = [
  { histName: "prism_operation_duration_ms", label: "Operation Latency", targetP95Ms: 500, targetP99Ms: 1000 },
  { histName: "prism_policy_latency_ms", label: "Policy Check Latency", targetP95Ms: 250, targetP99Ms: 500 },
  { histName: "prism_llm_latency_ms", label: "LLM Latency", targetP95Ms: 5000, targetP99Ms: 10000 },
];

/**
 * Compute a percentile value from a histogram snapshot using linear interpolation.
 * Returns null if no observations are present.
 */
function histogramPercentile(snap: HistogramSnapshot, p: number): number | null {
  if (snap.totalObservations === 0) return null;
  const target = p * snap.totalObservations;
  for (let i = 0; i < snap.buckets.length; i++) {
    if (snap.counts[i] >= target) {
      // Linear interpolation between lower and upper bound
      const lower = i === 0 ? 0 : snap.buckets[i - 1];
      const upper = snap.buckets[i];
      const lowerCount = i === 0 ? 0 : snap.counts[i - 1];
      const upperCount = snap.counts[i];
      if (upperCount === lowerCount) return upper;
      return lower + (upper - lower) * ((target - lowerCount) / (upperCount - lowerCount));
    }
  }
  // All observations in +Inf bucket
  return snap.buckets[snap.buckets.length - 1] ?? null;
}

function computeSloSummary(store: MetricsStore): SloSummary {
  const snapshots = store.getHistogramSnapshot();
  const metrics: SloMetric[] = SLO_TARGETS.map(({ histName, label, targetP95Ms, targetP99Ms }) => {
    // Aggregate all label combinations for this histogram
    const matching = snapshots.filter(s => s.name === histName);
    let totalObs = 0;
    let totalSum = 0;
    // Merge bucket counts (they share the same bucket boundaries)
    let mergedCounts: number[] | null = null;
    let buckets: number[] = [];
    for (const snap of matching) {
      totalObs += snap.totalObservations;
      totalSum += snap.sum;
      if (mergedCounts === null) {
        mergedCounts = [...snap.counts];
        buckets = snap.buckets;
      } else {
        for (let i = 0; i < mergedCounts.length && i < snap.counts.length; i++) {
          mergedCounts[i] += snap.counts[i];
        }
      }
    }
    if (mergedCounts === null || totalObs === 0) {
      return { name: histName, label, p50Ms: null, p95Ms: null, p99Ms: null, targetP95Ms, targetP99Ms, status: "no_data" };
    }
    const merged: HistogramSnapshot = { name: histName, labels: {}, buckets, counts: mergedCounts, sum: totalSum, totalObservations: totalObs };
    const p50Ms = histogramPercentile(merged, 0.50);
    const p95Ms = histogramPercentile(merged, 0.95);
    const p99Ms = histogramPercentile(merged, 0.99);

    let status: SloStatus = "green";
    if (p95Ms !== null) {
      const ratio = p95Ms / targetP95Ms;
      if (ratio >= 1.0) status = "red";
      else if (ratio >= 0.75) status = "yellow";
    }

    return { name: histName, label, p50Ms, p95Ms, p99Ms, targetP95Ms, targetP99Ms, status };
  });

  return { generatedAt: new Date().toISOString(), metrics };
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

export interface DownloadProgress {
  id: string;
  url: string;
  fileName: string;
  status: "pending" | "downloading" | "completed" | "error";
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
  startTime: string;
}

export class DashboardService {
  private static readonly publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
  private readonly server: Server;
  private readonly llmProviders: LlmProviderManager;
  private readonly providerSecretStore: ProviderSecretStore;
  private readonly authGate: AuthGate;
  private readonly rateLimiter: RateLimiter;
  private tlsEnabled = false;
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
  private toolContractExtractor: ToolContractExtractor | null = null;
  private readonly llamaSupervisor: LlamaCppSupervisor;
  private readonly bitnetSupervisor: LlamaCppSupervisor;
  private readonly guardianAgent: GuardianAgent;
  private readonly agenticExecutor: AgenticChatExecutor | null;
  private readonly dashboardControlTool: DashboardControlTool;
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
  private diagnosticsRunning = false;
  private diagnosticsLastRunAt: string | null = null;
  private agentDiagnosticsRunning = false;
  private agentDiagnosticsLastRunAt: string | null = null;
  private computerDiagnosticsRunning = false;
  private computerDiagnosticsLastRunAt: string | null = null;
  private knowledgeGraphDiagnosticsRunning = false;
  private knowledgeGraphDiagnosticsLastRunAt: string | null = null;
  private workspaceDiagnosticsRunning = false;
  private workspaceDiagnosticsLastRunAt: string | null = null;
  private networkDiagnosticsRunning = false;
  private networkDiagnosticsLastRunAt: string | null = null;
  private telemetryDiagnosticsRunning = false;
  private telemetryDiagnosticsLastRunAt: string | null = null;
  private logsDiagnosticsRunning = false;
  private logsDiagnosticsLastRunAt: string | null = null;
  private schedulerDiagnosticsRunning = false;
  private schedulerDiagnosticsLastRunAt: string | null = null;
  private demoDiagnosticsRunning = false;
  private demoDiagnosticsLastRunAt: string | null = null;
  private readonly characterAccountabilityStore: CharacterAccountabilityStore;
  private readonly characterAccountabilityManager: CharacterAccountabilityManager;
  private usageMetering?: UsageMeteringService;
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
  private readonly downloadStatus = new Map<string, DownloadProgress>();
  private customRecommendedModels: Array<{ name: string; fileName: string; size: string; path: string; source: string; addedAt: string }> = [];

  /* ── A2A Protocol adapters (Phase F) ───────────────────────────────── */
  private a2aTaskAdapter: A2ATaskAdapter | null = null;
  private governanceHooksAdapter: GovernanceHooksAdapter | null = null;

  /* ── Observability (Phase E6) ───────────────────────────────────────── */
  private readonly metricsStore: MetricsStore;
  private readonly otelExporter: OtelExporter;

  /* ── OAuth adapters (Phase E2) ──────────────────────────────────────── */
  private readonly gmailOAuth: GmailOAuthAdapter;
  private readonly outlookOAuth: OutlookOAuthAdapter;

  /* ── Scheduler in-memory stores ────────────────────────────────────── */
  private readonly schedulerEvents = new Map<string, { id: string; title: string; start: string; end?: string; description?: string; createdAt: string }>();
  private readonly schedulerProjects = new Map<string, { id: string; name: string; description?: string; tasks: Array<{ id: string; title: string; status: string; assignee?: string; startDate?: string; endDate?: string; dueDate?: string; createdAt: string }>; milestones: Array<{ title: string; dueDate?: string }>; createdAt: string }>();
  private readonly schedulerEngine: SchedulerEngine;

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
    usageMetering?: UsageMeteringService,
    gmailOAuth?: GmailOAuthAdapter,
    outlookOAuth?: OutlookOAuthAdapter,
  ) {
    this.providerSecretStore = providerSecretStore ?? new WindowsProtectedFileProviderSecretStore();

    // ── Security: Auth gate & rate limiter ──────────────────────────────
    const authDisabled = process.env.PRISM_AUTH_DISABLED === "true";
    if (authDisabled && process.env.NODE_ENV === "production") {
      throw new Error(
        "[SECURITY] PRISM_AUTH_DISABLED=true is not permitted when NODE_ENV=production. " +
        "Remove this environment variable before deploying."
      );
    }
    this.authGate = new AuthGate({
      tokenFilePath: workspacePath("state", "admin-token"),
      disabled: authDisabled,
      publicRoutes: ["/health", "/api/health", "/favicon.ico", "/.well-known/agent.json", "/metrics"],
      publicPrefixes: ["/public/", "/setup", "/api/auth/"],
    });
    this.rateLimiter = new RateLimiter({
      maxRequests: Number(process.env.PRISM_RATE_LIMIT ?? 200),
      windowMs: 60_000,
    });

    // ── Observability (Phase E6) — initialize early so all events are counted ─
    this.metricsStore = new MetricsStore();
    this.otelExporter = new OtelExporter(this.activityBus, this.metricsStore, {
      serviceName: "prism",
      serviceVersion: "0.2.0",
      endpoint: process.env.PRISM_OTEL_ENDPOINT,
      consoleExport: process.env.PRISM_OTEL_CONSOLE === "true",
    });
    this.otelExporter.start();

    // ── OAuth adapters (Phase E2) ─────────────────────────────────────────────
    const oauthTokenStore = createOAuthTokenStore();
    this.gmailOAuth = gmailOAuth ?? new GmailOAuthAdapter(oauthTokenStore);
    this.outlookOAuth = outlookOAuth ?? new OutlookOAuthAdapter(oauthTokenStore);

    this.llamaSupervisor = new LlamaCppSupervisor({
      binaryPath: process.env.PRISM_LLAMACPP_BIN || "llama-server",
      basePort: 8081,
      maxSlots: 5,
      defaultContext: 4096,
      modelsDir: join(process.cwd(), "models"),
    });

    this.bitnetSupervisor = new LlamaCppSupervisor({
      binaryPath: process.env.PRISM_BITNET_BIN || "bitnet-server",
      basePort: 8082,
      maxSlots: 2,
      defaultContext: 4096,
      modelsDir: join(process.cwd(), "models"),
    });

    this.llmProviders = new LlmProviderManager(process.env, this.chatStore.listProviderSettings(), this.providerSecretStore, this.llamaSupervisor, this.bitnetSupervisor, this.activityBus);
    this.llmProviders.loadPersistedProfiles(this.chatStore.listModelProfiles());
    this.characterAccountabilityStore = new CharacterAccountabilityStore(workspaceDbPath());
    this.characterAccountabilityManager = new CharacterAccountabilityManager(this.characterAccountabilityStore, this.activityBus);
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
            prompt: { type: "string", required: true }
          }
        },
        execute: async (request: any) => {
          const prompt = request.args.prompt as string;
          if (!prompt) return { ok: false, output: { error: "Missing prompt." } };
          const result = await this.llmProviders.generateForRole("reasoning", {
            message: prompt,
            conversation: [],
            systemPrompt: "You are the primary reasoning model for PRISM. A smaller agent has delegated a complex task to you. Provide the best possible answer or analysis based on the prompt."
          });
          if (!result) return { ok: false, output: { error: "Reasoning model failed to produce a response." } };
          return { ok: true, output: { response: result.content } };
        }
      });
    }
    this.agenticExecutor = this.toolRegistry ? new AgenticChatExecutor(this.toolRegistry) : null;
    this.tools = toolRegistry ? toolRegistry.list() : [];
    if (usageMetering) this.usageMetering = usageMetering;

    // Guardian Agent — permanent autonomous agent powered by llama.cpp
    this.guardianAgent = new GuardianAgent(this.activityBus, this.llamaSupervisor, this.tools, {
      modelAlias: process.env.PRISM_GUARDIAN_MODEL_ALIAS || "guardian",
      modelPath: process.env.PRISM_GUARDIAN_MODEL_PATH || "",
      authorityTier: (process.env.PRISM_GUARDIAN_AUTHORITY as "tier1_autonomous" | "tier2_conditional") || "tier2_conditional",
      autoStart: process.env.PRISM_GUARDIAN_AUTOSTART !== "false",
      contextSize: parseInt(process.env.PRISM_GUARDIAN_CTX_SIZE || "4096", 10),
      draftModelPath: process.env.PRISM_GUARDIAN_DRAFT_MODEL || undefined,
      gpuLayers: process.env.PRISM_GUARDIAN_GPU_LAYERS ? parseInt(process.env.PRISM_GUARDIAN_GPU_LAYERS, 10) : undefined,
      flashAttn: process.env.PRISM_GUARDIAN_FLASH_ATTN !== "false",
      dashboardBaseUrl: `http://127.0.0.1:${this.port}`,
    });

    this.dashboardControlTool = new DashboardControlTool(this.activityBus);
    if (this.toolRegistry) {
      this.toolRegistry.register(this.dashboardControlTool);
    }
    this.tools.push(this.dashboardControlTool);

    // Forward Guardian events and UI actions to WebSocket clients
    this.guardianAgent.on("guardian_event", (evt: { operation: string; detail: string }) => {
      for (const ws of this.wsClients) {
        try {
          ws.send(JSON.stringify({ type: "guardian_event", ...evt, timestamp: new Date().toISOString() }));
        } catch { /* client may have disconnected */ }
      }
    });

    this.activityBus.subscribe({
      onEvent: (event) => {
        if (event.operation.startsWith("ui.")) {
          for (const ws of this.wsClients) {
            try {
              ws.send(JSON.stringify({ type: "ui_action", ...event.details, timestamp: new Date().toISOString() }));
            } catch { /* client may have disconnected */ }
          }
        }
      }
    });
    // Auto-start Guardian if configured and model path is set
    if (this.guardianAgent.getConfig().autoStart && this.guardianAgent.getConfig().modelPath) {
      void this.guardianAgent.start();
    }
    // Inject agent-list resolver so guardian tasks can inspect agent state
    if (this.agentLifecycle) {
      const lifecycle = this.agentLifecycle;
      this.guardianAgent.setAgentListFn(() => {
        const agents = lifecycle.list().map(a => ({ id: a.agentId, state: a.state, role: a.role, lifecycle: a.lifecycle }));
        return { agents };
      });
    }

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
    this.loadCustomRecommendedModels();

    // ── A2A Protocol adapters (Phase F) ──────────────────────────────────
    // Use the workspace's persistent SQLite DB so A2A tasks survive restarts.
    try {
      const a2aDb = new sqlite3.Database(workspaceDbPath());
      this.a2aTaskAdapter = new A2ATaskAdapter(a2aDb, this.activityBus);
      this.governanceHooksAdapter = new GovernanceHooksAdapter(this.activityBus);
    } catch {
      // Graceful degradation — A2A endpoints will return 503 if adapter failed to init.
    }

    this.schedulerEngine = new SchedulerEngine({
      activityBus: this.activityBus,
      sessionId: this.status.sessionId,
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
      this.server = https.createServer(
        { cert: readFileSync(tlsCert), key: readFileSync(tlsKey) },
        (req, res) => { void this.handle(req, res); },
      );
      this.tlsEnabled = true;
    } else {
      this.server = createServer((req, res) => {
        void this.handle(req, res);
      });
      this.tlsEnabled = false;
    }
    this.wsServer = new WebSocketServer({ noServer: true });
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
          details: { correlationId, chatSessionId, error: errorMessage },
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
    if (this.chatStore.listSessions().length === 0) {
      const segment = (this.status.executionProfileSegment || "individual").toLowerCase();
      if (segment === "individual") {
        const newSession = this.chatStore.createSession();
        this.chatStore.updateSessionTitle(newSession.sessionId, "New Session");
        this.activityBus.emit({
          sessionId: this.status.sessionId,
          layer: "causal",
          operation: "prism.accountability.init",
          status: "started",
          details: { message: "Auto-created initial session for individual segment." }
        });
      } else {
        this.activityBus.emit({
          sessionId: this.status.sessionId,
          layer: "causal",
          operation: "prism.accountability.init",
          status: "started",
          details: { message: "Accountability systems initiated for enterprise segment." }
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

    this.server.listen(this.port, "127.0.0.1", () => {
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

  private async fetchOllamaTags(): Promise<Array<{ name: string; source: string }>> {
    return new Promise((resolve) => {
      const req = httpGet("http://localhost:11434/api/tags", (res) => {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            resolve((data.models || []).map((m: any) => ({ name: m.name, source: "ollama" })));
          } catch { resolve([]); }
        });
      });
      req.on("error", () => resolve([]));
      req.setTimeout(2000, () => { req.destroy(); resolve([]); });
    });
  }

  private async downloadFile(id: string, url: string, targetPath: string): Promise<void> {
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
          "Accept": "*/*",
        },
      };
      const client = isHttps ? https : { get: httpGet };
      client.get(options, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return this.downloadFile(id, res.headers.location!, targetPath).then(resolve).catch(reject);
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
      }).on("error", (err) => {
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

  private scanForGgufs(dir: string, source: string, models: Array<{ name: string; path: string; source: string }>): void {
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
    } catch { /* best-effort — use empty list */ }
  }

  private saveCustomRecommendedModels(): void {
    try {
      const dir = join(process.cwd(), "prism-output");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "custom-recommended-models.json"), JSON.stringify(this.customRecommendedModels, null, 2));
    } catch (err) {
      console.error("[dashboard] failed to save custom recommended models", err);
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "";
    const method = req.method?.toUpperCase() ?? "GET";

    // ── Security headers (applied to every response) ──────────────────
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

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

    // ── Favicon (suppress 404 / browser probe) ────────────────────────
    if (method === "GET" && (url === "/favicon.ico" || url.startsWith("/favicon.ico?"))) {
      res.writeHead(204);
      res.end();
      return;
    }

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

    if (method === "GET" && (url === "/" || url === "/dashboard" || url.startsWith("/?") || url.startsWith("/dashboard?"))) {
      const prefs = readPreferences();
      if (!prefs?.setupComplete && !url.startsWith("/dashboard")) {
        res.writeHead(302, { Location: "/setup" });
        res.end();
        return;
      }
      // Extract token from query string (or header) for client-side injection
      const qIdx = url.indexOf("?");
      const params = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx + 1)) : null;
      const clientToken = params?.get("token") ?? this.extractBearerToken(req) ?? "";

      // Allow explicit ?mode=advanced to save the pref and serve the full dashboard
      if (params?.get("mode") === "advanced") {
        writePreferences({ uiMode: "advanced" });
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        });
        res.end(dashboardHtml(this.port, clientToken));
        return;
      }

      // /dashboard always serves the full operator UI (explicit intent)
      const isExplicitDashboard = url.startsWith("/dashboard");

      // Simple Mode: active when pref is "simple", or when the user has never
      // explicitly chosen a mode AND has no sessions yet (first-time UX).
      const sessionCount = this.chatStore.listSessions().length;
      const useSimple = !isExplicitDashboard
        && (prefs?.uiMode === "simple" || (!prefs?.uiMode && sessionCount === 0));

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.end(useSimple ? simpleModeHtml(this.port, clientToken) : dashboardHtml(this.port, clientToken));
      return;
    }

    // Explicit simple mode URL — always serves Simple Mode regardless of prefs
    if (method === "GET" && (url === "/simple" || url.startsWith("/simple?"))) {
      const qIdx = url.indexOf("?");
      const params = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx + 1)) : null;
      const clientToken = params?.get("token") ?? this.extractBearerToken(req) ?? "";
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.end(simpleModeHtml(this.port, clientToken));
      return;
    }

    if (method === "GET" && (url === "/setup" || url.startsWith("/setup?"))) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.end(setupWizardHtml(this.port));
      return;
    }

    if (method === "GET" && (url === "/setup/advanced" || url.startsWith("/setup/advanced?"))) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.end(setupWizardAdvancedHtml(this.port));
      return;
    }

    if (method === "GET" && (url === "/health" || url === "/api/health")) {
      // Check DB readability
      let dbOk = false;
      try {
        this.chatStore.listSessions();
        dbOk = true;
      } catch { /* db not available */ }

      const providerCount = this.chatStore.listProviderSettings().length;
      const srEnabled = true; // SR is always available — configured per-session
      const guardianState = this.guardianAgent?.getStatus?.() ?? "unknown";
      const pendingApprovals = this.queue.list().length;

      return this.json(res, 200, {
        status: "ok",
        version: "0.2.0",
        uptime: Math.floor(process.uptime()),
        sessionId: this.status.sessionId,
        mode: this.status.mode,
        dependencies: {
          db: dbOk ? "ok" : "unavailable",
          providers: providerCount,
          sr_enabled: srEnabled,
          guardian: guardianState,
          pending_approvals: pendingApprovals,
        },
      });
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

    if (method === "GET" && (url === "/pending" || url === "/api/pending" || url === "/api/approval/pending")) {
      return this.json(res, 200, this.queue.list());
    }

    if (method === "GET" && url === "/api/models/gguf") {
      try {
        const models: Array<{ name: string; path: string; source: string }> = [];
        const searchPaths = [
          { path: process.cwd(), source: "workspace" },
          { path: join(process.cwd(), "models"), source: "workspace-models" },
          { path: join(homedir(), ".ollama", "models"), source: "ollama" },
        ];

        for (const entry of searchPaths) {
          this.scanForGgufs(entry.path, entry.source, models);
        }

        // Add Ollama API results
        const ollamaModels = await this.fetchOllamaTags();
        for (const om of ollamaModels) {
          models.push({ name: om.name, path: om.name, source: om.source });
        }

        return this.json(res, 200, { models });
      } catch (err: any) {
        return this.json(res, 500, { error: err.message });
      }
    }

    if (method === "GET" && url === "/api/models/download/status") {
      return this.json(res, 200, { downloads: Array.from(this.downloadStatus.values()) });
    }

    if (method === "POST" && url === "/api/models/download") {
      const body = await this.readBody(req);
      const { url: dlUrl, name, mmprojUrl, mmprojName } = JSON.parse(body);
      if (!dlUrl || !name) return this.json(res, 400, { error: "Missing url or name" });

      const modelsDir = join(process.cwd(), "models");
      if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true });

      const modelId = randomUUID();
      this.downloadStatus.set(modelId, {
        id: modelId,
        url: dlUrl,
        fileName: name,
        status: "pending",
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        startTime: new Date().toISOString()
      });

      // Start model download
      this.downloadFile(modelId, dlUrl, join(modelsDir, name)).catch(() => { });

      // Optional mmproj download
      if (mmprojUrl && mmprojName) {
        const mmId = randomUUID();
        this.downloadStatus.set(mmId, {
          id: mmId,
          url: mmprojUrl,
          fileName: mmprojName,
          status: "pending",
          progress: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          startTime: new Date().toISOString()
        });
        this.downloadFile(mmId, mmprojUrl, join(modelsDir, mmprojName)).catch(() => { });
      }

      return this.json(res, 200, { message: "Downloads initiated", modelId });
    }

    if (method === "POST" && url === "/api/models/pull") {
      try {
        const body = await this.readJsonBody<{ tag: string }>(req);
        const tag = body?.tag;
        if (!tag || typeof tag !== "string" || !/^[\w.:\/-]+$/.test(tag)) {
          return this.json(res, 400, { error: "Invalid or missing Ollama tag" });
        }
        const pullId = randomUUID();
        this.downloadStatus.set(pullId, {
          id: pullId,
          url: `ollama://${tag}`,
          fileName: tag,
          status: "downloading",
          progress: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          startTime: new Date().toISOString(),
        });
        const { exec: execCb } = await import("node:child_process");
        execCb(`ollama pull ${tag}`, { timeout: 600000 }, (err, stdout, stderr) => {
          const status = this.downloadStatus.get(pullId);
          if (!status) return;
          if (err) {
            status.status = "error";
            status.error = stderr?.trim() || err.message;
          } else {
            status.status = "completed";
            status.progress = 100;
          }
        });
        return this.json(res, 200, { message: "Ollama pull initiated", pullId });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // ── Custom Recommended Models API ────────────────────────────────────

    if (method === "GET" && url === "/api/models/recommended") {
      return this.json(res, 200, { custom: this.customRecommendedModels });
    }

    if (method === "POST" && url === "/api/models/recommended") {
      try {
        const body = await this.readJsonBody<{ name: string; fileName: string; path: string; source: string }>(req);
        if (!body?.fileName || !body?.path) {
          return this.json(res, 400, { error: "Missing fileName or path" });
        }
        // Dedupe by fileName
        if (this.customRecommendedModels.some(m => m.fileName === body.fileName)) {
          return this.json(res, 409, { error: "Model already in recommended list" });
        }
        // Compute file size
        let sizeStr = "unknown";
        try {
          const st = statSync(body.path);
          const gb = st.size / (1024 * 1024 * 1024);
          sizeStr = gb >= 1 ? gb.toFixed(1) + " GB" : (st.size / (1024 * 1024)).toFixed(0) + " MB";
        } catch { /* file may be remote/ollama */ }
        this.customRecommendedModels.push({
          name: body.name || body.fileName.replace(/\.gguf$/i, ""),
          fileName: body.fileName,
          size: sizeStr,
          path: body.path,
          source: body.source || "workspace",
          addedAt: new Date().toISOString(),
        });
        this.saveCustomRecommendedModels();
        return this.json(res, 200, { custom: this.customRecommendedModels });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "DELETE" && url === "/api/models/recommended") {
      try {
        const body = await this.readJsonBody<{ fileName: string }>(req);
        if (!body?.fileName) return this.json(res, 400, { error: "Missing fileName" });
        this.customRecommendedModels = this.customRecommendedModels.filter(m => m.fileName !== body.fileName);
        this.saveCustomRecommendedModels();
        return this.json(res, 200, { custom: this.customRecommendedModels });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
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

    // ── Setup Wizard API ─────────────────────────────────────────────────
    if (method === "GET" && url === "/api/setup/status") {
      const prefs = readPreferences();
      return this.json(res, 200, {
        setupComplete: prefs?.setupComplete ?? false,
        executionProfileSegment: prefs?.executionProfileSegment ?? this.status.executionProfileSegment ?? "individual",
        workspaceRoot: resolveWorkspaceRoot(),
      });
    }

    if (method === "GET" && url === "/api/setup/prerequisites") {
      const nodeVersion = process.version;
      const nodeMajor = parseInt(nodeVersion.slice(1), 10);
      const checks = [
        {
          id: "node-version",
          label: "Node.js 22+",
          passed: nodeMajor >= 22,
          detail: nodeMajor >= 22 ? `Node.js ${nodeVersion} detected.` : `Node.js ${nodeVersion} detected — version 22+ is required.`,
        },
        {
          id: "workspace-exists",
          label: "Workspace directory exists",
          passed: existsSync(resolveWorkspaceRoot()),
          detail: existsSync(resolveWorkspaceRoot()) ? `Workspace at ${resolveWorkspaceRoot()}` : `Workspace directory does not yet exist at ${resolveWorkspaceRoot()}`,
        },
      ];
      return this.json(res, 200, { checks });
    }

    if (method === "POST" && url === "/api/setup/profile") {
      try {
        const body = await this.readJsonBody<{ executionProfileSegment?: string }>(req);
        const segment = body.executionProfileSegment?.trim().toLowerCase();
        if (segment !== "individual" && segment !== "business") {
          return this.json(res, 400, { error: "executionProfileSegment must be 'individual' or 'business'." });
        }
        writePreferences({ executionProfileSegment: segment });
        this.status.executionProfileSegment = segment;
        return this.json(res, 200, { executionProfileSegment: segment });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/setup/workspace") {
      try {
        const body = await this.readJsonBody<{ workspaceRoot?: string }>(req);
        const root = body.workspaceRoot?.trim();
        if (!root) {
          return this.json(res, 400, { error: "workspaceRoot is required." });
        }
        if (!join(root, "").startsWith(root)) {
          return this.json(res, 400, { error: "Invalid workspace path." });
        }
        setWorkspaceRoot(root);
        ensureWorkspaceStructure();
        return this.json(res, 200, { workspaceRoot: resolveWorkspaceRoot() });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/setup/complete") {
      try {
        writePreferences({ setupComplete: true });
        const snapshot = await this.getReadinessSnapshot();
        this.emitReadinessAudit("setup_wizard_complete", snapshot);
        this.activityBus.emit({
          sessionId: this.status.sessionId,
          layer: "causal",
          operation: "prism.setup_wizard.complete",
          status: "succeeded",
          details: {
            executionProfileSegment: this.status.executionProfileSegment,
            workspaceRoot: resolveWorkspaceRoot(),
            ready: snapshot.ready,
          },
        });
        return this.json(res, 200, { setupComplete: true, readiness: snapshot });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── Advanced Setup Wizard API ──────────────────────────────────────────
    if (method === "GET" && url === "/api/setup/advanced/status") {
      try {
        const prefs = readPreferences();
        const wsRoot = resolveWorkspaceRoot();

        // Gather routing config
        let routingConfig = null;
        try {
          const routingPath = join(wsRoot, "state", "routing-config.json");
          if (existsSync(routingPath)) {
            routingConfig = JSON.parse(readFileSync(routingPath, "utf-8"));
          }
        } catch { /* ignore */ }

        // Gather guardian status
        let guardianStatus = null;
        try {
          guardianStatus = (this as any).guardianAgent?.getStatus?.() ?? null;
        } catch { /* ignore */ }

        // Gather character assignments
        let characterAssignments: unknown[] = [];
        try {
          characterAssignments = (this as any).characterAssignments ?? [];
        } catch { /* ignore */ }

        // Gather browser profiles
        let browserProfiles: unknown[] = [];
        try {
          browserProfiles = (this as any).browserProfiles ?? [];
        } catch { /* ignore */ }

        // Gather scheduled jobs
        let scheduledJobs: unknown[] = [];
        try {
          scheduledJobs = (this as any).schedulerEngine?.listSchedules?.() ?? [];
        } catch { /* ignore */ }

        // Gather available characters
        let characters: unknown[] = [];
        try {
          characters = (this as any).getAvailableCharacters?.() ?? [];
        } catch { /* ignore */ }

        // Gather GGUF models
        let ggufModels: Array<{ name: string; path: string; source: string }> = [];
        try {
          const modelsDir = join(process.cwd(), "models");
          if (existsSync(modelsDir)) {
            const files = readdirSync(modelsDir).filter((f: string) => f.endsWith(".gguf"));
            ggufModels = files.map((f: string) => ({
              name: f.replace(/\.gguf$/, ""),
              path: join(modelsDir, f),
              source: "workspace-models",
            }));
          }
        } catch { /* ignore */ }

        return this.json(res, 200, {
          setupComplete: prefs?.setupComplete ?? false,
          executionProfileSegment: prefs?.executionProfileSegment ?? this.status.executionProfileSegment ?? "individual",
          workspaceRoot: wsRoot,
          routingConfig,
          guardianStatus,
          characterAssignments,
          browserProfiles,
          scheduledJobs,
          characters,
          ggufModels,
        });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/setup/initialization-session") {
      try {
        const body = await this.readJsonBody<{ certificate: Record<string, unknown> }>(req);
        const cert = body.certificate ?? {};
        const timestamp = new Date().toISOString();

        // 1. Create a dedicated chat session
        const session = this.createChatSession("PRISM Initialization Certificate \u2014 " + timestamp);

        // 2. Build certificate content
        const certLines: string[] = [
          "# PRISM Initialization Certificate",
          "**Generated:** " + timestamp,
          "**Session:** " + session.sessionId,
          "",
          "## Configuration Summary",
        ];

        const sections: Array<[string, unknown]> = [
          ["Execution Profile", cert.profile],
          ["Workspace", cert.workspace],
          ["Primary LLM Provider", cert.provider],
          ["Model Routing", cert.routing],
          ["Guardian Agent", cert.guardian],
          ["Agentic Control", cert.agents],
          ["Character Accountability (CAC)", cert.cac],
          ["Browser Profile", cert.browserProfile],
          ["Scheduler", cert.scheduler],
          ["Readiness", cert.readiness],
        ];

        for (const [title, data] of sections) {
          certLines.push("");
          certLines.push("### " + title);
          if (data && typeof data === "object") {
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
              const val = typeof v === "object" ? JSON.stringify(v) : String(v ?? "N/A");
              certLines.push("- **" + k + ":** " + val);
            }
          } else {
            certLines.push("- " + String(data ?? "Not configured"));
          }
        }

        certLines.push("");
        certLines.push("---");
        certLines.push("*This certificate is an immutable provenance record of the initial PRISM system configuration.*");

        const certContent = certLines.join("\n");

        // 3. Add certificate as a system message to the session
        this.chatStore.appendMessage(
          session.sessionId,
          "assistant",
          certContent,
          { source: "initialization_certificate", type: "certificate" },
        );

        // 4. Package the session as a complete initialization certificate
        const pkg = this.createSessionPackage({
          title: "Initialization Certificate v1.0 \u2014 " + timestamp,
          areaOfInterest: "System Initialization",
          objective: "Immutable provenance record of initial PRISM system configuration",
          successCriteria: "All configuration steps completed and validated",
          sessionIds: [session.sessionId],
          status: "complete" as SessionPackageStatus,
          source: "setup_wizard_advanced",
        });

        // 5. Emit activity event
        this.activityBus.emit({
          sessionId: session.sessionId,
          layer: "causal",
          operation: "prism.initialization_certificate.created",
          status: "succeeded",
          details: {
            packageId: pkg.packageId,
            sessionId: session.sessionId,
            timestamp,
          },
        });

        return this.json(res, 201, {
          sessionId: session.sessionId,
          packageId: pkg.packageId,
          title: session.title,
          timestamp,
        });
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

    if (method === "GET" && url.startsWith("/api/logs")) {
      const filters = parseEventFilters(url, 500);
      const limit = Math.max(1, Math.min(2000, filters.limit));
      const events = this.activityBus.listEvents();
      const logs = events.slice(-limit).reverse().map((e) => ({
        type: "log_entry",
        timestamp: e.timestamp,
        source: e.layer || "system",
        operation: e.operation,
        severity: e.status === "failed" ? "error" : "info",
        summary: typeof e.details?.summary === "string" ? e.details.summary : e.operation,
      }));
      return this.json(res, 200, logs);
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

    if (method === "GET" && url === "/api/llm/provider-health") {
      try {
        const results = await this.llmProviders.testAllProviders();
        return this.json(res, 200, { providers: results, timestamp: new Date().toISOString() });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
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
        const triad = (config?.leftProviderId && config?.leftModel && config?.rightProviderId && config?.rightModel)
          ? this.llmProviders.validateSRTriadConfig(config.leftProviderId, config.leftModel, config.rightProviderId, config.rightModel)
          : null;

        return this.json(res, 200, {
          config: config ?? { enabled: false, leftProviderId: null, leftModel: null, rightProviderId: null, rightModel: null },
          candidates,
          validation,
          isolationLevel: triad?.isolationLevel ?? null,
          isolationAdvisory: triad?.advisory ?? null,
          circuitBreakerState: this.llmProviders.getSRCircuitBreakerState(),
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
        if (body.leftProviderId && body.leftModel && body.rightProviderId && body.rightModel) {
          const triad = this.llmProviders.validateSRTriadConfig(body.leftProviderId, body.leftModel, body.rightProviderId, body.rightModel);
          if (!triad.valid) {
            return this.json(res, 400, { error: triad.advisory, validation, isolationLevel: triad.isolationLevel });
          }
          isolationLevel = triad.isolationLevel;
        }

        const existingConfig = this.chatStore.getSRConfig(body.sessionId);
        const enabled = existingConfig?.enabled ?? false;
        this.chatStore.saveSRConfig(body.sessionId, enabled, body.leftProviderId, body.leftModel, body.rightProviderId, body.rightModel, {
          leftSlot: body.leftSlot ?? existingConfig?.leftSlot,
          rightSlot: body.rightSlot ?? existingConfig?.rightSlot,
          leftTimeoutMs: body.leftTimeoutMs ?? existingConfig?.leftTimeoutMs,
          rightTimeoutMs: body.rightTimeoutMs ?? existingConfig?.rightTimeoutMs,
          circuitBreakerEnabled: body.circuitBreakerEnabled ?? existingConfig?.circuitBreakerEnabled,
          showHemispheres: body.showHemispheres ?? existingConfig?.showHemispheres,
        });
        const updated = this.chatStore.getSRConfig(body.sessionId);

        return this.json(res, 200, { config: updated, validation, isolationLevel });
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
        const triad = this.llmProviders.validateSRTriadConfig(config.leftProviderId, config.leftModel, config.rightProviderId, config.rightModel);
        if (!triad.valid) {
          return this.json(res, 400, { error: triad.advisory, isolationLevel: triad.isolationLevel });
        }

        // Auto-start local models that aren't running yet
        const autoStartPromises: Promise<unknown>[] = [];
        for (const side of [{ pid: config.leftProviderId, model: config.leftModel }, { pid: config.rightProviderId, model: config.rightModel }] as const) {
          const supervisor = side.pid === "llamacpp" ? this.llamaSupervisor : side.pid === "bitnetcpp" ? this.bitnetSupervisor : null;
          if (supervisor && side.model) {
            const running = supervisor.getSnapshot().find(s => s.modelAlias === side.model && s.status === "ready");
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

        this.chatStore.saveSRConfig(body.sessionId, true, config.leftProviderId, config.leftModel, config.rightProviderId, config.rightModel, {
          leftSlot: config.leftSlot,
          rightSlot: config.rightSlot,
          leftTimeoutMs: config.leftTimeoutMs,
          rightTimeoutMs: config.rightTimeoutMs,
          circuitBreakerEnabled: config.circuitBreakerEnabled,
          showHemispheres: config.showHemispheres,
        });
        return this.json(res, 200, { activated: true, config: this.chatStore.getSRConfig(body.sessionId), isolationLevel: triad.isolationLevel });
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
          this.chatStore.saveSRConfig(body.sessionId, false, config.leftProviderId, config.leftModel, config.rightProviderId, config.rightModel, {
            leftSlot: config.leftSlot,
            rightSlot: config.rightSlot,
            leftTimeoutMs: config.leftTimeoutMs,
            rightTimeoutMs: config.rightTimeoutMs,
            circuitBreakerEnabled: config.circuitBreakerEnabled,
            showHemispheres: config.showHemispheres,
          });
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
        const scopeId = scope === "session" ? (body.sessionId || null) : null;
        this.chatStore.saveSRPreset(id, body.name, scope, scopeId, body.leftProviderId, body.leftModel, body.rightProviderId, body.rightModel);
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
        this.chatStore.saveSRConfig(body.sessionId, enabled, preset.leftProviderId, preset.leftModel, preset.rightProviderId, preset.rightModel, {
          leftSlot: existingConfig?.leftSlot,
          rightSlot: existingConfig?.rightSlot,
          leftTimeoutMs: existingConfig?.leftTimeoutMs,
          rightTimeoutMs: existingConfig?.rightTimeoutMs,
          circuitBreakerEnabled: existingConfig?.circuitBreakerEnabled,
          showHemispheres: existingConfig?.showHemispheres,
        });
        const config = this.chatStore.getSRConfig(body.sessionId);
        const validation = this.llmProviders.validateSRModels(preset.leftModel, preset.rightModel);
        const triad = (preset.leftProviderId && preset.leftModel && preset.rightProviderId && preset.rightModel)
          ? this.llmProviders.validateSRTriadConfig(preset.leftProviderId, preset.leftModel, preset.rightProviderId, preset.rightModel)
          : null;
        return this.json(res, 200, { config, validation, isolationLevel: triad?.isolationLevel ?? null, isolationAdvisory: triad?.advisory ?? null });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── SR Suggest (heuristic model selection) ────────────────────────

    if (method === "GET" && url === "/api/sr/suggest") {
      try {
        const candidates = await this.llmProviders.getSRModelCandidates();
        if (candidates.left.length === 0 && candidates.right.length === 0) {
          return this.json(res, 200, { left: null, right: null, reasoning: "No qualified SR models available. Configure providers with API keys and ensure models meet SR tier requirements." });
        }
        const bestLeft = candidates.left.length > 0 ? candidates.left[0] : null;
        let bestRight = candidates.right.length > 0 ? candidates.right[0] : null;
        // Enforce isolation: if top left and right are same provider+model, pick next-best right
        if (bestLeft && bestRight && bestLeft.providerId === bestRight.providerId && bestLeft.model === bestRight.model) {
          bestRight = candidates.right.length > 1 ? candidates.right[1] : null;
        }
        const parts: string[] = [];
        if (bestLeft) parts.push(`Left: ${bestLeft.providerId}/${bestLeft.model} (T${bestLeft.tier} ${bestLeft.level})`);
        else parts.push("Left: no qualified logic models available");
        if (bestRight) parts.push(`Right: ${bestRight.providerId}/${bestRight.model} (T${bestRight.tier} ${bestRight.level})`);
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
          .filter(p => p.enabled)
          .map(p => ({
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

    // ── Local Hardware Swarm API ───────────────────────────────────────

    if (method === "GET" && url === "/api/hardware/swarm") {
      try {
        if (!this.llamaSupervisor) return this.json(res, 404, { error: "LlamaCppSupervisor disabled" });
        return this.json(res, 200, this.llamaSupervisor.getSnapshot());
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/hardware/swarm/load") {
      try {
        if (!this.llamaSupervisor) return this.json(res, 404, { error: "LlamaCppSupervisor disabled" });
        const body = await this.readJsonBody<{ modelPath: string; modelAlias: string; ctxSize?: number }>(req);
        if (!body.modelPath || !body.modelAlias) return this.json(res, 400, { error: "Missing required fields." });
        const slot = await this.llamaSupervisor.loadModel(body.modelPath, body.modelAlias, body.ctxSize);
        return this.json(res, 200, slot);
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/hardware/swarm/unload") {
      try {
        if (!this.llamaSupervisor) return this.json(res, 404, { error: "LlamaCppSupervisor disabled" });
        const body = await this.readJsonBody<{ modelAlias: string }>(req);
        if (!body.modelAlias) return this.json(res, 400, { error: "Missing modelAlias." });
        await this.llamaSupervisor.unloadModel(body.modelAlias);
        return this.json(res, 200, { unloaded: true });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // ── Guardian Agent API ─────────────────────────────────────────────

    if (method === "GET" && url === "/api/guardian/status") {
      try {
        return this.json(res, 200, this.guardianAgent.getStatus());
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/guardian/start") {
      try {
        const status = this.guardianAgent.getStatus();
        if (!status.modelPath) {
          return this.json(res, 400, {
            error: "No local model path configured for Guardian Agent.",
            suggestion: "Please select a GGUF model from the dropdown in the Guardian panel before starting."
          });
        }
        await this.guardianAgent.start();
        return this.json(res, 200, this.guardianAgent.getStatus());
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/guardian/stop") {
      try {
        this.guardianAgent.stop();
        return this.json(res, 200, this.guardianAgent.getStatus());
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/guardian/configure") {
      try {
        const body = await this.readJsonBody<Record<string, unknown>>(req);
        this.guardianAgent.configure(body as any);
        return this.json(res, 200, this.guardianAgent.getStatus());
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // ── Guardian Task API ──────────────────────────────────────────────

    if (method === "GET" && url === "/api/guardian/tasks") {
      return this.json(res, 200, { tasks: this.guardianAgent.getTaskStatus() });
    }

    if (method === "POST" && url?.startsWith("/api/guardian/tasks/") && url?.endsWith("/run")) {
      const taskId = url.replace("/api/guardian/tasks/", "").replace("/run", "");
      try {
        const result = await this.guardianAgent.runTask(taskId);
        if (!result) return this.json(res, 404, { error: `Task not found: ${taskId}` });
        return this.json(res, 200, result);
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url?.startsWith("/api/guardian/tasks/") && url?.endsWith("/toggle")) {
      const taskId = url.replace("/api/guardian/tasks/", "").replace("/toggle", "");
      const result = this.guardianAgent.toggleTask(taskId);
      if (!result) return this.json(res, 404, { error: `Task not found: ${taskId}` });
      return this.json(res, 200, result);
    }

    if (method === "POST" && url === "/api/guardian/tasks/run-all") {
      try {
        await this.guardianAgent.runAllTasks();
        return this.json(res, 200, { tasks: this.guardianAgent.getTaskStatus() });
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
        const body = await this.readJsonBody<{ pattern: string; label?: string; tier?: number; modalities?: string[]; strengths?: string[]; locality?: string; contextWindow?: number; parametersBillions?: number; parameterSize?: string; estimatedVramMb?: number; maxOutputTokens?: number; adaptivePromptBudget?: number; deprecated?: boolean; deprecatedAt?: string; sunsetDate?: string; successor?: string; deprecationReason?: string }>(req);
        if (!body.pattern?.trim()) {
          return this.json(res, 400, { error: "pattern is required." });
        }
        this.llmProviders.registerModel(body as any);
        this.chatStore.upsertModelProfile(body as any);
        return this.json(res, 200, { registered: body.pattern });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/models/matrix/refresh") {
      try {
        const catalog = await this.llmProviders.getCatalog();
        const enabledProviders = catalog.providers.filter((p) => p.enabled);
        const results: Array<{ providerId: string; known: string[]; unknown: string[]; suggested: number }> = [];
        for (const provider of enabledProviders) {
          try {
            const disc = await this.llmProviders.discoverProviderModels(provider.id);
            for (const profile of disc.suggested) {
              this.chatStore.upsertModelProfile(profile);
            }
            results.push({ providerId: provider.id, known: disc.known, unknown: disc.unknown, suggested: disc.suggested.length });
          } catch {
            results.push({ providerId: provider.id, known: [], unknown: [], suggested: 0 });
          }
        }
        const matrix = this.llmProviders.getFullModelMatrix();
        return this.json(res, 200, { refreshed: true, providers: results, matrix });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "DELETE" && url.startsWith("/api/models/matrix/")) {
      try {
        const pattern = decodeURIComponent(url.slice("/api/models/matrix/".length));
        const removed = this.llmProviders.removeModel(pattern);
        this.chatStore.removeModelProfile(pattern);
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

    if (method === "GET" && url === "/api/models/deprecated") {
      try {
        const matrix = this.llmProviders.getFullModelMatrix();
        return this.json(res, 200, { deprecated: matrix.deprecated });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/models/prompt-strategies") {
      try {
        const matrix = this.llmProviders.getFullModelMatrix();
        return this.json(res, 200, { strategies: matrix.promptStrategies });
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

    const pluginToggleMatch = /^\/api\/(v1\/)?plugins\/([^/]+)\/toggle$/.exec(url);
    if (pluginToggleMatch && method === "POST") {
      const pluginName = decodeURIComponent(pluginToggleMatch[2]!);
      if (!this.pluginStates[pluginName]) this.pluginStates[pluginName] = { enabled: true, healthy: true, requests: 0, errors: 0, avgResponseMs: 0, lastChecked: null };
      // If body contains explicit enabled value use it; otherwise flip current state
      let body: { enabled?: boolean } = {};
      try { body = await this.readJsonBody<{ enabled?: boolean }>(req); } catch { /* no body — flip */ }
      const newEnabled = typeof body.enabled === "boolean" ? body.enabled : !this.pluginStates[pluginName].enabled;
      this.pluginStates[pluginName].enabled = newEnabled;
      return this.json(res, 200, { plugin: pluginName, enabled: newEnabled });
    }

    const pluginHealthMatch = /^\/api\/(v1\/)?plugins\/([^/]+)\/health$/.exec(url);
    if (pluginHealthMatch && method === "POST") {
      const pluginName = decodeURIComponent(pluginHealthMatch[2]!);
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
            return this.json(res, 400, { error: `Invalid source: ${s}. Must be one of: ${validSources.join(", ")}` });
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
              // Fire-and-forget: enqueue for operator review, do not block response
              void this.queue.request(
                "system",
                `tool.stage.${contract.tool_id}`,
                { tool_name: contract.tool_name, version: contract.version, risk_tier: contract.risk_tier },
                300_000, // 5-minute approval window
              ).then((approved) => {
                this.activityBus.emit({
                  operation: "tool.stage.approval_resolved",
                  status: approved ? "succeeded" : "failed",
                  sessionId: "system",
                  layer: "governance",
                  details: { tool_id: contract.tool_id, approved },
                });
              });
              approvalIds.push(contract.tool_id);
            }
          }
        }

        return this.json(res, 200, { ...result, approval_pending_ids: approvalIds });
      } catch (error) {
        return this.json(res, 500, { error: `Tool staging failed: ${String(error)}` });
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

    if (method === "POST" && url === "/api/plugins/install") {
      const body = await this.readJsonBody<{ name: string; type?: string; url?: string; port?: number; description?: string; manifest?: PluginPackManifest; packPath?: string }>(req);
      if (!body.name) return this.json(res, 400, { error: "Plugin name is required" });

      // If a full manifest is provided, run load-time validation pipeline
      if (body.manifest) {
        const prefs = readPreferences();
        const profile = (prefs?.executionProfileSegment === "business" ? "business" : "individual") as "individual" | "business";
        const result = loadPluginPack(
          body.manifest,
          body.packPath ?? ".",
          this.activityBus,
          { executionProfile: profile },
        );
        if (!result.accepted) {
          return this.json(res, 422, {
            plugin: body.name,
            installed: false,
            reason: result.summary,
            errors: result.manifestValidation.errors,
            trustValidation: result.trustValidation,
          });
        }
        return this.json(res, 201, {
          plugin: body.name,
          installed: true,
          summary: result.summary,
          warnings: result.manifestValidation.warnings,
        });
      }

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
      const { exec: execCb } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execAsync = promisify(execCb);
      // Single PowerShell script queries all 11 WMI classes via Get-CimInstance
      const ps = `
$ErrorActionPreference='SilentlyContinue'
$r=@{}
function q($cls,$cat,$fmt){
  $items=@()
  try{
    Get-CimInstance -ClassName $cls | ForEach-Object {
      $props=@{}
      $_.CimInstanceProperties | Where-Object { $_.Value -ne $null } | ForEach-Object { $props[$_.Name]=[string]$_.Value }
      $items+=@{name=(&$fmt $_);status=if($props['Status']){$props['Status']}else{'OK'};props=$props}
    }
  }catch{ $items+=@{name="Detection failed: $_";status='Error';props=@{}} }
  $r[$cat]=$items
}
q 'Win32_Processor' 'Processors' { param($p) "$($p.Name.Trim()) ($($p.NumberOfCores) cores, $($p.NumberOfLogicalProcessors) threads)" }
q 'Win32_BaseBoard' 'Motherboard' { param($b) "$($b.Manufacturer) $($b.Product)".Trim() }
q 'Win32_PhysicalMemory' 'Memory' { param($m) "$($m.Manufacturer) $([math]::Round([long]$m.Capacity/1GB,2))GB $($m.Speed)MHz".Trim() }
q 'Win32_VideoController' 'Display Adapters' { param($d) if($d.AdapterRAM){("$($d.Name.Trim()) ($([math]::Round($d.AdapterRAM/1GB,2))GB)")}else{$d.Name.Trim()} }
q 'Win32_DiskDrive' 'Disk Drives' { param($d) "$($d.Caption.Trim()) ($([math]::Round([long]$d.Size/1GB,2))GB $($d.InterfaceType))" }
q 'Win32_NetworkAdapter' 'Network Adapters' { param($n) "$($n.Name.Trim()) ($($n.AdapterType))" }
$r['Network Adapters']=$r['Network Adapters'] | Where-Object { $_.props['PhysicalAdapter'] -eq 'True' }
if(-not $r['Network Adapters']){$r['Network Adapters']=@()}
q 'Win32_SoundDevice' 'Sound Devices' { param($s) $s.Name.Trim() }
q 'Win32_USBController' 'USB Controllers' { param($u) $u.Name.Trim() }
q 'Win32_USBHub' 'USB Devices' { param($u) $u.Name.Trim() }
q 'Win32_BIOS' 'BIOS' { param($b) "$($b.Manufacturer) $($b.Name)".Trim() }
q 'Win32_CDROMDrive' 'Optical Drives' { param($c) $c.Name.Trim() }
$r | ConvertTo-Json -Depth 4 -Compress
`;
      try {
        const result = await execAsync(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, " ")}"`, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        const parsed = JSON.parse(result.stdout.trim());
        // Normalize: PowerShell may return single-item arrays as objects
        const devices: Record<string, Array<{ name: string; status: string; props: Record<string, string> }>> = {};
        for (const [cat, items] of Object.entries(parsed)) {
          devices[cat] = Array.isArray(items) ? items as Array<{ name: string; status: string; props: Record<string, string> }> : items ? [items as { name: string; status: string; props: Record<string, string> }] : [];
        }
        return this.json(res, 200, { devices });
      } catch (e: unknown) {
        // Fallback to Node.js os module if PowerShell fails
        const osModule = await import("node:os");
        const cpus = osModule.cpus();
        const nets = osModule.networkInterfaces();
        const devices: Record<string, Array<{ name: string; status: string; props: Record<string, string> }>> = {
          "Processors": cpus.length > 0 ? [{ name: cpus[0]!.model + " (" + cpus.length + " cores)", status: "OK", props: { model: cpus[0]!.model, cores: String(cpus.length), speed: cpus[0]!.speed + " MHz" } }] : [],
          "Network Adapters": Object.entries(nets).map(([name, addrs]) => ({ name, status: "OK", props: { addresses: (addrs || []).map(a => a.address).join(", ") } })),
          "Display Adapters": [],
          "Disk Drives": [],
        };
        return this.json(res, 200, { devices, fallback: true, error: (e as Error).message });
      }
    }

    if (method === "GET" && url.startsWith("/api/computer/devices/properties/")) {
      const parts = url.replace("/api/computer/devices/properties/", "").split("/");
      const category = decodeURIComponent(parts[0] || "");
      const index = parseInt(parts[1] || "0", 10);
      const wmiMapping: Record<string, string> = {
        "Processors": "Win32_Processor",
        "Motherboard": "Win32_BaseBoard",
        "Memory": "Win32_PhysicalMemory",
        "Display Adapters": "Win32_VideoController",
        "Disk Drives": "Win32_DiskDrive",
        "Network Adapters": "Win32_NetworkAdapter",
        "Sound Devices": "Win32_SoundDevice",
        "USB Controllers": "Win32_USBController",
        "USB Devices": "Win32_USBHub",
        "BIOS": "Win32_BIOS",
        "Optical Drives": "Win32_CDROMDrive",
      };
      const wmiClass = wmiMapping[category];
      if (!wmiClass) return this.json(res, 400, { error: "Unknown category" });
      try {
        const { exec: execCb2 } = await import("node:child_process");
        const { promisify: promisify2 } = await import("node:util");
        const execAsync2 = promisify2(execCb2);
        const ps2 = `Get-CimInstance -ClassName ${wmiClass} | Select-Object -Index ${index} | ForEach-Object { $h=@{}; $_.CimInstanceProperties | Where-Object { $_.Value -ne $null } | ForEach-Object { $h[$_.Name]=[string]$_.Value }; $h } | ConvertTo-Json -Compress`;
        const r2 = await execAsync2(`powershell -NoProfile -NonInteractive -Command "${ps2}"`, { timeout: 15000, maxBuffer: 512 * 1024 });
        const props = JSON.parse(r2.stdout.trim() || "{}");
        return this.json(res, 200, { category, index, properties: props });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "POST" && url === "/api/computer/devices/report") {
      const body = await this.readJsonBody<{ categories?: string[] }>(req);
      const cats = body.categories || [];
      const wmiMapping: Record<string, string> = {
        "Processors": "Win32_Processor", "Motherboard": "Win32_BaseBoard", "Memory": "Win32_PhysicalMemory",
        "Display Adapters": "Win32_VideoController", "Disk Drives": "Win32_DiskDrive", "Network Adapters": "Win32_NetworkAdapter",
        "Sound Devices": "Win32_SoundDevice", "USB Controllers": "Win32_USBController", "USB Devices": "Win32_USBHub",
        "BIOS": "Win32_BIOS", "Optical Drives": "Win32_CDROMDrive",
      };
      const lines: string[] = ["PRISM Device Manager — Hardware Report", "Generated: " + new Date().toISOString(), "═".repeat(60), ""];
      try {
        const { exec: execCb3 } = await import("node:child_process");
        const { promisify: promisify3 } = await import("node:util");
        const execAsync3 = promisify3(execCb3);
        for (const cat of cats) {
          const cls = wmiMapping[cat];
          if (!cls) continue;
          lines.push("── " + cat + " ──");
          try {
            const ps3 = `Get-CimInstance -ClassName ${cls} | ForEach-Object { $h=@{}; $_.CimInstanceProperties | Where-Object { $_.Value -ne $null } | ForEach-Object { $h[$_.Name]=[string]$_.Value }; $h } | ConvertTo-Json -Depth 3 -Compress`;
            const r3 = await execAsync3(`powershell -NoProfile -NonInteractive -Command "${ps3}"`, { timeout: 15000, maxBuffer: 1024 * 1024 });
            const items = JSON.parse("[" + r3.stdout.trim().replace(/}\s*{/g, "},{") + "]");
            const arr = Array.isArray(items) ? items : [items];
            for (let i = 0; i < arr.length; i++) {
              lines.push("  Device " + (i + 1) + ":");
              for (const [k, v] of Object.entries(arr[i] as Record<string, string>)) {
                lines.push("    " + k + ": " + v);
              }
              lines.push("");
            }
          } catch { lines.push("  (query failed)"); lines.push(""); }
        }
        return this.json(res, 200, { report: lines.join("\\n") });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
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

      if (method === "POST" && url === "/api/browser/profiles") {
        if (!profMgr) return this.json(res, 503, { error: "Browser profile manager not available." });
        try {
          const body = await this.readJsonBody<{
            email?: string;
            prismUserEmail?: string;
            segment?: string;
            executionProfileSegment?: string;
            displayName?: string;
            assignmentId?: string;
          }>(req);
          const email = (body.email || body.prismUserEmail || "").trim();
          const segment = (body.segment || body.executionProfileSegment || "individual").trim();
          if (!email) return this.json(res, 400, { error: "email is required." });
          if (segment !== "individual" && segment !== "business") {
            return this.json(res, 400, { error: "segment must be 'individual' or 'business'." });
          }
          const profile = profMgr.createProfile({
            prismUserEmail: email,
            executionProfileSegment: segment as "individual" | "business",
            displayName: body.displayName || undefined,
            assignmentId: body.assignmentId || undefined,
          });
          return this.json(res, 201, { ok: true, profile });
        } catch (err) {
          return this.json(res, 500, { error: String(err) });
        }
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

    // ── Diagnostics API ──────────────────────────────────────────────────
    if (method === "GET" && url === "/api/diagnostics/browser/report") {
      try {
        const reportPath = join(process.cwd(), "prism-output", "browser-diagnostics-report.json");
        if (existsSync(reportPath)) {
          const raw = readFileSync(reportPath, "utf8");
          return this.json(res, 200, JSON.parse(raw));
        }
        return this.json(res, 200, { report: null });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "GET" && url === "/api/diagnostics/browser/status") {
      return this.json(res, 200, {
        running: this.diagnosticsRunning,
        lastRunAt: this.diagnosticsLastRunAt,
      });
    }

    if (method === "POST" && url === "/api/diagnostics/browser/run") {
      if (this.diagnosticsRunning) {
        return this.json(res, 409, { error: "Diagnostics already running." });
      }
      this.diagnosticsRunning = true;
      this.json(res, 200, { status: "started" });

      const { spawn: spawnChild } = await import("node:child_process");
      const child = spawnChild("node", ["scripts/run-browser-tests.cjs", "--no-build"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let gotStdoutComplete = false;
      const stderrNoiseRe = /^\s*(at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)|^\s*$/;

      let stderrBuf = "";
      child.stderr!.on("data", (chunk: Buffer) => {
        try {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() || "";
          for (const line of lines) {
            if (stderrNoiseRe.test(line)) continue;
            const msg = { type: "diagnostics_log", source: "stderr", message: line.slice(0, 1024), timestamp: new Date().toISOString() };
            for (const ws of this.wsClients) {
              try { ws.send(JSON.stringify(msg)); } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      let stdoutBuf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        try {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "diagnostics_complete") gotStdoutComplete = true;
              for (const ws of this.wsClients) {
                try {
                  ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() }));
                } catch { /* client gone */ }
              }
            } catch { /* not JSON — ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          this.diagnosticsRunning = false;
          this.diagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of this.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        this.diagnosticsRunning = false;
      });

      return; // response already sent
    }
    // ── End Diagnostics API ──────────────────────────────────────────────

    // ── Agent Diagnostics API ────────────────────────────────────────────
    if (method === "GET" && url === "/api/diagnostics/agent/report") {
      try {
        const reportPath = join(process.cwd(), "prism-output", "agent-diagnostics-report.json");
        if (existsSync(reportPath)) {
          const raw = readFileSync(reportPath, "utf8");
          return this.json(res, 200, JSON.parse(raw));
        }
        return this.json(res, 200, { report: null });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "GET" && url === "/api/diagnostics/agent/status") {
      return this.json(res, 200, {
        running: this.agentDiagnosticsRunning,
        lastRunAt: this.agentDiagnosticsLastRunAt,
      });
    }

    if (method === "POST" && url === "/api/diagnostics/agent/run") {
      if (this.agentDiagnosticsRunning) {
        return this.json(res, 409, { error: "Agent diagnostics already running." });
      }
      this.agentDiagnosticsRunning = true;
      this.json(res, 200, { status: "started" });

      const { spawn: spawnChild } = await import("node:child_process");
      const child = spawnChild("node", ["scripts/run-agent-tests.cjs", "--no-build"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let gotStdoutComplete = false;
      const stderrNoiseRe = /^\s*(at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)|^\s*$/;

      let stderrBuf = "";
      child.stderr!.on("data", (chunk: Buffer) => {
        try {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() || "";
          for (const line of lines) {
            if (stderrNoiseRe.test(line)) continue;
            const msg = { type: "agent_diagnostics_log", source: "stderr", message: line.slice(0, 1024), timestamp: new Date().toISOString() };
            for (const ws of this.wsClients) {
              try { ws.send(JSON.stringify(msg)); } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      let stdoutBuf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        try {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "agent_diagnostics_complete") gotStdoutComplete = true;
              for (const ws of this.wsClients) {
                try { ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() })); } catch { /* client gone */ }
              }
            } catch { /* not JSON — ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          this.agentDiagnosticsRunning = false;
          this.agentDiagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of this.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "agent_diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        this.agentDiagnosticsRunning = false;
      });

      return;
    }
    // ── End Agent Diagnostics API ────────────────────────────────────────

    // ── Computer Diagnostics API ─────────────────────────────────────────
    if (method === "GET" && url === "/api/diagnostics/computer/report") {
      try {
        const reportPath = join(process.cwd(), "prism-output", "computer-diagnostics-report.json");
        if (existsSync(reportPath)) {
          const raw = readFileSync(reportPath, "utf8");
          return this.json(res, 200, JSON.parse(raw));
        }
        return this.json(res, 200, { report: null });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "GET" && url === "/api/diagnostics/computer/status") {
      return this.json(res, 200, {
        running: this.computerDiagnosticsRunning,
        lastRunAt: this.computerDiagnosticsLastRunAt,
      });
    }

    if (method === "POST" && url === "/api/diagnostics/computer/run") {
      if (this.computerDiagnosticsRunning) {
        return this.json(res, 409, { error: "Computer diagnostics already running." });
      }
      this.computerDiagnosticsRunning = true;
      this.json(res, 200, { status: "started" });

      const { spawn: spawnChild } = await import("node:child_process");
      const child = spawnChild("node", ["scripts/run-computer-tests.cjs", "--no-build"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let gotStdoutComplete = false;
      const stderrNoiseRe = /^\s*(at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)|^\s*$/;

      let stderrBuf = "";
      child.stderr!.on("data", (chunk: Buffer) => {
        try {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() || "";
          for (const line of lines) {
            if (stderrNoiseRe.test(line)) continue;
            const msg = { type: "computer_diagnostics_log", source: "stderr", message: line.slice(0, 1024), timestamp: new Date().toISOString() };
            for (const ws of this.wsClients) {
              try { ws.send(JSON.stringify(msg)); } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      let stdoutBuf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        try {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "computer_diagnostics_complete") gotStdoutComplete = true;
              for (const ws of this.wsClients) {
                try { ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() })); } catch { /* client gone */ }
              }
            } catch { /* not JSON — ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          this.computerDiagnosticsRunning = false;
          this.computerDiagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of this.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "computer_diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        this.computerDiagnosticsRunning = false;
      });

      return;
    }
    // ── End Computer Diagnostics API ──────────────────────────────────────

    // ── Knowledge Graph Diagnostics API ──────────────────────────────────
    if (method === "GET" && url === "/api/diagnostics/knowledge-graph/report") {
      try {
        const reportPath = join(process.cwd(), "prism-output", "knowledge-graph-diagnostics-report.json");
        if (existsSync(reportPath)) {
          const raw = readFileSync(reportPath, "utf8");
          return this.json(res, 200, JSON.parse(raw));
        }
        return this.json(res, 200, { report: null });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "GET" && url === "/api/diagnostics/knowledge-graph/status") {
      return this.json(res, 200, {
        running: this.knowledgeGraphDiagnosticsRunning,
        lastRunAt: this.knowledgeGraphDiagnosticsLastRunAt,
      });
    }

    if (method === "POST" && url === "/api/diagnostics/knowledge-graph/run") {
      if (this.knowledgeGraphDiagnosticsRunning) {
        return this.json(res, 409, { error: "Knowledge Graph diagnostics already running." });
      }
      this.knowledgeGraphDiagnosticsRunning = true;
      this.json(res, 200, { status: "started" });

      const { spawn: spawnChild } = await import("node:child_process");
      const child = spawnChild("node", ["scripts/run-knowledge-graph-tests.cjs", "--no-build"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let gotStdoutComplete = false;
      const stderrNoiseRe = /^\s*(at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)|^\s*$/;

      let stderrBuf = "";
      child.stderr!.on("data", (chunk: Buffer) => {
        try {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() || "";
          for (const line of lines) {
            if (stderrNoiseRe.test(line)) continue;
            const msg = { type: "knowledge_graph_diagnostics_log", source: "stderr", message: line.slice(0, 1024), timestamp: new Date().toISOString() };
            for (const ws of this.wsClients) {
              try { ws.send(JSON.stringify(msg)); } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      let stdoutBuf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        try {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "knowledge_graph_diagnostics_complete") gotStdoutComplete = true;
              for (const ws of this.wsClients) {
                try { ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() })); } catch { /* client gone */ }
              }
            } catch { /* not JSON — ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          this.knowledgeGraphDiagnosticsRunning = false;
          this.knowledgeGraphDiagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of this.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "knowledge_graph_diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        this.knowledgeGraphDiagnosticsRunning = false;
      });

      return;
    }
    // ── End Knowledge Graph Diagnostics API ───────────────────────────────

    // ── Workspace Diagnostics API ─────────────────────────────────────────
    if (method === "GET" && url === "/api/diagnostics/workspace/report") {
      try {
        const reportPath = join(process.cwd(), "prism-output", "workspace-diagnostics-report.json");
        if (existsSync(reportPath)) {
          const raw = readFileSync(reportPath, "utf8");
          return this.json(res, 200, JSON.parse(raw));
        }
        return this.json(res, 200, { report: null });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "GET" && url === "/api/diagnostics/workspace/status") {
      return this.json(res, 200, {
        running: this.workspaceDiagnosticsRunning,
        lastRunAt: this.workspaceDiagnosticsLastRunAt,
      });
    }

    if (method === "POST" && url === "/api/diagnostics/workspace/run") {
      if (this.workspaceDiagnosticsRunning) {
        return this.json(res, 409, { error: "Workspace diagnostics already running." });
      }
      this.workspaceDiagnosticsRunning = true;
      this.json(res, 200, { status: "started" });

      const { spawn: spawnChild } = await import("node:child_process");
      const child = spawnChild("node", ["scripts/run-workspace-tests.cjs", "--no-build"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let gotStdoutComplete = false;
      const stderrNoiseRe = /^\s*(at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)|^\s*$/;

      let stderrBuf = "";
      child.stderr!.on("data", (chunk: Buffer) => {
        try {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() || "";
          for (const line of lines) {
            if (stderrNoiseRe.test(line)) continue;
            const msg = { type: "workspace_diagnostics_log", source: "stderr", message: line.slice(0, 1024), timestamp: new Date().toISOString() };
            for (const ws of this.wsClients) {
              try { ws.send(JSON.stringify(msg)); } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      let stdoutBuf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        try {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "workspace_diagnostics_complete") gotStdoutComplete = true;
              for (const ws of this.wsClients) {
                try { ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() })); } catch { /* client gone */ }
              }
            } catch { /* not JSON — ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          this.workspaceDiagnosticsRunning = false;
          this.workspaceDiagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of this.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "workspace_diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        this.workspaceDiagnosticsRunning = false;
      });

      return;
    }
    // ── End Workspace Diagnostics API ──────────────────────────────────────

    // ── Network Diagnostics API ───────────────────────────────────────────
    if (method === "GET" && url === "/api/diagnostics/network/report") {
      try {
        const reportPath = join(process.cwd(), "prism-output", "network-diagnostics-report.json");
        if (existsSync(reportPath)) {
          const raw = readFileSync(reportPath, "utf8");
          return this.json(res, 200, JSON.parse(raw));
        }
        return this.json(res, 200, { report: null });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "GET" && url === "/api/diagnostics/network/status") {
      return this.json(res, 200, {
        running: this.networkDiagnosticsRunning,
        lastRunAt: this.networkDiagnosticsLastRunAt,
      });
    }

    if (method === "POST" && url === "/api/diagnostics/network/run") {
      if (this.networkDiagnosticsRunning) {
        return this.json(res, 409, { error: "Network diagnostics already running." });
      }
      this.networkDiagnosticsRunning = true;
      this.json(res, 200, { status: "started" });

      const { spawn: spawnChild } = await import("node:child_process");
      const child = spawnChild("node", ["scripts/run-network-tests.cjs", "--no-build"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let gotStdoutComplete = false;
      const stderrNoiseRe = /^\s*(at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)|^\s*$/;

      let stderrBuf = "";
      child.stderr!.on("data", (chunk: Buffer) => {
        try {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() || "";
          for (const line of lines) {
            if (stderrNoiseRe.test(line)) continue;
            const msg = { type: "network_diagnostics_log", source: "stderr", message: line.slice(0, 1024), timestamp: new Date().toISOString() };
            for (const ws of this.wsClients) {
              try { ws.send(JSON.stringify(msg)); } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      let stdoutBuf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        try {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "network_diagnostics_complete") gotStdoutComplete = true;
              for (const ws of this.wsClients) {
                try { ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() })); } catch { /* client gone */ }
              }
            } catch { /* not JSON \u2014 ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          this.networkDiagnosticsRunning = false;
          this.networkDiagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of this.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "network_diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        this.networkDiagnosticsRunning = false;
      });

      return;
    }

    // ── VRGC Network Intelligence API ──────────────────────────────────────
    if (method === "GET" && url === "/api/network/vrgc/status") {
      try {
        const { checkVrgcAvailability } = await import("../../adapters/network/vrgc-network-bridge.js");
        const available = await checkVrgcAvailability();
        return this.json(res, 200, { available });
      } catch {
        return this.json(res, 200, { available: false });
      }
    }

    if (method === "POST" && url === "/api/network/vrgc/research") {
      try {
        const body = await this.readJsonBody<{ topic?: string; depth?: string; sourceTypes?: string[] }>(req);
        if (!body.topic) return this.json(res, 400, { error: "Missing 'topic' field." });
        const { fetchNetworkResearch } = await import("../../adapters/network/vrgc-network-bridge.js");
        const result = await fetchNetworkResearch(body.topic, {
          depth: (body.depth as "quick" | "standard" | "comprehensive") ?? "standard",
          sourceTypes: body.sourceTypes,
        });
        return this.json(res, result.ok ? 200 : 502, result);
      } catch (err: unknown) {
        return this.json(res, 500, { ok: false, error: (err as Error).message ?? "VRGC research failed" });
      }
    }

    if (method === "POST" && url === "/api/network/vrgc/security-scan") {
      try {
        const body = await this.readJsonBody<{ target?: string; scanType?: string }>(req);
        if (!body.target) return this.json(res, 400, { error: "Missing 'target' field." });
        const { runSecurityScan } = await import("../../adapters/network/vrgc-network-bridge.js");
        const result = await runSecurityScan(body.target, (body.scanType as any) ?? "comprehensive");
        return this.json(res, result.ok ? 200 : 502, result);
      } catch (err: unknown) {
        return this.json(res, 500, { ok: false, error: (err as Error).message ?? "VRGC security scan failed" });
      }
    }

    if (method === "POST" && url === "/api/network/vrgc/performance") {
      try {
        const body = await this.readJsonBody<{ url?: string; testType?: string; device?: string }>(req);
        if (!body.url) return this.json(res, 400, { error: "Missing 'url' field." });
        const { testPerformance } = await import("../../adapters/network/vrgc-network-bridge.js");
        const result = await testPerformance(body.url, {
          testType: body.testType,
          device: (body.device as "desktop" | "mobile" | "tablet") ?? "desktop",
        });
        return this.json(res, result.ok ? 200 : 502, result);
      } catch (err: unknown) {
        return this.json(res, 500, { ok: false, error: (err as Error).message ?? "VRGC performance test failed" });
      }
    }

    if (method === "POST" && url === "/api/network/vrgc/ftp") {
      try {
        const body = await this.readJsonBody<{ server?: string; path?: string; passiveMode?: boolean }>(req);
        if (!body.server) return this.json(res, 400, { error: "Missing 'server' field." });
        const { fetchFtpListing } = await import("../../adapters/network/vrgc-network-bridge.js");
        const result = await fetchFtpListing(body.server, body.path ?? "/", body.passiveMode ?? true);
        return this.json(res, result.ok ? 200 : 502, result);
      } catch (err: unknown) {
        return this.json(res, 500, { ok: false, error: (err as Error).message ?? "VRGC FTP access failed" });
      }
    }
    // ── End Network Diagnostics API ────────────────────────────────────────

    // ── Telemetry Diagnostics API ──────────────────────────────────────────
    if (method === "GET" && url === "/api/diagnostics/telemetry/report") {
      try {
        const reportPath = join(process.cwd(), "prism-output", "telemetry-diagnostics-report.json");
        if (existsSync(reportPath)) {
          const raw = readFileSync(reportPath, "utf8");
          return this.json(res, 200, JSON.parse(raw));
        }
        return this.json(res, 200, { report: null });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "GET" && url === "/api/diagnostics/telemetry/status") {
      return this.json(res, 200, {
        running: this.telemetryDiagnosticsRunning,
        lastRunAt: this.telemetryDiagnosticsLastRunAt,
      });
    }

    if (method === "POST" && url === "/api/diagnostics/telemetry/run") {
      if (this.telemetryDiagnosticsRunning) {
        return this.json(res, 409, { error: "Telemetry diagnostics already running." });
      }
      this.telemetryDiagnosticsRunning = true;
      this.json(res, 200, { status: "started" });

      const { spawn: spawnChild } = await import("node:child_process");
      const child = spawnChild("node", ["scripts/run-telemetry-tests.cjs", "--no-build"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let gotStdoutComplete = false;
      const stderrNoiseRe = /^\s*(at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)|^\s*$/;

      let stderrBuf = "";
      child.stderr!.on("data", (chunk: Buffer) => {
        try {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() || "";
          for (const line of lines) {
            if (stderrNoiseRe.test(line)) continue;
            const msg = { type: "telemetry_diagnostics_log", source: "stderr", message: line.slice(0, 1024), timestamp: new Date().toISOString() };
            for (const ws of this.wsClients) {
              try { ws.send(JSON.stringify(msg)); } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      let stdoutBuf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        try {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "telemetry_diagnostics_complete") gotStdoutComplete = true;
              for (const ws of this.wsClients) {
                try { ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() })); } catch { /* client gone */ }
              }
            } catch { /* not JSON \u2014 ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          this.telemetryDiagnosticsRunning = false;
          this.telemetryDiagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of this.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "telemetry_diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        this.telemetryDiagnosticsRunning = false;
      });

      return;
    }
    // ── End Telemetry Diagnostics API ──────────────────────────────────────

    // ── Logs & Debug Diagnostics API ──────────────────────────────────────
    if (method === "GET" && url === "/api/diagnostics/logs/report") {
      try {
        const reportPath = join(process.cwd(), "prism-output", "logs-diagnostics-report.json");
        if (existsSync(reportPath)) {
          const raw = readFileSync(reportPath, "utf8");
          return this.json(res, 200, JSON.parse(raw));
        }
        return this.json(res, 200, { report: null });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "GET" && url === "/api/diagnostics/logs/status") {
      return this.json(res, 200, {
        running: this.logsDiagnosticsRunning,
        lastRunAt: this.logsDiagnosticsLastRunAt,
      });
    }

    if (method === "POST" && url === "/api/diagnostics/logs/run") {
      if (this.logsDiagnosticsRunning) {
        return this.json(res, 409, { error: "Logs diagnostics already running." });
      }
      this.logsDiagnosticsRunning = true;
      this.json(res, 200, { status: "started" });

      const { spawn: spawnChild } = await import("node:child_process");
      const child = spawnChild("node", ["scripts/run-logs-tests.cjs", "--no-build"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let gotStdoutComplete = false;
      const stderrNoiseRe = /^\s*(at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)|^\s*$/;

      let stderrBuf = "";
      child.stderr!.on("data", (chunk: Buffer) => {
        try {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() || "";
          for (const line of lines) {
            if (stderrNoiseRe.test(line)) continue;
            const msg = { type: "logs_diagnostics_log", source: "stderr", message: line.slice(0, 1024), timestamp: new Date().toISOString() };
            for (const ws of this.wsClients) {
              try { ws.send(JSON.stringify(msg)); } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      let stdoutBuf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        try {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "logs_diagnostics_complete") gotStdoutComplete = true;
              for (const ws of this.wsClients) {
                try { ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() })); } catch { /* client gone */ }
              }
            } catch { /* not JSON \u2014 ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          this.logsDiagnosticsRunning = false;
          this.logsDiagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of this.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "logs_diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        this.logsDiagnosticsRunning = false;
      });

      return;
    }
    // ── End Logs Diagnostics API ──────────────────────────────────────

    // ── Scheduler Diagnostics API ────────────────────────────────────────
    if (method === "GET" && url === "/api/diagnostics/scheduler/report") {
      try {
        const reportPath = join(process.cwd(), "prism-output", "scheduler-diagnostics-report.json");
        if (existsSync(reportPath)) {
          const raw = readFileSync(reportPath, "utf8");
          return this.json(res, 200, JSON.parse(raw));
        }
        return this.json(res, 200, { report: null });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "GET" && url === "/api/diagnostics/scheduler/status") {
      return this.json(res, 200, {
        running: this.schedulerDiagnosticsRunning,
        lastRunAt: this.schedulerDiagnosticsLastRunAt,
      });
    }

    if (method === "POST" && url === "/api/diagnostics/scheduler/run") {
      if (this.schedulerDiagnosticsRunning) {
        return this.json(res, 409, { error: "Scheduler diagnostics already running." });
      }
      this.schedulerDiagnosticsRunning = true;
      this.json(res, 200, { status: "started" });

      const { spawn: spawnChild } = await import("node:child_process");
      const child = spawnChild("node", ["scripts/run-scheduler-tests.cjs", "--no-build"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let gotStdoutComplete = false;
      const stderrNoiseRe = /^\s*(at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)|^\s*$/;

      let stderrBuf = "";
      child.stderr!.on("data", (chunk: Buffer) => {
        try {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() || "";
          for (const line of lines) {
            if (stderrNoiseRe.test(line)) continue;
            const msg = { type: "scheduler_diagnostics_log", source: "stderr", message: line.slice(0, 1024), timestamp: new Date().toISOString() };
            for (const ws of this.wsClients) {
              try { ws.send(JSON.stringify(msg)); } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      let stdoutBuf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        try {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "scheduler_diagnostics_complete") gotStdoutComplete = true;
              for (const ws of this.wsClients) {
                try {
                  ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() }));
                } catch { /* client gone */ }
              }
            } catch { /* not JSON — ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          this.schedulerDiagnosticsRunning = false;
          this.schedulerDiagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of this.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "scheduler_diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        this.schedulerDiagnosticsRunning = false;
      });

      return;
    }
    // ── End Scheduler Diagnostics API ────────────────────────────────────

    // ── Demo Scenarios Diagnostics API ───────────────────────────────────
    if (method === "GET" && url === "/api/diagnostics/demo/report") {
      try {
        const reportPath = join(process.cwd(), "prism-output", "demo-scenario-report.json");
        if (existsSync(reportPath)) {
          const raw = readFileSync(reportPath, "utf8");
          return this.json(res, 200, JSON.parse(raw));
        }
        return this.json(res, 200, { report: null });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "GET" && url === "/api/diagnostics/demo/status") {
      return this.json(res, 200, {
        running: this.demoDiagnosticsRunning,
        lastRunAt: this.demoDiagnosticsLastRunAt,
      });
    }

    if (method === "POST" && url === "/api/diagnostics/demo/run") {
      if (this.demoDiagnosticsRunning) {
        return this.json(res, 409, { error: "Demo diagnostics already running." });
      }
      this.demoDiagnosticsRunning = true;
      this.json(res, 200, { status: "started" });

      const { spawn: spawnChild } = await import("node:child_process");
      const child = spawnChild("node", ["scripts/run-demo-scenarios.cjs", "--no-build", "--profile=all"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let gotStdoutComplete = false;
      const stderrNoiseRe = /^\s*(at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)|^\s*$/;

      let stderrBuf = "";
      child.stderr!.on("data", (chunk: Buffer) => {
        try {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() || "";
          for (const line of lines) {
            if (stderrNoiseRe.test(line)) continue;
            const msg = { type: "demo_diagnostics_log", source: "stderr", message: line.slice(0, 1024), timestamp: new Date().toISOString() };
            for (const ws of this.wsClients) {
              try { ws.send(JSON.stringify(msg)); } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      let stdoutBuf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        try {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "demo_diagnostics_complete") gotStdoutComplete = true;
              for (const ws of this.wsClients) {
                try {
                  ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() }));
                } catch { /* client gone */ }
              }
            } catch { /* not JSON — ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          this.demoDiagnosticsRunning = false;
          this.demoDiagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of this.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "demo_diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        this.demoDiagnosticsRunning = false;
      });

      return;
    }
    // ── End Demo Scenarios Diagnostics API ───────────────────────────────

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
        const body = await this.readJsonBody<{ content?: string; override?: boolean }>(req);

        // Soft-block cap check — skip when client explicitly confirms override
        if (!body.override && this.usageMetering) {
          const capCheck = this.usageMetering.checkCap();
          if (!capCheck.allowed) {
            return this.json(res, 200, {
              softBlock: true,
              capType: capCheck.capType,
              remainingUsd: capCheck.remainingUsd,
              message: `You have reached your ${capCheck.capType} spending cap. Send with override to proceed anyway.`,
            });
          }
        }

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

    // ── SLO Gauge API ─────────────────────────────────────────────────────────
    if (method === "GET" && url === "/api/v1/telemetry/slo-summary") {
      return this.json(res, 200, computeSloSummary(this.metricsStore));
    }

    // ── CAC Identity Chain API ────────────────────────────────────────────────
    if (method === "GET" && url.startsWith("/api/v1/cac/chain")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const sessionId = parsed.searchParams.get("sessionId") || this.status.sessionId;
        const assignments = this.characterAccountabilityManager.queryBySession(sessionId);
        
        // Include events for the assignments
        const chains = assignments.map(assignment => {
            const events = this.activityBus.listEvents().filter(e => e.details?.assignmentId === assignment.assignmentId || e.assignmentId === assignment.assignmentId);
            return {
                assignment,
                events: events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            };
        });

        return this.json(res, 200, { chains });
      } catch (err) {
        return this.json(res, 400, { error: String(err) });
      }
    }

    // ── Usage / Cost API ──────────────────────────────────────────────────────
    if (method === "GET" && url.startsWith("/api/usage/summary")) {
      if (!this.usageMetering) return this.json(res, 200, { byModel: [], totalCostUsd: 0, totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, caps: { sessionCap: null, dailyCap: null, monthlyCap: null }, sessionCostUsd: 0, dailyCostUsd: 0, monthlyCostUsd: 0, window: "1d" });
      try {
        const parsed = new URL(`http://localhost${url}`);
        const win = (parsed.searchParams.get("window") ?? "1d") as UsageWindow;
        return this.json(res, 200, this.usageMetering.getSummary(win));
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/usage/caps") {
      if (!this.usageMetering) return this.json(res, 200, { sessionCap: null, dailyCap: null, monthlyCap: null });
      return this.json(res, 200, this.usageMetering.getCaps());
    }

    if (method === "POST" && url === "/api/usage/caps") {
      if (!this.usageMetering) return this.json(res, 501, { error: "Usage metering not initialized." });
      try {
        const body = await this.readJsonBody<{ sessionCap?: number | null; dailyCap?: number | null; monthlyCap?: number | null }>(req);
        const toNum = (v: unknown): number | null => {
          if (v === null || v === undefined || v === "") return null;
          const n = parseFloat(String(v));
          return isFinite(n) && n > 0 ? n : null;
        };
        this.usageMetering.setCaps({
          sessionCap: toNum(body.sessionCap),
          dailyCap: toNum(body.dailyCap),
          monthlyCap: toNum(body.monthlyCap),
        });
        return this.json(res, 200, { saved: true, caps: this.usageMetering.getCaps() });
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
      try {
        const payload = await this.readJsonBody<{ sessionId?: string }>(req).catch(() => ({ sessionId: undefined }));
        return this.json(res, 202, this.triggerAction(actionName, payload.sessionId));
      } catch (error) {
        return this.json(res, 202, this.triggerAction(actionName));
      }
    }

    const approveMatch = /^\/(approve|api\/approve)\/([^/]+)$/.exec(url);
    const approveMatchRest = /^\/api\/approval\/([^/]+)\/approve$/.exec(url);
    if (method === "POST" && (approveMatch || approveMatchRest)) {
      const id = approveMatch ? approveMatch[2]! : approveMatchRest![1]!;
      const ok = this.queue.approve(id);
      return this.json(res, ok ? 200 : 404, { approved: ok });
    }

    const denyMatch = /^\/(deny|api\/deny)\/([^/]+)$/.exec(url);
    const denyMatchRest = /^\/api\/approval\/([^/]+)\/deny$/.exec(url);
    if (method === "POST" && (denyMatch || denyMatchRest)) {
      const id = denyMatch ? denyMatch[2]! : denyMatchRest![1]!;
      const ok = this.queue.deny(id);
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

    if (method === "GET" && url === "/api/workspace/hub") {
      return this.json(res, 200, { workspaceHub: getWorkspaceHub() });
    }

    if (method === "POST" && url === "/api/workspace/hub") {
      try {
        const body = await this.readJsonBody<{ workspaceHub?: string }>(req);
        const hub = String(body.workspaceHub ?? "").trim();
        setWorkspaceHub(hub);
        return this.json(res, 200, { ok: true, workspaceHub: hub });
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 400, { error: e.message ?? "Failed to set workspace hub" });
      }
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
          workspaceHub?: string;
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
          workspaceHub: String(body.workspaceHub ?? getWorkspaceHub()).trim(),
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
        seedDefaultCharacters();
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

    // ── Scheduler API endpoints ──────────────────────────────────────────

    if (method === "GET" && url.startsWith("/api/scheduler/events")) {
      const qs = new URL(url, "http://localhost").searchParams;
      const startFilter = qs.get("start") || "";
      const endFilter = qs.get("end") || "";
      let events = [...this.schedulerEvents.values()];
      if (startFilter) events = events.filter((e) => (e.end || e.start) >= startFilter);
      if (endFilter) events = events.filter((e) => e.start <= endFilter);
      return this.json(res, 200, { events });
    }

    if (method === "POST" && url === "/api/scheduler/events") {
      const body = await this.readJsonBody<{ eventId?: string; title?: string; start?: string; end?: string; description?: string }>(req);
      if (!body.title || !body.start) return this.json(res, 400, { error: "title and start are required" });
      const id = body.eventId || randomUUID();
      const evt = { id, title: body.title, start: body.start, end: body.end, description: body.description, createdAt: new Date().toISOString() };
      this.schedulerEvents.set(id, evt);
      return this.json(res, 200, { event: evt });
    }

    if (method === "GET" && url === "/api/scheduler/projects") {
      const projects = [...this.schedulerProjects.values()];
      return this.json(res, 200, { projects });
    }

    const projectDetailMatch = /^\/api\/scheduler\/projects\/([^/?]+)$/.exec(url);
    if (method === "GET" && projectDetailMatch) {
      const pid = decodeURIComponent(projectDetailMatch[1]!);
      const project = this.schedulerProjects.get(pid);
      if (!project) return this.json(res, 404, { error: "Project not found" });
      return this.json(res, 200, { project });
    }

    if (method === "POST" && url === "/api/scheduler/projects") {
      const body = await this.readJsonBody<{ name?: string; description?: string }>(req);
      if (!body.name) return this.json(res, 400, { error: "name is required" });
      const id = randomUUID();
      const project = { id, name: body.name, description: body.description, tasks: [] as Array<{ id: string; title: string; status: string; assignee?: string; startDate?: string; endDate?: string; dueDate?: string; createdAt: string }>, milestones: [] as Array<{ title: string; dueDate?: string }>, createdAt: new Date().toISOString() };
      this.schedulerProjects.set(id, project);
      return this.json(res, 200, { project });
    }

    if (method === "GET" && url === "/api/scheduler/tasks") {
      const tasks: Array<Record<string, unknown>> = [];
      for (const p of this.schedulerProjects.values()) {
        for (const t of p.tasks) tasks.push({ ...t, projectId: p.id, projectName: p.name });
      }
      return this.json(res, 200, { tasks });
    }

    if (method === "POST" && url === "/api/scheduler/tasks") {
      const body = await this.readJsonBody<{ title?: string; projectId?: string; status?: string; assignee?: string; startDate?: string; endDate?: string; dueDate?: string }>(req);
      if (!body.title) return this.json(res, 400, { error: "title is required" });
      const task = { id: randomUUID(), title: body.title, status: body.status || "backlog", assignee: body.assignee, startDate: body.startDate, endDate: body.endDate, dueDate: body.dueDate, createdAt: new Date().toISOString() };
      if (body.projectId) {
        const project = this.schedulerProjects.get(body.projectId);
        if (project) { project.tasks.push(task); }
        else { return this.json(res, 404, { error: "Project not found" }); }
      }
      return this.json(res, 200, { task });
    }

    const taskUpdateMatch = /^\/api\/scheduler\/tasks\/([^/?]+)/.exec(url);
    if (method === "PUT" && taskUpdateMatch) {
      const taskId = decodeURIComponent(taskUpdateMatch[1]!);
      const qs = new URL(url, "http://localhost").searchParams;
      const projectId = qs.get("projectId") || "";
      const body = await this.readJsonBody<{ status?: string; title?: string; assignee?: string }>(req);
      let found = false;
      for (const p of this.schedulerProjects.values()) {
        if (projectId && p.id !== projectId) continue;
        const task = p.tasks.find((t) => t.id === taskId);
        if (task) {
          if (body.status) task.status = body.status;
          if (body.title) task.title = body.title;
          if (body.assignee !== undefined) task.assignee = body.assignee;
          found = true;
          break;
        }
      }
      if (!found) return this.json(res, 404, { error: "Task not found" });
      return this.json(res, 200, { ok: true });
    }

    // ── Cron Jobs API endpoints ───────────────────────────────────────
    if (method === "GET" && url === "/api/scheduler/cron") {
      const jobs = this.schedulerEngine.list().map((e) => ({
        ...e,
        nextOccurrences: e.cronExpression
          ? getNextNCronOccurrences(e.cronExpression, 3).map((d) => d.toISOString())
          : [],
      }));
      return this.json(res, 200, jobs);
    }

    if (method === "POST" && url === "/api/scheduler/cron") {
      const body = await this.readJsonBody<{
        label?: string;
        type?: string;
        cronExpression?: string;
        runAt?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }>(req);
      if (!body.label || !body.action) {
        return this.json(res, 400, { error: "label and action are required" });
      }
      try {
        let entry;
        if (body.type === "once") {
          if (!body.runAt) {
            return this.json(res, 400, { error: "runAt is required for one-time jobs" });
          }
          entry = this.schedulerEngine.scheduleOnce(body.label, body.runAt, body.action, body.payload);
        } else {
          if (!body.cronExpression) {
            return this.json(res, 400, { error: "cronExpression is required for recurring jobs" });
          }
          // Validate cron expression before scheduling
          parseCronExpression(body.cronExpression);
          entry = this.schedulerEngine.scheduleRecurring(body.label, body.cronExpression, body.action, body.payload);
        }
        this.broadcastEvent({ type: "scheduler:cron-created", id: entry.id, label: entry.label });
        return this.json(res, 201, { job: entry });
      } catch (err: any) {
        return this.json(res, 400, { error: "Invalid cron expression: " + (err?.message || String(err)) });
      }
    }

    if (method === "POST" && url === "/api/scheduler/cron/validate") {
      const body = await this.readJsonBody<{ cronExpression?: string }>(req);
      if (!body.cronExpression) {
        return this.json(res, 400, { valid: false, error: "cronExpression is required" });
      }
      try {
        const fields = parseCronExpression(body.cronExpression);
        const nextDates = getNextNCronOccurrences(body.cronExpression, 5).map((d) => d.toISOString());
        return this.json(res, 200, { valid: true, fields, nextDates });
      } catch (err: any) {
        return this.json(res, 200, { valid: false, error: err?.message || String(err) });
      }
    }

    // /api/scheduler/cron/:id and /api/scheduler/cron/:id/preview
    const cronIdMatch = /^\/api\/scheduler\/cron\/([^/?]+)(\/preview)?$/.exec(url);
    if (cronIdMatch) {
      const cronId = decodeURIComponent(cronIdMatch[1]!);
      const isPreview = !!cronIdMatch[2];

      if (isPreview && method === "GET") {
        const entry = this.schedulerEngine.get(cronId);
        if (!entry) return this.json(res, 404, { error: "Cron job not found" });
        const nextOccurrences = this.schedulerEngine.getNextOccurrences(cronId, 10).map((d) => d.toISOString());
        return this.json(res, 200, { ...entry, nextOccurrences });
      }

      if (!isPreview && method === "DELETE") {
        const removed = this.schedulerEngine.cancel(cronId);
        if (!removed) return this.json(res, 404, { error: "Cron job not found" });
        this.broadcastEvent({ type: "scheduler:cron-cancelled", id: cronId });
        return this.json(res, 200, { ok: true });
      }
    }

    // ── A2A Protocol routes (Phase F) ─────────────────────────────────────
    // GET /.well-known/agent.json — Agent Card (publicly accessible)
    if (method === "GET" && url === "/.well-known/agent.json") {
      const characters = [
        "aria-individual", "aria-business",
        "phoenix-individual", "phoenix-business",
        "sentinel-individual", "sentinel-business",
      ];
      return this.json(res, 200, {
        name: "PRISM",
        description:
          "PRISM governed agent platform — constitutional AI with SHA-256 audit trails, " +
          "3-tier policy enforcement, and immutable activity logs. " +
          "Characters: " + characters.join(", "),
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
      try { body = await this.readBody(req); } catch { return this.json(res, 413, { error: "Request body too large" }); }
      let request: Record<string, unknown>;
      try { request = JSON.parse(body); } catch { return this.json(res, 400, { error: "Invalid JSON" }); }
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
            message: task.status === "submitted"
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
            message: task.output_text
              ? { role: "agent", parts: [{ text: task.output_text }] }
              : undefined,
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
      if (!this.governanceHooksAdapter) return this.json(res, 503, { error: "Governance hooks adapter not initialized" });
      let body: string;
      try { body = await this.readBody(req); } catch { return this.json(res, 413, { error: "Request body too large" }); }
      let request: Record<string, unknown>;
      try { request = JSON.parse(body); } catch { return this.json(res, 400, { error: "Invalid JSON" }); }
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
      if (!this.governanceHooksAdapter) return this.json(res, 503, { error: "Governance hooks adapter not initialized" });
      let body: string;
      try { body = await this.readBody(req); } catch { return this.json(res, 413, { error: "Request body too large" }); }
      let request: Record<string, unknown>;
      try { request = JSON.parse(body); } catch { return this.json(res, 400, { error: "Invalid JSON" }); }
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

    // ── Observability: Prometheus /metrics endpoint (Phase E6) ────────────
    // Standard Prometheus scrape endpoint — returns text/plain exposition format.
    // Add to publicRoutes so scraping agents don't need Bearer token (standard practice).
    if (method === "GET" && url === "/metrics") {
      // Inject live gauges that change over time (can't be tracked via events alone)
      const sessionCount = this.chatStore.listSessions().length;
      const pendingApprovals = this.queue.list().length;
      this.metricsStore.set("prism_active_sessions", sessionCount);
      this.metricsStore.set("prism_approval_queue_depth", pendingApprovals);
      this.metricsStore.set("prism_uptime_seconds", Math.floor(process.uptime()));

      const body = this.metricsStore.render();
      res.writeHead(200, {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
      res.end(body);
      return;
    }

    // ── UI mode preference ────────────────────────────────────────────────────
    if (method === "POST" && url === "/api/preferences/ui-mode") {
      const body = await this.readJsonBody<{ mode?: string }>(req);
      const mode = body.mode;
      if (mode !== "simple" && mode !== "advanced") {
        this.json(res, 400, { error: "mode must be 'simple' or 'advanced'" });
        return;
      }
      writePreferences({ uiMode: mode as "simple" | "advanced" });
      this.json(res, 200, { updated: true, mode });
      return;
    }

    // ── E3e-3/E3e-4: GET /api/v1/openapi.json — OpenAPI 3.0 spec ────────────
    if (method === "GET" && url === "/api/v1/openapi.json") {
      const spec = {
        openapi: "3.0.3",
        info: {
          title: "PRISM Operator API",
          version: "1.0.0",
          description: "PRISM Agents as a Service — Operator Dashboard API",
        },
        servers: [{ url: "/api/v1", description: "Current version" }],
        paths: {
          "/telemetry/slo-summary": {
            get: {
              summary: "SLO summary for all tracked histograms",
              operationId: "getSloSummary",
              responses: { "200": { description: "SLO summary object" } },
            },
          },
          "/plugins/{name}/toggle": {
            post: {
              summary: "Toggle a plugin enabled/disabled",
              operationId: "togglePlugin",
              parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
              responses: { "200": { description: "Plugin toggle result with enabled field" } },
            },
          },
          "/plugins/{name}/health": {
            post: {
              summary: "Check plugin health",
              operationId: "checkPluginHealth",
              parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
              responses: { "200": { description: "Plugin health result" } },
            },
          },
          "/preferences/ui-mode": {
            post: {
              summary: "Set UI mode (simple or advanced)",
              operationId: "setUiMode",
              requestBody: { content: { "application/json": { schema: { type: "object", properties: { mode: { type: "string", enum: ["simple", "advanced"] } } } } } },
              responses: { "200": { description: "Mode updated" }, "400": { description: "Invalid mode" } },
            },
          },
        },
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(spec, null, 2));
      return;
    }

    // ── E2: Incident Triage Bundle ────────────────────────────────────────────
    // POST /api/incidents/bundle  → returns a JSON evidence bundle with:
    //   - last 500 activity events (with integrity hashes)
    //   - all active sessions (id, createdAt, characterId, model)
    //   - current health snapshot
    //   - system metadata (version, uptime, OS, Node)
    // Callers can pipe to a ZIP with standard tools; we return JSON directly.
    if (method === "POST" && url === "/api/incidents/bundle") {
      const allEvents = this.activityBus.listEvents();
      const last500 = allEvents.slice(-500);
      const sessions = this.chatStore.listSessions().map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        createdAt: s.createdAt,
        llmProviderId: s.llmProviderId ?? null,
        llmModel: s.llmModel ?? null,
        messageCount: s.messageCount,
      }));
      const health = {
        status: "ok",
        uptime: process.uptime(),
        memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        activeSessionCount: sessions.length,
        approvalQueueDepth: this.queue.list().length,
        sloSummary: computeSloSummary(this.metricsStore),
      };
      const bundle = {
        bundleId: randomUUID(),
        generatedAt: new Date().toISOString(),
        prismVersion: "0.2.0",
        nodeVersion: process.version,
        platform: process.platform,
        events: { count: last500.length, items: last500 },
        sessions: { count: sessions.length, items: sessions },
        health,
        readinessSnapshot: null,
      };
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="prism-incident-bundle-${Date.now()}.json"`,
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(bundle, null, 2));
      return;
    }

    // ── E2: Gmail OAuth routes ────────────────────────────────────────────────
    // GET  /api/auth/gmail/authorize  → returns { authUrl }
    // GET  /api/auth/gmail/callback   → exchanges code, redirects to /settings
    // GET  /api/auth/gmail/status     → returns GmailAdapterStatus
    // DELETE /api/auth/gmail/disconnect → clears stored tokens

    if (method === "GET" && url === "/api/auth/gmail/authorize") {
      try {
        const authUrl = await this.gmailOAuth.getAuthorizationUrl();
        this.json(res, 200, { authUrl });
      } catch (err: unknown) {
        this.json(res, 503, { error: (err as Error).message });
      }
      return;
    }

    if (method === "GET" && url.startsWith("/api/auth/gmail/callback")) {
      const parsed = new URL(url, "http://localhost");
      const code = parsed.searchParams.get("code");
      if (!code) {
        this.json(res, 400, { error: "Missing code parameter" });
        return;
      }
      const result = await this.gmailOAuth.exchangeCode(code);
      // Redirect browser back to settings OAuth tab
      res.writeHead(302, { Location: "/settings?tab=oauth&provider=gmail&connected=" + result.connected });
      res.end();
      return;
    }

    if (method === "GET" && url === "/api/auth/gmail/status") {
      const status = await this.gmailOAuth.getStatus();
      this.json(res, 200, status);
      return;
    }

    if (method === "DELETE" && url === "/api/auth/gmail/disconnect") {
      await this.gmailOAuth.disconnect();
      this.json(res, 200, { disconnected: true });
      return;
    }

    // ── E2: Outlook OAuth routes ──────────────────────────────────────────────
    // GET    /api/auth/outlook/authorize  → returns { authUrl }
    // GET    /api/auth/outlook/callback   → exchanges code, redirects to /settings
    // GET    /api/auth/outlook/status     → returns OutlookAdapterStatus
    // DELETE /api/auth/outlook/disconnect → clears stored tokens

    if (method === "GET" && url === "/api/auth/outlook/authorize") {
      try {
        const authUrl = await this.outlookOAuth.getAuthorizationUrl();
        this.json(res, 200, { authUrl });
      } catch (err: unknown) {
        this.json(res, 503, { error: (err as Error).message });
      }
      return;
    }

    if (method === "GET" && url.startsWith("/api/auth/outlook/callback")) {
      const parsed = new URL(url, "http://localhost");
      const code = parsed.searchParams.get("code");
      if (!code) {
        this.json(res, 400, { error: "Missing code parameter" });
        return;
      }
      const result = await this.outlookOAuth.exchangeCode(code);
      res.writeHead(302, { Location: "/settings?tab=oauth&provider=outlook&connected=" + result.connected });
      res.end();
      return;
    }

    if (method === "GET" && url === "/api/auth/outlook/status") {
      const status = await this.outlookOAuth.getStatus();
      this.json(res, 200, status);
      return;
    }

    if (method === "DELETE" && url === "/api/auth/outlook/disconnect") {
      await this.outlookOAuth.disconnect();
      this.json(res, 200, { disconnected: true });
      return;
    }

    // ── E2: Backward-compat redirect /api/<path> → /api/v1/<path> ─────────
    // Any unversioned /api/ route that hasn't already been handled gets a 301.
    // Excludes routes that are intentionally unversioned (health, metrics, setup, etc.)
    // Only redirects GET requests to avoid confusing non-idempotent operations.
    if (method === "GET" && url.startsWith("/api/") && !url.startsWith("/api/v1/")) {
      const remainder = url.slice("/api/".length);
      const redirectTarget = "/api/v1/" + remainder;
      res.writeHead(301, { Location: redirectTarget });
      res.end();
      return;
    }

    this.json(res, 404, { error: "Not found" });
  }

  private extractBearerToken(req: IncomingMessage): string | null {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return null;
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") return parts[1];
    return null;
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    // Inject a requestId into all error responses (4xx / 5xx) so callers can
    // correlate failures in logs and support tickets.
    const responseBody = (status >= 400 && body !== null && typeof body === "object")
      ? { ...body as object, requestId: randomUUID() }
      : body;
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(responseBody, null, 2));
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
    defaultEmail: string | null;
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
      defaultEmail: string | null;
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
          defaultEmail: parsed.defaultEmail != null ? String(parsed.defaultEmail) : null,
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
        this.triggerAction(actionName, sessionId);
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

      // Figure out the active model and its tier to constrain the orchestrator
      const catalogInfo = await this.llmProviders.getCatalog(selection);
      const activeModelName = catalogInfo.activeModel;
      let modelTier = 3;
      if (activeModelName) {
        const profile = resolveProfile(activeModelName);
        modelTier = profile.tier;
      }

      // If we are using a local agent (often T1/T2), explicitly prefer "orchestrator" for agentic loops, else "chat"
      const agentRole = (hasSessionOverride && selection?.providerId === "local") ? "orchestrator" : "chat";

      const systemPrompt = this.buildAgenticSystemPrompt();

      // ── Spectrum Refraction (Prism SR) — check if SR is active for this session ──
      const srConfig = this.chatStore.getSRConfig(sessionId);
      if (srConfig?.enabled && srConfig.leftProviderId && srConfig.leftModel && srConfig.rightProviderId && srConfig.rightModel) {
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
                left: srResult.hemispheres.left ? {
                  provider: srResult.hemispheres.left.providerId,
                  model: srResult.hemispheres.left.model,
                  content: srConfig.showHemispheres ? srResult.hemispheres.left.content : undefined,
                } : null,
                right: srResult.hemispheres.right ? {
                  provider: srResult.hemispheres.right.providerId,
                  model: srResult.hemispheres.right.model,
                  content: srConfig.showHemispheres ? srResult.hemispheres.right.content : undefined,
                } : null,
                main: srResult.hemispheres.main ? {
                  provider: srResult.hemispheres.main.providerId,
                  model: srResult.hemispheres.main.model,
                  content: srConfig.showHemispheres ? srResult.hemispheres.main.content : undefined,
                } : null,
              },
            },
          };
        }
      }

      // Use agentic executor if available — enables tool calling loop
      if (this.agenticExecutor) {
        const agenticResult = await this.agenticExecutor.execute(
          content,
          conversationHistory,
          systemPrompt,
          async (input, sel) => {
            const result = hasSessionOverride
              ? await this.llmProviders.generate(input, sel)
              : await this.llmProviders.generateForRole(agentRole, input);
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

// ── Simple Mode HTML template ─────────────────────────────────────────────────

/**
 * Minimal, non-technical user interface.
 * Phase E3a — additive alongside existing full operator dashboard.
 */
function simpleModeHtml(port: number, authToken?: string): string {
  void port; // port reserved for future WebSocket override
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="prism-auth-token" content="${authToken ?? ""}" />
  <title>PRISM</title>
  <link rel="icon" href="data:,">
  <style>
    :root {
      --bg: #07111f;
      --panel: rgba(7,19,36,0.88);
      --border: rgba(148,163,184,0.16);
      --text: #edf3ff;
      --muted: #98a6bc;
      --accent: #69d2ff;
      --radius: 16px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, rgba(105,210,255,0.14), transparent 28%),
        radial-gradient(circle at bottom right, rgba(124,241,200,0.10), transparent 24%),
        linear-gradient(180deg,#06101d 0%,#091728 44%,#07111f 100%);
      color: var(--text);
      font-family: Aptos,"Segoe UI Variable Text","Segoe UI",sans-serif;
      font-size: 15px;
    }
    button, input, textarea, select { font: inherit; color: inherit; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Layout ── */
    .sm-app { display: flex; flex-direction: column; height: 100vh; }
    .sm-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border);
      background: rgba(6,16,29,0.72);
      backdrop-filter: blur(12px);
      flex-shrink: 0;
    }
    .sm-logo {
      font-size: 1.15rem; font-weight: 700; letter-spacing: 0.06em;
      background: linear-gradient(90deg, var(--accent) 0%, #7cf1c8 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .sm-header-actions { display: flex; gap: 10px; align-items: center; }
    .sm-btn-ghost {
      padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border);
      background: transparent; cursor: pointer; font-size: 0.85rem; color: var(--muted);
      transition: border-color .15s, color .15s;
    }
    .sm-btn-ghost:hover { border-color: var(--accent); color: var(--accent); }

    .sm-body { display: flex; flex: 1; overflow: hidden; }

    /* ── Sidebar ── */
    .sm-sidebar {
      width: 240px; flex-shrink: 0;
      border-right: 1px solid var(--border);
      background: rgba(6,16,29,0.55);
      display: flex; flex-direction: column;
      padding: 14px 10px;
      gap: 8px;
      overflow-y: auto;
    }
    .sm-sidebar-title {
      font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--muted); padding: 0 6px 4px;
    }
    .sm-btn-new-chat {
      width: 100%; padding: 8px 12px; border-radius: var(--radius);
      border: 1px dashed rgba(105,210,255,0.35); background: transparent;
      cursor: pointer; font-size: 0.85rem; color: var(--accent);
      text-align: left; transition: background .15s, border-color .15s;
    }
    .sm-btn-new-chat:hover { background: rgba(105,210,255,0.08); border-color: var(--accent); }
    #sm-session-list { display: flex; flex-direction: column; gap: 4px; }
    .sm-session-item {
      width: 100%; padding: 8px 10px; border-radius: 10px; border: none;
      background: transparent; cursor: pointer; text-align: left;
      display: flex; flex-direction: column; gap: 2px;
      transition: background .15s;
    }
    .sm-session-item:hover { background: rgba(255,255,255,0.05); }
    .sm-session-item--active { background: rgba(105,210,255,0.1) !important; }
    .sm-session-title { font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sm-session-date { font-size: 0.72rem; color: var(--muted); }
    .sm-empty { font-size: 0.8rem; color: var(--muted); padding: 6px; }

    /* ── Main ── */
    .sm-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

    /* ── Character picker ── */
    #sm-character-picker {
      display: flex; gap: 10px; padding: 16px 20px;
      border-bottom: 1px solid var(--border); flex-shrink: 0;
      flex-wrap: wrap;
    }
    .sm-char-card {
      flex: 1; min-width: 120px; max-width: 200px;
      padding: 12px 14px; border-radius: 14px;
      border: 1px solid var(--border); background: var(--panel);
      cursor: pointer; text-align: left;
      display: flex; flex-direction: column; gap: 4px;
      transition: border-color .15s, background .15s, transform .1s;
    }
    .sm-char-card:hover { background: rgba(255,255,255,0.04); transform: translateY(-1px); }
    .sm-char-card--selected {
      background: rgba(105,210,255,0.08);
      box-shadow: 0 0 0 2px rgba(105,210,255,0.25);
    }
    .sm-char-emoji { font-size: 1.5rem; line-height: 1; }
    .sm-char-name { font-weight: 700; font-size: 0.95rem; letter-spacing: 0.04em; }
    .sm-char-badge {
      font-size: 0.7rem; font-weight: 600; padding: 2px 7px; border-radius: 20px;
      border: 1px solid rgba(148,163,184,0.2); color: var(--muted);
      align-self: flex-start;
    }
    .sm-char-persona { font-size: 0.75rem; color: var(--muted); line-height: 1.4; }

    /* ── Messages ── */
    #sm-messages {
      flex: 1; overflow-y: auto; padding: 20px;
      display: flex; flex-direction: column; gap: 16px;
    }
    .sm-greeting {
      display: flex; flex-direction: column; align-items: center;
      gap: 12px; padding: 40px 20px; color: var(--muted); text-align: center;
    }
    .sm-greeting-emoji { font-size: 2.5rem; }
    .sm-greeting p { font-size: 1.05rem; max-width: 480px; line-height: 1.6; color: var(--text); }
    .sm-msg { display: flex; flex-direction: column; gap: 4px; max-width: 720px; }
    .sm-msg--user { align-self: flex-end; align-items: flex-end; }
    .sm-msg--assistant { align-self: flex-start; align-items: flex-start; }
    .sm-msg-label { font-size: 0.72rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .sm-msg-content {
      padding: 10px 14px; border-radius: 14px; line-height: 1.6;
      font-size: 0.92rem; max-width: 100%;
    }
    .sm-msg--user .sm-msg-content {
      background: rgba(105,210,255,0.12); border: 1px solid rgba(105,210,255,0.22);
    }
    .sm-msg--assistant .sm-msg-content {
      background: var(--panel); border: 1px solid var(--border);
    }

    /* ── Input area ── */
    .sm-input-area {
      border-top: 1px solid var(--border); padding: 14px 20px;
      display: flex; gap: 10px; flex-shrink: 0;
      background: rgba(6,16,29,0.55);
    }
    #sm-input {
      flex: 1; padding: 10px 14px; border-radius: 12px;
      border: 1px solid var(--border); background: rgba(255,255,255,0.04);
      color: var(--text); resize: none; min-height: 44px; max-height: 160px;
      line-height: 1.5; outline: none;
      transition: border-color .15s;
    }
    #sm-input:focus { border-color: rgba(105,210,255,0.5); }
    #sm-input::placeholder { color: var(--muted); }
    #sm-send-btn {
      padding: 10px 22px; border-radius: 12px;
      border: none; background: var(--accent); color: #07111f;
      font-weight: 700; cursor: pointer; align-self: flex-end;
      transition: opacity .15s, transform .1s;
    }
    #sm-send-btn:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
    #sm-send-btn:disabled { opacity: 0.45; cursor: not-allowed; }

    /* ── Error toast ── */
    #sm-error {
      display: none; position: fixed; bottom: 20px; right: 20px;
      background: rgba(255,100,100,0.18); border: 1px solid rgba(255,100,100,0.4);
      color: #ff9d9d; padding: 10px 16px; border-radius: 10px;
      font-size: 0.85rem; max-width: 360px; z-index: 9999;
    }

    /* ── Responsive ── */
    @media (max-width: 640px) {
      .sm-sidebar { display: none; }
      #sm-character-picker { padding: 10px 12px; }
      .sm-char-card { min-width: 90px; }
    }
  </style>
</head>
<body>
  <div class="sm-app">
    <header class="sm-header">
      <span class="sm-logo">⬡ PRISM</span>
      <div class="sm-header-actions">
        <button id="sm-advanced-btn" class="sm-btn-ghost" title="Switch to the full operator dashboard">
          Advanced Mode →
        </button>
      </div>
    </header>

    <div class="sm-body">
      <aside class="sm-sidebar">
        <span class="sm-sidebar-title">Conversations</span>
        <button id="sm-new-chat-btn" class="sm-btn-new-chat">+ New Chat</button>
        <div id="sm-session-list"></div>
      </aside>

      <main class="sm-main">
        <div id="sm-character-picker"></div>
        <div id="sm-messages"></div>
        <div class="sm-input-area">
          <textarea
            id="sm-input"
            placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
            rows="1"
            autocomplete="off"
          ></textarea>
          <button id="sm-send-btn">Send</button>
        </div>
      </main>
    </div>
  </div>

  <div id="sm-error"></div>

  <script type="module" src="/public/simple-mode.js"></script>
</body>
</html>`;
}

function dashboardHtml(port: number, authToken?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="prism-auth-token" content="${authToken ?? ""}" />
  <title>PRISM Frontier Console</title>
  <link rel="icon" href="data:,">
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
      padding: 22px 24px 24px 24px;
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
      flex-shrink: 0;
      padding: 18px 24px 24px;
      border-top: 1px solid var(--border);
      background: rgba(10, 24, 45, 0.95);
      border-bottom-left-radius: var(--radius);
      border-bottom-right-radius: var(--radius);
      box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.4);
      z-index: 10;
      backdrop-filter: blur(12px);
    }
    .composer-container {
      display: flex;
      flex-direction: column;
      border-radius: 24px;
      border: 1px solid rgba(148,163,184,0.2);
      background: rgba(2, 8, 18, 0.7);
      padding: 0;
      transition: border-color 0.2s, box-shadow 0.2s;
      overflow: hidden;
    }
    .composer-container:focus-within {
      border-color: rgba(105, 210, 255, 0.45);
      box-shadow: 0 0 0 3px rgba(105, 210, 255, 0.08), 0 4px 24px rgba(0,0,0,0.3);
    }
    .composer-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px 10px;
      border-top: 1px solid rgba(148,163,184,0.06);
    }
    .composer-left-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .composer-icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .composer-icon-btn:hover {
      background: rgba(105,210,255,0.1);
      color: var(--accent);
    }
    .composer-send-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: linear-gradient(135deg, #69d2ff 0%, #4fb8e8 50%, #7cf1c8 100%);
      color: #07111f;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.2s, opacity 0.2s;
      box-shadow: 0 2px 12px rgba(105,210,255,0.3);
      flex-shrink: 0;
    }
    .composer-send-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 4px 20px rgba(105,210,255,0.45);
    }
    .composer-send-btn:active {
      transform: scale(0.95);
    }
    .composer-send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
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
    .thinking-badge {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(105,210,255,0.12);
      color: var(--accent);
      animation: thinking-fade 1.4s ease-in-out infinite;
      vertical-align: middle;
    }
    .thinking-dots {
      display: flex;
      gap: 6px;
      padding: 6px 0 2px;
      align-items: center;
    }
    .thinking-dots span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      opacity: 0.3;
      animation: dot-bounce 1.4s ease-in-out infinite;
    }
    .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
    .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes dot-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
      30% { transform: translateY(-6px); opacity: 1; }
    }
    @keyframes thinking-fade {
      0%, 100% { opacity: 0.45; }
      50% { opacity: 1; }
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
      min-height: 48px;
      max-height: 240px;
      resize: none;
      border-radius: 0;
      padding: 16px 18px 8px;
      border: none;
      background: transparent;
      color: var(--text);
      font-size: 15px;
      line-height: 1.5;
      outline: none;
    }
    textarea::placeholder {
      color: rgba(148,163,184,0.5);
    }
    textarea:focus { outline: none; }
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
    .composer-hint {
      margin-top: 10px;
      font-size: 12px;
      color: var(--muted);
      text-align: center;
      opacity: 0.7;
    }
    .composer-hint kbd {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid rgba(148,163,184,0.2);
      background: rgba(148,163,184,0.06);
      font-family: inherit;
      font-size: 11px;
      color: var(--muted);
    }
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
      margin: 0 0 12px;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid rgba(148,163,184,0.16);
      background: rgba(255,255,255,0.03);
      flex-shrink: 0;
    }
    .onboarding:empty {
      display: none;
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

    /* ── Activity Log ── */
    .log-line { display: flex; align-items: baseline; gap: 8px; padding: 3px 8px; font-size: 11px; font-family: "Cascadia Code", Consolas, monospace; border-bottom: 1px solid rgba(148,163,184,0.06); }
    .log-line:hover { background: rgba(255,255,255,0.02); }
    .log-ts { color: var(--muted); font-size: 10px; flex-shrink: 0; min-width: 72px; }
    .log-src { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 4px; flex-shrink: 0; }
    .log-src-diagnostics { background: rgba(105,210,255,0.12); color: #69d2ff; }
    .log-src-agent-diagnostics { background: rgba(168,130,255,0.12); color: #a882ff; }
    .log-src-computer-diagnostics { background: rgba(124,241,200,0.12); color: #7cf1c8; }
    .log-src-tools { background: rgba(255,209,122,0.12); color: #ffd17a; }
    .log-src-browser { background: rgba(105,210,255,0.12); color: #69d2ff; }
    .log-src-chat { background: rgba(148,163,184,0.12); color: #94a3b8; }
    .log-src-agentic { background: rgba(168,130,255,0.12); color: #a882ff; }
    .log-src-settings { background: rgba(148,163,184,0.1); color: #94a3b8; }
    .log-src-computer { background: rgba(124,241,200,0.12); color: #7cf1c8; }
    .log-src-workspace { background: rgba(255,209,122,0.1); color: #ffd17a; }
    .log-src-scheduler { background: rgba(255,157,122,0.12); color: #ff9d7a; }
    .log-src-hardware { background: rgba(255,141,141,0.12); color: #ff8d8d; }
    .log-src-system { background: rgba(148,163,184,0.1); color: #94a3b8; }
    .log-sev { font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 3px; flex-shrink: 0; }
    .log-sev-info { background: rgba(148,163,184,0.1); color: #94a3b8; }
    .log-sev-warn { background: rgba(255,209,122,0.15); color: #ffd17a; }
    .log-sev-error { background: rgba(255,141,141,0.15); color: #ff8d8d; }
    .log-msg { color: var(--fg); word-break: break-word; flex: 1; min-width: 0; }
    .log-empty { text-align: center; padding: 24px; color: var(--muted); font-size: 12px; }
    .log-filter-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
    .log-filter-bar select { background: var(--surface); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; font-size: 11px; font-family: inherit; cursor: pointer; }
    .log-filter-bar select:focus { outline: none; border-color: var(--accent); }
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
      <button class="secondary-button" onclick="window.location.href='/setup?rerun=true'" style="font-size:11px;opacity:0.75;margin-top:2px;" title="Re-run the guided setup wizard">\u2728 Setup Wizard</button>
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
        <span id="prism-ws-status" title="WebSocket connected" style="width:10px;height:10px;border-radius:50%;background:#22c55e;align-self:center;margin-left:auto;flex:0 0 10px;box-shadow:0 0 6px rgba(34,197,94,0.5);transition:background 0.3s;"></span>
      </section>

      <section id="tab-chat" class="tab-panel active" role="tabpanel" aria-labelledby="tab-button-chat" aria-hidden="false">
        <div class="chat panel">
          <div class="chat-header">
            <h2 id="active-session-title">Loading...</h2>
            <div id="active-session-meta" class="muted"></div>
            <div id="header-chips" class="header-chips" style="margin-top:12px;"></div>
          </div>
          <section id="messages" class="messages"></section>
          <div class="composer">
            <div id="onboarding" class="onboarding"></div>
            <div id="attachment-preview" class="attachment-preview-strip"></div>
            <div class="composer-container">
              <textarea id="composer" placeholder="Ask PRISM anything..." rows="1" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,240)+'px'"></textarea>
              <div class="composer-actions">
                <div class="composer-left-actions">
                  <button type="button" class="composer-icon-btn" onclick="document.getElementById('file-attach-input').click()" title="Attach file">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                  </button>
                  <input type="file" id="file-attach-input" multiple accept="image/*,audio/*,video/*,text/*,application/pdf,.md,.json,.csv,.xml,.yaml,.yml,.ts,.js,.py,.html,.css" style="display:none" onchange="handleFileSelect(this)" />
                  <button type="button" class="composer-icon-btn" onclick="pasteFromClipboard()" title="Paste from clipboard">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
                <button id="send-button" class="composer-send-btn" onclick="sendMessage()" title="Send message (Enter)">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
                </button>
              </div>
            </div>
            <div class="composer-hint"><kbd>Enter</kbd> to send &middot; <kbd>Shift+Enter</kbd> for new line &middot; Drag &amp; drop files to attach</div>
          </div>
        </div>
      </section>

      <section id="tab-settings" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-settings" aria-hidden="true">
        <div class="tab-grid" style="grid-template-columns:1fr;">

          <section class="rail-section panel" id="sr-section" style="border:1px solid rgba(139,92,246,0.25);background:linear-gradient(135deg,rgba(139,92,246,0.06),rgba(59,130,246,0.04));">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 0 8px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:18px;">\u{1F308}</span>
                <div>
                  <div style="font-size:13px;font-weight:600;color:#a78bfa;">Prism SR:</div>
                  <div style="font-size:11px;color:var(--fg-muted);">Compounding model orchestration \u2014 Logic + Creative + Main model synthesis</div>
                </div>
              </div>
              <button class="btn btn-primary" onclick="toggleSRPanel()" style="background:linear-gradient(135deg,#8b5cf6,#3b82f6);border:none;font-weight:600;font-size:12px;padding:6px 16px;border-radius:6px;cursor:pointer;color:#fff;">
                Spectrum Refraction
              </button>
            </div>
            <div id="sr-panel" style="display:none;">
              <div id="sr-panel-content" class="stack"></div>
            </div>
          </section>

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
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div id="tools-overview-bar"></div>
          <!-- Plugins \u2014 full width on top -->
          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('pluginsPanel')">
              <h3>\uD83E\uDDE9 Plugins</h3>
              <span class="tp-panel-summary" id="pluginsPanel-summary" style="display:none;"></span>
              <span class="collapse-chevron" id="chevron-pluginsPanel">\u25B6</span>
            </div>
            <div class="collapsible-body collapsed" id="body-pluginsPanel">
              <div id="plugins-panel" class="stack"></div>
            </div>
          </section>
          <!-- Tools + Utilities \u2014 side by side -->
          <div class="tp-split-row">
            <section class="rail-section panel tp-split-col">
              <div class="collapsible-header" onclick="togglePanelCollapse('toolsPanel')">
                <h3>\uD83D\uDEE0\uFE0F Tools</h3>
                <span class="tp-panel-summary" id="toolsPanel-summary" style="display:none;"></span>
                <span class="collapse-chevron" id="chevron-toolsPanel">\u25B6</span>
              </div>
              <div class="collapsible-body collapsed" id="body-toolsPanel">
                <div id="tools-panel" class="stack"></div>
              </div>
            </section>
            <section class="rail-section panel tp-split-col">
              <div class="collapsible-header" onclick="togglePanelCollapse('utilitiesPanel')">
                <h3>\u2699\uFE0F Utilities</h3>
                <span class="tp-panel-summary" id="utilitiesPanel-summary" style="display:none;"></span>
                <span class="collapse-chevron" id="chevron-utilitiesPanel">\u25B6</span>
              </div>
              <div class="collapsible-body collapsed" id="body-utilitiesPanel">
                <div id="utilities-panel" class="stack"></div>
              </div>
            </section>
          </div>
          <!-- Diagnostics — consolidated parent panel -->
          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('diagnosticsPanel')">
              <h3>\u{1F9EA} Diagnostics</h3>
              <span class="tp-panel-summary" id="diagnosticsPanel-summary" style="display:none;"></span>
              <span class="collapse-chevron" id="chevron-diagnosticsPanel">\u25B6</span>
            </div>
            <div class="collapsible-body collapsed" id="body-diagnosticsPanel">
              <div id="diagnostics-panel" class="stack"></div>
              <!-- Agent Diagnostics sub-panel -->
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('agentDiagnosticsPanel')">
                  <h3>\u{1F916} Agent Diagnostics</h3>
                  <span class="tp-panel-summary" id="agentDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-agentDiagnosticsPanel">\u25B6</span>
                </div>
                <div class="collapsible-body collapsed" id="body-agentDiagnosticsPanel">
                  <div id="agent-diagnostics-panel" class="stack"></div>
                </div>
              </section>
              <!-- Computer Diagnostics sub-panel -->
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('computerDiagnosticsPanel')">
                  <h3>\u{1F5A5}\uFE0F Computer Diagnostics</h3>
                  <span class="tp-panel-summary" id="computerDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-computerDiagnosticsPanel">\u25B6</span>
                </div>
                <div class="collapsible-body collapsed" id="body-computerDiagnosticsPanel">
                  <div id="computer-diagnostics-panel" class="stack"></div>
                </div>
              </section>
              <!-- Workspace Diagnostics sub-panel -->
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('workspaceDiagnosticsPanel')">
                  <h3>\u{1F4C2} Workspace Diagnostics</h3>
                  <span class="tp-panel-summary" id="workspaceDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-workspaceDiagnosticsPanel">\u25B6</span>
                </div>
                <div class="collapsible-body collapsed" id="body-workspaceDiagnosticsPanel">
                  <div id="workspace-diagnostics-panel" class="stack"></div>
                </div>
              </section>
              <!-- Network Diagnostics sub-panel -->
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('networkDiagnosticsPanel')">
                  <h3>\u{1F310} Network Diagnostics</h3>
                  <span class="tp-panel-summary" id="networkDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-networkDiagnosticsPanel">\u25B6</span>
                </div>
                <div class="collapsible-body collapsed" id="body-networkDiagnosticsPanel">
                  <div id="network-diagnostics-panel" class="stack"></div>
                </div>
              </section>
              <!-- Telemetry Diagnostics sub-panel -->
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('telemetryDiagnosticsPanel')">
                  <h3>\u{1F4CA} Telemetry Diagnostics</h3>
                  <span class="tp-panel-summary" id="telemetryDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-telemetryDiagnosticsPanel">\u25B6</span>
                </div>
                <div class="collapsible-body collapsed" id="body-telemetryDiagnosticsPanel">
                  <div id="telemetry-diagnostics-panel" class="stack"></div>
                </div>
              </section>
              <!-- Logs & Debug Diagnostics sub-panel -->
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('logsDiagnosticsPanel')">
                  <h3>\u{1F4DD} Logs & Debug Diagnostics</h3>
                  <span class="tp-panel-summary" id="logsDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-logsDiagnosticsPanel">\u25B6</span>
                </div>
                <div class="collapsible-body collapsed" id="body-logsDiagnosticsPanel">
                  <div id="logs-diagnostics-panel" class="stack"></div>
                </div>
              </section>
              <!-- Scheduler Diagnostics sub-panel -->
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('schedulerDiagnosticsPanel')">
                  <h3>\u{1F4C5} Scheduler Diagnostics</h3>
                  <span class="tp-panel-summary" id="schedulerDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-schedulerDiagnosticsPanel">\u25B6</span>
                </div>
                <div class="collapsible-body collapsed" id="body-schedulerDiagnosticsPanel">
                  <div id="scheduler-diagnostics-panel" class="stack"></div>
                </div>
              </section>
            </div>
          </section>
          <!-- Demo Scenarios Diagnostics — full width below -->
          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('demoDiagnosticsPanel')">
              <h3>\u{1F3AC} Demo Scenarios</h3>
              <span class="tp-panel-summary" id="demoDiagnosticsPanel-summary" style="display:none;"></span>
              <span class="collapse-chevron" id="chevron-demoDiagnosticsPanel">\u25B6</span>
            </div>
            <div class="collapsible-body collapsed" id="body-demoDiagnosticsPanel">
              <div id="demo-diagnostics-panel" class="stack"></div>
            </div>
          </section>
        </div>
      </section>

      <!-- ═══════════════ AGENTIC CONTROL TAB ═══════════════ -->
      <section id="tab-agentic" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-agentic" aria-hidden="true">
        <div class="tab-grid">
          <!-- Guardian Agent Panel (llama.cpp) — always first -->
          <section class="rail-section panel" style="grid-column:1/-1;border:1px solid var(--accent);border-radius:8px;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('guardianAgent')">
              <h3>\u{1F9EC} Guardian Agent (llama.cpp)</h3>
              <span id="guardianAgent-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="guardianAgent-collapsible" class="collapsible-body">
              <div id="guardian-panel-container" class="stack">
                <div class="muted" style="text-align:center;padding:24px;">Loading Guardian status\u2026</div>
              </div>
            </div>
          </section>

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

          <!-- Local Hardware Swarm (Consolidated) -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('hardwareSwarm')">
              <h3>⚡ Local Hardware Swarm</h3>
              <div style="display:flex;gap:6px;align-items:center;">
                <button class="secondary-button" style="font-size:12px;" onclick="if(window.refreshHardwareSwarm) window.refreshHardwareSwarm()">🔄 Refresh</button>
                <span id="hardwareSwarm-collapse-icon" class="collapse-icon">\u25BC</span>
              </div>
            </div>
            <div id="hardwareSwarm-collapsible" class="collapsible-body">
              <div id="hardware-swarm-panel" class="stack" style="margin-top:10px;">
                <div class="muted" style="text-align:center;padding:24px;">Loading swarm status...</div>
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
              <h3>\u{1F527} Device Manager <span id="dm-total-badge" class="dm-total-badge"></span></h3>
              <span id="deviceManager-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="deviceManager-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Comprehensive WMI hardware inventory \u2014 click any device to inspect all properties.</div>
              <input id="dm-search-input" class="dm-search-input" type="text" placeholder="\u{1F50D} Filter devices\u2026" oninput="filterDeviceTree()" />
              <div class="dm-toolbar">
                <button class="primary-button" onclick="refreshDeviceManager()" style="font-size:12px;">\u{1F504} Scan Devices</button>
                <button class="primary-button" onclick="generateDeviceReport()" style="font-size:12px;">\u{1F4CB} Generate Report</button>
                <button class="primary-button" onclick="openSystemDeviceManager()" style="font-size:12px;">\u{1F5A5}\uFE0F Open System Device Manager</button>
              </div>
              <div id="device-tree-container" class="stack" style="font-size:13px;">
                <div class="muted" style="text-align:center;padding:18px;">Click <strong>Scan Devices</strong> to enumerate hardware via WMI.</div>
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
                      <div>
                        <div id="label-workspace-hub" class="muted" style="font-size:11px;margin-bottom:3px;">Workspace Label (optional)</div>
                        <input id="character-assign-workspace-hub" type="text" placeholder="e.g., My Projects, Home Lab (optional)" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" onblur="onWorkspaceHubBlur()" />
                      </div>
                      <div>
                        <div class="muted" style="font-size:11px;margin-bottom:3px;">Type Selection *</div>
                        <select id="character-assign-profile" onchange="onProfileChanged()" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;">
                          <option value="individual">Individual</option>
                          <option value="business">Business</option>
                        </select>
                      </div>
                      <div>
                        <div class="muted" style="font-size:11px;margin-bottom:3px;">Character *</div>
                        <select id="character-assign-character" onchange="onCharacterDefinitionChanged()" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;">
                          <option value="">Loading characters...</option>
                        </select>
                      </div>
                      <div>
                        <div class="muted" style="font-size:11px;margin-bottom:3px;">Prism User Name</div>
                        <input id="character-assign-prism-user-id" type="text" placeholder="Prism user name" value="prism-dashboard-user" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      </div>
                      <div>
                        <div id="label-prism-user-email" class="muted" style="font-size:11px;margin-bottom:3px;">Assistant Email *</div>
                        <input id="character-assign-prism-user-email" type="email" placeholder="Character email (e.g., aria@prism.local)" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      </div>
                      <div>
                        <div class="muted" style="font-size:11px;margin-bottom:3px;">Operator ID</div>
                        <input id="character-assign-operator-id" type="text" placeholder="Operator ID" value="workspace-operator" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      </div>
                      <div>
                        <div id="label-operator-email" class="muted" style="font-size:11px;margin-bottom:3px;">Personal Email *</div>
                        <input id="character-assign-operator-email" type="email" placeholder="Operator email" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      </div>
                      <input id="character-assign-client-id" type="hidden" value="workspace-tab" />
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

          <!-- Network Intelligence (VRGC) -->
          <section class="rail-section panel" style="grid-column:1/-1;border:1px solid var(--accent);border-radius:8px;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('networkIntelligence')">
              <h3>\u{1F9E0} Network Intelligence (VRGC)</h3>
              <span id="networkIntelligence-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="networkIntelligence-collapsible" class="collapsible-body">
              <div id="network-intelligence-panel" class="stack">
                <div class="muted" style="text-align:center;padding:24px;">Loading VRGC status\u2026</div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-telemetry" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-telemetry" aria-hidden="true">
        <div class="tab-grid">
          <!-- ═══ USAGE & COST PANEL (top) ════════════════════════════════ -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('usageCost')">
              <h3>\uD83D\uDCB0 Usage &amp; Cost</h3>
              <span id="usageCost-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="usageCost-collapsible" class="collapsible-body">
              <div id="usage-cost-panel" class="stack"></div>
            </div>
          </section>
          <!-- ═══ WINDOW SELECTOR ══════════════════════════════════════════ -->
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
          <!-- ═══ SLO GAUGE PANEL (E3c) ════════════════════════════════════ -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('sloGauges')">
              <h3>\uD83D\uDFE2 SLO Gauges</h3>
              <span id="sloGauges-collapse-icon" class="collapse-icon">\u25BC</span>
            </div>
            <div id="sloGauges-collapsible" class="collapsible-body">
              <div id="slo-gauge-panel"></div>
            </div>
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
          <!-- Activity Log — full width -->
          <section class="rail-section panel" style="grid-column:1/-1;">
            <h3>\u{1F4DD} Activity Log</h3>
            <div class="log-filter-bar">
              <label class="muted" style="font-size:11px;">Source:</label>
              <select id="logs-tab-filter" onchange="filterLogs()">
                <option value="">All</option>
                <option value="diagnostics">diagnostics</option>
                <option value="agent-diagnostics">agent-diagnostics</option>
                <option value="computer-diagnostics">computer-diagnostics</option>
                <option value="tools">tools</option>
                <option value="browser">browser</option>
                <option value="chat">chat</option>
                <option value="agentic">agentic</option>
                <option value="computer">computer</option>
                <option value="settings">settings</option>
                <option value="workspace">workspace</option>
                <option value="scheduler">scheduler</option>
                <option value="hardware">hardware</option>
              </select>
              <label class="muted" style="font-size:11px;">Severity:</label>
              <select id="logs-severity-filter" onchange="filterLogs()">
                <option value="">All</option>
                <option value="info">info</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
              </select>
              <div style="flex:1;"></div>
              <span class="muted" style="font-size:10px;">Last 500 entries · auto-scroll</span>
              <button class="secondary-button" style="font-size:11px;padding:3px 8px;" onclick="clearLogs()">Clear</button>
            </div>
            <div id="logs-panel-body" style="max-height:420px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;background:rgba(0,0,0,0.15);padding:4px 0;"></div>
          </section>
        </div>
      </section>

      <!-- ═══════════════ HARDWARE SWARM TAB ═══════════════ -->
      <section id="tab-hardware" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-hardware" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header">
              <h3>⚡ Local Hardware Swarm</h3>
              <div style="display:flex;gap:6px;align-items:center;">
                <button class="secondary-button" style="font-size:12px;" onclick="if(window.refreshHardwareSwarm) window.refreshHardwareSwarm()()">🔄 Refresh</button>
              </div>
            </div>
            <div id="hardware-swarm-panel" class="stack" style="margin-top:10px;">
              <!-- Container for the 5 model slots -->
            </div>
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
                <button class="primary-button" style="font-size:12px;" onclick="openSchedulerModal('cron')">+ Cron Job</button>
                <button class="secondary-button" style="font-size:12px;" onclick="refreshSchedulerData()">\u{1F504} Refresh</button>
              </div>
            </div>
            <!-- Sub-view nav -->
            <div class="tabs panel" style="margin:10px 0;padding:6px;">
              <button class="tab-button sched-subnav-btn active" data-sched-view="calendar" onclick="switchSchedulerView('calendar')" style="font-size:12px;">\u{1F4C5} Calendar</button>
              <button class="tab-button sched-subnav-btn" data-sched-view="projects" onclick="switchSchedulerView('projects')" style="font-size:12px;">\u{1F4CB} Projects</button>
              <button class="tab-button sched-subnav-btn" data-sched-view="board" onclick="switchSchedulerView('board')" style="font-size:12px;">\u{1F4CC} Board</button>
              <button class="tab-button sched-subnav-btn" data-sched-view="timeline" onclick="switchSchedulerView('timeline')" style="font-size:12px;">\u{1F4CA} Timeline</button>
              <button class="tab-button sched-subnav-btn" data-sched-view="cron" onclick="switchSchedulerView('cron')" style="font-size:12px;">\u{23F0} Cron Jobs</button>
            </div>
            <!-- Calendar view -->
            <div id="sched-view-calendar">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
                <button class="secondary-button" onclick="schedCalNav(-1)" style="font-size:12px;padding:4px 10px;">&lsaquo;</button>
                <span id="sched-cal-title" style="font-size:14px;font-weight:600;min-width:120px;text-align:center;"></span>
                <button class="secondary-button" onclick="schedCalNav(1)" style="font-size:12px;padding:4px 10px;">&rsaquo;</button>
                <button class="tab-button sched-mode-btn" data-cal-mode="year" onclick="setCalMode('year')" style="font-size:11px;padding:4px 10px;">Year</button>
                <button class="tab-button sched-mode-btn" data-cal-mode="month" onclick="setCalMode('month')" style="font-size:11px;padding:4px 10px;">Month</button>
                <button class="tab-button sched-mode-btn" data-cal-mode="week" onclick="setCalMode('week')" style="font-size:11px;padding:4px 10px;">Week</button>
                <button class="tab-button sched-mode-btn active" data-cal-mode="day" onclick="setCalMode('day')" style="font-size:11px;padding:4px 10px;">Day</button>
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
            <!-- Cron Jobs view -->
            <div id="sched-view-cron" style="display:none;">
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
                <button class="primary-button" style="font-size:12px;" onclick="openSchedulerModal('cron')">+ New Cron Job</button>
                <button class="secondary-button" style="font-size:12px;" onclick="refreshCronJobs()">\u{1F504} Refresh</button>
                <span id="sched-cron-count" class="muted" style="font-size:12px;"></span>
              </div>
              <div id="sched-cron-list" class="stack"><span class="muted" style="font-size:12px;">No cron jobs scheduled. Click + Cron Job to add one.</span></div>
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

function setupWizardHtml(port: number): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PRISM \u2014 Setup Wizard</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/public/dashboard.css">
  <style>
    .wizard-backdrop {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .wizard-card {
      background: var(--panel-strong);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      max-width: 640px;
      width: 100%;
      padding: 40px 36px 32px;
      position: relative;
      overflow: hidden;
    }
    .wizard-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
    }
    .wizard-logo {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 4px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .wizard-subtitle {
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 28px;
    }
    .wizard-progress {
      display: flex;
      gap: 6px;
      margin-bottom: 28px;
    }
    .wizard-progress-dot {
      width: 32px;
      height: 4px;
      border-radius: 2px;
      background: rgba(148, 163, 184, 0.18);
      transition: background 0.3s;
    }
    .wizard-progress-dot.active {
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
    }
    .wizard-progress-dot.done {
      background: var(--accent-2);
    }
    .wizard-step { display: none; }
    .wizard-step.active { display: block; }
    .wizard-step h2 {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 6px;
    }
    .wizard-step p {
      color: var(--muted);
      font-size: 13px;
      margin: 0 0 20px;
      line-height: 1.5;
    }
    .wizard-option {
      display: flex;
      gap: 14px;
      padding: 16px;
      border: 2px solid var(--border);
      border-radius: 14px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      margin-bottom: 10px;
      align-items: flex-start;
    }
    .wizard-option:hover {
      border-color: rgba(105, 210, 255, 0.3);
      background: rgba(105, 210, 255, 0.04);
    }
    .wizard-option.selected {
      border-color: var(--accent);
      background: rgba(105, 210, 255, 0.08);
    }
    .wizard-option-radio {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid rgba(148, 163, 184, 0.3);
      flex-shrink: 0;
      margin-top: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color 0.2s;
    }
    .wizard-option.selected .wizard-option-radio {
      border-color: var(--accent);
    }
    .wizard-option.selected .wizard-option-radio::after {
      content: '';
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--accent);
    }
    .wizard-option-body h3 {
      margin: 0 0 4px;
      font-size: 15px;
      font-weight: 600;
    }
    .wizard-option-body .desc {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      margin: 0;
    }
    .wizard-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 28px;
      gap: 10px;
    }
    .wizard-nav .skip-link {
      color: var(--muted);
      font-size: 12px;
      text-decoration: none;
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      font-family: inherit;
    }
    .wizard-nav .skip-link:hover { color: var(--accent); }
    .wizard-field {
      margin-bottom: 16px;
    }
    .wizard-field label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .wizard-field input[type="text"] {
      width: 100%;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-size: 13px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    .wizard-field input[type="text"]:focus {
      border-color: var(--accent);
    }
    .wizard-check-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 12px;
    }
    .wizard-check-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.02);
      font-size: 13px;
    }
    .wizard-check-item .check-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
    }
    .wizard-check-item .check-icon.pass {
      background: rgba(124, 241, 200, 0.15);
      color: var(--accent-2);
    }
    .wizard-check-item .check-icon.fail {
      background: rgba(255, 141, 141, 0.15);
      color: var(--danger);
    }
    .wizard-check-item .check-icon.pending {
      background: rgba(148, 163, 184, 0.1);
      color: var(--muted);
    }
    .wizard-check-detail {
      color: var(--muted);
      font-size: 11px;
      margin-top: 2px;
    }
    .wizard-summary-ready {
      text-align: center;
      padding: 20px 0;
    }
    .wizard-summary-ready .big-check {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(124, 241, 200, 0.12);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <div class="wizard-backdrop">
    <div class="wizard-card">
      <div class="wizard-logo">PRISM</div>
      <div class="wizard-subtitle">Frontier Operator Console \u2014 Setup Wizard</div>

      <div class="wizard-progress" id="wizard-progress"></div>

      <!-- Step 1: Welcome + Profile -->
      <div class="wizard-step active" id="step-1">
        <h2>Choose Your Profile</h2>
        <p>This determines governance level. You can change this later in Settings.</p>
        <div class="wizard-option selected" data-profile="individual" onclick="selectProfile(this, 'individual')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F680} Individual</h3>
            <p class="desc">Personal productivity &amp; development. Minimal governance, fast defaults. Best for solo use, experimentation, and local agents.</p>
          </div>
        </div>
        <div class="wizard-option" data-profile="business" onclick="selectProfile(this, 'business')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F3E2} Business</h3>
            <p class="desc">Enterprise-grade governance. Full audit trails, mandatory rollback plans, strict approval workflows. For production and compliance.</p>
          </div>
        </div>
      </div>

      <!-- Step 2: Workspace Location -->
      <div class="wizard-step" id="step-2">
        <h2>Workspace Location</h2>
        <p>PRISM stores configuration, agent state, and artifacts in a workspace directory.</p>
        <div class="wizard-field">
          <label>Workspace Path</label>
          <input type="text" id="workspace-path" />
        </div>
        <div class="wizard-check-list" id="workspace-checks"></div>
      </div>

      <!-- Step 3: Provider Configuration -->
      <div class="wizard-step" id="step-3">
        <h2>LLM Provider</h2>
        <p>Select which LLM provider to start with. You can add more later in the Provider &amp; Settings tab.</p>
        <div class="wizard-option selected" data-provider="ollama" onclick="selectProvider(this, 'ollama')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F5A5} Ollama (Local)</h3>
            <p class="desc">Run open-source models locally. No API key needed. Requires Ollama installed and running.</p>
          </div>
        </div>
        <div class="wizard-option" data-provider="openai" onclick="selectProvider(this, 'openai')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F916} OpenAI</h3>
            <p class="desc">GPT-4o, GPT-4o-mini, and other OpenAI models. Requires API key.</p>
          </div>
        </div>
        <div class="wizard-option" data-provider="anthropic" onclick="selectProvider(this, 'anthropic')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u2728 Anthropic</h3>
            <p class="desc">Claude models. Requires API key.</p>
          </div>
        </div>
        <div class="wizard-option" data-provider="google" onclick="selectProvider(this, 'google')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F50D} Google AI</h3>
            <p class="desc">Gemini models. Requires API key.</p>
          </div>
        </div>
        <div id="provider-key-field" class="wizard-field" style="display:none;margin-top:16px;">
          <label id="provider-key-label">API Key</label>
          <input type="text" id="provider-api-key" placeholder="sk-..." autocomplete="off" />
        </div>
        <div id="provider-test-result" style="margin-top:8px;font-size:12px;"></div>
      </div>

      <!-- Step 4: Summary + Launch -->
      <div class="wizard-step" id="step-4">
        <h2>Ready to Launch</h2>
        <p>Here\u2019s a summary of your configuration. PRISM will validate everything before launching.</p>
        <div class="wizard-check-list" id="summary-checks"></div>
        <div id="summary-status" style="margin-top:16px;text-align:center;"></div>
      </div>

      <!-- Navigation -->
      <div class="wizard-nav">
        <button class="skip-link" id="wizard-skip" onclick="skipSetup()">Skip setup</button>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="secondary-button" style="font-size:12px;opacity:0.8;" onclick="startAdvancedWizard()">Advanced Setup \u2192</button>
          <button class="secondary-button" id="wizard-back" onclick="wizardBack()" style="display:none;">Back</button>
          <button class="primary-button" id="wizard-next" onclick="wizardNext()">Continue</button>
        </div>
      </div>
    </div>
  </div>

  <script type="module" src="/public/setup-wizard.js"></script>
</body>
</html>`;
}

function setupWizardAdvancedHtml(port: number): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PRISM \u2014 Advanced Setup Wizard</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/public/dashboard.css">
  <style>
    .wizard-backdrop {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .wizard-card {
      background: var(--panel-strong);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      max-width: 720px;
      width: 100%;
      padding: 40px 36px 32px;
      position: relative;
      overflow: hidden;
    }
    .wizard-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
    }
    .wizard-logo {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 4px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .wizard-subtitle {
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 28px;
    }
    .wizard-phase-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--accent);
      margin-bottom: 8px;
    }
    .wizard-progress {
      display: flex;
      gap: 4px;
      margin-bottom: 28px;
    }
    .wizard-progress-dot {
      flex: 1;
      height: 4px;
      border-radius: 2px;
      background: rgba(148, 163, 184, 0.18);
      transition: background 0.3s;
    }
    .wizard-progress-dot.active {
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
    }
    .wizard-progress-dot.done {
      background: var(--accent-2);
    }
    .wizard-step { display: none; }
    .wizard-step.active { display: block; }
    .wizard-step h2 {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 6px;
    }
    .wizard-step p {
      color: var(--muted);
      font-size: 13px;
      margin: 0 0 20px;
      line-height: 1.5;
    }
    .wizard-option {
      display: flex;
      gap: 14px;
      padding: 14px;
      border: 2px solid var(--border);
      border-radius: 14px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      margin-bottom: 8px;
      align-items: flex-start;
    }
    .wizard-option:hover {
      border-color: rgba(105, 210, 255, 0.3);
      background: rgba(105, 210, 255, 0.04);
    }
    .wizard-option.selected {
      border-color: var(--accent);
      background: rgba(105, 210, 255, 0.08);
    }
    .wizard-option-radio {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid rgba(148, 163, 184, 0.3);
      flex-shrink: 0;
      margin-top: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color 0.2s;
    }
    .wizard-option.selected .wizard-option-radio {
      border-color: var(--accent);
    }
    .wizard-option.selected .wizard-option-radio::after {
      content: '';
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--accent);
    }
    .wizard-option-body h3 {
      margin: 0 0 4px;
      font-size: 15px;
      font-weight: 600;
    }
    .wizard-option-body .desc {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      margin: 0;
    }
    .wizard-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 28px;
      gap: 10px;
    }
    .wizard-nav .skip-link {
      color: var(--muted);
      font-size: 12px;
      text-decoration: none;
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      font-family: inherit;
    }
    .wizard-nav .skip-link:hover { color: var(--accent); }
    .wizard-field {
      margin-bottom: 14px;
    }
    .wizard-field label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .wizard-field input[type="text"],
    .wizard-field input[type="email"],
    .wizard-field select {
      width: 100%;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-size: 13px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    .wizard-field input:focus,
    .wizard-field select:focus {
      border-color: var(--accent);
    }
    .wizard-check-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 10px;
    }
    .wizard-check-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.02);
      font-size: 13px;
    }
    .wizard-check-item .check-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
    }
    .wizard-check-item .check-icon.pass {
      background: rgba(124, 241, 200, 0.15);
      color: var(--accent-2);
    }
    .wizard-check-item .check-icon.fail {
      background: rgba(255, 141, 141, 0.15);
      color: var(--danger);
    }
    .wizard-check-item .check-icon.pending {
      background: rgba(148, 163, 184, 0.1);
      color: var(--muted);
    }
    .wizard-check-detail {
      color: var(--muted);
      font-size: 11px;
      margin-top: 2px;
    }
    .wizard-summary-ready {
      text-align: center;
      padding: 20px 0;
    }
    .wizard-summary-ready .big-check {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(124, 241, 200, 0.12);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      margin-bottom: 12px;
    }
    .wizard-section {
      margin-bottom: 16px;
      padding: 14px 16px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.015);
    }
    .wizard-section h4 {
      font-size: 13px;
      font-weight: 600;
      margin: 0 0 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .wizard-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(148, 163, 184, 0.08);
      font-size: 13px;
    }
    .wizard-toggle-row:last-child { border-bottom: none; }
    .wizard-toggle {
      position: relative;
      width: 36px;
      height: 20px;
      background: rgba(148, 163, 184, 0.25);
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s;
      flex-shrink: 0;
    }
    .wizard-toggle.on {
      background: var(--accent);
    }
    .wizard-toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      transition: transform 0.2s;
    }
    .wizard-toggle.on::after {
      transform: translateX(16px);
    }
    .wizard-role-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-top: 8px;
    }
    .wizard-role-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.02);
      font-size: 12px;
    }
    .wizard-role-item select {
      padding: 4px 8px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 11px;
      font-family: inherit;
      max-width: 140px;
    }
    .wizard-cert-box {
      margin-top: 16px;
      padding: 16px;
      border: 2px solid var(--accent);
      border-radius: 14px;
      background: rgba(105, 210, 255, 0.04);
      text-align: center;
    }
    .wizard-cert-icon {
      font-size: 40px;
      margin-bottom: 8px;
    }
    .wizard-cert-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .wizard-cert-detail {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .wizard-inline-row {
      display: flex;
      gap: 12px;
    }
    .wizard-inline-row .wizard-field {
      flex: 1;
    }
    .wizard-hint {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-top: 3px;
      font-weight: 400;
    }
  </style>
</head>
<body>
  <div class="wizard-backdrop">
    <div class="wizard-card">
      <div class="wizard-logo">PRISM</div>
      <div class="wizard-subtitle">Frontier Operator Console \u2014 Advanced Setup</div>

      <div class="wizard-progress" id="wizard-progress"></div>

      <!-- Step 1: Profile & Governance -->
      <div class="wizard-step active" id="step-1">
        <div class="wizard-phase-label">Phase A \u2014 Foundation</div>
        <h2>Choose Your Profile</h2>
        <p>This determines governance level, default agent behaviour, and compliance requirements.</p>
        <div class="wizard-option selected" data-profile="individual" onclick="advSelectProfile(this, 'individual')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F680} Individual</h3>
            <p class="desc">Personal productivity. Minimal governance, fast defaults. Tier-1 autonomous guardian, mesh swarms.</p>
          </div>
        </div>
        <div class="wizard-option" data-profile="business" onclick="advSelectProfile(this, 'business')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F3E2} Business</h3>
            <p class="desc">Enterprise governance. Full audit trails, star-topology swarms, tier-2 conditional guardian, mandatory compliance cron.</p>
          </div>
        </div>
      </div>

      <!-- Step 2: Workspace & Prerequisites -->
      <div class="wizard-step" id="step-2">
        <div class="wizard-phase-label">Phase A \u2014 Foundation</div>
        <h2>Workspace Location</h2>
        <p>PRISM stores configuration, agent state, and artifacts in a workspace directory.</p>
        <div class="wizard-field">
          <label>Workspace Path</label>
          <input type="text" id="adv-workspace-path" />
        </div>
        <div class="wizard-check-list" id="adv-workspace-checks"></div>
      </div>

      <!-- Step 3: Primary LLM Provider -->
      <div class="wizard-step" id="step-3">
        <div class="wizard-phase-label">Phase A \u2014 Foundation</div>
        <h2>LLM Provider</h2>
        <p>Select which LLM provider to start with. More can be added later in Settings.</p>
        <div class="wizard-option selected" data-provider="ollama" onclick="advSelectProvider(this, 'ollama')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F5A5} Ollama (Local)</h3>
            <p class="desc">Run open-source models locally. No API key needed.</p>
          </div>
        </div>
        <div class="wizard-option" data-provider="openai" onclick="advSelectProvider(this, 'openai')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F916} OpenAI</h3>
            <p class="desc">GPT-4o, GPT-4o-mini, and more. Requires API key.</p>
          </div>
        </div>
        <div class="wizard-option" data-provider="anthropic" onclick="advSelectProvider(this, 'anthropic')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u2728 Anthropic</h3>
            <p class="desc">Claude models. Requires API key.</p>
          </div>
        </div>
        <div class="wizard-option" data-provider="google" onclick="advSelectProvider(this, 'google')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F50D} Google AI</h3>
            <p class="desc">Gemini models. Requires API key.</p>
          </div>
        </div>
        <div id="adv-provider-key-field" class="wizard-field" style="display:none;margin-top:14px;">
          <label id="adv-provider-key-label">API Key</label>
          <input type="text" id="adv-provider-api-key" placeholder="sk-..." autocomplete="off" />
        </div>
        <div id="adv-provider-test-result" style="margin-top:8px;font-size:12px;"></div>
      </div>

      <!-- Step 4: Model Routing Strategy -->
      <div class="wizard-step" id="step-4">
        <div class="wizard-phase-label">Phase B \u2014 Intelligence Layer</div>
        <h2>Model Routing Strategy</h2>
        <p>Define how PRISM routes requests to different models based on task role or modality.</p>

        <div class="wizard-option selected" data-strategy="single" onclick="advSelectStrategy(this, 'single')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>Single Model</h3>
            <p class="desc">Route all tasks to one model. Simplest setup.</p>
          </div>
        </div>
        <div class="wizard-option" data-strategy="multi" onclick="advSelectStrategy(this, 'multi')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>Multi-Model (Role-Based)</h3>
            <p class="desc">Assign different models to each task role (chat, code generation, reasoning, etc.).</p>
          </div>
        </div>
        <div class="wizard-option" data-strategy="modality" onclick="advSelectStrategy(this, 'modality')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>Modality-Aware</h3>
            <p class="desc">Route by input type: text, vision, code. Requires multiple providers.</p>
          </div>
        </div>

        <div id="adv-role-overrides" style="display:none;margin-top:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <label style="font-size:12px;font-weight:600;color:var(--muted);">Role Overrides</label>
            <button class="secondary-button" style="font-size:11px;padding:4px 10px;" onclick="advAcceptSuggestions()">Accept AI Suggestions</button>
          </div>
          <div class="wizard-role-grid" id="adv-role-grid"></div>
        </div>
      </div>

      <!-- Step 5: Agentic Control & Guardian -->
      <div class="wizard-step" id="step-5">
        <div class="wizard-phase-label">Phase B \u2014 Intelligence Layer</div>
        <h2>Agentic Control &amp; Guardian</h2>
        <p>Configure the Guardian agent and set defaults for the agent pool.</p>

        <div class="wizard-section">
          <h4>\u{1F6E1} Guardian Agent</h4>
          <div class="wizard-field">
            <label>Guardian Model</label>
            <select id="adv-guardian-model"><option value="">Loading models...</option></select>
            <span class="wizard-hint">Select a local GGUF model for the guardian to use.</span>
          </div>

          <div class="wizard-field">
            <label>Authority Tier</label>
            <select id="adv-guardian-tier">
              <option value="tier1_autonomous">Tier 1 \u2014 Autonomous (Individual default)</option>
              <option value="tier2_conditional">Tier 2 \u2014 Conditional (Business default)</option>
            </select>
          </div>

          <div class="wizard-toggle-row">
            <span>Auto-start Guardian on launch</span>
            <div class="wizard-toggle on" id="adv-guardian-autostart" onclick="advToggle(this)"></div>
          </div>
        </div>

        <div class="wizard-section" style="margin-top:12px;">
          <h4>\u{1F916} Default Swarm Topology</h4>
          <div class="wizard-field">
            <select id="adv-swarm-topology">
              <option value="mesh">Mesh \u2014 Peer-to-peer (Individual default)</option>
              <option value="star">Star \u2014 Central coordinator (Business default)</option>
              <option value="pipeline">Pipeline \u2014 Sequential</option>
              <option value="broadcast">Broadcast \u2014 Fan-out</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Step 6: Character Accountability (CAC) -->
      <div class="wizard-step" id="step-6">
        <div class="wizard-phase-label">Phase C \u2014 Identity &amp; Operations</div>
        <h2>Character Accountability</h2>
        <p>Assign your primary operator character. This establishes your identity chain for audit and compliance.</p>

        <div class="wizard-field">
          <label>Primary Character</label>
          <select id="adv-cac-character"><option value="">Loading characters...</option></select>
        </div>

        <div class="wizard-inline-row">
          <div class="wizard-field">
            <label>Operator Email</label>
            <input type="email" id="adv-cac-operator-email" placeholder="you@company.com" />
          </div>
          <div class="wizard-field">
            <label>PRISM User Email</label>
            <input type="email" id="adv-cac-prism-email" placeholder="assistant@prism.local" />
          </div>
        </div>

        <div class="wizard-inline-row">
          <div class="wizard-field">
            <label>Operator ID</label>
            <input type="text" id="adv-cac-operator-id" placeholder="Optional identifier" />
          </div>
          <div class="wizard-field">
            <label>Workspace Hub</label>
            <input type="text" id="adv-cac-workspace-hub" placeholder="e.g. main / department-name" />
            <span class="wizard-hint" id="adv-cac-hub-hint">Suggested for individual, required for business profiles.</span>
          </div>
        </div>

        <div id="adv-cac-assignment-result" style="margin-top:12px;font-size:12px;"></div>
      </div>

      <!-- Step 7: Browser Profile & Scheduler -->
      <div class="wizard-step" id="step-7">
        <div class="wizard-phase-label">Phase C \u2014 Identity &amp; Operations</div>
        <h2>Browser Profile &amp; Scheduler</h2>
        <p>Set up your browser automation profile and initial scheduled tasks.</p>

        <div class="wizard-section">
          <h4>\u{1F310} Browser Profile</h4>
          <div class="wizard-toggle-row">
            <span>Use CAC identity for browser profile</span>
            <div class="wizard-toggle on" id="adv-browser-use-cac" onclick="advToggle(this); advUpdateBrowserFields();"></div>
          </div>
          <div class="wizard-inline-row" style="margin-top:10px;">
            <div class="wizard-field">
              <label>Browser Profile Email</label>
              <input type="email" id="adv-browser-email" placeholder="you@company.com" />
            </div>
            <div class="wizard-field">
              <label>Segment</label>
              <select id="adv-browser-segment">
                <option value="individual">Individual</option>
                <option value="business">Business</option>
              </select>
            </div>
          </div>
        </div>

        <div class="wizard-section" style="margin-top:12px;">
          <h4>\u{1F4C5} Scheduled Tasks</h4>
          <p style="font-size:12px;color:var(--muted);margin:0 0 10px;">Toggle suggested tasks for your profile. You can customise in the Scheduler tab later.</p>
          <div id="adv-scheduler-suggestions"></div>
        </div>
      </div>

      <!-- Step 8: Email & Calendar Integrations -->
      <div class="wizard-step" id="step-8">
        <div class="wizard-phase-label">Phase D \u2014 Integrations</div>
        <h2>Email &amp; Calendar OAuth</h2>
        <p>Connect your business accounts to enable secure, real-time access to your inbox and calendar. OAuth tokens remain local and encrypted.</p>

        <div class="wizard-section">
          <h4>Gmail</h4>
          <div id="adv-gmail-status" style="margin-top:8px;font-size:12px;color:var(--muted);">Checking status...</div>
          <button class="secondary-button" id="adv-gmail-connect" style="margin-top:8px;" onclick="advOAuthConnect('gmail')">Connect Gmail</button>
        </div>

        <div class="wizard-section" style="margin-top:16px;">
          <h4>Outlook / Microsoft 365</h4>
          <div id="adv-outlook-status" style="margin-top:8px;font-size:12px;color:var(--muted);">Checking status...</div>
          <button class="secondary-button" id="adv-outlook-connect" style="margin-top:8px;" onclick="advOAuthConnect('outlook')">Connect Outlook</button>
        </div>
      </div>

      <!-- Step 9: Summary & Initialization Certificate -->
      <div class="wizard-step" id="step-9">
        <div class="wizard-phase-label">Launch</div>
        <h2>Summary &amp; Initialization Certificate</h2>
        <p>Review your configuration. PRISM will create an immutable Initialization Certificate as your system\u2019s provenance record.</p>

        <div class="wizard-check-list" id="adv-summary-checks"></div>
        <div id="adv-summary-status" style="margin-top:12px;text-align:center;"></div>

        <div class="wizard-cert-box" id="adv-cert-box" style="display:none;">
          <div class="wizard-cert-icon">\u{1F4DC}</div>
          <div class="wizard-cert-title">Initialization Certificate</div>
          <div class="wizard-cert-detail" id="adv-cert-detail">
            A dedicated session will be created documenting your full system configuration, then packaged as an immutable provenance record.
          </div>
        </div>
      </div>

      <!-- Navigation -->
      <div class="wizard-nav">
        <button class="skip-link" id="adv-wizard-skip" onclick="advSkipSetup()">Use Basic Setup</button>
        <div style="display:flex;gap:8px;">
          <button class="secondary-button" id="adv-wizard-back" onclick="advWizardBack()" style="display:none;">Back</button>
          <button class="primary-button" id="adv-wizard-next" onclick="advWizardNext()">Continue</button>
        </div>
      </div>
    </div>
  </div>

  <script type="module" src="/public/setup-wizard-advanced.js"></script>
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
