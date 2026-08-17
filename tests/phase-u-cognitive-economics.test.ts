import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";
import { BudgetGovernor } from "../src/core/operator/budget-governor.js";
import { DiscrepancyReconciliationLoop } from "../src/core/operator/discrepancy-reconciliation-loop.js";

describe("Phase U — Cognitive Economics & Discrepancy Reconciliation", () => {
    describe("Budget Governor", () => {
        let governor: BudgetGovernor;

        beforeEach(() => {
            governor = new BudgetGovernor({
                departmentId: "dept-engineering",
                monthlyBudgetUsd: 100.0,
                softCapPercent: 75,
                hardCapPercent: 100,
                autoDownshiftTierOnSoftCap: true,
            });
        });

        it("evaluates nominal budget under soft cap", () => {
            governor.recordSpend("dept-engineering", 40.0);
            const evalResult = governor.evaluate("dept-engineering", 5.0);

            assert.equal(evalResult.status, "normal");
            assert.equal(evalResult.requiresApproval, false);
            assert.equal(evalResult.currentSpendUsd, 40.0);
            assert.equal(evalResult.remainingUsd, 55.0);
            assert.equal(evalResult.utilizationPercent, 45.0);
            assert.equal(evalResult.recommendedTierCap, "tier1_autonomous");
        });

        it("throttles to Tier 1 when soft cap threshold is crossed", () => {
            governor.recordSpend("dept-engineering", 80.0);
            const evalResult = governor.evaluate("dept-engineering", 2.0);

            assert.equal(evalResult.status, "throttled");
            assert.equal(evalResult.requiresApproval, false);
            assert.equal(evalResult.utilizationPercent, 82.0);
            assert.equal(evalResult.recommendedTierCap, "tier1_autonomous");
            assert.ok(evalResult.reason.includes("Soft Cap reached"));
        });

        it("blocks and requires approval when hard cap is breached", () => {
            governor.recordSpend("dept-engineering", 100.0);
            const evalResult = governor.evaluate("dept-engineering", 5.0);

            assert.equal(evalResult.status, "capped");
            assert.equal(evalResult.requiresApproval, true);
            assert.equal(evalResult.recommendedTierCap, "tier3_approval");
            assert.ok(evalResult.reason.includes("Hard Cap reached"));
        });
    });

    describe("Discrepancy Reconciliation Loop", () => {
        let loop: DiscrepancyReconciliationLoop;

        beforeEach(() => {
            loop = new DiscrepancyReconciliationLoop();
        });

        it("arbitrates between divergent claims favoring verified factual density", () => {
            const request = {
                sessionId: "session-sr-test",
                taskPrompt: "Determine maximum payload for API endpoint /upload",
                discrepancy: {
                    topic: "Payload limit divergence",
                    description: "Left model suggests 10MB; Right model suggests 50MB",
                    divergentHemispheres: ["left" as const, "right" as const],
                    severity: "medium" as const,
                    resolutionRecommendation: "Inspect server constants",
                },
                claims: [
                    {
                        claimText: "The payload ceiling is 10MB based on nginx client_max_body_size in config.",
                        sourceHemisphere: "left" as const,
                        confidenceScore: 0.95,
                        verifiableFacts: ["nginx config parameter verified", "src/server.ts body limit: 10485760"],
                    },
                    {
                        claimText: "The payload ceiling is 50MB based on typical S3 direct uploads.",
                        sourceHemisphere: "right" as const,
                        confidenceScore: 0.7,
                        verifiableFacts: [],
                    },
                ],
            };

            const arbitration = loop.arbitrate(request);

            assert.ok(arbitration.arbitrationId.startsWith("ARB-"));
            assert.equal(arbitration.chosenHemisphere, "left");
            assert.ok(arbitration.resolvedClaimText.includes("10MB"));
            assert.ok(arbitration.ledgerProof.startsWith("9TH-LAW-REASONING-LEDGER:"));
            assert.equal(arbitration.confidence, 0.95);
        });
    });
});
