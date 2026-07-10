/**
 * tests/prism-update-system.test.ts — PRISM Update System Test Suite
 *
 * Validates:
 *  - GET /api/v1/status returns the correct PRISM version
 *  - GET /api/v1/update/check returns versions and auto-update state
 *  - POST /api/v1/update/auto-update toggles preferences
 *
 * Run via Mocha: mocha dist/tests/prism-update-system.test.js --timeout 60000
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
import { PRISM_VERSION } from "../src/core/version.js";
import {
    _setWorkspaceRootForTest,
    _resetWorkspaceRootCache,
    preferencesPath,
} from "../src/core/config/workspace-resolver.js";

let service: DashboardService;
let port: number;
let tmpDir: string;
let chatStore: ChatSessionStore;
let originalPrefs: string | null = null;

function fetchRaw(
    method: string,
    path: string,
    bodyData?: string,
): Promise<{ status: number; headers: http.IncomingMessage["headers"]; body: string }> {
    return new Promise((resolve, reject) => {
        const headers: any = {};
        if (bodyData) {
            headers["Content-Type"] = "application/json";
            headers["Content-Length"] = Buffer.byteLength(bodyData);
        }
        const req = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path,
                method,
                headers,
            },
            (res) => {
                let payload = "";
                res.on("data", (chunk: Buffer) => {
                    payload += chunk;
                });
                res.on("end", () => {
                    resolve({ status: res.statusCode!, headers: res.headers, body: payload });
                });
            },
        );
        req.on("error", reject);
        if (bodyData) {
            req.write(bodyData);
        }
        req.end();
    });
}

function fetchJson(method: string, path: string, bodyData?: string): Promise<{ status: number; body: any }> {
    return fetchRaw(method, path, bodyData).then(({ status, body }) => {
        try {
            return { status, body: JSON.parse(body) };
        } catch {
            return { status, body };
        }
    });
}

describe("PRISM Update System (E3c)", function () {
    this.timeout(60_000);

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-update-system-"));
        mkdirSync(join(tmpDir, "state"), { recursive: true });
        mkdirSync(join(tmpDir, "characters"), { recursive: true });

        _setWorkspaceRootForTest(tmpDir);

        const realPrefsPath = preferencesPath();
        originalPrefs = existsSync(realPrefsPath) ? readFileSync(realPrefsPath, "utf-8") : null;
        writeFileSync(realPrefsPath, JSON.stringify({ setupComplete: true }, null, 2) + "\n", "utf-8");

        const bus = new ActivityBus();
        chatStore = new ChatSessionStore(":memory:");

        process.env.PRISM_AUTH_DISABLED = "true";

        service = new DashboardService(
            new ApprovalQueue(),
            bus,
            {
                sessionId: "prism-update-system-test",
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
        try {
            rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            /* Windows EPERM: non-fatal */
        }
    });

    describe("GET /api/v1/status", () => {
        it("returns 200 with PRISM version", async () => {
            const res = await fetchJson("GET", "/api/v1/status");
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.version, PRISM_VERSION);
        });
    });

    describe("GET /api/v1/update/check", () => {
        it("returns current and latest versions and default autoUpdate state", async () => {
            const res = await fetchJson("GET", "/api/v1/update/check");
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.currentVersion, PRISM_VERSION);
            assert.ok("latestVersion" in res.body);
            assert.ok("updateAvailable" in res.body);
            assert.strictEqual(res.body.autoUpdate, false);
        });
    });

    describe("POST /api/v1/update/auto-update", () => {
        it("updates preferences to true", async () => {
            const res = await fetchJson("POST", "/api/v1/update/auto-update", JSON.stringify({ enabled: true }));
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.success, true);
            assert.strictEqual(res.body.autoUpdate, true);

            // Recheck status
            const checkRes = await fetchJson("GET", "/api/v1/update/check");
            assert.strictEqual(checkRes.body.autoUpdate, true);
        });

        it("updates preferences back to false", async () => {
            const res = await fetchJson("POST", "/api/v1/update/auto-update", JSON.stringify({ enabled: false }));
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.success, true);
            assert.strictEqual(res.body.autoUpdate, false);

            // Recheck status
            const checkRes = await fetchJson("GET", "/api/v1/update/check");
            assert.strictEqual(checkRes.body.autoUpdate, false);
        });
    });
});
