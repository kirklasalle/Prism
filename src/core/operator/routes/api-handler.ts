import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { IRouteHandler } from "./types.js";
import { DashboardService } from "../dashboard-service.js";
import { resolveWorkspaceRoot } from "../../config/workspace-resolver.js";
import { PRISM_VERSION } from "../../version.js";
import {
  DIRECTIVE_SHA256,
  DIRECTIVE_HASH_LAST_GENERATED_AT,
  verifyDirectiveIntegrity,
} from "../../security/directive-integrity.js";
import { probeOptionalDeps, summarizeOptionalDeps } from "../../system/optional-deps.js";

export class ApiHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const method = req.method?.toUpperCase() ?? "GET";
    // Only intercept the specific routes this handler owns — do NOT use a broad prefix
    // so that other modular handlers and the inline DashboardService routes remain reachable.
    return method === "GET" && (
      url === "/api/health" || url === "/health" ||
      url === "/api/health/extended" ||
      url === "/api/status" ||
      url === "/api/system/adapters"
    );
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    // Normalize /api/v1/* → /api/* for consistent handler matching
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    if (method === "GET" && (url === "/api/health" || url === "/health")) {
      const dbOk = this.checkDb(service);
      const providerCount = service.getChatStore().listProviderSettings().length;
      const directive = verifyDirectiveIntegrity();
      const optionalDeps = await probeOptionalDeps();
      const depSummary = summarizeOptionalDeps(optionalDeps);
      const isProduction = (process.env.NODE_ENV ?? "").toLowerCase() === "production";
      const jwtSecretLen = (process.env.PRISM_JWT_SECRET ?? "").length;
      const authDisabled = (process.env.PRISM_AUTH_DISABLED ?? "").toLowerCase() === "true";
      const overallOk = dbOk && directive.valid && (!isProduction || (jwtSecretLen >= 32 && !authDisabled));

      this.json(res, overallOk ? 200 : 503, {
        status: overallOk ? "ok" : "degraded",
        version: PRISM_VERSION,
        uptime: Math.floor(process.uptime()),
        sessionId: service.getRuntimeStatus().sessionId,
        mode: service.getRuntimeStatus().mode,
        nodeEnv: process.env.NODE_ENV ?? "development",
        dependencies: {
          db: dbOk ? "ok" : "unavailable",
          providers: providerCount,
          pending_approvals: service.getApprovalQueue().list().length,
        },
        directive: {
          valid: directive.valid,
          expectedHash: directive.expectedHash,
          currentHash: directive.currentHash,
          hashGeneratedAt: DIRECTIVE_HASH_LAST_GENERATED_AT,
          filePath: directive.filePath,
          error: directive.error ?? null,
        },
        optionalDeps: {
          summary: depSummary,
          modules: optionalDeps,
        },
        security: {
          productionMode: isProduction,
          authDisabled,
          jwtSecretConfigured: jwtSecretLen >= 32,
          jwtSecretLength: jwtSecretLen,
        },
      });
      // Reference DIRECTIVE_SHA256 to ensure the import is retained even if
      // tree-shaking changes downstream — the constant must always load.
      void DIRECTIVE_SHA256;
      return;
    }

    if (method === "GET" && url === "/api/health/extended") {
      // R6-2 — Health widget endpoint. Auth-gated (this handler is mounted
      // behind the dashboard auth chain via the standard route table); the
      // payload exposes per-process counters that the dashboard's Health
      // card polls every 10 s. Public surface stays `/api/health` and
      // `/metrics`.
      const mem = process.memoryUsage();
      const dbSize = this.measureWorkspaceDbSize();
      const status = service.getRuntimeStatus();
      const startedAtMs = Date.parse(status.startedAt);
      const uptimeS = Number.isFinite(startedAtMs) ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)) : Math.floor(process.uptime());
      this.json(res, 200, {
        status: "ok",
        version: PRISM_VERSION,
        uptimeS,
        process: {
          heapMb: Math.round((mem.heapUsed / 1_048_576) * 100) / 100,
          heapTotalMb: Math.round((mem.heapTotal / 1_048_576) * 100) / 100,
          rssMb: Math.round((mem.rss / 1_048_576) * 100) / 100,
          externalMb: Math.round((mem.external / 1_048_576) * 100) / 100,
        },
        sessions: service.getChatStore().listSessions().length,
        pendingApprovals: service.getApprovalQueue().list().length,
        dbSizeMb: dbSize,
        nodeEnv: process.env.NODE_ENV ?? "development",
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

  /**
   * R6-2 — Total bytes of all `.db` / `.sqlite` files under the workspace
   * root, returned in MiB (rounded to 2 dp). Best-effort; on any I/O error
   * returns 0 rather than failing the health endpoint.
   */
  private measureWorkspaceDbSize(): number {
    let total = 0;
    try {
      const root = resolveWorkspaceRoot();
      if (!existsSync(root)) return 0;
      const stack: string[] = [root];
      // Bound the walk so a misconfigured workspace root cannot stall the
      // request — 5000 directory entries is far above any realistic PRISM
      // workspace.
      let visited = 0;
      while (stack.length > 0 && visited < 5000) {
        const dir = stack.pop()!;
        let entries: string[] = [];
        try { entries = readdirSync(dir); } catch { continue; }
        for (const name of entries) {
          visited++;
          const full = join(dir, name);
          let st;
          try { st = statSync(full); } catch { continue; }
          if (st.isDirectory()) {
            // Skip well-known noisy subtrees that never hold DB files.
            if (name === "node_modules" || name === ".git") continue;
            stack.push(full);
          } else if (st.isFile() && /\.(db|sqlite|sqlite3)$/i.test(name)) {
            total += st.size;
          }
        }
      }
    } catch {
      return 0;
    }
    return Math.round((total / 1_048_576) * 100) / 100;
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }
}
