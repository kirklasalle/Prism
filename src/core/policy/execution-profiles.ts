/**
 * Market-segment-driven execution profiles.
 * Defines how Tier 1/2/3 governance is applied differently for Individual vs Business deployments.
 *
 * Phase D2: PRISM supports two market segments. Domain-specific profiles (e.g., "finance", "healthcare")
 * are planned as future roadmap items and would require extending this type and adding profile definitions.
 * Currently, use the base Individual or Business profile and customize at runtime as needed.
 */

export type MarketSegment = "individual" | "business";

export interface ExecutionProfile {
    segment: MarketSegment;
    /** Tier 1: Allow low-risk autonomous operations without approval. */
    tier1AutonomousAllowed: boolean;
    /** Tier 2: Allow medium-risk operations with governance checks (e.g., require rollback plan). */
    tier2ConditionalAllowed: boolean;
    /** Tier 3: Require explicit approval for high-risk operations. */
    tier3ApprovalRequired: boolean;
    /** Tier 3: Allow high-risk operations to bypass approval if whitelisted. */
    tier3WhitelistBypass: boolean;
    /** Enforce rollback plans even for medium-risk operations in this segment. */
    rollbackPlanRequired: boolean;
    /** Require audit trail entry for all operations (not just high-risk). */
    auditAllOperations: boolean;
    /** Description of the profile. */
    description: string;
}

/**
 * Individual profile: optimized for personal agents and lightweight workflows.
 * - Autonomous tier 1 allowed.
 * - Conditional tier 2 allowed with minimal governance.
 * - High-risk operations require approval but with relaxed rollback requirements.
 * - Audit optional.
 */
export const INDIVIDUAL_PROFILE: ExecutionProfile = {
    segment: "individual",
    tier1AutonomousAllowed: true,
    tier2ConditionalAllowed: true,
    tier3ApprovalRequired: true,
    tier3WhitelistBypass: false,
    rollbackPlanRequired: false, // More lenient: rollback plans encouraged but not required for medium-risk
    auditAllOperations: false, // Audit only high-risk
    description: "Individual: lightweight governance, fast tier 1/2 paths, approval for tier 3 only.",
};

/**
 * Business profile: optimized for enterprise governance and compliance.
 * - Tier 1 allowed only for truly read-only (non-mutating) operations.
 * - Tier 2 requires rollback plans and checks.
 * - Tier 3 requires approval; whitelist bypass disabled.
 * - Full audit trail.
 */
export const BUSINESS_PROFILE: ExecutionProfile = {
    segment: "business",
    tier1AutonomousAllowed: true, // But only for non-mutating
    tier2ConditionalAllowed: true,
    tier3ApprovalRequired: true,
    tier3WhitelistBypass: false, // Stricter: no bypass
    rollbackPlanRequired: true, // Enforced: all medium/high mutations require explicit rollback plan
    auditAllOperations: true, // Full audit trail
    description: "Business: strict governance, rollback plan enforcement, full audit, approval required for mutations.",
};

export function resolveExecutionProfile(segment?: string): ExecutionProfile {
    const normalized = (segment ?? "").trim().toLowerCase();
    if (normalized === "business" || normalized === "enterprise") {
        return BUSINESS_PROFILE;
    }
    return INDIVIDUAL_PROFILE; // Default to Individual
}
