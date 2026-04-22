import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import { DashboardService } from "../dashboard-service.js";
import { setupWizardHtml, setupWizardAdvancedHtml } from "../templates/index.js";

export class SetupHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const method = req.method?.toUpperCase() ?? "GET";
    return method === "GET" && (url === "/setup" || url === "/setup/advanced" || url.startsWith("/setup?") || url.startsWith("/setup/advanced?"));
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const url = req.url ?? "";
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    if (url.startsWith("/setup/advanced")) {
      res.end(setupWizardAdvancedHtml(service.getPort()));
    } else {
      res.end(setupWizardHtml(service.getPort()));
    }
  }
}
