import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import { writePreferences } from "../../config/workspace-resolver.js";

export class GuardianHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = (req.url ?? "").split("?")[0];
    const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
    return normalized.startsWith("/api/guardian");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";
    const guardianAgent = service.getGuardianAgent();

    if (method === "GET" && url === "/api/guardian/status") {
      try {
        return this.json(res, 200, guardianAgent.getStatus());
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/guardian/start") {
      try {
        const status = guardianAgent.getStatus();
        if (!status.modelPath) {
          return this.json(res, 400, {
            error: "No local model path configured for Guardian Agent.",
            suggestion: "Please select a GGUF model from the dropdown in the Guardian panel before starting."
          });
        }
        await guardianAgent.start();
        return this.json(res, 200, guardianAgent.getStatus());
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/guardian/stop") {
      try {
        guardianAgent.stop();
        return this.json(res, 200, guardianAgent.getStatus());
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/guardian/configure") {
      try {
        const body = await service.readJsonBody<Record<string, unknown>>(req);
        guardianAgent.configure(body as any);
        // v0.20.5 — Persist the merged config so the next server boot can
        // hydrate + autostart with the operator's last-selected model.
        try {
          const merged = guardianAgent.getConfig() as unknown as Record<string, unknown>;
          writePreferences({ guardianConfig: merged });
        } catch (err) {
          console.warn("[guardian] failed to persist config:", err);
        }
        return this.json(res, 200, guardianAgent.getStatus());
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/guardian/tasks") {
      return this.json(res, 200, { tasks: guardianAgent.getTaskStatus() });
    }

    if (method === "POST" && url?.startsWith("/api/guardian/tasks/") && url?.endsWith("/run")) {
      const taskId = url.replace("/api/guardian/tasks/", "").replace("/run", "");
      try {
        const result = await guardianAgent.runTask(taskId);
        if (!result) return this.json(res, 404, { error: `Task not found: ${taskId}` });
        return this.json(res, 200, result);
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url?.startsWith("/api/guardian/tasks/") && url?.endsWith("/toggle")) {
      const taskId = url.replace("/api/guardian/tasks/", "").replace("/toggle", "");
      const result = guardianAgent.toggleTask(taskId);
      if (!result) return this.json(res, 404, { error: `Task not found: ${taskId}` });
      return this.json(res, 200, result);
    }

    if (method === "POST" && url === "/api/guardian/tasks/run-all") {
      try {
        await guardianAgent.runAllTasks();
        return this.json(res, 200, { tasks: guardianAgent.getTaskStatus() });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    this.json(res, 404, { error: "Not found" });
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data, null, 2));
  }
}
