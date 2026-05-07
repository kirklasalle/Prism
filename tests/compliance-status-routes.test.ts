/**
 * Compliance & Retention status route integration tests.
 *
 * Boots a real DashboardService on an ephemeral port and asserts that
 * `/api/compliance/soc2/status` and `/api/activity/retention/status`
 * return the expected default-off shapes.
 *
 * Run via Mocha: mocha dist/tests/compliance-status-routes.test.js --timeout 60000
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

let service: DashboardService;
let port: number;
let tmpDir: string;
let chatStore: ChatSessionStore;

function fetchJson(path: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port, path }, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => { data += chunk; });
            res.on("end", () => {
                try { resolve({ status: res.statusCode!, body: JSON.parse(data || "{}") }); }
                catch { resolve({ status: res.statusCode!, body: data }); }
            });
        }).on("error", reject);
    });
}

describe("Compliance & Retention status routes", function () {
    this.timeout(60_000);

    before(async () => {
        process.env.PRISM_AUTH_DISABLED = "true";
        // Ensure both subsystems are off for this suite.
        delete process.env.PRISM_SOC2_EXPORTER;
        delete process.env.PRISM_ACTIVITY_RETENTION_DAYS;

        tmpDir = mkdtempSync(join(tmpdir(), "prism-compliance-status-"));
        const bus = new ActivityBus();
        chatStore = new ChatSessionStore(":memory:");

        service = new DashboardService(
            new ApprovalQueue(),
            bus,
            {
                sessionId: "compliance-status-test",
                environmentProfile: "test",
                mode: "server",
                startedAt: new Date().toISOString(),
                executionProfileSegment: "individual",
            },
            chatStore,
            [],
            0,
            undefined,
            undefined,
            new InMemoryProviderSecretStore(),
            undefined,
            join(tmpDir, "session-packages.json"),
            join(tmpDir, "exports"),
        );

        service.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const addr = (service as unknown as { server: { address(): { port: number } | null } }).server.address();
        port = addr ? addr.port : 0;
        assert.ok(port > 0, "DashboardService should bind to an ephemeral port");
    });

    after(async () => {
        await service.stop();
        chatStore.close();
        rmSync(tmpDir, { recursive: true, force: true });
        delete process.env.PRISM_AUTH_DISABLED;
    });

    describe("SOC 2 exporter status", () => {
        it("GET /api/compliance/soc2/status returns enabled:false by default", async () => {
            const { status, body } = await fetchJson("/api/compliance/soc2/status");
            assert.strictEqual(status, 200);
            assert.strictEqual(body.enabled, false);
            assert.strictEqual(body.mode, "off");
            assert.strictEqual(body.running, false);
            assert.strictEqual(body.totalEvents, 0);
            assert.strictEqual(body.droppedEvents, 0);
            assert.strictEqual(body.lastEventAt, null);
        });

        it("response shape is JSON-serializable and stable", async () => {
            const { body } = await fetchJson("/api/compliance/soc2/status");
            // Must round-trip through JSON without loss.
            assert.deepStrictEqual(JSON.parse(JSON.stringify(body)), body);
            // Field set is closed (no undefined leaks).
            for (const key of Object.keys(body)) {
                assert.notStrictEqual(body[key], undefined, `field ${key} must not be undefined`);
            }
        });
    });

    describe("Activity retention status", () => {
        it("GET /api/activity/retention/status returns enabled:false when env unset", async () => {
            const { status, body } = await fetchJson("/api/activity/retention/status");
            assert.strictEqual(status, 200);
            assert.strictEqual(body.enabled, false);
        });
    });
});
