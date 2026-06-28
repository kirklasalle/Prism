import { workspacePath } from "../../config/workspace-resolver.js";
import { RiskOverrideStore } from "../risk-override-store.js";
import { IncidentTrendStore } from "../../memory/incident-trend-store.js";
import { UtilityRegistry, registerBuiltInUtilities } from "../utility-registry.js";
import { SchedulerEngine } from "../scheduler-engine.js";
import type { ActivityBus } from "../../activity/bus.js";
import type { PolicyAuditExporter } from "../policy-audit-exporter.js";
import type { SessionTraceExplorer } from "../session-trace-explorer.js";
import type { RetrievalDashboardStore } from "../../memory/retrieval-dashboard-store.js";
import type { DashboardAction, DashboardActionState } from "../dashboard-service.js";

export interface UtilitiesConfig {
  riskOverrideStore: RiskOverrideStore;
  incidentTrendStore: IncidentTrendStore;
  utilityRegistry: UtilityRegistry;
  schedulerEngine: SchedulerEngine;
  actionsByName: Map<string, DashboardAction>;
  actionStates: Map<string, DashboardActionState>;
}

export interface UtilitiesBootstrapOptions {
  activityBus: ActivityBus;
  sessionId: string;
  policyAuditExporter?: PolicyAuditExporter;
  traceExplorer?: SessionTraceExplorer;
  retrievalDashboardStore?: RetrievalDashboardStore;
  actions?: DashboardAction[];
  broadcastEvent: (evt: any) => void;
}

export function bootstrapUtilities(options: UtilitiesBootstrapOptions): UtilitiesConfig {
  const {
    activityBus,
    sessionId,
    policyAuditExporter,
    traceExplorer,
    retrievalDashboardStore,
    actions = [],
    broadcastEvent,
  } = options;

  const riskOverrideStore = new RiskOverrideStore(
    workspacePath("state", "risk-overrides.json"),
    activityBus,
  );
  const incidentTrendStore = new IncidentTrendStore(activityBus);
  const utilityRegistry = new UtilityRegistry(activityBus);

  registerBuiltInUtilities(utilityRegistry, {
    runContractDiffGate: async () => {
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
      if (!policyAuditExporter) {
        return { summary: "Policy audit exporter not available.", details: { available: false } };
      }
      const bundle = policyAuditExporter.exportBundle({ sessionId });
      return { summary: `Exported policy audit bundle (${bundle.recordCount} decisions).`, details: { bundle } };
    },
    exportSessionTrace: async () => {
      if (!traceExplorer) {
        return { summary: "Session trace explorer not available.", details: { available: false } };
      }
      const bundle = traceExplorer.exportBundle({ sessionId });
      return { summary: `Exported session trace bundle (${bundle.eventCount} events).`, details: { bundle } };
    },
    runRetrievalTrends: async () => {
      if (!retrievalDashboardStore) {
        return { summary: "Retrieval dashboard store not configured.", details: { available: false } };
      }
      const report = retrievalDashboardStore.getTrendReport(sessionId);
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

  const schedulerEngine = new SchedulerEngine({
    activityBus,
    sessionId,
    onAction: (entry) => {
      broadcastEvent({
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

  const actionsByName = new Map<string, DashboardAction>();
  const actionStates = new Map<string, DashboardActionState>();

  for (const action of actions) {
    actionsByName.set(action.name, action);
    actionStates.set(action.name, {
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

  return {
    riskOverrideStore,
    incidentTrendStore,
    utilityRegistry,
    schedulerEngine,
    actionsByName,
    actionStates,
  };
}
