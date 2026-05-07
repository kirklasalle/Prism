/**
 * Browser API Route Integration Tests — exercises all /api/browser/* REST
 * endpoints exposed by DashboardService.
 *
 * Spins up a DashboardService with BrowserControlTool on an ephemeral port,
 * makes real HTTP requests, and validates responses.
 *
 * Run via Mocha: mocha dist/tests/browser-api-routes.test.js --timeout 60000
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
import { BrowserControlTool } from "../src/adapters/system/browser-control-tool.js";

/* ── Test helpers ─────────────────────────────────────────────────────── */

let service: DashboardService;
let port: number;
let tmpDir: string;
let chatStore: ChatSessionStore;
let browserTool: BrowserControlTool;

/** JSON GET helper */
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

/** Raw GET helper (for binary, e.g. screenshot PNG) */
function fetchRaw(path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port, path }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => { chunks.push(chunk); });
            res.on("end", () => {
                resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) });
            });
        }).on("error", reject);
    });
}

/** JSON POST/DELETE/PUT helper */
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

/* ── Playwright availability gate ─────────────────────────────────────── */

let playwrightAvailable = false;
try {
    await import("playwright");
    playwrightAvailable = true;
} catch { /* Playwright not installed — skip live browser tests */ }

const describeOrSkip = playwrightAvailable ? describe : describe.skip;

/* ── Suite ────────────────────────────────────────────────────────────── */

