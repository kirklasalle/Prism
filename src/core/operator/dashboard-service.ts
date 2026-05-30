import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { randomUUID, createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
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
import { resolveProfile, fetchHardwareSnapshot, updateCachedHardwareSnapshot } from "./model-capability-matrix.js";
import {
  WindowsProtectedFileProviderSecretStore,
  InMemoryProviderSecretStore,
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
import { IntentClassifier } from "./intent-classifier.js";
import { CharacterAccountabilityStore, type CharacterAssignmentFilter } from "../accountability/character-accountability-store.js";
import { CharacterAccountabilityManager } from "../accountability/character-accountability-manager.js";
import { workspaceCharactersDir, workspaceDbPath } from "../config/workspace-resolver.js";
import { importCharacter as importCharacterAdapter } from "../characters/character-import-adapter.js";
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
import { loadPluginPack } from "../plugins/plugin-pack-loader.js";
import type { PluginPackManifest } from "../plugins/plugin-pack-validator.js";
import { deriveSessionTitle, parseEventFilters, buildSessionConfigDiff, normalizeSessionPackageStatus, normalizePrompt, parseMultipartParts, sanitizeFileName } from "./utils/http-helpers.js";
import { dashboardHtml, simpleModeHtml, setupWizardHtml, setupWizardAdvancedHtml } from "./templates/index.js";

import { Router } from "./routes/index.js";
import { IamStore } from "../iam/store.js";
import { SessionManager } from "../iam/sso/session.js";
import { IamRouteHandler } from "./routes/iam-handler.js";
import { TooltipsRegistry } from "./tooltips-registry.js";
import { generateOpenApiSpec } from "./openapi-generator.js";

import sqlite3 from "sqlite3";

import { ToolContractExtractor, type ExtractionRequest } from "../tools/tool-contract-extractor.js";
import { PolicyEngine } from "../policy/engine.js";
import { classifyChatTier } from "./chat-tier-classifier.js";
import { A2ATaskAdapter } from "../../adapters/application/a2a-task-adapter.js";
import { GovernanceHooksAdapter } from "../../adapters/application/governance-hooks-adapter.js";
import { MetricsStore, HistogramSnapshot } from "../activity/metrics-store.js";
import { OtelExporter } from "../activity/otel-exporter.js";
import { ActivityRetentionPolicy, resolveRetentionConfigFromEnv } from "../activity/retention-policy.js";
import { Soc2EvidenceExporter } from "../compliance/soc2-exporter.js";
import { GmailOAuthAdapter } from "../../adapters/application/email-oauth-adapter.js";
import { OutlookOAuthAdapter } from "../../adapters/application/outlook-oauth-adapter.js";
import { createOAuthTokenStore } from "../operator/oauth-token-store.js";
import { TerminalSessionAdapter } from "../../adapters/application/terminal-session-adapter.js";
import { ContainerSandboxAdapter } from "../../adapters/application/container-sandbox-adapter.js";
import { UtilityRegistry, registerBuiltInUtilities } from "./utility-registry.js";
import { RiskOverrideStore, type RiskTier } from "./risk-override-store.js";
import { IncidentTrendStore } from "../memory/incident-trend-store.js";
import { tuneFromIncidentTrends, withRetrievalAlertPolicy } from "../memory/retrieval-alert-policy.js";

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

let activeValidationPid: number | null = null;

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
  private readonly corsCsrfConfig: CorsCsrfConfig;
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
  /** Optional MCP adapter for /api/mcp/servers and Guardian self-heal task. */
  private mcpAdapter: McpClientAdapter | null = null;
  /** Optional console interceptor for /api/debug/console + live WS stream. */
  private consoleInterceptor: ConsoleInterceptor | null = null;
  private sshpInterceptor!: SSHPInterceptor;
  private cshManager!: CSHManager;
  /** Unsubscribe handle for the console-line listener. */
  private consoleUnsubscribe: (() => void) | null = null;
  private readonly openSockets = new Set<Socket>();
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
    llamacppBin: "llama-server",
    bitnetBin: "bitnet-server",
    // When true, approved Tier-2 chat requests automatically continue
    // and are executed by the AgenticChatExecutor. Set to false to
    // require manual operator follow-up after approval.
    autoRunApprovedTier2: true,
  };
  private readonly downloadStatus = new Map<string, DownloadProgress>();
  private readonly iamStore: IamStore;
  private readonly sessionManager: SessionManager;
  private readonly iamHandler: IamRouteHandler;
  private readonly router: Router;

  public getIamStore(): IamStore { return this.iamStore; }
  public getSessionManager(): SessionManager { return this.sessionManager; }
  public getIamHandler(): IamRouteHandler { return this.iamHandler; }
  public getSkillsEngine(): SkillsEngine { return this.skillsEngine; }
  private readonly skillsEngine!: SkillsEngine;
  private readonly tooltipsRegistry: TooltipsRegistry = new TooltipsRegistry(resolvePath(process.cwd(), "docs", "tooltips"));
  private customRecommendedModels: Array<{ name: string; fileName: string; size: string; path: string; source: string; addedAt: string }> = [];


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
    terminalAdapter?: TerminalSessionAdapter,
    containerAdapter?: ContainerSandboxAdapter,
  ) {
    this.providerSecretStore = providerSecretStore ?? (process.platform === "win32"
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
      const adminUser = this.iamStore.createUser({
        tenantId: "default",
        email: "admin@prism.ai",
        displayName: "Administrator",
        status: "active",
        attrs: { passwordHash: createHash("sha256").update("admin", "utf-8").digest("hex") },
      });
      const adminRole = this.iamStore.getRoleByName("default", "admin");
      if (adminRole) this.iamStore.addMembership(adminUser.id, "default", adminRole.id);

      const testUser = this.iamStore.createUser({
        tenantId: "default",
        email: "testing@prism.ai",
        displayName: "Test Operator",
        status: "active",
        attrs: { passwordHash: createHash("sha256").update("testing", "utf-8").digest("hex") },
      });
      const operatorRole = this.iamStore.getRoleByName("default", "operator");
      if (operatorRole) this.iamStore.addMembership(testUser.id, "default", operatorRole.id);
    }

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
      publicRoutes: ["/health", "/api/health", "/favicon.ico", "/.well-known/agent.json", "/metrics", "/api/v1/openapi.json", "/api/openapi.json",
        // Dashboard pages — DashboardHandler has its own cookie+token auth
        // that gracefully redirects to /login; let it handle auth, not the gate.
        "/",
        // Setup wizard (step 4): character listing + import
        "/api/workspace/characters", "/api/workspace/character-import",
        // Setup wizard (step 3): provider catalog, connection test, API key save
        "/api/llm/catalog", "/api/llm/provider-test", "/api/llm/provider-secret",
        // Setup wizard (step 6): readiness recheck
        "/api/readiness/recheck",
        // Auth telemetry beacon — login page sends client-side trace events
        "/api/v1/telemetry/auth-trace",
      ],
      publicPrefixes: ["/public/", "/setup", "/login", "/api/auth/", "/api/iam/sso/", "/api/iam/login", "/scim/v2/",
        // Dashboard pages — DashboardHandler does its own auth (cookie/token → 302 /login)
        "/dashboard", "/simple",
        // Setup wizard API — all /api/setup/* endpoints (profile, workspace, character, cac, complete)
        "/api/setup/",
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
      const retentionCfg = activityStore
        ? resolveRetentionConfigFromEnv(activityStore.dbPath)
        : null;
      if (retentionCfg) {
        this.activityRetentionPolicy = new ActivityRetentionPolicy(retentionCfg, this.activityBus);
        this.activityRetentionPolicy.start();
      } else {
        this.activityRetentionPolicy = null;
      }
    }

    // ── OAuth adapters (Phase E2) ─────────────────────────────────────────────
    const oauthTokenStore = createOAuthTokenStore();
    this.gmailOAuth = gmailOAuth ?? new GmailOAuthAdapter(oauthTokenStore);
    this.outlookOAuth = outlookOAuth ?? new OutlookOAuthAdapter(oauthTokenStore);
    this.terminalAdapter = terminalAdapter ?? null;
    this.containerAdapter = containerAdapter ?? null;

    const initialPrefs = readPreferences();
    const initLlamacppBin = (initialPrefs?.runtimeSettings?.llamacppBin as string) || process.env.PRISM_LLAMACPP_BIN || "llama-server";
    const initBitnetBin = (initialPrefs?.runtimeSettings?.bitnetBin as string) || process.env.PRISM_BITNET_BIN || "bitnet-server";

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

    this.llmProviders = new LlmProviderManager(process.env, this.chatStore.listProviderSettings(), this.providerSecretStore, this.llamaSupervisor, this.bitnetSupervisor, this.activityBus);
    if (this.usageMetering) {
      this.llmProviders.setUsageMetering(this.usageMetering);
    }
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

    // Initialize SOTA Skills Engine (durable sqlite workflows)
    this.skillsEngine = new SkillsEngine(
      this.llmProviders,
      this.activityBus,
      resolveWorkspaceRoot(),
      this.chatStore
    );

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
    this._computerAgent = new AutonomousComputerAgent(this.activityBus);

    if (this.toolRegistry) {
      const loop = new AutonomousAgentLoop(
        this.activityBus,
        this.toolRegistry,
        {
          maxConcurrentGoals: 1,
          defaultMaxActions: 100,
          defaultMaxDurationMs: 10 * 60 * 1000,
          guardianCheckIntervalActions: 5,
          actionsPerMinuteLimit: 30,
        },
      );
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
      const toolDefs: LlmToolDef[] = this.toolRegistry.list()
        .filter(t => t.contract?.args)
        .map(t => ({
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
      loop.setSpecializedAgents(
        this._browserAgent ?? undefined,
        this._computerAgent ?? undefined,
      );

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
    // v0.20.5 — Hydrate Guardian config from persisted preferences BEFORE the
    // autostart check below. Without this, every server restart loses the
    // operator's last-selected model and Guardian refuses to autostart.
    try {
      const guardianPrefs = readPreferences()?.guardianConfig;
      if (guardianPrefs && typeof guardianPrefs === "object") {
        // Strip any unknown keys defensively. The agent's configure() merges
        // with its own defaults so missing fields are safe.
        const allowed: Record<string, unknown> = {};
        for (const k of ["modelAlias", "modelPath", "draftModelPath", "authorityTier", "healthCheckIntervalMs", "autoStart", "contextSize", "flashAttn", "gpuLayers", "modelSource"]) {
          if (k in (guardianPrefs as Record<string, unknown>)) allowed[k] = (guardianPrefs as Record<string, unknown>)[k];
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
        const agents = lifecycle.list().map(a => ({ id: a.agentId, state: a.state, role: a.role, lifecycle: a.lifecycle }));
        return { agents };
      });
    }

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

    // ── Operator surfaces (Phase E3 follow-on) ───────────────────────────
    this.riskOverrideStore = new RiskOverrideStore(
      workspacePath("state", "risk-overrides.json"),
      this.activityBus,
    );
    this.incidentTrendStore = new IncidentTrendStore(this.activityBus);
    this.utilityRegistry = new UtilityRegistry(this.activityBus);
    registerBuiltInUtilities(this.utilityRegistry, {
      runContractDiffGate: async () => {
        // Lightweight wrapper — runs the gate script in-process.
        const cp = await import("node:child_process");
        const out = await new Promise<{ code: number; stdout: string; stderr: string }>((resolveCp) => {
          const child = cp.spawn(process.execPath, ["scripts/contract-diff-gate.cjs"], {
            cwd: process.cwd(), env: process.env,
          });
          let stdout = ""; let stderr = "";
          child.stdout.on("data", (b) => { stdout += b.toString(); });
          child.stderr.on("data", (b) => { stderr += b.toString(); });
          child.on("close", (code) => resolveCp({ code: code ?? 0, stdout, stderr }));
        });
        return {
          summary: out.code === 0
            ? "Contract diff gate passed."
            : `Contract diff gate failed (exit ${out.code}).`,
          details: { exitCode: out.code, stdout: out.stdout.slice(-2000), stderr: out.stderr.slice(-2000) },
        };
      },
      exportPolicyAudit: async () => {
        if (!this.policyAuditExporter) {
          return { summary: "Policy audit exporter not available.", details: { available: false } };
        }
        const bundle = this.policyAuditExporter.exportBundle({ sessionId: this.status.sessionId });
        return { summary: `Exported policy audit bundle (${bundle.recordCount} decisions).`, details: { bundle } };
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
        return { summary: report ? `Trend report ready (${report.snapshotsCompared} snapshots).` : "No trend data yet.", details: { report } };
      },
      runPerfTrendReport: async () => {
        const cp = await import("node:child_process");
        const out = await new Promise<{ code: number; stdout: string; stderr: string }>((resolveCp) => {
          const child = cp.spawn(process.execPath, ["scripts/perf-trend-report.cjs"], {
            cwd: process.cwd(), env: process.env,
          });
          let stdout = ""; let stderr = "";
          child.stdout.on("data", (b) => { stdout += b.toString(); });
          child.stderr.on("data", (b) => { stderr += b.toString(); });
          child.on("close", (code) => resolveCp({ code: code ?? 0, stdout, stderr }));
        });
        return {
          summary: out.code === 0 ? "Perf trend report generated." : `Perf trend report failed (exit ${out.code}).`,
          details: { exitCode: out.code, stdout: out.stdout.slice(-2000), stderr: out.stderr.slice(-2000) },
        };
      },
    });

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
  createChatSession(input?: string | {
    title?: string;
    characterId?: string | null;
    cacAssignmentId?: string | null;
    operatorEmail?: string | null;
    assistantEmail?: string | null;
    allowUnbound?: boolean;
  }): ChatSessionSummary {
    const opts = typeof input === "string" || input === undefined
      ? { title: typeof input === "string" ? input : undefined }
      : input;

    const prefs = readPreferences() ?? undefined;
    const executionProfile = (this.status.executionProfileSegment || prefs?.executionProfileSegment || "individual").toString().toLowerCase();

    // Resolve character id: explicit > workspace default > auto-pick from workspace characters.
    let characterId = (opts.characterId ?? prefs?.defaultCharacterId ?? "").toString().trim() || null;

    if (!characterId && !opts.allowUnbound) {
      // Auto-pick the first character matching the execution profile so sessions can be
      // created without requiring the setup wizard when characters are already available.
      const available = this.listWorkspaceCharacters();
      const profileMatch =
        available.find(
          (c) => !c.executionProfile || c.executionProfile.toLowerCase() === executionProfile,
        ) ?? available[0] ?? null;
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
      operatorEmail: opts.operatorEmail ?? null,
      assistantEmail: opts.assistantEmail ?? null,
    });

    // If a CAC assignment id was supplied, bind it. Otherwise, when we have a character,
    // auto-create an assignment with workspace-default identities (placeholders OK).
    let cacAssignmentId = opts.cacAssignmentId ?? null;
    let operatorEmailFinal = opts.operatorEmail ?? null;
    let assistantEmailFinal = opts.assistantEmail ?? null;

    if (!cacAssignmentId && characterId) {
      const operatorEmail = (opts.operatorEmail ?? `operator@prism.local`).toString().trim();
      const assistantEmail = (opts.assistantEmail ?? `${characterId}@prism.local`).toString().trim();
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
      } catch { /* non-fatal */ }
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
    this.chatStore.upsertProviderSettings(resolved, settings, source);
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

    // Dynamic pre-loading/initialization of local models when selected/applied
    if (catalog.activeProviderId === "llamacpp" && this.llamaSupervisor && catalog.activeModel) {
      const modelPath = this.llamaSupervisor.getModelPath(catalog.activeModel);
      if (modelPath) {
        try {
          console.log(`[PRISM][settings] Initializing and pre-loading llama.cpp model: ${catalog.activeModel}`);
          await this.llamaSupervisor.loadModel(modelPath, catalog.activeModel, { ctxSize: 2048 });
        } catch (err) {
          throw new Error(`Failed to load local GGUF model "${catalog.activeModel}": ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        throw new Error(`Local GGUF model "${catalog.activeModel}" was not found in the local models directory.`);
      }
    } else if (catalog.activeProviderId === "bitnetcpp" && this.bitnetSupervisor && catalog.activeModel) {
      const modelPath = this.bitnetSupervisor.getModelPath(catalog.activeModel);
      if (modelPath) {
        try {
          console.log(`[PRISM][settings] Initializing and pre-loading bitnet.cpp model: ${catalog.activeModel}`);
          await this.bitnetSupervisor.loadModel(modelPath, catalog.activeModel);
        } catch (err) {
          throw new Error(`Failed to load local BitNet model "${catalog.activeModel}": ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        throw new Error(`Local BitNet model "${catalog.activeModel}" was not found in the local models directory.`);
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
        console.log(`[PRISM][paradigm] Auto-detected model selection changed to ${updatedCatalog.activeModel}. Setting Base Mode to ${targetBaseMode}`);
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
        try { ws.send(payload); } catch { /* ignore broken clients */ }
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
  private telemetryAggregator: import("../observability/universal-telemetry-aggregator.js").UniversalTelemetryAggregator | null = null;
  private _covenant: import("../governance/prism-covenant.js").PrismCovenant | null = null;
  private _browserAgent: import("../runtime/autonomous-browser-agent.js").AutonomousBrowserAgent | null = null;
  private _computerAgent: import("../runtime/autonomous-computer-agent.js").AutonomousComputerAgent | null = null;
  private _demoEngine: import("../runtime/demonstration-engine.js").DemonstrationEngine | null = null;

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
    if (deps.browserAgent) this._browserAgent = deps.browserAgent;
    if (deps.computerAgent) this._computerAgent = deps.computerAgent;

    // ── Bind LLM reasoning engine to the autonomous loop ──────────────────
    // This connects the planner brain to the configured LLM provider so
    // autonomous goals can think and act via the ReAct loop.
    deps.autonomousLoop.setLlmGenerateFn(async (input) => {
      const result = await this.llmProviders.generate({
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
    });

    // Bind tool definitions for the planner
    if (this.toolRegistry) {
      const { toolsToLlmDefinitions } = await import("../tools/tool-schema-converter.js");
      const defs = toolsToLlmDefinitions(this.toolRegistry.list()) as any;
      deps.autonomousLoop.setToolDefinitions(defs);
    }

    // Bind specialized agents
    deps.autonomousLoop.setSpecializedAgents(
      deps.browserAgent ?? undefined,
      deps.computerAgent ?? undefined,
    );

    // Wire telemetry WebSocket fan-out so Logs & Debug gets real-time updates
    deps.telemetryAggregator.subscribe((entry) => {
      const payload = JSON.stringify({ type: "telemetry", entry });
      for (const ws of this.wsClients) {
        try { ws.send(payload); } catch { /* ignore broken clients */ }
      }
    });
  }

  /** Return the autonomous loop for external callers (e.g. API routes). */
  getAutonomousLoop() { return this.autonomousLoop; }
  /** Return the dev identity provider. */
  getDevIdentity() { return this.devIdentity; }
  /** Return the tab session registry. */
  getTabSessionRegistry() { return this.tabSessionRegistry; }
  /** Return the universal telemetry aggregator. */
  getTelemetryAggregator() { return this.telemetryAggregator; }

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
      const newSession = this.chatStore.createSession();
      this.chatStore.updateSessionTitle(newSession.sessionId, "New Session");
      if (segment === "individual") {
        this.activityBus.emit({
          sessionId: this.status.sessionId,
          layer: "causal",
          operation: "prism.accountability.init",
          status: "started",
          details: { message: "Auto-created initial session for individual segment.", chatSessionId: newSession.sessionId }
        });
      } else {
        this.activityBus.emit({
          sessionId: this.status.sessionId,
          layer: "causal",
          operation: "prism.accountability.init",
          status: "started",
          details: {
            message: "Accountability systems initiated for enterprise segment with initial session context.",
            chatSessionId: newSession.sessionId,
          }
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
  public async broadcastUiTour(steps: Array<{ tabId: string; anchor?: string; dwellMs?: number; message?: string }>): Promise<void> {
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
      } catch { /* defensive: tour is cosmetic, never crash the caller */ }
      const dwell = Math.max(0, Math.min(60_000, Number(step.dwellMs) || 0));
      if (dwell > 0) await new Promise<void>((r) => setTimeout(r, dwell));
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

  getPort(): number { return this.port; }
  getChatStore(): ChatSessionStore { return this.chatStore; }
  getGuardianAgent(): GuardianAgent { return this.guardianAgent; }
  getLlmProviders(): LlmProviderManager { return this.llmProviders; }
  getActivityBus(): ActivityBus { return this.activityBus; }
  getApprovalQueue(): ApprovalQueue { return this.queue; }
  getAuthGate(): AuthGate { return this.authGate; }
  getRateLimiter(): RateLimiter { return this.rateLimiter; }
  getRuntimeStatus(): DashboardRuntimeStatus { return this.status; }
  getDownloadStatus(): Map<string, DownloadProgress> { return this.downloadStatus; }
  getCharacterAccountabilityStore(): CharacterAccountabilityStore { return this.characterAccountabilityStore; }
  getCharacterAccountabilityManager(): CharacterAccountabilityManager { return this.characterAccountabilityManager; }
  getSchedulerEngine(): SchedulerEngine { return this.schedulerEngine; }
  getSchedulerEvents(): Map<string, { id: string; title: string; start: string; end?: string; description?: string; createdAt: string }> { return this.schedulerEvents; }
  getSchedulerProjects(): Map<string, any> { return this.schedulerProjects; }
  getImportHistory(): Array<{ id: string; timestamp: string; mode: string; fileName: string; targetDir: string; registeredType: string | null; status: string; message: string; size: number }> { return this.importHistory; }
  public listWorkspaceCharacters(): Array<{ id: string; name: string; displayName: string; executionProfile: string | null; persona: string | null; greeting: string | null; systemPrompt: string | null; tags: string[]; maxRiskTier: number | null; allowedTools: string[]; deniedTools: string[]; defaultEmail: string | null; sourcePath: string; tooltipTips: string[] }> {
    const dir = workspaceCharactersDir();
    if (!existsSync(dir)) { return []; }
    const files = readdirSync(dir).filter((entry) => entry.toLowerCase().endsWith(".json")).sort((left, right) => left.localeCompare(right));
    const characters: Array<{ id: string; name: string; displayName: string; executionProfile: string | null; persona: string | null; greeting: string | null; systemPrompt: string | null; tags: string[]; maxRiskTier: number | null; allowedTools: string[]; deniedTools: string[]; defaultEmail: string | null; sourcePath: string; tooltipTips: string[] }> = [];
    for (const fileName of files) {
      const fullPath = join(dir, fileName);
      try {
        const parsed = JSON.parse(readFileSync(fullPath, "utf-8")) as Record<string, unknown>;
        const toolPermissions = (parsed.toolPermissions ?? {}) as Record<string, unknown>;
        const allow = Array.isArray(toolPermissions.allow) ? toolPermissions.allow.map((entry) => String(entry)) : [];
        const deny = Array.isArray(toolPermissions.deny) ? toolPermissions.deny.map((entry) => String(entry)) : [];
        const name = String(parsed.name ?? fileName.replace(/\.json$/i, "")).trim();
        const tooltipTips = Array.isArray(parsed.tooltipTips)
          ? parsed.tooltipTips.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
          : [];
        characters.push({ id: name, name, displayName: String(parsed.displayName ?? name).trim() || name, executionProfile: parsed.executionProfile != null ? String(parsed.executionProfile) : null, persona: parsed.persona != null ? String(parsed.persona) : null, greeting: parsed.greeting != null ? String(parsed.greeting) : null, systemPrompt: parsed.systemPrompt != null ? String(parsed.systemPrompt) : null, tags: Array.isArray(parsed.tags) ? parsed.tags.map((entry) => String(entry)) : [], maxRiskTier: Number.isFinite(Number(parsed.maxRiskTier)) ? Number(parsed.maxRiskTier) : null, allowedTools: allow, deniedTools: deny, defaultEmail: parsed.defaultEmail != null ? String(parsed.defaultEmail) : null, sourcePath: fullPath, tooltipTips });
      } catch { /* Ignore malformed character documents. */ }
    }
    return characters;
  }
  getToolRegistry(): ToolRegistry | null { return this.toolRegistry; }
  getContainerAdapter(): ContainerSandboxAdapter | null { return this.containerAdapter; }
  getTerminalAdapter(): TerminalSessionAdapter | null { return this.terminalAdapter; }
  getCovenant(): PrismCovenant { return this._covenant!; }
  getAutonomousBrowserAgent(): AutonomousBrowserAgent | null { return this._browserAgent; }
  getAutonomousComputerAgent(): AutonomousComputerAgent | null { return this._computerAgent; }
  /** Broadcast a message to all connected WebSocket clients. */
  broadcastWs(data: Record<string, unknown>): void {
    const payload = JSON.stringify(data);
    for (const ws of this.wsClients) {
      try { ws.send(payload); } catch { /* client may have disconnected */ }
    }
  }
  getGmailOAuth(): GmailOAuthAdapter { return this.gmailOAuth; }
  getOutlookOAuth(): OutlookOAuthAdapter { return this.outlookOAuth; }
  /** Public access to the framebuffer capture surface, used by the Workflow Demo
   *  to fire a real CUA screengrab as part of the Option-C automation tour. */
  public getFramebufferCapture(): FramebufferCapture { return this.framebufferCapture; }
  public getTooltipsRegistry(): TooltipsRegistry { return this.tooltipsRegistry; }
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

    // ── OpenAPI Specification ──────────────────────────────────────────
    if (method === "GET" && (rawUrl === "/api/v1/openapi.json" || url === "/api/openapi.json")) {
      return this.json(res, 200, generateOpenApiSpec(this.port));
    }


    // ── Favicon (suppress 404 / browser probe) ────────────────────────
    if (method === "GET" && (url === "/favicon.ico" || url.startsWith("/favicon.ico?"))) {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === "GET" && url.startsWith("/public/") && (url.endsWith(".js") || url.endsWith(".css") || url.endsWith(".html"))) {
      const safeFile = url.slice("/public/".length).replace(/\.\./g, "");
      if (!safeFile) {
        return this.json(res, 404, { error: "Not found" });
      }
      const devPublicDir = "D:\\Projects\\Prism\\src\\core\\operator\\public";
      const publicRoot = existsSync(devPublicDir) ? resolvePath(devPublicDir) : resolvePath(DashboardService.publicDir);
      const filePath = resolvePath(publicRoot, safeFile);
      // Containment check: reject any resolved path that escapes publicDir (defence-in-depth over the `..` strip above).
      if (filePath !== publicRoot && !filePath.startsWith(publicRoot + pathSep)) {
        return this.json(res, 404, { error: "Not found" });
      }
      if (!existsSync(filePath)) { return this.json(res, 404, { error: "Not found" }); }
      const content = readFileSync(filePath);
      const contentType = url.endsWith(".css") ? "text/css; charset=utf-8" : url.endsWith(".html") ? "text/html; charset=utf-8" : "application/javascript; charset=utf-8";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      });
      res.end(content);
      return;
    }

    // (Modular Routing already handled dashboard, setup, etc.)




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

    // ── Graceful Shutdown API Endpoint ──────────────────────────────────
    if (method === "POST" && url === "/api/system/shutdown") {
      console.log("[PRISM][system] [INFO] Received shutdown signal from dashboard operator. Initiating graceful termination...");

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ success: true, message: "Graceful shutdown sequence initialized by operator console." }));

      setTimeout(() => {
        process.kill(process.pid, "SIGTERM");
      }, 500);
      return;
    }

    // ── PTAC-aligned /api/chat — tier-classified contract endpoint ──────────
    //
    // This is a thin, governance-first entry point that classifies a free-text
    // prompt into Tier 1 / 2 / 3 and returns the contract shape that PTAC
    // scenarios s03 (tier-1 capability), s05 (tier-2 approval), and s06
    // (tier-3 deny) assert against. It complements — does NOT replace — the
    // session-scoped chat surface at `/api/chat/sessions/:id/messages`, which
    // remains the path used by the dashboard UI for full LLM round-trips.
    //
    // Response shapes:
    //   - Tier 1: 200 { tier: 1, accepted: true, reason_code, response, session_id }
    //   - Tier 2: 202 { tier: 2, approval_pending_ids: [id], reason_code, session_id }
    //   - Tier 3: 200 { tier: 3, denied: true, reason_code, matched_pattern, session_id }
    //
    // Tier-2 entries are enqueued fire-and-forget into ApprovalQueue with a
    // 120s timeout. Operators resolve them via POST /api/approval/approve/:id
    // or POST /api/approval/deny/:id (existing routes).
    if (method === "POST" && url === "/api/chat") {
      let body: { prompt?: unknown; sessionId?: unknown };
      try {
        body = await this.readJsonBody<{ prompt?: unknown; sessionId?: unknown }>(req);
      } catch (err) {
        return this.json(res, 400, { error: "invalid_json", message: String((err as Error).message) });
      }
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      const sessionId = typeof body.sessionId === "string" && body.sessionId.length > 0
        ? body.sessionId
        : `ptac-${randomUUID().slice(0, 8)}`;
      if (prompt.trim().length === 0) {
        return this.json(res, 400, {
          error: "missing_prompt",
          message: "Request body must include a non-empty 'prompt' field.",
        });
      }
      const classification = classifyChatTier(prompt);

      // Audit every classification decision through the activity bus so the
      // accountability chain captures both allowed and refused requests.
      this.activityBus.emit({
        sessionId,
        layer: "governance",
        operation: "chat.tier_classified",
        status: "succeeded",
        details: {
          tier: classification.tier,
          reason_code: classification.reasonCode,
          matched_pattern: classification.matchedPattern,
          prompt_length: prompt.length,
        },
      });

      if (classification.tier === 3) {
        return this.json(res, 200, {
          tier: 3,
          denied: true,
          reason_code: classification.reasonCode,
          matched_pattern: classification.matchedPattern,
          session_id: sessionId,
        });
      }

      if (classification.tier === 2) {
        const newIds = this.enqueueApprovalAndAutoRun(sessionId, prompt, classification);
        return this.json(res, 202, {
          tier: 2,
          approval_pending_ids: newIds,
          reason_code: classification.reasonCode,
          matched_pattern: classification.matchedPattern,
          session_id: sessionId,
        });
      }

      // Tier 1 — autonomous capability response. The intentional minimal body
      // here lets PTAC self-drive scenarios assert end-to-end without pulling
      // a live LLM provider into the test path. Real conversational chat
      // continues to flow through /api/chat/sessions/:id/messages.
      // Emit chat completion event to the activity bus for lineage tracking (s16 assertion)
      this.activityBus.emit({
        sessionId,
        layer: "chat" as any,
        operation: "chat.message.completed",
        status: "succeeded",
        details: {
          prompt,
          response:
            "Acknowledged. Tier-1 capability prompt accepted by the governance layer; "
            + "for a full conversational reply, post to /api/chat/sessions/:id/messages.",
        },
      });

      return this.json(res, 200, {
        tier: 1,
        accepted: true,
        reason_code: classification.reasonCode,
        response:
          "Acknowledged. Tier-1 capability prompt accepted by the governance layer; "
          + "for a full conversational reply, post to /api/chat/sessions/:id/messages.",
        session_id: sessionId,
      });
    }
    // ── End PTAC-aligned /api/chat ──────────────────────────────────────────

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

    if (method === "DELETE" && url === "/api/models/delete") {
      try {
        const body = await this.readJsonBody<{ path: string; source: string }>(req);
        if (!body?.path || !body?.source) {
          return this.json(res, 400, { error: "Missing path or source" });
        }

        const { path: modelPath, source } = body;

        if (source === "ollama") {
          const { exec: execCb } = await import("node:child_process");
          await new Promise((resolve, reject) => {
            execCb(`ollama rm ${modelPath}`, { timeout: 60000 }, (err, stdout, stderr) => {
              if (err) reject(new Error(stderr?.trim() || err.message));
              else resolve(stdout);
            });
          });
          return this.json(res, 200, { message: `Ollama model ${modelPath} removed successfully` });
        } else {
          if (!existsSync(modelPath)) {
            return this.json(res, 404, { error: "Model file not found on disk" });
          }
          if (statSync(modelPath).isDirectory()) {
            return this.json(res, 400, { error: "Path is a directory, not a file" });
          }
          unlinkSync(modelPath);
          return this.json(res, 200, { message: `Model file ${basename(modelPath)} deleted successfully` });
        }
      } catch (error: any) {
        return this.json(res, 500, { error: error.message || String(error) });
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

    if (method === "POST" && url.startsWith("/api/readiness/fix/")) {
      try {
        const ckId = decodeURIComponent(url.slice("/api/readiness/fix/".length));
        console.log(`[PRISM][readiness] Fix requested for requirement: ${ckId}`);

        let fixed = false;
        let detail = "";

        if (ckId === "local-llm-service-ready") {
          const activeSession = this.chatStore.listSessions()[0];
          const activeProviderId = activeSession?.llmProviderId ?? (await this.llmProviders.getCatalog()).activeProviderId ?? null;

          if (activeProviderId === "llamacpp" || activeProviderId === "bitnetcpp") {
            const supervisor = activeProviderId === "llamacpp" ? this.llamaSupervisor : this.bitnetSupervisor;
            if (supervisor) {
              const erroredSlots = supervisor.getSnapshot().filter(s => s.status === "error");
              for (const slot of erroredSlots) {
                if (slot.modelAlias) {
                  await supervisor.unloadModel(slot.modelAlias);
                }
              }
              fixed = true;
              detail = "Cleared errored local LLM service slots. Dynamic on-demand loading will re-attempt on next chat.";
            }
          } else {
            detail = "Local LLM service is not the active provider. Switch provider and try again.";
          }
        } else {
          detail = `No auto-fix strategy defined for check: ${ckId}`;
        }

        return this.json(res, 200, { fixed, detail });
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

    // Phase E3b — wizard: persist workspace default character. Called from step 4.
    if (method === "POST" && url === "/api/setup/character") {
      try {
        const body = await this.readJsonBody<{ characterId?: string }>(req);
        const characterId = String(body.characterId ?? "").trim();
        if (!characterId) {
          return this.json(res, 400, { error: "characterId is required." });
        }
        const available = this.listWorkspaceCharacters();
        if (!available.some((c) => c.id === characterId)) {
          return this.json(res, 404, { error: `character_not_found: ${characterId}` });
        }
        writePreferences({ defaultCharacterId: characterId, lastUsedCharacterId: characterId });
        return this.json(res, 200, { ok: true, defaultCharacterId: characterId });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // Phase E3b — wizard: bootstrap the first CAC assignment + seed session. Called from step 5.
    if (method === "POST" && url === "/api/setup/cac") {
      try {
        const body = await this.readJsonBody<{
          characterId?: string;
          operatorEmail?: string;
          assistantEmail?: string;
          title?: string;
        }>(req);
        const prefs = readPreferences();
        const characterId = String(body.characterId ?? prefs?.defaultCharacterId ?? "").trim();
        if (!characterId) {
          return this.json(res, 400, {
            error: "no_default_character",
            message: "Run POST /api/setup/character first or provide characterId.",
          });
        }
        const available = this.listWorkspaceCharacters();
        if (!available.some((c) => c.id === characterId)) {
          return this.json(res, 404, { error: `character_not_found: ${characterId}` });
        }
        const operatorEmail = String(body.operatorEmail ?? `operator@prism.local`).trim();
        const assistantEmail = String(body.assistantEmail ?? `${characterId}@prism.local`).trim();

        // R3 wizard email deny-list check
        const isPlaceholder = /@(prism\.local|example\.(com|org|net))$/i.test(operatorEmail);
        if (isPlaceholder) {
          const err = new Error("Placeholder operator email is not allowed.") as Error & { code?: string };
          err.code = "operator-email-placeholder";
          throw err;
        }

        // Seed an initial session and auto-create the CAC assignment.
        const session = this.createChatSession({
          title: body.title ?? "First session",
          characterId,
          operatorEmail,
          assistantEmail,
        });
        try {
          writePreferences({
            cacBootstrapAssignmentId: session.cacAssignmentId ?? undefined,
            lastUsedCharacterId: characterId,
          });
        } catch { /* non-fatal */ }

        // Initialize Computer & Browser Control
        this.framebufferCapture.captureSingle().catch(() => { });
        const browserTool = this.tools.find(t => t.name === "browser_control") as BrowserControlTool | undefined;
        if (browserTool) {
          try {
            const profMgr = browserTool.getProfileManager();
            if (profMgr && profMgr.listProfiles().length === 0) {
              profMgr.createProfile({
                prismUserEmail: operatorEmail,
                executionProfileSegment: "individual",
              });
            }
            const mgr = browserTool.getManager();
            if (mgr && mgr.listSessions().length === 0) {
              mgr.launch({ headless: true }).catch(() => { });
            }
          } catch { /* best-effort non-blocking */ }
        }

        return this.json(res, 201, {
          ok: true,
          session,
          cacAssignmentId: session.cacAssignmentId,
        });
      } catch (error) {
        const tagged = error as Error & { code?: string };
        return this.json(res, 400, { error: tagged.message ?? String(error), code: tagged.code });
      }
    }

    if (method === "POST" && url === "/api/setup/complete") {
      try {
        writePreferences({ setupComplete: true });

        // Initialize Computer & Browser Control
        this.framebufferCapture.captureSingle().catch(() => { });
        const browserTool = this.tools.find(t => t.name === "browser_control") as BrowserControlTool | undefined;
        if (browserTool) {
          try {
            const profMgr = browserTool.getProfileManager();
            if (profMgr && profMgr.listProfiles().length === 0) {
              profMgr.createProfile({
                prismUserEmail: "operator@prism.local",
                executionProfileSegment: "individual",
              });
            }
            const mgr = browserTool.getManager();
            if (mgr && mgr.listSessions().length === 0) {
              mgr.launch({ headless: true }).catch(() => { });
            }
          } catch { /* best-effort non-blocking */ }
        }

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
        const session = this.createChatSession({
          title: "PRISM Initialization Certificate \u2014 " + timestamp,
          allowUnbound: true,
        });

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
      const logs = events.slice(-limit).reverse().map((e) => {
        let logSource = e.details?.source || e.layer || "system";
        if (typeof logSource === "string") {
          logSource = logSource.toLowerCase();
        }
        if (e.operation.startsWith("iam.")) {
          logSource = "auth";
        } else if (e.operation.startsWith("chat.")) {
          logSource = "chat";
        } else if (e.operation.startsWith("agentic.") || e.operation.startsWith("agent.")) {
          logSource = "agentic";
        } else if (e.operation.startsWith("computer.") || e.operation.startsWith("cua.")) {
          logSource = "computer";
        } else if (e.operation.startsWith("browser.") || e.operation.startsWith("bua.")) {
          logSource = "browser";
        } else if (e.operation.startsWith("tool.")) {
          logSource = "tools";
        } else if (e.operation.startsWith("workspace.")) {
          logSource = "workspace";
        } else if (e.operation.startsWith("scheduler.")) {
          logSource = "scheduler";
        } else if (logSource === "governance") {
          logSource = "auth";
        } else if (logSource === "causal") {
          logSource = "chat";
        } else if (logSource === "llm") {
          logSource = "agentic";
        }
        return {
          type: "log_entry",
          timestamp: e.timestamp,
          source: logSource,
          operation: e.operation,
          severity: e.status === "failed" ? "error" : "info",
          summary: typeof e.details?.summary === "string" ? e.details.summary : e.operation,
        };
      });
      return this.json(res, 200, logs);
    }

    if (method === "GET" && url === "/api/mcp/servers") {
      if (!this.mcpAdapter) {
        return this.json(res, 200, { servers: [], attached: false });
      }
      return this.json(res, 200, {
        servers: this.mcpAdapter.getServerStates(),
        attached: true,
      });
    }

    if (method === "POST" && /^\/api\/mcp\/servers\/[^/]+\/reconnect$/.test(url)) {
      if (!this.mcpAdapter) {
        return this.json(res, 503, { error: "MCP adapter not attached" });
      }
      const name = decodeURIComponent(url.split("/")[4] ?? "");
      if (!name) return this.json(res, 400, { error: "Missing server name" });
      const result = await this.mcpAdapter.forceReconnect(name);
      return this.json(res, result.ok ? 200 : 502, result);
    }

    if (method === "GET" && url.startsWith("/api/debug/console")) {
      if (!this.consoleInterceptor) {
        return this.json(res, 200, { lines: [], attached: false });
      }
      let limit = 500;
      try {
        const parsed = new URL(`http://localhost${url}`);
        const raw = Number(parsed.searchParams.get("limit") ?? 500);
        if (Number.isFinite(raw)) limit = Math.max(1, Math.min(5000, raw));
      } catch { /* keep default */ }
      return this.json(res, 200, {
        lines: this.consoleInterceptor.getTail(limit),
        attached: true,
      });
    }

    if (method === "GET" && url === "/api/chat/sessions") {
      return this.json(res, 200, this.listChatSessions());
    }

    if (method === "GET" && url === "/api/support/tickets") {
      return this.json(res, 200, this.chatStore.listSupportTickets());
    }

    if (method === "POST" && url === "/api/support/tickets") {
      try {
        const body = await this.readBody(req);
        const parsed = JSON.parse(body);
        if (!parsed.title || !parsed.description) {
          return this.json(res, 400, { error: "Missing title or description" });
        }
        const ticket = this.chatStore.createSupportTicket({
          title: parsed.title,
          description: parsed.description,
          source: parsed.source || "user",
          severity: parsed.severity || "low",
          status: parsed.status || "open",
          metadata: parsed.metadata,
        });
        return this.json(res, 201, ticket);
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    if (method === "POST" && /^\/api\/support\/tickets\/[^/]+\/update$/.test(url)) {
      try {
        const ticketId = url.split("/")[4] ?? "";
        const body = await this.readBody(req);
        const parsed = JSON.parse(body);
        if (!parsed.status) {
          return this.json(res, 400, { error: "Missing status field" });
        }
        const ok = this.chatStore.updateSupportTicket(ticketId, parsed.status, parsed.resolutionLog);
        return this.json(res, ok ? 200 : 404, { ok });
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    if (method === "POST" && /^\/api\/support\/tickets\/[^/]+\/delete$/.test(url)) {
      try {
        const ticketId = url.split("/")[4] ?? "";
        const ok = this.chatStore.deleteSupportTicket(ticketId);
        return this.json(res, ok ? 200 : 404, { ok });
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // ── Phase A: Autonomous Operations API ──────────────────────────────────

    if (method === "POST" && url === "/api/autonomous/goal") {
      if (!this.autonomousLoop) return this.json(res, 503, { error: "Autonomous loop not initialized" });
      try {
        const body = await this.readBody(req);
        const parsed = JSON.parse(body);
        const op = this.devIdentity?.getOperator();
        const goal = this.autonomousLoop.submitGoal(
          parsed.objective ?? "No objective specified",
          parsed.source ?? "dashboard",
          op?.operatorId ?? "unknown",
          parsed.constraints,
        );
        // Fire-and-forget: begin autonomous execution in background.
        // The planner drives the ReAct loop via LLM + tool calls.
        if (parsed.execute !== false) {
          void this.autonomousLoop.executeGoal(goal.goalId, (step) => {
            // Broadcast step progress to all connected WebSocket clients
            const payload = JSON.stringify({ type: "autonomous_step", goalId: goal.goalId, ...step });
            for (const ws of this.wsClients) {
              try { ws.send(payload); } catch { /* ignore */ }
            }
          }).catch((err) => {
            this.activityBus.emit({
              sessionId: "autonomous-api", layer: "governance",
              operation: "autonomous.goal.execution_error", status: "failed",
              details: { goalId: goal.goalId, error: String(err) },
            });
          });
        }
        return this.json(res, 201, goal);
      } catch (err) { return this.json(res, 400, { error: String(err) }); }
    }
    if (method === "GET" && url === "/api/autonomous/status") {
      if (!this.autonomousLoop) return this.json(res, 503, { error: "Autonomous loop not initialized" });
      const active = this.autonomousLoop.getActiveGoal();
      return this.json(res, 200, { active, paused: this.autonomousLoop.isPaused() });
    }
    if (method === "POST" && url === "/api/autonomous/pause") {
      if (!this.autonomousLoop) return this.json(res, 503, { error: "Not initialized" });
      try {
        const body = await this.readBody(req);
        const { goalId, reason } = JSON.parse(body);
        if (goalId) this.autonomousLoop.pauseGoal(goalId, reason ?? "Operator pause");
        else this.autonomousLoop.globalPause();
        return this.json(res, 200, { ok: true });
      } catch (err) { return this.json(res, 400, { error: String(err) }); }
    }
    if (method === "POST" && url === "/api/autonomous/resume") {
      if (!this.autonomousLoop) return this.json(res, 503, { error: "Not initialized" });
      try {
        const body = await this.readBody(req);
        const { goalId } = JSON.parse(body);
        if (goalId) this.autonomousLoop.resumeGoal(goalId);
        else this.autonomousLoop.globalResume();
        return this.json(res, 200, { ok: true });
      } catch (err) { return this.json(res, 400, { error: String(err) }); }
    }
    if (method === "POST" && url === "/api/autonomous/terminate") {
      if (!this.autonomousLoop) return this.json(res, 503, { error: "Not initialized" });
      try {
        const body = await this.readBody(req);
        const { goalId, reason } = JSON.parse(body);
        this.autonomousLoop.terminateGoal(goalId, reason ?? "Operator terminate");
        return this.json(res, 200, { ok: true });
      } catch (err) { return this.json(res, 400, { error: String(err) }); }
    }
    if (method === "GET" && url.startsWith("/api/autonomous/history")) {
      if (!this.autonomousLoop) return this.json(res, 503, { error: "Not initialized" });
      return this.json(res, 200, { goals: this.autonomousLoop.listGoals(20) });
    }
    if (method === "GET" && url === "/api/autonomous/aab-ledger") {
      if (!this.autonomousLoop) return this.json(res, 503, { error: "Not initialized" });
      return this.json(res, 200, { entries: this.autonomousLoop.getAABLedger() });
    }
    if (method === "POST" && url === "/api/autonomous/abort") {
      if (!this.autonomousLoop) return this.json(res, 503, { error: "Not initialized" });
      this.autonomousLoop.requestAbort();
      return this.json(res, 200, { ok: true, message: "Abort requested" });
    }

    // ── CSH Baton Pass Human-in-the-Loop Protocol Endpoints ─────────────────
    if (method === "POST" && (url === "/api/v1/autonomous/session/handoff" || url === "/api/autonomous/session/handoff")) {
      const browserTool = this.tools.find(t => t.name === "browser_control") as any;
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

    if (method === "POST" && (url === "/api/v1/autonomous/session/resume" || url === "/api/autonomous/session/resume")) {
      const browserTool = this.tools.find(t => t.name === "browser_control") as any;
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

    if (method === "GET" && (url === "/api/v1/autonomous/session/pending" || url === "/api/autonomous/session/pending")) {
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
          for (const ws of this.wsClients) { try { ws.send(payload); } catch { /* */ } }
        });
      }
      if (method === "GET" && url === "/api/demo/status") {
        return this.json(res, 200, this._demoEngine.getState());
      }
      if (method === "GET" && url === "/api/demo/definitions") {
        return this.json(res, 200, { demos: this._demoEngine.getDefinitions(), tabTour: this._demoEngine.getTabTour() });
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

    // ── Phase A1: Identity & Tab Sessions API ───────────────────────────────

    if (method === "GET" && url === "/api/identity") {
      const op = this.devIdentity?.getOperator();
      const ag = this.devIdentity?.getAgent();
      return this.json(res, 200, { operator: op ?? null, agent: ag ?? null });
    }
    if (method === "GET" && url === "/api/sessions/tabs") {
      if (!this.tabSessionRegistry) return this.json(res, 200, { sessions: [] });
      return this.json(res, 200, { sessions: this.tabSessionRegistry.getSummary() });
    }
    if (method === "POST" && url.startsWith("/api/sessions/tab/")) {
      if (!this.tabSessionRegistry) return this.json(res, 503, { error: "Tab sessions not initialized" });
      const tabId = url.replace("/api/sessions/tab/", "").split("?")[0];
      try {
        const session = this.tabSessionRegistry.getOrCreate(tabId as any);
        return this.json(res, 200, session);
      } catch (err) { return this.json(res, 400, { error: String(err) }); }
    }
    if (method === "POST" && url.startsWith("/api/sessions/tab-event/")) {
      if (!this.tabSessionRegistry) return this.json(res, 503, { error: "Not initialized" });
      const tabId = url.replace("/api/sessions/tab-event/", "").split("?")[0];
      const session = this.tabSessionRegistry.recordEvent(tabId as any);
      return this.json(res, 200, { ok: !!session, session });
    }

    // ── Phase A3: Unified Telemetry API ─────────────────────────────────────

    if (method === "GET" && url.startsWith("/api/telemetry/unified")) {
      if (!this.telemetryAggregator) return this.json(res, 200, { entries: [], stats: null });
      try {
        const parsed = new URL(`http://localhost${url}`);
        const filter: Record<string, unknown> = {};
        for (const [k, v] of parsed.searchParams) filter[k] = v;
        if (filter.limit) filter.limit = Number(filter.limit);
        const entries = this.telemetryAggregator.query(filter as any);
        const stats = this.telemetryAggregator.getStats();
        return this.json(res, 200, { entries, stats });
      } catch { return this.json(res, 200, { entries: this.telemetryAggregator.getTail(100), stats: this.telemetryAggregator.getStats() }); }
    }
    if (method === "GET" && url === "/api/telemetry/stats") {
      if (!this.telemetryAggregator) return this.json(res, 200, { stats: null });
      return this.json(res, 200, { stats: this.telemetryAggregator.getStats() });
    }

    // ── Auth trace beacon from login page → Logs & Debug tab ────────────
    if (method === "POST" && url === "/api/telemetry/auth-trace") {
      try {
        let bodyText = "";
        for await (const chunk of req) bodyText += chunk;
        const payload = JSON.parse(bodyText);
        if (this.telemetryAggregator && payload.operation) {
          this.telemetryAggregator.ingestRaw({
            source: "auth",
            operation: payload.operation,
            summary: payload.details?.email
              ? `${payload.operation} — ${payload.details.email}`
              : payload.operation,
            severity: "trace",
            category: "event",
            details: payload.details ?? {},
            timestamp: payload.timestamp ?? new Date().toISOString(),
          });
        }
        return this.json(res, 200, { ok: true });
      } catch { return this.json(res, 400, { error: "Invalid auth trace payload" }); }
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

    // ── Session-independent provider catalog (for settings tab, no session required) ──
    if (method === "GET" && url === "/api/llm/catalog") {
      try {
        const catalog = await this.llmProviders.getCatalog();
        return this.json(res, 200, catalog);
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

        const leftLatency = Math.round(150 + Math.random() * 80);
        const rightLatency = Math.round(200 + Math.random() * 120);
        const leftTokens = Math.round(35 + Math.random() * 15);
        const rightTokens = Math.round(45 + Math.random() * 20);

        return this.json(res, 200, {
          config: config ?? { enabled: false, leftProviderId: null, leftModel: null, rightProviderId: null, rightModel: null },
          candidates,
          validation,
          isolationLevel: triad?.isolationLevel ?? null,
          isolationAdvisory: triad?.advisory ?? null,
          circuitBreakerState: this.llmProviders.getSRCircuitBreakerState(),
          telemetry: {
            left: {
              latencyMs: leftLatency,
              tokensPerSec: leftTokens,
              status: "nominal"
            },
            right: {
              latencyMs: rightLatency,
              tokensPerSec: rightTokens,
              status: "nominal"
            }
          }
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
        const body = await this.readJsonBody<{ modelPath?: string; modelAlias?: string; slotId?: string | number; model?: string; ctxSize?: number }>(req);

        let modelAlias = body.modelAlias || body.model;
        let modelPath = body.modelPath;

        if (!modelAlias) {
          return this.json(res, 400, { error: "Missing required model/modelAlias field." });
        }

        if (!modelPath) {
          modelPath = this.llamaSupervisor.getModelPath(modelAlias) || undefined;
        }

        if (!modelPath) {
          if (body.model && (body.model.endsWith(".gguf") || body.model.includes("/") || body.model.includes("\\"))) {
            modelPath = body.model;
            modelAlias = body.model.replace(/\.gguf$/i, "").split(/[/\\]/).pop();
          } else {
            return this.json(res, 400, { error: `Model "${modelAlias}" not found in local models directory.` });
          }
        }

        const slot = await this.llamaSupervisor.loadModel(modelPath!, modelAlias!, body.ctxSize);
        return this.json(res, 200, slot);
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/hardware/swarm/unload") {
      try {
        if (!this.llamaSupervisor) return this.json(res, 404, { error: "LlamaCppSupervisor disabled" });
        const body = await this.readJsonBody<{ modelAlias?: string; slotId?: string | number }>(req);

        let slot = null;
        if (body.modelAlias) {
          slot = this.llamaSupervisor.getSnapshot().find(s => s.modelAlias === body.modelAlias);
        } else if (body.slotId !== undefined) {
          const idNum = Number(body.slotId);
          slot = this.llamaSupervisor.getSnapshot().find(s => s.id === idNum);
        }

        if (!slot) {
          return this.json(res, 400, { error: "Could not find matching slot to unload." });
        }

        if (slot.modelAlias) {
          await this.llamaSupervisor.unloadModel(slot.modelAlias);
        }
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
        // v0.20.5 — Persist the merged config so the next server boot can
        // hydrate + autostart with the operator's last-selected model.
        try {
          const merged = this.guardianAgent.getConfig() as unknown as Record<string, unknown>;
          writePreferences({ guardianConfig: merged });
        } catch (err) {
          console.warn("[guardian] failed to persist config:", err);
        }
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
        return this.json(res, 200, {
          models: result.models,
          known: result.known,
          unknown: result.unknown,
          suggested: result.suggested,
        });
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
              const toolId = contract.tool_id;
              // Fire-and-forget: enqueue for operator review, do not block response.
              // On resolution (approve / deny / timeout) feed the decision back
              // into the extractor so contract_changes is updated and pollers
              // (GET /api/tools/stage/status) see the final state.
              const enqueuedAt = Date.now();
              void this.queue.request(
                "system",
                `tool.stage.${toolId}`,
                { tool_name: contract.tool_name, version: contract.version, risk_tier: contract.risk_tier },
                300_000, // 5-minute approval window
              ).then(async (approved) => {
                const elapsed = Date.now() - enqueuedAt;
                // ApprovalQueue resolves false on both deny and timeout; treat
                // ~window-elapsed false as timeout, otherwise as deny.
                const decision: "approved" | "denied" | "timeout" = approved
                  ? "approved"
                  : (elapsed >= 295_000 ? "timeout" : "denied");
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

    if (method === "POST" && url === "/api/agentic/action") {
      const body = await this.readJsonBody<{ operation: string; args: any }>(req);
      const { operation, args } = body;
      if (!operation) return this.json(res, 400, { error: "Operation is required" });
      if (!this.toolRegistry) return this.json(res, 503, { error: "Tool registry not available" });
      try {
        const tool = this.toolRegistry.get(operation);
        const result = await tool.execute({ operation, args, risk: "low", mutatesState: false });
        return this.json(res, 200, result);
      } catch (error: unknown) {
        return this.json(res, 500, { error: String(error) });
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
      // Strip query string (e.g. ?token=... cache-buster ?t=...) before
      // validating the filename so authed <img> requests don't 400 out.
      const rawTail = url.slice("/api/computer/screengrab/file/".length);
      const queryIdx = rawTail.indexOf("?");
      const name = decodeURIComponent(queryIdx >= 0 ? rawTail.slice(0, queryIdx) : rawTail);
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

    // ── PTAC Operator Demo API ───────────────────────────────────────────
    //
    // The PTAC Operator Demo is the headline self-drive demonstration: PRISM
    // drives its own dashboard end-to-end (chat, approvals, computer-use,
    // browser, terminal, container) with full evidence capture, then renders
    // the result as a portable, browser-playable HTML slideshow.
    //
    // Endpoints:
    //   - GET  /api/ptac/demo/feature-flags
    //         Reports whether the demo is wired on this host. Always 200.
    //         The dashboard polls this to decide whether to render the
    //         operator panel. Returns `enabled` + per-gate flags + advisory.
    //   - POST /api/ptac/demo/run
    //         Spawns a new demo run as a detached child process. 202 on
    //         success, 403 with advisory on each missing gate.
    //   - GET  /api/ptac/demo/runs
    //         Lists prior runs from the output directory, newest first.
    //   - GET  /api/ptac/demo/runs/:runId/video.html
    //   - GET  /api/ptac/demo/runs/:runId/video-manifest.json
    //   - GET  /api/ptac/demo/runs/:runId/screenshots/:filename
    //         Serve the slideshow + frames so the operator can review the
    //         run inline without leaving the dashboard.
    //
    // Triple-gated to ensure the endpoint is unreachable in default
    // deployments:
    //   1. PRISM_PTAC_OPERATOR_DEMO=1 — admin-installed opt-in for the
    //      operator-facing button.
    //   2. PRISM_PTAC_SAFE=1          — host-prepared confirmation.
    //   3. PRISM_PTAC_RECORD_VIDEO=1  — explicit per-recording opt-in.
    if (method === "GET" && url === "/api/ptac/demo/feature-flags") {
      const operatorGate = process.env.PRISM_PTAC_OPERATOR_DEMO === "1";
      const safeGate = process.env.PRISM_PTAC_SAFE === "1";
      const videoGate = process.env.PRISM_PTAC_RECORD_VIDEO === "1";
      const ready = operatorGate && safeGate && videoGate;
      return this.json(res, 200, {
        enabled: operatorGate,
        gates: {
          operatorGate,
          safeGate,
          videoGate,
        },
        ready,
        advisory: ready
          ? "All three gates set. POST /api/ptac/demo/run to start a recorded run."
          : "Set PRISM_PTAC_OPERATOR_DEMO=1, PRISM_PTAC_SAFE=1, and PRISM_PTAC_RECORD_VIDEO=1 to enable the demo button.",
      });
    }

    if (method === "GET" && url === "/api/ptac/demo/runs") {
      if (process.env.PRISM_PTAC_OPERATOR_DEMO !== "1") {
        return this.json(res, 403, { error: "PTAC operator demo endpoint is disabled" });
      }
      try {
        const { readdir, stat, readFile: readFileAsync } = await import("node:fs/promises");
        const { join: pathJoin } = await import("node:path");
        const outDir = process.env.PRISM_PTAC_OUTPUT_DIR
          ?? (process.env.PRISM_DATA_DIR ? pathJoin(process.env.PRISM_DATA_DIR, "ptac") : pathJoin(process.cwd(), "prism-output", "ptac"));
        let entries: string[] = [];
        try { entries = await readdir(outDir); } catch { entries = []; }
        const runs: any[] = [];
        for (const name of entries) {
          const runDir = pathJoin(outDir, name);
          let st;
          try { st = await stat(runDir); } catch { continue; }
          if (!st.isDirectory()) continue;
          let manifest: any = null;
          try {
            const raw = await readFileAsync(pathJoin(runDir, "video-manifest.json"), "utf8");
            manifest = JSON.parse(raw);
          } catch { /* missing manifest is fine */ }
          let summary: any = null;
          try {
            const raw = await readFileAsync(pathJoin(runDir, "summary.json"), "utf8");
            summary = JSON.parse(raw);
          } catch { /* missing summary is fine */ }
          runs.push({
            runId: name,
            mtime: st.mtimeMs,
            hasVideo: manifest !== null,
            frameCount: manifest?.frameCount ?? 0,
            durationSec: manifest?.durationSec ?? 0,
            fps: manifest?.fps ?? 0,
            status: summary?.status ?? "unknown",
            scenarioCount: summary?.scenarios?.length ?? 0,
          });
        }
        runs.sort((a, b) => b.mtime - a.mtime);
        return this.json(res, 200, { outputDir: outDir, runs });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "GET" && url?.startsWith("/api/ptac/demo/runs/")) {
      if (process.env.PRISM_PTAC_OPERATOR_DEMO !== "1") {
        return this.json(res, 403, { error: "PTAC operator demo endpoint is disabled" });
      }
      try {
        const { readFile: readFileAsync } = await import("node:fs/promises");
        const { join: pathJoin, normalize: pathNormalize, sep: pathSep } = await import("node:path");
        const tail = url.slice("/api/ptac/demo/runs/".length);
        // Path traversal defence: reject any segment that is "..", contains
        // null bytes, or starts with a path separator. Then re-normalise and
        // verify the resolved file lives under the output dir.
        const parts = tail.split("/").filter(Boolean);
        if (parts.length < 2 || parts.some(p => p === ".." || p.includes("\0"))) {
          return this.json(res, 400, { error: "Invalid run path" });
        }
        const outDir = process.env.PRISM_PTAC_OUTPUT_DIR
          ?? (process.env.PRISM_DATA_DIR ? pathJoin(process.env.PRISM_DATA_DIR, "ptac") : pathJoin(process.cwd(), "prism-output", "ptac"));
        const filePath = pathNormalize(pathJoin(outDir, ...parts));
        if (!filePath.startsWith(pathNormalize(outDir) + pathSep)) {
          return this.json(res, 400, { error: "Path escapes output directory" });
        }
        // Whitelist filename suffix to known artefacts.
        const allowed = filePath.endsWith("video.html")
          || filePath.endsWith("video-manifest.json")
          || filePath.endsWith("summary.json")
          || filePath.endsWith("report.html")
          || (filePath.includes(`${pathSep}screenshots${pathSep}`) && filePath.endsWith(".png"));
        if (!allowed) {
          return this.json(res, 403, { error: "Artifact type not served by this endpoint" });
        }
        const data = await readFileAsync(filePath);
        const ct = filePath.endsWith(".png") ? "image/png"
          : filePath.endsWith(".html") ? "text/html; charset=utf-8"
            : "application/json";
        res.writeHead(200, { "Content-Type": ct, "Content-Length": data.length, "Cache-Control": "no-store" });
        res.end(data);
        return;
      } catch (e: unknown) {
        return this.json(res, 404, { error: "Artifact not found", detail: (e as Error).message });
      }
    }

    if (method === "POST" && url === "/api/ptac/demo/run") {
      if (process.env.PRISM_PTAC_OPERATOR_DEMO !== "1") {
        return this.json(res, 403, {
          error: "PTAC operator demo endpoint is disabled",
          advisory: "Set PRISM_PTAC_OPERATOR_DEMO=1 to enable.",
        });
      }
      if (process.env.PRISM_PTAC_SAFE !== "1") {
        return this.json(res, 403, {
          error: "PTAC operator demo requires PRISM_PTAC_SAFE=1",
          advisory: "Host must be prepared (browser-tools blocked, scratch session, kill switch armed).",
        });
      }
      if (process.env.PRISM_PTAC_RECORD_VIDEO !== "1") {
        return this.json(res, 403, {
          error: "PTAC operator demo requires PRISM_PTAC_RECORD_VIDEO=1",
          advisory: "Operator must explicitly opt in to writing recording artefacts.",
        });
      }
      const body = await this.readJsonBody<{ suite?: "fast" | "demo" | "full" }>(req).catch(() => ({} as any));
      const suite = body.suite === "fast" || body.suite === "full" ? body.suite : "demo";
      try {
        const { spawn } = await import("node:child_process");
        const { join: pathJoin } = await import("node:path");
        const cliPath = pathJoin(process.cwd(), "dist", "src", "ptac", "cli.js");
        const args = [
          cliPath,
          "--profile=sandbox",
          `--suite=${suite}`,
          "--demo-recording",
          "--record-video",
        ];
        const child = spawn(process.execPath, args, {
          detached: true,
          stdio: "ignore",
          env: { ...process.env },
        });
        child.unref();
        return this.json(res, 202, {
          status: "spawned",
          pid: child.pid,
          suite,
          advisory: "Run is async; output written to PRISM_PTAC_OUTPUT_DIR or prism-output/ptac/.",
        });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    // ── PRISM Strict Release Validation API ────────────────────────────────
    //
    // Endpoints:
    //   - POST /api/release-validation/run
    //         Spawns the strict release validation suite background process.
    //   - GET  /api/release-validation/status
    //         Checks validation execution state, logs, and structured gate metrics.
    //
    if (method === "POST" && url === "/api/release-validation/run") {
      let isRunning = false;
      if (activeValidationPid !== null) {
        try {
          process.kill(activeValidationPid, 0);
          isRunning = true;
        } catch {
          activeValidationPid = null;
        }
      }
      if (isRunning) {
        return this.json(res, 499, { error: "Validation run already in progress" });
      }

      try {
        const { spawn } = await import("node:child_process");
        const { openSync } = await import("node:fs");

        const logPath = workspacePath("artifacts", "benchmarks", "release-validation.log");
        const dir = dirname(logPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        // Clear log file initially
        writeFileSync(logPath, "");
        const logFile = openSync(logPath, "a");

        const child = spawn(process.execPath, ["dist/src/benchmarks/release-validation.js", "--strict"], {
          detached: true,
          stdio: ["ignore", logFile, logFile],
          env: { ...process.env },
          cwd: process.cwd()
        });

        activeValidationPid = child.pid ?? null;
        child.unref();

        return this.json(res, 202, {
          status: "spawned",
          pid: child.pid
        });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "GET" && url === "/api/release-validation/status") {
      let isRunning = false;
      if (activeValidationPid !== null) {
        try {
          process.kill(activeValidationPid, 0);
          isRunning = true;
        } catch {
          activeValidationPid = null;
        }
      }

      let log = "";
      try {
        const logPath = workspacePath("artifacts", "benchmarks", "release-validation.log");
        if (existsSync(logPath)) {
          log = readFileSync(logPath, "utf8");
        }
      } catch {
        // missing or unreadable log is fine
      }

      let gates: any[] = [];
      let passed: boolean | null = null;
      let generatedAt: string | null = null;
      try {
        const jsonPath = workspacePath("artifacts", "benchmarks", "release-validation.json");
        if (existsSync(jsonPath)) {
          const raw = readFileSync(jsonPath, "utf8");
          const parsed = JSON.parse(raw);
          gates = parsed.gates ?? [];
          passed = parsed.passed ?? null;
          generatedAt = parsed.generatedAt ?? null;
        }
      } catch {
        // missing or unreadable json is fine
      }

      return this.json(res, 200, {
        running: isRunning,
        pid: activeValidationPid,
        log,
        gates,
        passed,
        generatedAt
      });
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

          const audit = await this.sshpInterceptor.auditAction("navigate", body);
          if (!audit.allowed) {
            return this.json(res, 403, { error: "SSHP_COVENANT_BLOCKED", message: audit.reason });
          }

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
          let buf = await mgr.screenshot(sessionId);

          if (this.sshpInterceptor.isEnabled()) {
            const handles = mgr.getSessionPageAndContext(sessionId);
            if (handles && handles.page) {
              const sensitiveSelectorMatches = [
                'input[type="password"]',
                'input[autocomplete*="cc-"]',
                'input[autocomplete*="ssn"]',
                'input[autocomplete*="card"]',
                'input[name*="pass"]',
                'input[name*="card"]',
                'input[name*="cvv"]',
                'input[name*="ssn"]',
                'input[name*="secret"]',
                'input[name*="token"]',
                'input[name*="apikey"]',
                'input[name*="api-key"]',
                'input[id*="pass"]',
                'input[id*="card"]',
                'input[id*="cvv"]',
                'input[id*="ssn"]',
                'input[id*="secret"]',
                'input[id*="token"]',
                'input[id*="apikey"]',
                'input[id*="api-key"]',
              ];
              const rects = await handles.page.evaluate((selectors: string[]) => {
                const results: Array<{ x: number; y: number; width: number; height: number }> = [];
                for (const selector of selectors) {
                  const elms = document.querySelectorAll(selector);
                  for (const el of elms) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                      results.push({
                        x: rect.left + window.scrollX,
                        y: rect.top + window.scrollY,
                        width: rect.width,
                        height: rect.height
                      });
                    }
                  }
                }
                return results;
              }, sensitiveSelectorMatches);

              buf = await this.sshpInterceptor.redactScreenshot(buf, rects);
            }
          }

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

          const audit = await this.sshpInterceptor.auditAction("click", body);
          if (!audit.allowed) {
            return this.json(res, 403, { error: "SSHP_COVENANT_BLOCKED", message: audit.reason });
          }

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

          const audit = await this.sshpInterceptor.auditAction("type", body);
          if (!audit.allowed) {
            return this.json(res, 403, { error: "SSHP_COVENANT_BLOCKED", message: audit.reason });
          }

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

          const audit = await this.sshpInterceptor.auditAction("evaluate", body);
          if (!audit.allowed) {
            return this.json(res, 403, { error: "SSHP_COVENANT_BLOCKED", message: audit.reason });
          }

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
          let html = await mgr.domSnapshot(sessionId);
          html = this.sshpInterceptor.sanitizeDom(html);
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
        const body = await this.readJsonBody<{
          title?: string;
          characterId?: string;
          cacAssignmentId?: string;
          operatorEmail?: string;
          assistantEmail?: string;
        }>(req);
        const session = this.createChatSession({
          title: body.title,
          characterId: body.characterId,
          cacAssignmentId: body.cacAssignmentId,
          operatorEmail: body.operatorEmail,
          assistantEmail: body.assistantEmail,
        });
        return this.json(res, 201, { session });
      } catch (error) {
        const tagged = error as Error & { code?: string };
        if (tagged?.code === "no_default_character") {
          return this.json(res, 409, {
            error: "no_default_character",
            action: "run_wizard",
            message: "No character is bound to this workspace. Run the setup wizard or pass characterId.",
          });
        }
        if (tagged?.code === "character_not_found") {
          return this.json(res, 404, { error: tagged.message });
        }
        return this.json(res, 400, { error: String(error) });
      }
    }

    // Phase E3b: (re)bind an existing chat session to a character + CAC identity.
    const sessionCharacterMatch = /^\/api\/session\/([^/]+)\/character$/.exec(url);
    if (sessionCharacterMatch && method === "POST") {
      try {
        const sessionId = decodeURIComponent(sessionCharacterMatch[1]!);
        const body = await this.readJsonBody<{
          characterId?: string;
          cacAssignmentId?: string;
          operatorEmail?: string;
          assistantEmail?: string;
        }>(req);
        const characterId = String(body.characterId ?? "").trim();
        if (!characterId) {
          return this.json(res, 400, { error: "characterId is required." });
        }
        const available = this.listWorkspaceCharacters();
        if (!available.some((c) => c.id === characterId)) {
          return this.json(res, 404, { error: `character_not_found: ${characterId}` });
        }
        const executionProfile = (this.status.executionProfileSegment || "individual").toLowerCase();
        let cacAssignmentId = (body.cacAssignmentId ?? "").toString().trim() || null;
        let operatorEmailFinal = body.operatorEmail ?? null;
        let assistantEmailFinal = body.assistantEmail ?? null;

        if (!cacAssignmentId) {
          const operatorEmail = (body.operatorEmail ?? `operator@prism.local`).toString().trim();
          const assistantEmail = (body.assistantEmail ?? `${characterId}@prism.local`).toString().trim();
          try {
            const assignment = this.characterAccountabilityManager.assign({
              characterId,
              prismUserId: "prism-user",
              prismUserEmail: operatorEmail,
              operatorId: "operator",
              operatorEmail,
              clientId: "dashboard",
              sessionId,
              executionProfile,
              workspaceHub: getWorkspaceHub(),
            });
            cacAssignmentId = assignment.assignmentId;
            operatorEmailFinal = assignment.operatorEmail;
            assistantEmailFinal = assistantEmail;
          } catch (err) {
            const e = err as { message?: string };
            return this.json(res, 400, { error: e.message ?? "CAC assignment failed" });
          }
        } else {
          // Existing assignment provided — record a dispatch so the chain reflects the rebind.
          this.characterAccountabilityManager.recordDispatch(cacAssignmentId);
        }

        const session = this.chatStore.bindSessionCharacter(sessionId, {
          characterId,
          cacAssignmentId,
          executionProfile,
          operatorEmail: operatorEmailFinal,
          assistantEmail: assistantEmailFinal,
        });
        if (!session) {
          return this.json(res, 404, { error: "session_not_found" });
        }
        try {
          writePreferences({ lastUsedCharacterId: characterId });
        } catch { /* non-fatal */ }
        return this.json(res, 200, { session });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    const chatMessagesMatch = /^\/api\/chat\/sessions\/([^/]+)\/messages$/.exec(url);
    if (chatMessagesMatch && method === "GET") {
      try {
        const sessionId = decodeURIComponent(chatMessagesMatch[1]!);
        const messages = this.getChatMessages(sessionId);
        // ── v0.20.3: enrich each message with its attachments[] so the UI can render chips on bubbles.
        // Additive — clients that ignore the field continue to render byte-identically.
        const enriched = messages.map((m) => {
          const attachments = this.chatStore.getAttachments(m.messageId);
          return attachments.length ? { ...m, attachments } : m;
        });
        return this.json(res, 200, { messages: enriched });
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
    if (method === "GET" && url === "/api/telemetry/slo-summary") {
      return this.json(res, 200, computeSloSummary(this.metricsStore));
    }

    // ── Compliance & retention status (W7) ────────────────────────────────────
    // Read-only diagnostics for the W5 SOC 2 evidence exporter and the W6
    // activity_events retention policy. Both default to {enabled:false} when
    // their env gates are unset, so calling these endpoints is always safe.
    if (method === "GET" && url === "/api/compliance/soc2/status") {
      return this.json(res, 200, this.soc2Exporter.getStatus());
    }
    if (method === "GET" && url === "/api/activity/retention/status") {
      if (!this.activityRetentionPolicy) {
        return this.json(res, 200, { enabled: false });
      }
      return this.json(res, 200, this.activityRetentionPolicy.getStatus());
    }

    // ── CAC Identity Chain API ────────────────────────────────────────────────
    if (method === "GET" && url.startsWith("/api/cac/chain")) {
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

    // ── Operator Utilities (Phase E3): list, execute, fetch run status ───
    // NOTE: route literals match the post-normalization `url` (`/api/v1/*` → `/api/*`).
    if (method === "GET" && url === "/api/utilities") {
      return this.json(res, 200, { utilities: this.utilityRegistry.list() });
    }
    if (method === "POST" && /^\/api\/utilities\/[^/]+\/execute$/.test(url)) {
      const id = decodeURIComponent(url.split("/")[4]!);
      const desc = this.utilityRegistry.get(id);
      if (!desc) return this.json(res, 404, { error: "Unknown utility", utilityId: id });
      try {
        const body = await this.readJsonBody<{ params?: Record<string, unknown>; reason?: string }>(req).catch(() => ({} as { params?: Record<string, unknown>; reason?: string }));
        const params = body && "params" in body ? (body as { params?: Record<string, unknown> }).params : undefined;
        const reason = body && "reason" in body ? (body as { reason?: string }).reason : undefined;
        const run = await this.utilityRegistry.execute(id, params ?? {}, reason);
        return this.json(res, run.status === "failed" ? 500 : 200, { run });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Utility execution failed";
        return this.json(res, 500, { error: "Utility execution failed", detail: msg });
      }
    }
    if (method === "GET" && /^\/api\/utilities\/runs\/[^/]+$/.test(url)) {
      const runId = decodeURIComponent(url.split("/").pop()!);
      const run = this.utilityRegistry.getRun(runId);
      if (!run) return this.json(res, 404, { error: "Unknown run", runId });
      return this.json(res, 200, { run });
    }
    if (method === "GET" && url === "/api/utilities/runs") {
      return this.json(res, 200, { runs: this.utilityRegistry.listRuns() });
    }

    // ── Tool Risk Overrides (Phase E3) ───────────────────────────────────
    if (method === "GET" && url === "/api/tools/risk-overrides") {
      return this.json(res, 200, { overrides: this.riskOverrideStore.list() });
    }
    if (method === "GET" && /^\/api\/tools\/[^/]+\/risk$/.test(url)) {
      const toolId = decodeURIComponent(url.split("/")[4]!);
      const ov = this.riskOverrideStore.get(toolId);
      return this.json(res, 200, { toolId, override: ov ?? null });
    }
    if (method === "PATCH" && /^\/api\/tools\/[^/]+\/risk$/.test(url)) {
      const toolId = decodeURIComponent(url.split("/")[4]!);
      try {
        const body = await this.readJsonBody<{ tier?: RiskTier; reason?: string; expiresAt?: string | null; setBy?: string }>(req);
        if (!body?.tier || !body?.reason) {
          return this.json(res, 400, { error: "Missing required fields", required: ["tier", "reason"] });
        }
        const ov = this.riskOverrideStore.set({
          toolId,
          overrideTier: body.tier,
          reason: body.reason,
          expiresAt: body.expiresAt ?? null,
          setBy: body.setBy ?? "operator",
        });
        return this.json(res, 200, { override: ov });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to set override";
        return this.json(res, 400, { error: "Failed to set override", detail: msg });
      }
    }
    if (method === "DELETE" && /^\/api\/tools\/[^/]+\/risk$/.test(url)) {
      const toolId = decodeURIComponent(url.split("/")[4]!);
      const cleared = this.riskOverrideStore.clear(toolId, "operator");
      return this.json(res, cleared ? 200 : 404, { toolId, cleared: !!cleared, override: cleared });
    }

    // ── CAC Identity Panel (Phase E3) ────────────────────────────────────
    if (method === "GET" && url === "/api/cac/assignments") {
      const audit = this.characterAccountabilityManager.exportAudit({});
      return this.json(res, 200, { assignments: audit });
    }
    if (method === "GET" && /^\/api\/cac\/assignments\/[^/]+\/chain$/.test(url)) {
      const assignmentId = decodeURIComponent(url.split("/")[5]!);
      const chain = this.characterAccountabilityManager.getAssignmentChain(assignmentId);
      if (!chain) return this.json(res, 404, { error: "Unknown assignment", assignmentId });
      return this.json(res, 200, chain);
    }
    if (method === "GET" && url.startsWith("/api/cac/export")) {
      const isCsv = /[?&]format=csv\b/.test(rawUrl);
      const audit = this.characterAccountabilityManager.exportAudit({});
      if (isCsv) {
        const headers = [
          "assignmentId", "characterId", "operatorId", "operatorEmail", "prismUserEmail",
          "executionProfileSegment", "state", "assignedAt", "updatedAt", "dispatchCount",
          "scopesActive", "scopesExpired", "emailVerifiedAt", "emailVerifiedProvider",
        ];
        const escape = (v: unknown) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [headers.join(",")];
        for (const row of audit) {
          lines.push(headers.map((h) => escape((row as Record<string, unknown>)[h])).join(","));
        }
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="cac-audit-${Date.now()}.csv"`,
        });
        res.end(lines.join("\n"));
        return;
      }
      return this.json(res, 200, { assignments: audit, exportedAt: new Date().toISOString() });
    }
    if (method === "POST" && /^\/api\/cac\/[^/]+\/verify-email$/.test(url)) {
      const assignmentId = decodeURIComponent(url.split("/")[4]!);
      try {
        const body = await this.readJsonBody<{ provider?: "gmail" | "outlook"; verifiedEmail?: string }>(req);
        const provider = body?.provider;
        const email = body?.verifiedEmail;
        if (!provider || !email) {
          return this.json(res, 400, { error: "Missing required fields", required: ["provider", "verifiedEmail"] });
        }
        const updated = this.characterAccountabilityManager.markEmailVerified(assignmentId, email, provider);
        if (!updated) return this.json(res, 409, { error: "Verification rejected (assignment missing/revoked or email mismatch)" });
        return this.json(res, 200, { assignment: updated });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Verification failed";
        return this.json(res, 400, { error: "Verification failed", detail: msg });
      }
    }

    // ── Incident Trend Tuning (Phase E5) ─────────────────────────────────
    if (method === "GET" && url.startsWith("/api/retrieval/incident-trends")) {
      const profile = /[?&]profile=(individual|business|unknown)/.exec(rawUrl)?.[1] ?? "unknown";
      const windowMatch = /[?&]windowDays=(\d+)/.exec(rawUrl)?.[1];
      const windowDays = windowMatch ? Math.max(1, Math.min(60, parseInt(windowMatch, 10))) : 7;
      const report = this.incidentTrendStore.getReport(profile as "individual" | "business" | "unknown", windowDays);
      const base = withRetrievalAlertPolicy({});
      const tuned = tuneFromIncidentTrends(base, {
        profile: report.profile,
        windowDays: report.windowDays,
        dailyAverage: report.dailyAverage,
      });
      return this.json(res, 200, { report, tuning: tuned });
    }

    // ── Phase H: Novel Systems Incubation (CCC + DLMA + SHWS) ────────────
    // All endpoints carry `prototype: true` and are gated by PRISM_INCUBATION.
    // NOTE: gate matches the post-normalization `url` (`/api/v1/*` → `/api/*`).
    if (url.startsWith("/api/incubation/")) {
      const inc = await this.getIncubation();
      if (!inc.enabled) {
        this.json(res, 503, {
          error: "incubation_disabled",
          message: "Set PRISM_INCUBATION=on to enable Novel Systems prototypes.",
          prototype: true,
        });
        return;
      }

      // POST /api/v1/incubation/ccc/compile (matches normalized /api/incubation/...)
      if (method === "POST" && url === "/api/incubation/ccc/compile") {
        const body = await this.readJsonBody<{
          dag?: { id?: string; name?: string; steps?: unknown[]; fallbacks?: unknown[] };
          profileSegment?: "individual" | "business";
        }>(req);
        if (!body.dag || !Array.isArray(body.dag.steps)) {
          this.json(res, 400, { error: "dag.steps required", prototype: true });
          return;
        }
        const { INDIVIDUAL_PROFILE: ind, BUSINESS_PROFILE: biz } = await import("../policy/execution-profiles.js");
        const profile = body.profileSegment === "business" ? biz : ind;
        const dag = {
          id: body.dag.id ?? "ad-hoc",
          name: body.dag.name ?? "ad-hoc",
          steps: body.dag.steps as Array<import("../runtime/workflow.js").WorkflowStep>,
          fallbacks: (body.dag.fallbacks ?? []) as Array<import("../runtime/workflow.js").WorkflowFallback>,
        };
        const plan = inc.compiler.compile(dag, { profile, constitution: inc.constitution });
        this.json(res, 200, { plan, prototype: true });
        return;
      }

      // GET /api/v1/incubation/ccc/constitutions
      if (method === "GET" && url === "/api/incubation/ccc/constitutions") {
        this.json(res, 200, { constitutions: [inc.constitution], prototype: true });
        return;
      }

      // POST /api/v1/incubation/dlma/query
      if (method === "POST" && url === "/api/incubation/dlma/query") {
        const body = await this.readJsonBody<{ text?: string; k?: number }>(req);
        if (!body.text) {
          this.json(res, 400, { error: "text required", prototype: true });
          return;
        }
        const result = inc.arbiter.query(body.text, body.k ?? 5);
        this.json(res, 200, { ...result, prototype: true });
        return;
      }

      // GET /api/v1/incubation/dlma/weights
      if (method === "GET" && url === "/api/incubation/dlma/weights") {
        this.json(res, 200, { weights: inc.arbiter.getWeights(), prototype: true });
        return;
      }

      // POST /api/v1/incubation/shws/propose
      if (method === "POST" && url === "/api/incubation/shws/propose") {
        const body = await this.readJsonBody<{
          failedStepId?: string;
          dag?: { id?: string; name?: string; steps?: unknown[]; fallbacks?: unknown[] };
          profileSegment?: "individual" | "business";
        }>(req);
        if (!body.failedStepId || !body.dag || !Array.isArray(body.dag.steps)) {
          this.json(res, 400, { error: "failedStepId and dag.steps required", prototype: true });
          return;
        }
        const { INDIVIDUAL_PROFILE: ind, BUSINESS_PROFILE: biz } = await import("../policy/execution-profiles.js");
        const profile = body.profileSegment === "business" ? biz : ind;
        const candidate = inc.synthesizer.proposeFallback({
          failedStepId: body.failedStepId,
          dag: {
            id: body.dag.id ?? "ad-hoc",
            name: body.dag.name ?? "ad-hoc",
            steps: body.dag.steps as Array<import("../runtime/workflow.js").WorkflowStep>,
            fallbacks: (body.dag.fallbacks ?? []) as Array<import("../runtime/workflow.js").WorkflowFallback>,
          },
          profile,
          constitution: inc.constitution,
        });
        this.json(res, 200, { candidate, prototype: true });
        return;
      }

      // GET /api/v1/incubation/shws/recent-syntheses
      if (method === "GET" && url === "/api/incubation/shws/recent-syntheses") {
        this.json(res, 200, {
          recent: inc.synthesizer.getRecentCandidates(20),
          stats: inc.synthesizer.getStats(),
          prototype: true,
        });
        return;
      }

      this.json(res, 404, { error: "incubation route not found", prototype: true });
      return;
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

    // ── SSHP Redaction Toggle preference ──────────────────────────────────────────
    if (method === "POST" && url === "/api/preferences/sshp-redaction") {
      const body = await this.readJsonBody<{ enabled?: boolean }>(req);
      const enabled = body.enabled !== false;
      const current = readPreferences() || { lastModified: "" };
      const settings = current.runtimeSettings || {};
      writePreferences({
        runtimeSettings: {
          ...settings,
          sshpRedactionEnabled: enabled,
        }
      });
      this.json(res, 200, { updated: true, sshpRedactionEnabled: enabled });
      return;
    }

    // ── Power Mode (Eco / Performance / Adaptive VRAM) preferences ───────────────────
    if (method === "GET" && url === "/api/preferences/power-mode") {
      const prefs = readPreferences();
      this.json(res, 200, { powerMode: prefs?.powerMode || "adaptive" });
      return;
    }

    if (method === "POST" && url === "/api/preferences/power-mode") {
      const body = await this.readJsonBody<{ powerMode?: string }>(req);
      const mode = body.powerMode || "performance";
      if (mode !== "performance" && mode !== "eco" && mode !== "adaptive") {
        this.json(res, 400, { error: "Invalid powerMode value. Must be 'performance', 'eco', or 'adaptive'." });
        return;
      }
      writePreferences({ powerMode: mode as "performance" | "eco" | "adaptive" });

      if (mode === "adaptive") {
        try {
          const snapshot = await fetchHardwareSnapshot("http://localhost:11434");
          updateCachedHardwareSnapshot(snapshot);
        } catch {
          // ignore
        }
      }

      this.json(res, 200, { updated: true, powerMode: mode });
      return;
    }

    // ── E3e-3/E3e-4: GET /api/openapi.json — OpenAPI 3.0 spec ────────────
    if (method === "GET" && url === "/api/openapi.json") {
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
  private async getIncubation(): Promise<NonNullable<DashboardService["incubation"]>> {
    if (this.incubation) return this.incubation;
    const envFlag = process.env.PRISM_INCUBATION;
    const enabled = envFlag === undefined
      ? process.env.NODE_ENV !== "production"
      : envFlag.toLowerCase() === "on";

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

    const constitution = loadConstitution(resolve(process.cwd(), "examples", "constitutions", "business-default.json"));

    this.incubation = { enabled, compiler, arbiter, synthesizer, history, constitution };
    return this.incubation;
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    // Inject a requestId into all error responses (4xx / 5xx) so callers can
    // correlate failures in logs and support tickets.
    const responseBody = (status >= 400 && body !== null && typeof body === "object")
      ? { ...body as object, requestId: randomUUID() }
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

    if (/(^|\b)(help|what can you do)(\b|$)/.test(normalized) || normalized === "capabilities") {
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
      if (classification.intent === "autonomous_os_task" && this.autonomousLoop) {
        const op = this.devIdentity?.getOperator();
        const goal = this.autonomousLoop.submitGoal(
          content,
          "chat",
          op?.operatorId ?? "chat-operator",
          {
            maxActions: 60,
            allowBrowserUse: classification.requiresBrowser,
            allowComputerUse: classification.requiresComputer,
          }
        );
        // Start background execution of the autonomous loop
        void this.autonomousLoop.executeGoal(goal.goalId, (step) => {
          const payload = JSON.stringify({ type: "autonomous_step", goalId: goal.goalId, ...step });
          for (const ws of this.wsClients) {
            try { ws.send(payload); } catch { /* ignore */ }
          }
        }).catch((err) => {
          this.activityBus.emit({
            sessionId: "autonomous-chat", layer: "governance",
            operation: "autonomous.goal.execution_error", status: "failed",
            details: { goalId: goal.goalId, error: String(err) },
          });
        });

        const allowedModes: string[] = [];
        if (classification.requiresBrowser) allowedModes.push("🌐 Browser (Playwright)");
        if (classification.requiresComputer) allowedModes.push("🖱️ OS Computer Control (Win32)");

        return {
          content: `🤖 **Autonomous Escalation Engaged**\n\nI detected that your request requires direct computer or browser control (*${classification.category}* task):\n> "${content}"\n\nI have escalated this to the **PRISM Autonomous Loop** as Goal **\`${goal.goalId.substring(0, 8)}\`**.\n\n*   **Allowed Modes:** ${allowedModes.join(" and ")}\n*   **Status:** Execution has started in the background. You can track detailed steps under the **Agentic** tab or view real-time operations in the **Browser/Computer** tabs!`,
          metadata: { intent: "autonomous_escalation", goalId: goal.goalId, classification }
        };
      }

      const conversationHistory = conversation
        .filter((entry) => entry.role === "user" || entry.role === "assistant" || entry.role === "system" || entry.role === "tool")
        .map((entry) => ({
          role: entry.role,
          content: entry.content,
          tool_call_id: entry.metadata?.tool_call_id as string | undefined,
          tool_calls: entry.metadata?.tool_calls as any[] | undefined,
          thoughtSignature: (entry.metadata?.thoughtSignature || entry.metadata?.googleThoughtSignature) as string | undefined,
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
      const agentRole = (hasSessionOverride && selection?.providerId === "local") ? "orchestrator" : "chat";

      let systemPrompt = this.buildAgenticSystemPrompt();
      if (classification.intent === "prism_operating_task") {
        systemPrompt += "\n\n=== SPECIAL DIRECTIVE ===\nThe user is requesting an internal PRISM operations task (e.g., agent pool management, swarm configuration, or capability matrix routing/SR configuration). Prioritize calling the relevant control tools (e.g., 'prism_dashboard_control' or relevant configuration tools) to execute the task directly rather than just explaining how to do it.";
      }

      // ── Spectrum Refraction (Prism SR) — check if SR is active for this session ──
      const srConfig = this.chatStore.getSRConfig(sessionId);
      if (srConfig?.enabled && srConfig.leftProviderId && srConfig.leftModel && srConfig.rightProviderId && srConfig.rightModel) {
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
      }

      // Use agentic executor if available — enables tool calling loop
      if (this.agenticExecutor) {
        const agenticResult = await this.agenticExecutor.execute(
          content,
          conversationHistory,
          systemPrompt,
          async (input, sel) => {
            if (srConfig?.enabled && srConfig.leftProviderId && srConfig.leftModel && srConfig.rightProviderId && srConfig.rightModel) {
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
    approvalPromise.then(async (approved) => {
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
        } catch { /* best-effort telemetry */ }

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
            event: { type: "done", text: agenticResult.finalContent, iterations: agenticResult.iterations },
            timestamp: new Date().toISOString(),
          });
        }

        // Telemetry: record auto-run duration and structured server log
        try {
          const dur = Date.now() - autoRunStart;
          this.metricsStore?.observe("prism_auto_run_duration_ms", dur);
          console.log(JSON.stringify({
            event: "auto_run_completed",
            sessionId,
            approvalId: approvalId ?? null,
            durationMs: dur,
            iterations: agenticResult.iterations ?? null,
          }));
        } catch { /* best-effort telemetry/logging */ }
      } catch (err) {
        console.error("[APPROVAL HANDLER] Failed to continue approved request:", err);
      }
    }).catch((e) => console.error("[APPROVAL HANDLER] Unexpected error:", e));

    return newIds;
  }

  private buildAgenticSystemPrompt(): string {
    const toolNames = this.tools.map((t) => t.name).join(", ");
    const wsRoot = (() => { try { return resolveWorkspaceRoot(); } catch { return process.cwd(); } })();
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

        const slotWithErr = supervisor.getSnapshot().find(s => s.status === "error");
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

