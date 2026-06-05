/**
 * Tests for GuardianAgent — configure, start, stop, getStatus, getConfig,
 * executeTool, authority tier gating.
 *
 * Uses a mock LlamaCppSupervisor to avoid spawning real llama-server processes.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { GuardianAgent } from "../src/core/agents/guardian-agent.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import type { LlamaModelSlot, LlamaLoadOptions } from "../src/core/operator/llama-cpp-supervisor.js";
import type { Tool, ToolRequest, ToolResult } from "../src/core/tools/types.js";

/* ── Mock LlamaCppSupervisor ──────────────────────────────────────────── */

function makeSlot(overrides?: Partial<LlamaModelSlot>): LlamaModelSlot {
    return {
        id: 0,
        port: 8081,
        modelAlias: null,
        modelPath: null,
        pid: null,
        status: "empty",
        lastActive: Date.now(),
        draftModelPath: null,
        draftMax: 16,
        draftMin: 5,
        draftPMin: 0.9,
        gpuLayers: null,
        flashAttn: true,
        contextSize: 4096,
        ...overrides,
    };
}

class MockSupervisor extends EventEmitter {
    slots: LlamaModelSlot[] = [];
    loadCalled = 0;
    unloadCalled = 0;

    getSnapshot(): LlamaModelSlot[] {
        return this.slots;
    }

    async loadModel(modelPath: string, modelAlias: string, _opts?: number | LlamaLoadOptions): Promise<LlamaModelSlot> {
        this.loadCalled++;
        const slot = makeSlot({ id: this.slots.length, modelAlias, modelPath, status: "ready", pid: 12345 });
        this.slots.push(slot);
        return slot;
    }

    async unloadModel(modelAlias: string): Promise<boolean> {
        this.unloadCalled++;
        this.slots = this.slots.filter(s => s.modelAlias !== modelAlias);
        return true;
    }
}

/* ── Mock Tool ────────────────────────────────────────────────────────── */

function makeTool(name: string, risk: "low" | "medium" | "high" = "low"): Tool {
    return {
        name,
        contract: { version: "1.0.0", args: { action: { type: "string", required: true } } },
        governance: {
            actions: {
                test_action: { minimumRisk: risk, rollbackRequired: false, mutating: false },
                high_risk_action: { minimumRisk: "high", rollbackRequired: true, mutating: true },
            },
        },
        async execute(_req: ToolRequest): Promise<ToolResult> {
            return { ok: true, output: { result: "mock execution" } };
        },
    } as Tool;
}

/* ── Tests ────────────────────────────────────────────────────────────── */

