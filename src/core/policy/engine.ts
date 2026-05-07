import type { PolicyContext, PolicyResult } from "./types.js";
import { INDIVIDUAL_PROFILE } from "./execution-profiles.js";
import { POLICY_REASON_CODES } from "./reason-codes.js";

export class PolicyEngine {
    evaluate(context: PolicyContext): PolicyResult {
        const reasons: string[] = [];
        const reasonCodes: string[] = [];
        const profile = context.executionProfile ?? INDIVIDUAL_PROFILE;

        // Phase E3b: Business segment with placeholder CAC identity blocks all tier-2+
        // operations (medium + high risk) until the operator replaces sentinel emails
        // via the CAC identity panel. Tier-1 (low-risk, non-mutating) reads remain allowed.
        if (
            profile.segment === "business"
            && context.cac?.hasPlaceholderIdentity
            && (context.risk === "medium" || context.risk === "high")
        ) {
            reasons.push(
                "Tier-2+ operation denied: CAC assignment uses placeholder identity. Replace `@prism.local` / `@placeholder` emails in the CAC panel before continuing.",
            );
            reasonCodes.push(POLICY_REASON_CODES.CAC_PLACEHOLDER_IDENTITY_DENY);
            return {
                tier: context.risk === "high" ? "tier3_approval" : "tier2_conditional",
                decision: "deny",
                reasons,
                reasonCodes,
                remediation: "/setup?rerun=true&step=cac",
            };
        }

        // Phase E5: Business segment + tier-2+ + email-bound tools require fresh
        // OAuth email verification (within 30 days). Tier-1 and individual flows
        // are unaffected. Verification freshness is enforced via the recorded
        // `cac.emailVerifiedAt` timestamp.
        if (
            profile.segment === "business"
            && context.emailBound
            && (context.risk === "medium" || context.risk === "high")
        ) {
            const verifiedAt = context.cac?.emailVerifiedAt;
            const verifiedAtMs = verifiedAt ? new Date(verifiedAt).getTime() : NaN;
            const fresh = !isNaN(verifiedAtMs) && (Date.now() - verifiedAtMs) <= 30 * 86_400_000;
            if (!fresh) {
                reasons.push(
                    "Tier-2+ email-bound operation denied: operator email must be verified via OAuth within the last 30 days.",
                );
                reasonCodes.push(POLICY_REASON_CODES.CAC_EMAIL_VERIFICATION_REQUIRED);
                return {
                    tier: context.risk === "high" ? "tier3_approval" : "tier2_conditional",
                    decision: "deny",
                    reasons,
                    reasonCodes,
                    remediation: "/dashboard#cac-panel",
                };
            }
        }

        // High-risk operations
        if (context.risk === "high") {
            if (!profile.tier3ApprovalRequired) {
                reasons.push("High-risk operation allowed by execution profile (tier3 not required).");
                reasonCodes.push(POLICY_REASON_CODES.HIGH_RISK_ALLOWED_PROFILE_BYPASS);
                return { tier: "tier3_approval", decision: "allow", reasons, reasonCodes };
            }

            if (context.isWhitelisted && profile.tier3WhitelistBypass) {
                reasons.push("High-risk operation allowed by whitelist policy and profile bypass.");
                reasonCodes.push(POLICY_REASON_CODES.HIGH_RISK_ALLOWED_WHITELIST_BYPASS);
                return { tier: "tier3_approval", decision: "allow", reasons, reasonCodes };
            }

            reasons.push(
                `High-risk operation requires explicit approval (segment=${profile.segment}).`,
            );
            reasonCodes.push(POLICY_REASON_CODES.HIGH_RISK_APPROVAL_REQUIRED);
            return { tier: "tier3_approval", decision: "require_approval", reasons, reasonCodes };
        }

        // Medium-risk (state-mutating) operations
        if (context.risk === "medium") {
            // Business profile: always require rollback plan for mutations
            if (profile.rollbackPlanRequired && context.mutatesState && !context.rollbackPlan) {
                reasons.push(
                    `State mutation denied: ${profile.segment} segment requires explicit rollback plan.`,
                );
                reasonCodes.push(POLICY_REASON_CODES.MEDIUM_RISK_DENY_MISSING_ROLLBACK);
                return { tier: "tier2_conditional", decision: "deny", reasons, reasonCodes };
            }

            // Individual profile: more lenient, but still check if mutating without rollback
            if (!profile.rollbackPlanRequired && context.mutatesState && !context.rollbackPlan) {
                reasons.push(
                    `Warning: State mutation without rollback plan (permitted in ${profile.segment} segment, not recommended).`,
                );
                reasonCodes.push(POLICY_REASON_CODES.MEDIUM_RISK_WARN_MISSING_ROLLBACK);
            }

            // Check tier2 is enabled for this profile
            if (!profile.tier2ConditionalAllowed) {
                reasons.push(
                    `Medium-risk conditional tier disabled for ${profile.segment} segment.`,
                );
                reasonCodes.push(POLICY_REASON_CODES.MEDIUM_RISK_DENY_TIER2_DISABLED);
                return { tier: "tier2_conditional", decision: "deny", reasons, reasonCodes };
            }

            reasons.push(
                `Conditional operation allowed with governance checks (segment=${profile.segment}).`,
            );
            reasonCodes.push(POLICY_REASON_CODES.MEDIUM_RISK_ALLOW_CONDITIONAL);
            return { tier: "tier2_conditional", decision: "allow", reasons, reasonCodes };
        }

        // Low-risk operations
        if (context.risk === "low") {
            // Business profile: require audit trail even for low-risk; tier1 restricted to non-mutating
            if (profile.auditAllOperations) {
                reasons.push(`Low-risk operation logged (segment=${profile.segment}, auditAllOperations=true).`);
                reasonCodes.push(POLICY_REASON_CODES.LOW_RISK_AUDIT_LOGGED);
            }

            // Tier1 autonomous check: Business disallows tier1 for mutating ops
            if (context.mutatesState && profile.segment === "business") {
                reasons.push(
                    "Low-risk mutation denied: business segment requires explicit governance tier 2+.",
                );
                reasonCodes.push(POLICY_REASON_CODES.LOW_RISK_DENY_BUSINESS_MUTATION);
                return { tier: "tier1_autonomous", decision: "deny", reasons, reasonCodes };
            }

            if (!profile.tier1AutonomuousAllowed) {
                reasons.push(`Autonomous operations disabled for ${profile.segment} segment.`);
                reasonCodes.push(POLICY_REASON_CODES.LOW_RISK_DENY_TIER1_DISABLED);
                return { tier: "tier1_autonomous", decision: "deny", reasons, reasonCodes };
            }

            reasons.push(
                `Low-risk operation allowed as autonomous execution (segment=${profile.segment}).`,
            );
            reasonCodes.push(POLICY_REASON_CODES.LOW_RISK_ALLOW_AUTONOMOUS);
            return { tier: "tier1_autonomous", decision: "allow", reasons, reasonCodes };
        }

        // Fallback (should not reach here)
        reasons.push("No matching policy rule; denying by default.");
        reasonCodes.push(POLICY_REASON_CODES.FALLBACK_DENY_NO_RULE);
        return { tier: "tier1_autonomous", decision: "deny", reasons, reasonCodes };
    }
}
