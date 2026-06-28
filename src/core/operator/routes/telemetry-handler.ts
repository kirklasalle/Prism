import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import {
  parseTelemetryWindow,
  computeTelemetrySummary,
  computeSloSummary,
  buildPrioritizedAlerts,
  computeRuntimeExcellenceSnapshot,
  SEVERITY_ORDER,
  buildCorrelatedTraceSummaries,
  getCorrelatedTraceEvents
} from "../services/telemetry-computation.js";
import type { PrioritizedAlertResponse, CorrelatedTraceResponse } from "../types/dashboard-types.js";
import { parseEventFilters } from "../utils/http-helpers.js";
import { randomUUID } from "node:crypto";
import { withRetrievalAlertPolicy, tuneFromIncidentTrends } from "../../memory/retrieval-alert-policy.js";

export class TelemetryHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = (req.url ?? "").split("?")[0];
    const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
    return normalized === "/metrics" ||
      normalized.startsWith("/api/retrieval/") ||
      normalized.startsWith("/api/telemetry/") ||
      normalized.startsWith("/api/compliance/") ||
      normalized.startsWith("/api/activity/retention") ||
      normalized.startsWith("/api/runtime/excellence") ||
      normalized.startsWith("/api/usage/") ||
      normalized.startsWith("/api/incidents") ||
      normalized.startsWith("/api/events") ||
      normalized.startsWith("/api/traces") ||
      normalized.startsWith("/api/logs") ||
      normalized.startsWith("/api/debug/console");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    // ── Observability: Prometheus /metrics endpoint ──────────────────────
    if (method === "GET" && url === "/metrics") {
      try {
        const sessionCount = service.getChatStore().listSessions().length;
        const pendingApprovals = service.getApprovalQueue().list().length;
        const metricsStore = service.getMetricsStore();
        metricsStore.set("prism_active_sessions", sessionCount);
        metricsStore.set("prism_approval_queue_depth", pendingApprovals);
        metricsStore.set("prism_uptime_seconds", Math.floor(process.uptime()));

        const body = metricsStore.render();
        res.writeHead(200, {
          "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });
        res.end(body);
        return;
      } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(String(error));
        return;
      }
    }

    // ── Retrieval Cohorts ──────────────────────────────────────────────
    if (method === "GET" && url === "/api/retrieval/cohorts") {
      const collector = service.getMetricsCollector();
      if (!collector) {
        return this.json(res, 501, { error: "Retrieval observability not initialized." });
      }
      try {
        const cohorts = collector.getCohortDashboard(50, 3, 1);
        return this.json(res, 200, cohorts);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── Retrieval Alerts ───────────────────────────────────────────────
    if (method === "GET" && url === "/api/retrieval/alerts") {
      const collector = service.getMetricsCollector();
      const dashStore = service.getRetrievalDashboardStore();
      if (!collector || !dashStore) {
        return this.json(res, 501, { error: "Retrieval observability not initialized." });
      }
      try {
        const diagnostics = collector.getGrowthAndDriftDiagnostics(5, 0.12);
        const cohortDashboard = collector.getCohortDashboard(50, 3, 1);
        const allAlerts = [
          ...diagnostics.alerts,
          ...cohortDashboard.alerts,
        ];
        return this.json(res, 200, { alerts: allAlerts });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── Retrieval Trends ───────────────────────────────────────────────
    if (method === "GET" && url === "/api/retrieval/trends") {
      const dashStore = service.getRetrievalDashboardStore();
      if (!dashStore) {
        return this.json(res, 501, { error: "Retrieval observability not initialized." });
      }
      try {
        const sessionId = service.getRuntimeStatus().sessionId;
        const trend = dashStore.getTrendReport(sessionId, 10, 3);
        return this.json(res, 200, trend ?? { snapshotsCompared: 0, topChanges: [], alerts: [] });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── Telemetry Summary ──────────────────────────────────────────────
    if (method === "GET" && url.startsWith("/api/telemetry/summary")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const windowLabel = parseTelemetryWindow(parsed.searchParams.get("window"));
        const events = service.getActivityBus().listEvents();
        const summary = computeTelemetrySummary(events, windowLabel);
        return this.json(res, 200, summary);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── SLO Gauge ──────────────────────────────────────────────────────
    if (method === "GET" && url === "/api/telemetry/slo-summary") {
      return this.json(res, 200, computeSloSummary(service.getMetricsStore()));
    }

    // ── Compliance SOC2 Status ─────────────────────────────────────────
    if (method === "GET" && url === "/api/compliance/soc2/status") {
      return this.json(res, 200, service.getSoc2Exporter().getStatus());
    }

    // ── Activity Retention Status ──────────────────────────────────────
    if (method === "GET" && url === "/api/activity/retention/status") {
      const policy = service.getActivityRetentionPolicy();
      if (!policy) {
        return this.json(res, 200, { enabled: false });
      }
      return this.json(res, 200, policy.getStatus());
    }

    // ── Usage Summary ──────────────────────────────────────────────────
    if (method === "GET" && url.startsWith("/api/usage/summary")) {
      const metering = service.getUsageMetering();
      if (!metering) return this.json(res, 200, { byModel: [], totalCostUsd: 0, totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, caps: { sessionCap: null, dailyCap: null, monthlyCap: null }, sessionCostUsd: 0, dailyCostUsd: 0, monthlyCostUsd: 0, window: "1d" });
      try {
        const parsed = new URL(`http://localhost${url}`);
        const win = parsed.searchParams.get("window") ?? "1d";
        return this.json(res, 200, metering.getSummary(win as any));
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/usage/caps") {
      const metering = service.getUsageMetering();
      if (!metering) return this.json(res, 200, { sessionCap: null, dailyCap: null, monthlyCap: null });
      return this.json(res, 200, metering.getCaps());
    }

    if (method === "POST" && url === "/api/usage/caps") {
      const metering = service.getUsageMetering();
      if (!metering) return this.json(res, 501, { error: "Usage metering not initialized." });
      try {
        const body = await service.readJsonBody<{ sessionCap?: number | null; dailyCap?: number | null; monthlyCap?: number | null }>(req);
        const toNum = (v: unknown): number | null => {
          if (v === null || v === undefined || v === "") return null;
          const n = parseFloat(String(v));
          return isFinite(n) && n > 0 ? n : null;
        };
        metering.setCaps({
          sessionCap: toNum(body.sessionCap),
          dailyCap: toNum(body.dailyCap),
          monthlyCap: toNum(body.monthlyCap),
        });
        return this.json(res, 200, { saved: true, caps: metering.getCaps() });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── Runtime Excellence Snapshot ─────────────────────────────────────
    if (method === "GET" && url.startsWith("/api/runtime/excellence")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const windowLabel = parseTelemetryWindow(parsed.searchParams.get("window"));
        const events = service.getActivityBus().listEvents();

        let retrievalAlertCount = 0;
        const collector = service.getMetricsCollector();
        if (collector) {
          const diagnostics = collector.getGrowthAndDriftDiagnostics(5, 0.12);
          const cohortDashboard = collector.getCohortDashboard(50, 3, 1);
          retrievalAlertCount = diagnostics.alerts.length + cohortDashboard.alerts.length;
        }

        const snapshot = computeRuntimeExcellenceSnapshot(events, windowLabel, retrievalAlertCount);
        return this.json(res, 200, snapshot);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── Prioritized Alerts ─────────────────────────────────────────────
    if (method === "GET" && url.startsWith("/api/retrieval/prioritized-alerts")) {
      const collector = service.getMetricsCollector();
      if (!collector) {
        return this.json(res, 501, { error: "Retrieval observability not initialized." });
      }
      try {
        const now = new Date().toISOString();
        const diagnostics = collector.getGrowthAndDriftDiagnostics(5, 0.12);
        const cohortDashboard = collector.getCohortDashboard(50, 3, 1);
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

    // ── Retrieval Incident Trends ──────────────────────────────────────
    if (method === "GET" && url.startsWith("/api/retrieval/incident-trends")) {
      const profile = /[?&]profile=(individual|business|unknown)/.exec(rawUrl)?.[1] ?? "unknown";
      const windowMatch = /[?&]windowDays=(\d+)/.exec(rawUrl)?.[1];
      const windowDays = windowMatch ? Math.max(1, Math.min(60, parseInt(windowMatch, 10))) : 7;
      const report = service.getIncidentTrendStore().getReport(profile as "individual" | "business" | "unknown", windowDays);
      const base = withRetrievalAlertPolicy({});
      const tuned = tuneFromIncidentTrends(base, {
        profile: report.profile,
        windowDays: report.windowDays,
        dailyAverage: report.dailyAverage,
      });
      return this.json(res, 200, { report, tuning: tuned });
    }

    // ── Unified Telemetry API ─────────────────────────────────────────────
    if (method === "GET" && url.startsWith("/api/telemetry/unified")) {
      const telemetryAggregator = service.getTelemetryAggregator();
      if (!telemetryAggregator) return this.json(res, 200, { entries: [], stats: null });
      try {
        const parsed = new URL(`http://localhost${url}`);
        const filter: Record<string, unknown> = {};
        for (const [k, v] of parsed.searchParams) filter[k] = v;
        if (filter.limit) filter.limit = Number(filter.limit);
        const entries = telemetryAggregator.query(filter as any);
        const stats = telemetryAggregator.getStats();
        return this.json(res, 200, { entries, stats });
      } catch { return this.json(res, 200, { entries: telemetryAggregator.getTail(100), stats: telemetryAggregator.getStats() }); }
    }

    if (method === "GET" && url === "/api/telemetry/stats") {
      const telemetryAggregator = service.getTelemetryAggregator();
      if (!telemetryAggregator) return this.json(res, 200, { stats: null });
      return this.json(res, 200, { stats: telemetryAggregator.getStats() });
    }

    // ── Auth trace beacon from login page → Logs & Debug tab ────────────
    if (method === "POST" && url === "/api/telemetry/auth-trace") {
      try {
        let bodyText = "";
        for await (const chunk of req) bodyText += chunk;
        const payload = JSON.parse(bodyText);
        const telemetryAggregator = service.getTelemetryAggregator();
        if (telemetryAggregator && payload.operation) {
          telemetryAggregator.ingestRaw({
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

    // ── Incident Triage Bundle ────────────────────────────────────────────
    if (method === "POST" && url === "/api/incidents/bundle") {
      const sessions = service.getChatStore().listSessions().map((s: any) => ({
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
        approvalQueueDepth: service.getApprovalQueue().list().length,
        sloSummary: computeSloSummary(service.getMetricsStore()),
      };
      const allEvents = service.getActivityBus().listEvents();
      const last500 = allEvents.slice(-500);
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

    // ── Events Log API ───────────────────────────────────────────────────
    if (method === "GET" && url.startsWith("/api/events")) {
      const filters = parseEventFilters(url, 50);
      let events = service.getActivityBus().listEvents();
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

    // ── Traces API ────────────────────────────────────────────────────────
    if (method === "GET" && url.startsWith("/api/traces")) {
      const filters = parseEventFilters(url, 20);
      const events = service.getActivityBus().listEvents();
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

    if (method === "GET" && url.startsWith("/api/logs")) {
      const filters = parseEventFilters(url, 500);
      const limit = Math.max(1, Math.min(2000, filters.limit));
      const events = service.getActivityBus().listEvents();
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

    if (method === "GET" && url.startsWith("/api/debug/console")) {
      if (!service.consoleInterceptor) {
        return this.json(res, 200, { lines: [], attached: false });
      }
      let limit = 500;
      try {
        const parsed = new URL(`http://localhost${url}`);
        const raw = Number(parsed.searchParams.get("limit") ?? 500);
        if (Number.isFinite(raw)) limit = Math.max(1, Math.min(5000, raw));
      } catch { /* keep default */ }
      return this.json(res, 200, {
        lines: service.consoleInterceptor.getTail(limit),
        attached: true,
      });
    }

    this.json(res, 404, { error: "Not found" });
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data, null, 2));
  }
}
