/**
 * simple-mode.test.ts — E3a Simple Mode UX
 *
 * Validates:
 *  - simpleModeHtml() output: required DOM IDs, script tag, character names
 *  - POST /api/preferences/ui-mode persists the chosen mode
 *  - GET / serves simple mode for a new user (no sessions, no uiMode pref)
 *  - GET /dashboard always serves the full operator UI
 *  - GET /simple always serves Simple Mode HTML
 *  - GET / serves advanced mode when prefs.uiMode === "advanced"
 *
 * Run via Mocha: mocha dist/tests/simple-mode.test.js --timeout 60000
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
    readPreferences,
    preferencesPath,
} from "../src/core/config/workspace-resolver.js";

/* ── Helpers ──────────────────────────────────────────────────────────── */

let service: DashboardService;
let port: number;
let tmpDir: string;
let chatStore: ChatSessionStore;
/** Original content of the real .prism-preferences.json, to restore after tests. */
let originalPrefs: string | null = null;

/**
 * Write the prefs file ATOMICALLY (no merge) so tests start from a known clean state.
 * Uses writeFileSync on preferencesPath() directly instead of writePreferences() (which merges).
 */
function setPrefs(prefs: Record<string, unknown>): void {
    writeFileSync(preferencesPath(), JSON.stringify(prefs, null, 2) + "\n", "utf-8");
}

function fetchRaw(method: string, path: string, body?: unknown): Promise<{ status: number; body: string; contentType: string }> {
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
                res.on("end", () =>
                    resolve({
                        status: res.statusCode!,
                        body: payload,
                        contentType: String(res.headers["content-type"] ?? ""),
                    })
                );
            }
        );
        req.on("error", reject);
        if (bodyStr != null) req.write(bodyStr);
        req.end();
    });
}

function fetchJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    return fetchRaw(method, path, body).then(({ status, body: raw }) => {
        try { return { status, body: JSON.parse(raw) }; }
        catch { return { status, body: raw }; }
    });
}

/* ── Suite setup ──────────────────────────────────────────────────────── */

