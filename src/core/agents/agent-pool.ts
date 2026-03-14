import { randomUUID } from "node:crypto";
import type { TaskRole } from "../operator/model-capability-matrix.js";
import type {
    SubAgentDefinition,
    SubAgentRequest,
    SubAgentResult,
    LlmDelegate,
} from "./agent-types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Built-in default agents (one per TaskRole)
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_AGENTS: SubAgentDefinition[] = [
    {
        agentId: "classifier",
        role: "classification",
        description: "Classifies, labels, and categorises inputs.",
    },
    {
        agentId: "chat",
        role: "chat",
        description: "General-purpose conversational agent.",
    },
    {
        agentId: "summarizer",
        role: "summarization",
        description: "Condenses documents, conversation histories, and activity logs.",
    },
    {
        agentId: "planner",
        role: "tool-selection",
        description: "Plans tool use, decomposes goals into concrete steps.",
        systemContext:
            "You are a planning agent. Break the goal into ordered, concrete steps. " +
            "For each step state the tool or specialist needed and the expected output.",
    },
    {
        agentId: "coder",
        role: "code-generation",
        description: "Generates, reviews, debugs, and explains code.",
        systemContext:
            "You are a code-generation agent. Produce clean, idiomatic code. " +
            "Include brief inline comments only where the logic is non-obvious.",
    },
    {
        agentId: "indexer",
        role: "memory-indexing",
        description: "Extracts and structures knowledge for memory indexing.",
    },
];

// ──────────────────────────────────────────────────────────────────────────────
// AgentPool
// ──────────────────────────────────────────────────────────────────────────────

export class AgentPool {
    private readonly agents = new Map<string, SubAgentDefinition>();
    private llmDelegate: LlmDelegate | null;

    constructor(delegate: LlmDelegate | null = null) {
        this.llmDelegate = delegate;
        for (const agent of DEFAULT_AGENTS) {
            this.agents.set(agent.agentId, agent);
        }
    }

    /** Provide or replace the LLM delegate. Call this after construction if
     *  the delegate is not available at construction time. */
    setLlmDelegate(delegate: LlmDelegate): void {
        this.llmDelegate = delegate;
    }

    /** Register a custom agent. Overwrites any existing agent with the same id. */
    register(agent: SubAgentDefinition): void {
        this.agents.set(agent.agentId, agent);
    }

    /** Remove a registered agent by id. */
    unregister(agentId: string): boolean {
        return this.agents.delete(agentId);
    }

    /** Return all registered agent definitions. */
    list(): SubAgentDefinition[] {
        return [...this.agents.values()];
    }

    /** Return the first agent matching a given role, or undefined. */
    findByRole(role: TaskRole): SubAgentDefinition | undefined {
        for (const agent of this.agents.values()) {
            if (agent.role === role) return agent;
        }
        return undefined;
    }

    /** Return the agent with the given id, or undefined. */
    findById(agentId: string): SubAgentDefinition | undefined {
        return this.agents.get(agentId);
    }

    /**
     * Dispatch a request to the best matching agent and return a result.
     *
     * Resolution order:
     *   1. `request.agentId` (explicit target)
     *   2. First agent whose role matches `request.role`
     *   3. "chat" fallback
     */
    async dispatch(request: SubAgentRequest): Promise<SubAgentResult> {
        const traceId = randomUUID();
        const start = Date.now();

        // ── Resolve target agent ─────────────────────────────────────────────
        let agent: SubAgentDefinition | undefined;

        if (request.agentId) {
            agent = this.agents.get(request.agentId);
            if (!agent) {
                return failure(traceId, start, request.agentId, `Agent not found: ${request.agentId}`);
            }
        } else if (request.role) {
            agent = this.findByRole(request.role) ?? this.agents.get("chat");
        } else {
            agent = this.agents.get("chat");
        }

        if (!agent) {
            return failure(traceId, start, "unknown", "No suitable agent found in pool");
        }

        // ── Guard: LLM delegate must be configured ───────────────────────────
        if (!this.llmDelegate) {
            return failure(traceId, start, agent.agentId, "AgentPool has no LLM delegate configured");
        }

        // ── Build prompt and generate ────────────────────────────────────────
        const systemPrompt = buildSystemPrompt(agent, request.context);

        try {
            const result = await this.llmDelegate.generateForRole(agent.role, {
                message: request.goal,
                conversation: [],
                systemPrompt,
            });

            if (!result) {
                return failure(
                    traceId,
                    start,
                    agent.agentId,
                    `No model available for role: ${agent.role}`,
                );
            }

            return {
                ok: true,
                content: result.content,
                agentId: agent.agentId,
                model: result.model,
                tier: result.routing.profile.tier,
                durationMs: Date.now() - start,
                traceId,
                routing: result.routing,
            };
        } catch (err: unknown) {
            return failure(traceId, start, agent.agentId, String(err));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(agent: SubAgentDefinition, extraContext?: string): string {
    const parts: string[] = [];
    if (agent.systemContext) parts.push(agent.systemContext);
    if (extraContext?.trim()) parts.push(`Context:\n${extraContext.trim()}`);
    return parts.join("\n\n");
}

function failure(
    traceId: string,
    startMs: number,
    agentId: string,
    error: string,
): SubAgentResult {
    return {
        ok: false,
        content: "",
        agentId,
        model: "",
        tier: 0,
        durationMs: Date.now() - startMs,
        traceId,
        error,
    };
}
