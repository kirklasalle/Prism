/**
 * Tool Contract Extractor — Approval Response Flow Tests
 *
 * Verifies the bidirectional approval flow added in May 2026:
 *   - consumeApprovalDecision() updates contract_changes for approve / deny / timeout
 *   - getContractChangeStatus() returns the latest decision for polling clients
 *   - synthetic insert path (when no pending row pre-exists, e.g. tier-3 enqueued
 *     without a baseline-diff comparison) records the resolved decision
 *
 * @test tests/tool-contract-extractor-approval-flow.test.ts
 */

import * as assert from "assert";
import { describe, it, beforeEach, afterEach } from "mocha";
import sqlite3 from "sqlite3";
import { ToolContractExtractor } from "../src/core/tools/tool-contract-extractor.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { ActivityBus } from "../src/core/activity/bus.js";

describe("Tool Contract Extractor — Approval Response Flow", () => {
    let extractor: ToolContractExtractor;
    let db: sqlite3.Database;
    let bus: ActivityBus;
    let events: any[];

    beforeEach(() => {
        db = new sqlite3.Database(":memory:");
        bus = new ActivityBus();
        events = [];
        bus.subscribe({ onEvent: (evt: any) => { events.push(evt); } });
        extractor = new ToolContractExtractor(db, new PolicyEngine(), bus);
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => db.close(() => resolve()));
    });

    it("consumeApprovalDecision('approved') records and emits an approval_resolved event", async () => {
        const result = await extractor.consumeApprovalDecision("tool-alpha", "approved", {
            decisionSource: "approval_queue",
            decidedBy: "operator-1",
        });
        assert.strictEqual(result.tool_id, "tool-alpha");
        assert.strictEqual(result.decision, "approved");
        assert.strictEqual(result.updated, true);

        const status = await extractor.getContractChangeStatus("tool-alpha");
        assert.ok(status, "status row should exist");
        assert.strictEqual(status!.approval_status, "approved");

        const resolved = events.find((e) => e.operation === "tool.stage.approval_resolved");
        assert.ok(resolved, "should emit tool.stage.approval_resolved");
        assert.strictEqual(resolved.status, "succeeded");
        assert.strictEqual(resolved.policyDecision, "allow");
        assert.strictEqual(resolved.details.decision, "approved");
        assert.strictEqual(resolved.details.decisionSource, "approval_queue");
    });

    it("consumeApprovalDecision('denied') stores deny and emits with policyDecision=deny", async () => {
        await extractor.consumeApprovalDecision("tool-bravo", "denied");
        const status = await extractor.getContractChangeStatus("tool-bravo");
        assert.strictEqual(status!.approval_status, "denied");

        const resolved = events.find((e) => e.operation === "tool.stage.approval_resolved");
        assert.ok(resolved);
        assert.strictEqual(resolved.status, "failed");
        assert.strictEqual(resolved.policyDecision, "deny");
        assert.strictEqual(resolved.details.decision, "denied");
    });

    it("consumeApprovalDecision('timeout') records timeout for downstream observability", async () => {
        await extractor.consumeApprovalDecision("tool-charlie", "timeout");
        const status = await extractor.getContractChangeStatus("tool-charlie");
        assert.strictEqual(status!.approval_status, "timeout");

        const resolved = events.find((e) => e.operation === "tool.stage.approval_resolved");
        assert.strictEqual(resolved.details.decision, "timeout");
    });

    it("getContractChangeStatus returns null for an unknown tool", async () => {
        const status = await extractor.getContractChangeStatus("nope");
        assert.strictEqual(status, null);
    });

    it("returns the most recent decision when multiple resolutions occur for one tool", async () => {
        await extractor.consumeApprovalDecision("tool-delta", "denied");
        // Small delay so created_timestamp differs (CURRENT_TIMESTAMP has 1s resolution).
        await new Promise((r) => setTimeout(r, 1100));
        await extractor.consumeApprovalDecision("tool-delta", "approved");
        const status = await extractor.getContractChangeStatus("tool-delta");
        assert.strictEqual(status!.approval_status, "approved");
    });
});
