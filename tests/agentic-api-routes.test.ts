/**
 * Agent Control API Route Integration Tests — exercises all /api/agents/*,
 * /api/swarms/*, /api/guardian/*, /api/hardware/swarm/* and /api/agents/telemetry
 * endpoints exposed by DashboardService.
 *
 * Spins up a DashboardService on an ephemeral port, wires agent control deps,
 * makes real HTTP requests, and validates responses.
 *
 * Run via Mocha: mocha dist/tests/agentic-api-routes.test.js --timeout 60000
 */
import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { DashboardService } from "../src/core/operator/dashboard-service.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import { AgentLifecycleManager } from "../src/core/agents/agent-lifecycle.js";
import { AgentTelemetryCollector } from "../src/core/agents/agent-telemetry-collector.js";
import { AgentPool } from "../src/core/agents/agent-pool.js";
import { AgentRouter } from "../src/core/agents/agent-router.js";
import { SwarmCoordinator } from "../src/core/agents/swarm-coordinator.js";
import type { LlmDelegate } from "../src/core/agents/agent-types.js";
import type { ModelRouterSelection, ModelModality } from "../src/core/operator/model-capability-matrix.js";

/* ── Test helpers ─────────────────────────────────────────────────────── */

let service: DashboardService;
let port: number;
let tmpDir: string;
let chatStore: ChatSessionStore;

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

/** JSON GET helper */
function fetchJson(path: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port, path }, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => { data += chunk; });
            res.on("end", () => {
                try { resolve({ status: res.statusCode!, body: JSON.parse(data || "{}") }); }
                catch { resolve({ status: res.statusCode!, body: data }); }
            });
        }).on("error", reject);
    });
}

/** JSON POST/DELETE/PUT helper */
function requestJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: "127.0.0.1",
            port,
            path,
            method,
            headers: body == null ? {} : { "Content-Type": "application/json" },
        }, (res) => {
            let payload = "";
            res.on("data", (chunk: Buffer) => { payload += chunk; });
            res.on("end", () => {
                try { resolve({ status: res.statusCode!, body: JSON.parse(payload || "{}") }); }
                catch { resolve({ status: res.statusCode!, body: payload }); }
            });
        });
        req.on("error", reject);
        if (body != null) req.write(JSON.stringify(body));
        req.end();
    });
}

/* ── Suite ────────────────────────────────────────────────────────────── */

