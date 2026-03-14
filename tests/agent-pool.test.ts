/**
 * Tests for AgentPool and Orchestrator.runSubAgent().
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentPool } from "../src/core/agents/agent-pool.js";
import type { LlmDelegate, SubAgentRequest } from "../src/core/agents/agent-types.js";
import type { ModelRouterSelection } from "../src/core/operator/model-capability-matrix.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import { Orchestrator } from "../src/core/runtime/orchestrator.js";

// ──────────────────────────────────────────────────────────────────────────────
// Mock LLM delegate
// ──────────────────────────────────────────────────────────────────────────────

function mockDelegate(content = "mock response"): LlmDelegate {
    return {
        async generateForRole(role, _input) {
            const profile = {
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
            };
            const routing: ModelRouterSelection = {
                providerId: "ollama",
                model: "gemma3:1b",
                profile,
                degraded: false,
                reason: "only available model",
            };
            return { content, model: "gemma3:1b", routing };
        },
    };
}

function nullDelegate(): LlmDelegate {
    return {
        async generateForRole() {
            return null;
        },
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// AgentPool tests
// ──────────────────────────────────────────────────────────────────────────────

describe("AgentPool", () => {
    it("list() returns all 6 default agents", () => {
        const pool = new AgentPool();
        const agents = pool.list();
        assert.equal(agents.length, 6);
        const ids = agents.map((a) => a.agentId);
        assert.ok(ids.includes("chat"));
        assert.ok(ids.includes("planner"));
        assert.ok(ids.includes("coder"));
        assert.ok(ids.includes("summarizer"));
        assert.ok(ids.includes("classifier"));
        assert.ok(ids.includes("indexer"));
    });

    it("findByRole returns the right agent", () => {
        const pool = new AgentPool();
        const agent = pool.findByRole("code-generation");
        assert.ok(agent);
        assert.equal(agent.agentId, "coder");
    });

    it("findById returns the right agent", () => {
        const pool = new AgentPool();
        const agent = pool.findById("planner");
        assert.ok(agent);
        assert.equal(agent.role, "tool-selection");
    });

    it("register() overwrites existing agent", () => {
        const pool = new AgentPool();
        pool.register({ agentId: "chat", role: "chat", description: "Override" });
        const agent = pool.findById("chat");
        assert.equal(agent?.description, "Override");
    });

    it("unregister() removes an agent", () => {
        const pool = new AgentPool();
        const removed = pool.unregister("indexer");
        assert.ok(removed);
        assert.equal(pool.findById("indexer"), undefined);
    });

    it("dispatch to agentId returns ok result", async () => {
        const pool = new AgentPool(mockDelegate("hello from coder"));
        const result = await pool.dispatch({ goal: "write hello world", agentId: "coder" });
        assert.ok(result.ok);
        assert.equal(result.content, "hello from coder");
        assert.equal(result.agentId, "coder");
        assert.equal(result.model, "gemma3:1b");
        assert.equal(result.tier, 2);
        assert.ok(result.durationMs >= 0);
        assert.ok(result.traceId.length > 0);
    });

    it("dispatch by role resolves correct agent", async () => {
        const pool = new AgentPool(mockDelegate("plan output"));
        const result = await pool.dispatch({ goal: "plan a thing", role: "tool-selection" });
        assert.ok(result.ok);
        assert.equal(result.agentId, "planner");
    });

    it("dispatch with no role defaults to chat agent", async () => {
        const pool = new AgentPool(mockDelegate("chat output"));
        const result = await pool.dispatch({ goal: "hello" });
        assert.ok(result.ok);
        assert.equal(result.agentId, "chat");
    });

    it("dispatch fails with error when no LLM delegate configured", async () => {
        const pool = new AgentPool();
        const result = await pool.dispatch({ goal: "do something" });
        assert.ok(!result.ok);
        assert.ok(result.error?.includes("no LLM delegate"));
    });

    it("dispatch fails gracefully when LLM returns null", async () => {
        const pool = new AgentPool(nullDelegate());
        const result = await pool.dispatch({ goal: "do something" });
        assert.ok(!result.ok);
        assert.ok(result.error?.includes("No model available"));
    });

    it("dispatch fails with useful error for unknown agentId", async () => {
        const pool = new AgentPool(mockDelegate());
        const result = await pool.dispatch({ goal: "hello", agentId: "nonexistent" });
        assert.ok(!result.ok);
        assert.ok(result.error?.includes("Agent not found: nonexistent"));
    });

    it("setLlmDelegate() replaces null delegate post-construction", async () => {
        const pool = new AgentPool();
        pool.setLlmDelegate(mockDelegate("injected"));
        const result = await pool.dispatch({ goal: "test" });
        assert.ok(result.ok);
        assert.equal(result.content, "injected");
    });

    it("dispatch includes routing metadata in result", async () => {
        const pool = new AgentPool(mockDelegate("response"));
        const result = await pool.dispatch({ goal: "classify this", role: "classification" });
        assert.ok(result.ok);
        assert.ok(result.routing !== undefined);
        assert.equal(result.routing?.model, "gemma3:1b");
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Orchestrator.runSubAgent() tests
// ──────────────────────────────────────────────────────────────────────────────

describe("Orchestrator.runSubAgent", () => {
    function makeOrchestrator(agentPool?: AgentPool): Orchestrator {
        const bus = new ActivityBus();
        const policy = new PolicyEngine();
        const registry = new ToolRegistry();
        return new Orchestrator("test-session", bus, policy, registry, { agentPool });
    }

    it("returns null when no AgentPool is configured", async () => {
        const orchestrator = makeOrchestrator();
        const result = await orchestrator.runSubAgent({ goal: "do stuff" });
        assert.equal(result, null);
    });

    it("returns SubAgentResult when AgentPool is configured", async () => {
        const pool = new AgentPool(mockDelegate("orchestrated"));
        const orchestrator = makeOrchestrator(pool);
        const result = await orchestrator.runSubAgent({ goal: "summarize logs", role: "summarization" });
        assert.ok(result !== null);
        assert.ok(result.ok);
        assert.equal(result.content, "orchestrated");
        assert.equal(result.agentId, "summarizer");
    });

    it("setAgentPool() wires pool after construction", async () => {
        const pool = new AgentPool(mockDelegate("from setter"));
        const orchestrator = makeOrchestrator();
        orchestrator.setAgentPool(pool);
        const result = await orchestrator.runSubAgent({ goal: "classify X", role: "classification" });
        assert.ok(result?.ok);
        assert.equal(result?.content, "from setter");
    });

    it("policy governs agent dispatch — high risk is blocked without approval queue", async () => {
        const pool = new AgentPool(mockDelegate("should not reach"));
        const orchestrator = makeOrchestrator(pool);
        // High-risk with no approval queue — require_approval results in error result, not null
        const result = await orchestrator.runSubAgent({
            goal: "risky op",
            risk: "high",
        });
        assert.ok(result !== null);
        assert.ok(!result.ok);
        assert.ok(result.error?.includes("Approval required"));
    });
});
