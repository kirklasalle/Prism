import type { IncomingMessage, ServerResponse } from "node:http";
import type { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";

export class TooltipsHandler implements IRouteHandler {
    match(req: IncomingMessage): boolean {
        const url = req.url ?? "";
        return url.startsWith("/api/tooltips/") || url === "/api/tooltips";
    }

    async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const rawUrl = req.url ?? "";
        const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
        const method = req.method?.toUpperCase() ?? "GET";

        if (method === "GET" && url === "/api/tooltips") {
            const registry = service.getTooltipsRegistry();
            return this.json(res, 200, { tips: registry.list() });
        }

        if (method === "GET" && url.startsWith("/api/tooltips/")) {
            const tipId = decodeURIComponent(url.slice("/api/tooltips/".length).split("?")[0] ?? "");
            if (!tipId) {
                return this.json(res, 400, { error: "Missing tipId" });
            }
            const registry = service.getTooltipsRegistry();
            const entry = registry.get(tipId);
            if (!entry) {
                // Return 200 with found:false instead of 404 so the browser's
                // network log doesn't redline for tips that are intentionally
                // client-only (e.g. 'chat:header' lives in tab-chat-tooltips.js).
                // The client (prism-tooltips.js) treats absent server data as
                // "no server tip" and falls back to lore/static layers.
                return this.json(res, 200, { tipId, found: false });
            }
            return this.json(res, 200, entry);
        }

        return this.json(res, 405, { error: "Method not allowed" });
    }

    private json(res: ServerResponse, status: number, body: unknown): void {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(body));
    }
}
