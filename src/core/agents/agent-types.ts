import type { TaskRole, ModelRouterSelection } from "../operator/model-capability-matrix.js";
import type { OperationRisk } from "../policy/types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Agent lifecycle types
// ──────────────────────────────────────────────────────────────────────────────

/** Lifecycle tier for an agent instance. */
export type AgentLifecycleTier = "ephemeral" | "semi-permanent" | "permanent";

/** Runtime state of an agent instance. */
export type AgentState = "idle" | "busy" | "stopped";

/** Model override for a specific agent. */
export interface AgentModelOverride {
    providerId: string;
    model: string;
}

/** Full runtime agent instance (extends the static definition). */
export interface AgentInstance extends SubAgentDefinition {
    lifecycle: AgentLifecycleTier;
    state: AgentState;
    modelOverride?: AgentModelOverride;
    spawnedAt: number;
    lastActiveAt: number;
    dispatchCount: number;
}

/** Options for spawning a new agent. */
export interface SpawnAgentOptions {
    agentId?: string;
    role: TaskRole;
    description?: string;
    systemContext?: string;
    lifecycle?: AgentLifecycleTier;
    modelOverride?: AgentModelOverride;
}

/** Swarm topology type. */
export type SwarmTopology = "mesh" | "star" | "pipeline" | "broadcast";

/** Swarm state. */
export type SwarmState = "pending" | "running" | "completed" | "failed" | "stopped";

/** Swarm definition. */
export interface SwarmDefinition {
    swarmId: string;
    topology: SwarmTopology;
    goal: string;
    agentIds: string[];
    state: SwarmState;
    createdAt: number;
    completedAt?: number;
    timeoutMs: number;
    results: SubAgentResult[];
}

/** Telemetry record for a single dispatch. */
export interface DispatchTelemetryRecord {
    agentId: string;
    role: TaskRole;
    model: string;
    providerId: string;
    durationMs: number;
    tokenEstimate?: number;
    ok: boolean;
    timestamp: number;
}

/** Telemetry summary for a single agent. */
export interface AgentTelemetrySummary {
    agentId: string;
    role: TaskRole;
    dispatchCount: number;
    avgDurationMs: number;
    p95DurationMs: number;
    successRate: number;
    lastModel: string;
    lastActiveAt: number;
}

/** Promotion recommendation from telemetry analysis. */
export interface PromotionRecommendation {
    agentId: string;
    currentTier: AgentLifecycleTier;
    recommendedTier: AgentLifecycleTier;
    reason: string;
    dispatchCount: number;
    successRate: number;
}

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
        agentId?: string,
    ): Promise<{
        content: string;
        model: string;
        routing: ModelRouterSelection;
    } | null>;
}
