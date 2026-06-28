/**
 * Dashboard type definitions — extracted from dashboard-service.ts (Phase 1).
 *
 * These types define the contract for the dashboard's REST API responses,
 * internal state tracking, and inter-module communication.
 */

import type { ChatSessionSummary, ChatMessage, SessionConfigDraft, SessionConfigHistoryEntry } from "../chat-session-store.js";
import type { PrismLlmProviderId } from "../llm-provider-manager.js";
import type { ActivityEvent } from "../../activity/types.js";

// ── Runtime Status ────────────────────────────────────────────────────────────

export interface DashboardRuntimeStatus {
  sessionId: string;
  environmentProfile: string;
  mode: "demo" | "server";
  startedAt: string;
  executionProfileSegment: "individual" | "business";
}

// ── Actions ──────────────────────────────────────────────────────────────────

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

// ── Chat ─────────────────────────────────────────────────────────────────────

export interface DashboardChatTurn {
  session: ChatSessionSummary;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

// ── Readiness ────────────────────────────────────────────────────────────────

export interface DashboardReadinessSnapshot {
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

// ── Session Config ───────────────────────────────────────────────────────────

export interface SessionConfigDiff {
  changedFields: string[];
  before: { providerId: string | null; model: string | null };
  after: { providerId: string | null; model: string | null };
}

export interface SessionConfigState {
  sessionId: string;
  current: { providerId: string | null; model: string | null };
  draft: SessionConfigDraft | null;
  diff: SessionConfigDiff | null;
  history: SessionConfigHistoryEntry[];
}

// ── Telemetry ────────────────────────────────────────────────────────────────

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

// ── Alerts ───────────────────────────────────────────────────────────────────

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

// ── Correlated Traces ────────────────────────────────────────────────────────

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

// ── Runtime Excellence ───────────────────────────────────────────────────────

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

// ── Session Packages ─────────────────────────────────────────────────────────

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
    trace: import("../session-trace-explorer.js").SessionTraceBundle;
    policyAudit: import("../policy-audit-exporter.js").PolicyAuditBundle;
  }>;
  aggregate: {
    totalEvents: number;
    totalPolicyRecords: number;
    chaptersExported: number;
  };
}

export interface SessionPackageStoreSnapshot {
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

// ── Provider Settings ────────────────────────────────────────────────────────

export interface ProviderSettingsPayload {
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

// ── SLO ──────────────────────────────────────────────────────────────────────

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

// ── Download Progress ────────────────────────────────────────────────────────

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

