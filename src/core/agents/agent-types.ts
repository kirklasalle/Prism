import type { TaskRole, ModelRouterSelection } from "../operator/model-capability-matrix.js";
import type { OperationRisk } from "../policy/types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Sub-agent core types
// ──────────────────────────────────────────────────────────────────────────────

/** Definition of a specialised agent slot registered in the AgentPool. */
export interface SubAgentDefinition {
    /** Unique, stable identifier for this agent. */
    agentId: string;
    /** The task role this agent is optimised for. */
    role: TaskRole;
    /** Human-readable description of what this agent does. */
    description: string;
    /** Extra context injected at the top of every system prompt for this agent. */
    systemContext?: string;
}

/** A work request dispatched to a sub-agent. */
export interface SubAgentRequest {
    /** Natural-language goal or prompt. */
    goal: string;
    /**
     * Preferred task role. The pool picks the first registered agent with
     * this role. Ignored when `agentId` is set.
     */
    role?: TaskRole;
    /** Target a specific agent by id. Overrides `role`. */
    agentId?: string;
    /** Additional context to inject into the agent prompt. */
    context?: string;
    /** Timeout for the underlying LLM call in ms. Default: 60 000. */
    timeoutMs?: number;
    /** Risk level for governance decisions. Default: "low". */
    risk?: OperationRisk;
}

/** Result returned from a sub-agent invocation. */
export interface SubAgentResult {
    ok: boolean;
    content: string;
    agentId: string;
    model: string;
    /** CapabilityTier (1-5) of the model that serviced the request. */
    tier: number;
    durationMs: number;
    /** ActivityBus trace ID for correlation. */
    traceId: string;
    error?: string;
    routing?: ModelRouterSelection;
}

// ──────────────────────────────────────────────────────────────────────────────
// LlmDelegate — thin interface implemented by LlmProviderManager
// ──────────────────────────────────────────────────────────────────────────────

/** Minimal LLM capability surface required by AgentPool. */
export interface LlmDelegate {
    generateForRole(
        role: TaskRole,
        input: {
            message: string;
            conversation: Array<{ role: "user" | "assistant" | "system"; content: string }>;
            systemPrompt: string;
        },
    ): Promise<{
        content: string;
        model: string;
        routing: ModelRouterSelection;
    } | null>;
}
