/**
 * PRISM Reason-Code Taxonomy — Authoritative enumeration of all deterministic
 * policy reason codes emitted across the governance, trust, identity, agent,
 * SR, and computer-use subsystems.
 *
 * Each code is assigned a domain, severity, and human-readable description.
 * The policy engine, trust validator, CAC, SR orchestrator, and agent pool
 * MUST reference these canonical codes (via POLICY_REASON_CODES or
 * TAXONOMY_CODES) to ensure traceable, auditable decision lineage.
 *
 * Task J1 — Phase D2 Manifest — Due 2026-04-28
 */

import { POLICY_REASON_CODES, type PolicyReasonCode } from "./reason-codes.js";

/* ──────────────────────────────────────────────────────
 *  Domain Classification
 * ────────────────────────────────────────────────────── */

export type ReasonCodeDomain =
    | "governance"
    | "directive"
    | "trust"
    | "identity"
    | "spectrum_refraction"
    | "agent"
    | "computer_use"
    | "workflow";

export type ReasonCodeSeverity = "info" | "warn" | "deny" | "critical";

/* ──────────────────────────────────────────────────────
 *  Taxonomy Entry
 * ────────────────────────────────────────────────────── */

export interface ReasonCodeEntry {
    /** The canonical reason code string. */
    code: string;
    /** Subsystem domain that owns this code. */
    domain: ReasonCodeDomain;
    /** Severity level for alerting / audit classification. */
    severity: ReasonCodeSeverity;
    /** Human-readable description of why this code is emitted. */
    description: string;
}

/* ──────────────────────────────────────────────────────
 *  Extended Reason Codes (beyond POLICY_REASON_CODES)
 *
 *  POLICY_REASON_CODES already defines 15 governance +
 *  directive codes. Here we add codes for trust, identity,
 *  SR, agent, computer-use, and workflow domains.
 * ────────────────────────────────────────────────────── */

