import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import { DashboardService } from "../dashboard-service.js";
import { resolveWorkspaceRoot } from "../../config/workspace-resolver.js";

export class ApiHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    return url.startsWith("/api/");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    // Normalize /api/v1/* → /api/* for consistent handler matching
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    if (method === "GET" && (url === "/api/health" || url === "/health")) {
      const dbOk = this.checkDb(service);
      const providerCount = service.getChatStore().listProviderSettings().length;
      
      this.json(res, 200, {
        status: "ok",
        version: "0.2.0",
        uptime: Math.floor(process.uptime()),
        sessionId: service.getRuntimeStatus().sessionId,
        mode: service.getRuntimeStatus().mode,
        dependencies: {
          db: dbOk ? "ok" : "unavailable",
          providers: providerCount,
          pending_approvals: service.getApprovalQueue().list().length,
        },
      });
      return;
    }

    if (method === "GET" && url === "/api/status") {
      const events = service.getActivityBus().listEvents();
      this.json(res, 200, {
        ...service.getRuntimeStatus(),
        uptimeSeconds: Math.floor((Date.now() - Date.parse(service.getRuntimeStatus().startedAt)) / 1000),
        pendingApprovals: service.getApprovalQueue().list().length,
        chatSessionCount: service.getChatStore().listSessions().length,
        eventCount: events.length,
        lastEvent: events[events.length - 1] ?? null,
        workspaceRoot: resolveWorkspaceRoot(),
      });
      return;
    }

    if (method === "GET" && url === "/api/system/adapters") {
      const terminal = service.getTerminalAdapter();
      const container = service.getContainerAdapter();
      this.json(res, 200, {
        terminal: {
          enabled: terminal?.isPtyEnabled() ?? false,
          backend: terminal?.isPtyEnabled() ? "node-pty" : "child_process (fallback)",
        },
        container: {
          enabled: container?.isContainerRuntimeEnabled() ?? false,
          backend: container?.getRuntimeBackend() ?? "in-memory (fallback)",
        }
      });
      return;
    }

    // Fallback for other /api routes if not handled here
    // In a real router, we might have more specific handlers
  }

  private checkDb(service: DashboardService): boolean {
    try {
      service.getChatStore().listSessions();
      return true;
    } catch {
      return false;
    }
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }
}
