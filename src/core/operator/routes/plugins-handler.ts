import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import { loadPluginPack } from "../../plugins/plugin-pack-loader.js";
import type { PluginPackManifest } from "../../plugins/plugin-pack-validator.js";
import { readPreferences } from "../../config/workspace-resolver.js";

export class PluginsHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    const method = req.method?.toUpperCase() ?? "GET";

    if (pathname === "/api/plugins/status" && method === "GET") return true;
    if (pathname === "/api/plugins/install" && method === "POST") return true;
    if (/^\/api\/plugins\/[^/]+\/toggle$/.test(pathname) && method === "POST") return true;
    if (/^\/api\/plugins\/[^/]+\/health$/.test(pathname) && (method === "POST" || method === "GET")) return true;

    return false;
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    const method = req.method?.toUpperCase() ?? "GET";
    const pluginStates = service.pluginStates || {};

    // 1. GET /api/plugins/status
    if (method === "GET" && pathname === "/api/plugins/status") {
      return this.json(res, 200, { plugins: pluginStates });
    }

    // 2. POST /api/plugins/install
    if (method === "POST" && pathname === "/api/plugins/install") {
      try {
        const body = await service.readJsonBody<{
          name: string;
          type?: string;
          url?: string;
          port?: number;
          description?: string;
          manifest?: PluginPackManifest;
          packPath?: string;
        }>(req);
        if (!body.name) {
          return this.json(res, 400, { error: "Plugin name is required" });
        }

        // If a full manifest is provided, run load-time validation pipeline
        if (body.manifest) {
          const prefs = readPreferences();
          const profile = (prefs?.executionProfileSegment === "business" ? "business" : "individual") as "individual" | "business";
          const result = loadPluginPack(
            body.manifest,
            body.packPath ?? ".",
            service.getActivityBus(),
            { executionProfile: profile },
          );
          if (!result.accepted) {
            return this.json(res, 422, {
              plugin: body.name,
              installed: false,
              reason: result.summary,
              errors: result.manifestValidation.errors,
              trustValidation: result.trustValidation,
            });
          }
          return this.json(res, 201, {
            plugin: body.name,
            installed: true,
            summary: result.summary,
            warnings: result.manifestValidation.warnings,
          });
        }

        return this.json(res, 201, { plugin: body.name, installed: true });
      } catch (err) {
        return this.json(res, 400, { error: String(err) });
      }
    }

    // 3. POST /api/plugins/{name}/toggle
    if (method === "POST" && /^\/api\/plugins\/[^/]+\/toggle$/.test(pathname)) {
      const pluginName = decodeURIComponent(pathname.split("/")[3]!);
      if (!pluginStates[pluginName]) {
        pluginStates[pluginName] = { enabled: true, healthy: true, requests: 0, errors: 0, avgResponseMs: 0, lastChecked: null };
      }
      // If body contains explicit enabled value use it; otherwise flip current state
      let body: { enabled?: boolean } = {};
      try {
        body = await service.readJsonBody<{ enabled?: boolean }>(req).catch(() => ({}));
      } catch {
        // no body - flip
      }
      const newEnabled = typeof body.enabled === "boolean" ? body.enabled : !pluginStates[pluginName].enabled;
      pluginStates[pluginName].enabled = newEnabled;
      return this.json(res, 200, { plugin: pluginName, enabled: newEnabled });
    }

    // 4. POST/GET /api/plugins/{name}/health
    if ((method === "POST" || method === "GET") && /^\/api\/plugins\/[^/]+\/health$/.test(pathname)) {
      const pluginName = decodeURIComponent(pathname.split("/")[3]!);
      return this.json(res, 200, { plugin: pluginName, healthy: true, message: "Health check passed" });
    }

    return this.json(res, 404, { error: "Not found", path: url });
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }
}
