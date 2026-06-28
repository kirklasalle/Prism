/**
 * Diagnostics route handler — extracted from dashboard-service.ts (Phase 2).
 *
 * Handles all /api/diagnostics/* endpoints for 8 subsystems:
 *   agent, computer, knowledge-graph, workspace, network, telemetry, logs, scheduler, demo
 *
 * Each subsystem follows the same pattern:
 *   GET  /api/diagnostics/{subsystem}/report  — read JSON report file
 *   GET  /api/diagnostics/{subsystem}/status  — check running state
 *   POST /api/diagnostics/{subsystem}/run     — spawn test runner
 *
 * This handler de-duplicates ~900 lines of nearly identical code by using a
 * data-driven approach with a subsystem descriptor table.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import type { WebSocket } from "ws";

/** Subsystem descriptor — drives report/status/run for all diagnostic categories. */
interface DiagnosticSubsystem {
  /** URL path segment: /api/diagnostics/{key}/... */
  key: string;
  /** Display name for error messages */
  label: string;
  /** Script to spawn for the run endpoint */
  script: string;
  /** Extra CLI args appended after --no-build */
  extraArgs?: string[];
  /** Report file name under prism-output/ */
  reportFile: string;
  /** WebSocket event type prefix */
  wsEventPrefix: string;
  /** Property name on DashboardService for running flag */
  runningProp: string;
  /** Property name on DashboardService for lastRunAt */
  lastRunAtProp: string;
}

const SUBSYSTEMS: DiagnosticSubsystem[] = [
  {
    key: "agent",
    label: "Agent",
    script: "scripts/run-agent-tests.cjs",
    reportFile: "agent-diagnostics-report.json",
    wsEventPrefix: "agent_diagnostics",
    runningProp: "agentDiagnosticsRunning",
    lastRunAtProp: "agentDiagnosticsLastRunAt",
  },
  {
    key: "computer",
    label: "Computer",
    script: "scripts/run-computer-tests.cjs",
    reportFile: "computer-diagnostics-report.json",
    wsEventPrefix: "computer_diagnostics",
    runningProp: "computerDiagnosticsRunning",
    lastRunAtProp: "computerDiagnosticsLastRunAt",
  },
  {
    key: "knowledge-graph",
    label: "Knowledge Graph",
    script: "scripts/run-knowledge-graph-tests.cjs",
    reportFile: "knowledge-graph-diagnostics-report.json",
    wsEventPrefix: "knowledge_graph_diagnostics",
    runningProp: "knowledgeGraphDiagnosticsRunning",
    lastRunAtProp: "knowledgeGraphDiagnosticsLastRunAt",
  },
  {
    key: "workspace",
    label: "Workspace",
    script: "scripts/run-workspace-tests.cjs",
    reportFile: "workspace-diagnostics-report.json",
    wsEventPrefix: "workspace_diagnostics",
    runningProp: "workspaceDiagnosticsRunning",
    lastRunAtProp: "workspaceDiagnosticsLastRunAt",
  },
  {
    key: "network",
    label: "Network",
    script: "scripts/run-network-tests.cjs",
    reportFile: "network-diagnostics-report.json",
    wsEventPrefix: "network_diagnostics",
    runningProp: "networkDiagnosticsRunning",
    lastRunAtProp: "networkDiagnosticsLastRunAt",
  },
  {
    key: "telemetry",
    label: "Telemetry",
    script: "scripts/run-telemetry-tests.cjs",
    reportFile: "telemetry-diagnostics-report.json",
    wsEventPrefix: "telemetry_diagnostics",
    runningProp: "telemetryDiagnosticsRunning",
    lastRunAtProp: "telemetryDiagnosticsLastRunAt",
  },
  {
    key: "logs",
    label: "Logs",
    script: "scripts/run-logs-tests.cjs",
    reportFile: "logs-diagnostics-report.json",
    wsEventPrefix: "logs_diagnostics",
    runningProp: "logsDiagnosticsRunning",
    lastRunAtProp: "logsDiagnosticsLastRunAt",
  },
  {
    key: "scheduler",
    label: "Scheduler",
    script: "scripts/run-scheduler-tests.cjs",
    reportFile: "scheduler-diagnostics-report.json",
    wsEventPrefix: "scheduler_diagnostics",
    runningProp: "schedulerDiagnosticsRunning",
    lastRunAtProp: "schedulerDiagnosticsLastRunAt",
  },
  {
    key: "demo",
    label: "Demo",
    script: "scripts/run-demo-scenarios.cjs",
    extraArgs: ["--profile=all"],
    reportFile: "demo-scenario-report.json",
    wsEventPrefix: "demo_diagnostics",
    runningProp: "demoDiagnosticsRunning",
    lastRunAtProp: "demoDiagnosticsLastRunAt",
  },
];

