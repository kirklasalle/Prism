/**
 * Tests for AgentRouter — classify, route, fallback.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentRouter } from "../src/core/agents/agent-router.js";
import { AgentPool } from "../src/core/agents/agent-pool.js";
import type { LlmDelegate } from "../src/core/agents/agent-types.js";
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

/** Creates a delegate that returns a classification JSON from a provided mapping. */
function classifierDelegate(
    classifyContent: string,
    dispatchContent = "dispatch reply",
): LlmDelegate {
    let callCount = 0;
    return {
        async generateForRole(role, input) {
            callCount++;
            // First call is classification, subsequent are dispatches
            const content = callCount === 1 ? classifyContent : dispatchContent;
            return { content, model: "gemma3:1b", routing: MOCK_ROUTING };
        },
    };
}

/** Delegate that returns null (no model available). */
function nullDelegate(): LlmDelegate {
    return {
        async generateForRole() {
            return null;
        },
    };
}

/** Delegate that throws on classify. */
function throwingDelegate(): LlmDelegate {
    let callCount = 0;
    return {
        async generateForRole(role, input) {
            callCount++;
            if (callCount === 1) throw new Error("classify boom");
            return { content: "fallback response", model: "gemma3:1b", routing: MOCK_ROUTING };
        },
    };
}

describe("AgentRouter", () => {
    // ── classify ─────────────────────────────────────────────────────────

    it("classify returns parsed classification from valid JSON", async () => {
        const json = JSON.stringify({ role: "code-generation", confidence: 0.9, reasoning: "code request" });
        const delegate = classifierDelegate(json);
        const pool = new AgentPool(delegate);
        const router = new AgentRouter(pool, delegate);

        const result = await router.classify("write a function");
        assert.equal(result.role, "code-generation");
        assert.equal(result.confidence, 0.9);
        assert.equal(result.reasoning, "code request");
    });

    it("classify falls back to chat for low confidence", async () => {
        const json = JSON.stringify({ role: "summarization", confidence: 0.3, reasoning: "unsure" });
        const delegate = classifierDelegate(json);
        const pool = new AgentPool(delegate);
        const router = new AgentRouter(pool, delegate);

        const result = await router.classify("hello");
        assert.equal(result.role, "chat");
        assert.equal(result.confidence, 1.0); // fallback
    });

    it("classify falls back to chat for invalid JSON", async () => {
        const delegate = classifierDelegate("this is not json");
        const pool = new AgentPool(delegate);
        const router = new AgentRouter(pool, delegate);

        const result = await router.classify("hello");
        assert.equal(result.role, "chat");
    });

    it("classify falls back when delegate returns null", async () => {
        const delegate = nullDelegate();
        const pool = new AgentPool(delegate);
        const router = new AgentRouter(pool, delegate);

        const result = await router.classify("hello");
        assert.equal(result.role, "chat");
    });

    it("classify falls back when delegate throws", async () => {
        const delegate = throwingDelegate();
        const pool = new AgentPool(delegate);
        const router = new AgentRouter(pool, delegate);

        const result = await router.classify("hello");
        assert.equal(result.role, "chat");
    });

    it("classify handles JSON in code fences", async () => {
        const fenced = '```json\n{"role": "tool-selection", "confidence": 0.85, "reasoning": "planning"}\n```';
        const delegate = classifierDelegate(fenced);
        const pool = new AgentPool(delegate);
        const router = new AgentRouter(pool, delegate);

        const result = await router.classify("plan a project");
        assert.equal(result.role, "tool-selection");
        assert.equal(result.confidence, 0.85);
    });

    it("classify rejects invalid role names", async () => {
        const json = JSON.stringify({ role: "hacking", confidence: 0.99, reasoning: "bad" });
        const delegate = classifierDelegate(json);
        const pool = new AgentPool(delegate);
        const router = new AgentRouter(pool, delegate);

        const result = await router.classify("test");
        assert.equal(result.role, "chat"); // fallback
    });

    // ── routeAndDispatch ─────────────────────────────────────────────────

    it("routeAndDispatch classifies then dispatches to correct agent", async () => {
        const classifyJson = JSON.stringify({ role: "code-generation", confidence: 0.95, reasoning: "code" });
        const delegate = classifierDelegate(classifyJson, "generated code here");
        const pool = new AgentPool(delegate);
        const router = new AgentRouter(pool, delegate);

        const { classification, result } = await router.routeAndDispatch("write hello world");
        assert.equal(classification.role, "code-generation");
        assert.ok(result.ok);
        assert.equal(result.agentId, "coder");
    });

    it("routeAndDispatch falls back to chat on low confidence", async () => {
        const classifyJson = JSON.stringify({ role: "summarization", confidence: 0.2, reasoning: "unsure" });
        const delegate = classifierDelegate(classifyJson, "chat reply");
        const pool = new AgentPool(delegate);
        const router = new AgentRouter(pool, delegate);

        const { classification, result } = await router.routeAndDispatch("hey");
        assert.equal(classification.role, "chat"); // fell back
        assert.ok(result.ok);
        assert.equal(result.agentId, "chat");
    });

    // ── Custom threshold ─────────────────────────────────────────────────

    it("respects custom confidence threshold", async () => {
        const json = JSON.stringify({ role: "summarization", confidence: 0.8, reasoning: "summary request" });
        const delegate = classifierDelegate(json, "summary");
        const pool = new AgentPool(delegate);
        const router = new AgentRouter(pool, delegate, 0.9); // high threshold

        const result = await router.classify("summarize this");
        assert.equal(result.role, "chat"); // 0.8 < 0.9 threshold
    });
});
