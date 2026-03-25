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

export interface AccountabilityChain {
    assignmentId: string;
    characterId: string;
    prismUserId: string;
    prismUserEmail: string;
    operatorId: string;
    operatorEmail: string;
    clientId: string;
    executionProfileSegment: "individual" | "business";
}

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
        action?: string;
        resource?: string;
        mutating?: boolean;
        reversible?: boolean;
        rollbackPlan?: string;
    }>;
    characterId?: string;
    prismUserId?: string;
    prismUserEmail?: string;
    operatorId?: string;
    operatorEmail?: string;
    clientId?: string;
    executionProfileSegment?: "individual" | "business";
    assignmentId?: string;
    accountabilityChain?: AccountabilityChain;
    rollbackPlan?: string;
    hash?: string;
}

export interface ActivitySubscriber {
    onEvent(event: ActivityEvent): void;
}
