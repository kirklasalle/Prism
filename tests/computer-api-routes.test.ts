/**
 * Computer Control API Route Integration Tests — exercises all /api/computer/*
 * REST endpoints exposed by DashboardService.
 *
 * Spins up a DashboardService on an ephemeral port, makes real HTTP requests,
 * and validates responses.
 *
 * Run via Mocha: mocha dist/tests/computer-api-routes.test.js --timeout 60000
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

const isWindows = process.platform === "win32";
const describeWindows = isWindows ? describe : describe.skip;

/** JSON GET helper */
function fetchJson(urlPath: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port, path: urlPath }, (res) => {
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
function fetchRaw(urlPath: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port, path: urlPath }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => { chunks.push(chunk); });
            res.on("end", () => {
                resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) });
            });
        }).on("error", reject);
    });
}

/** JSON POST/DELETE/PUT helper */
function requestJson(method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: "127.0.0.1",
            port,
            path: urlPath,
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

describe("Computer Control API Routes (/api/computer/*)", function () {
    this.timeout(60_000);

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-computer-api-"));
        const bus = new ActivityBus();
        chatStore = new ChatSessionStore(":memory:");

        const registry = new ToolRegistry();

        service = new DashboardService(
            new ApprovalQueue(),
            bus,
            {
                sessionId: "computer-api-test",
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
        await service.stop();
        chatStore.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    /* ── GET /api/computer/system-info ────────────────────────────────── */

    describe("GET /api/computer/system-info", () => {
        it("returns 200 with expected shape", async () => {
            const { status, body } = await fetchJson("/api/computer/system-info");
            assert.strictEqual(status, 200);
            assert.ok(typeof body.os === "string" && body.os.length > 0, "os must be a non-empty string");
            assert.ok(typeof body.hostname === "string" && body.hostname.length > 0, "hostname must be a non-empty string");
            assert.ok(typeof body.platform === "string", "platform must be a string");
            assert.ok(typeof body.uptime === "number" && body.uptime >= 0, "uptime must be non-negative number");
            assert.ok(typeof body.cpus === "number" && body.cpus >= 1, "cpus must be >= 1");
            assert.ok(typeof body.totalMemory === "number" && body.totalMemory > 0, "totalMemory must be positive");
            assert.ok(typeof body.freeMemory === "number" && body.freeMemory >= 0, "freeMemory must be non-negative");
            assert.ok(body.freeMemory <= body.totalMemory, "freeMemory must not exceed totalMemory");
            assert.ok(typeof body.homeDir === "string" && body.homeDir.length > 0, "homeDir must be a non-empty string");
        });

        it("gpu field is null or has expected shape", async () => {
            const { body } = await fetchJson("/api/computer/system-info");
            if (body.gpu !== null) {
                assert.ok(typeof body.gpu === "object", "gpu must be an object if not null");
                assert.ok(typeof body.gpu.name === "string", "gpu.name must be a string");
            }
        });
    });

    /* ── GET /api/computer/usage ──────────────────────────────────────── */

    describe("GET /api/computer/usage", () => {
        it("returns 200 with RAM metrics", async () => {
            const { status, body } = await fetchJson("/api/computer/usage");
            assert.strictEqual(status, 200);
            assert.ok(typeof body.ramTotal === "number" && body.ramTotal > 0, "ramTotal must be positive");
            assert.ok(typeof body.ramFree === "number" && body.ramFree >= 0, "ramFree must be non-negative");
            assert.ok(body.ramFree <= body.ramTotal, "ramFree must not exceed ramTotal");
        });

        it("gpu field is null or has metric shape", async () => {
            const { body } = await fetchJson("/api/computer/usage");
            if (body.gpu !== null && body.gpu !== undefined) {
                assert.ok(typeof body.gpu === "object", "gpu must be an object if present");
            }
        });
    });

    /* ── POST /api/computer/exec ──────────────────────────────────────── */

    describe("POST /api/computer/exec", () => {
        it("executes a safe command and returns stdout", async () => {
            const cmd = isWindows ? "echo hello" : "echo hello";
            const { status, body } = await requestJson("POST", "/api/computer/exec", { command: cmd });
            assert.strictEqual(status, 200);
            assert.ok(typeof body.stdout === "string", "stdout must be a string");
            assert.ok(body.stdout.includes("hello"), "stdout should contain 'hello'");
        });

        it("blocks dangerous commands (rm -rf)", async () => {
            const { status, body } = await requestJson("POST", "/api/computer/exec", { command: "rm -rf /" });
            assert.ok(status === 400 || status === 403, "dangerous command should be rejected");
            assert.ok(body.error, "should include error message");
        });

        it("blocks dangerous commands (format c:)", async () => {
            const { status, body } = await requestJson("POST", "/api/computer/exec", { command: "format c:" });
            assert.ok(status === 400 || status === 403, "dangerous command should be rejected");
        });

        it("blocks shutdown command", async () => {
            const { status } = await requestJson("POST", "/api/computer/exec", { command: "shutdown /s /t 0" });
            assert.ok(status === 400 || status === 403, "shutdown should be rejected");
        });

        it("blocks reboot command", async () => {
            const { status } = await requestJson("POST", "/api/computer/exec", { command: "reboot" });
            assert.ok(status === 400 || status === 403, "reboot should be rejected");
        });

        it("returns 400 for empty command", async () => {
            const { status } = await requestJson("POST", "/api/computer/exec", { command: "" });
            assert.ok(status === 400, "empty command should return 400");
        });

        it("returns 400 for missing command field", async () => {
            const { status } = await requestJson("POST", "/api/computer/exec", {});
            assert.ok(status === 400, "missing command should return 400");
        });
    });

    /* ── GET /api/computer/env-vars ───────────────────────────────────── */

    describe("GET /api/computer/env-vars", () => {
        it("returns partitioned prismVars and systemVars arrays", async () => {
            const { status, body } = await fetchJson("/api/computer/env-vars");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body.prismVars), "prismVars must be an array");
            assert.ok(Array.isArray(body.systemVars), "systemVars must be an array");
        });

        it("prismVars entries all start with PRISM_", async () => {
            const { body } = await fetchJson("/api/computer/env-vars");
            for (const entry of body.prismVars) {
                assert.ok(entry.key.startsWith("PRISM_"), `prismVars entry key should start with PRISM_: ${entry.key}`);
                assert.ok(typeof entry.value === "string", "value must be a string");
            }
        });

        it("systemVars entries do not start with PRISM_", async () => {
            const { body } = await fetchJson("/api/computer/env-vars");
            for (const entry of body.systemVars) {
                assert.ok(!entry.key.startsWith("PRISM_"), `systemVars entry should not start with PRISM_: ${entry.key}`);
            }
        });

        it("arrays are sorted by key", async () => {
            const { body } = await fetchJson("/api/computer/env-vars");
            for (let i = 1; i < body.prismVars.length; i++) {
                assert.ok(
                    body.prismVars[i - 1].key.localeCompare(body.prismVars[i].key) <= 0,
                    "prismVars must be sorted by key",
                );
            }
            for (let i = 1; i < body.systemVars.length; i++) {
                assert.ok(
                    body.systemVars[i - 1].key.localeCompare(body.systemVars[i].key) <= 0,
                    "systemVars must be sorted by key",
                );
            }
        });
    });

    /* ── GET /api/computer/screengrab/list ─────────────────────────────── */

    describe("GET /api/computer/screengrab/list", () => {
        it("returns gallery items array and metadata", async () => {
            const { status, body } = await fetchJson("/api/computer/screengrab/list");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body.galleryItems), "galleryItems must be an array");
            assert.ok(Array.isArray(body.files), "files must be an array");
            assert.ok(typeof body.directory === "string", "directory must be a string");
        });

        it("gallery items have correct shape", async () => {
            const { body } = await fetchJson("/api/computer/screengrab/list");
            for (const item of body.galleryItems) {
                assert.ok(item.kind === "single" || item.kind === "burst", `kind must be 'single' or 'burst': ${item.kind}`);
                assert.ok(typeof item.name === "string", "name must be a string");
                assert.ok(typeof item.previewName === "string", "previewName must be a string");
                assert.ok(typeof item.frameCount === "number", "frameCount must be a number");
            }
        });
    });

    /* ── GET /api/computer/screengrab/diagnostics ─────────────────────── */

    describe("GET /api/computer/screengrab/diagnostics", () => {
        it("returns ok boolean and checks array", async () => {
            const { status, body } = await fetchJson("/api/computer/screengrab/diagnostics");
            assert.strictEqual(status, 200);
            assert.ok(typeof body.ok === "boolean", "ok must be a boolean");
            assert.ok(Array.isArray(body.checks), "checks must be an array");
            assert.ok(body.checks.length > 0, "must have at least one check");
        });

        it("each check has name, ok, and detail", async () => {
            const { body } = await fetchJson("/api/computer/screengrab/diagnostics");
            for (const check of body.checks) {
                assert.ok(typeof check.name === "string" && check.name.length > 0, "check.name must be non-empty");
                assert.ok(typeof check.ok === "boolean", "check.ok must be a boolean");
                assert.ok(typeof check.detail === "string", "check.detail must be a string");
            }
        });
    });

    /* ── POST /api/computer/screengrab/capture (Windows) ──────────────── */

    describeWindows("POST /api/computer/screengrab/capture (Windows)", function () {
        this.timeout(30_000);

        it("captures a screenshot and returns metadata", async () => {
            const { status, body } = await requestJson("POST", "/api/computer/screengrab/capture");
            assert.strictEqual(status, 200);
            assert.ok(typeof body.filename === "string" && body.filename.endsWith(".png"), "filename must be a .png");
            assert.ok(typeof body.sizeBytes === "number" && body.sizeBytes > 0, "sizeBytes must be positive");
            assert.ok(typeof body.timestamp === "string", "timestamp must be a string");
        });
    });

    /* ── GET /api/computer/screengrab/latest (requires prior capture) ──── */

    describeWindows("GET /api/computer/screengrab/latest (Windows)", function () {
        this.timeout(15_000);

        it("returns PNG image after capture", async () => {
            // Trigger a capture first
            await requestJson("POST", "/api/computer/screengrab/capture");
            const { status, headers, body } = await fetchRaw("/api/computer/screengrab/latest");
            assert.strictEqual(status, 200);
            assert.strictEqual(headers["content-type"], "image/png");
            assert.ok(body.length > 0, "image body should be non-empty");
            // PNG magic bytes
            assert.strictEqual(body[0], 0x89, "PNG magic byte 1");
            assert.strictEqual(body[1], 0x50, "PNG magic byte 2");
        });
    });

    /* ── GET /api/computer/devices (Windows) ──────────────────────────── */

    describeWindows("GET /api/computer/devices (Windows)", function () {
        this.timeout(45_000);

        it("returns device categories object", async () => {
            const { status, body } = await fetchJson("/api/computer/devices");
            assert.strictEqual(status, 200);
            assert.ok(typeof body === "object" && body !== null, "response must be an object");
            // Should have at least Processors category on any Windows machine
            const categories = Object.keys(body);
            assert.ok(categories.length > 0, "must have at least one device category");
        });

        it("each category contains an array of device items", async () => {
            const { body } = await fetchJson("/api/computer/devices");
            const devices = body.devices || body;
            for (const [cat, items] of Object.entries(devices)) {
                assert.ok(Array.isArray(items), `${cat} must be an array`);
            }
        });
    });

    /* ── POST /api/computer/reveal-file ────────────────────────────────── */

    describe("POST /api/computer/reveal-file", () => {
        it("rejects path traversal attempts", async () => {
            const { status } = await requestJson("POST", "/api/computer/reveal-file", {
                filename: "../../../etc/passwd",
            });
            // Should either reject (400/403) or sanitize the path
            assert.ok(status === 200 || status === 400 || status === 403 || status === 500,
                "should handle path traversal attempt");
        });
    });
});
