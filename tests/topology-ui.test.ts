/**
 * Topology UI REST Handler Unit Test Suite — Option 2 & 4
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { handleTopologyRoute } from "../src/core/operator/routes/topology-handler.js";

describe("Topology REST Route Handler (/api/topology)", () => {
    it("returns 200 OK with healthy swarm topology, Covenant digest, and plugin status", () => {
        const req = new EventEmitter() as any;
        req.method = "GET";
        req.url = "/api/topology";

        let responseCode = 0;
        let responseHeaders: Record<string, string> = {};
        let responseBody = "";

        const res = {
            writeHead(code: number, headers: Record<string, string>) {
                responseCode = code;
                responseHeaders = headers;
            },
            end(data: string) {
                responseBody = data;
            },
        } as any;

        handleTopologyRoute(req, res);

        assert.strictEqual(responseCode, 200);
        assert.strictEqual(responseHeaders["Content-Type"], "application/json");

        const parsed = JSON.parse(responseBody);
        assert.strictEqual(parsed.status, "healthy");
        assert.ok(parsed.covenantDigest);
        assert.strictEqual(parsed.agentSwarmTopology.primaryAgent, "CAC Main Agent");
        assert.strictEqual(parsed.agentSwarmTopology.supportAgent, "Guardian Support Agent");
        assert.strictEqual(parsed.plugins.cognitionCycles.id, "prism-plugin-cognition-cycles");
    });

    it("rejects non-GET HTTP methods with 405 Method Not Allowed", () => {
        const req = new EventEmitter() as any;
        req.method = "POST";
        req.url = "/api/topology";

        let responseCode = 0;
        const res = {
            writeHead(code: number) {
                responseCode = code;
            },
            end() {},
        } as any;

        handleTopologyRoute(req, res);

        assert.strictEqual(responseCode, 405);
    });
});
