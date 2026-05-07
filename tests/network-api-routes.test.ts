/**
 * Network API Route Tests
 *
 * Integration tests for the network-related API endpoints served by
 * dashboard-service.ts.  Uses direct HTTP requests against a running
 * server instance to validate:
 *   - GET  /api/network/interfaces
 *   - GET  /api/network/telemetry
 *   - POST /api/network/exec   (tier classification + blocked patterns)
 *   - GET  /api/diagnostics/network/report
 *   - GET  /api/diagnostics/network/status
 *
 * Run: npx mocha dist/tests/network-api-routes.test.js --timeout 60000
 */
import { describe, it } from "mocha";
import assert from "node:assert";
import http from "node:http";

/** Minimal JSON fetch helper — makes an HTTP request and returns parsed JSON. */
function jsonRequest(
    options: { method: string; port: number; path: string; body?: unknown },
): Promise<{ status: number; data: any }> {
    return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {};
        let bodyStr: string | undefined;
        if (options.body !== undefined) {
            bodyStr = JSON.stringify(options.body);
            headers["Content-Type"] = "application/json";
            headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
        }

        const req = http.request(
            {
                hostname: "127.0.0.1",
                port: options.port,
                path: options.path,
                method: options.method,
                headers,
            },
            (res) => {
                let chunks = "";
                res.on("data", (c) => (chunks += c));
                res.on("end", () => {
                    try {
                        resolve({ status: res.statusCode ?? 0, data: JSON.parse(chunks) });
                    } catch {
                        resolve({ status: res.statusCode ?? 0, data: chunks });
                    }
                });
            },
        );
        req.on("error", reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

/**
 * Attempt to detect a running dashboard server. If none is found, most
 * tests in this suite will be skipped gracefully.
 */
async function probeServer(port: number): Promise<boolean> {
    try {
        const { status } = await jsonRequest({ method: "GET", port, path: "/api/health" });
        return status >= 200 && status < 500;
    } catch {
        return false;
    }
}

// Default dashboard port (can override with PRISM_DASH_PORT env var)
const PORT = parseInt(process.env.PRISM_DASH_PORT || "5580", 10);

describe("Network API Routes — Integration Tests", function () {
    this.timeout(60_000);

    let serverAvailable = false;

    before(async function () {
        serverAvailable = await probeServer(PORT);
        if (!serverAvailable) {
            console.warn(
                `  ⚠ Dashboard server not detected on port ${PORT}. ` +
                "API route tests will be skipped. Start the server with start_web.bat to enable them.",
            );
        }
    });

    /* ── GET /api/network/interfaces ──────────────────────────────────── */

    describe("GET /api/network/interfaces", () => {
        it("returns 200 with interfaces array", async function () {
            if (!serverAvailable) return this.skip();
            const { status, data } = await jsonRequest({ method: "GET", port: PORT, path: "/api/network/interfaces" });
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(data.interfaces), "Response should have interfaces array");
        });

        it("each interface has name and details properties", async function () {
            if (!serverAvailable) return this.skip();
            const { data } = await jsonRequest({ method: "GET", port: PORT, path: "/api/network/interfaces" });
            if (data.interfaces.length > 0) {
                const first = data.interfaces[0];
                assert.ok(typeof first.name === "string", "Interface should have a name");
                assert.ok(typeof first.details === "string", "Interface should have details");
            }
        });
    });

    /* ── GET /api/network/telemetry ───────────────────────────────────── */

    describe("GET /api/network/telemetry", () => {
        it("returns 200 with telemetry counters", async function () {
            if (!serverAvailable) return this.skip();
            const { status, data } = await jsonRequest({ method: "GET", port: PORT, path: "/api/network/telemetry" });
            assert.strictEqual(status, 200);
            assert.ok("totalCommands" in data, "Should have totalCommands");
            assert.ok("tier1Count" in data, "Should have tier1Count");
            assert.ok("tier2Count" in data, "Should have tier2Count");
            assert.ok("tier3Count" in data, "Should have tier3Count");
            assert.ok("errorCount" in data, "Should have errorCount");
        });

        it("counters are non-negative integers", async function () {
            if (!serverAvailable) return this.skip();
            const { data } = await jsonRequest({ method: "GET", port: PORT, path: "/api/network/telemetry" });
            assert.ok(data.totalCommands >= 0, "totalCommands >= 0");
            assert.ok(data.tier1Count >= 0, "tier1Count >= 0");
            assert.ok(data.errorCount >= 0, "errorCount >= 0");
        });
    });

    /* ── POST /api/network/exec ───────────────────────────────────────── */

    describe("POST /api/network/exec", () => {
        it("executes tier-1 command (hostname) successfully", async function () {
            if (!serverAvailable) return this.skip();
            const { status, data } = await jsonRequest({
                method: "POST",
                port: PORT,
                path: "/api/network/exec",
                body: { command: "hostname" },
            });
            assert.strictEqual(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
            assert.ok(data.tier === "tier1", "hostname should be classified as tier1");
            assert.ok(typeof data.stdout === "string", "Should have stdout");
        });

        it("rejects blocked pattern 'netsh interface reset' with 422", async function () {
            if (!serverAvailable) return this.skip();
            const { status, data } = await jsonRequest({
                method: "POST",
                port: PORT,
                path: "/api/network/exec",
                body: { command: "netsh interface reset" },
            });
            assert.strictEqual(status, 422, "Blocked command should get 422");
            assert.ok(String(data.error).includes("blocked"), "Error should mention blocked");
        });

        it("rejects unknown command with 422", async function () {
            if (!serverAvailable) return this.skip();
            const { status, data } = await jsonRequest({
                method: "POST",
                port: PORT,
                path: "/api/network/exec",
                body: { command: "rm -rf /" },
            });
            assert.strictEqual(status, 422, "Unknown command should get 422");
            assert.ok(String(data.error).includes("not recognized"), "Error should mention not recognized");
        });

        it("rejects empty command with 400", async function () {
            if (!serverAvailable) return this.skip();
            const { status, data } = await jsonRequest({
                method: "POST",
                port: PORT,
                path: "/api/network/exec",
                body: { command: "" },
            });
            assert.strictEqual(status, 400);
            assert.ok(String(data.error).toLowerCase().includes("missing"), "Should note missing command");
        });

        it("rejects missing command field with 400", async function () {
            if (!serverAvailable) return this.skip();
            const { status } = await jsonRequest({
                method: "POST",
                port: PORT,
                path: "/api/network/exec",
                body: {},
            });
            assert.strictEqual(status, 400);
        });

        it("updates telemetry after successful execution", async function () {
            if (!serverAvailable) return this.skip();
            // Get baseline
            const before = await jsonRequest({ method: "GET", port: PORT, path: "/api/network/telemetry" });
            const baseTotal = before.data.totalCommands;

            // Execute a command
            await jsonRequest({
                method: "POST",
                port: PORT,
                path: "/api/network/exec",
                body: { command: "hostname" },
            });

            // Check telemetry incremented
            const after = await jsonRequest({ method: "GET", port: PORT, path: "/api/network/telemetry" });
            assert.ok(
                after.data.totalCommands > baseTotal,
                `totalCommands should increment: ${baseTotal} → ${after.data.totalCommands}`,
            );
        });
    });

    /* ── GET /api/diagnostics/network/report ──────────────────────────── */

    describe("GET /api/diagnostics/network/report", () => {
        it("returns 200/404 (report may not exist yet)", async function () {
            if (!serverAvailable) return this.skip();
            const { status } = await jsonRequest({
                method: "GET",
                port: PORT,
                path: "/api/diagnostics/network/report",
            });
            assert.ok(status === 200 || status === 404, `Expected 200 or 404, got ${status}`);
        });
    });

    /* ── GET /api/diagnostics/network/status ──────────────────────────── */

    describe("GET /api/diagnostics/network/status", () => {
        it("returns 200 with running and lastRunAt fields", async function () {
            if (!serverAvailable) return this.skip();
            const { status, data } = await jsonRequest({
                method: "GET",
                port: PORT,
                path: "/api/diagnostics/network/status",
            });
            assert.strictEqual(status, 200);
            assert.ok("running" in data, "Should have running field");
            assert.ok("lastRunAt" in data, "Should have lastRunAt field");
            assert.strictEqual(typeof data.running, "boolean", "running should be boolean");
        });
    });

    /* ── Tier classification via exec ─────────────────────────────────── */

    describe("Tier Classification (via /api/network/exec)", () => {
        it("classifies 'ping 127.0.0.1 -n 1' as tier1", async function () {
            if (!serverAvailable) return this.skip();
            const { data } = await jsonRequest({
                method: "POST",
                port: PORT,
                path: "/api/network/exec",
                body: { command: "ping 127.0.0.1 -n 1" },
            });
            assert.strictEqual(data.tier, "tier1");
        });

        it("classifies 'arp -a' as tier1", async function () {
            if (!serverAvailable) return this.skip();
            const { data } = await jsonRequest({
                method: "POST",
                port: PORT,
                path: "/api/network/exec",
                body: { command: "arp -a" },
            });
            assert.strictEqual(data.tier, "tier1");
        });
    });
});