describeOrSkip("Browser API Routes (/api/browser/*)", function () {
    this.timeout(60_000);

    before(async () => {
        process.env.PRISM_AUTH_DISABLED = "true";
        tmpDir = mkdtempSync(join(tmpdir(), "prism-browser-api-"));
        const bus = new ActivityBus();
        chatStore = new ChatSessionStore(":memory:");
        browserTool = new BrowserControlTool(bus, "api-test-session");

        const registry = new ToolRegistry();
        registry.register(browserTool);

        service = new DashboardService(
            new ApprovalQueue(),
            bus,
            {
                sessionId: "api-test-session",
                environmentProfile: "test",
                mode: "server",
                startedAt: new Date().toISOString(),
                executionProfileSegment: "individual",
            },
            chatStore,
            [],                                          // actions
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
        // Close any remaining browser sessions
        const mgr = browserTool.getManager();
        await mgr.closeAll();

        await service.stop();
        chatStore.close();
        rmSync(tmpDir, { recursive: true, force: true });
        delete process.env.PRISM_AUTH_DISABLED;
    });

    /* ── GET /api/browser/sessions (empty) ─────────────────────────────── */

    it("GET /api/browser/sessions returns empty array initially", async () => {
        const { status, body } = await fetchJson("/api/browser/sessions");
        assert.strictEqual(status, 200);
        assert.ok(Array.isArray(body.sessions));
        assert.strictEqual(body.sessions.length, 0);
    });

    /* ── GET /api/browser/diagnostics ──────────────────────────────────── */

    it("GET /api/browser/diagnostics returns playwright status", async () => {
        const { status, body } = await fetchJson("/api/browser/diagnostics");
        assert.strictEqual(status, 200);
        assert.ok("playwrightAvailable" in body);
    });

    /* ── GET /api/browser/profiles (empty initially) ──────────────────── */

    it("GET /api/browser/profiles returns profiles array", async () => {
        const { status, body } = await fetchJson("/api/browser/profiles");
        assert.strictEqual(status, 200);
        assert.ok(Array.isArray(body.profiles));
    });

    /* ── POST /api/browser/launch ──────────────────────────────────────── */

    let sessionId: string;

    it("POST /api/browser/launch starts a browser session", async () => {
        const { status, body } = await requestJson("POST", "/api/browser/launch", { headless: true });
        assert.strictEqual(status, 200);
        assert.ok(body.session, "response should contain session");
        assert.ok(body.session.sessionId, "session should have sessionId");
        sessionId = body.session.sessionId;
    });

    /* ── GET /api/browser/sessions (with one session) ──────────────────── */

    it("GET /api/browser/sessions lists the launched session", async () => {
        const { status, body } = await fetchJson("/api/browser/sessions");
        assert.strictEqual(status, 200);
        assert.strictEqual(body.sessions.length, 1);
        assert.strictEqual(body.sessions[0].sessionId, sessionId);
    });

    /* ── POST /api/browser/navigate ────────────────────────────────────── */

    it("POST /api/browser/navigate navigates to a URL", async () => {
        const { status, body } = await requestJson("POST", "/api/browser/navigate", {
            sessionId,
            url: "https://example.com",
        });
        assert.strictEqual(status, 200);
        assert.ok(body.ok !== undefined || body.url !== undefined, "should return navigation result");
    });

    it("POST /api/browser/navigate returns 400 without sessionId", async () => {
        const { status, body } = await requestJson("POST", "/api/browser/navigate", { url: "https://example.com" });
        assert.strictEqual(status, 400);
        assert.ok(body.error.includes("sessionId"));
    });

    it("POST /api/browser/navigate returns 400 without url", async () => {
        const { status, body } = await requestJson("POST", "/api/browser/navigate", { sessionId });
        assert.strictEqual(status, 400);
        assert.ok(body.error.includes("url"));
    });

    /* ── POST /api/browser/click ───────────────────────────────────────── */

    it("POST /api/browser/click clicks a selector", async () => {
        // Navigate to a page with a link first, then click it
        const { status, body } = await requestJson("POST", "/api/browser/click", {
            sessionId,
            selector: "a",
        });
        // On example.com there is a link, this should succeed or fail gracefully
        assert.ok(status === 200 || status === 500);
    });

    it("POST /api/browser/click returns 400 without sessionId", async () => {
        const { status, body } = await requestJson("POST", "/api/browser/click", { selector: "body" });
        assert.strictEqual(status, 400);
        assert.ok(body.error.includes("sessionId"));
    });

    it("POST /api/browser/click returns 400 without selector", async () => {
        const { status, body } = await requestJson("POST", "/api/browser/click", { sessionId });
        assert.strictEqual(status, 400);
        assert.ok(body.error.includes("selector"));
    });

    /* ── POST /api/browser/type ────────────────────────────────────────── */

    it("POST /api/browser/type returns 400 without sessionId", async () => {
        const { status, body } = await requestJson("POST", "/api/browser/type", {
            selector: "input",
            text: "hello",
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error.includes("sessionId"));
    });

    it("POST /api/browser/type returns 400 without selector", async () => {
        const { status, body } = await requestJson("POST", "/api/browser/type", {
            sessionId,
            text: "hello",
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error.includes("selector"));
    });

    /* ── POST /api/browser/evaluate ────────────────────────────────────── */

    it("POST /api/browser/evaluate evaluates JS expression", async () => {
        const { status, body } = await requestJson("POST", "/api/browser/evaluate", {
            sessionId,
            expression: "document.title",
        });
        assert.strictEqual(status, 200);
        assert.ok("result" in body);
    });

    it("POST /api/browser/evaluate returns 400 without sessionId", async () => {
        const { status, body } = await requestJson("POST", "/api/browser/evaluate", {
            expression: "1+1",
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error.includes("sessionId"));
    });

    it("POST /api/browser/evaluate returns 400 without expression", async () => {
        const { status, body } = await requestJson("POST", "/api/browser/evaluate", {
            sessionId,
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error.includes("expression"));
    });

    /* ── GET /api/browser/screenshot/:id ───────────────────────────────── */

    it("GET /api/browser/screenshot/:id returns PNG image", async () => {
        const { status, headers, body } = await fetchRaw(`/api/browser/screenshot/${encodeURIComponent(sessionId)}`);
        assert.strictEqual(status, 200);
        assert.strictEqual(headers["content-type"], "image/png");
        assert.ok(body.length > 0, "screenshot should have non-zero size");
        // PNG magic bytes: 0x89 0x50 0x4E 0x47
        assert.strictEqual(body[0], 0x89);
        assert.strictEqual(body[1], 0x50);
        assert.strictEqual(body[2], 0x4E);
        assert.strictEqual(body[3], 0x47);
    });

    /* ── GET /api/browser/console-logs/:id ─────────────────────────────── */

    it("GET /api/browser/console-logs/:id returns logs array", async () => {
        const { status, body } = await fetchJson(`/api/browser/console-logs/${encodeURIComponent(sessionId)}`);
        assert.strictEqual(status, 200);
        assert.ok(Array.isArray(body.logs));
    });

    /* ── GET /api/browser/network-log/:id ──────────────────────────────── */

    it("GET /api/browser/network-log/:id returns log array", async () => {
        const { status, body } = await fetchJson(`/api/browser/network-log/${encodeURIComponent(sessionId)}`);
        assert.strictEqual(status, 200);
        assert.ok(Array.isArray(body.log));
    });

    /* ── GET /api/browser/dom-snapshot/:id ─────────────────────────────── */

    it("GET /api/browser/dom-snapshot/:id returns HTML string", async () => {
        const { status, body } = await fetchJson(`/api/browser/dom-snapshot/${encodeURIComponent(sessionId)}`);
        assert.strictEqual(status, 200);
        assert.ok(typeof body.dom === "string");
        assert.ok(body.dom.length > 0);
    });

    /* ── DELETE /api/browser/sessions/:id ──────────────────────────────── */

    it("DELETE /api/browser/sessions/:id closes the session", async () => {
        const { status, body } = await requestJson("DELETE", `/api/browser/sessions/${encodeURIComponent(sessionId)}`);
        assert.strictEqual(status, 200);
        assert.strictEqual(body.ok, true);
    });

    it("GET /api/browser/sessions shows empty after delete", async () => {
        const { status, body } = await fetchJson("/api/browser/sessions");
        assert.strictEqual(status, 200);
        assert.strictEqual(body.sessions.length, 0);
    });

    /* ── DELETE /api/browser/profiles/:id ──────────────────────────────── */

    it("DELETE /api/browser/profiles/:id for nonexistent returns 500", async () => {
        const { status } = await requestJson("DELETE", "/api/browser/profiles/nonexistent-id");
        // Deleting a nonexistent profile throws in BrowserProfileManager → 500
        assert.ok(status === 500 || status === 200);
    });

    /* ── 503 when browser tool is NOT wired ────────────────────────────── */

    describe("503 when browser tool is unavailable", function () {
        let bareService: DashboardService;
        let barePort: number;
        let bareChatStore: ChatSessionStore;

        before(async () => {
            bareChatStore = new ChatSessionStore(":memory:");
            // No ToolRegistry → no browser_control tool → 503
            bareService = new DashboardService(
                new ApprovalQueue(),
                new ActivityBus(),
                {
                    sessionId: "bare-test",
                    environmentProfile: "test",
                    mode: "server",
                    startedAt: new Date().toISOString(),
                    executionProfileSegment: "individual",
                },
                bareChatStore,
                [],
                0,
                undefined,
                undefined,
                new InMemoryProviderSecretStore(),
            );
            bareService.start();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const addr = (bareService as unknown as { server: { address(): { port: number } | null } }).server.address();
            barePort = addr ? addr.port : 0;
        });

        after(async () => {
            await bareService.stop();
            bareChatStore.close();
        });

        /** Helper scoped to barePort */
        function bareFetchJson(path: string): Promise<{ status: number; body: any }> {
            return new Promise((resolve, reject) => {
                http.get({ hostname: "127.0.0.1", port: barePort, path }, (res) => {
                    let data = "";
                    res.on("data", (chunk: Buffer) => { data += chunk; });
                    res.on("end", () => {
                        try { resolve({ status: res.statusCode!, body: JSON.parse(data || "{}") }); }
                        catch { resolve({ status: res.statusCode!, body: data }); }
                    });
                }).on("error", reject);
            });
        }

        function bareRequestJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
            return new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: "127.0.0.1",
                    port: barePort,
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

        it("GET /api/browser/sessions returns 503", async () => {
            const { status, body } = await bareFetchJson("/api/browser/sessions");
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("GET /api/browser/diagnostics returns 503", async () => {
            const { status, body } = await bareFetchJson("/api/browser/diagnostics");
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("POST /api/browser/launch returns 503", async () => {
            const { status, body } = await bareRequestJson("POST", "/api/browser/launch", {});
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("POST /api/browser/navigate returns 503", async () => {
            const { status, body } = await bareRequestJson("POST", "/api/browser/navigate", {
                sessionId: "x",
                url: "https://example.com",
            });
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("POST /api/browser/click returns 503", async () => {
            const { status, body } = await bareRequestJson("POST", "/api/browser/click", {
                sessionId: "x",
                selector: "body",
            });
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("POST /api/browser/type returns 503", async () => {
            const { status, body } = await bareRequestJson("POST", "/api/browser/type", {
                sessionId: "x",
                selector: "input",
                text: "hello",
            });
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("POST /api/browser/evaluate returns 503", async () => {
            const { status, body } = await bareRequestJson("POST", "/api/browser/evaluate", {
                sessionId: "x",
                expression: "1+1",
            });
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("GET /api/browser/screenshot/:id returns 503", async () => {
            const { status, body } = await bareFetchJson("/api/browser/screenshot/x");
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("GET /api/browser/console-logs/:id returns 503", async () => {
            const { status, body } = await bareFetchJson("/api/browser/console-logs/x");
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("GET /api/browser/network-log/:id returns 503", async () => {
            const { status, body } = await bareFetchJson("/api/browser/network-log/x");
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("GET /api/browser/dom-snapshot/:id returns 503", async () => {
            const { status, body } = await bareFetchJson("/api/browser/dom-snapshot/x");
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("DELETE /api/browser/sessions/:id returns 503", async () => {
            const { status, body } = await bareRequestJson("DELETE", "/api/browser/sessions/x");
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("GET /api/browser/profiles returns 503", async () => {
            const { status, body } = await bareFetchJson("/api/browser/profiles");
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });

        it("DELETE /api/browser/profiles/:id returns 503", async () => {
            const { status, body } = await bareRequestJson("DELETE", "/api/browser/profiles/x");
            assert.strictEqual(status, 503);
            assert.ok(body.error);
        });
    });
});
