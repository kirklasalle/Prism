/**
 * Tests for Orchestrator.runDecomposed() — parallel step execution.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentPool } from "../src/core/agents/agent-pool.js";
import { TaskDecomposer } from "../src/core/agents/task-decomposer.js";
import { Orchestrator } from "../src/core/runtime/orchestrator.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import type { LlmDelegate } from "../src/core/agents/agent-types.js";
import type { ModelRouterSelection, ModelModality } from "../src/core/operator/model-capability-matrix.js";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function mockProfile() {
    return {
        pattern: "mock",
        label: "Mock T2",
        tier: 2 as const,
        parameterSize: "small" as const,
        parametersBillions: 3,
        contextWindow: 4096,
        estimatedVramMb: 2048,
        maxOutputTokens: 512,
        adaptivePromptBudget: 800,
        strengths: ["fast" as const],
        locality: "local" as const,
        modalities: ["text"] as ModelModality[],
    };
}

function mockRouting(model = "gemma3:1b"): ModelRouterSelection {
    return {
        providerId: "ollama",
        model,
        profile: mockProfile(),
        degraded: false,
        reason: "mock",
    };
}

/** Delegate that returns the goal prefixed with "response: " */
function echoDelegate(): LlmDelegate {
    return {
        async generateForRole(_role, input) {
            return {
                content: `response: ${input.message}`,
                model: "gemma3:1b",
                routing: mockRouting(),
            };
        },
    };
}

/** Delegate that records call order for concurrency checks */
function timedDelegate(delayMs = 0): { delegate: LlmDelegate; callLog: string[] } {
    const callLog: string[] = [];
    const delegate: LlmDelegate = {
        async generateForRole(_role, input) {
            callLog.push(`start:${input.message}`);
            if (delayMs > 0) {
                await new Promise<void>((r) => setTimeout(r, delayMs));
            }
            callLog.push(`end:${input.message}`);
            return {
                content: `done: ${input.message}`,
                model: "gemma3:1b",
                routing: mockRouting(),
            };
        },
    };
    return { delegate, callLog };
}

function makePlan(steps: Array<{
    id: string; goal: string; role?: string; dependsOn?: string[]; risk?: string;
}>) {
    return {
        goal: "test goal",
        ok: true,
        rawPlannerOutput: "",
        steps: steps.map((s) => ({
            id: s.id,
            description: s.goal,
            role: (s.role ?? "chat") as "chat",
            goal: s.goal,
            dependsOn: s.dependsOn ?? [],
            risk: (s.risk ?? "low") as "low",
        })),
    };
}

