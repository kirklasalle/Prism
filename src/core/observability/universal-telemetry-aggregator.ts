/**
 * PRISM Universal Telemetry Aggregator — Phase A3 (Observability)
 *
 * Central aggregation service that collects ALL system events from every
 * source (tabs, agents, browser, computer, chat, scheduler, etc.) and
 * normalizes them into a unified, AI-readable format.
 *
 * This is the single source of truth piped to the Logs & Debug tab.
 * Both human operators and AI agents (Guardian, configured LLM) consume
 * this data for monitoring, anomaly detection, and autonomous reasoning.
 *
 * Event sources subscribed:
 *   - ActivityBus (all layers: tool_execution, governance, agent, etc.)
 *   - ConsoleInterceptor (stdout/stderr with severity parsing)
 *   - Browser session events (navigation, network, console)
 *   - Computer use events (commands, screenshots, input)
 *   - Chat session events (messages, tool calls, agentic turns)
 *   - Tab session lifecycle events
 *   - Guardian alerts and interventions
 *   - Scheduler job events
 *
 * Design constraints:
 *   - Ring buffer with configurable capacity (default 10,000 entries).
 *   - Structured format for both human and AI readability.
 *   - Severity classification from content analysis.
 *   - Source attribution to originating tab/module.
 *   - WebSocket fan-out for real-time dashboard updates.
 *   - Query API with filtering by source, severity, time, correlation.
 */

import { randomUUID } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";
import type { ActivityEvent, ActivitySubscriber } from "../activity/types.js";
import type { ConsoleLine, ConsoleLineListener } from "../logging/console-interceptor.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type TelemetrySeverity = "trace" | "debug" | "info" | "warn" | "error" | "critical";
export type TelemetryCategory = "action" | "event" | "error" | "metric" | "state_change" | "console" | "lifecycle";
export type TelemetryOutcome = "success" | "failure" | "pending" | "skipped" | null;

export interface UnifiedTelemetryEntry {
  /** Unique entry ID. */
  id: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Originating source module/tab. */
  source: string;
  /** Event category. */
  category: TelemetryCategory;
  /** Severity level. */
  severity: TelemetrySeverity;
  /** Machine-readable operation name. */
  operation: string;
  /** Human-readable one-line summary. */
  summary: string;
  /** Full structured details. */
  details: Record<string, unknown>;
  /** Operator who triggered this (if known). */
  operatorId: string | null;
  /** Correlation ID linking related events. */
  correlationId: string | null;
  /** Tab session ID (if associated with a tab). */
  tabSessionId: string | null;
  /** Autonomous goal ID (if part of autonomous execution). */
  goalId: string | null;
  /** Duration in milliseconds (if applicable). */
  durationMs: number | null;
  /** Outcome of this event. */
  outcome: TelemetryOutcome;
  /** AI-readable metadata for Guardian and LLM consumption. */
  aiContext: {
    /** Can an agent act on this event? */
    isActionable: boolean;
    /** Suggested action (if actionable). */
    suggestedAction: string | null;
    /** IDs of related entries. */
    relatedEntries: string[];
    /** Searchable tags. */
    tags: string[];
  };
}

export interface TelemetryFilter {
  source?: string;
  severity?: TelemetrySeverity;
  category?: TelemetryCategory;
  correlationId?: string;
  tabSessionId?: string;
  goalId?: string;
  operatorId?: string;
  sinceTimestamp?: string;
  limit?: number;
  search?: string;
}

export interface TelemetrySummaryStats {
  generatedAt: string;
  totalEntries: number;
  bySource: Record<string, number>;
  bySeverity: Record<TelemetrySeverity, number>;
  byCategory: Record<string, number>;
  errorRate: number;
  entriesPerMinute: number;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
}

export type TelemetryListener = (entry: UnifiedTelemetryEntry) => void;

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CAPACITY = 10_000;

