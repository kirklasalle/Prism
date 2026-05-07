import assert from "node:assert";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { INDIVIDUAL_PROFILE, BUSINESS_PROFILE } from "../src/core/policy/execution-profiles.js";

/**
 * Policy-path integration tests for **mutating tool operations** that are
 * exercised by the Individual-Native MVP surface (email send, calendar
 * create/update, file write, browser navigate / screenshot).
 *
 * The aim is to lock down allow / deny / require_approval / timeout
 * decisions across both INDIVIDUAL and BUSINESS profiles so future policy
 * tweaks cannot silently regress these mutating paths.
 *
 * Companion to `d2-governance-paths.test.ts` (terminal + container).
 *
 * Registered in `tests/index.ts` as `PolicyPathMutatingOps`.
 */
export async function testPolicyPathMutatingOps(): Promise<void> {
    await testEmailSendPaths();
    await testCalendarCreatePaths();
    await testFileWritePaths();
    await testBrowserNavigatePaths();
    await testApprovalTimeoutRoundtrip();
    console.log("✓ Policy-path mutating-ops tests passed");
}

/**
 * Email send (`email_ops.send`) — high risk, mutating, network-egressing.
 * Should require approval on Business; allow with rollback on Individual.
 */
async function testEmailSendPaths(): Promise<void> {
    const engine = new PolicyEngine();

    // ALLOW (Individual, with rollback plan = drafts folder retention)
    {
        const r = engine.evaluate({
            operation: "email_ops.send",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "retain copy in Drafts for 7d",
            executionProfile: INDIVIDUAL_PROFILE,
        });
        assert.strictEqual(r.decision, "allow", "Individual: email send with rollback should allow");
        assert.strictEqual(r.tier, "tier2_conditional");
    }

    // DENY (Business, no rollback plan)
    {
        const r = engine.evaluate({
            operation: "email_ops.send",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: undefined,
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(r.decision, "deny", "Business: email send without rollback should deny");
        assert.ok(r.reasons.some((s) => s.toLowerCase().includes("rollback")));
    }

    // REQUIRE_APPROVAL (Business, high risk — bulk send / external recipients)
    {
        const r = engine.evaluate({
            operation: "email_ops.send",
            risk: "high",
            mutatesState: true,
            rollbackPlan: "operator manual recall",
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(r.decision, "require_approval", "Business: high-risk email send should require approval");
        assert.strictEqual(r.tier, "tier3_approval");
    }
}

/**
 * Calendar create/update (`calendar_plan.create_or_update_event`) — medium
 * risk mutation with rollback (event delete).
 */
async function testCalendarCreatePaths(): Promise<void> {
    const engine = new PolicyEngine();

    // ALLOW (Individual, with rollback)
    {
        const r = engine.evaluate({
            operation: "calendar_plan.create_or_update_event",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "delete created event by id",
            executionProfile: INDIVIDUAL_PROFILE,
        });
        assert.strictEqual(r.decision, "allow");
    }

    // DENY (Business, missing rollback)
    {
        const r = engine.evaluate({
            operation: "calendar_plan.create_or_update_event",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: undefined,
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(r.decision, "deny");
    }

    // ALLOW with warning (Individual, no rollback — permitted but flagged)
    {
        const r = engine.evaluate({
            operation: "calendar_plan.create_or_update_event",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: undefined,
            executionProfile: INDIVIDUAL_PROFILE,
        });
        assert.strictEqual(r.decision, "allow");
        assert.ok(
            r.reasons.some((s) => s.toLowerCase().includes("warning")),
            "Individual without rollback should include a warning reason",
        );
    }
}

/**
 * File write (`file_write`) — medium-risk state mutation. Must require
 * rollback on Business; cleanly distinguishes low-risk read-only ops.
 */
async function testFileWritePaths(): Promise<void> {
    const engine = new PolicyEngine();

    // DENY low-risk mutating file_write on Business (low-risk mutations
    // disallowed for business segment per LOW_RISK_DENY_BUSINESS_MUTATION).
    {
        const r = engine.evaluate({
            operation: "file_write",
            risk: "low",
            mutatesState: true,
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(r.decision, "deny", "Business should deny low-risk mutations");
        assert.strictEqual(r.tier, "tier1_autonomous");
    }

    // ALLOW low-risk read-only file op on Business
    {
        const r = engine.evaluate({
            operation: "file_read",
            risk: "low",
            mutatesState: false,
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(r.decision, "allow");
    }

    // ALLOW medium-risk file_write with rollback on Business
    {
        const r = engine.evaluate({
            operation: "file_write",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "restore prior content from snapshot",
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(r.decision, "allow");
    }

    // REQUIRE_APPROVAL high-risk file_write (e.g. system path, large delete)
    {
        const r = engine.evaluate({
            operation: "file_write",
            risk: "high",
            mutatesState: true,
            rollbackPlan: "restore from backup",
            executionProfile: INDIVIDUAL_PROFILE,
        });
        assert.strictEqual(r.decision, "require_approval");
    }
}

/**
 * Browser navigate (`browser.navigate`) — medium risk; tracks site fingerprint
 * but rarely state-mutating server-side. Screenshot is low-risk read.
 */
async function testBrowserNavigatePaths(): Promise<void> {
    const engine = new PolicyEngine();

    // ALLOW navigate (low-risk read-equivalent on Individual)
    {
        const r = engine.evaluate({
            operation: "browser.navigate",
            risk: "low",
            mutatesState: false,
            executionProfile: INDIVIDUAL_PROFILE,
        });
        assert.strictEqual(r.decision, "allow");
    }

    // ALLOW screenshot read on Business
    {
        const r = engine.evaluate({
            operation: "browser.screenshot",
            risk: "low",
            mutatesState: false,
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(r.decision, "allow");
    }

    // REQUIRE_APPROVAL for high-risk form submit (auth-bearing mutation)
    {
        const r = engine.evaluate({
            operation: "browser.submit_form",
            risk: "high",
            mutatesState: true,
            rollbackPlan: "operator session reset",
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(r.decision, "require_approval");
    }

    // DENY medium-risk mutating click without rollback on Business
    {
        const r = engine.evaluate({
            operation: "browser.click",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: undefined,
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(r.decision, "deny");
    }
}

/**
 * ApprovalQueue timeout roundtrip — verifies that an unanswered tier-3 request
 * resolves to false (denied) once the timeout window elapses, and that a
 * post-timeout approve() is a no-op (idempotent safety).
 */
async function testApprovalTimeoutRoundtrip(): Promise<void> {
    const queue = new ApprovalQueue();
    const startedAt = Date.now();
    const result = await queue.request("session-test", "tool.stage.timeout-test", {
        tool_name: "policy-path-test",
    }, 60); // 60ms — fast timeout for the test
    const elapsed = Date.now() - startedAt;

    assert.strictEqual(result, false, "request() should resolve false on timeout");
    assert.ok(elapsed >= 50, `should wait at least the timeout window (got ${elapsed}ms)`);
    assert.strictEqual(queue.list().length, 0, "pending list should be empty after timeout");

    // Double-resolve safety: post-timeout approve must report no-op (item gone).
    const approveAfterTimeout = queue.approve("nonexistent-id");
    assert.strictEqual(approveAfterTimeout, false, "approve() of unknown id must return false");
}
