import type { IncomingMessage, ServerResponse } from "node:http";
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
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }
}
