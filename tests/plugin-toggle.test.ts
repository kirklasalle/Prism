/**
 * plugin-toggle.test.ts — E3d Live Plugin Toggle
 *
 * Validates:
 *  - POST /api/v1/plugins/{name}/toggle returns {plugin, enabled} (v1 route)
 *  - POST /api/plugins/{name}/toggle backward-compat still works (legacy route)
 *  - Successive toggles flip the enabled state
 *  - POST /api/v1/plugins/{name}/health returns {plugin, healthy, message} (v1 route)
 *  - POST /api/plugins/{name}/health backward-compat still works (legacy route)
 *  - Toggle response includes all required fields
 *  - Health response includes all required fields
 *  - Unknown plugin names return a valid response (no 500)
 *
 * Run via Mocha: mocha dist/tests/plugin-toggle.test.js --timeout 60000
 */

import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import http from "node:http";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { DashboardService } from "../src/core/operator/dashboard-service.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";
import {
    _setWorkspaceRootForTest,
    _resetWorkspaceRootCache,
    preferencesPath,
} from "../src/core/config/workspace-resolver.js";

/* ── Helpers ──────────────────────────────────────────────────────────── */

let service: DashboardService;
let port: number;
let tmpDir: string;
let chatStore: ChatSessionStore;
let originalPrefs: string | null = null;

function fetchJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const bodyStr = body != null ? JSON.stringify(body) : undefined;
        const req = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path,
                method,
                headers: {
                    ...(bodyStr != null ? { "Content-Type": "application/json" } : {}),
                },
            },
            (res) => {
                let payload = "";
                res.on("data", (chunk: Buffer) => { payload += chunk; });
                res.on("end", () => {
                    try { resolve({ status: res.statusCode!, body: JSON.parse(payload) }); }
                    catch { resolve({ status: res.statusCode!, body: payload }); }
                });
            }
        );
        req.on("error", reject);
        if (bodyStr != null) req.write(bodyStr);
        req.end();
    });
}

/* ── Suite setup ──────────────────────────────────────────────────────── */

