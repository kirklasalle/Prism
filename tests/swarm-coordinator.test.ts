/**
 * Tests for SwarmCoordinator — create, execute (all 4 topologies), stop, list.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SwarmCoordinator } from "../src/core/agents/swarm-coordinator.js";
import { AgentPool } from "../src/core/agents/agent-pool.js";
import type { LlmDelegate, SwarmDefinition } from "../src/core/agents/agent-types.js";
import type { ModelRouterSelection, ModelModality } from "../src/core/operator/model-capability-matrix.js";

const MOCK_PROFILE = {
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

const MOCK_ROUTING: ModelRouterSelection = {
    providerId: "ollama",
    model: "gemma3:1b",
    profile: MOCK_PROFILE,
    degraded: false,
    reason: "mock",
};

function mockDelegate(content = "mock response"): LlmDelegate {
    return {
        async generateForRole(_role, _input) {
            return { content, model: "gemma3:1b", routing: MOCK_ROUTING };
        },
    };
}

describe("SwarmCoordinator", () => {
    let pool: AgentPool;
    let coordinator: SwarmCoordinator;
    const updates: SwarmDefinition[] = [];

    beforeEach(() => {
        updates.length = 0;
        pool = new AgentPool(mockDelegate());
        coordinator = new SwarmCoordinator(pool, (swarm) => {
            updates.push({ ...swarm, results: [...swarm.results] });
        });
    });

    // ── create ───────────────────────────────────────────────────────────

    it("create() returns a pending swarm", () => {
        const swarm = coordinator.create({
            topology: "mesh",
            goal: "test goal",
            agentIds: ["chat", "coder"],
        });
        assert.ok(swarm.swarmId.startsWith("swarm-"));
        assert.equal(swarm.state, "pending");
        assert.equal(swarm.topology, "mesh");
        assert.equal(swarm.goal, "test goal");
        assert.deepEqual(swarm.agentIds, ["chat", "coder"]);
        assert.equal(swarm.results.length, 0);
    });

    // ── list & get ───────────────────────────────────────────────────────

    it("list() includes created swarms", () => {
        coordinator.create({ topology: "mesh", goal: "a", agentIds: ["chat"] });
        coordinator.create({ topology: "star", goal: "b", agentIds: ["coder"] });
        assert.equal(coordinator.list().length, 2);
    });

    it("get() returns a specific swarm", () => {
        const swarm = coordinator.create({ topology: "pipeline", goal: "c", agentIds: ["chat"] });
        const found = coordinator.get(swarm.swarmId);
        assert.ok(found);
        assert.equal(found.swarmId, swarm.swarmId);
    });

    it("get() returns undefined for unknown id", () => {
        assert.equal(coordinator.get("nonexistent"), undefined);
    });

    // ── execute: mesh topology ──────────────────────────────────────────

    it("execute mesh dispatches to all agents in parallel", async () => {
        const swarm = coordinator.create({
            topology: "mesh",
            goal: "solve problem",
            agentIds: ["chat", "coder"],
        });
        const result = await coordinator.execute(swarm.swarmId);
        assert.equal(result.state, "completed");
        assert.equal(result.results.length, 2);
        assert.ok(result.completedAt);
    });

    // ── execute: star topology ──────────────────────────────────────────

    it("execute star uses first agent as coordinator", async () => {
        const swarm = coordinator.create({
            topology: "star",
            goal: "plan and do",
            agentIds: ["planner", "coder", "chat"],
        });
        const result = await coordinator.execute(swarm.swarmId);
        assert.equal(result.state, "completed");
        // 1 coordinator plan + 2 worker results = 3
        assert.equal(result.results.length, 3);
    });

    it("execute star with single agent works", async () => {
        const swarm = coordinator.create({
            topology: "star",
            goal: "solo",
            agentIds: ["chat"],
        });
        const result = await coordinator.execute(swarm.swarmId);
        assert.equal(result.state, "completed");
        assert.equal(result.results.length, 1);
    });

    // ── execute: pipeline topology ──────────────────────────────────────

    it("execute pipeline chains agents sequentially", async () => {
        const swarm = coordinator.create({
            topology: "pipeline",
            goal: "step by step",
            agentIds: ["planner", "coder", "summarizer"],
        });
        const result = await coordinator.execute(swarm.swarmId);
        assert.equal(result.state, "completed");
        assert.equal(result.results.length, 3);
    });

    // ── execute: broadcast topology ─────────────────────────────────────

    it("execute broadcast sends same message to all agents", async () => {
        const swarm = coordinator.create({
            topology: "broadcast",
            goal: "broadcast task",
            agentIds: ["chat", "coder", "summarizer"],
        });
        const result = await coordinator.execute(swarm.swarmId);
        assert.equal(result.state, "completed");
        assert.equal(result.results.length, 3);
    });

    // ── stop ─────────────────────────────────────────────────────────────

    it("stop() returns false for non-running swarm", () => {
        const swarm = coordinator.create({ topology: "mesh", goal: "x", agentIds: ["chat"] });
        // Swarm is pending, not running
        assert.equal(coordinator.stop(swarm.swarmId), false);
    });

    it("stop() returns false for unknown swarm id", () => {
        assert.equal(coordinator.stop("nonexistent"), false);
    });

    // ── error handling ──────────────────────────────────────────────────

    it("execute throws for unknown swarm id", async () => {
        await assert.rejects(
            () => coordinator.execute("nonexistent"),
            { message: "Swarm not found: nonexistent" },
        );
    });

    it("execute throws for already-running swarm", async () => {
        const swarm = coordinator.create({ topology: "mesh", goal: "x", agentIds: ["chat"] });
        // Execute once
        await coordinator.execute(swarm.swarmId);
        // Try again — state is now "completed"
        await assert.rejects(
            () => coordinator.execute(swarm.swarmId),
            (err: Error) => err.message.includes("already"),
        );
    });

    // ── update callback ─────────────────────────────────────────────────

    it("fires onSwarmUpdate during execution", async () => {
        const swarm = coordinator.create({ topology: "mesh", goal: "go", agentIds: ["chat"] });
        await coordinator.execute(swarm.swarmId);
        // Should get at least "running" and "completed" updates
        assert.ok(updates.length >= 2);
        assert.equal(updates[0].state, "running");
        assert.equal(updates[updates.length - 1].state, "completed");
    });

    // ── timeout ─────────────────────────────────────────────────────────

    it("swarm fails on timeout", async () => {
        // Create a slow delegate
        const slowDelegate: LlmDelegate = {
            async generateForRole() {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                return { content: "late", model: "gemma3:1b", routing: MOCK_ROUTING };
            },
        };
        const slowPool = new AgentPool(slowDelegate);
        const slowCoordinator = new SwarmCoordinator(slowPool);

        const swarm = slowCoordinator.create({
            topology: "mesh",
            goal: "slow task",
            agentIds: ["chat"],
            timeoutMs: 50, // very short timeout
        });
        const result = await slowCoordinator.execute(swarm.swarmId);
        assert.equal(result.state, "failed"); // timed out
    });
});
