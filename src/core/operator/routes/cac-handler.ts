import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";

export class CacHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = (req.url ?? "").split("?")[0];
    const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
    return normalized.startsWith("/api/cac");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";
    const manager = service.getCharacterAccountabilityManager();

    // 1. GET /api/cac/assignments
    if (method === "GET" && url === "/api/cac/assignments") {
      try {
        const audit = manager.exportAudit({});
        return this.json(res, 200, { assignments: audit });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // 2. GET /api/cac/assignments/:id/chain
    if (method === "GET" && /^\/api\/cac\/assignments\/[^/]+\/chain$/.test(url)) {
      const assignmentId = decodeURIComponent(url.split("/")[4]!);
      const chain = manager.getAssignmentChain(assignmentId);
      if (!chain) {
        return this.json(res, 404, { error: "Unknown assignment", assignmentId });
      }
      return this.json(res, 200, chain);
    }

    // 3. GET /api/cac/export
    if (method === "GET" && url.startsWith("/api/cac/export")) {
      try {
        const isCsv = /[?&]format=csv\b/.test(rawUrl);
        const audit = manager.exportAudit({});
        if (isCsv) {
          const headers = [
            "assignmentId", "characterId", "operatorId", "operatorEmail", "prismUserEmail",
            "executionProfileSegment", "state", "assignedAt", "updatedAt", "dispatchCount",
            "scopesActive", "scopesExpired", "emailVerifiedAt", "emailVerifiedProvider",
          ];
          const escape = (v: unknown) => {
            const s = v == null ? "" : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          };
          const lines = [headers.join(",")];
          for (const row of audit) {
            lines.push(headers.map((h) => escape((row as Record<string, unknown>)[h])).join(","));
          }
          res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="cac-audit-${Date.now()}.csv"`,
          });
          res.end(lines.join("\n"));
          return;
        }
        return this.json(res, 200, { assignments: audit, exportedAt: new Date().toISOString() });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // 4. POST /api/cac/:id/verify-email
    if (method === "POST" && /^\/api\/cac\/[^/]+\/verify-email$/.test(url)) {
      const assignmentId = decodeURIComponent(url.split("/")[3]!);
      try {
        const body = await service.readJsonBody<{ provider?: "gmail" | "outlook"; verifiedEmail?: string }>(req);
        const provider = body?.provider;
        const email = body?.verifiedEmail;
        if (!provider || !email) {
          return this.json(res, 400, { error: "Missing required fields", required: ["provider", "verifiedEmail"] });
        }
        const updated = manager.markEmailVerified(assignmentId, email, provider);
        if (!updated) {
          return this.json(res, 409, { error: "Verification rejected (assignment missing/revoked or email mismatch)" });
        }
        return this.json(res, 200, { assignment: updated });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Verification failed";
        return this.json(res, 400, { error: "Verification failed", detail: msg });
      }
    }

    return this.json(res, 404, { error: "Not found", path: url });
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data, null, 2));
  }
}
