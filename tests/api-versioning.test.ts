/**
 * api-versioning.test.ts — E3e API Versioning
 *
 * Validates:
 *  - GET /api/v1/openapi.json returns 200 with valid OpenAPI 3.0 object
 *  - OpenAPI spec has required top-level fields (openapi, info, paths)
 *  - openapi version is "3.0.x"
 *  - info.title and info.version are present
 *  - paths object contains at least the key v1 routes
 *  - GET /api/<path> → 301 redirect to /api/v1/<path> for unhandled routes
 *  - Redirect Location header is correct
 *  - Existing /api/v1/ routes are NOT double-redirected
 *
 * Run via Mocha: mocha dist/tests/api-versioning.test.js --timeout 60000
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

function fetchRaw(method: string, path: string): Promise<{ status: number; headers: http.IncomingMessage["headers"]; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path,
                method,
            },
            (res) => {
                let payload = "";
                res.on("data", (chunk: Buffer) => { payload += chunk; });
                res.on("end", () => {
                    resolve({ status: res.statusCode!, headers: res.headers, body: payload });
                });
            }
        );
        req.on("error", reject);
        req.end();
    });
}

function fetchJson(method: string, path: string): Promise<{ status: number; body: any }> {
    return fetchRaw(method, path).then(({ status, body }) => {
        try { return { status, body: JSON.parse(body) }; }
        catch { return { status, body }; }
    });
}

/* ── Suite setup ──────────────────────────────────────────────────────── */

describe("API Versioning (E3e)", function () {
    this.timeout(60_000);

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-api-versioning-"));
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
                sessionId: "api-versioning-test",
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

    /* ── GET /api/v1/openapi.json ───────────────────────────────────── */

    describe("GET /api/v1/openapi.json", () => {
        it("returns 200", async () => {
            const res = await fetchJson("GET", "/api/v1/openapi.json");
            assert.strictEqual(res.status, 200);
        });

        it("body is a JSON object", async () => {
            const res = await fetchJson("GET", "/api/v1/openapi.json");
            assert.ok(typeof res.body === "object" && res.body !== null);
        });

        it("has openapi field starting with 3.0", async () => {
            const res = await fetchJson("GET", "/api/v1/openapi.json");
            assert.ok(typeof res.body.openapi === "string", "openapi field is a string");
            assert.ok(res.body.openapi.startsWith("3.0"), `openapi version should start with 3.0, got ${res.body.openapi}`);
        });

        it("has info.title and info.version", async () => {
            const res = await fetchJson("GET", "/api/v1/openapi.json");
            assert.ok(res.body.info, "info field present");
            assert.ok(typeof res.body.info.title === "string", "info.title is a string");
            assert.ok(typeof res.body.info.version === "string", "info.version is a string");
        });

        it("has paths object", async () => {
            const res = await fetchJson("GET", "/api/v1/openapi.json");
            assert.ok(typeof res.body.paths === "object" && res.body.paths !== null, "paths field is an object");
        });

        it("paths includes /telemetry/slo-summary", async () => {
            const res = await fetchJson("GET", "/api/v1/openapi.json");
            assert.ok("/telemetry/slo-summary" in res.body.paths, "slo-summary path present");
        });

        it("paths includes /plugins/{name}/toggle", async () => {
            const res = await fetchJson("GET", "/api/v1/openapi.json");
            assert.ok("/plugins/{name}/toggle" in res.body.paths, "plugin toggle path present");
        });

        it("paths includes /plugins/{name}/health", async () => {
            const res = await fetchJson("GET", "/api/v1/openapi.json");
            assert.ok("/plugins/{name}/health" in res.body.paths, "plugin health path present");
        });
    });

    /* ── Backward-compat 301 redirect ───────────────────────────────── */

    describe("Backward-compat GET /api/<path> → 301 /api/v1/<path>", () => {
        it("returns 301 for an unversioned GET route", async () => {
            const res = await fetchRaw("GET", "/api/nonexistent-route");
            assert.strictEqual(res.status, 301);
        });

        it("Location header points to /api/v1/ equivalent", async () => {
            const res = await fetchRaw("GET", "/api/nonexistent-route");
            assert.strictEqual(res.headers["location"], "/api/v1/nonexistent-route");
        });

        it("preserves query string in redirect location", async () => {
            const res = await fetchRaw("GET", "/api/some-route?foo=bar");
            assert.strictEqual(res.status, 301);
            assert.strictEqual(res.headers["location"], "/api/v1/some-route?foo=bar");
        });

        it("existing /api/v1/ routes are NOT redirected (no double redirect)", async () => {
            const res = await fetchJson("GET", "/api/v1/telemetry/slo-summary");
            // Should be 200, not 301
            assert.strictEqual(res.status, 200);
        });
    });
});
