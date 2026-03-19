import assert from "node:assert";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { TerminalSessionTool } from "../src/adapters/system/terminal-session-tool.js";
import { ContainerSandboxTool } from "../src/adapters/system/container-sandbox-tool.js";
import { INDIVIDUAL_PROFILE, BUSINESS_PROFILE } from "../src/core/policy/execution-profiles.js";
import type { ToolRequest } from "../src/core/tools/types.js";

const baseRequest: ToolRequest = {
    operation: "",
    args: {},
    risk: "low",
    mutatesState: false,
};

export async function testD2GovernancePaths(): Promise<void> {
    await testTerminalGovernancePaths();
    await testContainerGovernancePaths();
    console.log("✓ D2 governance-path tests passed");
}

/**
 * Terminal session governance paths: allow, deny, timeout, revoke for long-running sessions.
 * Validates that terminal operations respect policy tiers and profile constraints.
 */
async function testTerminalGovernancePaths(): Promise<void> {
    const tool = new TerminalSessionTool();
    const policyEngine = new PolicyEngine();

    // Test 1: ALLOW path for terminal start on INDIVIDUAL_PROFILE
    {
        const policy = policyEngine.evaluate({
            operation: "terminal_session.start",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "stop session",
            executionProfile: INDIVIDUAL_PROFILE,
        });
        assert.strictEqual(policy.decision, "allow", "INDIVIDUAL should allow terminal start");
        assert.strictEqual(policy.tier, "tier2_conditional", "Terminal start should be tier2");
    }

    // Test 2: ALLOW path for terminal start on BUSINESS_PROFILE (with rollback)
    {
        const policy = policyEngine.evaluate({
            operation: "terminal_session.start",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "stop session",
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(policy.decision, "allow", "BUSINESS should allow terminal start with rollback");
        assert.strictEqual(policy.tier, "tier2_conditional", "Terminal start should be tier2");
    }

    // Test 3: DENY path for terminal exec on BUSINESS_PROFILE (no rollback)
    {
        const policy = policyEngine.evaluate({
            operation: "terminal_session.exec",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: undefined, // Missing rollback plan
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(
            policy.decision,
            "deny",
            "BUSINESS should deny terminal exec without rollback plan"
        );
        assert(
            policy.reasons.some((r) => r.includes("rollback plan")),
            "Reason should mention rollback plan"
        );
    }

    // Test 4: DENY path for terminal exec on BUSINESS_PROFILE (no rollback)
    {
        const policy = policyEngine.evaluate({
            operation: "terminal_session.exec",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: undefined,
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(policy.decision, "deny", "BUSINESS tier2 should deny without rollback plan");
    }

    // Test 5: ALLOW with warning on INDIVIDUAL_PROFILE (no rollback)
    {
        const policy = policyEngine.evaluate({
            operation: "terminal_session.exec",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: undefined,
            executionProfile: INDIVIDUAL_PROFILE,
        });
        assert.strictEqual(
            policy.decision,
            "allow",
            "INDIVIDUAL should allow terminal exec without rollback (with warning)"
        );
        assert(
            policy.reasons.some((r) => r.includes("Warning")),
            "INDIVIDUAL should include warning about missing rollback"
        );
    }

    // Test 6: REQUIRE_APPROVAL path for terminal revoke (high-risk)
    {
        const policy = policyEngine.evaluate({
            operation: "terminal_session.revoke",
            risk: "high",
            mutatesState: true,
            rollbackPlan: "manual operator restore",
            executionProfile: INDIVIDUAL_PROFILE,
        });
        assert.strictEqual(
            policy.decision,
            "require_approval",
            "Terminal revoke should require approval"
        );
        assert.strictEqual(policy.tier, "tier3_approval", "Revoke should be tier3");
    }

    // Test 7: Tool execution for terminal start (integration test)
    {
        const startResult = await tool.execute({
            ...baseRequest,
            operation: "terminal_session",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "stop session",
            args: { action: "start", sessionId: "governance-test-1" },
        });
        assert.strictEqual(startResult.ok, true, "Terminal start should succeed");
        assert.strictEqual(startResult.output["state"], "running", "Session should be running");
        assert.strictEqual(
            startResult.sideEffects?.[0]?.action,
            "start",
            "Side effect should be recorded"
        );
        assert.strictEqual(
            startResult.sideEffects?.[0]?.mutating,
            true,
            "Start is mutating operation"
        );
    }

    // Test 8: Tool execution for terminal revoke (high-risk, non-reversible)
    {
        // First create and start a session
        const startResult = await tool.execute({
            ...baseRequest,
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "stop session",
            args: { action: "start", sessionId: "revoke-test-session" },
        });
        assert.strictEqual(startResult.ok, true);

        // Now revoke it (high-risk)
        const revokeResult = await tool.execute({
            ...baseRequest,
            risk: "high",
            mutatesState: true,
            rollbackPlan: "operator manual restore",
            args: { action: "revoke", sessionId: "revoke-test-session" },
        });
        assert.strictEqual(revokeResult.ok, true, "Revoke should succeed");
        assert.strictEqual(revokeResult.output["state"], "revoked", "Session should be revoked");
        assert.strictEqual(
            revokeResult.sideEffects?.[0]?.action,
            "revoke",
            "Revoke action should be recorded"
        );
        assert.strictEqual(
            revokeResult.sideEffects?.[0]?.reversible,
            false,
            "Revoke is non-reversible"
        );
    }
}

/**
 * Container sandbox governance paths: allow, deny, timeout, revoke for sandbox lifecycle.
 * Validates that container operations respect policy tiers and rollback requirements.
 */
async function testContainerGovernancePaths(): Promise<void> {
    const tool = new ContainerSandboxTool();
    const policyEngine = new PolicyEngine();

    // Test 1: ALLOW path for container create on INDIVIDUAL_PROFILE
    {
        const policy = policyEngine.evaluate({
            operation: "container_sandbox.create",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "destroy sandbox",
            executionProfile: INDIVIDUAL_PROFILE,
        });
        assert.strictEqual(policy.decision, "allow", "INDIVIDUAL should allow container create");
        assert.strictEqual(policy.tier, "tier2_conditional", "Container create should be tier2");
    }

    // Test 2: ALLOW path for container create on BUSINESS_PROFILE (with rollback)
    {
        const policy = policyEngine.evaluate({
            operation: "container_sandbox.create",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "destroy sandbox",
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(policy.decision, "allow", "BUSINESS should allow container create with rollback");
    }

    // Test 3: DENY path for container create on BUSINESS_PROFILE (no rollback)
    {
        const policy = policyEngine.evaluate({
            operation: "container_sandbox.create",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: undefined,
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(
            policy.decision,
            "deny",
            "BUSINESS should deny container create without rollback plan"
        );
    }

    // Test 4: REQUIRE_APPROVAL for container destroy (high-risk, non-reversible)
    {
        const policy = policyEngine.evaluate({
            operation: "container_sandbox.destroy",
            risk: "high",
            mutatesState: true,
            rollbackPlan: "recreate from known snapshot",
            executionProfile: INDIVIDUAL_PROFILE,
        });
        assert.strictEqual(
            policy.decision,
            "require_approval",
            "Container destroy should require approval"
        );
        assert.strictEqual(policy.tier, "tier3_approval", "Destroy should be tier3");
    }

    // Test 5: ALLOW path for snapshot/revert (medium risk, reversible)
    {
        const policy = policyEngine.evaluate({
            operation: "container_sandbox.snapshot",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "delete snapshot",
            executionProfile: BUSINESS_PROFILE,
        });
        assert.strictEqual(
            policy.decision,
            "allow",
            "Snapshot should be allowed with rollback plan"
        );
    }

    // Test 6: Tool execution for container create
    {
        const createResult = await tool.execute({
            ...baseRequest,
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "destroy sandbox",
            args: {
                action: "create",
                sandboxId: "governance-test-1",
                image: "node:20-alpine",
                quotas: { cpu: "1", memoryMb: 512 },
            },
        });
        assert.strictEqual(createResult.ok, true, "Container create should succeed");
        assert.strictEqual(createResult.output["state"], "created", "Sandbox should be created");
        assert.strictEqual(
            createResult.sideEffects?.[0]?.action,
            "create",
            "Create action should be recorded"
        );
        assert.strictEqual(
            createResult.sideEffects?.[0]?.reversible,
            true,
            "Create is reversible (via destroy)"
        );
    }

    // Test 7: Tool execution for container snapshot and revert
    {
        // Create and start
        const createResult = await tool.execute({
            ...baseRequest,
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "destroy sandbox",
            args: {
                action: "create",
                sandboxId: "revert-test-sandbox",
                image: "ubuntu:latest",
            },
        });
        assert.strictEqual(createResult.ok, true);

        const startResult = await tool.execute({
            ...baseRequest,
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "stop sandbox",
            args: { action: "start", sandboxId: "revert-test-sandbox" },
        });
        assert.strictEqual(startResult.ok, true);

        // Take snapshot
        const snapshotResult = await tool.execute({
            ...baseRequest,
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "delete snapshot",
            args: {
                action: "snapshot",
                sandboxId: "revert-test-sandbox",
                snapshotId: "snap-stable",
            },
        });
        assert.strictEqual(snapshotResult.ok, true);
        assert.strictEqual(
            snapshotResult.sideEffects?.[0]?.action,
            "snapshot",
            "Snapshot action recorded"
        );

        // Revert to snapshot
        const revertResult = await tool.execute({
            ...baseRequest,
            risk: "high",
            mutatesState: true,
            rollbackPlan: "restore from backup image",
            args: {
                action: "revert",
                sandboxId: "revert-test-sandbox",
                snapshotId: "snap-stable",
            },
        });
        assert.strictEqual(revertResult.ok, true);
        assert.strictEqual(
            revertResult.sideEffects?.[0]?.action,
            "revert",
            "Revert action recorded"
        );
        assert.strictEqual(
            revertResult.sideEffects?.[0]?.reversible,
            false,
            "Revert itself is non-reversible"
        );
    }

    // Test 8: Tool execution for container destroy (non-reversible)
    {
        // Create a sandbox
        const createResult = await tool.execute({
            ...baseRequest,
            risk: "medium",
            mutatesState: true,
            rollbackPlan: "recreate sandbox",
            args: {
                action: "create",
                sandboxId: "destroy-test-sandbox",
                image: "alpine:latest",
            },
        });
        assert.strictEqual(createResult.ok, true);

        // Destroy it
        const destroyResult = await tool.execute({
            ...baseRequest,
            risk: "high",
            mutatesState: true,
            rollbackPlan: "recreate from manifest",
            args: { action: "destroy", sandboxId: "destroy-test-sandbox" },
        });
        assert.strictEqual(destroyResult.ok, true);
        assert.strictEqual(
            destroyResult.sideEffects?.[0]?.action,
            "destroy",
            "Destroy action recorded"
        );
        assert.strictEqual(
            destroyResult.sideEffects?.[0]?.reversible,
            false,
            "Destroy is non-reversible"
        );

        // Verify status fails after destroy
        const statusResult = await tool.execute({
            ...baseRequest,
            args: { action: "status", sandboxId: "destroy-test-sandbox" },
        });
        assert.strictEqual(statusResult.ok, false, "Status should fail for destroyed sandbox");
    }
}
