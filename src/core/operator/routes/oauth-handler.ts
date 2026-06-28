import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";

export class OAuthHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = (req.url ?? "").split("?")[0];
    const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
    return normalized.startsWith("/api/auth/gmail") || normalized.startsWith("/api/auth/outlook");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    // ── Gmail OAuth ────────────────────────────────────────────────────
    if (method === "GET" && url === "/api/auth/gmail/authorize") {
      try {
        const authUrl = await service.getGmailOAuth().getAuthorizationUrl();
        this.json(res, 200, { authUrl });
      } catch (err: unknown) {
        this.json(res, 503, { error: (err as Error).message });
      }
      return;
    }

    if (method === "GET" && url.startsWith("/api/auth/gmail/callback")) {
      const parsed = new URL(url, "http://localhost");
      const code = parsed.searchParams.get("code");
      if (!code) {
        this.json(res, 400, { error: "Missing code parameter" });
        return;
      }
      const result = await service.getGmailOAuth().exchangeCode(code);
      res.writeHead(302, { Location: "/settings?tab=oauth&provider=gmail&connected=" + result.connected });
      res.end();
      return;
    }

    if (method === "GET" && url === "/api/auth/gmail/status") {
      const status = await service.getGmailOAuth().getStatus();
      this.json(res, 200, status);
      return;
    }

    if (method === "DELETE" && url === "/api/auth/gmail/disconnect") {
      await service.getGmailOAuth().disconnect();
      this.json(res, 200, { disconnected: true });
      return;
    }

    // ── Outlook OAuth ──────────────────────────────────────────────────
    if (method === "GET" && url === "/api/auth/outlook/authorize") {
      try {
        const authUrl = await service.getOutlookOAuth().getAuthorizationUrl();
        this.json(res, 200, { authUrl });
      } catch (err: unknown) {
        this.json(res, 503, { error: (err as Error).message });
      }
      return;
    }

    if (method === "GET" && url.startsWith("/api/auth/outlook/callback")) {
      const parsed = new URL(url, "http://localhost");
      const code = parsed.searchParams.get("code");
      if (!code) {
        this.json(res, 400, { error: "Missing code parameter" });
        return;
      }
      const result = await service.getOutlookOAuth().exchangeCode(code);
      res.writeHead(302, { Location: "/settings?tab=oauth&provider=outlook&connected=" + result.connected });
      res.end();
      return;
    }

    if (method === "GET" && url === "/api/auth/outlook/status") {
      const status = await service.getOutlookOAuth().getStatus();
      this.json(res, 200, status);
      return;
    }

    if (method === "DELETE" && url === "/api/auth/outlook/disconnect") {
      await service.getOutlookOAuth().disconnect();
      this.json(res, 200, { disconnected: true });
      return;
    }

    this.json(res, 404, { error: "Not found" });
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data, null, 2));
  }
}