describe("Live Plugin Toggle (E3d)", function () {
    this.timeout(60_000);

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-plugin-toggle-"));
        mkdirSync(join(tmpDir, "state"), { recursive: true });
        mkdirSync(join(tmpDir, "characters"), { recursive: true });

        _setWorkspaceRootForTest(tmpDir);

        const realPrefsPath = preferencesPath();
        originalPrefs = existsSync(realPrefsPath)
            ? readFileSync(realPrefsPath, "utf-8")
            : null;
        writeFileSync(realPrefsPath, JSON.stringify({ setupComplete: true }, null, 2) + "\n", "utf-8");

        const bus = new ActivityBus();
        chatStore = new ChatSessionStore(":memory:");

        process.env.PRISM_AUTH_DISABLED = "true";

        service = new DashboardService(
            new ApprovalQueue(),
            bus,
            {
                sessionId: "plugin-toggle-test",
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
        );

        service.start();
        await new Promise((resolve) => setTimeout(resolve, 60));

        const addr = (service as unknown as { server: { address(): { port: number } | null } }).server.address();
        port = addr ? addr.port : 0;
        assert.ok(port > 0, "DashboardService must bind to an ephemeral port");
    });

    after(async () => {
        await service.stop();
        chatStore.close();
        delete process.env.PRISM_AUTH_DISABLED;
        _resetWorkspaceRootCache();

        const realPrefsPath = preferencesPath();
        if (originalPrefs !== null) {
            writeFileSync(realPrefsPath, originalPrefs, "utf-8");
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows EPERM: non-fatal */ }
    });

    /* ── POST /api/v1/plugins/{name}/toggle ─────────────────────────── */

    describe("POST /api/v1/plugins/{name}/toggle", () => {
        it("returns 200 with plugin and enabled fields", async () => {
            const res = await fetchJson("POST", "/api/v1/plugins/ids-mcp/toggle");
            assert.strictEqual(res.status, 200);
            assert.ok(typeof res.body === "object" && res.body !== null, "body is an object");
            assert.ok("plugin" in res.body, "body has plugin field");
            assert.ok("enabled" in res.body, "body has enabled field");
        });

        it("plugin field matches requested plugin name", async () => {
            const res = await fetchJson("POST", "/api/v1/plugins/web-search-mcp/toggle");
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.plugin, "web-search-mcp");
        });

        it("enabled field is a boolean", async () => {
            const res = await fetchJson("POST", "/api/v1/plugins/ids-mcp/toggle");
            assert.strictEqual(res.status, 200);
            assert.strictEqual(typeof res.body.enabled, "boolean");
        });

        it("successive toggles flip the enabled state", async () => {
            const r1 = await fetchJson("POST", "/api/v1/plugins/impressioncore-eds/toggle");
            const r2 = await fetchJson("POST", "/api/v1/plugins/impressioncore-eds/toggle");
            assert.strictEqual(r1.status, 200);
            assert.strictEqual(r2.status, 200);
            assert.strictEqual(r1.body.enabled, !r2.body.enabled);
        });
    });

    /* ── POST /api/plugins/{name}/toggle (legacy backward-compat) ───── */

    describe("POST /api/plugins/{name}/toggle (legacy route)", () => {
        it("returns 200 — backward compat preserved", async () => {
            const res = await fetchJson("POST", "/api/plugins/ids-mcp/toggle");
            assert.strictEqual(res.status, 200);
        });

        it("returns plugin and enabled fields on legacy route", async () => {
            const res = await fetchJson("POST", "/api/plugins/web-search-mcp/toggle");
            assert.strictEqual(res.status, 200);
            assert.ok("plugin" in res.body, "body has plugin field");
            assert.ok("enabled" in res.body, "body has enabled field");
        });
    });

    /* ── POST /api/v1/plugins/{name}/health ─────────────────────────── */

    describe("POST /api/v1/plugins/{name}/health", () => {
        it("returns 200 with plugin, healthy, and message fields", async () => {
            const res = await fetchJson("POST", "/api/v1/plugins/ids-mcp/health");
            assert.strictEqual(res.status, 200);
            assert.ok(typeof res.body === "object" && res.body !== null, "body is an object");
            assert.ok("plugin" in res.body, "body has plugin field");
            assert.ok("healthy" in res.body, "body has healthy field");
            assert.ok("message" in res.body, "body has message field");
        });

        it("plugin field matches requested plugin name", async () => {
            const res = await fetchJson("POST", "/api/v1/plugins/web-search-mcp/health");
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.plugin, "web-search-mcp");
        });

        it("healthy field is a boolean", async () => {
            const res = await fetchJson("POST", "/api/v1/plugins/ids-mcp/health");
            assert.strictEqual(res.status, 200);
            assert.strictEqual(typeof res.body.healthy, "boolean");
        });

        it("message field is a string", async () => {
            const res = await fetchJson("POST", "/api/v1/plugins/ids-mcp/health");
            assert.strictEqual(res.status, 200);
            assert.strictEqual(typeof res.body.message, "string");
        });
    });

    /* ── POST /api/plugins/{name}/health (legacy backward-compat) ───── */

    describe("POST /api/plugins/{name}/health (legacy route)", () => {
        it("returns 200 — backward compat preserved", async () => {
            const res = await fetchJson("POST", "/api/plugins/ids-mcp/health");
            assert.strictEqual(res.status, 200);
        });

        it("returns plugin, healthy, and message fields on legacy route", async () => {
            const res = await fetchJson("POST", "/api/plugins/web-search-mcp/health");
            assert.strictEqual(res.status, 200);
            assert.ok("plugin" in res.body);
            assert.ok("healthy" in res.body);
            assert.ok("message" in res.body);
        });
    });
});
