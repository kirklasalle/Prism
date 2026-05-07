import type { AuthorityTier } from "../activity/types.js";
import type { ExecutionProfile } from "./execution-profiles.js";

export type OperationRisk = "low" | "medium" | "high";

/**
 * Phase E3b: CAC (Character Accountability Chain) identity snapshot supplied to the
 * policy engine. When `hasPlaceholderIdentity` is true (typical for a freshly-seeded
 * Business workspace that still uses `@prism.local` / `@placeholder` sentinel emails),
 * tier-2+ operations are denied with a clear remediation path to the CAC panel.
 */
export interface CacContext {
    assignmentId?: string | null;
    hasPlaceholderIdentity: boolean;
    /**
     * Phase E5: ISO-8601 timestamp when the operator email was verified via
     * an OAuth roundtrip (Gmail / Outlook). Tier-2+ operations on email-bound
     * tools in the Business segment require this within 30 days.
     */
    emailVerifiedAt?: string | null;
}

export interface PolicyContext {
    operation: string;
    risk: OperationRisk;
    mutatesState: boolean;
    rollbackPlan?: string;
    isWhitelisted?: boolean;
    /** Execution profile that determines governance tier availability. */
    executionProfile?: ExecutionProfile;
    /** Phase E3b: CAC identity snapshot for the active session. */
    cac?: CacContext;
    /** Phase E5: true when the operation targets an email-bound tool (email/calendar). */
    emailBound?: boolean;
}

export interface PolicyResult {
    tier: AuthorityTier;
    decision: "allow" | "deny" | "require_approval";
    reasons: string[];
    reasonCodes?: string[];
    /** Phase E3b: optional UI remediation link (e.g. the CAC identity panel). */
    remediation?: string;
}

