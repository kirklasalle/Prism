import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import type { SessionPackageStatus } from "../types/index.js";

export class SessionPackageHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = (req.url ?? "").split("?")[0];
    const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
    return normalized.startsWith("/api/session-packages");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    if (method === "GET" && url === "/api/session-packages") {
      const principal = service.getIamHandler().resolvePrincipalFromCookie(req);
      const authDisabled = (process.env.PRISM_AUTH_DISABLED ?? "").toLowerCase() === "true";
      const isAdmin = authDisabled || (principal ? principal.roles.includes("admin") : true);

      let packages = service.listSessionPackages();
      if (!isAdmin && principal) {
        const operatorSessionIds = new Set(
          service.getChatStore().listSessions()
            .filter(s => s.operatorEmail === principal.email)
            .map(s => s.sessionId)
        );
        packages = packages.filter(pkg =>
          pkg.sessionIds.some(sid => operatorSessionIds.has(sid))
        );
      }

      return this.json(res, 200, {
        packages,
        releaseSnapshot: service.getSessionPackageReleaseSnapshot(),
      });
    }

    if (method === "GET" && url === "/api/session-packages/metrics") {
      return this.json(res, 200, service.getSessionPackageMetrics());
    }

    if (method === "GET" && url.startsWith("/api/session-packages/history")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const limit = Math.max(1, Number(parsed.searchParams.get("limit") ?? 20));
        return this.json(res, 200, { history: service.listSessionPackageHistory(limit) });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/session-packages") {
      try {
        const body = await service.readJsonBody<{
          title?: string;
          areaOfInterest?: string | null;
          objective?: string | null;
          successCriteria?: string | null;
          dependencies?: string[];
          sessionIds?: string[];
          status?: SessionPackageStatus;
        }>(req);
        const pkg = service.createSessionPackage({
          ...body,
          source: req.headers["x-prism-source"]?.toString() || "dashboard_api",
        });
        return this.json(res, 201, { package: pkg });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    const sessionPackageExportMatch = /^\/api\/session-packages\/([^/]+)\/export$/.exec(url);
    if (sessionPackageExportMatch && method === "POST") {
      try {
        const packageId = decodeURIComponent(sessionPackageExportMatch[1]!);
        const principal = service.getIamHandler().resolvePrincipalFromCookie(req);
        const authDisabled = (process.env.PRISM_AUTH_DISABLED ?? "").toLowerCase() === "true";
        const isAdmin = authDisabled || (principal ? principal.roles.includes("admin") : true);

        if (!isAdmin && principal) {
          const pkg = service.listSessionPackages().find(p => p.packageId === packageId);
          if (pkg) {
            const operatorSessionIds = new Set(
              service.getChatStore().listSessions()
                .filter(s => s.operatorEmail === principal.email)
                .map(s => s.sessionId)
            );
            if (!pkg.sessionIds.some(sid => operatorSessionIds.has(sid))) {
              return this.json(res, 403, { error: "forbidden", message: "You do not have access to this session package." });
            }
          }
        }

        const payload = service.exportSessionPackage(
          packageId,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, payload);
      } catch (error) {
        const status = /unavailable/i.test(String(error)) ? 501 : 400;
        return this.json(res, status, { error: String(error) });
      }
    }

    const sessionPackageMatch = /^\/api\/session-packages\/([^/]+)$/.exec(url);
    if (sessionPackageMatch && method === "PATCH") {
      try {
        const packageId = decodeURIComponent(sessionPackageMatch[1]!);
        const principal = service.getIamHandler().resolvePrincipalFromCookie(req);
        const authDisabled = (process.env.PRISM_AUTH_DISABLED ?? "").toLowerCase() === "true";
        const isAdmin = authDisabled || (principal ? principal.roles.includes("admin") : true);

        if (!isAdmin && principal) {
          const pkg = service.listSessionPackages().find(p => p.packageId === packageId);
          if (pkg) {
            const operatorSessionIds = new Set(
              service.getChatStore().listSessions()
                .filter(s => s.operatorEmail === principal.email)
                .map(s => s.sessionId)
            );
            if (!pkg.sessionIds.some(sid => operatorSessionIds.has(sid))) {
              return this.json(res, 403, { error: "forbidden", message: "You do not have access to this session package." });
            }
          }
        }

        const body = await service.readJsonBody<{
          title?: string;
          areaOfInterest?: string | null;
          objective?: string | null;
          successCriteria?: string | null;
          dependencies?: string[];
          status?: SessionPackageStatus;
          lastRunAt?: string | null;
          message?: string | null;
          targetSessionId?: string | null;
          historyAction?: any;
        }>(req);
        const pkg = service.updateSessionPackage(packageId, {
          ...body,
          source: req.headers["x-prism-source"]?.toString() || "dashboard_api",
        });
        return this.json(res, 200, { package: pkg });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (sessionPackageMatch && method === "DELETE") {
      try {
        const packageId = decodeURIComponent(sessionPackageMatch[1]!);
        const principal = service.getIamHandler().resolvePrincipalFromCookie(req);
        const authDisabled = (process.env.PRISM_AUTH_DISABLED ?? "").toLowerCase() === "true";
        const isAdmin = authDisabled || (principal ? principal.roles.includes("admin") : true);

        if (!isAdmin && principal) {
          const pkg = service.listSessionPackages().find(p => p.packageId === packageId);
          if (pkg) {
            const operatorSessionIds = new Set(
              service.getChatStore().listSessions()
                .filter(s => s.operatorEmail === principal.email)
                .map(s => s.sessionId)
            );
            if (!pkg.sessionIds.some(sid => operatorSessionIds.has(sid))) {
              return this.json(res, 403, { error: "forbidden", message: "You do not have access to this session package." });
            }
          }
        }

        return this.json(res, 200, service.deleteSessionPackage(
          packageId,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        ));
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    this.json(res, 404, { error: "Not found" });
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data, null, 2));
  }
}
