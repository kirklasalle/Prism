/**
 * Tests for AgentLifecycleManager — spawn, stop, promote, demote, reap, persist/restore.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AgentLifecycleManager } from "../src/core/agents/agent-lifecycle.js";
import type { AgentLifecycleTier, AgentInstance } from "../src/core/agents/agent-types.js";

describe("AgentLifecycleManager", () => {
    let lifecycle: AgentLifecycleManager;
    const events: {
        spawned: AgentInstance[];
        stopped: string[];
        promoted: Array<{ id: string; from: AgentLifecycleTier; to: AgentLifecycleTier }>;
        demoted: Array<{ id: string; from: AgentLifecycleTier; to: AgentLifecycleTier }>;
        reaped: string[];
    } = { spawned: [], stopped: [], promoted: [], demoted: [], reaped: [] };

    beforeEach(() => {
        events.spawned = [];
        events.stopped = [];
        events.promoted = [];
        events.demoted = [];
        events.reaped = [];

        lifecycle = new AgentLifecycleManager({
            onSpawn: (inst) => events.spawned.push(inst),
            onStop: (id) => events.stopped.push(id),
            onPromote: (id, from, to) => events.promoted.push({ id, from, to }),
            onDemote: (id, from, to) => events.demoted.push({ id, from, to }),
            onReap: (id) => events.reaped.push(id),
        });
    });

    // ── Constructor defaults ─────────────────────────────────────────────

    it("registers 6 default permanent agents on construction", () => {
        const agents = lifecycle.list();
        assert.equal(agents.length, 6);
        const ids = agents.map((a) => a.agentId).sort();
        assert.deepEqual(ids, ["chat", "classifier", "coder", "indexer", "planner", "summarizer"]);
        for (const a of agents) {
            assert.equal(a.lifecycle, "permanent");
            assert.equal(a.state, "idle");
        }
    });

    // ── Spawn ────────────────────────────────────────────────────────────

    it("spawn() creates a new ephemeral agent by default", () => {
        const inst = lifecycle.spawn({ role: "chat", description: "test agent" });
        assert.ok(inst.agentId.startsWith("agent-"));
        assert.equal(inst.lifecycle, "ephemeral");
        assert.equal(inst.state, "idle");
        assert.equal(inst.dispatchCount, 0);
        assert.equal(events.spawned.length, 1);
        assert.equal(lifecycle.list().length, 7); // 6 default + 1 new
    });

    it("spawn() respects explicit agentId and lifecycle", () => {
        const inst = lifecycle.spawn({
            agentId: "my-agent",
            role: "code-generation",
            lifecycle: "semi-permanent",
            description: "custom",
        });
        assert.equal(inst.agentId, "my-agent");
        assert.equal(inst.lifecycle, "semi-permanent");
        assert.equal(inst.role, "code-generation");
    });

    it("spawn() applies model override", () => {
        const inst = lifecycle.spawn({
            role: "chat",
            modelOverride: { providerId: "openai", model: "gpt-4o" },
        });
        assert.deepEqual(inst.modelOverride, { providerId: "openai", model: "gpt-4o" });
    });

    // ── Stop ─────────────────────────────────────────────────────────────

    it("stop() removes agent and fires event", () => {
        const inst = lifecycle.spawn({ role: "chat" });
        const id = inst.agentId;
        const result = lifecycle.stop(id);
        assert.ok(result);
        assert.equal(lifecycle.get(id), undefined);
        assert.equal(events.stopped.length, 1);
        assert.equal(events.stopped[0], id);
    });

    it("stop() returns false for unknown agent", () => {
        assert.equal(lifecycle.stop("nonexistent"), false);
    });

    // ── Promote ──────────────────────────────────────────────────────────

    it("promote() advances tier from ephemeral to semi-permanent", () => {
        const inst = lifecycle.spawn({ role: "chat" });
        const newTier = lifecycle.promote(inst.agentId);
        assert.equal(newTier, "semi-permanent");
        assert.equal(lifecycle.get(inst.agentId)?.lifecycle, "semi-permanent");
        assert.equal(events.promoted.length, 1);
        assert.equal(events.promoted[0].from, "ephemeral");
        assert.equal(events.promoted[0].to, "semi-permanent");
    });

    it("promote() advances from semi-permanent to permanent", () => {
        const inst = lifecycle.spawn({ role: "chat", lifecycle: "semi-permanent" });
        const newTier = lifecycle.promote(inst.agentId);
        assert.equal(newTier, "permanent");
    });

    it("promote() returns current tier when already permanent", () => {
        const tier = lifecycle.promote("chat"); // chat is default permanent
        assert.equal(tier, "permanent");
        assert.equal(events.promoted.length, 0); // no event fired
    });

    it("promote() returns null for unknown agent", () => {
        assert.equal(lifecycle.promote("nonexistent"), null);
    });

    // ── Demote ───────────────────────────────────────────────────────────

    it("demote() drops tier from permanent to semi-permanent", () => {
        const inst = lifecycle.spawn({ role: "chat", lifecycle: "permanent" });
        const newTier = lifecycle.demote(inst.agentId);
        assert.equal(newTier, "semi-permanent");
        assert.equal(events.demoted.length, 1);
    });

    it("demote() returns current tier when already ephemeral", () => {
        const inst = lifecycle.spawn({ role: "chat" }); // default: ephemeral
        const tier = lifecycle.demote(inst.agentId);
        assert.equal(tier, "ephemeral");
        assert.equal(events.demoted.length, 0); // no event
    });

    // ── Model override ───────────────────────────────────────────────────

    it("setModelOverride() updates agent model override", () => {
        lifecycle.spawn({ agentId: "test-agent", role: "chat" });
        const result = lifecycle.setModelOverride("test-agent", { providerId: "anthropic", model: "claude-3" });
        assert.ok(result);
        assert.deepEqual(lifecycle.get("test-agent")?.modelOverride, { providerId: "anthropic", model: "claude-3" });
    });

    it("clearModelOverride() removes agent model override", () => {
        lifecycle.spawn({ agentId: "test-agent", role: "chat", modelOverride: { providerId: "openai", model: "gpt-4" } });
        const result = lifecycle.clearModelOverride("test-agent");
        assert.ok(result);
        assert.equal(lifecycle.get("test-agent")?.modelOverride, undefined);
    });

    // ── Dispatch tracking ────────────────────────────────────────────────

    it("recordDispatch increments count and sets busy", () => {
        lifecycle.recordDispatch("chat");
        const inst = lifecycle.get("chat")!;
        assert.equal(inst.state, "busy");
        assert.equal(inst.dispatchCount, 1);
    });

    it("recordDispatchComplete sets idle", () => {
        lifecycle.recordDispatch("chat");
        lifecycle.recordDispatchComplete("chat");
        assert.equal(lifecycle.get("chat")?.state, "idle");
    });

    // ── Reaper ───────────────────────────────────────────────────────────

    it("reapIdleEphemerals() removes idle ephemerals past timeout", () => {
        // Create with very short timeout
        const manager = new AgentLifecycleManager({
            onReap: (id) => events.reaped.push(id),
        }, 0); // 0 ms timeout

        const inst = manager.spawn({ role: "chat" }); // ephemeral by default
        // Force lastActiveAt to the past
        const instance = manager.get(inst.agentId)!;
        (instance as any).lastActiveAt = Date.now() - 1000;

        const reaped = manager.reapIdleEphemerals();
        assert.equal(reaped.length, 1);
        assert.equal(reaped[0], inst.agentId);
        assert.equal(manager.get(inst.agentId), undefined);
        assert.ok(events.reaped.includes(inst.agentId));
    });

    it("reapIdleEphemerals() does not reap busy agents", () => {
        const manager = new AgentLifecycleManager({}, 0);
        const inst = manager.spawn({ role: "chat" });
        manager.recordDispatch(inst.agentId);
        const reaped = manager.reapIdleEphemerals();
        assert.equal(reaped.length, 0);
    });

    it("reapIdleEphemerals() does not reap semi-permanent or permanent agents", () => {
        const manager = new AgentLifecycleManager({}, 0);
        manager.spawn({ role: "chat", lifecycle: "semi-permanent" });
        manager.spawn({ role: "chat", lifecycle: "permanent" });
        const reaped = manager.reapIdleEphemerals();
        assert.equal(reaped.length, 0);
    });

    // ── Persistence ──────────────────────────────────────────────────────

    it("serializePersistent() includes only permanent and semi-permanent agents", () => {
        lifecycle.spawn({ role: "chat", lifecycle: "ephemeral" });
        lifecycle.spawn({ role: "chat", lifecycle: "semi-permanent", agentId: "sp-1" });
        const persisted = lifecycle.serializePersistent();
        const ids = persisted.map((a) => a.agentId);
        assert.ok(ids.includes("chat")); // default permanent
        assert.ok(ids.includes("sp-1")); // semi-permanent
        // No ephemeral agents
        for (const p of persisted) {
            assert.notEqual(p.lifecycle, "ephemeral");
        }
    });

    it("restoreFromPersisted() merges state into existing agents", () => {
        const persisted = [
            {
                agentId: "chat",
                role: "chat" as const,
                description: "General-purpose conversational agent.",
                lifecycle: "permanent" as const,
                state: "idle" as const,
                spawnedAt: Date.now() - 100000,
                lastActiveAt: Date.now() - 50000,
                dispatchCount: 42,
                modelOverride: { providerId: "openai", model: "gpt-4o" },
            },
        ];
        lifecycle.restoreFromPersisted(persisted);
        const chat = lifecycle.get("chat")!;
        assert.equal(chat.dispatchCount, 42);
        assert.deepEqual(chat.modelOverride, { providerId: "openai", model: "gpt-4o" });
    });

    it("restoreFromPersisted() adds new agents not in defaults", () => {
        const persisted = [
            {
                agentId: "custom-agent",
                role: "summarization" as const,
                description: "Custom restored agent",
                lifecycle: "semi-permanent" as const,
                state: "idle" as const,
                spawnedAt: Date.now(),
                lastActiveAt: Date.now(),
                dispatchCount: 5,
            },
        ];
        lifecycle.restoreFromPersisted(persisted);
        const custom = lifecycle.get("custom-agent")!;
        assert.ok(custom);
        assert.equal(custom.lifecycle, "semi-permanent");
        assert.equal(custom.description, "Custom restored agent");
    });

    // ── findByRole ───────────────────────────────────────────────────────

    it("findByRole() returns matching non-stopped agent", () => {
        const agent = lifecycle.findByRole("code-generation");
        assert.ok(agent);
        assert.equal(agent.agentId, "coder");
    });

    it("findByRole() returns undefined for unknown role", () => {
        const agent = lifecycle.findByRole("nonexistent-role" as any);
        assert.equal(agent, undefined);
    });
});