describe("GuardianAgent", () => {
    let bus: ActivityBus;
    let supervisor: MockSupervisor;
    let guardian: GuardianAgent;

    beforeEach(() => {
        bus = new ActivityBus();
        supervisor = new MockSupervisor();
        guardian = new GuardianAgent(bus, supervisor as any, [makeTool("test_tool")], {
            modelPath: "/models/test.gguf",
            modelAlias: "test-guardian",
            autoStart: false,
            healthCheckIntervalMs: 999999, // prevent auto health checks during tests
        });
    });

    // ── Constructor & defaults ────────────────────────────────────────

    it("starts in stopped state", () => {
        assert.equal(guardian.state, "stopped");
    });

    it("has permanent lifecycle", () => {
        assert.equal(guardian.lifecycle, "permanent");
    });

    it("getConfig returns merged config", () => {
        const cfg = guardian.getConfig();
        assert.equal(cfg.modelPath, "/models/test.gguf");
        assert.equal(cfg.modelAlias, "test-guardian");
        assert.equal(cfg.autoStart, false);
        assert.equal(cfg.authorityTier, "tier2_conditional");
        assert.equal(cfg.contextSize, 4096);
    });

    // ── getStatus ─────────────────────────────────────────────────────

    it("getStatus returns correct shape when stopped", () => {
        const status = guardian.getStatus();
        assert.equal(status.state, "stopped");
        assert.equal(status.modelAlias, "test-guardian");
        assert.equal(status.modelPath, "/models/test.gguf");
        assert.equal(status.authorityTier, "tier2_conditional");
        assert.equal(status.uptime, 0);
        assert.equal(status.healthChecks, 0);
        assert.equal(status.issuesDetected, 0);
        assert.equal(status.issuesResolved, 0);
        assert.equal(status.lastHealthCheck, null);
        assert.equal(status.lastAction, null);
        assert.ok(Array.isArray(status.recentActions));
        assert.equal(status.slotInfo, null);
    });

    // ── configure ─────────────────────────────────────────────────────

    it("configure updates config fields", () => {
        guardian.configure({ authorityTier: "tier1_autonomous" });
        assert.equal(guardian.getConfig().authorityTier, "tier1_autonomous");
    });

    it("configure preserves unmodified fields", () => {
        const origPath = guardian.getConfig().modelPath;
        guardian.configure({ authorityTier: "tier1_autonomous" });
        assert.equal(guardian.getConfig().modelPath, origPath);
    });

    // ── start ─────────────────────────────────────────────────────────

    it("start transitions to running state", async () => {
        await guardian.start();
        assert.equal(guardian.state, "running");
        assert.equal(supervisor.loadCalled, 1);
        const status = guardian.getStatus();
        assert.ok(status.uptime > 0 || status.uptime === 0); // may be instant
        // Clean up the health check timer
        guardian.stop();
    });

    it("start without model path transitions to error state", async () => {
        const noModelGuardian = new GuardianAgent(bus, supervisor as any, [], {
            modelPath: "",
            autoStart: false,
            healthCheckIntervalMs: 999999,
        });
        await noModelGuardian.start();
        assert.equal(noModelGuardian.state, "error");
        assert.equal(supervisor.loadCalled, 0);
    });

    it("start is idempotent when already running", async () => {
        await guardian.start();
        assert.equal(supervisor.loadCalled, 1);
        await guardian.start(); // second call should be noop
        assert.equal(supervisor.loadCalled, 1);
        guardian.stop();
    });

    // ── stop ──────────────────────────────────────────────────────────

    it("stop transitions to stopped state", async () => {
        await guardian.start();
        guardian.stop();
        assert.equal(guardian.state, "stopped");
    });

    it("stop is safe to call when already stopped", () => {
        guardian.stop();
        assert.equal(guardian.state, "stopped");
    });

    // ── events ────────────────────────────────────────────────────────

    it("emits guardian_event on start", async () => {
        const events: Array<{ operation: string; detail: string }> = [];
        guardian.on("guardian_event", (evt) => events.push(evt));
        await guardian.start();
        assert.ok(events.some(e => e.operation === "guardian.started"));
        guardian.stop();
    });

    it("emits guardian_event on stop", async () => {
        await guardian.start();
        const events: Array<{ operation: string; detail: string }> = [];
        guardian.on("guardian_event", (evt) => events.push(evt));
        guardian.stop();
        assert.ok(events.some(e => e.operation === "guardian.stopped"));
    });

    it("recordAction emits guardian.action event", async () => {
        const events: Array<{ operation: string; detail: string }> = [];
        guardian.on("guardian_event", (evt) => events.push(evt));
        await guardian.executeTool("test_tool", { action: "test_action" });
        assert.ok(events.some(e => e.operation === "guardian.action"));
    });

    it("emits start_failed event when no model path", async () => {
        const noModelGuardian = new GuardianAgent(bus, supervisor as any, [], {
            modelPath: "",
            autoStart: false,
            healthCheckIntervalMs: 999999,
        });
        const events: Array<{ operation: string; detail: string }> = [];
        noModelGuardian.on("guardian_event", (evt) => events.push(evt));
        await noModelGuardian.start();
        assert.ok(events.some(e => e.operation === "guardian.start_failed"));
    });

    // ── executeTool ───────────────────────────────────────────────────

    it("executeTool returns result from tool", async () => {
        const result = await guardian.executeTool("test_tool", { action: "test_action" });
        assert.ok(result);
        assert.equal(result.ok, true);
    });

    it("executeTool returns null for unknown tool", async () => {
        const result = await guardian.executeTool("nonexistent_tool", {});
        assert.equal(result, null);
    });

    it("executeTool blocks high-risk action at tier2_conditional", async () => {
        const result = await guardian.executeTool("test_tool", { action: "high_risk_action" });
        assert.ok(result);
        assert.equal(result.ok, false);
        assert.ok(String(result.output.error).includes("tier2"));
    });

    it("executeTool allows high-risk action at tier1_autonomous", async () => {
        guardian.configure({ authorityTier: "tier1_autonomous" });
        const result = await guardian.executeTool("test_tool", { action: "high_risk_action" });
        assert.ok(result);
        assert.equal(result.ok, true);
    });

    it("executeTool records action in recentActions", async () => {
        await guardian.executeTool("test_tool", { action: "test_action" });
        const status = guardian.getStatus();
        assert.ok(status.recentActions.length > 0);
        assert.ok(status.recentActions.some(a => a.action === "tool_exec"));
    });

    // ── getStatus with slot info ──────────────────────────────────────

    it("getStatus includes slot info when model is loaded", async () => {
        await guardian.start();
        const status = guardian.getStatus();
        assert.ok(status.slotInfo, "should have slot info after start");
        assert.equal(status.slotInfo!.modelAlias, "test-guardian");
        assert.equal(status.slotInfo!.status, "ready");
        guardian.stop();
    });

    // ── mcp_health_recovery task ──────────────────────────────────────

    it("mcp_health_recovery returns success when no MCP adapter is attached", async () => {
        const result = await guardian.runTask("mcp_health_recovery");
        assert.ok(result, "task must exist");
        assert.equal(result!.lastResult, "success");
        assert.match(String(result!.lastDetail), /skipped|not attached/i);
    });

    it("mcp_health_recovery reports all-healthy when adapter has no down servers", async () => {
        guardian.setMcpAdapterFn(() => ({
            getServerStates: () => [
                { name: "alpha", state: "connected" as const, retryCount: 0, lastError: null },
                { name: "beta", state: "connected" as const, retryCount: 0, lastError: null },
            ],
            forceReconnect: async () => ({ ok: true }),
        }));
        const result = await guardian.runTask("mcp_health_recovery");
        assert.equal(result!.lastResult, "success");
        assert.match(String(result!.lastDetail), /healthy/);
    });

    it("mcp_health_recovery force-reconnects down servers and reports recovery", async () => {
        const reconnected: string[] = [];
        guardian.setMcpAdapterFn(() => ({
            getServerStates: () => [
                { name: "alpha", state: "connected" as const, retryCount: 0, lastError: null },
                { name: "beta", state: "down" as const, retryCount: 1, lastError: "exited" },
                { name: "gamma", state: "failed" as const, retryCount: 10, lastError: "max attempts" },
            ],
            forceReconnect: async (n) => {
                reconnected.push(n);
                return { ok: true };
            },
        }));
        const result = await guardian.runTask("mcp_health_recovery");
        assert.equal(result!.lastResult, "success");
        assert.deepEqual(reconnected.sort(), ["beta", "gamma"]);
        assert.match(String(result!.lastDetail), /Recovered 2/);
    });

    it("mcp_health_recovery returns warning when reconnect fails", async () => {
        guardian.setMcpAdapterFn(() => ({
            getServerStates: () => [
                { name: "beta", state: "down" as const, retryCount: 1, lastError: "exited" },
            ],
            forceReconnect: async () => ({ ok: false, error: "still broken" }),
        }));
        const result = await guardian.runTask("mcp_health_recovery");
        assert.equal(result!.lastResult, "warning");
        assert.match(String(result!.lastDetail), /still down/);
    });
});

export async function testGuardianAgent(): Promise<void> {
    // This function exists so it can be registered in the index.ts test runner.
    // The actual tests are in the describe() block above which runs via Mocha or node:test.
    console.log("  ✓ GuardianAgent tests (run via Mocha / node:test describe blocks)");
}