export const TAXONOMY_CODES = {
    // ── Trust / Provenance ─────────────────────────────
    TRUST_LEVEL_BELOW_MIN: "TRUST_LEVEL_BELOW_MIN",
    TRUST_AUTHOR_EMAIL_MISSING: "TRUST_AUTHOR_EMAIL_MISSING",
    TRUST_REVIEW_STATUS_MISSING: "TRUST_REVIEW_STATUS_MISSING",
    TRUST_REVIEW_STATUS_NOT_ALLOWED: "TRUST_REVIEW_STATUS_NOT_ALLOWED",
    TRUST_SIGNATURE_REQUIRED: "TRUST_SIGNATURE_REQUIRED",
    TRUST_SIGNATURE_ALGORITHM_INVALID: "TRUST_SIGNATURE_ALGORITHM_INVALID",
    TRUST_SIGNATURE_VERIFICATION_FAILED: "TRUST_SIGNATURE_VERIFICATION_FAILED",
    TRUST_PUBLIC_KEY_MISSING: "TRUST_PUBLIC_KEY_MISSING",
    TRUST_REPOSITORY_REQUIRED: "TRUST_REPOSITORY_REQUIRED",
    TRUST_REPOSITORY_PROTOCOL_NOT_HTTPS: "TRUST_REPOSITORY_PROTOCOL_NOT_HTTPS",
    TRUST_REPOSITORY_HOST_NOT_ALLOWED: "TRUST_REPOSITORY_HOST_NOT_ALLOWED",
    TRUST_RELEASE_DATE_IN_FUTURE: "TRUST_RELEASE_DATE_IN_FUTURE",
    TRUST_UNMITIGATED_CRITICAL_ISSUES: "TRUST_UNMITIGATED_CRITICAL_ISSUES",
    TRUST_UNMITIGATED_HIGH_ISSUES: "TRUST_UNMITIGATED_HIGH_ISSUES",
    TRUST_INDIVIDUAL_ADVISORY: "TRUST_INDIVIDUAL_ADVISORY",
    TRUST_BUSINESS_ALLOWED: "TRUST_BUSINESS_ALLOWED",
    TRUST_BUSINESS_DENIED: "TRUST_BUSINESS_DENIED",

    // ── Identity / CAC ────────────────────────────────
    CAC_IDENTITY_BOUND: "CAC_IDENTITY_BOUND",
    CAC_IDENTITY_DISPATCHED: "CAC_IDENTITY_DISPATCHED",
    CAC_IDENTITY_SUSPENDED: "CAC_IDENTITY_SUSPENDED",
    CAC_IDENTITY_RESUMED: "CAC_IDENTITY_RESUMED",
    CAC_IDENTITY_REVOKED: "CAC_IDENTITY_REVOKED",
    CAC_EMAIL_DOMAIN_MISMATCH: "CAC_EMAIL_DOMAIN_MISMATCH",
    CAC_EMAIL_VALIDATION_PASSED: "CAC_EMAIL_VALIDATION_PASSED",
    CAC_SEGMENT_NORMALIZED: "CAC_SEGMENT_NORMALIZED",

    // ── Spectrum Refraction ───────────────────────────
    SR_ISOLATION_FULL: "SR_ISOLATION_FULL",
    SR_ISOLATION_MODEL: "SR_ISOLATION_MODEL",
    SR_ISOLATION_INSUFFICIENT: "SR_ISOLATION_INSUFFICIENT",
    SR_LEFT_MODEL_VALIDATED: "SR_LEFT_MODEL_VALIDATED",
    SR_LEFT_MODEL_REJECTED: "SR_LEFT_MODEL_REJECTED",
    SR_RIGHT_MODEL_VALIDATED: "SR_RIGHT_MODEL_VALIDATED",
    SR_RIGHT_MODEL_REJECTED: "SR_RIGHT_MODEL_REJECTED",
    SR_FANOUT_COMPLETE: "SR_FANOUT_COMPLETE",
    SR_AGGREGATION_COMPLETE: "SR_AGGREGATION_COMPLETE",
    SR_HEMISPHERE_TIMEOUT: "SR_HEMISPHERE_TIMEOUT",
    SR_GENERATION_FAILED: "SR_GENERATION_FAILED",

    // ── Agent Lifecycle & Swarm ──────────────────────
    AGENT_LIFECYCLE_CREATED: "AGENT_LIFECYCLE_CREATED",
    AGENT_LIFECYCLE_STARTED: "AGENT_LIFECYCLE_STARTED",
    AGENT_LIFECYCLE_SUSPENDED: "AGENT_LIFECYCLE_SUSPENDED",
    AGENT_LIFECYCLE_RESUMED: "AGENT_LIFECYCLE_RESUMED",
    AGENT_LIFECYCLE_STOPPED: "AGENT_LIFECYCLE_STOPPED",
    AGENT_LIFECYCLE_REAPED: "AGENT_LIFECYCLE_REAPED",
    AGENT_MODEL_ASSIGNED: "AGENT_MODEL_ASSIGNED",
    AGENT_MODEL_HOT_SWAPPED: "AGENT_MODEL_HOT_SWAPPED",
    AGENT_PROMOTION_RECOMMENDED: "AGENT_PROMOTION_RECOMMENDED",
    SWARM_TOPOLOGY_MESH: "SWARM_TOPOLOGY_MESH",
    SWARM_TOPOLOGY_STAR: "SWARM_TOPOLOGY_STAR",
    SWARM_TOPOLOGY_PIPELINE: "SWARM_TOPOLOGY_PIPELINE",
    SWARM_TOPOLOGY_BROADCAST: "SWARM_TOPOLOGY_BROADCAST",
    SWARM_TASK_DECOMPOSED: "SWARM_TASK_DECOMPOSED",
    SWARM_GOAL_COMPLETED: "SWARM_GOAL_COMPLETED",
    SWARM_GOAL_FAILED: "SWARM_GOAL_FAILED",

    // ── Computer-Use ──────────────────────────────────
    TERMINAL_SESSION_CREATED: "TERMINAL_SESSION_CREATED",
    TERMINAL_SESSION_COMMAND_EXECUTED: "TERMINAL_SESSION_COMMAND_EXECUTED",
    TERMINAL_SESSION_CLOSED: "TERMINAL_SESSION_CLOSED",
    TERMINAL_SESSION_REVOKED: "TERMINAL_SESSION_REVOKED",
    CONTAINER_CREATED: "CONTAINER_CREATED",
    CONTAINER_STARTED: "CONTAINER_STARTED",
    CONTAINER_STOPPED: "CONTAINER_STOPPED",
    CONTAINER_DESTROYED: "CONTAINER_DESTROYED",
    CONTAINER_SNAPSHOT_CREATED: "CONTAINER_SNAPSHOT_CREATED",
    CONTAINER_SNAPSHOT_REVERTED: "CONTAINER_SNAPSHOT_REVERTED",
    CONTAINER_QUOTA_EXCEEDED: "CONTAINER_QUOTA_EXCEEDED",

    // ── Workflow ───────────────────────────────────────
    WORKFLOW_STEP_STARTED: "WORKFLOW_STEP_STARTED",
    WORKFLOW_STEP_SUCCEEDED: "WORKFLOW_STEP_SUCCEEDED",
    WORKFLOW_STEP_FAILED: "WORKFLOW_STEP_FAILED",
    WORKFLOW_STEP_TIMEOUT: "WORKFLOW_STEP_TIMEOUT",
    WORKFLOW_FALLBACK_TRIGGERED: "WORKFLOW_FALLBACK_TRIGGERED",
    WORKFLOW_RETRY_TRIGGERED: "WORKFLOW_RETRY_TRIGGERED",
    WORKFLOW_COMPLETED: "WORKFLOW_COMPLETED",
    WORKFLOW_ABORTED: "WORKFLOW_ABORTED",

    // ── Plugin Validation ────────────────────────────
    PLUGIN_VALIDATION_PASSED: "PLUGIN_VALIDATION_PASSED",
    PLUGIN_VALIDATION_FAILED: "PLUGIN_VALIDATION_FAILED",
    PLUGIN_LOADED: "PLUGIN_LOADED",
    PLUGIN_REJECTED: "PLUGIN_REJECTED",
} as const;

