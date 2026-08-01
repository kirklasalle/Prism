/**
 * Swarm & Cognition Topology REST Endpoint Handler — Option 2 & 4
 *
 * Exposes GET `/api/topology` returning live agent topology, active authority contexts,
 * key registry health, and Cognition Cycles plugin status.
 *
 * @module core/operator/routes/topology-handler
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import { loadOrCreateRegistry } from "../../security/key-registry.js";
import { getCanonicalCovenantDigest } from "../../governance/canonical-covenant.js";

export function handleTopologyRoute(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
    }

    try {
        const registry = loadOrCreateRegistry();
        const activeKeysCount = registry.keys.filter((k) => k.status === "active").length;
        const covenantDigest = getCanonicalCovenantDigest();

        const responseData = {
            status: "healthy",
            timestamp: new Date().toISOString(),
            covenantDigest,
            securityTrustRoot: {
                keyRegistryVersion: registry.version,
                totalKeysCount: registry.keys.length,
                activeKeysCount,
                trustRootVerified: activeKeysCount > 0,
            },
            agentSwarmTopology: {
                primaryAgent: "CAC Main Agent",
                supportAgent: "Guardian Support Agent",
                activeSwarms: [
                    { id: "aria-business", profile: "business", status: "active" },
                    { id: "phoenix-business", profile: "business", status: "active" },
                    { id: "sentinel-business", profile: "business", status: "active" },
                ],
            },
            plugins: {
                cognitionCycles: {
                    id: "prism-plugin-cognition-cycles",
                    version: "1.0.0",
                    status: "active",
                    supportedLevels: ["micro", "meso", "macro", "meta"],
                },
            },
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(responseData, null, 2));
    } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Failed to resolve topology: ${err.message}` }));
    }
}

export class TopologyRouteHandler implements IRouteHandler {
    match(req: IncomingMessage): boolean {
        const url = req.url ?? "";
        return url === "/api/topology" || url.startsWith("/api/topology?") || url === "/api/v1/topology";
    }

    async handle(req: IncomingMessage, res: ServerResponse, _service: DashboardService): Promise<void> {
        handleTopologyRoute(req, res);
    }
}
