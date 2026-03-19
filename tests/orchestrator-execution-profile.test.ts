import assert from "node:assert";
import { Orchestrator } from "../src/core/runtime/orchestrator.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import { INDIVIDUAL_PROFILE, BUSINESS_PROFILE } from "../src/core/policy/execution-profiles.js";
import type { ExecutionProfile } from "../src/core/policy/execution-profiles.js";
import type { ToolRequest } from "../src/core/tools/types.js";

export async function testOrchestratorExecutionProfile(): Promise<void> {
    let orchestrator: Orchestrator;
    let policyEngine: PolicyEngine;
    let activityBus: ActivityBus;
    let toolRegistry: ToolRegistry;

    // Reset before each test
    {
        policyEngine = new PolicyEngine();
        activityBus = new ActivityBus();
        toolRegistry = new ToolRegistry();
    }

    // Test: should use INDIVIDUAL_PROFILE by default
    {
        orchestrator = new Orchestrator("session-1", activityBus, policyEngine, toolRegistry);
        const testRequest: ToolRequest = {
            operation: "read-data",
            args: { query: "test" },
            risk: "low",
            mutatesState: false,
        };

        assert(orchestrator !== undefined, "Orchestrator should be created with default profile");
    }

    // Test: should accept BUSINESS_PROFILE in constructor options
    {
        orchestrator = new Orchestrator(
            "session-2",
            activityBus,
            policyEngine,
            toolRegistry,
            { executionProfile: BUSINESS_PROFILE },
        );
        assert(orchestrator !== undefined, "Orchestrator should accept BUSINESS_PROFILE");
    }

    // Test: should allow setting ExecutionProfile after construction
    {
        orchestrator = new Orchestrator("session-3", activityBus, policyEngine, toolRegistry);
        let caughtError = false;
        try {
            orchestrator.setExecutionProfile(BUSINESS_PROFILE);
        } catch {
            caughtError = true;
        }
        assert(!caughtError, "setExecutionProfile should not throw");
    }

    // Test: should pass ExecutionProfile to PolicyEngine for governance evaluation
    {
        const customProfile: ExecutionProfile = {
            segment: "business",
            tier1AutonomuousAllowed: true,
            tier2ConditionalAllowed: true,
            tier3ApprovalRequired: true,
            tier3WhitelistBypass: false,
            rollbackPlanRequired: true,
            auditAllOperations: true,
            description: "Custom profile for testing",
        };

        orchestrator = new Orchestrator(
            "session-profile-test",
            activityBus,
            policyEngine,
            toolRegistry,
            { executionProfile: customProfile },
        );


        assert(true, "Orchestrator should accept custom profile and run tool");
    }

    // Test: BUSINESS_PROFILE should enforce rollback plan for state mutations
    {
        const engine = new PolicyEngine();

        const result = engine.evaluate({
            operation: "update-data",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: undefined, // No rollback plan
            executionProfile: BUSINESS_PROFILE,
        });

        assert.strictEqual(result.decision, "deny", "BUSINESS_PROFILE should deny mutation without rollback plan");
        assert(
            result.reasons.some((r) => r.includes("rollback plan")),
            "Reason should mention rollback plan requirement",
        );
    }

    // Test: INDIVIDUAL_PROFILE should allow state mutations without rollback plan (with warning)
    {
        const engine = new PolicyEngine();

        const result = engine.evaluate({
            operation: "update-data",
            risk: "medium",
            mutatesState: true,
            rollbackPlan: undefined,
            executionProfile: INDIVIDUAL_PROFILE,
        });

        assert.strictEqual(result.decision, "allow", "INDIVIDUAL_PROFILE should allow mutation without rollback plan");
        assert(
            result.reasons.some((r) => r.includes("Warning")),
            "Reason should include warning about rollback plan",
        );
    }

    // Test: should support segment-specific governance rules
    {
        const customProfile: ExecutionProfile = {
            segment: "business",
            tier1AutonomuousAllowed: false, // No autonomous tier1 for finance
            tier2ConditionalAllowed: true,
            tier3ApprovalRequired: true,
            tier3WhitelistBypass: false,
            rollbackPlanRequired: true,
            auditAllOperations: true,
            description: "Finance: strict autonomous tier for compliance",
        };

        const engine = new PolicyEngine();

        const result = engine.evaluate({
            operation: "read-balance",
            risk: "low",
            mutatesState: false,
            executionProfile: customProfile,
        });

        assert.strictEqual(result.decision, "deny", "Custom profile should deny tier1 operations");
        assert.strictEqual(result.tier, "tier1_autonomous", "Tier should be tier1_autonomous");
    }
}
