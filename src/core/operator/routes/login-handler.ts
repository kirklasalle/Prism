import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import { DashboardService } from "../dashboard-service.js";
import { loginHtml } from "../templates/login.js";
import { readPreferences } from "../../config/workspace-resolver.js";

export class LoginHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const method = req.method?.toUpperCase() ?? "GET";
    return method === "GET" && (url === "/login" || url.startsWith("/login?"));
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const prefs = readPreferences();
    const packages = service.listSessionPackages();
    const hasInitializationCertificate = packages.some(pkg =>
      /Initialization Certificate/i.test(pkg.title || "")
    );

    const requiresSetup = !prefs?.setupComplete || !hasInitializationCertificate;

    if (requiresSetup) {
      res.writeHead(302, { Location: "/setup" });
      res.end();
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(loginHtml(service.getPort()));
  }
}
