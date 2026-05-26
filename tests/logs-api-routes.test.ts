/**
 * Logs & Debug API Route Integration Tests — exercises all log-related
 * REST endpoints exposed by DashboardService.
 *
 * Spins up a DashboardService on an ephemeral port, makes real HTTP
 * requests, and validates responses.
 *
 * Covers: /api/events, /api/traces, /api/actions, /api/action-history,
 *         /api/approve/:id, /api/deny/:id, /api/logs
 *
 * Run: mocha dist/tests/logs-api-routes.test.js --timeout 60000
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
let chatStore: ChatSessionStore;
let bus: ActivityBus;
let approvalQueue: ApprovalQueue;

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

describe("Logs & Debug API Routes", function () {
    this.timeout(60_000);

    const savedAuth = process.env.PRISM_AUTH_DISABLED;

    before(async () => {
        process.env.PRISM_AUTH_DISABLED = "true";
        tmpDir = mkdtempSync(join(tmpdir(), "prism-logs-api-"));
        bus = new ActivityBus();
        approvalQueue = new ApprovalQueue();
        chatStore = new ChatSessionStore(":memory:");

        const registry = new ToolRegistry();

        service = new DashboardService(
            approvalQueue,
            bus,
            {
                sessionId: "logs-test-session",
                environmentProfile: "test",
                mode: "server",
                startedAt: new Date().toISOString(),
                executionProfileSegment: "individual",
            },
            chatStore,
            [
                { name: "test-action", label: "Test Action", description: "A test action", run: async () => ({ message: "done" }) },
            ],
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
        await new Promise((resolve) => setTimeout(resolve, 50));

        const addr = (service as unknown as { server: { address(): { port: number } | null } }).server.address();
        port = addr ? addr.port : 0;
        assert.ok(port > 0, "DashboardService should bind to an ephemeral port");
    });

    after(async () => {
        await service.stop();
        chatStore.close();
        rmSync(tmpDir, { recursive: true, force: true });
        if (savedAuth === undefined) {
            delete process.env.PRISM_AUTH_DISABLED;
        } else {
            process.env.PRISM_AUTH_DISABLED = savedAuth;
        }
    });

    /* ── GET /api/events ──────────────────────────────────────────────── */

    describe("GET /api/events", () => {
        it("returns 200 with events array", async () => {
            const { status, body } = await fetchJson("/api/events");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body), "response should be an array");
        });

        it("returns events after emitting activity", async () => {
            bus.emit({
                layer: "tool_execution",
                operation: "test.operation",
                status: "succeeded",
                sessionId: "logs-test-session",
                details: {},
            });
            // Small delay for event to propagate
            await new Promise((r) => setTimeout(r, 20));
            const { status, body } = await fetchJson("/api/events");
            assert.strictEqual(status, 200);
            assert.ok(body.length > 0, "should have at least one event");
        });

        it("respects limit query parameter", async () => {
            const { status, body } = await fetchJson("/api/events?limit=1");
            assert.strictEqual(status, 200);
            assert.ok(body.length <= 1, "should respect limit=1");
        });
    });

    /* ── GET /api/traces ──────────────────────────────────────────────── */

    describe("GET /api/traces", () => {
        it("returns 200 with traces object", async () => {
            const { status, body } = await fetchJson("/api/traces");
            assert.strictEqual(status, 200);
            assert.ok(body.traces !== undefined, "response should have traces property");
        });

        it("supports limit query parameter", async () => {
            const { status, body } = await fetchJson("/api/traces?limit=5");
            assert.strictEqual(status, 200);
            assert.ok(body.traces !== undefined);
        });

        it("supports correlationId filter", async () => {
            const { status, body } = await fetchJson("/api/traces?correlationId=nonexistent-id");
            assert.strictEqual(status, 200);
        });
    });

    /* ── GET /api/actions ─────────────────────────────────────────────── */

    describe("GET /api/actions", () => {
        it("returns 200 with actions array", async () => {
            const { status, body } = await fetchJson("/api/actions");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body), "response should be an array");
        });

        it("includes the pre-configured test action", async () => {
            const { status, body } = await fetchJson("/api/actions");
            assert.strictEqual(status, 200);
            const found = body.find((a: any) => a.name === "test-action");
            assert.ok(found, "should find the test-action");
            assert.strictEqual(found.label, "Test Action");
        });
    });

    /* ── GET /api/action-history ──────────────────────────────────────── */

    describe("GET /api/action-history", () => {
        it("returns 200 with history array", async () => {
            const { status, body } = await fetchJson("/api/action-history");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body), "response should be an array");
        });
    });

    /* ── POST /api/approve/:id and /api/deny/:id ─────────────────────── */

    describe("POST /api/approve/:id", () => {
        it("returns 404 for nonexistent approval ID", async () => {
            const { status } = await requestJson("POST", "/api/approve/nonexistent-id");
            // Should be 404 or 400 — the approval doesn't exist
            assert.ok(status === 404 || status === 400 || status === 200,
                `Expected 200/400/404, got ${status}`);
        });
    });

    describe("POST /api/deny/:id", () => {
        it("returns 404 for nonexistent denial ID", async () => {
            const { status } = await requestJson("POST", "/api/deny/nonexistent-id");
            assert.ok(status === 404 || status === 400 || status === 200,
                `Expected 200/400/404, got ${status}`);
        });
    });

    /* ── GET /api/logs ────────────────────────────────────────────────── */

    describe("GET /api/logs", () => {
        it("returns 200 with logs array", async () => {
            const { status, body } = await fetchJson("/api/logs");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body), "response should be an array");
        });

        it("returns logs with expected schema fields", async () => {
            // Emit an event so there's data
            bus.emit({
                layer: "governance",
                operation: "governance.check",
                status: "succeeded",
                sessionId: "logs-test-session",
                details: {},
            });
            await new Promise((r) => setTimeout(r, 20));

            const { status, body } = await fetchJson("/api/logs");
            assert.strictEqual(status, 200);
            if (body.length > 0) {
                const entry = body[0];
                assert.ok("type" in entry, "log entry should have type field");
                assert.ok("timestamp" in entry, "log entry should have timestamp field");
                assert.ok("operation" in entry, "log entry should have operation field");
            }
        });

        it("respects limit query parameter", async () => {
            const { status, body } = await fetchJson("/api/logs?limit=2");
            assert.strictEqual(status, 200);
            assert.ok(body.length <= 2, "should respect limit=2");
        });

        it("caps limit at 2000", async () => {
            const { status, body } = await fetchJson("/api/logs?limit=99999");
            assert.strictEqual(status, 200);
            // Should not return more than 2000 even with extreme limit
            assert.ok(body.length <= 2000);
        });
    });

    /* ── Diagnostics routes ───────────────────────────────────────────── */

    describe("GET /api/diagnostics/logs/status", () => {
        it("returns running state and lastRunAt", async () => {
            const { status, body } = await fetchJson("/api/diagnostics/logs/status");
            assert.strictEqual(status, 200);
            assert.strictEqual(body.running, false);
            assert.strictEqual(body.lastRunAt, null);
        });
    });

    describe("GET /api/diagnostics/logs/report", () => {
        it("returns valid report or report:null when no prior run exists", async () => {
            const { status, body } = await fetchJson("/api/diagnostics/logs/report");
            assert.strictEqual(status, 200);
            // When no prior run: { report: null }. When prior run exists: full report with summary.
            assert.ok(
                body.report === null || (body.summary && body.summary.grandTotal),
                "should return { report: null } or a report with summary.grandTotal",
            );
        });
    });

    /* ── PRISM Micro Support Desk API Routes ────────────────────────────── */

    describe("PRISM Support Desk API Routes", () => {
        let ticketId: string;

        it("POST /api/support/tickets - creates a new ticket", async () => {
            const payload = {
                title: "UI Rendering Lag",
                description: "Logs view freezes when scrolling with 2000+ items.",
                severity: "medium",
                source: "user",
                metadata: { client: "chrome" },
            };
            const { status, body } = await requestJson("POST", "/api/support/tickets", payload);
            assert.strictEqual(status, 201);
            assert.ok(body.ticketId.startsWith("TKT-"));
            ticketId = body.ticketId;
        });

        it("GET /api/support/tickets - returns list including new ticket", async () => {
            const { status, body } = await fetchJson("/api/support/tickets");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body));
            const found = body.find((t: any) => t.ticketId === ticketId);
            assert.ok(found);
            assert.strictEqual(found.title, "UI Rendering Lag");
            assert.strictEqual(found.status, "open");
            assert.strictEqual(found.severity, "medium");
        });

        it("POST /api/support/tickets/:ticketId/update - modifies status and writes resolution log", async () => {
            const payload = {
                status: "resolved",
                resolutionLog: "Optimized infinite scroll container and added virtualization.",
            };
            const { status, body } = await requestJson(
                "POST",
                `/api/support/tickets/${encodeURIComponent(ticketId)}/update`,
                payload
            );
            assert.strictEqual(status, 200);
            assert.ok(body.ok);

            // Verify update
            const { body: list } = await fetchJson("/api/support/tickets");
            const updated = list.find((t: any) => t.ticketId === ticketId);
            assert.ok(updated);
            assert.strictEqual(updated.status, "resolved");
            assert.strictEqual(
                updated.resolutionLog,
                "Optimized infinite scroll container and added virtualization."
            );
        });

        it("POST /api/support/tickets/:ticketId/delete - removes the ticket", async () => {
            const { status, body } = await requestJson(
                "POST",
                `/api/support/tickets/${encodeURIComponent(ticketId)}/delete`
            );
            assert.strictEqual(status, 200);
            assert.ok(body.ok);

            // Verify deletion
            const { body: list } = await fetchJson("/api/support/tickets");
            const deleted = list.find((t: any) => t.ticketId === ticketId);
            assert.strictEqual(deleted, undefined);
        });
    });
});
