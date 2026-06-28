import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import type { RiskTier } from "../risk-override-store.js";

export class ToolsHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = (req.url ?? "").split("?")[0];
    const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
    return normalized === "/api/tools/risk-overrides" || (normalized.startsWith("/api/tools/") && normalized.endsWith("/risk"));
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";
    const store = service.getRiskOverrideStore();

    // 1. GET /api/tools/risk-overrides
    if (method === "GET" && url === "/api/tools/risk-overrides") {
      try {
        return this.json(res, 200, { overrides: store.list() });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // 2. GET /api/tools/:toolId/risk
    if (method === "GET" && /^\/api\/tools\/[^/]+\/risk$/.test(url)) {
      const toolId = decodeURIComponent(url.split("/")[3]!);
      const ov = store.get(toolId);
      return this.json(res, 200, { toolId, override: ov ?? null });
    }

    // 3. PATCH /api/tools/:toolId/risk
    if (method === "PATCH" && /^\/api\/tools\/[^/]+\/risk$/.test(url)) {
      const toolId = decodeURIComponent(url.split("/")[3]!);
      try {
        const body = await service.readJsonBody<{ tier?: RiskTier; reason?: string; expiresAt?: string | null; setBy?: string }>(req);
        if (!body?.tier || !body?.reason) {
          return this.json(res, 400, { error: "Missing required fields", required: ["tier", "reason"] });
        }
        const ov = store.set({
          toolId,
          overrideTier: body.tier,
          reason: body.reason,
          expiresAt: body.expiresAt ?? null,
          setBy: body.setBy ?? "operator",
        });
        return this.json(res, 200, { override: ov });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to set override";
        return this.json(res, 400, { error: "Failed to set override", detail: msg });
      }
    }

    // 4. DELETE /api/tools/:toolId/risk
    if (method === "DELETE" && /^\/api\/tools\/[^/]+\/risk$/.test(url)) {
      const toolId = decodeURIComponent(url.split("/")[3]!);
      const cleared = store.clear(toolId, "operator");
      return this.json(res, cleared ? 200 : 404, { toolId, cleared: !!cleared, override: cleared });
    }

    return this.json(res, 404, { error: "Not found", path: url });
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data, null, 2));
  }
}
