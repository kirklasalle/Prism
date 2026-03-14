import assert from "node:assert";
import {
    getPerformanceSloProfile,
    resolveEnvironmentProfile,
} from "../src/core/config/environment-profiles.js";
import {
    resolveRetrievalAlertProfile,
    withRetrievalAlertPolicyProfile,
} from "../src/core/memory/retrieval-alert-policy.js";

export async function testEnvironmentProfiles(): Promise<void> {
    assert.strictEqual(resolveEnvironmentProfile("dev"), "dev");
    assert.strictEqual(resolveEnvironmentProfile("staging"), "staging");
    assert.strictEqual(resolveEnvironmentProfile("production"), "prod");
    assert.strictEqual(resolveEnvironmentProfile("unknown"), "dev");

    const devSlo = getPerformanceSloProfile("dev");
    const prodSlo = getPerformanceSloProfile("prod");
    assert.ok(prodSlo.policyP95Ms <= devSlo.policyP95Ms);
    assert.ok(prodSlo.retrievalP95Ms <= devSlo.retrievalP95Ms);

    const overridden = getPerformanceSloProfile("staging", { retrievalP95Ms: 42 });
    assert.strictEqual(overridden.retrievalP95Ms, 42);

    assert.strictEqual(resolveRetrievalAlertProfile("prod"), "prod");
    assert.strictEqual(resolveRetrievalAlertProfile("staging"), "staging");
    assert.strictEqual(resolveRetrievalAlertProfile("anything-else"), "dev");

    const devPolicy = withRetrievalAlertPolicyProfile("dev");
    const prodPolicy = withRetrievalAlertPolicyProfile("prod");
    assert.ok(prodPolicy.cohortMinUtility >= devPolicy.cohortMinUtility);
    assert.ok(prodPolicy.cohortMaxP95LatencyMs <= devPolicy.cohortMaxP95LatencyMs);

    const profileOverride = withRetrievalAlertPolicyProfile("staging", { trendP95LatencyIncreaseMs: 60 });
    assert.strictEqual(profileOverride.trendP95LatencyIncreaseMs, 60);

    console.log("✓ Environment profile tests passed");
}