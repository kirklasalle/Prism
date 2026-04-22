/**
 * Tests for UsageMeteringService — record, getSummary, getCaps/setCaps,
 * checkCap (session / daily / monthly caps), and cap-allowed pass-through.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageMeteringService } from "../src/core/operator/usage-metering-service.js";

describe("UsageMeteringService", () => {
    let tmpDir: string;
    let dbPath: string;
    let svc: UsageMeteringService;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-ums-test-"));
        dbPath = join(tmpDir, "usage.db");
        svc = new UsageMeteringService(dbPath);
    });

    after(() => {
        // Close the SQLite handles before removing temp files (required on Windows).
        try { (svc as unknown as { db: { close(): void } }).db.close(); } catch { /* ignore */ }
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore on Windows lock */ }
    });

    // ── Schema / bootstrap ───────────────────────────────────────────────

    it("constructs without throwing and returns an empty summary", () => {
        const summary = svc.getSummary("1h");
        assert.equal(summary.totalRequests, 0);
        assert.equal(summary.totalCostUsd, 0);
        assert.equal(summary.byModel.length, 0);
    });

    // ── record() ────────────────────────────────────────────────────────

    it("records a usage entry and reflects it in getSummary", () => {
        svc.record({
            provider: "openai",
            model: "gpt-4o",
            sessionId: "sess-1",
            inputTokens: 100,
            outputTokens: 50,
            costUsd: 0.002,
        });
        const summary = svc.getSummary("1h");
        assert.equal(summary.totalRequests, 1);
        assert.equal(summary.totalInputTokens, 100);
        assert.equal(summary.totalOutputTokens, 50);
        assert.ok(summary.totalCostUsd > 0);
    });

    it("records multiple entries and aggregates correctly", () => {
        svc.record({ provider: "openai", model: "gpt-4o", sessionId: "sess-1", inputTokens: 200, outputTokens: 100, costUsd: 0.004 });
        svc.record({ provider: "anthropic", model: "claude-3-5-sonnet", sessionId: "sess-2", inputTokens: 300, outputTokens: 150, costUsd: 0.009 });

        const summary = svc.getSummary("1h");
        assert.ok(summary.totalRequests >= 3, "at least 3 total requests recorded");
        assert.equal(summary.byModel.length >= 2, true, "at least 2 model rows");
    });

    it("getSummary byModel contains provider and model fields", () => {
        const summary = svc.getSummary("1h");
        const openAiRow = summary.byModel.find((r) => r.provider === "openai");
        assert.ok(openAiRow, "openai row present");
        assert.equal(openAiRow?.model, "gpt-4o");
        assert.ok(openAiRow?.requests >= 2);
    });

    it("getSummary includes session, daily, and monthly cost breakdowns", () => {
        const summary = svc.getSummary("1d");
        assert.ok(typeof summary.sessionCostUsd === "number");
        assert.ok(typeof summary.dailyCostUsd === "number");
        assert.ok(typeof summary.monthlyCostUsd === "number");
    });

    // ── getCaps / setCaps ────────────────────────────────────────────────

    it("getCaps returns null caps when none are set", () => {
        const caps = svc.getCaps();
        assert.equal(caps.sessionCap, null);
        assert.equal(caps.dailyCap, null);
        assert.equal(caps.monthlyCap, null);
    });

    it("setCaps persists caps and getCaps retrieves them", () => {
        svc.setCaps({ sessionCap: 5.0, dailyCap: 20.0, monthlyCap: 100.0 });
        const caps = svc.getCaps();
        assert.equal(caps.sessionCap, 5.0);
        assert.equal(caps.dailyCap, 20.0);
        assert.equal(caps.monthlyCap, 100.0);
    });

    it("setCaps can update individual caps via upsert", () => {
        svc.setCaps({ sessionCap: 10.0, dailyCap: null, monthlyCap: 200.0 });
        const caps = svc.getCaps();
        assert.equal(caps.sessionCap, 10.0);
        assert.equal(caps.dailyCap, null);
        assert.equal(caps.monthlyCap, 200.0);
    });

    it("getSummary.caps reflects the active cap configuration", () => {
        svc.setCaps({ sessionCap: 10.0, dailyCap: null, monthlyCap: 200.0 });
        const summary = svc.getSummary("1h");
        assert.equal(summary.caps.sessionCap, 10.0);
        assert.equal(summary.caps.dailyCap, null);
        assert.equal(summary.caps.monthlyCap, 200.0);
    });

    // ── checkCap ────────────────────────────────────────────────────────

    it("checkCap returns allowed:true when no caps are configured", () => {
        // Reset caps
        svc.setCaps({ sessionCap: null, dailyCap: null, monthlyCap: null });
        const result = svc.checkCap();
        assert.equal(result.allowed, true);
        assert.equal(result.remainingUsd, null);
        assert.equal(result.capType, null);
    });

    it("checkCap returns allowed:true with remaining headroom when spend is under cap", () => {
        // Set a high session cap that won't be exceeded by test data
        svc.setCaps({ sessionCap: 1000.0, dailyCap: null, monthlyCap: null });
        const result = svc.checkCap();
        assert.equal(result.allowed, true);
        assert.ok(result.remainingUsd !== null && result.remainingUsd > 0);
        assert.equal(result.capType, "session");
    });

    it("checkCap returns allowed:false when session cap is breached", () => {
        // Create a fresh metering service with a very low cap
        const lowCapDbPath = join(tmpDir, "low-cap.db");
        const lowCapSvc = new UsageMeteringService(lowCapDbPath);
        try {
            lowCapSvc.setCaps({ sessionCap: 0.001, dailyCap: null, monthlyCap: null });

            // Record spend that exceeds the session cap
            lowCapSvc.record({ provider: "openai", model: "gpt-4o", sessionId: "s", inputTokens: 10, outputTokens: 5, costUsd: 0.01 });

            const result = lowCapSvc.checkCap();
            assert.equal(result.allowed, false);
            assert.equal(result.capType, "session");
        } finally {
            try { (lowCapSvc as unknown as { db: { close(): void } }).db.close(); } catch { /* ignore */ }
        }
    });

    it("checkCap reports daily cap type when daily cap is breached", () => {
        const dailyCapDbPath = join(tmpDir, "daily-cap.db");
        const dailySvc = new UsageMeteringService(dailyCapDbPath);
        try {
            dailySvc.setCaps({ sessionCap: null, dailyCap: 0.001, monthlyCap: null });
            dailySvc.record({ provider: "openai", model: "gpt-4o", sessionId: "s", inputTokens: 10, outputTokens: 5, costUsd: 0.02 });

            const result = dailySvc.checkCap();
            assert.equal(result.allowed, false);
            assert.equal(result.capType, "daily");
        } finally {
            try { (dailySvc as unknown as { db: { close(): void } }).db.close(); } catch { /* ignore */ }
        }
    });
});
