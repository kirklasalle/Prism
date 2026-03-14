import type { AuthorityTier } from "../activity/types.js";
export type OperationRisk = "low" | "medium" | "high";
export interface PolicyContext {
    operation: string;
    risk: OperationRisk;
    mutatesState: boolean;
    rollbackPlan?: string;
    isWhitelisted?: boolean;
}
export interface PolicyResult {
    tier: AuthorityTier;
    decision: "allow" | "deny" | "require_approval";
    reasons: string[];
}
