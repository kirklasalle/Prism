import assert from "node:assert";
import { PolicyEngine } from "../src/core/policy/engine.js";

import { INDIVIDUAL_PROFILE, BUSINESS_PROFILE } from "../src/core/policy/execution-profiles.js";
import type { ExecutionProfile } from "../src/core/policy/execution-profiles.js";

export async function testPolicyEngine(): Promise<void> {
    const engine = new PolicyEngine();

    // Test: low-risk operation should always be tier1_autonomous
    const lowRisk = engine.evaluate({
        operation: "file_list",
        risk: "low",
        mutatesState: false,
        rollbackPlan: undefined,
        isWhitelisted: false,
    });
    assert.strictEqual(lowRisk.tier, "tier1_autonomous");
    assert.strictEqual(lowRisk.decision, "allow");

    // Test: medium-risk with mutation but no rollback should still be tier2 but conditional
    const mediumNoRollback = engine.evaluate({
        operation: "file_write",
        risk: "medium",
        mutatesState: true,
        rollbackPlan: undefined,
        isWhitelisted: false,
        executionProfile: BUSINESS_PROFILE,
    });
    assert.strictEqual(mediumNoRollback.tier, "tier2_conditional");
    assert.strictEqual(mediumNoRollback.decision, "deny");

    // Test: medium-risk with mutation and rollback should be tier2_allow
    const mediumWithRollback = engine.evaluate({
        operation: "file_write",
        risk: "medium",
        mutatesState: true,
        rollbackPlan: "git revert",
        isWhitelisted: false,
    });
    assert.strictEqual(mediumWithRollback.tier, "tier2_conditional");
    assert.strictEqual(mediumWithRollback.decision, "allow");

    // Test: high-risk without rollback is tier3_approval/require_approval
    const highNoRollback = engine.evaluate({
        operation: "shell_exec",
        risk: "high",
        mutatesState: true,
        rollbackPlan: undefined,
        isWhitelisted: false,
    });
    assert.strictEqual(highNoRollback.tier, "tier3_approval");
    assert.strictEqual(highNoRollback.decision, "require_approval");

    // Test: high-risk with rollback but not whitelisted should still require approval
    const highWithRollback = engine.evaluate({
        operation: "shell_exec",
        risk: "high",
        mutatesState: true,
        rollbackPlan: "revert via snapshot",
        isWhitelisted: false,
    });
    assert.strictEqual(highWithRollback.tier, "tier3_approval");
    assert.strictEqual(highWithRollback.decision, "require_approval");

    // Test: high-risk whitelisted should be tier3_allow
    const bypassProfile: ExecutionProfile = {
        segment: "business",
        tier1AutonomuousAllowed: true,
        tier2ConditionalAllowed: true,
        tier3ApprovalRequired: true,
        tier3WhitelistBypass: true,  // Enable whitelist bypass for this test
        rollbackPlanRequired: true,
        auditAllOperations: true,
        description: "Test profile with whitelist bypass enabled",
    };

    const highWhitelisted = engine.evaluate({
        operation: "shell_exec",
        risk: "high",
        mutatesState: true,
        rollbackPlan: "snapshot restore",
        isWhitelisted: true,
        executionProfile: bypassProfile,
    });
    assert.strictEqual(highWhitelisted.tier, "tier3_approval");
    assert.strictEqual(highWhitelisted.decision, "allow");

    console.log("✓ PolicyEngine tests passed");
}
