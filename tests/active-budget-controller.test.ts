import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LlmProviderManager } from "../src/core/operator/llm-provider-manager.js";
import { AutonomousAgentLoop } from "../src/core/runtime/autonomous-agent-loop.js";
import type { UsageMeteringService } from "../src/core/operator/usage-metering-service.js";
import type { ActivityBus } from "../src/core/activity/bus.js";

describe("Active Budget Cost Controller", () => {
    it("LlmProviderManager generate() allows call when budget is under cap", async () => {
        const emittedEvents: any[] = [];
        const mockActivityBus = {
            emit(event: any) {
                emittedEvents.push(event);
            },
            subscribe() {}
        } as unknown as ActivityBus;

        const mockUsageMeteringAllowed = {
            checkCap() {
                return { allowed: true, remainingUsd: 10.0, capType: "session" };
            },
            getCaps() {
                return { sessionCap: 10.0, dailyCap: null, monthlyCap: null };
            }
        } as unknown as UsageMeteringService;

        const pm = new LlmProviderManager(
            { PRISM_LLM_PROVIDER: "openai", PRISM_LLM_MODEL: "gpt-4o" },
            [],
            undefined,
            undefined,
            undefined,
            mockActivityBus
        );
        pm.setUsageMetering(mockUsageMeteringAllowed);

        // Under cap, execution reaches provider routing. It returns null/fails only because
        // we passed empty mocked settings (which is expected and normal).
        // The key assertion is that it does NOT throw the budget limit exception.
        const result = await pm.generate({
            message: "Hello world",
            conversation: [],
            systemPrompt: "You are an assistant."
        });

        assert.equal(result, null);
        assert.equal(emittedEvents.length, 0, "No budget limit breached events should be fired");
    });

    it("LlmProviderManager generate() intercepts and throws on budget breach", async () => {
        const emittedEvents: any[] = [];
        const mockActivityBus = {
            emit(event: any) {
                emittedEvents.push(event);
            },
            subscribe() {}
        } as unknown as ActivityBus;

        const mockUsageMeteringBreached = {
            checkCap() {
                return { allowed: false, remainingUsd: 0.0, capType: "session" };
            },
            getCaps() {
                return { sessionCap: 0.01, dailyCap: null, monthlyCap: null };
            }
        } as unknown as UsageMeteringService;

        const pm = new LlmProviderManager(
            { PRISM_LLM_PROVIDER: "openai", PRISM_LLM_MODEL: "gpt-4o" },
            [],
            undefined,
            undefined,
            undefined,
            mockActivityBus
        );
        pm.setUsageMetering(mockUsageMeteringBreached);

        await assert.rejects(
            async () => {
                await pm.generate({
                    message: "Expensive task",
                    conversation: [],
                    systemPrompt: "You are an assistant."
                });
            },
            /Centralized API budget ceiling breached: reached session spend cap/
        );

        assert.equal(emittedEvents.length, 1, "Exactly one event should be emitted");
        assert.equal(emittedEvents[0].operation, "llm.budget_limit_breached");
        assert.equal(emittedEvents[0].status, "failed");
        assert.equal(emittedEvents[0].details.capType, "session");
    });

    it("AutonomousAgentLoop executeStep() intercepts, fails goal, and registers in AAB Ledger on cost ceiling breach", async () => {
        const emittedEvents: any[] = [];
        const mockActivityBus = {
            emit(event: any) {
                emittedEvents.push(event);
            },
            subscribe() {}
        } as unknown as ActivityBus;

        const mockUsageMeteringBreached = {
            checkCap() {
                return { allowed: false, remainingUsd: 0.0, capType: "daily" };
            },
            getCaps() {
                return { sessionCap: null, dailyCap: 0.01, monthlyCap: null };
            }
        } as unknown as UsageMeteringService;

        const loop = new AutonomousAgentLoop(mockActivityBus);
        loop.setUsageMetering(mockUsageMeteringBreached);

        // Submit a goal
        const goal = loop.submitGoal("Run a diagnostic tool", "chat", "admin");
        assert.equal(goal.status, "queued");

        // Set state to executing to execute a step
        (goal as any).status = "executing";
        (goal as any).startedAt = new Date().toISOString();

        await assert.rejects(
            async () => {
                await loop.executeStep(goal.goalId, "browser_control", {}, 1);
            },
            /Action budget cost ceiling exceeded: reached daily spend cap/
        );

        // Verify loop marked the goal as failed
        assert.equal(goal.status, "failed");
        assert.ok(goal.error?.includes("reached daily spend cap"));
        assert.ok(goal.completedAt);

        // Verify entry registered in AAB Ledger
        const aabLedger = loop.getAABLedger();
        assert.equal(aabLedger.length, 1);
        assert.equal(aabLedger[0].anomalyType, "budget_limit_exceeded");
        assert.equal(aabLedger[0].intervention, "terminate");

        // Verify ActivityBus emitted appropriate warnings
        const breachedEvent = emittedEvents.find(e => e.operation === "autonomous.goal.budget_hard_exceeded");
        assert.ok(breachedEvent);
        assert.equal(breachedEvent.status, "failed");
        assert.equal(breachedEvent.details.capType, "daily");
    });
});
