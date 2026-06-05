import assert from "node:assert/strict";
import { GuiRlOptimizer } from "../src/core/memory/gui-rl-optimizer.js";

export async function testGuiRlOptimizerLedger(): Promise<void> {
    // Construct in-memory/scratch database for clean tests
    const rl = new GuiRlOptimizer("prism-gui-rl-test.db");

    try {
        const sessionId = "rl-test-session";
        const objective = "click submit button";
        const actionType = "click";
        const selectorSuccess = "button[id='success-btn']";
        const selectorFailure = "button[id='fail-btn']";
        const selectorMixed = "button[id='mixed-btn']";

        // Test case 1: Succeeded execution (positive reinforcement)
        rl.recordActionOutcome(sessionId, objective, actionType, selectorSuccess, true);
        const adviceSuccess = rl.getPolicyAdvice(selectorSuccess);
        assert.ok(adviceSuccess, "Advice should be returned for successful selector");
        assert.match(adviceSuccess, /CONFIDENCE/, "Should return high confidence policy advice");

        // Test case 2: Consistently failed execution (strong negative reinforcement)
        rl.recordActionOutcome(sessionId, objective, actionType, selectorFailure, false, "Timeout waiting for element");
        rl.recordActionOutcome(sessionId, objective, actionType, selectorFailure, false, "Target closed");
        const adviceFailure = rl.getPolicyAdvice(selectorFailure);
        assert.ok(adviceFailure, "Advice should be returned for failing selector");
        assert.match(adviceFailure, /WARNING/, "Should return a strong negative policy warning");
        assert.match(adviceFailure, /Target closed/, "Warning should include the last error message");

        // Test case 3: Mixed execution outcomes
        rl.recordActionOutcome(sessionId, objective, actionType, selectorMixed, false, "Timeout");
        rl.recordActionOutcome(sessionId, objective, actionType, selectorMixed, false, "Timeout");
        rl.recordActionOutcome(sessionId, objective, actionType, selectorMixed, true);
        const adviceMixed = rl.getPolicyAdvice(selectorMixed);
        assert.ok(adviceMixed, "Advice should be returned for mixed selector");
        assert.match(adviceMixed, /ADVICE/, "Should return general cautious advice");
    } finally {
        rl.close();
    }
}

export async function testGuiRlSuite(): Promise<void> {
    console.log("Running GUI RL Optimizer tests...");
    await testGuiRlOptimizerLedger();
    console.log("✓ GUI RL Optimizer tests completed successfully");
}
