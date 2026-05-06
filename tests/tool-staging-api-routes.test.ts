/**
 * Tool Staging API Route Integration Tests — exercises POST /api/tools/stage
 * endpoint exposed by DashboardService.
 *
 * Spins up a DashboardService on an ephemeral port, makes real HTTP requests,
 * and validates the tool contract extraction pipeline responds correctly.
 *
 * Run via Mocha: mocha dist/tests/tool-staging-api-routes.test.js --timeout 60000
 */
import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { DashboardService } from "../src/core/operator/dashboard-service.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";
import { ToolRegistry } from "../src/core/tools/registry.js";

/* ── Test helpers ─────────────────────────────────────────────────────── */

let service: DashboardService;
let port: number;
let tmpDir: string;

function requestJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: "127.0.0.1",
            port,
            path,
            method,
            headers: body == null ? {} : { "Content-Type": "application/json" },
        }, (res) => {
            let payload = "";
            res.on("data", (chunk: Buffer) => { payload += chunk; });
            res.on("end", () => {
                try { resolve({ status: res.statusCode!, body: JSON.parse(payload || "{}") }); }
                catch { resolve({ status: res.statusCode!, body: payload }); }
            });
        });
        req.on("error", reject);
        if (body != null) req.write(JSON.stringify(body));
        req.end();
    });
}

/* ── Suite ────────────────────────────────────────────────────────────── */

describe("Tool Staging API Routes (POST /api/tools/stage)", function () {
    this.timeout(60_000);

    before(async () => {
        process.env.PRISM_AUTH_DISABLED = "true";
        tmpDir = mkdtempSync(join(tmpdir(), "prism-tool-staging-api-"));
        const bus = new ActivityBus();
        const chatStore = new ChatSessionStore(":memory:");
        const registry = new ToolRegistry();

        service = new DashboardService(
            new ApprovalQueue(),
            bus,
            {
                sessionId: "tool-staging-api-test",
                environmentProfile: "test",
                mode: "server",
                startedAt: new Date().toISOString(),
                executionProfileSegment: "individual",
            },
            chatStore,
            [],
            0,                                           // port = ephemeral
            undefined,                                   // metricsCollector
            undefined,                                   // retrievalDashboardStore
            new InMemoryProviderSecretStore(),            // providerSecretStore
            undefined,                                   // activityStore
            join(tmpDir, "session-packages.json"),        // sessionPackageStorePath
            join(tmpDir, "exports"),                      // sessionPackageExportDir
            registry,                                    // toolRegistry
        );

        service.start();
        await new Promise((resolve) => setTimeout(resolve, 200));
        const addr = (service as unknown as { server: { address(): { port: number } | null } }).server.address();
        port = addr ? addr.port : 0;
        assert.ok(port > 0, "DashboardService should bind to an ephemeral port");
    });

    after(() => {
        service.stop();
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    });

    it("should return 400 when sources is missing", async () => {
        const res = await requestJson("POST", "/api/tools/stage", {});
        assert.strictEqual(res.status, 400);
        assert.ok(res.body.error?.includes("sources"));
    });

    it("should return 400 when sources is empty", async () => {
        const res = await requestJson("POST", "/api/tools/stage", { sources: [] });
        assert.strictEqual(res.status, 400);
        assert.ok(res.body.error?.includes("sources"));
    });

    it("should return 400 for invalid source type", async () => {
        const res = await requestJson("POST", "/api/tools/stage", { sources: ["bogus"] });
        assert.strictEqual(res.status, 400);
        assert.ok(res.body.error?.includes("Invalid source"));
    });

    it("should extract contracts from manifest source", async () => {
        const res = await requestJson("POST", "/api/tools/stage", {
            sources: ["manifest"],
            baseline_comparison: false,
            risk_assessment: true,
            approval_routing: false,
        });
        assert.strictEqual(res.status, 200);
        assert.ok(res.body.request_id, "should have a request_id");
        assert.ok(Array.isArray(res.body.extracted_contracts), "should return extracted_contracts array");
        assert.ok(res.body.status, "should have a status");
    });

    it("should extract contracts from decorator source", async () => {
        const res = await requestJson("POST", "/api/tools/stage", {
            sources: ["decorator"],
        });
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body.extracted_contracts));
    });

    it("should extract contracts from dynamic source", async () => {
        const res = await requestJson("POST", "/api/tools/stage", {
            sources: ["dynamic"],
        });
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body.extracted_contracts));
    });

    it("should extract from multiple sources at once", async () => {
        const res = await requestJson("POST", "/api/tools/stage", {
            sources: ["manifest", "decorator", "dynamic"],
        });
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body.extracted_contracts));
        assert.ok(res.body.status);
    });

    it("should include risk_summary when risk_assessment is enabled", async () => {
        const res = await requestJson("POST", "/api/tools/stage", {
            sources: ["manifest"],
            risk_assessment: true,
        });
        assert.strictEqual(res.status, 200);
        assert.ok(res.body.risk_summary, "should include risk_summary");
    });

    it("GET /api/tools/stage/status returns 400 when tool_id is missing", async () => {
        const res = await requestJson("GET", "/api/tools/stage/status", undefined);
        assert.strictEqual(res.status, 400);
        assert.ok(res.body.error?.includes("tool_id"));
    });

    it("GET /api/tools/stage/status returns 404 for an unknown tool", async () => {
        const res = await requestJson("GET", "/api/tools/stage/status?tool_id=does-not-exist", undefined);
        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.body.tool_id, "does-not-exist");
        assert.strictEqual(res.body.approval_status, "unknown");
    });
});
