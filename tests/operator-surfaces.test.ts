import assert from "node:assert";
import { SqliteActivityStore } from "../src/core/activity/sqlite-store.js";
import { ActivityEvent } from "../src/core/activity/types.js";
import { SessionTraceExplorer } from "../src/core/operator/session-trace-explorer.js";
import { PolicyAuditExporter } from "../src/core/operator/policy-audit-exporter.js";

function makeEvent(overrides: Partial<ActivityEvent> & { id: string }): ActivityEvent {
    return {
        timestamp: new Date("2026-03-18T12:00:00.000Z").toISOString(),
        sessionId: "session-test",
        layer: "tool_execution",
        operation: "file_read",
        status: "succeeded",
        details: {},
        sideEffects: [],
        ...overrides,
    };
}

function seedStore(): SqliteActivityStore {
    const store = new SqliteActivityStore(":memory:");

    const events: ActivityEvent[] = [
        makeEvent({
            id: "e1",
            timestamp: "2026-03-18T10:00:00.000Z",
            operation: "file_read",
            layer: "tool_execution",
            status: "succeeded",
            authorityTier: "tier1_autonomous",
            policyDecision: "allow",
            confidence: 0.9,
            durationMs: 50,
            hash: "h1",
        }),
        makeEvent({
            id: "e2",
            timestamp: "2026-03-18T10:01:00.000Z",
            operation: "file_write",
            layer: "tool_execution",
            status: "succeeded",
            authorityTier: "tier2_conditional",
            policyDecision: "require_approval",
            confidence: 0.7,
            durationMs: 80,
            sideEffects: [
                { type: "file", description: "wrote test.txt", mutating: true, reversible: true },
            ],
            hash: "h2",
        }),
        makeEvent({
            id: "e3",
            timestamp: "2026-03-18T10:02:00.000Z",
            operation: "network_call",
            layer: "agent",
            status: "failed",
            authorityTier: "tier3_approval",
            policyDecision: "deny",
            confidence: 0.4,
            durationMs: 120,
            details: { reason: "policy_violation", code: "ERR_DENY" },
            sideEffects: [
                { type: "network", description: "external call", mutating: true, reversible: false },
            ],
            hash: "h3",
            rollbackPlan: "revert network state",
        }),
        makeEvent({
            id: "e4",
            timestamp: "2026-03-18T10:03:00.000Z",
            sessionId: "session-other",
            operation: "file_read",
            layer: "episodic",
            status: "succeeded",
            policyDecision: "allow",
            hash: "h4",
        }),
    ];

    for (const event of events) {
        store.onEvent(event);
    }

    return store;
}

