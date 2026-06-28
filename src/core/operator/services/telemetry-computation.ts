/**
 * Telemetry computation functions — extracted from dashboard-service.ts (Phase 1).
 *
 * These are pure functions with zero dependency on DashboardService state.
 * They compute telemetry summaries, SLO metrics, alert prioritization,
 * correlated trace summaries, and runtime excellence snapshots.
 */

import type { ActivityEvent } from "../../activity/types.js";
import type { HistogramSnapshot } from "../../activity/metrics-store.js";
import { MetricsStore } from "../../activity/metrics-store.js";
import type {
  TelemetryWindow,
  TelemetryWindowMetrics,
  TelemetryWindowDelta,
  TelemetrySummary,
  AlertSeverity,
  PrioritizedAlert,
  CorrelatedTraceSummary,
  RuntimeExcellenceSnapshot,
  SloStatus,
  SloMetric,
  SloSummary,
} from "../types/dashboard-types.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const TELEMETRY_WINDOW_MS: Record<TelemetryWindow, number> = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

const SLO_TARGETS: ReadonlyArray<{ histName: string; label: string; targetP95Ms: number; targetP99Ms: number }> = [
  { histName: "prism_operation_duration_ms", label: "Operation Latency", targetP95Ms: 500, targetP99Ms: 1000 },
  { histName: "prism_policy_latency_ms", label: "Policy Check Latency", targetP95Ms: 250, targetP99Ms: 500 },
  { histName: "prism_llm_latency_ms", label: "LLM Latency", targetP95Ms: 5000, targetP99Ms: 10000 },
];

// ── Telemetry Window ─────────────────────────────────────────────────────────

export function parseTelemetryWindow(raw: string | null): TelemetryWindow {
  if (raw === "1h" || raw === "1d" || raw === "7d") return raw;
  return "1d";
}

export function computeWindowMetrics(
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

export function computeTelemetrySummary(
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

// ── SLO Computation ──────────────────────────────────────────────────────────

/**
 * Compute a percentile value from a histogram snapshot using linear interpolation.
 * Returns null if no observations are present.
 */
export function histogramPercentile(snap: HistogramSnapshot, p: number): number | null {
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

export function computeSloSummary(store: MetricsStore): SloSummary {
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
      return { name: histName, label, p50Ms: null, p95Ms: null, p99Ms: null, targetP95Ms, targetP99Ms, status: "no_data" as SloStatus };
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

// ── Alert Classification ─────────────────────────────────────────────────────

export function classifyAlertSeverity(message: string): AlertSeverity {
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

export function buildPrioritizedAlerts(
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

// ── Correlated Traces ────────────────────────────────────────────────────────

export function eventCorrelationId(event: ActivityEvent): string | null {
  const details = event.details as Record<string, unknown> | undefined;
  const correlationId = details?.correlationId;
  return typeof correlationId === "string" && correlationId.trim().length > 0
    ? correlationId
    : null;
}

export function buildCorrelatedTraceSummaries(
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

export function getCorrelatedTraceEvents(
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

// ── Runtime Excellence ───────────────────────────────────────────────────────

export function computeRuntimeExcellenceSnapshot(
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

// ── Utility ──────────────────────────────────────────────────────────────────

export function parseLimit(url: string, fallback: number): number {
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