/** Map of ActivityEvent operation prefixes to human-readable source names. */
const OPERATION_SOURCE_MAP: ReadonlyArray<[string, string]> = [
  ["browser.", "browser"],
  ["bua.", "browser"],
  ["cua.", "computer"],
  ["computer.", "computer"],
  ["chat.", "chat"],
  ["agentic.", "agentic"],
  ["agent.", "agentic"],
  ["swarm.", "agentic"],
  ["tab.", "system"],
  ["iam.", "security"],
  ["prism.", "system"],
  ["scheduler.", "scheduler"],
  ["tool.", "tools"],
  ["workspace.", "workspace"],
  ["policy.", "governance"],
  ["guardian.", "guardian"],
  ["retrieval.", "telemetry"],
  ["system.", "system"],
];

// ── Severity Classification ──────────────────────────────────────────────────

const SEVERITY_PATTERNS: ReadonlyArray<[RegExp, TelemetrySeverity]> = [
  [/\b(FATAL|CRITICAL|PANIC)\b/i, "critical"],
  [/\b(ERROR|ERR|EXCEPTION|CRASH)\b/i, "error"],
  [/\b(WARN|WARNING|DEPRECATED)\b/i, "warn"],
  [/\b(DEBUG|TRACE|VERBOSE)\b/i, "debug"],
];

function classifySeverityFromText(text: string): TelemetrySeverity {
  for (const [pattern, severity] of SEVERITY_PATTERNS) {
    if (pattern.test(text)) return severity;
  }
  return "info";
}

function classifySeverityFromStatus(status: string, operation: string): TelemetrySeverity {
  if (status === "failed") {
    if (operation.includes("critical") || operation.includes("guardian")) return "critical";
    return "error";
  }
  if (operation.includes("warn") || operation.includes("alert")) return "warn";
  return "info";
}

function deriveSource(operation: string, details: Record<string, unknown>): string {
  // Check explicit source in details first
  const detailSource = details?.source;
  if (typeof detailSource === "string" && detailSource.length > 0) {
    return detailSource.replace(/-/g, "_").split("_")[0] ?? "system";
  }

  // Match operation prefix
  for (const [prefix, source] of OPERATION_SOURCE_MAP) {
    if (operation.startsWith(prefix)) return source;
  }

  return "system";
}

function generateSummary(operation: string, status: string, details: Record<string, unknown>): string {
  // Build a human-readable summary from the operation and key details
  const parts: string[] = [];

  // Clean up operation name for readability
  const readableOp = operation
    .replace(/\./g, " → ")
    .replace(/_/g, " ");
  parts.push(readableOp);

  if (status === "failed") {
    const error = details?.error ?? details?.message;
    if (typeof error === "string") {
      parts.push(`— ${error.slice(0, 120)}`);
    } else {
      parts.push("— failed");
    }
  } else if (status === "succeeded") {
    // Add key detail if available
    const msg = details?.message ?? details?.url ?? details?.path ?? details?.agentId;
    if (typeof msg === "string" && msg.length > 0 && msg.length <= 100) {
      parts.push(`— ${msg}`);
    }
  }

  return parts.join(" ");
}

function isActionableEvent(severity: TelemetrySeverity, category: TelemetryCategory): boolean {
  if (severity === "critical" || severity === "error") return true;
  if (category === "error") return true;
  return false;
}

function suggestAction(severity: TelemetrySeverity, operation: string): string | null {
  if (severity === "critical") return "Immediate investigation required. Check Guardian alerts.";
  if (severity === "error" && operation.includes("browser")) return "Check browser session health and Playwright availability.";
  if (severity === "error" && operation.includes("computer")) return "Verify command execution permissions and system access.";
  if (severity === "error" && operation.includes("agent")) return "Review agent lifecycle and restart if necessary.";
  if (severity === "error") return "Review error details in correlated trace.";
  return null;
}

function deriveTags(operation: string, source: string, severity: TelemetrySeverity): string[] {
  const tags: string[] = [source];
  if (severity === "error" || severity === "critical") tags.push("error");
  if (operation.includes("autonomous")) tags.push("autonomous");
  if (operation.includes("guardian")) tags.push("guardian");
  if (operation.includes("session")) tags.push("session");
  if (operation.includes("browser")) tags.push("browser-use");
  if (operation.includes("computer") || operation.includes("cua")) tags.push("computer-use");
  if (operation.includes("approval")) tags.push("approval");
  if (operation.includes("policy")) tags.push("policy");
  return tags;
}

// ── Aggregator ───────────────────────────────────────────────────────────────

