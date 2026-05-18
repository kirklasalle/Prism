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
    return url.startsWith("/api/autonomous/");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    const loop = service.getAutonomousLoop();
    if (!loop) {
      this.json(res, 503, { error: "Autonomous loop not available — no tool registry configured" });
      return;
    }

    // POST /api/autonomous/goals — Submit a new autonomous goal
    if (method === "POST" && url === "/api/autonomous/goals") {
      const body = await this.readBody(req);
      const objective = body.objective as string;
      if (!objective?.trim()) {
        this.json(res, 400, { error: "objective is required" });
        return;
      }

      const source: GoalSource = (body.source as GoalSource) ?? "dashboard";
      const operatorId = body.operatorId as string ?? "operator";
      const constraints: Partial<AutonomousGoalConstraints> = {};

      if (body.maxActions != null) constraints.maxActions = Number(body.maxActions);
      if (body.maxDurationMs != null) constraints.maxDurationMs = Number(body.maxDurationMs);
      if (body.allowBrowserUse != null) constraints.allowBrowserUse = Boolean(body.allowBrowserUse);
      if (body.allowComputerUse != null) constraints.allowComputerUse = Boolean(body.allowComputerUse);
      if (body.allowShellExec != null) constraints.allowShellExec = Boolean(body.allowShellExec);
      if (body.requireApprovalAboveRisk != null) constraints.requireApprovalAboveRisk = body.requireApprovalAboveRisk as "low" | "medium" | "high";

      const goal = loop.submitGoal(objective, source, operatorId, constraints);

      // Fire-and-forget: begin execution asynchronously
      void loop.executeGoal(goal.goalId, (step) => {
        // Broadcast step events via WebSocket
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

      this.json(res, 201, {
        goalId: goal.goalId,
        status: goal.status,
        objective: goal.objective,
        correlationId: goal.correlationId,
        constraints: goal.constraints,
      });
      return;
    }

    // GET /api/autonomous/goals — List all goals
    if (method === "GET" && url === "/api/autonomous/goals") {
      const goals = loop.listGoals(50);
      this.json(res, 200, { goals });
      return;
    }

    // GET /api/autonomous/active — Get the currently active goal
    if (method === "GET" && url === "/api/autonomous/active") {
      const active = loop.getActiveGoal();
      this.json(res, 200, { goal: active });
      return;
    }

    // GET /api/autonomous/aab-ledger — Get the AAB ledger
    if (method === "GET" && url === "/api/autonomous/aab-ledger") {
      this.json(res, 200, { entries: loop.getAABLedger() });
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
