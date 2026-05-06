import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import { DashboardService } from "../dashboard-service.js";
import { dashboardHtml, simpleModeHtml } from "../templates/index.js";
import { readPreferences, writePreferences } from "../../config/workspace-resolver.js";

export class DashboardHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const method = req.method?.toUpperCase() ?? "GET";
    return method === "GET" && (url === "/" || url === "/dashboard" || url === "/simple" || url.startsWith("/?") || url.startsWith("/dashboard?") || url.startsWith("/simple?"));

  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const url = req.url ?? "";
    const prefs = readPreferences();

    if (!prefs?.setupComplete && !url.startsWith("/dashboard")) {
      res.writeHead(302, { Location: "/setup" });
      res.end();
      return;
    }

    const qIdx = url.indexOf("?");
    const params = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx + 1)) : null;
    const clientToken = params?.get("token") ?? (service as any).extractBearerToken(req) ?? "";

    if (params?.get("mode") === "advanced") {
      writePreferences({ uiMode: "advanced" });
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Clear-Site-Data": '"cache"',
        Pragma: "no-cache",
        Expires: "0",
      });
      res.end(dashboardHtml(service.getPort(), clientToken));
      return;
    }

    const isExplicitDashboard = url.startsWith("/dashboard");
    const isExplicitSimple = url.startsWith("/simple");
    const sessionCount = service.getChatStore().listSessions().length;
    const useSimple = isExplicitSimple || (!isExplicitDashboard
      && (prefs?.uiMode === "simple" || (!prefs?.uiMode && sessionCount === 0)));


    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      // Clear-Site-Data evicts any previously cached 301/302 redirects for /api/* ↔ /api/v1/*
      // that were issued by older server versions. Without this, browsers in redirect-loop
      // mode will never reach the API regardless of server-side fixes.
      "Clear-Site-Data": '"cache"',
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(useSimple ? simpleModeHtml(service.getPort(), clientToken) : dashboardHtml(service.getPort(), clientToken));
  }
}