export type TaxonomyReasonCode = (typeof TAXONOMY_CODES)[keyof typeof TAXONOMY_CODES];

/** Union of all reason codes used across the system. */
export type AllReasonCode = PolicyReasonCode | TaxonomyReasonCode;

/* ──────────────────────────────────────────────────────
 *  Full Taxonomy Registry
 * ────────────────────────────────────────────────────── */

export const REASON_CODE_TAXONOMY: ReadonlyArray<ReasonCodeEntry> = [
    // ── Governance (from POLICY_REASON_CODES) ─────────
    { code: POLICY_REASON_CODES.HIGH_RISK_ALLOWED_PROFILE_BYPASS, domain: "governance", severity: "warn", description: "High-risk operation allowed because the execution profile does not require tier 3 approval." },
    { code: POLICY_REASON_CODES.HIGH_RISK_ALLOWED_WHITELIST_BYPASS, domain: "governance", severity: "warn", description: "High-risk operation allowed via whitelist bypass in the execution profile." },
    { code: POLICY_REASON_CODES.HIGH_RISK_APPROVAL_REQUIRED, domain: "governance", severity: "deny", description: "High-risk operation requires explicit tier 3 approval before execution." },
    { code: POLICY_REASON_CODES.MEDIUM_RISK_DENY_MISSING_ROLLBACK, domain: "governance", severity: "deny", description: "Medium-risk state mutation denied because no rollback plan was provided (required by business profile)." },
    { code: POLICY_REASON_CODES.MEDIUM_RISK_WARN_MISSING_ROLLBACK, domain: "governance", severity: "warn", description: "Medium-risk state mutation allowed but no rollback plan provided (individual profile advisory)." },
    { code: POLICY_REASON_CODES.MEDIUM_RISK_ALLOW_CONDITIONAL, domain: "governance", severity: "info", description: "Medium-risk operation allowed with governance checks (conditional tier 2)." },
    { code: POLICY_REASON_CODES.MEDIUM_RISK_DENY_TIER2_DISABLED, domain: "governance", severity: "deny", description: "Medium-risk operation denied because tier 2 conditional is disabled for this profile." },
    { code: POLICY_REASON_CODES.LOW_RISK_AUDIT_LOGGED, domain: "governance", severity: "info", description: "Low-risk operation logged for audit trail (business profile auditAllOperations)." },
    { code: POLICY_REASON_CODES.LOW_RISK_DENY_BUSINESS_MUTATION, domain: "governance", severity: "deny", description: "Low-risk mutation denied in business segment (requires governance tier 2+)." },
    { code: POLICY_REASON_CODES.LOW_RISK_DENY_TIER1_DISABLED, domain: "governance", severity: "deny", description: "Low-risk operation denied because autonomous (tier 1) is disabled for this profile." },
    { code: POLICY_REASON_CODES.LOW_RISK_ALLOW_AUTONOMOUS, domain: "governance", severity: "info", description: "Low-risk operation allowed as autonomous execution (tier 1)." },
    { code: POLICY_REASON_CODES.FALLBACK_DENY_NO_RULE, domain: "governance", severity: "critical", description: "No matching policy rule found; operation denied by default (should not occur in production)." },

    // ── Directive Integrity ───────────────────────────
    { code: POLICY_REASON_CODES.DIRECTIVE_INTEGRITY_VERIFIED, domain: "directive", severity: "info", description: "Permanent Active Directives SHA-256 hash matches expected value; integrity confirmed." },
    { code: POLICY_REASON_CODES.DIRECTIVE_INTEGRITY_VIOLATION, domain: "directive", severity: "critical", description: "Permanent Active Directives SHA-256 hash mismatch; file may have been tampered with." },
    { code: POLICY_REASON_CODES.DIRECTIVE_AMENDMENT_UNAUTHORIZED, domain: "directive", severity: "critical", description: "Attempted amendment to Permanent Active Directives rejected; requires formal amendment process." },

    // ── CAC Identity (from POLICY_REASON_CODES) ───────
    { code: POLICY_REASON_CODES.CAC_PLACEHOLDER_IDENTITY_DENY, domain: "identity", severity: "deny", description: "Business profile operation denied because the active identity is a placeholder (e.g. unverified default user); a real bound identity is required." },
    { code: POLICY_REASON_CODES.CAC_EMAIL_VERIFICATION_REQUIRED, domain: "identity", severity: "deny", description: "Business + tier-2-or-higher email-bound operation denied because no fresh OAuth email verification is on file; user must re-verify before proceeding." },

    // ── Trust / Provenance ────────────────────────────
    { code: TAXONOMY_CODES.TRUST_LEVEL_BELOW_MIN, domain: "trust", severity: "deny", description: "Plugin trust level is below the minimum required by the business trust policy." },
    { code: TAXONOMY_CODES.TRUST_AUTHOR_EMAIL_MISSING, domain: "trust", severity: "deny", description: "Plugin manifest author email is required but missing." },
    { code: TAXONOMY_CODES.TRUST_REVIEW_STATUS_MISSING, domain: "trust", severity: "deny", description: "Plugin security review status is required but not declared." },
    { code: TAXONOMY_CODES.TRUST_REVIEW_STATUS_NOT_ALLOWED, domain: "trust", severity: "deny", description: "Plugin security review status is not in the allowed list." },
    { code: TAXONOMY_CODES.TRUST_SIGNATURE_REQUIRED, domain: "trust", severity: "deny", description: "Plugin signature is required by policy but not present." },
    { code: TAXONOMY_CODES.TRUST_SIGNATURE_ALGORITHM_INVALID, domain: "trust", severity: "deny", description: "Plugin signature algorithm is not in the allowed list." },
    { code: TAXONOMY_CODES.TRUST_SIGNATURE_VERIFICATION_FAILED, domain: "trust", severity: "critical", description: "Plugin cryptographic signature verification failed; manifest may have been tampered with." },
    { code: TAXONOMY_CODES.TRUST_PUBLIC_KEY_MISSING, domain: "trust", severity: "deny", description: "Signature verification requested but no public key was provided." },
    { code: TAXONOMY_CODES.TRUST_REPOSITORY_REQUIRED, domain: "trust", severity: "deny", description: "Plugin repository URL is required by policy but not declared." },
    { code: TAXONOMY_CODES.TRUST_REPOSITORY_PROTOCOL_NOT_HTTPS, domain: "trust", severity: "deny", description: "Plugin repository URL must use HTTPS protocol." },
    { code: TAXONOMY_CODES.TRUST_REPOSITORY_HOST_NOT_ALLOWED, domain: "trust", severity: "deny", description: "Plugin repository host is not in the allowed list." },
    { code: TAXONOMY_CODES.TRUST_RELEASE_DATE_IN_FUTURE, domain: "trust", severity: "warn", description: "Plugin release date is in the future; may indicate clock skew or pre-release artifact." },
    { code: TAXONOMY_CODES.TRUST_UNMITIGATED_CRITICAL_ISSUES, domain: "trust", severity: "critical", description: "Plugin has unmitigated critical security issues exceeding policy threshold." },
    { code: TAXONOMY_CODES.TRUST_UNMITIGATED_HIGH_ISSUES, domain: "trust", severity: "deny", description: "Plugin has unmitigated high-severity security issues exceeding policy threshold." },
    { code: TAXONOMY_CODES.TRUST_INDIVIDUAL_ADVISORY, domain: "trust", severity: "info", description: "Trust validation passed for individual profile in advisory mode." },
    { code: TAXONOMY_CODES.TRUST_BUSINESS_ALLOWED, domain: "trust", severity: "info", description: "Plugin passed all business trust policy requirements." },
    { code: TAXONOMY_CODES.TRUST_BUSINESS_DENIED, domain: "trust", severity: "deny", description: "Plugin denied by business trust policy due to one or more failures." },

    // ── Identity / CAC ────────────────────────────────
    { code: TAXONOMY_CODES.CAC_IDENTITY_BOUND, domain: "identity", severity: "info", description: "Character identity bound to accountability chain for session." },
    { code: TAXONOMY_CODES.CAC_IDENTITY_DISPATCHED, domain: "identity", severity: "info", description: "Character dispatched to active assignment." },
    { code: TAXONOMY_CODES.CAC_IDENTITY_SUSPENDED, domain: "identity", severity: "warn", description: "Character assignment suspended." },
    { code: TAXONOMY_CODES.CAC_IDENTITY_RESUMED, domain: "identity", severity: "info", description: "Character assignment resumed from suspended state." },
    { code: TAXONOMY_CODES.CAC_IDENTITY_REVOKED, domain: "identity", severity: "deny", description: "Character assignment revoked; further operations under this identity are blocked." },
    { code: TAXONOMY_CODES.CAC_EMAIL_DOMAIN_MISMATCH, domain: "identity", severity: "deny", description: "Business profile email domain does not match expected operator domain." },
    { code: TAXONOMY_CODES.CAC_EMAIL_VALIDATION_PASSED, domain: "identity", severity: "info", description: "Email validation passed for the current execution profile." },
    { code: TAXONOMY_CODES.CAC_SEGMENT_NORMALIZED, domain: "identity", severity: "info", description: "Execution segment normalized (e.g., enterprise/corporate → business)." },

    // ── Spectrum Refraction ───────────────────────────
    { code: TAXONOMY_CODES.SR_ISOLATION_FULL, domain: "spectrum_refraction", severity: "info", description: "SR triad has full isolation: different providers for Left and Right hemispheres." },
    { code: TAXONOMY_CODES.SR_ISOLATION_MODEL, domain: "spectrum_refraction", severity: "warn", description: "SR triad has model-level isolation: same provider, different models." },
    { code: TAXONOMY_CODES.SR_ISOLATION_INSUFFICIENT, domain: "spectrum_refraction", severity: "deny", description: "SR triad isolation is insufficient: same provider and model for Left and Right." },
    { code: TAXONOMY_CODES.SR_LEFT_MODEL_VALIDATED, domain: "spectrum_refraction", severity: "info", description: "Left (Logic) hemisphere model passed SR qualification." },
    { code: TAXONOMY_CODES.SR_LEFT_MODEL_REJECTED, domain: "spectrum_refraction", severity: "deny", description: "Left (Logic) hemisphere model failed SR qualification (insufficient tier or missing strengths)." },
    { code: TAXONOMY_CODES.SR_RIGHT_MODEL_VALIDATED, domain: "spectrum_refraction", severity: "info", description: "Right (Creative) hemisphere model passed SR qualification." },
    { code: TAXONOMY_CODES.SR_RIGHT_MODEL_REJECTED, domain: "spectrum_refraction", severity: "deny", description: "Right (Creative) hemisphere model failed SR qualification (missing image-generation modality)." },
    { code: TAXONOMY_CODES.SR_FANOUT_COMPLETE, domain: "spectrum_refraction", severity: "info", description: "SR parallel fan-out to all three hemispheres completed." },
    { code: TAXONOMY_CODES.SR_AGGREGATION_COMPLETE, domain: "spectrum_refraction", severity: "info", description: "SR aggregation pass completed; final synthesized response produced." },
    { code: TAXONOMY_CODES.SR_HEMISPHERE_TIMEOUT, domain: "spectrum_refraction", severity: "warn", description: "One or more SR hemispheres timed out during generation." },
    { code: TAXONOMY_CODES.SR_GENERATION_FAILED, domain: "spectrum_refraction", severity: "critical", description: "SR generation failed entirely; no output produced." },

    // ── Agent Lifecycle & Swarm ──────────────────────
    { code: TAXONOMY_CODES.AGENT_LIFECYCLE_CREATED, domain: "agent", severity: "info", description: "Agent instance created in the pool." },
    { code: TAXONOMY_CODES.AGENT_LIFECYCLE_STARTED, domain: "agent", severity: "info", description: "Agent started and accepting tasks." },
    { code: TAXONOMY_CODES.AGENT_LIFECYCLE_SUSPENDED, domain: "agent", severity: "warn", description: "Agent suspended (idle timeout or manual)." },
    { code: TAXONOMY_CODES.AGENT_LIFECYCLE_RESUMED, domain: "agent", severity: "info", description: "Agent resumed from suspended state." },
    { code: TAXONOMY_CODES.AGENT_LIFECYCLE_STOPPED, domain: "agent", severity: "info", description: "Agent stopped (manual shutdown)." },
    { code: TAXONOMY_CODES.AGENT_LIFECYCLE_REAPED, domain: "agent", severity: "info", description: "Ephemeral agent reaped after task completion." },
    { code: TAXONOMY_CODES.AGENT_MODEL_ASSIGNED, domain: "agent", severity: "info", description: "Model assigned to agent at creation or configuration." },
    { code: TAXONOMY_CODES.AGENT_MODEL_HOT_SWAPPED, domain: "agent", severity: "warn", description: "Agent model hot-swapped at runtime." },
    { code: TAXONOMY_CODES.AGENT_PROMOTION_RECOMMENDED, domain: "agent", severity: "info", description: "Telemetry suggests promoting agent to a higher lifecycle tier." },
    { code: TAXONOMY_CODES.SWARM_TOPOLOGY_MESH, domain: "agent", severity: "info", description: "Swarm using mesh topology (all-to-all communication)." },
    { code: TAXONOMY_CODES.SWARM_TOPOLOGY_STAR, domain: "agent", severity: "info", description: "Swarm using star topology (coordinator + workers)." },
    { code: TAXONOMY_CODES.SWARM_TOPOLOGY_PIPELINE, domain: "agent", severity: "info", description: "Swarm using pipeline topology (sequential processing)." },
    { code: TAXONOMY_CODES.SWARM_TOPOLOGY_BROADCAST, domain: "agent", severity: "info", description: "Swarm using broadcast topology (one-to-all distribution)." },
    { code: TAXONOMY_CODES.SWARM_TASK_DECOMPOSED, domain: "agent", severity: "info", description: "Swarm goal decomposed into parallel task batches." },
    { code: TAXONOMY_CODES.SWARM_GOAL_COMPLETED, domain: "agent", severity: "info", description: "Swarm goal completed successfully." },
    { code: TAXONOMY_CODES.SWARM_GOAL_FAILED, domain: "agent", severity: "critical", description: "Swarm goal failed after all retry attempts." },

    // ── Computer-Use ──────────────────────────────────
    { code: TAXONOMY_CODES.TERMINAL_SESSION_CREATED, domain: "computer_use", severity: "info", description: "Terminal session created." },
    { code: TAXONOMY_CODES.TERMINAL_SESSION_COMMAND_EXECUTED, domain: "computer_use", severity: "info", description: "Command executed within terminal session." },
    { code: TAXONOMY_CODES.TERMINAL_SESSION_CLOSED, domain: "computer_use", severity: "info", description: "Terminal session closed gracefully." },
    { code: TAXONOMY_CODES.TERMINAL_SESSION_REVOKED, domain: "computer_use", severity: "deny", description: "Terminal session revoked by governance policy." },
    { code: TAXONOMY_CODES.CONTAINER_CREATED, domain: "computer_use", severity: "info", description: "Container sandbox created." },
    { code: TAXONOMY_CODES.CONTAINER_STARTED, domain: "computer_use", severity: "info", description: "Container started and running." },
    { code: TAXONOMY_CODES.CONTAINER_STOPPED, domain: "computer_use", severity: "info", description: "Container stopped." },
    { code: TAXONOMY_CODES.CONTAINER_DESTROYED, domain: "computer_use", severity: "info", description: "Container destroyed and resources released." },
    { code: TAXONOMY_CODES.CONTAINER_SNAPSHOT_CREATED, domain: "computer_use", severity: "info", description: "Container filesystem snapshot created." },
    { code: TAXONOMY_CODES.CONTAINER_SNAPSHOT_REVERTED, domain: "computer_use", severity: "warn", description: "Container reverted to a previous snapshot." },
    { code: TAXONOMY_CODES.CONTAINER_QUOTA_EXCEEDED, domain: "computer_use", severity: "deny", description: "Container resource quota exceeded (CPU, memory, or disk)." },

    // ── Workflow ───────────────────────────────────────
    { code: TAXONOMY_CODES.WORKFLOW_STEP_STARTED, domain: "workflow", severity: "info", description: "Workflow step execution started." },
    { code: TAXONOMY_CODES.WORKFLOW_STEP_SUCCEEDED, domain: "workflow", severity: "info", description: "Workflow step completed successfully." },
    { code: TAXONOMY_CODES.WORKFLOW_STEP_FAILED, domain: "workflow", severity: "warn", description: "Workflow step failed; may trigger retry or fallback." },
    { code: TAXONOMY_CODES.WORKFLOW_STEP_TIMEOUT, domain: "workflow", severity: "warn", description: "Workflow step exceeded its timeout threshold." },
    { code: TAXONOMY_CODES.WORKFLOW_FALLBACK_TRIGGERED, domain: "workflow", severity: "warn", description: "Workflow fallback route activated due to step failure or timeout." },
    { code: TAXONOMY_CODES.WORKFLOW_RETRY_TRIGGERED, domain: "workflow", severity: "info", description: "Workflow step retry triggered per retry policy." },
    { code: TAXONOMY_CODES.WORKFLOW_COMPLETED, domain: "workflow", severity: "info", description: "Workflow completed all steps successfully." },
    { code: TAXONOMY_CODES.WORKFLOW_ABORTED, domain: "workflow", severity: "critical", description: "Workflow aborted after exhausting all retry and fallback paths." },

    // ── Plugin Validation ────────────────────────────
    { code: TAXONOMY_CODES.PLUGIN_VALIDATION_PASSED, domain: "trust", severity: "info", description: "Plugin pack manifest passed all validation checks." },
    { code: TAXONOMY_CODES.PLUGIN_VALIDATION_FAILED, domain: "trust", severity: "deny", description: "Plugin pack manifest failed validation with one or more errors." },
    { code: TAXONOMY_CODES.PLUGIN_LOADED, domain: "trust", severity: "info", description: "Plugin pack loaded and registered in the adapter pipeline." },
    { code: TAXONOMY_CODES.PLUGIN_REJECTED, domain: "trust", severity: "deny", description: "Plugin pack rejected during load-time validation; not registered." },
];

