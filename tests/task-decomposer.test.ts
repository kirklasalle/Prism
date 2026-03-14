/**
 * Tests for TaskDecomposer — including JSON parsing edge-cases
 * and the toParallelBatches() dependency resolver.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentPool } from "../src/core/agents/agent-pool.js";
import { TaskDecomposer } from "../src/core/agents/task-decomposer.js";
import type { LlmDelegate } from "../src/core/agents/agent-types.js";
import type { ModelRouterSelection } from "../src/core/operator/model-capability-matrix.js";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeDelegate(response: string): LlmDelegate {
    const profile = {
        pattern: "mock",
        label: "Mock T3",
        tier: 3 as const,
        parameterSize: "medium" as const,
        parametersBillions: 8,
        contextWindow: 8192,
        estimatedVramMb: 4096,
        maxOutputTokens: 1024,
        adaptivePromptBudget: 2000,
        strengths: ["reasoning" as const],
        locality: "local" as const,
    };
    const routing: ModelRouterSelection = {
        providerId: "ollama",
        model: "llama3.2:3b",
        profile,
        degraded: false,
        reason: "mock",
    };
    return {
        async generateForRole() {
            return { content: response, model: "llama3.2:3b", routing };
        },
    };
}

const VALID_PLAN_JSON = JSON.stringify({
    steps: [
        {
            id: "step-1",
            description: "Gather requirements",
            role: "chat",
            goal: "List the requirements for the project",
            dependsOn: [],
            risk: "low",
            expectedOutput: "A bullet-point list of requirements",
        },
        {
            id: "step-2",
            description: "Write code",
            role: "code-generation",
            goal: "Implement the feature based on requirements",
            dependsOn: ["step-1"],
            risk: "medium",
        },
        {
            id: "step-3",
            description: "Summarize results",
            role: "summarization",
            goal: "Summarize what was built",
            dependsOn: ["step-2"],
            risk: "low",
        },
    ],
});

const PARALLEL_PLAN_JSON = JSON.stringify({
    steps: [
        { id: "s1", description: "Fetch A", role: "chat", goal: "get A", dependsOn: [], risk: "low" },
        { id: "s2", description: "Fetch B", role: "chat", goal: "get B", dependsOn: [], risk: "low" },
        { id: "s3", description: "Combine", role: "summarization", goal: "combine A and B", dependsOn: ["s1", "s2"], risk: "low" },
    ],
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("TaskDecomposer", () => {
    it("decomposes a goal into steps from valid JSON response", async () => {
        const pool = new AgentPool(makeDelegate(VALID_PLAN_JSON));
        const decomposer = new TaskDecomposer(pool);
        const plan = await decomposer.decompose("Build a feature");

        assert.ok(plan.ok, `Expected ok, got error: ${plan.error}`);
        assert.equal(plan.steps.length, 3);
        assert.equal(plan.goal, "Build a feature");
    });

    it("step 1 has correct fields", async () => {
        const pool = new AgentPool(makeDelegate(VALID_PLAN_JSON));
        const decomposer = new TaskDecomposer(pool);
        const plan = await decomposer.decompose("Build a feature");
        const step = plan.steps[0]!;

        assert.equal(step.id, "step-1");
        assert.equal(step.role, "chat");
        assert.equal(step.risk, "low");
        assert.deepEqual(step.dependsOn, []);
        assert.equal(step.expectedOutput, "A bullet-point list of requirements");
    });

    it("step 2 has correct dependsOn", async () => {
        const pool = new AgentPool(makeDelegate(VALID_PLAN_JSON));
        const decomposer = new TaskDecomposer(pool);
        const plan = await decomposer.decompose("Build a feature");
        assert.deepEqual(plan.steps[1]!.dependsOn, ["step-1"]);
    });

    it("returns ok=false when planner returns no content", async () => {
        const pool = new AgentPool({
            async generateForRole() { return null; },
        });
        const decomposer = new TaskDecomposer(pool);
        const plan = await decomposer.decompose("do something");
        assert.ok(!plan.ok);
        assert.ok(plan.error && plan.error.length > 0);
    });

    it("returns ok=false when planner returns invalid JSON", async () => {
        const pool = new AgentPool(makeDelegate("Sorry, I cannot process this request."));
        const decomposer = new TaskDecomposer(pool);
        const plan = await decomposer.decompose("do something");
        assert.ok(!plan.ok);
        assert.ok(plan.error?.includes("JSON") || plan.error?.includes("No JSON"));
    });

    it("strips markdown fences from planner output", async () => {
        const wrapped = "```json\n" + VALID_PLAN_JSON + "\n```";
        const pool = new AgentPool(makeDelegate(wrapped));
        const decomposer = new TaskDecomposer(pool);
        const plan = await decomposer.decompose("fenced goal");
        assert.ok(plan.ok, `Expected ok after fence stripping, got: ${plan.error}`);
        assert.equal(plan.steps.length, 3);
    });

    it("uses 'chat' role as fallback for unknown role values", async () => {
        const badRole = JSON.stringify({
            steps: [{ id: "s1", description: "X", role: "unknown-role", goal: "do it", dependsOn: [], risk: "low" }],
        });
        const pool = new AgentPool(makeDelegate(badRole));
        const decomposer = new TaskDecomposer(pool);
        const plan = await decomposer.decompose("test");
        assert.ok(plan.ok);
        assert.equal(plan.steps[0]!.role, "chat");
    });

    it("uses 'low' risk as fallback for unknown risk values", async () => {
        const badRisk = JSON.stringify({
            steps: [{ id: "s1", description: "X", role: "chat", goal: "do it", dependsOn: [], risk: "extreme" }],
        });
        const pool = new AgentPool(makeDelegate(badRisk));
        const decomposer = new TaskDecomposer(pool);
        const plan = await decomposer.decompose("test");
        assert.ok(plan.ok);
        assert.equal(plan.steps[0]!.risk, "low");
    });

    it("preserves rawPlannerOutput in result", async () => {
        const pool = new AgentPool(makeDelegate(VALID_PLAN_JSON));
        const decomposer = new TaskDecomposer(pool);
        const plan = await decomposer.decompose("test goal");
        assert.equal(plan.rawPlannerOutput, VALID_PLAN_JSON);
    });
});

describe("TaskDecomposer.toSubAgentRequests", () => {
    it("converts plan steps to SubAgentRequests", async () => {
        const pool = new AgentPool(makeDelegate(VALID_PLAN_JSON));
        const decomposer = new TaskDecomposer(pool);
        const plan = await decomposer.decompose("Build a feature");
        const requests = TaskDecomposer.toSubAgentRequests(plan);

        assert.equal(requests.length, 3);
        assert.equal(requests[0]!.role, "chat");
        assert.equal(requests[1]!.role, "code-generation");
        assert.equal(requests[2]!.role, "summarization");
        assert.ok(requests[0]!.goal.length > 0);
    });
});

describe("TaskDecomposer.toParallelBatches", () => {
    it("groups independent steps into the same batch", async () => {
        const pool = new AgentPool(makeDelegate(PARALLEL_PLAN_JSON));
        const decomposer = new TaskDecomposer(pool);
        const plan = await decomposer.decompose("parallel goal");
        const batches = TaskDecomposer.toParallelBatches(plan);

        assert.equal(batches.length, 2, "Should produce 2 batches: [s1,s2] then [s3]");
        assert.equal(batches[0]!.length, 2, "First batch has 2 parallel steps");
        assert.equal(batches[1]!.length, 1, "Second batch has 1 dependent step");
    });

    it("handles a fully sequential plan (all steps depend on previous)", async () => {
        const pool = new AgentPool(makeDelegate(VALID_PLAN_JSON));
        const decomposer = new TaskDecomposer(pool);
        const plan = await decomposer.decompose("sequential goal");
        const batches = TaskDecomposer.toParallelBatches(plan);

        assert.equal(batches.length, 3, "Each step should be its own batch");
        for (const batch of batches) {
            assert.equal(batch.length, 1);
        }
    });

    it("handles empty plan steps without throwing", () => {
        const emptyPlan = { goal: "x", steps: [], rawPlannerOutput: "", ok: true };
        const batches = TaskDecomposer.toParallelBatches(emptyPlan);
        assert.equal(batches.length, 0);
    });
});
