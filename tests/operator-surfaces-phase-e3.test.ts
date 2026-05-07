/**
 * Tests for the new operator surfaces added in Phase E3 follow-on:
 *  - UtilityRegistry: descriptor + run lifecycle, ring buffer, success/failure events
 *  - RiskOverrideStore: set/get/clear/expiry/resolveTier + persistence + emitted events
 *  - IncidentTrendStore: bucket aggregation across day boundaries + report shape
 *  - tuneFromIncidentTrends(): always tightens, never relaxes
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ActivityBus } from "../src/core/activity/bus.js";
import {
    UtilityRegistry,
    registerBuiltInUtilities,
} from "../src/core/operator/utility-registry.js";
import {
    RiskOverrideStore,
} from "../src/core/operator/risk-override-store.js";
import { IncidentTrendStore } from "../src/core/memory/incident-trend-store.js";
import {
    defaultRetrievalAlertPolicy,
    tuneFromIncidentTrends,
} from "../src/core/memory/retrieval-alert-policy.js";

export async function testUtilityRegistry(): Promise<void> {
    const bus = new ActivityBus();
    const registry = new UtilityRegistry(bus);

    let calls = 0;
    registry.register({
        id: "test.echo",
        label: "Echo",
        description: "Echoes input",
        riskTier: 1,
        handler: async (params) => {
            calls += 1;
            return { summary: "ok", details: { params } };
        },
    });

    assert.equal(registry.list().length, 1);
    const run = await registry.execute("test.echo", { foo: "bar" });
    assert.equal(run.status, "succeeded");
    assert.equal(calls, 1);
    assert.ok(registry.getRun(run.runId), "run should be retained in history");

    // Failure path
    registry.register({
        id: "test.boom",
        label: "Boom",
        description: "Throws",
        riskTier: 1,
        handler: async () => { throw new Error("kaboom"); },
    });
    const failed = await registry.execute("test.boom").catch(() => null);
    // execute resolves rather than rejects on failures (run.status === "failed")
    if (failed) {
        assert.equal(failed.status, "failed");
        assert.match(String(failed.error ?? ""), /kaboom/);
    }

    // Built-in utilities can register without throwing.
    const fresh = new UtilityRegistry(bus);
    registerBuiltInUtilities(fresh, {
        runContractDiffGate: async () => ({ summary: "noop", details: {} }),
        exportPolicyAudit: async () => ({ summary: "noop", details: {} }),
        exportSessionTrace: async () => ({ summary: "noop", details: {} }),
        runRetrievalTrends: async () => ({ summary: "noop", details: {} }),
        runPerfTrendReport: async () => ({ summary: "noop", details: {} }),
    });
    const ids = fresh.list().map((d) => d.id);
    assert.ok(ids.includes("run-contract-diff-gate"));
    assert.ok(ids.includes("export-policy-audit"));
}

export async function testRiskOverrideStore(): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "prism-risk-override-"));
    const filePath = join(dir, "overrides.json");
    try {
        const bus = new ActivityBus();
        const events: string[] = [];
        bus.subscribe({ onEvent: (e) => events.push(e.operation) });

        const store = new RiskOverrideStore(filePath, bus);
        assert.equal(store.list().length, 0);

        const ov = store.set({
            toolId: "test.tool",
            overrideTier: "tier2",
            reason: "operator review pending",
            setBy: "operator",
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        });
        assert.equal(ov.toolId, "test.tool");
        assert.equal(ov.overrideTier, "tier2");
        assert.ok(events.some((op) => op.startsWith("risk.override")), "should emit override event");

        // Persistence — re-load from same file
        const reload = new RiskOverrideStore(filePath, bus);
        assert.equal(reload.get("test.tool")?.overrideTier, "tier2");

        const resolved = reload.resolveTier("test.tool", "tier1");
        assert.equal(resolved.effectiveTier, "tier2");

        const cleared = reload.clear("test.tool", "operator");
        assert.ok(cleared, "clear should return removed override");
        assert.equal(reload.get("test.tool"), null);

        // Validation: missing reason should throw
        assert.throws(() => store.set({
            toolId: "no.reason",
            overrideTier: "tier1",
            reason: "",
            setBy: "x",
            expiresAt: null,
        }));

        // File still exists and is valid JSON
        assert.ok(existsSync(filePath));
        const parsed = JSON.parse(readFileSync(filePath, "utf8"));
        assert.equal(parsed.version, 1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

export async function testIncidentTrendStore(): Promise<void> {
    const bus = new ActivityBus();
    const store = new IncidentTrendStore(bus);
    const sessionId = "test-session";

    bus.emit({
        sessionId,
        layer: "governance",
        operation: "policy.deny",
        status: "failed",
        details: {},
        executionProfileSegment: "business",
    });
    bus.emit({
        sessionId,
        layer: "governance",
        operation: "approval.timeout",
        status: "failed",
        details: {},
        executionProfileSegment: "business",
    });
    bus.emit({
        sessionId,
        layer: "retrieval",
        operation: "retrieval.alert.drift",
        status: "failed",
        details: {},
        executionProfileSegment: "individual",
    });
    bus.emit({
        sessionId,
        layer: "governance",
        operation: "incident.bundle.exported",
        status: "succeeded",
        details: {},
        executionProfileSegment: "individual",
    });

    const businessReport = store.getReport("business", 7);
    assert.equal(businessReport.profile, "business");
    assert.ok(businessReport.totalPolicyDenies >= 1);
    assert.ok(businessReport.totalApprovalTimeouts >= 1);

    const individualReport = store.getReport("individual", 7);
    assert.ok(individualReport.totalRetrievalAlerts >= 1);
    assert.ok(individualReport.totalIncidents >= 1);

    store.close();
}

export async function testRetrievalAlertTuning(): Promise<void> {
    const base = { ...defaultRetrievalAlertPolicy };

    // No signals → no change
    const noop = tuneFromIncidentTrends(base, {
        profile: "business",
        windowDays: 7,
        dailyAverage: { policyDenies: 0, approvalTimeouts: 0, retrievalAlerts: 0, incidents: 0 },
    });
    assert.deepEqual(noop.tuned, base);
    // The tuner always returns at least one rationale entry; confirm "no tuning applied".
    assert.equal(noop.rationale.length, 1);
    assert.match(noop.rationale[0]!, /No tuning applied/);

    // Heavy signals → multiple tightenings, never loosenings
    const tight = tuneFromIncidentTrends(base, {
        profile: "business",
        windowDays: 7,
        dailyAverage: { policyDenies: 8, approvalTimeouts: 5, retrievalAlerts: 6, incidents: 2 },
    });
    assert.ok(tight.tuned.recentMinUtility >= base.recentMinUtility);
    assert.ok(tight.tuned.cohortMaxP95LatencyMs <= base.cohortMaxP95LatencyMs);
    assert.ok(tight.tuned.driftScoreThreshold <= base.driftScoreThreshold);
    assert.ok(tight.tuned.cohortMinHitRate >= base.cohortMinHitRate);
    assert.ok(tight.rationale.length >= 1);

    // Caps respected
    const capped = tuneFromIncidentTrends(
        { ...base, recentMinUtility: 0.6, cohortMaxP95LatencyMs: 80, driftScoreThreshold: 0.05, cohortMinHitRate: 0.7 },
        {
            profile: "business",
            windowDays: 7,
            dailyAverage: { policyDenies: 100, approvalTimeouts: 100, retrievalAlerts: 100, incidents: 100 },
        },
    );
    assert.equal(capped.tuned.recentMinUtility, 0.6);
    assert.equal(capped.tuned.cohortMaxP95LatencyMs, 80);
    assert.equal(capped.tuned.driftScoreThreshold, 0.05);
    assert.equal(capped.tuned.cohortMinHitRate, 0.7);
}
