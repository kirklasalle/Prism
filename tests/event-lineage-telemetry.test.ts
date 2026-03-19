import * as assert from "assert";
import { describe, it } from "mocha";
import { ActivityBus } from "../src/core/activity/bus.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { BUSINESS_PROFILE } from "../src/core/policy/execution-profiles.js";
import { POLICY_REASON_CODES } from "../src/core/policy/reason-codes.js";

describe("Event Lineage Telemetry", () => {
    it("emits deterministic policy reason codes for business deny/approval paths", () => {
        const engine = new PolicyEngine();

        const denyResult = engine.evaluate({
            operation: "mkdir /tmp/example",
            risk: "medium",
            mutatesState: true,
            executionProfile: BUSINESS_PROFILE,
        });

        assert.strictEqual(denyResult.decision, "deny");
        assert.ok(denyResult.reasonCodes?.includes(POLICY_REASON_CODES.MEDIUM_RISK_DENY_MISSING_ROLLBACK));

        const approvalResult = engine.evaluate({
            operation: "rm -rf /tmp/example",
            risk: "high",
            mutatesState: true,
            executionProfile: BUSINESS_PROFILE,
        });

        assert.strictEqual(approvalResult.decision, "require_approval");
        assert.ok(approvalResult.reasonCodes?.includes(POLICY_REASON_CODES.HIGH_RISK_APPROVAL_REQUIRED));
    });

    it("propagates reason codes in governance activity events", () => {
        const bus = new ActivityBus();
        const engine = new PolicyEngine();
        const result = engine.evaluate({
            operation: "rm -rf /critical",
            risk: "high",
            mutatesState: true,
            executionProfile: BUSINESS_PROFILE,
        });

        const event = bus.emit({
            sessionId: "lineage-test",
            layer: "governance",
            operation: "policy_eval",
            status: "succeeded",
            authorityTier: result.tier,
            policyDecision: result.decision,
            details: {
                reasonCodes: result.reasonCodes ?? [],
                reasons: result.reasons,
            },
        });

        assert.ok(Array.isArray((event.details as any).reasonCodes));
        assert.ok((event.details as any).reasonCodes.includes(POLICY_REASON_CODES.HIGH_RISK_APPROVAL_REQUIRED));
        assert.ok(typeof event.hash === "string" && event.hash.length > 0);
    });
});