export async function testSessionTraceExplorer(): Promise<void> {
    const store = seedStore();
    const explorer = new SessionTraceExplorer(store);

    const sessionEvents = explorer.query({ sessionId: "session-test" });
    assert.strictEqual(sessionEvents.length, 3);
    assert.strictEqual(sessionEvents[0]?.id, "e1");
    assert.strictEqual(sessionEvents[2]?.id, "e3");

    const agentEvents = explorer.query({ sessionId: "session-test", layer: "agent" });
    assert.strictEqual(agentEvents.length, 1);
    assert.strictEqual(agentEvents[0]?.id, "e3");

    const tier1Events = explorer.query({ sessionId: "session-test", authorityTier: "tier1_autonomous" });
    assert.strictEqual(tier1Events.length, 1);

    const deniedEvents = explorer.query({ sessionId: "session-test", policyDecision: "deny" });
    assert.strictEqual(deniedEvents.length, 1);

    const failedEvents = explorer.query({ sessionId: "session-test", status: "failed" });
    assert.strictEqual(failedEvents.length, 1);

    const rangeEvents = explorer.query({
        sessionId: "session-test",
        fromTimestamp: "2026-03-18T10:00:30.000Z",
        toTimestamp: "2026-03-18T10:01:30.000Z",
    });
    assert.strictEqual(rangeEvents.length, 1);
    assert.strictEqual(rangeEvents[0]?.id, "e2");

    const validChain = explorer.verifyHashChain(sessionEvents);
    assert.ok(validChain.valid);
    assert.strictEqual(validChain.totalEvents, 3);

    const missingHashChain = explorer.verifyHashChain([
        { ...sessionEvents[0]! },
        { ...sessionEvents[1]!, hash: undefined },
        { ...sessionEvents[2]! },
    ]);
    assert.ok(!missingHashChain.valid);
    assert.strictEqual(missingHashChain.firstBreakIndex, 1);

    const duplicateHashChain = explorer.verifyHashChain([
        { ...sessionEvents[0]! },
        { ...sessionEvents[1]!, hash: "h1" },
        { ...sessionEvents[2]! },
    ]);
    assert.ok(!duplicateHashChain.valid);

    const summary = explorer.summarize(sessionEvents);
    assert.strictEqual(summary.statusCounts.succeeded, 2);
    assert.strictEqual(summary.statusCounts.failed, 1);
    assert.strictEqual(summary.layerCounts.tool_execution, 2);
    assert.strictEqual(summary.layerCounts.agent, 1);
    assert.strictEqual(summary.policyDecisionCounts.allow, 1);
    assert.strictEqual(summary.policyDecisionCounts.deny, 1);
    assert.strictEqual(summary.policyDecisionCounts.require_approval, 1);
    assert.strictEqual(summary.totalDurationMs, 250);
    assert.ok(summary.avgConfidence !== null);

    const bundle = explorer.exportBundle({ sessionId: "session-test" });
    assert.strictEqual(bundle.eventCount, 3);
    assert.ok(bundle.hashChain.valid);
    assert.strictEqual(bundle.sessionId, "session-test");

    store.close();
    console.log("✓ SessionTraceExplorer tests passed");
}

export async function testPolicyAuditExporter(): Promise<void> {
    const store = seedStore();
    const exporter = new PolicyAuditExporter(store);

    const bundle = exporter.exportBundle({ sessionId: "session-test" });
    assert.strictEqual(bundle.recordCount, 3);
    assert.strictEqual(bundle.records[0]?.eventId, "e1");
    assert.strictEqual(bundle.records[2]?.eventId, "e3");

    assert.strictEqual(bundle.stats.total, 3);
    assert.strictEqual(bundle.stats.allow, 1);
    assert.strictEqual(bundle.stats.deny, 1);
    assert.strictEqual(bundle.stats.require_approval, 1);
    assert.ok(Math.abs(bundle.stats.denyRate - 1 / 3) < 0.001);
    assert.ok(Math.abs(bundle.stats.approvalGateRate - 1 / 3) < 0.001);

    const denyBundle = exporter.exportBundle({ sessionId: "session-test", decision: "deny" });
    assert.strictEqual(denyBundle.recordCount, 1);
    assert.strictEqual(denyBundle.records[0]?.eventId, "e3");

    const tierBundle = exporter.exportBundle({
        sessionId: "session-test",
        authorityTier: "tier2_conditional",
    });
    assert.strictEqual(tierBundle.recordCount, 1);
    assert.strictEqual(tierBundle.records[0]?.eventId, "e2");

    const denyRecord = bundle.records.find((record) => record.policyDecision === "deny");
    assert.ok(denyRecord);
    assert.strictEqual(denyRecord?.sideEffectCount, 1);
    assert.strictEqual(denyRecord?.mutatingEffects, 1);
    assert.strictEqual(denyRecord?.irreversibleEffects, 1);
    assert.strictEqual(denyRecord?.rollbackPlan, "revert network state");
    assert.ok(denyRecord?.reasonCodes.some((code) => code.startsWith("reason:")));
    assert.ok(denyRecord?.reasonCodes.some((code) => code.startsWith("code:")));

    const allSessionsBundle = exporter.exportBundle({});
    assert.ok(allSessionsBundle.records.some((record) => record.sessionId === "session-other"));
    assert.ok(bundle.records.every((record) => record.sessionId === "session-test"));

    const emptyBundle = exporter.exportBundle({ sessionId: "no-such-session" });
    assert.strictEqual(emptyBundle.recordCount, 0);
    assert.strictEqual(emptyBundle.stats.total, 0);
    assert.strictEqual(emptyBundle.stats.denyRate, 0);

    store.close();
    console.log("✓ PolicyAuditExporter tests passed");
}