export class UniversalTelemetryAggregator implements ActivitySubscriber {
  private readonly buffer: UnifiedTelemetryEntry[] = [];
  private readonly capacity: number;
  private readonly listeners = new Set<TelemetryListener>();

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = Math.max(100, capacity);
  }

  // ── ActivitySubscriber interface ─────────────────────────────────────────

  onEvent(event: ActivityEvent): void {
    this.ingestActivityEvent(event);
  }

  // ── Ingestion Methods ────────────────────────────────────────────────────

  /** Ingest an ActivityBus event and normalize to unified format. */
  ingestActivityEvent(event: ActivityEvent): UnifiedTelemetryEntry {
    const details = (event.details ?? {}) as Record<string, unknown>;
    const source = deriveSource(event.operation, details);
    const severity = classifySeverityFromStatus(event.status, event.operation);
    const category: TelemetryCategory = event.status === "failed" ? "error" : "event";
    const tags = deriveTags(event.operation, source, severity);
    const actionable = isActionableEvent(severity, category);

    const entry: UnifiedTelemetryEntry = {
      id: event.id ?? randomUUID(),
      timestamp: event.timestamp,
      source,
      category,
      severity,
      operation: event.operation,
      summary: generateSummary(event.operation, event.status, details),
      details: {
        ...details,
        activityLayer: event.layer,
        activityStatus: event.status,
        authorityTier: event.authorityTier,
        policyDecision: event.policyDecision,
      },
      operatorId: event.operatorId ?? null,
      correlationId: (details.correlationId as string) ?? null,
      tabSessionId: (details.tabSessionId as string) ?? null,
      goalId: (details.goalId as string) ?? null,
      durationMs: event.durationMs ?? null,
      outcome: event.status === "succeeded" ? "success"
        : event.status === "failed" ? "failure"
        : event.status === "started" ? "pending"
        : null,
      aiContext: {
        isActionable: actionable,
        suggestedAction: actionable ? suggestAction(severity, event.operation) : null,
        relatedEntries: [],
        tags,
      },
    };

    this.pushEntry(entry);
    return entry;
  }

  /** Ingest a console line and normalize to unified format. */
  ingestConsoleLine(line: ConsoleLine): UnifiedTelemetryEntry {
    const severity = line.stream === "stderr"
      ? classifySeverityFromText(line.line)
      : classifySeverityFromText(line.line);

    // Parse module prefix from common log patterns: [PRISM][module], [MCP], etc.
    let source = "console";
    let operation = "console.output";
    const moduleMatch = /^\[([A-Z][A-Za-z0-9_-]+)\](?:\[([A-Za-z0-9_-]+)\])?/.exec(line.line);
    if (moduleMatch) {
      source = (moduleMatch[2] ?? moduleMatch[1]).toLowerCase();
      operation = `console.${source}`;
    }

    // Elevate stderr to at least "warn" if not already higher
    const effectiveSeverity = line.stream === "stderr" && severity === "info" ? "warn" : severity;

    const entry: UnifiedTelemetryEntry = {
      id: randomUUID(),
      timestamp: line.ts,
      source,
      category: "console",
      severity: effectiveSeverity,
      operation,
      summary: line.line.slice(0, 200),
      details: {
        stream: line.stream,
        fullLine: line.line,
      },
      operatorId: null,
      correlationId: null,
      tabSessionId: null,
      goalId: null,
      durationMs: null,
      outcome: null,
      aiContext: {
        isActionable: effectiveSeverity === "error" || effectiveSeverity === "critical",
        suggestedAction: effectiveSeverity === "critical" ? "Review critical console error immediately." : null,
        relatedEntries: [],
        tags: ["console", line.stream],
      },
    };

    this.pushEntry(entry);
    return entry;
  }

  /** Ingest a raw telemetry entry from any source. */
  ingestRaw(partial: Partial<UnifiedTelemetryEntry> & {
    operation: string;
    source: string;
    summary: string;
  }): UnifiedTelemetryEntry {
    const entry: UnifiedTelemetryEntry = {
      id: partial.id ?? randomUUID(),
      timestamp: partial.timestamp ?? new Date().toISOString(),
      source: partial.source,
      category: partial.category ?? "event",
      severity: partial.severity ?? "info",
      operation: partial.operation,
      summary: partial.summary,
      details: partial.details ?? {},
      operatorId: partial.operatorId ?? null,
      correlationId: partial.correlationId ?? null,
      tabSessionId: partial.tabSessionId ?? null,
      goalId: partial.goalId ?? null,
      durationMs: partial.durationMs ?? null,
      outcome: partial.outcome ?? null,
      aiContext: partial.aiContext ?? {
        isActionable: false,
        suggestedAction: null,
        relatedEntries: [],
        tags: [partial.source],
      },
    };

    this.pushEntry(entry);
    return entry;
  }

  // ── Query Methods ────────────────────────────────────────────────────────

  /** Query entries with filtering. Returns newest first. */
  query(filter?: TelemetryFilter): UnifiedTelemetryEntry[] {
    let results = [...this.buffer];

    if (filter?.source) {
      results = results.filter(e => e.source === filter.source);
    }
    if (filter?.severity) {
      results = results.filter(e => e.severity === filter.severity);
    }
    if (filter?.category) {
      results = results.filter(e => e.category === filter.category);
    }
    if (filter?.correlationId) {
      results = results.filter(e => e.correlationId === filter.correlationId);
    }
    if (filter?.tabSessionId) {
      results = results.filter(e => e.tabSessionId === filter.tabSessionId);
    }
    if (filter?.goalId) {
      results = results.filter(e => e.goalId === filter.goalId);
    }
    if (filter?.operatorId) {
      results = results.filter(e => e.operatorId === filter.operatorId);
    }
    if (filter?.sinceTimestamp) {
      const since = Date.parse(filter.sinceTimestamp);
      if (Number.isFinite(since)) {
        results = results.filter(e => Date.parse(e.timestamp) >= since);
      }
    }
    if (filter?.search) {
      const searchLower = filter.search.toLowerCase();
      results = results.filter(e =>
        e.summary.toLowerCase().includes(searchLower) ||
        e.operation.toLowerCase().includes(searchLower) ||
        e.source.toLowerCase().includes(searchLower) ||
        JSON.stringify(e.details).toLowerCase().includes(searchLower),
      );
    }

    // Newest first
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const limit = filter?.limit ?? 100;
    return results.slice(0, Math.max(1, limit));
  }

  /** Get the tail of the buffer (oldest first). */
  getTail(limit = 500): UnifiedTelemetryEntry[] {
    const n = Math.max(1, Math.min(this.capacity, limit));
    return this.buffer.slice(Math.max(0, this.buffer.length - n));
  }

  /** Get summary statistics of the telemetry buffer. */
  getStats(): TelemetrySummaryStats {
    const now = new Date();
    const bySource: Record<string, number> = {};
    const bySeverity: Record<TelemetrySeverity, number> = {
      trace: 0, debug: 0, info: 0, warn: 0, error: 0, critical: 0,
    };
    const byCategory: Record<string, number> = {};
    let errors = 0;

    for (const entry of this.buffer) {
      bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
      bySeverity[entry.severity]++;
      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
      if (entry.severity === "error" || entry.severity === "critical") errors++;
    }

    // Calculate entries per minute over the last 5 minutes
    const fiveMinAgo = now.getTime() - 5 * 60 * 1000;
    const recentCount = this.buffer.filter(e => Date.parse(e.timestamp) >= fiveMinAgo).length;
    const entriesPerMinute = recentCount / 5;

    return {
      generatedAt: now.toISOString(),
      totalEntries: this.buffer.length,
      bySource,
      bySeverity,
      byCategory,
      errorRate: this.buffer.length > 0 ? errors / this.buffer.length : 0,
      entriesPerMinute,
      oldestTimestamp: this.buffer.length > 0 ? this.buffer[0].timestamp : null,
      newestTimestamp: this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].timestamp : null,
    };
  }

  /** Get count of entries in buffer. */
  get size(): number {
    return this.buffer.length;
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  /** Subscribe to real-time entries. Returns an unsubscribe function. */
  subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Clear the buffer. */
  clear(): void {
    this.buffer.length = 0;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private pushEntry(entry: UnifiedTelemetryEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }

    // Fan out to listeners
    for (const listener of this.listeners) {
      try { listener(entry); } catch { /* swallow listener errors */ }
    }
  }
}
