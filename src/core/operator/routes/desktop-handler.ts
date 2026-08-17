/**
 * @file desktop-handler.ts
 * @description REST API Route Handler for Governed Visual Desktop Sandbox (Phase V).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import { DesktopSandboxManager } from "../desktop-sandbox-manager.js";

// Global singleton instance for the Dashboard runtime
let desktopSandboxManagerInstance: DesktopSandboxManager | null = null;

export function getDesktopSandboxManager(service?: DashboardService): DesktopSandboxManager {
  if (!desktopSandboxManagerInstance) {
    desktopSandboxManagerInstance = new DesktopSandboxManager(
      { mockProvider: process.env.PRISM_MOCK_DESKTOP === "true" || process.env.NODE_ENV === "test" },
      service ? (service as any).activityBus : undefined
    );
  }
  return desktopSandboxManagerInstance;
}

export class DesktopHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    return pathname.startsWith("/api/sandbox/desktop");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const pathname = url.split("?")[0];
    const method = req.method?.toUpperCase() ?? "GET";
    const manager = getDesktopSandboxManager(service);

    // Helper to parse JSON body
    const parseBody = async (): Promise<Record<string, any>> => {
      return new Promise((resolve) => {
        let data = "";
        req.on("data", (chunk) => { data += chunk; });
        req.on("end", () => {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch {
            resolve({});
          }
        });
      });
    };

    try {
      // 1. GET /api/sandbox/desktop/status
      if (method === "GET" && pathname === "/api/sandbox/desktop/status") {
        return this.json(res, 200, { ok: true, status: manager.getStatus() });
      }

      // 1b. GET /api/sandbox/desktop/diagnostics
      if (method === "GET" && pathname === "/api/sandbox/desktop/diagnostics") {
        const diag = await manager.checkDocker();
        return this.json(res, 200, { ok: true, diagnostics: diag, status: manager.getStatus() });
      }

      // 1c. POST /api/sandbox/desktop/toggle-mock
      if (method === "POST" && pathname === "/api/sandbox/desktop/toggle-mock") {
        const body = await parseBody();
        const enable = body.enable !== undefined ? Boolean(body.enable) : !manager.isMockMode();
        manager.setMockMode(enable);
        return this.json(res, 200, { ok: true, isMock: manager.isMockMode(), status: manager.getStatus() });
      }

      // 2. POST /api/sandbox/desktop/start
      if (method === "POST" && pathname === "/api/sandbox/desktop/start") {
        try {
          const status = await manager.startSandbox();
          return this.json(res, 200, { ok: true, message: "Sandbox started", status });
        } catch (err: any) {
          return this.json(res, 200, {
            ok: false,
            error: err?.message || String(err),
            status: manager.getStatus(),
            dockerUnavailable: true
          });
        }
      }

      // 3. POST /api/sandbox/desktop/stop
      if (method === "POST" && pathname === "/api/sandbox/desktop/stop") {
        await manager.stopSandbox();
        return this.json(res, 200, { ok: true, message: "Sandbox stopped", status: manager.getStatus() });
      }

      // 4. POST /api/sandbox/desktop/mode
      if (method === "POST" && pathname === "/api/sandbox/desktop/mode") {
        const body = await parseBody();
        const mode = body.mode === "operator_takeover" ? "operator_takeover" : "autonomous";
        const status = await manager.setControlMode(mode);
        return this.json(res, 200, { ok: true, mode: status.activeMode, status });
      }

      // 5. POST /api/sandbox/desktop/snapshot
      if (method === "POST" && pathname === "/api/sandbox/desktop/snapshot") {
        const body = await parseBody();
        const snapshot = await manager.createSnapshot(body.name || "Checkpoint");
        return this.json(res, 200, { ok: true, snapshot, status: manager.getStatus() });
      }

      // 6. POST /api/sandbox/desktop/revert
      if (method === "POST" && pathname === "/api/sandbox/desktop/revert") {
        const body = await parseBody();
        if (!body.snapshotId) {
          return this.json(res, 400, { ok: false, error: "Missing snapshotId" });
        }
        const status = await manager.revertSnapshot(body.snapshotId);
        return this.json(res, 200, { ok: true, message: "Reverted", status });
      }

      // 7. POST /api/sandbox/desktop/reset
      if (method === "POST" && pathname === "/api/sandbox/desktop/reset") {
        const status = await manager.resetSandbox();
        return this.json(res, 200, { ok: true, message: "Sandbox reset", status });
      }

      // 8. POST /api/sandbox/desktop/screenshot
      if (method === "POST" && pathname === "/api/sandbox/desktop/screenshot") {
        const snap = await manager.captureScreenshot();
        return this.json(res, 200, { ok: true, ...snap });
      }

      // 9. POST /api/sandbox/desktop/burst
      if (method === "POST" && pathname === "/api/sandbox/desktop/burst") {
        const body = await parseBody();
        const burst = await manager.captureBurstFrames(body);
        return this.json(res, 200, { ok: true, burst });
      }

      // 10. POST /api/sandbox/desktop/action
      if (method === "POST" && pathname === "/api/sandbox/desktop/action") {
        const body = await parseBody();
        const actionResult = await manager.executeInputAction(body as any);
        return this.json(res, 200, { ok: actionResult.success, result: actionResult });
      }

      return this.json(res, 404, { ok: false, error: `Endpoint not found: ${pathname}` });
    } catch (err: any) {
      return this.json(res, 500, { ok: false, error: err?.message || String(err) });
    }
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  }
}