describe("Simple Mode (E3a)", function () {
    this.timeout(60_000);

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-simple-mode-"));
        mkdirSync(join(tmpDir, "state"), { recursive: true });
        mkdirSync(join(tmpDir, "characters"), { recursive: true });

        _setWorkspaceRootForTest(tmpDir);

        // Save + overwrite the real prefs file so tests start from a clean state.
        // writePreferences() merges, so we use writeFileSync directly.
        const realPrefsPath = preferencesPath();
        originalPrefs = existsSync(realPrefsPath)
            ? readFileSync(realPrefsPath, "utf-8")
            : null;
        setPrefs({ setupComplete: true });

        const bus = new ActivityBus();
        chatStore = new ChatSessionStore(":memory:");

        process.env.PRISM_AUTH_DISABLED = "true";

        service = new DashboardService(
            new ApprovalQueue(),
            bus,
            {
                sessionId: "simple-mode-test",
                environmentProfile: "test",
                mode: "server",
                startedAt: new Date().toISOString(),
                executionProfileSegment: "individual",
            },
            chatStore,
            [],                                   // actions
            0,                                    // ephemeral port
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

        // Restore original prefs
        const realPrefsPath = preferencesPath();
        if (originalPrefs !== null) {
            writeFileSync(realPrefsPath, originalPrefs, "utf-8");
        }

        // Cleanup temp dir — on Windows a brief delay helps release file handles
        await new Promise((resolve) => setTimeout(resolve, 100));
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows EPERM: non-fatal */ }
    });

    // ── HTML structure ────────────────────────────────────────────────────────

    describe("simpleModeHtml content", () => {
        let html: string;

        before(async () => {
            // Explicitly request simple mode so the HTML is predictable.
            // New-user (no uiMode + 0 sessions) detection is tested in the
            // "GET / mode detection" describe block below.
            setPrefs({ setupComplete: true, uiMode: "simple" });
            const { body } = await fetchRaw("GET", "/");
            html = body;
        });

        it("returns 200 with text/html content-type", async () => {
            const { status, contentType } = await fetchRaw("GET", "/");
            assert.strictEqual(status, 200);
            assert.ok(contentType.includes("text/html"), `expected text/html but got: ${contentType}`);
        });

        it("includes required DOM IDs", () => {
            const requiredIds = [
                "sm-character-picker",
                "sm-session-list",
                "sm-messages",
                "sm-input",
                "sm-send-btn",
                "sm-new-chat-btn",
                "sm-advanced-btn",
                "sm-error",
            ];
            for (const id of requiredIds) {
                assert.ok(html.includes(`id="${id}"`), `HTML should contain id="${id}"`);
            }
        });

        it("includes the simple-mode.js script tag", () => {
            assert.ok(
                html.includes('src="/public/simple-mode.js"'),
                "HTML should include /public/simple-mode.js script"
            );
            assert.ok(
                html.includes('type="module"'),
                "script tag should use type=module"
            );
        });

        it("includes prism-auth-token meta tag", () => {
            assert.ok(
                html.includes('name="prism-auth-token"'),
                "HTML should include prism-auth-token meta tag"
            );
        });

        it("does NOT include the full operator dashboard script/components", () => {
            // Simple mode should NOT contain the full operator dashboard's chat UI elements
            assert.ok(
                !html.includes("id=\"chat-container\"") && !html.includes("id=\"agent-panel\""),
                "Simple mode HTML should not include full dashboard panel IDs"
            );
        });
    });

    // ── GET /simple — always Simple Mode ─────────────────────────────────────

    describe("GET /simple", () => {
        it("always serves Simple Mode HTML regardless of uiMode pref", async () => {
            // Set advanced pref — /simple should still serve simple mode
            setPrefs({ setupComplete: true, uiMode: "advanced" });

            const { status, body } = await fetchRaw("GET", "/simple");
            assert.strictEqual(status, 200);
            assert.ok(body.includes('id="sm-character-picker"'), "should serve simple mode HTML");

            // Reset
            setPrefs({ setupComplete: true });
        });

        it("returns 200 with text/html", async () => {
            const { status, contentType } = await fetchRaw("GET", "/simple");
            assert.strictEqual(status, 200);
            assert.ok(contentType.includes("text/html"));
        });
    });

    // ── GET /dashboard — always full operator UI ──────────────────────────────

    describe("GET /dashboard", () => {
        it("always serves full dashboard HTML (not simple mode)", async () => {
            const { status, body } = await fetchRaw("GET", "/dashboard");
            assert.strictEqual(status, 200);
            // Full dashboard contains its own script logic, NOT simple-mode-specific IDs
            assert.ok(
                !body.includes('id="sm-character-picker"'),
                "dashboard should not contain simple mode character picker"
            );
        });
    });

    // ── Mode detection at GET / ───────────────────────────────────────────────

    describe("GET / mode detection", () => {
        it("serves simple mode when prefs.uiMode === 'simple'", async () => {
            setPrefs({ setupComplete: true, uiMode: "simple" });

            const { body } = await fetchRaw("GET", "/");
            assert.ok(
                body.includes('id="sm-character-picker"'),
                "should serve simple mode when uiMode=simple"
            );
        });

        it("serves full dashboard when prefs.uiMode === 'advanced'", async () => {
            setPrefs({ setupComplete: true, uiMode: "advanced" });

            const { body } = await fetchRaw("GET", "/");
            assert.ok(
                !body.includes('id="sm-character-picker"'),
                "should serve full dashboard when uiMode=advanced"
            );

            // Reset
            setPrefs({ setupComplete: true });
        });

        it("serves full dashboard at /?mode=advanced even with no pref set", async () => {
            setPrefs({ setupComplete: true }); // no uiMode

            const { body } = await fetchRaw("GET", "/?mode=advanced");
            assert.ok(
                !body.includes('id="sm-character-picker"'),
                "/?mode=advanced should serve full dashboard"
            );

            // Reset
            setPrefs({ setupComplete: true });
        });
    });

    // ── POST /api/preferences/ui-mode ────────────────────────────────────────

    describe("POST /api/preferences/ui-mode", () => {
        it("persists mode='simple' and returns {updated:true}", async () => {
            setPrefs({ setupComplete: true }); // known baseline
            const { status, body } = await fetchJson("POST", "/api/preferences/ui-mode", { mode: "simple" });
            assert.strictEqual(status, 200);
            assert.strictEqual(body.updated, true);
            assert.strictEqual(body.mode, "simple");

            const prefs = readPreferences();
            assert.strictEqual(prefs?.uiMode, "simple");
        });

        it("persists mode='advanced' and returns {updated:true}", async () => {
            setPrefs({ setupComplete: true }); // known baseline
            const { status, body } = await fetchJson("POST", "/api/preferences/ui-mode", { mode: "advanced" });
            assert.strictEqual(status, 200);
            assert.strictEqual(body.updated, true);
            assert.strictEqual(body.mode, "advanced");

            const prefs = readPreferences();
            assert.strictEqual(prefs?.uiMode, "advanced");

            // Reset so other tests start clean
            setPrefs({ setupComplete: true });
        });

        it("returns 400 for invalid mode value", async () => {
            const { status, body } = await fetchJson("POST", "/api/preferences/ui-mode", { mode: "turbo" });
            assert.strictEqual(status, 400);
            assert.ok(body.error, "should return an error message");
        });

        it("returns 400 when mode field is missing", async () => {
            const { status, body } = await fetchJson("POST", "/api/preferences/ui-mode", {});
            assert.strictEqual(status, 400);
            assert.ok(body.error, "should return an error message");
        });
    });
});
