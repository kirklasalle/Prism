/**
 * Robotics Add-on Integration Tests — exercises all /api/addons/vrgc-robotics/* REST
 * endpoints exposed by DashboardService via RoboticsHandler.
 *
 * Runs via Mocha: mocha dist/tests/robotics-addon.test.js --timeout 60000
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

let service: DashboardService;
let port: number;
let tmpDir: string;
let chatStore: ChatSessionStore;
let authToken = "";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return authToken ? { Authorization: `Bearer ${authToken}`, ...extra } : { ...extra };
}

function fetchJson(path: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port, path, headers: authHeaders() }, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => {
                data += chunk;
            });
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode!, body: JSON.parse(data || "{}") });
                } catch {
                    resolve({ status: res.statusCode!, body: data });
                }
            });
        }).on("error", reject);
    });
}

function requestJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path,
                method,
                headers: body == null ? authHeaders() : authHeaders({ "Content-Type": "application/json" }),
            },
            (res) => {
                let payload = "";
                res.on("data", (chunk: Buffer) => {
                    payload += chunk;
                });
                res.on("end", () => {
                    try {
                        resolve({ status: res.statusCode!, body: JSON.parse(payload || "{}") });
                    } catch {
                        resolve({ status: res.statusCode!, body: payload });
                    }
                });
            },
        );
        req.on("error", reject);
        if (body != null) req.write(JSON.stringify(body));
        req.end();
    });
}

describe("Robotics Add-on Integration", function () {
    this.timeout(60_000);

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-robotics-addon-"));

        const bus = new ActivityBus();
        chatStore = new ChatSessionStore(":memory:");
        const registry = new ToolRegistry();

        service = new DashboardService(
            new ApprovalQueue(),
            bus,
            {
                sessionId: "robotics-addon-test-session",
                environmentProfile: "test",
                mode: "server",
                startedAt: new Date().toISOString(),
                executionProfileSegment: "individual",
            },
            chatStore,
            [], // actions
            0, // port = ephemeral
            undefined, // metricsCollector
            undefined, // retrievalDashboardStore
            new InMemoryProviderSecretStore(), // providerSecretStore
            undefined, // activityStore
            join(tmpDir, "session-packages.json"), // sessionPackageStorePath
            join(tmpDir, "exports"), // sessionPackageExportDir
            registry, // toolRegistry
        );

        service.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        const addr = (service as unknown as { server: { address(): { port: number } | null } }).server.address();
        port = addr ? addr.port : 0;
        assert.ok(port > 0, "DashboardService should bind to an ephemeral port");

        authToken = service.getAuthGate().getToken();
        assert.ok(authToken.length > 0, "AuthGate should expose an admin token");
    });

    after(async () => {
        await service.stop();
        chatStore.close();

        try {
            rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        } catch {
            /* ignore */
        }
    });

    it("GET /api/addons/vrgc-robotics/entities returns empty array initially", async () => {
        const { status, body } = await fetchJson("/api/addons/vrgc-robotics/entities");
        assert.strictEqual(status, 200);
        assert.ok(Array.isArray(body.entities));
        assert.strictEqual(body.entities.length, 0);
        assert.ok(body.stats);
        assert.strictEqual(body.stats.total, 0);
    });

    it("POST /api/addons/vrgc-robotics/entities creates a new entity", async () => {
        const { status, body } = await requestJson("POST", "/api/addons/vrgc-robotics/entities", {
            entityId: "vrgc-arm-test",
            name: "Robotic Test Arm",
            type: "simulation",
            cognitiveBackend: "brainsim",
        });
        assert.strictEqual(status, 201);
        assert.ok(body.entity);
        assert.strictEqual(body.entity.entityId, "vrgc-arm-test");
        assert.strictEqual(body.entity.name, "Robotic Test Arm");
        assert.strictEqual(body.entity.status, "registered");
        assert.strictEqual(body.entity.cognitiveBackend, "brainsim");
    });

    it("POST /api/addons/vrgc-robotics/entities/vrgc-arm-test/transition updates entity status", async () => {
        const { status, body } = await requestJson("POST", "/api/addons/vrgc-robotics/entities/vrgc-arm-test/transition", {
            status: "provisioned",
        });
        assert.strictEqual(status, 200);
        assert.ok(body.entity);
        assert.strictEqual(body.entity.status, "provisioned");
    });

    it("POST /api/addons/vrgc-robotics/entities/vrgc-arm-test/transition rejects invalid transition", async () => {
        const { status, body } = await requestJson("POST", "/api/addons/vrgc-robotics/entities/vrgc-arm-test/transition", {
            status: "operational", // registered -> provisioned is okay, but provisioned -> operational is not allowed (must go to training first)
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error);
        assert.ok(body.error.includes("Invalid transition"));
    });

    it("GET /api/addons/vrgc-robotics/integrations returns preset bridges", async () => {
        const { status, body } = await fetchJson("/api/addons/vrgc-robotics/integrations");
        assert.strictEqual(status, 200);
        assert.ok(Array.isArray(body.integrations));
        assert.ok(body.integrations.length >= 3);
        const uks = body.integrations.find((i: any) => i.id === "uks-bridge");
        assert.ok(uks);
        assert.strictEqual(uks.name, "UKS (Universal Knowledge Store)");
    });
});
