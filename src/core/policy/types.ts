import type { AuthorityTier } from "../activity/types.js";
import type { ExecutionProfile } from "./execution-profiles.js";

export type OperationRisk = "low" | "medium" | "high";

export interface PolicyContext {
    operation: string;
    risk: OperationRisk;
    mutatesState: boolean;
    rollbackPlan?: string;
    isWhitelisted?: boolean;
    /** Execution profile that determines governance tier availability. */
    executionProfile?: ExecutionProfile;
}

export interface PolicyResult {
    tier: AuthorityTier;
    decision: "allow" | "deny" | "require_approval";
    reasons: string[];
    reasonCodes?: string[];
}