/* ──────────────────────────────────────────────────────
 *  Lookup Utilities
 * ────────────────────────────────────────────────────── */

const _codeMap = new Map<string, ReasonCodeEntry>();
for (const entry of REASON_CODE_TAXONOMY) {
    _codeMap.set(entry.code, entry);
}

/** Look up a taxonomy entry by code. Returns undefined if unknown. */
export function lookupReasonCode(code: string): ReasonCodeEntry | undefined {
    return _codeMap.get(code);
}

/** Get all codes for a given domain. */
export function codesByDomain(domain: ReasonCodeDomain): ReadonlyArray<ReasonCodeEntry> {
    return REASON_CODE_TAXONOMY.filter(e => e.domain === domain);
}

/** Get all codes at or above a given severity. */
export function codesAtOrAboveSeverity(minSeverity: ReasonCodeSeverity): ReadonlyArray<ReasonCodeEntry> {
    const order: Record<ReasonCodeSeverity, number> = { info: 0, warn: 1, deny: 2, critical: 3 };
    const threshold = order[minSeverity];
    return REASON_CODE_TAXONOMY.filter(e => order[e.severity] >= threshold);
}

/** Validate that a set of codes all exist in the taxonomy. Returns unknown codes. */
export function validateCodes(codes: readonly string[]): string[] {
    return codes.filter(c => !_codeMap.has(c));
}

/** Total count of registered reason codes. */
export function taxonomySize(): number {
    return REASON_CODE_TAXONOMY.length;
}
