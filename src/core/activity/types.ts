export type ActivityLayer =
    | "tool_execution"
    | "episodic"
    | "retrieval"
    | "causal"
    | "template"
    | "consolidation"
    | "governance"
    | "performance"
    | "llm"
    | "agent";

export type AuthorityTier = "tier1_autonomous" | "tier2_conditional" | "tier3_approval";

export interface ActivityEvent {
    id: string;
    timestamp: string;
    sessionId: string;
    layer: ActivityLayer;
    operation: string;
    status: "started" | "succeeded" | "failed";
    confidence?: number;
    durationMs?: number;
    details: Record<string, unknown>;
    authorityTier?: AuthorityTier;
    policyDecision?: "allow" | "deny" | "require_approval";
    sideEffects?: Array<{
        type: "file" | "process" | "network" | "database" | "api";
        description: string;
    }>;
    rollbackPlan?: string;
    hash?: string;
}

export interface ActivitySubscriber {
    onEvent(event: ActivityEvent): void;
}
