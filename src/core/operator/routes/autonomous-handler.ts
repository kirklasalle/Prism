/**
 * PRISM Autonomous Route Handler — Priority 1 (Roadmap)
 *
 * REST API endpoints for autonomous goal management. Provides submit,
 * list, inspect, pause/resume/abort operations for autonomous goals,
 * plus access to the AAB ledger and active goal status.
 *
 * All routes are auth-gated via the standard dashboard auth chain.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import type { GoalSource, AutonomousGoalConstraints } from "../../runtime/autonomous-agent-loop.js";

export class AutonomousHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    return url.startsWith("/api/autonomous/") && !url.startsWith("/api/autonomous/session/");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const cleanUrl = rawUrl.split("?")[0] || "";
    const normalizedUrl = cleanUrl.endsWith("/") && cleanUrl.length > 1 ? cleanUrl.slice(0, -1) : cleanUrl;
    const url = normalizedUrl.startsWith("/api/v1/") ? "/api/" + normalizedUrl.substring("/api/v1/".length) : normalizedUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    const loop = service.getAutonomousLoop();
    if (!loop) {
      this.json(res, 503, { error: "Autonomous loop not available — no tool registry configured" });
      return;
    }

    // POST /api/autonomous/goals or /api/autonomous/goal — Submit a new autonomous goal
    if (method === "POST" && (url === "/api/autonomous/goals" || url === "/api/autonomous/goal")) {
      const body = await this.readBody(req);
      const objective = body.objective as string;
      if (!objective?.trim()) {
        this.json(res, 400, { error: "objective is required" });
        return;
      }

      const source: GoalSource = (body.source as GoalSource) ?? "dashboard";
      const op = service.getDevIdentity()?.getOperator();
      const operatorId = (body.operatorId as string) ?? op?.operatorId ?? "unknown";
      
      const bodyConstraints = (body.constraints as Record<string, any>) ?? {};
      const constraints: Partial<AutonomousGoalConstraints> = {};

      const maxActions = body.maxActions ?? bodyConstraints.maxActions;
      if (maxActions != null) constraints.maxActions = Number(maxActions);

      const maxDurationMs = body.maxDurationMs ?? bodyConstraints.maxDurationMs;
      if (maxDurationMs != null) constraints.maxDurationMs = Number(maxDurationMs);

      const allowBrowser = body.allowBrowserUse ?? bodyConstraints.allowBrowserUse ?? bodyConstraints.allowBrowser;
      if (allowBrowser != null) constraints.allowBrowserUse = Boolean(allowBrowser);

      const allowComputer = body.allowComputerUse ?? bodyConstraints.allowComputerUse ?? bodyConstraints.allowComputer;
      if (allowComputer != null) constraints.allowComputerUse = Boolean(allowComputer);

      const allowShell = body.allowShellExec ?? bodyConstraints.allowShellExec ?? bodyConstraints.allowShell;
      if (allowShell != null) constraints.allowShellExec = Boolean(allowShell);

      const requireApproval = body.requireApprovalAboveRisk ?? bodyConstraints.requireApprovalAboveRisk;
      if (requireApproval != null) constraints.requireApprovalAboveRisk = requireApproval as "low" | "medium" | "high";

      const goal = loop.submitGoal(
        objective,
        source,
        operatorId,
        constraints,
        (body.sessionId as string) ?? (body.chatSessionId as string) ?? undefined
      );

      // Fire-and-forget: begin execution asynchronously
      if (body.execute !== false) {
        void loop.executeGoal(goal.goalId, (step) => {
          // Broadcast step events via WebSocket to all dashboard clients
          service.broadcastWs({
            type: "autonomous_step",
            goalId: goal.goalId,
            ...step,
            timestamp: new Date().toISOString(),
          });
        }).then((result) => {
          service.broadcastWs({
            type: "autonomous_goal_complete",
            goalId: goal.goalId,
            status: result.status,
            summary: result.summary,
            iterations: result.iterations,
            toolCallsExecuted: result.toolCallsExecuted,
            totalDurationMs: result.totalDurationMs,
            timestamp: new Date().toISOString(),
          });
        });
      }

      if (url === "/api/autonomous/goal") {
        this.json(res, 201, goal);
      } else {
        this.json(res, 201, {
          goalId: goal.goalId,
          status: goal.status,
          objective: goal.objective,
          correlationId: goal.correlationId,
          constraints: goal.constraints,
        });
      }
      return;
    }

    // GET /api/autonomous/goals or /api/autonomous/history — List all goals
    if (method === "GET" && (url === "/api/autonomous/goals" || url === "/api/autonomous/history" || url.startsWith("/api/autonomous/history"))) {
      const goals = loop.listGoals(50);
      this.json(res, 200, { goals });
      return;
    }

    // GET /api/autonomous/active or /api/autonomous/status — Get the active/current goal status
    if (method === "GET" && (url === "/api/autonomous/active" || url === "/api/autonomous/status")) {
      const active = loop.getActiveGoal();
      if (url === "/api/autonomous/status") {
        this.json(res, 200, { active, paused: loop.isPaused() });
      } else {
        this.json(res, 200, { goal: active });
      }
      return;
    }

    // GET /api/autonomous/aab-ledger — Get the AAB ledger
    if (method === "GET" && url === "/api/autonomous/aab-ledger") {
      this.json(res, 200, { entries: loop.getAABLedger() });
      return;
    }

    // POST /api/autonomous/pause — Legacy pause endpoint
    if (method === "POST" && url === "/api/autonomous/pause") {
      try {
        const body = await this.readBody(req);
        const goalId = body.goalId as string | undefined;
        const reason = body.reason as string | undefined;
        if (goalId) {
          loop.pauseGoal(goalId, reason ?? "Operator paused via API");
        } else {
          loop.globalPause();
        }
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 400, { error: String(err) });
      }
      return;
    }

    // POST /api/autonomous/resume — Legacy resume endpoint
    if (method === "POST" && url === "/api/autonomous/resume") {
      try {
        const body = await this.readBody(req);
        const goalId = body.goalId as string | undefined;
        if (goalId) {
          loop.resumeGoal(goalId);
        } else {
          loop.globalResume();
        }
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 400, { error: String(err) });
      }
      return;
    }

    // POST /api/autonomous/terminate — Legacy terminate endpoint
    if (method === "POST" && url === "/api/autonomous/terminate") {
      try {
        const body = await this.readBody(req);
        const goalId = body.goalId as string | undefined;
        const reason = body.reason as string | undefined;
        const active = loop.getActiveGoal();
        const targetId = goalId ?? active?.goalId;
        if (targetId) {
          loop.requestAbort();
          loop.terminateGoal(targetId, reason ?? "Operator terminated via API");
        }
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 400, { error: String(err) });
      }
      return;
    }

    // POST /api/autonomous/abort — Legacy abort endpoint
    if (method === "POST" && url === "/api/autonomous/abort") {
      loop.requestAbort();
      this.json(res, 200, { ok: true, message: "Abort requested" });
      return;
    }

    // Goal-specific routes: /api/autonomous/goals/:id[/action]
    const goalMatch = url.match(/^\/api\/autonomous\/goals\/([^/]+)(\/.*)?$/);
    if (goalMatch) {
      const goalId = goalMatch[1];
      const action = goalMatch[2] ?? "";

      // GET /api/autonomous/goals/:id — Get a specific goal
      if (method === "GET" && !action) {
        const goal = loop.getGoal(goalId);
        if (!goal) {
          this.json(res, 404, { error: `Goal ${goalId} not found` });
          return;
        }
        this.json(res, 200, { goal });
        return;
      }

      // POST /api/autonomous/goals/:id/abort
      if (method === "POST" && action === "/abort") {
        loop.requestAbort();
        loop.terminateGoal(goalId, "Operator requested abort via API");
        this.json(res, 200, { ok: true, goalId, action: "aborted" });
        return;
      }

      // POST /api/autonomous/goals/:id/pause
      if (method === "POST" && action === "/pause") {
        loop.pauseGoal(goalId, "Operator paused via API");
        this.json(res, 200, { ok: true, goalId, action: "paused" });
        return;
      }

      // POST /api/autonomous/goals/:id/resume
      if (method === "POST" && action === "/resume") {
        loop.resumeGoal(goalId);
        this.json(res, 200, { ok: true, goalId, action: "resumed" });
        return;
      }
    }

    // Fallback
    this.json(res, 404, { error: "Unknown autonomous endpoint" });
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private async readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
        } catch {
          resolve({});
        }
      });
      req.on("error", () => resolve({}));
    });
  }

  private json(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }
}
