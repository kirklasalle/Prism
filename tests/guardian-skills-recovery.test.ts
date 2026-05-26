import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentPool } from "../src/core/agents/agent-pool.js";
import { GuardianAgent } from "../src/core/agents/guardian-agent.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import type { LlmDelegate, SubAgentRequest } from "../src/core/agents/agent-types.js";
import type { ModelRouterSelection, ModelModality } from "../src/core/operator/model-capability-matrix.js";

// Mock LLM delegate
function mockDelegate(onGenerate?: (systemPrompt: string) => void): LlmDelegate {
    return {
        async generateForRole(role, input) {
            if (onGenerate) onGenerate(input.systemPrompt);
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
                modalities: ["text"] as ModelModality[],
            };
            const routing: ModelRouterSelection = {
                providerId: "ollama",
                model: "gemma3:1b",
                profile,
                degraded: false,
                reason: "only available model",
            };
            return { content: "mock response", model: "gemma3:1b", routing };
        },
    };
}

describe("Josephine Mode Prompt Wrapping", () => {
    it("wraps the system prompt with the Josephine Cognitive Directive when enabled", async () => {
        let capturedPrompt = "";
        const pool = new AgentPool(mockDelegate((prompt) => {
            capturedPrompt = prompt;
        }));
        
        pool.setJosephineMode(true);
        const result = await pool.dispatch({ goal: "say hello", agentId: "chat" });
        
        assert.ok(result.ok);
        assert.ok(capturedPrompt.includes("COGNITIVE DIRECTIVE: JOSEPHINE MODE ENABLED"));
        assert.ok(capturedPrompt.includes("Absolute Precision: You are Josephine"));
        assert.ok(capturedPrompt.includes("Premium Delight"));
    });

    it("does not wrap the system prompt with the directive when disabled", async () => {
        let capturedPrompt = "";
        const pool = new AgentPool(mockDelegate((prompt) => {
            capturedPrompt = prompt;
        }));
        
        pool.setJosephineMode(false);
        const result = await pool.dispatch({ goal: "say hello", agentId: "chat" });
        
        assert.ok(result.ok);
        assert.ok(!capturedPrompt.includes("COGNITIVE DIRECTIVE: JOSEPHINE MODE ENABLED"));
    });
});

describe("Guardian Agent Self-Healing with Skills Engine", () => {
    // Mock Supervisor
    const mockSupervisor: any = {
        getSnapshot() {
            return [];
        },
        async loadModel() {
            // No-op
        }
    };

    it("sets SkillsEngine successfully", () => {
        const bus = new ActivityBus();
        const guardian = new GuardianAgent(bus, mockSupervisor, [], { modelPath: "models/test.gguf" });
        
        let engineRegistered = false;
        const mockSkillsEngine = {
            isMock: true
        };
        
        guardian.setSkillsEngine(mockSkillsEngine);
        assert.equal((guardian as any).skillsEngine, mockSkillsEngine);
    });

    it("autonomously queries the SkillsEngine and runs dynamic self-healing skill session", async () => {
        const bus = new ActivityBus();
        const guardian = new GuardianAgent(bus, mockSupervisor, [], { modelPath: "models/test.gguf" });
        
        let routedQuery = "";
        let sessionCreatedFor = "";
        let executedSessionId = "";
        
        const mockSkillsEngine = {
            async routeQuery(query: string) {
                routedQuery = query;
                return {
                    id: "recover_mcp_server",
                    name: "MCP Server Self-Healing Skill",
                    tags: ["mcp", "self-heal"]
                };
            },
            async createSession(skillId: string, parentSession: string) {
                sessionCreatedFor = skillId;
                return {
                    sessionId: "test_sess_123",
                    skillId,
                    status: "running"
                };
            },
            async executeStep(sessionId: string) {
                executedSessionId = sessionId;
                return {
                    sessionId,
                    skillId: "recover_mcp_server",
                    status: "completed"
                };
            }
        };

        guardian.setSkillsEngine(mockSkillsEngine);
        
        // Trigger self heal
        await (guardian as any).attemptSelfHeal("mcp_server_down");
        
        assert.equal(routedQuery, "mcp_server_down");
        assert.equal(sessionCreatedFor, "recover_mcp_server");
        assert.equal(executedSessionId, "test_sess_123");
        assert.equal(guardian.getStatus().issuesResolved, 1);
        
        const lastAction = guardian.getStatus().recentActions.pop();
        assert.ok(lastAction);
        assert.equal(lastAction.result, "success");
        assert.ok(lastAction.detail.includes("Josephine knows!"));
    });
});