export class DiagnosticsHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = (req.url ?? "").split("?")[0];
    const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
    return normalized.startsWith("/api/diagnostics/");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    for (const subsystem of SUBSYSTEMS) {
      const base = `/api/diagnostics/${subsystem.key}`;

      // GET /api/diagnostics/{key}/report
      if (method === "GET" && url === `${base}/report`) {
        try {
          const reportPath = join(process.cwd(), "prism-output", subsystem.reportFile);
          if (existsSync(reportPath)) {
            const raw = readFileSync(reportPath, "utf8");
            return this.json(res, 200, JSON.parse(raw));
          }
          return this.json(res, 200, { report: null });
        } catch (e: unknown) {
          return this.json(res, 500, { error: (e as Error).message });
        }
      }

      // GET /api/diagnostics/{key}/status
      if (method === "GET" && url === `${base}/status`) {
        return this.json(res, 200, {
          running: (service as any)[subsystem.runningProp],
          lastRunAt: (service as any)[subsystem.lastRunAtProp],
        });
      }

      // POST /api/diagnostics/{key}/run
      if (method === "POST" && url === `${base}/run`) {
        if ((service as any)[subsystem.runningProp]) {
          return this.json(res, 409, { error: `${subsystem.label} diagnostics already running.` });
        }
        (service as any)[subsystem.runningProp] = true;
        this.json(res, 200, { status: "started" });

        await this.spawnDiagnosticsRunner(service, subsystem);
        return;
      }
    }

    this.json(res, 404, { error: "Not found" });
  }

  /**
   * Spawn a diagnostics test runner as a child process and stream
   * stdout/stderr to WebSocket clients in real time.
   */
  private async spawnDiagnosticsRunner(
    service: DashboardService,
    subsystem: DiagnosticSubsystem,
  ): Promise<void> {
    const { spawn: spawnChild } = await import("node:child_process");
    const args = [subsystem.script, "--no-build", ...(subsystem.extraArgs ?? [])];
    const child = spawnChild("node", args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let gotStdoutComplete = false;
    const stderrNoiseRe = /^\s*(at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)|\s*$/;

    // Stream stderr lines to WS as log messages
    let stderrBuf = "";
    child.stderr!.on("data", (chunk: Buffer) => {
      try {
        stderrBuf += chunk.toString();
        const lines = stderrBuf.split("\n");
        stderrBuf = lines.pop() || "";
        for (const line of lines) {
          if (stderrNoiseRe.test(line)) continue;
          const msg = {
            type: `${subsystem.wsEventPrefix}_log`,
            source: "stderr",
            message: line.slice(0, 1024),
            timestamp: new Date().toISOString(),
          };
          this.broadcastWs(service, msg);
        }
      } catch { /* defensive */ }
    });

    // Stream stdout JSON messages to WS
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
            if (msg.type === `${subsystem.wsEventPrefix}_complete`) gotStdoutComplete = true;
            this.broadcastWs(service, { ...msg, timestamp: new Date().toISOString() });
          } catch { /* not JSON — ignore */ }
        }
      } catch { /* defensive */ }
    });

    child.on("close", () => {
      try {
        (service as any)[subsystem.runningProp] = false;
        (service as any)[subsystem.lastRunAtProp] = new Date().toISOString();
        if (!gotStdoutComplete) {
          this.broadcastWs(service, {
            type: `${subsystem.wsEventPrefix}_complete`,
            timestamp: new Date().toISOString(),
          });
        }
      } catch { /* defensive */ }
    });

    child.on("error", () => {
      (service as any)[subsystem.runningProp] = false;
    });
  }

  private broadcastWs(service: DashboardService, msg: Record<string, unknown>): void {
    const payload = JSON.stringify(msg);
    for (const ws of service.wsClients) {
      try { ws.send(payload); } catch { /* client gone */ }
    }
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data, null, 2));
  }
}
