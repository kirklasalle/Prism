import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ActivityBus } from "../activity/bus.js";
import type { ActivityEvent } from "../activity/types.js";
import type { ApprovalQueue } from "../approval/approval-queue.js";
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
  ) {
    this.providerSecretStore = providerSecretStore ?? new WindowsProtectedFileProviderSecretStore();
    this.llmProviders = new LlmProviderManager(process.env, this.chatStore.listProviderSettings(), this.providerSecretStore);
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
      const generated = await this.llmProviders.generate({
        message: content,
        conversation: conversation
          .filter((entry) => entry.role === "user" || entry.role === "assistant" || entry.role === "system")
          .map((entry) => ({ role: entry.role, content: entry.content })),
        systemPrompt: [
          "You are PRISM's operator console assistant.",
          "Use concise actionable responses.",
          "Do not invent runtime state.",
          `Runtime mode: ${this.status.mode}. Environment: ${this.status.environmentProfile}.`,
          `Pending approvals: ${this.queue.list().length}.`,
          `Persisted chat sessions: ${this.chatStore.listSessions().length}.`,
        ].join("\n"),
      }, {
        providerId: session?.llmProviderId ?? undefined,
        model: session?.llmModel ?? undefined,
      });

      if (generated?.content?.trim()) {
        return {
          content: generated.content,
          metadata: {
            intent: "llm",
            provider: generated.providerId,
            model: generated.model,
          },
        };
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
      grid-template-columns: 280px minmax(0, 1fr);
      gap: 18px;
      padding: 18px;
      min-height: 100vh;
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
    }
    .workspace {
      min-width: 0;
      display: flex;
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
      cursor: wait;
    }
    .chat {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-height: calc(100vh - 36px);
      overflow: hidden;
    }
    .chat-header {
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
      padding: 22px 24px;
      overflow: auto;
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
      padding: 18px 24px 24px;
      border-top: 1px solid var(--border);
      background: linear-gradient(180deg, transparent, rgba(255,255,255,0.03));
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
    @media (max-width: 1280px) {
      .app { grid-template-columns: 260px minmax(0, 1fr); }
      .tab-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 900px) {
      .app { grid-template-columns: 1fr; }
      .chat { min-height: auto; }
      .sidebar { order: 2; }
      .tabs { gap: 8px; }
      .tab-button { flex-basis: calc(50% - 4px); }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar panel">
      <div class="brand">
        <div class="eyebrow">Frontier Operator Console</div>
        <h1>PRISM Chat</h1>
        <div class="muted">http://localhost:${port}</div>
      </div>
      <button class="primary-button" onclick="createSession()">New Session</button>
      <div id="session-list" class="session-list"></div>
    </aside>

    <main class="workspace">
      <section class="tabs panel" id="tabs" role="tablist" aria-label="Dashboard sections">
        <button id="tab-button-chat" type="button" class="tab-button active" data-tab-id="chat" role="tab" aria-selected="true" aria-controls="tab-chat" tabindex="0" onclick="setActiveTab(this.dataset.tabId)">Chat Interface</button>
        <button id="tab-button-settings" type="button" class="tab-button" data-tab-id="settings" role="tab" aria-selected="false" aria-controls="tab-settings" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Provider &amp; Settings</button>
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
        <div class="tab-grid">
          <section class="rail-section panel">
            <h3>LLM Provider</h3>
            <div id="llm-provider" class="stack"></div>
          </section>
          <section class="rail-section panel">
            <h3>LLM Audit Trail</h3>
            <div id="llm-audit"></div>
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
      notice: null
    };

    const tabs = [
      { id: 'chat', label: 'Chat Interface' },
      { id: 'settings', label: 'Provider & Settings' },
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

    async function loadSessions() {
      const payload = await request('/api/chat/sessions');
      state.sessions = payload;
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
      const [status, readiness, llmCatalog, llmConfig, llmAuditEvents, pending, actions, actionHistory, traceData, events, retrievalData, prioritizedAlertsData, telemetrySummaryData, runtimeExcellenceData, releaseValidationData, releaseDecisionData, selfReviewLatest, selfReviewHistory] = await Promise.all([
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
        request('/api/self-review/history?limit=5').catch(() => ({ reports: [] }))
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

      container.innerHTML = state.sessions.map(session => {
        const preview = session.lastMessagePreview || 'Start a new conversation.';
        const activeClass = state.selectedSessionId === session.sessionId ? ' active' : '';
        return '<div class="session-card' + activeClass + '" data-session-id="' + escapeHtml(session.sessionId) + '" onclick="selectSession(this.dataset.sessionId)">'
          + '<div class="session-title">' + escapeHtml(session.title) + '</div>'
          + '<div class="session-preview">' + escapeHtml(preview) + '</div>'
          + '<div class="session-meta"><span>' + escapeHtml(String(session.messageCount)) + ' msgs</span><span>' + escapeHtml(formatRelativeTime(session.updatedAt)) + '</span></div>'
          + '<div class="action-buttons"><button class="danger-button" data-session-id="' + escapeHtml(session.sessionId) + '" onclick="deleteSession(event, this.dataset.sessionId)">Delete</button></div>'
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
        chips.push('<span class="chip">Provider: ' + escapeHtml(state.llmCatalog.activeProviderId) + '</span>');
        chips.push('<span class="chip">Model: ' + escapeHtml(state.llmCatalog.activeModel || '-') + '</span>');
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
        return '<div class="message ' + escapeHtml(message.role) + '">'
          + '<div class="message-label">' + escapeHtml(roleLabel) + '</div>'
          + '<div>' + escapeHtml(message.content) + '</div>'
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
      const draftModels = draftProvider ? (draftProvider.models || []) : [];
      const draftModel = draft && draft.model ? draft.model : (state.llmConfig && state.llmConfig.current ? state.llmConfig.current.model : activeModel);

      const providerOptions = providers.map(provider =>
        '<option value="' + escapeHtml(provider.id) + '" ' + (provider.id === draftProviderId ? 'selected' : '') + '>'
        + escapeHtml(provider.label + (provider.enabled ? '' : ' (unavailable)'))
        + '</option>'
      ).join('');

      const modelOptions = draftModels.length > 0
        ? draftModels.map(model =>
          '<option value="' + escapeHtml(model) + '" ' + (model === draftModel ? 'selected' : '') + '>' + escapeHtml(model) + '</option>'
        ).join('')
        : '<option value="">No models available</option>';

      const reason = draftProvider && !draftProvider.enabled && draftProvider.reason
        ? '<div class="muted" style="margin-top:8px;color:#ffc1c1;">' + escapeHtml(draftProvider.reason) + '</div>'
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

      container.innerHTML = ''
        + '<label class="muted" for="provider-select">Provider</label>'
        + '<select id="provider-select" class="control-select">' + providerOptions + '</select>'
        + '<label class="muted" for="model-select" style="margin-top:8px;display:block;">Model</label>'
        + '<select id="model-select" class="control-select">' + modelOptions + '</select>'
        + '<div class="action-buttons">'
        + '<button class="secondary-button" onclick="saveLlmDraft()">Save Draft</button>'
        + '<button class="secondary-button" ' + (!draft ? 'disabled' : '') + ' onclick="applyLlmDraft()">Apply Draft</button>'
        + '<button class="secondary-button" ' + (!draft ? 'disabled' : '') + ' onclick="discardLlmDraft()">Discard Draft</button>'
        + '<button class="secondary-button" ' + (!history.length ? 'disabled' : '') + ' onclick="rollbackLlmConfig()">Rollback</button>'
        + '</div>'
        + diffHtml
        + historyHtml
        + '<div class="muted" style="margin-top:8px;">Keys are sourced from environment variables and never shown in UI.</div>'
        + reason;
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
      if (!report) {
        container.innerHTML = '<div class="muted">No release validation artifact found yet.</div>'
          + '<div class="muted" style="margin-top:8px;">Run <span class="mono">npm run release:validate</span> to generate one.</div>';
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
      safeRenderStep('whatChanged', renderWhatChanged);
      safeRenderStep('llm', renderLlm);
      safeRenderStep('llmAudit', renderLlmAudit);
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
      render();
      try {
        await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
        composer.value = '';
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

    async function saveLlmDraft() {
      const providerSelect = document.getElementById('provider-select');
      const modelSelect = document.getElementById('model-select');
      const providerId = providerSelect ? providerSelect.value : '';
      const model = modelSelect ? modelSelect.value : '';
      if (!providerId) {
        return;
      }
      state.notice = null;
      try {
        state.llmConfig = await request('/api/llm/config/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.selectedSessionId, providerId, model })
        });
        await refreshChrome();
        state.notice = 'Draft saved. Apply Draft to activate this configuration.';
      } catch (error) {
        state.notice = String(error);
      }
      render();
    }

    async function applyLlmDraft() {
      if (!state.selectedSessionId) {
        return;
      }
      state.notice = null;
      try {
        const payload = await request('/api/llm/config/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.selectedSessionId })
        });
        state.llmCatalog = payload.catalog;
        state.llmConfig = payload.config;
        const readiness = await request('/api/readiness/recheck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.selectedSessionId, source: 'llm_apply_draft' })
        }).catch(() => null);
        await refreshChrome();
        if (readiness) {
          state.readiness = readiness;
        }
        state.notice = state.readiness && state.readiness.ready
          ? 'Draft applied. Chat is now ready.'
          : 'Draft applied. Complete remaining readiness checks before chatting.';
      } catch (error) {
        state.notice = String(error);
      }
      render();
    }

    async function discardLlmDraft() {
      if (!state.selectedSessionId) {
        return;
      }
      state.notice = null;
      try {
        state.llmConfig = await request('/api/llm/config/draft?sessionId=' + encodeURIComponent(state.selectedSessionId), {
          method: 'DELETE'
        });
        await refreshChrome();
        state.notice = 'Draft discarded.';
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
    setInterval(async function() {
      try {
        await Promise.all([loadSessions(), refreshChrome(), loadMessages()]);
        render();
      } catch (error) {
        state.notice = String(error);
        render();
      }
    }, 2500);
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