import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
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
    const store = service.getIamStore();
    const iam = service.getIamHandler();
    const sessions = service.getSessionManager();

    const qIdx = url.indexOf("?");
    const params = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx + 1)) : null;

    // Query-token auth is a dev-only bypass (start_web.bat sets PRISM_ALLOW_QUERY_TOKEN=1).
    // Production startup scripts do NOT set this flag, so operators must use the login page.
    const allowQueryToken = process.env.PRISM_ALLOW_QUERY_TOKEN === "1";
    let clientToken = "";
    if (allowQueryToken) {
      clientToken = params?.get("token") ?? "";
    }
    if (!clientToken) {
      const authHeader = req.headers["authorization"];
      if (authHeader && authHeader.startsWith("Bearer ")) {
        clientToken = authHeader.substring(7).trim();
      }
    }

    const principal = iam.resolvePrincipalFromCookie(req);
    const isTokenValid = clientToken ? service.getAuthGate().check({ headers: { authorization: `Bearer ${clientToken}` }, url: "/" } as any).authenticated : false;

    const authDisabled = (process.env.PRISM_AUTH_DISABLED ?? "").toLowerCase() === "true";
    const isAdmin = authDisabled || (principal ? (principal.roles.includes("admin") || principal.roles.includes("root")) : true);
    if (!principal && !isTokenValid && !authDisabled) {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return;
    }

    if (principal && !clientToken) {
      clientToken = service.getAuthGate().getToken();
    }

    let packages = service.listSessionPackages();
    if (principal) {
      const operatorSessionIds = new Set(
        service.getChatStore().listSessions()
          .filter(s => s.operatorEmail === principal.email || /Initialization Certificate/i.test(s.title || ""))
          .map(s => s.sessionId)
      );
      packages = packages.filter(pkg =>
        pkg.sessionIds.some(sid => operatorSessionIds.has(sid))
      );
    }

    const hasInitializationCertificate = packages.some(pkg =>
      /Initialization Certificate/i.test(pkg.title || "")
    );

    const requiresSetup = !prefs?.setupComplete || !hasInitializationCertificate;

    if (requiresSetup && !url.startsWith("/setup") && !url.startsWith("/login")) {
      res.writeHead(302, { Location: "/setup" });
      res.end();
      return;
    }

    if (!principal && isTokenValid) {
      const adminUser = store.getUserByEmail("default", "admin@prism.ai");
      if (adminUser) {
        const { cookie } = sessions.issue(adminUser.id, "default");
        sessions.writeCookie(res, cookie);
      }
    }

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
