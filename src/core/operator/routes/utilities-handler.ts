import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";

export class UtilitiesHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = (req.url ?? "").split("?")[0];
    const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
    return normalized === "/api/utilities" || normalized.startsWith("/api/utilities/");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";
    const registry = service.getUtilityRegistry();

    // 1. GET /api/utilities/status
    if (method === "GET" && url === "/api/utilities/status") {
      try {
        return this.json(res, 200, { utilities: service.getUtilityStates() || {} });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // 2. GET /api/utilities
    if (method === "GET" && url === "/api/utilities") {
      try {
        return this.json(res, 200, { utilities: registry.list() });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // 3. POST /api/utilities/:id/execute
    if (method === "POST" && /^\/api\/utilities\/[^/]+\/execute$/.test(url)) {
      const id = decodeURIComponent(url.split("/")[3]!);
      const desc = registry.get(id);
      if (!desc) {
        return this.json(res, 404, { error: "Unknown utility", utilityId: id });
      }
      try {
        const body = await service.readJsonBody<{ params?: Record<string, unknown>; reason?: string }>(req)
          .catch(() => ({} as { params?: Record<string, unknown>; reason?: string }));
        const params = body && "params" in body ? body.params : undefined;
        const reason = body && "reason" in body ? body.reason : undefined;
        const run = await registry.execute(id, params ?? {}, reason);
        return this.json(res, run.status === "failed" ? 500 : 200, { run });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Utility execution failed";
        return this.json(res, 500, { error: "Utility execution failed", detail: msg });
      }
    }

    // 4. GET /api/utilities/runs/:id
    if (method === "GET" && /^\/api\/utilities\/runs\/[^/]+$/.test(url)) {
      const runId = decodeURIComponent(url.split("/").pop()!);
      const run = registry.getRun(runId);
      if (!run) {
        return this.json(res, 404, { error: "Unknown run", runId });
      }
      return this.json(res, 200, { run });
    }

    // 5. GET /api/utilities/runs
    if (method === "GET" && url === "/api/utilities/runs") {
      try {
        return this.json(res, 200, { runs: registry.listRuns() });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    return this.json(res, 404, { error: "Not found", path: url });
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data, null, 2));
  }
}