describe("Agent Control API Routes (/api/agents/*, /api/swarms/*, /api/guardian/*)", function () {
    this.timeout(60_000);

    before(async () => {
        process.env.PRISM_AUTH_DISABLED = "true";
        tmpDir = mkdtempSync(join(tmpdir(), "prism-agentic-api-"));
        const bus = new ActivityBus();
        chatStore = new ChatSessionStore(":memory:");
        const registry = new ToolRegistry();

        service = new DashboardService(
            new ApprovalQueue(),
            bus,
            {
                sessionId: "agentic-api-test",
                environmentProfile: "test",
                mode: "server",
                startedAt: new Date().toISOString(),
                executionProfileSegment: "individual",
            },
            chatStore,
            [],                                          // actions
            0,                                           // port = ephemeral
            undefined,                                   // metricsCollector
            undefined,                                   // retrievalDashboardStore
            new InMemoryProviderSecretStore(),            // providerSecretStore
            undefined,                                   // activityStore
            join(tmpDir, "session-packages.json"),        // sessionPackageStorePath
            join(tmpDir, "exports"),                      // sessionPackageExportDir
            registry,                                    // toolRegistry
        );

        // Wire agent control dependencies
        const delegate = mockDelegate();
        const lifecycle = new AgentLifecycleManager();
        const telemetry = new AgentTelemetryCollector();
        const pool = new AgentPool(delegate);
        const router = new AgentRouter(pool, delegate);
        const swarm = new SwarmCoordinator(pool);
        service.setAgentControl({ lifecycle, telemetry, swarm, pool, router });

        service.start();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const addr = (service as unknown as { server: { address(): { port: number } | null } }).server.address();
        port = addr ? addr.port : 0;
        assert.ok(port > 0, "DashboardService should bind to an ephemeral port");
    });

    after(async () => {
        await service.stop();
        chatStore.close();
        rmSync(tmpDir, { recursive: true, force: true });
        delete process.env.PRISM_AUTH_DISABLED;
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Agent Lifecycle API
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("GET /api/agents", () => {
        it("returns default agents list with telemetry and swarms", async () => {
            const { status, body } = await fetchJson("/api/agents");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body.agents), "should have agents array");
            assert.ok(body.agents.length >= 6, "should have at least 6 default agents");
            assert.ok(Array.isArray(body.swarms), "should have swarms array");
            assert.ok(body.telemetry, "should have telemetry object");
            assert.ok("activeAgents" in body.telemetry);
            assert.ok("tasksCompleted" in body.telemetry);
            assert.ok("totalDispatches" in body.telemetry);
        });
    });

    describe("POST /api/agents/launch", () => {
        let spawnedAgentId: string;

        it("spawns an ephemeral agent and returns instance", async () => {
            const { status, body } = await requestJson("POST", "/api/agents/launch", {
                role: "chat",
                description: "Test agent from API route test",
            });
            assert.strictEqual(status, 201);
            assert.ok(body.agent, "response should contain agent");
            assert.ok(body.agent.agentId, "agent should have agentId");
            assert.strictEqual(body.agent.lifecycle, "ephemeral");
            assert.strictEqual(body.agent.role, "chat");
            spawnedAgentId = body.agent.agentId;
        });

        it("spawned agent appears in GET /api/agents", async () => {
            const { status, body } = await fetchJson("/api/agents");
            assert.strictEqual(status, 200);
            const found = body.agents.find((a: any) => a.agentId === spawnedAgentId);
            assert.ok(found, "spawned agent should be listed");
        });

        it("supports model override on launch", async () => {
            const { status, body } = await requestJson("POST", "/api/agents/launch", {
                role: "coder",
                description: "Agent with model override",
                providerId: "ollama",
                model: "gemma3:1b",
            });
            assert.strictEqual(status, 201);
            assert.ok(body.agent.modelOverride, "should have model override");
            assert.strictEqual(body.agent.modelOverride.providerId, "ollama");
            assert.strictEqual(body.agent.modelOverride.model, "gemma3:1b");
            // Clean up
            await requestJson("POST", "/api/agents/stop", { agentId: body.agent.agentId });
        });
    });

    describe("POST /api/agents/stop", () => {
        it("stops a spawned agent", async () => {
            const launchRes = await requestJson("POST", "/api/agents/launch", {
                role: "chat",
                description: "Agent to stop",
            });
            const agentId = launchRes.body.agent.agentId;

            const { status, body } = await requestJson("POST", "/api/agents/stop", { agentId });
            assert.strictEqual(status, 200);
            assert.strictEqual(body.agentId, agentId);
            assert.strictEqual(body.stopped, true);
        });

        it("returns stopped=false for unknown agent ID", async () => {
            const { status, body } = await requestJson("POST", "/api/agents/stop", {
                agentId: "nonexistent-agent-00000",
            });
            assert.strictEqual(status, 200);
            assert.strictEqual(body.stopped, false);
        });
    });

    describe("POST /api/agents/:id/model", () => {
        it("sets model override for an agent", async () => {
            const launchRes = await requestJson("POST", "/api/agents/launch", {
                role: "chat",
                description: "Agent for model override test",
            });
            const agentId = launchRes.body.agent.agentId;

            const { status, body } = await requestJson("POST", `/api/agents/${encodeURIComponent(agentId)}/model`, {
                providerId: "openai",
                model: "gpt-4o-mini",
            });
            assert.strictEqual(status, 200);
            assert.strictEqual(body.agentId, agentId);
            assert.deepStrictEqual(body.modelOverride, { providerId: "openai", model: "gpt-4o-mini" });

            // Clean up
            await requestJson("POST", "/api/agents/stop", { agentId });
        });
    });

    describe("POST /api/agents/:id/promote", () => {
        it("promotes an ephemeral agent to semi-permanent", async () => {
            const launchRes = await requestJson("POST", "/api/agents/launch", {
                role: "chat",
                description: "Agent for promote test",
            });
            const agentId = launchRes.body.agent.agentId;
            assert.strictEqual(launchRes.body.agent.lifecycle, "ephemeral");

            const { status, body } = await requestJson("POST", `/api/agents/${encodeURIComponent(agentId)}/promote`);
            assert.strictEqual(status, 200);
            assert.strictEqual(body.agentId, agentId);
            assert.strictEqual(body.lifecycle, "semi-permanent");

            // Clean up
            await requestJson("POST", "/api/agents/stop", { agentId });
        });

        it("returns 404 for nonexistent agent", async () => {
            const { status, body } = await requestJson("POST", "/api/agents/nonexistent-000/promote");
            assert.strictEqual(status, 404);
            assert.ok(body.error);
        });
    });

    describe("POST /api/agents/:id/demote", () => {
        it("demotes a semi-permanent agent to ephemeral", async () => {
            const launchRes = await requestJson("POST", "/api/agents/launch", {
                role: "chat",
                description: "Agent for demote test",
            });
            const agentId = launchRes.body.agent.agentId;

            // Promote first
            await requestJson("POST", `/api/agents/${encodeURIComponent(agentId)}/promote`);

            const { status, body } = await requestJson("POST", `/api/agents/${encodeURIComponent(agentId)}/demote`);
            assert.strictEqual(status, 200);
            assert.strictEqual(body.agentId, agentId);
            assert.strictEqual(body.lifecycle, "ephemeral");

            // Clean up
            await requestJson("POST", "/api/agents/stop", { agentId });
        });

        it("returns 404 for nonexistent agent", async () => {
            const { status, body } = await requestJson("POST", "/api/agents/nonexistent-000/demote");
            assert.strictEqual(status, 404);
            assert.ok(body.error);
        });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Agent Telemetry API
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("GET /api/agents/telemetry", () => {
        it("returns telemetry shape with summaries, frequency, recommendations, global", async () => {
            const { status, body } = await fetchJson("/api/agents/telemetry");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body.summaries), "should have summaries array");
            assert.ok(Array.isArray(body.frequency), "should have frequency array");
            assert.ok(Array.isArray(body.recommendations), "should have recommendations array");
            assert.ok(body.global, "should have global stats");
            assert.ok("activeAgents" in body.global);
            assert.ok("tasksCompleted" in body.global);
            assert.ok("avgResponseMs" in body.global);
            assert.ok("totalDispatches" in body.global);
        });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Swarm API
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("POST /api/swarms/create", () => {
        it("creates a broadcast swarm and returns it", async () => {
            const { status, body } = await requestJson("POST", "/api/swarms/create", {
                topology: "broadcast",
                goal: "Test swarm goal",
                agentIds: [],
            });
            assert.strictEqual(status, 201);
            assert.ok(body.swarm, "response should contain swarm");
            assert.ok(body.swarm.swarmId, "swarm should have swarmId");
            assert.strictEqual(body.swarm.topology, "broadcast");
            assert.strictEqual(body.swarm.goal, "Test swarm goal");
        });

        it("creates a mesh swarm", async () => {
            const { status, body } = await requestJson("POST", "/api/swarms/create", {
                topology: "mesh",
                goal: "Mesh test",
                agentIds: [],
            });
            assert.strictEqual(status, 201);
            assert.strictEqual(body.swarm.topology, "mesh");
        });

        it("creates a star swarm", async () => {
            const { status, body } = await requestJson("POST", "/api/swarms/create", {
                topology: "star",
                goal: "Star test",
                agentIds: [],
            });
            assert.strictEqual(status, 201);
            assert.strictEqual(body.swarm.topology, "star");
        });

        it("creates a pipeline swarm", async () => {
            const { status, body } = await requestJson("POST", "/api/swarms/create", {
                topology: "pipeline",
                goal: "Pipeline test",
                agentIds: [],
            });
            assert.strictEqual(status, 201);
            assert.strictEqual(body.swarm.topology, "pipeline");
        });
    });

    describe("GET /api/swarms", () => {
        it("lists created swarms", async () => {
            const { status, body } = await fetchJson("/api/swarms");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body.swarms));
            assert.ok(body.swarms.length >= 4, "should list at least the 4 swarms created above");
        });
    });

    describe("POST /api/swarms/:id/stop", () => {
        it("stops a swarm by ID", async () => {
            const createRes = await requestJson("POST", "/api/swarms/create", {
                topology: "broadcast",
                goal: "Swarm to stop",
                agentIds: [],
            });
            const swarmId = createRes.body.swarm.swarmId;

            const { status, body } = await requestJson("POST", `/api/swarms/${encodeURIComponent(swarmId)}/stop`);
            assert.strictEqual(status, 200);
            assert.strictEqual(body.swarmId, swarmId);
        });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Guardian API
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("GET /api/guardian/status", () => {
        it("returns guardian status shape", async () => {
            const { status, body } = await fetchJson("/api/guardian/status");
            assert.strictEqual(status, 200);
            assert.ok("state" in body, "should have state");
            assert.ok("modelAlias" in body, "should have modelAlias");
            assert.ok("modelPath" in body, "should have modelPath");
            assert.ok("authorityTier" in body, "should have authorityTier");
            assert.ok("uptime" in body, "should have uptime");
            assert.ok("healthChecks" in body, "should have healthChecks");
            assert.ok("issuesDetected" in body, "should have issuesDetected");
            assert.ok("issuesResolved" in body, "should have issuesResolved");
            assert.ok(Array.isArray(body.recentActions), "should have recentActions array");
        });
    });

    describe("POST /api/guardian/start", () => {
        it("returns 400 when no model path is configured", async () => {
            // Guardian is constructed with empty modelPath in test env
            const { status, body } = await requestJson("POST", "/api/guardian/start");
            assert.strictEqual(status, 400);
            assert.ok(body.error, "should have error message");
            assert.ok(body.suggestion, "should have suggestion");
        });
    });

    describe("POST /api/guardian/configure", () => {
        it("updates guardian configuration", async () => {
            const { status, body } = await requestJson("POST", "/api/guardian/configure", {
                authorityTier: "tier1_autonomous",
            });
            assert.strictEqual(status, 200);
            assert.strictEqual(body.authorityTier, "tier1_autonomous");
        });
    });

    describe("POST /api/guardian/stop", () => {
        it("stops the guardian and returns status", async () => {
            const { status, body } = await requestJson("POST", "/api/guardian/stop");
            assert.strictEqual(status, 200);
            assert.strictEqual(body.state, "stopped");
        });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Hardware Swarm API (llama.cpp slots — supervisor not wired in test)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("GET /api/hardware/swarm", () => {
        it("returns llama-server slot snapshot", async () => {
            const { status, body } = await fetchJson("/api/hardware/swarm");
            // The supervisor is created internally by DashboardService; it returns an empty snapshot
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body), "should return array of slots");
        });
    });

    describe("POST /api/hardware/swarm/load", () => {
        it("returns 400 when required fields are missing", async () => {
            const { status, body } = await requestJson("POST", "/api/hardware/swarm/load", {});
            assert.strictEqual(status, 400);
            assert.ok(body.error);
        });
    });

    describe("POST /api/hardware/swarm/unload", () => {
        it("returns 400 when modelAlias is missing", async () => {
            const { status, body } = await requestJson("POST", "/api/hardware/swarm/unload", {});
            assert.strictEqual(status, 400);
            assert.ok(body.error);
        });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  503 when agent lifecycle is NOT wired
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("503 when agent lifecycle is unavailable", function () {
        let bareService: DashboardService;
        let barePort: number;
        let bareChatStore: ChatSessionStore;

        before(async () => {
            bareChatStore = new ChatSessionStore(":memory:");
            // No setAgentControl → agentLifecycle = null → 503
            bareService = new DashboardService(
                new ApprovalQueue(),
                new ActivityBus(),
                {
                    sessionId: "bare-agentic-test",
                    environmentProfile: "test",
                    mode: "server",
                    startedAt: new Date().toISOString(),
                    executionProfileSegment: "individual",
                },
                bareChatStore,
                [],
                0,
                undefined,
                undefined,
                new InMemoryProviderSecretStore(),
            );
            bareService.start();
            await new Promise((resolve) => setTimeout(resolve, 100));

            const addr = (bareService as unknown as { server: { address(): { port: number } | null } }).server.address();
            barePort = addr ? addr.port : 0;
        });

        after(async () => {
            await bareService.stop();
            bareChatStore.close();
        });

        function bareRequestJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
            return new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: "127.0.0.1",
                    port: barePort,
                    path,
                    method,
                    headers: body == null ? {} : { "Content-Type": "application/json" },
                }, (res) => {
                    let payload = "";
                    res.on("data", (chunk: Buffer) => { payload += chunk; });
                    res.on("end", () => {
                        try { resolve({ status: res.statusCode!, body: JSON.parse(payload || "{}") }); }
                        catch { resolve({ status: res.statusCode!, body: payload }); }
                    });
                });
                req.on("error", reject);
                if (body != null) req.write(JSON.stringify(body));
                req.end();
            });
        }

        it("POST /api/agents/launch returns 503", async () => {
            const { status, body } = await bareRequestJson("POST", "/api/agents/launch", { role: "chat" });
            assert.strictEqual(status, 503);
            assert.ok(body.error.includes("not initialized"));
        });

        it("POST /api/agents/stop returns 503", async () => {
            const { status, body } = await bareRequestJson("POST", "/api/agents/stop", { agentId: "x" });
            assert.strictEqual(status, 503);
            assert.ok(body.error.includes("not initialized"));
        });

        it("POST /api/swarms/create returns 503", async () => {
            const { status, body } = await bareRequestJson("POST", "/api/swarms/create", { topology: "mesh" });
            assert.strictEqual(status, 503);
            assert.ok(body.error.includes("not initialized"));
        });
    });
});
