import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import * as registry from "../../../../addons/prism-addon-vrgc-robotics/src/adapter/robotics-entity-registry.js";
import type { RoboticsEntityStatus } from "../../addons/types.js";

export class RoboticsHandler implements IRouteHandler {
    match(req: IncomingMessage): boolean {
        const url = req.url ?? "";
        const pathname = url.split("?")[0];
        const method = req.method?.toUpperCase() ?? "GET";

        if (pathname === "/api/addons/vrgc-robotics/entities" && (method === "GET" || method === "POST")) return true;
        if (pathname === "/api/addons/vrgc-robotics/integrations" && method === "GET") return true;
        if (/^\/api\/addons\/vrgc-robotics\/entities\/[^/]+\/transition$/.test(pathname) && method === "POST")
            return true;

        return false;
    }

    async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const url = req.url ?? "";
        const pathname = url.split("?")[0];
        const method = req.method?.toUpperCase() ?? "GET";

        // 1. GET /api/addons/vrgc-robotics/entities
        if (method === "GET" && pathname === "/api/addons/vrgc-robotics/entities") {
            const entities = registry.getAllEntities();
            const stats = registry.getRegistryStats();
            return this.json(res, 200, { entities, stats });
        }

        // 2. POST /api/addons/vrgc-robotics/entities
        if (method === "POST" && pathname === "/api/addons/vrgc-robotics/entities") {
            try {
                const body = await service.readJsonBody<{
                    entityId: string;
                    name: string;
                    type: "physical" | "virtual" | "simulation";
                    cognitiveBackend?: "llm" | "brainsim" | "hybrid";
                    mcpEndpoint?: string;
                    characterId?: string;
                }>(req);

                if (!body.entityId || !body.name) {
                    return this.json(res, 400, { error: "entityId and name are required" });
                }

                const entity = registry.registerEntity({
                    entityId: body.entityId,
                    name: body.name,
                    type: body.type,
                    cognitiveBackend: body.cognitiveBackend,
                    mcpEndpoint: body.mcpEndpoint,
                    characterId: body.characterId,
                });

                return this.json(res, 201, { entity });
            } catch (err) {
                return this.json(res, 400, { error: String(err) });
            }
        }

        // 3. GET /api/addons/vrgc-robotics/integrations
        if (method === "GET" && pathname === "/api/addons/vrgc-robotics/integrations") {
            const integrations = registry.getIntegrations();
            return this.json(res, 200, { integrations });
        }

        // 4. POST /api/addons/vrgc-robotics/entities/{id}/transition
        if (method === "POST" && /^\/api\/addons\/vrgc-robotics\/entities\/[^/]+\/transition$/.test(pathname)) {
            try {
                const entityId = decodeURIComponent(pathname.split("/")[5]!);
                const body = await service.readJsonBody<{ status: RoboticsEntityStatus }>(req);

                if (!body.status) {
                    return this.json(res, 400, { error: "status is required" });
                }

                const entity = registry.transitionEntity(entityId, body.status);
                return this.json(res, 200, { entity });
            } catch (err) {
                return this.json(res, 400, { error: String(err) });
            }
        }

        return this.json(res, 404, { error: "Not found", path: url });
    }

    private json(res: ServerResponse, status: number, data: any): void {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(data));
    }
}
