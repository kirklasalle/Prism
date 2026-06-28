import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import { workspacePath } from "../../config/workspace-resolver.js";

export class AgenticHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    const method = req.method?.toUpperCase() ?? "GET";

    if (pathname.startsWith("/api/diagnostics/agent/")) return true;
    if (pathname.startsWith("/api/readiness")) return true;
    if (pathname.startsWith("/api/ptac/")) return true;
    if (pathname.startsWith("/api/release-validation/")) return true;
    if (pathname.startsWith("/api/self-review/")) return true;
    if (pathname.startsWith("/api/release/")) return true;
    if (pathname.startsWith("/api/approval/")) return true;
    if (pathname.startsWith("/api/actions/") || pathname === "/api/actions" || pathname === "/api/action-history") return true;
    if (pathname.startsWith("/api/agents")) return true;
    if (pathname.startsWith("/api/swarms")) return true;
    if (pathname.startsWith("/api/hardware/swarm")) return true;
    
    // Legacy approval endpoints
    if (method === "POST" && (
      url.startsWith("/approve/") || url.startsWith("/api/approve/") ||
      url.startsWith("/deny/") || url.startsWith("/api/deny/")
    )) return true;

    if (method === "GET" && (
      url === "/pending" || url === "/api/pending"
    )) return true;

    if (method === "GET" && url === "/api/perf") return true;

    return false;
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    // 1. GET /api/diagnostics/agent/report
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

    // 2. GET /api/diagnostics/agent/status
    if (method === "GET" && url === "/api/diagnostics/agent/status") {
      return this.json(res, 200, {
        running: service.agentDiagnosticsRunning,
        lastRunAt: service.agentDiagnosticsLastRunAt,
      });
    }

    // 3. POST /api/diagnostics/agent/run
    if (method === "POST" && url === "/api/diagnostics/agent/run") {
      if (service.agentDiagnosticsRunning) {
        return this.json(res, 409, { error: "Agent diagnostics already running." });
      }
      service.agentDiagnosticsRunning = true;
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
            for (const ws of service.wsClients) {
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
              for (const ws of service.wsClients) {
                try { ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() })); } catch { /* client gone */ }
              }
            } catch { /* not JSON — ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          service.agentDiagnosticsRunning = false;
          service.agentDiagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of service.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "agent_diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        service.agentDiagnosticsRunning = false;
      });

      return;
    }

    // 4. GET /api/readiness
    if (method === "GET" && url.startsWith("/api/readiness")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const requestedSessionId = parsed.searchParams.get("sessionId")?.trim() || undefined;
        const snapshot = await service.getReadinessSnapshot(requestedSessionId);
        return this.json(res, 200, snapshot);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 5. POST /api/readiness/recheck
    if (method === "POST" && url === "/api/readiness/recheck") {
      try {
        const body = await service.readJsonBody<{ sessionId?: string; source?: string }>(req);
        const source = body.source?.trim() || "dashboard_recheck";
        const snapshot = await service.getReadinessSnapshot(body.sessionId?.trim() || undefined);
        service.emitReadinessAudit(source, snapshot);
        return this.json(res, 200, snapshot);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 6. POST /api/readiness/fix/:id
    if (method === "POST" && url.startsWith("/api/readiness/fix/")) {
      try {
        const ckId = decodeURIComponent(url.slice("/api/readiness/fix/".length));
        console.log(`[PRISM][readiness] Fix requested for requirement: ${ckId}`);

        let fixed = false;
        let detail = "";

        if (ckId === "local-llm-service-ready") {
          const activeSession = service.getChatStore().listSessions()[0];
          const activeProviderId = activeSession?.llmProviderId ?? (await service.getLlmProviders().getCatalog()).activeProviderId ?? null;

          if (activeProviderId === "llamacpp" || activeProviderId === "bitnetcpp") {
            const supervisor = activeProviderId === "llamacpp" ? service.getLlamaSupervisor() : service.getBitnetSupervisor();
            if (supervisor) {
              const erroredSlots = supervisor.getSnapshot().filter((s: any) => s.status === "error");
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

    // 7. GET /api/ptac/demo/runs
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

    // 8. GET /api/ptac/demo/runs/:id
    if (method === "GET" && url?.startsWith("/api/ptac/demo/runs/")) {
      if (process.env.PRISM_PTAC_OPERATOR_DEMO !== "1") {
        return this.json(res, 403, { error: "PTAC operator demo endpoint is disabled" });
      }
      try {
        const { readFile: readFileAsync } = await import("node:fs/promises");
        const { join: pathJoin, normalize: pathNormalize, sep: pathSep } = await import("node:path");
        const tail = url.slice("/api/ptac/demo/runs/".length);
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

    // 9. POST /api/ptac/demo/run
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
      const body = await service.readJsonBody<{ suite?: "fast" | "demo" | "full" }>(req).catch(() => ({} as any));
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

    // 10. POST /api/release-validation/run
    if (method === "POST" && url === "/api/release-validation/run") {
      let isRunning = false;
      let activeValidationPid = service.getActiveValidationPid();
      if (activeValidationPid !== null) {
        try {
          process.kill(activeValidationPid, 0);
          isRunning = true;
        } catch {
          service.setActiveValidationPid(null);
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

        writeFileSync(logPath, "");
        const logFile = openSync(logPath, "a");

        const child = spawn(process.execPath, ["dist/src/benchmarks/release-validation.js", "--strict"], {
          detached: true,
          stdio: ["ignore", logFile, logFile],
          env: { ...process.env },
          cwd: process.cwd()
        });

        service.setActiveValidationPid(child.pid ?? null);
        child.unref();

        return this.json(res, 202, {
          status: "spawned",
          pid: child.pid
        });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    // 11. GET /api/release-validation/status
    if (method === "GET" && url === "/api/release-validation/status") {
      let isRunning = false;
      let activeValidationPid = service.getActiveValidationPid();
      if (activeValidationPid !== null) {
        try {
          process.kill(activeValidationPid, 0);
          isRunning = true;
        } catch {
          service.setActiveValidationPid(null);
          activeValidationPid = null;
        }
      }

      let log = "";
      try {
        const logPath = workspacePath("artifacts", "benchmarks", "release-validation.log");
        if (existsSync(logPath)) {
          log = readFileSync(logPath, "utf8");
        }
      } catch { /* ignored */ }

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
      } catch { /* ignored */ }

      return this.json(res, 200, {
        running: isRunning,
        pid: activeValidationPid,
        log,
        gates,
        passed,
        generatedAt
      });
    }

    // 12. GET /api/self-review/latest
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

    // 13. GET /api/self-review/history
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

    // 14. GET /api/release/validation/latest
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

    // 15. GET /api/release/decision/latest
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

    // 16. POST /api/actions/:action
    const actionMatch = /^\/api\/actions\/([^/]+)$/.exec(url);
    if (method === "POST" && actionMatch) {
      const actionName = decodeURIComponent(actionMatch[1]!);
      if (!service.actionsByName.has(actionName)) {
        return this.json(res, 404, { error: `Unknown action: ${actionName}` });
      }
      const currentState = service.actionStates.get(actionName);
      if (currentState?.status === "running") {
        return this.json(res, 409, { error: `Action already running: ${actionName}` });
      }
      try {
        const payload = await service.readJsonBody<{ sessionId?: string }>(req).catch(() => ({ sessionId: undefined }));
        return this.json(res, 202, service.triggerAction(actionName, payload.sessionId));
      } catch (error) {
        return this.json(res, 202, service.triggerAction(actionName));
      }
    }

    // 17. POST /api/approval/:id/approve or POST /approve/:id
    const approveMatch = /^\/(approve|api\/approve)\/([^/]+)$/.exec(url);
    const approveMatchRest = /^\/api\/approval\/([^/]+)\/approve$/.exec(url);
    if (method === "POST" && (approveMatch || approveMatchRest)) {
      const id = approveMatch ? approveMatch[2]! : approveMatchRest![1]!;
      const ok = service.getApprovalQueue().approve(id);
      return this.json(res, ok ? 200 : 404, { approved: ok });
    }

    // 18. POST /api/approval/:id/deny or POST /deny/:id
    const denyMatch = /^\/(deny|api\/deny)\/([^/]+)$/.exec(url);
    const denyMatchRest = /^\/api\/approval\/([^/]+)\/deny$/.exec(url);
    if (method === "POST" && (denyMatch || denyMatchRest)) {
      const id = denyMatch ? denyMatch[2]! : denyMatchRest![1]!;
      const ok = service.getApprovalQueue().deny(id);
      return this.json(res, ok ? 200 : 404, { denied: ok });
    }

    // 19. GET /api/pending or GET /pending
    if (method === "GET" && (url === "/pending" || url === "/api/pending" || url === "/api/approval/pending")) {
      return this.json(res, 200, service.getApprovalQueue().list());
    }

    // 20. GET /api/perf
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

    // GET /api/agents
    if (method === "GET" && url === "/api/agents") {
      const agentLifecycle = service.getAgentLifecycle();
      const swarmCoordinator = service.getSwarmCoordinator();
      const agentTelemetry = service.getAgentTelemetry();
      const agents = agentLifecycle?.list() ?? [];
      const swarms = swarmCoordinator?.list() ?? [];
      const telemetry = agentTelemetry?.getGlobalStats() ?? { activeAgents: 0, tasksCompleted: 0, tasksFailed: 0, avgResponseMs: 0, totalDispatches: 0 };
      const agentSummaries = agents.map((a: any) => {
        const summary = agentTelemetry?.getAgentSummary(a.agentId);
        const modelOverride = service.getLlmProviders().getAgentModelOverride(a.agentId);
        return {
          ...a,
          modelOverride: a.modelOverride ?? modelOverride,
          telemetry: summary ?? null,
        };
      });
      return this.json(res, 200, { agents: agentSummaries, swarms, telemetry });
    }

    // POST /api/agents/launch
    if (method === "POST" && url === "/api/agents/launch") {
      const agentLifecycle = service.getAgentLifecycle();
      if (!agentLifecycle) return this.json(res, 503, { error: "Agent lifecycle not initialized" });
      const body = await service.readJsonBody<{ role?: string; description?: string; lifecycle?: string; providerId?: string; model?: string }>(req);
      const role = (body.role ?? "chat") as import("../model-capability-matrix.js").TaskRole;
      const instance = agentLifecycle.spawn({
        role,
        description: body.description,
        lifecycle: (body.lifecycle as "ephemeral" | "semi-permanent" | "permanent") ?? "ephemeral",
        modelOverride: body.providerId && body.model ? { providerId: body.providerId, model: body.model } : undefined,
      });
      // Sync model override to LLM provider routing
      if (instance.modelOverride) {
        service.getLlmProviders().setAgentModelOverride(instance.agentId, instance.modelOverride.providerId, instance.modelOverride.model);
      }
      // Register in agent pool
      service.getAgentPool()?.register({ agentId: instance.agentId, role: instance.role, description: instance.description, systemContext: instance.systemContext });
      return this.json(res, 201, { agent: instance });
    }

    // POST /api/agents/stop
    if (method === "POST" && url === "/api/agents/stop") {
      const agentLifecycle = service.getAgentLifecycle();
      if (!agentLifecycle) return this.json(res, 503, { error: "Agent lifecycle not initialized" });
      const body = await service.readJsonBody<{ agentId: string }>(req);
      service.getLlmProviders().clearAgentModelOverride(body.agentId);
      service.getAgentPool()?.unregister(body.agentId);
      const stopped = agentLifecycle.stop(body.agentId);
      return this.json(res, 200, { agentId: body.agentId, stopped });
    }

    // POST /api/agents/:agentId/model
    if (method === "POST" && url?.match(/^\/api\/agents\/([^/]+)\/model$/)) {
      const agentLifecycle = service.getAgentLifecycle();
      if (!agentLifecycle) return this.json(res, 503, { error: "Agent lifecycle not initialized" });
      const agentId = url.split("/")[3]!;
      const body = await service.readJsonBody<{ providerId: string; model: string }>(req);
      agentLifecycle.setModelOverride(agentId, { providerId: body.providerId, model: body.model });
      service.getLlmProviders().setAgentModelOverride(agentId, body.providerId, body.model);
      return this.json(res, 200, { agentId, modelOverride: { providerId: body.providerId, model: body.model } });
    }

    // POST /api/agents/:agentId/promote
    if (method === "POST" && url?.match(/^\/api\/agents\/([^/]+)\/promote$/)) {
      const agentLifecycle = service.getAgentLifecycle();
      if (!agentLifecycle) return this.json(res, 503, { error: "Agent lifecycle not initialized" });
      const agentId = url.split("/")[3]!;
      const newTier = agentLifecycle.promote(agentId);
      if (!newTier) return this.json(res, 404, { error: "Agent not found" });
      return this.json(res, 200, { agentId, lifecycle: newTier });
    }

    // POST /api/agents/:agentId/demote
    if (method === "POST" && url?.match(/^\/api\/agents\/([^/]+)\/demote$/)) {
      const agentLifecycle = service.getAgentLifecycle();
      if (!agentLifecycle) return this.json(res, 503, { error: "Agent lifecycle not initialized" });
      const agentId = url.split("/")[3]!;
      const newTier = agentLifecycle.demote(agentId);
      if (!newTier) return this.json(res, 404, { error: "Agent not found" });
      return this.json(res, 200, { agentId, lifecycle: newTier });
    }

    // GET /api/agents/telemetry
    if (method === "GET" && url === "/api/agents/telemetry") {
      const agentLifecycle = service.getAgentLifecycle();
      const agentTelemetry = service.getAgentTelemetry();
      const summaries = agentTelemetry?.getAllSummaries() ?? [];
      const frequency = agentTelemetry?.getDispatchFrequency() ?? [];
      const recommendations = agentLifecycle && agentTelemetry
        ? agentTelemetry.getPromotionRecommendations(agentLifecycle)
        : [];
      const global = agentTelemetry?.getGlobalStats() ?? { activeAgents: 0, tasksCompleted: 0, tasksFailed: 0, avgResponseMs: 0, totalDispatches: 0 };
      return this.json(res, 200, { summaries, frequency, recommendations, global });
    }

    // POST /api/swarms/create
    if (method === "POST" && url === "/api/swarms/create") {
      const swarmCoordinator = service.getSwarmCoordinator();
      if (!swarmCoordinator) return this.json(res, 503, { error: "Swarm coordinator not initialized" });
      const body = await service.readJsonBody<{ topology?: string; goal?: string; agentIds?: string[]; timeoutMs?: number }>(req);
      const swarm = swarmCoordinator.create({
        topology: (body.topology as "mesh" | "star" | "pipeline" | "broadcast") ?? "broadcast",
        goal: body.goal ?? "",
        agentIds: body.agentIds ?? [],
        timeoutMs: body.timeoutMs,
      });
      // Start execution asynchronously
      void swarmCoordinator.execute(swarm.swarmId).catch(() => { });
      return this.json(res, 201, { swarm });
    }

    // GET /api/swarms
    if (method === "GET" && url === "/api/swarms") {
      const swarmCoordinator = service.getSwarmCoordinator();
      const swarms = swarmCoordinator?.list() ?? [];
      return this.json(res, 200, { swarms });
    }

    // POST /api/swarms/:swarmId/stop
    if (method === "POST" && url?.match(/^\/api\/swarms\/([^/]+)\/stop$/)) {
      const swarmCoordinator = service.getSwarmCoordinator();
      if (!swarmCoordinator) return this.json(res, 503, { error: "Swarm coordinator not initialized" });
      const swarmId = url.split("/")[3]!;
      const stopped = swarmCoordinator.stop(swarmId);
      return this.json(res, 200, { swarmId, stopped });
    }

    // GET /api/hardware/swarm
    if (method === "GET" && url === "/api/hardware/swarm") {
      try {
        const llamaSupervisor = service.getLlamaSupervisor();
        if (!llamaSupervisor) return this.json(res, 404, { error: "LlamaCppSupervisor disabled" });
        return this.json(res, 200, llamaSupervisor.getSnapshot());
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // POST /api/hardware/swarm/load
    if (method === "POST" && url === "/api/hardware/swarm/load") {
      try {
        const llamaSupervisor = service.getLlamaSupervisor();
        if (!llamaSupervisor) return this.json(res, 404, { error: "LlamaCppSupervisor disabled" });
        const body = await service.readJsonBody<{ modelPath?: string; modelAlias?: string; slotId?: string | number; model?: string; ctxSize?: number }>(req);

        let modelAlias = body.modelAlias || body.model;
        let modelPath = body.modelPath;

        if (!modelAlias) {
          return this.json(res, 400, { error: "Missing required model/modelAlias field." });
        }

        if (!modelPath) {
          modelPath = llamaSupervisor.getModelPath(modelAlias) || undefined;
        }

        if (!modelPath) {
          if (body.model && (body.model.endsWith(".gguf") || body.model.includes("/") || body.model.includes("\\"))) {
            modelPath = body.model;
            modelAlias = body.model.replace(/\.gguf$/i, "").split(/[/\\]/).pop();
          } else {
            return this.json(res, 400, { error: `Model "${modelAlias}" not found in local models directory.` });
          }
        }

        const slot = await llamaSupervisor.loadModel(modelPath!, modelAlias!, body.ctxSize);
        return this.json(res, 200, slot);
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // POST /api/hardware/swarm/unload
    if (method === "POST" && url === "/api/hardware/swarm/unload") {
      try {
        const llamaSupervisor = service.getLlamaSupervisor();
        if (!llamaSupervisor) return this.json(res, 404, { error: "LlamaCppSupervisor disabled" });
        const body = await service.readJsonBody<{ modelAlias?: string; slotId?: string | number }>(req);

        let slot = null;
        if (body.modelAlias) {
          slot = llamaSupervisor.getSnapshot().find((s: any) => s.modelAlias === body.modelAlias);
        } else if (body.slotId !== undefined) {
          const idNum = Number(body.slotId);
          slot = llamaSupervisor.getSnapshot().find((s: any) => s.id === idNum);
        }

        if (!slot) {
          return this.json(res, 400, { error: "Could not find matching slot to unload." });
        }

        if (slot.modelAlias) {
          await llamaSupervisor.unloadModel(slot.modelAlias);
        }
        return this.json(res, 200, { unloaded: true });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/actions") {
      return this.json(res, 200, service.listActions());
    }

    if (method === "GET" && url === "/api/action-history") {
      return this.json(res, 200, service.listActionHistory());
    }
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }
}