function makeOrchestrator(agentPool: AgentPool): Orchestrator {
    return new Orchestrator(
        "test-session",
        new ActivityBus(),
        new PolicyEngine(),
        new ToolRegistry(),
        { agentPool },
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("Orchestrator.runDecomposed", () => {
    it("returns empty array for an empty plan", async () => {
        const pool = new AgentPool(echoDelegate());
        const orchestrator = makeOrchestrator(pool);
        const result = await orchestrator.runDecomposed(makePlan([]));
        assert.deepEqual(result, []);
    });

    it("returns empty array for a failed plan", async () => {
        const pool = new AgentPool(echoDelegate());
        const orchestrator = makeOrchestrator(pool);
        const failedPlan = { goal: "x", ok: false, rawPlannerOutput: "", steps: [], error: "boom" };
        const result = await orchestrator.runDecomposed(failedPlan);
        assert.deepEqual(result, []);
    });

    it("executes a single step and returns its result", async () => {
        const pool = new AgentPool(echoDelegate());
        const orchestrator = makeOrchestrator(pool);
        const plan = makePlan([{ id: "s1", goal: "hello world" }]);
        const batches = await orchestrator.runDecomposed(plan);

        assert.equal(batches.length, 1);
        assert.equal(batches[0]!.length, 1);
        assert.ok(batches[0]![0]!.ok);
        assert.equal(batches[0]![0]!.content, "response: hello world");
    });

    it("executes sequential steps as separate batches", async () => {
        const pool = new AgentPool(echoDelegate());
        const orchestrator = makeOrchestrator(pool);
        const plan = makePlan([
            { id: "s1", goal: "step one" },
            { id: "s2", goal: "step two", dependsOn: ["s1"] },
            { id: "s3", goal: "step three", dependsOn: ["s2"] },
        ]);

        const batches = await orchestrator.runDecomposed(plan);

        assert.equal(batches.length, 3, "Sequential plan should have 3 batches");
        for (const batch of batches) {
            assert.equal(batch.length, 1);
            assert.ok(batch[0]!.ok);
        }
    });

    it("executes independent steps in a single parallel batch", async () => {
        const pool = new AgentPool(echoDelegate());
        const orchestrator = makeOrchestrator(pool);
        const plan = makePlan([
            { id: "s1", goal: "fetch A" },
            { id: "s2", goal: "fetch B" },
            { id: "s3", goal: "fetch C" },
        ]);

        const batches = await orchestrator.runDecomposed(plan);

        assert.equal(batches.length, 1, "All independent steps should be one batch");
        assert.equal(batches[0]!.length, 3);
        assert.ok(batches[0]!.every((r) => r.ok));
    });

    it("parallel steps in same batch actually run concurrently", async () => {
        const { delegate, callLog } = timedDelegate(50);
        const pool = new AgentPool(delegate);
        const orchestrator = makeOrchestrator(pool);
        const plan = makePlan([
            { id: "s1", goal: "A" },
            { id: "s2", goal: "B" },
        ]);

        const before = Date.now();
        await orchestrator.runDecomposed(plan);
        const elapsed = Date.now() - before;

        // Two 50ms tasks running concurrently should finish in ~50-120ms, not 100ms+
        assert.ok(elapsed < 150, `Expected parallel execution ~50ms, took ${elapsed}ms`);
        // Both starts should be logged before either end (true parallel interleaving)
        assert.ok(callLog.indexOf("start:A") < callLog.indexOf("end:B"));
        assert.ok(callLog.indexOf("start:B") < callLog.indexOf("end:A"));
    });

    it("mixed plan: parallel batch then dependent batch", async () => {
        const pool = new AgentPool(echoDelegate());
        const orchestrator = makeOrchestrator(pool);
        const plan = makePlan([
            { id: "s1", goal: "gather A" },
            { id: "s2", goal: "gather B" },
            { id: "s3", goal: "combine", dependsOn: ["s1", "s2"] },
        ]);

        const batches = await orchestrator.runDecomposed(plan);

        assert.equal(batches.length, 2);
        assert.equal(batches[0]!.length, 2, "First batch: s1+s2 parallel");
        assert.equal(batches[1]!.length, 1, "Second batch: s3 alone");
        assert.ok(batches[0]!.every((r) => r.ok));
        assert.ok(batches[1]![0]!.ok);
    });

    it("collects failed results without stopping other steps", async () => {
        let callCount = 0;
        const pool = new AgentPool({
            async generateForRole(_role, input) {
                callCount++;
                // Fail only the first call
                if (callCount === 1) return null;
                return {
                    content: `ok: ${input.message}`,
                    model: "gemma3:1b",
                    routing: mockRouting(),
                };
            },
        });
        const orchestrator = makeOrchestrator(pool);
        const plan = makePlan([
            { id: "s1", goal: "will fail" },
            { id: "s2", goal: "will succeed" },
        ]);

        const batches = await orchestrator.runDecomposed(plan);

        assert.equal(batches.length, 1);
        assert.equal(batches[0]!.length, 2);
        const results = batches[0]!;
        assert.equal(results.filter((r) => r.ok).length, 1, "One succeeds");
        assert.equal(results.filter((r) => !r.ok).length, 1, "One fails");
    });

    it("decompose + runDecomposed end-to-end", async () => {
        const planJson = JSON.stringify({
            steps: [
                { id: "s1", description: "classify", role: "classification", goal: "classify the input", dependsOn: [], risk: "low" },
                { id: "s2", description: "summarize", role: "summarization", goal: "summarize it", dependsOn: ["s1"], risk: "low" },
            ],
        });
        const pool = new AgentPool(echoDelegate());
        const orchestrator = makeOrchestrator(pool);
        const decomposer = new TaskDecomposer(pool);
        // Use a delegate that returns the plan JSON for the planner, then echo for rest
        let callIndex = 0;
        pool.setLlmDelegate({
            async generateForRole(_role, input) {
                const isPlanner = input.systemPrompt.includes("task decomposition engine");
                if (isPlanner) {
                    return { content: planJson, model: "llama3.2:3b", routing: mockRouting("llama3.2:3b") };
                }
                return { content: `echo: ${input.message}`, model: "gemma3:1b", routing: mockRouting() };
            },
        });

        const plan = await decomposer.decompose("end-to-end test goal");
        assert.ok(plan.ok, `Decompose failed: ${plan.error}`);

        const batchResults = await orchestrator.runDecomposed(plan);
        assert.ok(batchResults.length > 0);
        assert.ok(batchResults.flat().every((r) => r.ok));
    });
});
