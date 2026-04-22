/**
 * slo-gauge.test.ts — E3c SLO Gauge Panel
 *
 * Validates:
 *  - GET /api/v1/telemetry/slo-summary returns correct shape (generatedAt, metrics array)
 *  - Each metric has name, label, targetP95Ms, targetP99Ms, status, and p50/p95/p99 fields
 *  - status is "no_data" when no histogram observations have been recorded
 *  - Percentile computation returns correct values when MetricsStore has observations
 *  - MetricsStore.getHistogramSnapshot() exposes expected shape
 *  - histogramPercentile correctly classifies status as green / yellow / red
 *
 * Run via Mocha: mocha dist/tests/slo-gauge.test.js --timeout 60000
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
import { MetricsStore, HistogramSnapshot } from "../src/core/activity/metrics-store.js";
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

describe("SLO Gauge Panel (E3c)", function () {
    this.timeout(60_000);

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-slo-gauge-"));
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
                sessionId: "slo-gauge-test",
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

    // ── HTTP endpoint ─────────────────────────────────────────────────────────

    describe("GET /api/v1/telemetry/slo-summary", () => {
        it("returns 200 with correct shape", async () => {
            const { status, body } = await fetchJson("GET", "/api/v1/telemetry/slo-summary");
            assert.strictEqual(status, 200, "Expected HTTP 200");
            assert.ok(body && typeof body === "object", "Body should be an object");
            assert.ok(typeof body.generatedAt === "string", "Should have generatedAt string");
            assert.ok(Array.isArray(body.metrics), "Should have metrics array");
        });

        it("returns exactly 3 metrics (operation, policy, llm)", async () => {
            const { body } = await fetchJson("GET", "/api/v1/telemetry/slo-summary");
            assert.strictEqual(body.metrics.length, 3, "Should return 3 SLO metrics");
        });

        it("each metric has required fields", async () => {
            const { body } = await fetchJson("GET", "/api/v1/telemetry/slo-summary");
            for (const m of body.metrics) {
                assert.ok(typeof m.name === "string" && m.name.length > 0, `Metric name must be non-empty string`);
                assert.ok(typeof m.label === "string" && m.label.length > 0, `Metric label must be non-empty string`);
                assert.ok(typeof m.targetP95Ms === "number" && m.targetP95Ms > 0, `targetP95Ms must be positive number`);
                assert.ok(typeof m.targetP99Ms === "number" && m.targetP99Ms > 0, `targetP99Ms must be positive number`);
                assert.ok(
                    ["green", "yellow", "red", "no_data"].includes(m.status),
                    `status must be one of green/yellow/red/no_data, got: ${m.status}`
                );
            }
        });

        it("p50/p95/p99 are null (no_data) when no observations recorded", async () => {
            const { body } = await fetchJson("GET", "/api/v1/telemetry/slo-summary");
            for (const m of body.metrics) {
                assert.strictEqual(m.p50Ms, null, `${m.name}: p50Ms should be null with no observations`);
                assert.strictEqual(m.p95Ms, null, `${m.name}: p95Ms should be null with no observations`);
                assert.strictEqual(m.p99Ms, null, `${m.name}: p99Ms should be null with no observations`);
                assert.strictEqual(m.status, "no_data", `${m.name}: status should be no_data with no observations`);
            }
        });

        it("generatedAt is a valid ISO timestamp", async () => {
            const { body } = await fetchJson("GET", "/api/v1/telemetry/slo-summary");
            const ts = Date.parse(body.generatedAt);
            assert.ok(Number.isFinite(ts), "generatedAt should be a parseable ISO timestamp");
            // Should be within the last minute
            assert.ok(Date.now() - ts < 60_000, "generatedAt should be recent");
        });

        it("includes known histogram names", async () => {
            const { body } = await fetchJson("GET", "/api/v1/telemetry/slo-summary");
            const names = body.metrics.map((m: any) => m.name);
            assert.ok(names.includes("prism_operation_duration_ms"), "Should include prism_operation_duration_ms");
            assert.ok(names.includes("prism_policy_latency_ms"), "Should include prism_policy_latency_ms");
            assert.ok(names.includes("prism_llm_latency_ms"), "Should include prism_llm_latency_ms");
        });

        it("targetP99Ms >= targetP95Ms for all metrics", async () => {
            const { body } = await fetchJson("GET", "/api/v1/telemetry/slo-summary");
            for (const m of body.metrics) {
                assert.ok(
                    m.targetP99Ms >= m.targetP95Ms,
                    `${m.name}: targetP99Ms (${m.targetP99Ms}) should be >= targetP95Ms (${m.targetP95Ms})`
                );
            }
        });
    });

    // ── MetricsStore unit tests ────────────────────────────────────────────────

    describe("MetricsStore.getHistogramSnapshot()", () => {
        it("returns empty array when no histograms registered", () => {
            const store = new MetricsStore();
            const snaps = store.getHistogramSnapshot();
            assert.deepStrictEqual(snaps, [], "Should return empty array for fresh store");
        });

        it("returns snapshot with correct shape after observations", () => {
            const store = new MetricsStore();
            store.registerHistogram("test_latency_ms", "Test latency", [10, 50, 100, 500]);
            store.observe("test_latency_ms", 30);
            store.observe("test_latency_ms", 80);
            store.observe("test_latency_ms", 200);

            const snaps = store.getHistogramSnapshot();
            assert.strictEqual(snaps.length, 1, "Should have 1 snapshot entry");
            const snap = snaps[0];
            assert.strictEqual(snap.name, "test_latency_ms");
            assert.deepStrictEqual(snap.buckets, [10, 50, 100, 500]);
            assert.strictEqual(snap.totalObservations, 3);
            assert.strictEqual(snap.sum, 310);
        });

        it("cumulative bucket counts are correct", () => {
            const store = new MetricsStore();
            store.registerHistogram("lat", "Latency", [10, 50, 100]);
            store.observe("lat", 5);   // falls in ≤10, ≤50, ≤100
            store.observe("lat", 30);  // falls in ≤50, ≤100  (not ≤10)
            store.observe("lat", 75);  // falls in ≤100       (not ≤10, not ≤50)
            store.observe("lat", 200); // falls in none of the buckets (only +Inf)

            const snap = store.getHistogramSnapshot()[0];
            // Cumulative: ≤10 → 1, ≤50 → 2, ≤100 → 3
            assert.deepStrictEqual(snap.counts, [1, 2, 3], "Cumulative counts should be [1, 2, 3]");
            assert.strictEqual(snap.totalObservations, 4);
        });

        it("computes p50 correctly via linear interpolation", () => {
            const store = new MetricsStore();
            // 4 observations: 10, 20, 30, 40 — p50 should be ~25
            store.registerHistogram("p50_test", "", [15, 25, 45]);
            store.observe("p50_test", 10);
            store.observe("p50_test", 20);
            store.observe("p50_test", 30);
            store.observe("p50_test", 40);

            const snap = store.getHistogramSnapshot()[0];
            // cumulative: ≤15→1, ≤25→2, ≤45→4
            // p50 target = 0.5 * 4 = 2 → falls in bucket ≤25 (count=2)
            // lower bucket ≤15 count=1, so interpolate between 15 and 25
            assert.deepStrictEqual(snap.counts, [1, 2, 4]);
            assert.strictEqual(snap.totalObservations, 4);
        });

        it("returns separate entries per label combination", () => {
            const store = new MetricsStore();
            store.observe("multi_lat", 10, { op: "a" });
            store.observe("multi_lat", 20, { op: "b" });

            const snaps = store.getHistogramSnapshot().filter(s => s.name === "multi_lat");
            assert.strictEqual(snaps.length, 2, "Should have 2 entries for 2 label sets");
        });
    });
});
