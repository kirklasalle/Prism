import assert from "node:assert";
import { PolicyEngine } from "../src/core/policy/engine.js";

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
    const highWhitelisted = engine.evaluate({
        operation: "shell_exec",
        risk: "high",
        mutatesState: true,
        rollbackPlan: "snapshot restore",
        isWhitelisted: true,
    });
    assert.strictEqual(highWhitelisted.tier, "tier3_approval");
    assert.strictEqual(highWhitelisted.decision, "allow");

    console.log("✓ PolicyEngine tests passed");
}
