/**
 * Execution Authority Context — Phase 3 Universal Enforcement (IC-05)
 *
 * Defines the mandatory authority context that MUST accompany every
 * privileged action in PRISM (orchestrator, tool dispatch, computer/browser control,
 * approval queue, scheduled jobs, and MCP/A2A calls).
 *
 * Server-Side Resolution Strategy (Individual & Business Profiles):
 *   - Server resolves authority context from session certificate + CAC assignment state.
 *   - Individual Profile: Binds operator's primary certificate & CAC Main Agent.
 *   - Business Profile: Binds multi-tenant operator identity, assigned character,
 *     tenant ID, and execution profile segment.
 *   - Caller-supplied context objects are REJECTED (`resolvedBy === "caller"`).
 *
 * @module core/security/execution-authority-context
 */

export interface ExecutionAuthorityContext {
    /** The Initialization Certificate ID authorizing this action. */
    certificateId: string | null;
    /** The CAC assignment ID binding operator to character. */
    assignmentId: string | null;
    /** Operator email resolved from the certificate. */
    operatorEmail: string | null;
    /** Operator display name resolved from IAM. */
    operatorName: string | null;
    /** CAC/assistant email resolved from the assignment. */
    cacEmail: string | null;
    /** CAC/assistant display name resolved from the assignment. */
    cacName: string | null;
    /** Execution profile segment ('individual' | 'business'). */
    executionProfile?: "individual" | "business";
    /** Tenant identifier for multi-tenant Business profile setups. */
    tenantId?: string | null;
    /** ISO-8601 timestamp when this context was resolved. */
    resolvedAt: string;
    /** Whether this context was resolved server-side or supplied by the caller. */
    resolvedBy: "server" | "caller";
}

export interface AuthorityValidationResult {
    /** Whether the context is valid for execution. */
    valid: boolean;
    /** Human-readable reason for the validation result. */
    reason: string;
    /** List of specific missing fields. */
    missingFields: string[];
}

/** Error thrown when authority context validation fails in Phase 3 hard-gate mode. */
export class ExecutionAuthorityError extends Error {
    constructor(
        message: string,
        public readonly missingFields: string[] = [],
    ) {
        super(message);
        this.name = "ExecutionAuthorityError";
    }
}

/** Fields that must be present for a fully valid authority context. */
const REQUIRED_FIELDS: (keyof ExecutionAuthorityContext)[] = [
    "certificateId",
    "assignmentId",
    "operatorEmail",
    "resolvedAt",
    "resolvedBy",
];

/**
 * Validate an execution authority context (Phase 3 Hard Gate).
 *
 * Checks:
 *   1. Context must exist (non-null/undefined).
 *   2. Context MUST be resolved by server (`resolvedBy === "server"`).
 *   3. All required fields must be present.
 *
 * @param ctx - The authority context to validate.
 * @returns Validation result with `valid: false` if any check fails.
 */
export function validateAuthorityContext(
    ctx: ExecutionAuthorityContext | null | undefined,
): AuthorityValidationResult {
    if (!ctx) {
        return {
            valid: false,
            reason: "EXECUTION_BLOCKED: ExecutionAuthorityContext is absent — action lacks required certificate/CAC provenance (IC-05)",
            missingFields: [...REQUIRED_FIELDS],
        };
    }

    if (ctx.resolvedBy === "caller") {
        return {
            valid: false,
            reason: "EXECUTION_BLOCKED: ExecutionAuthorityContext resolved by caller, not server — caller-supplied identity is forbidden (IC-05)",
            missingFields: ["resolvedBy"],
        };
    }

    const missing: string[] = [];
    for (const field of REQUIRED_FIELDS) {
        if (ctx[field] === null || ctx[field] === undefined || ctx[field] === "") {
            missing.push(field);
        }
    }

    if (missing.length > 0) {
        const msg = `EXECUTION_BLOCKED: ExecutionAuthorityContext missing required fields: ${missing.join(", ")}`;
        return {
            valid: false,
            reason: msg,
            missingFields: missing,
        };
    }

    return {
        valid: true,
        reason: `Authority context complete (${ctx.executionProfile || "individual"} profile, tenant: ${ctx.tenantId || "default"})`,
        missingFields: [],
    };
}

/**
 * Enforce authority context validation — throws ExecutionAuthorityError if invalid.
 */
export function enforceAuthorityContext(ctx: ExecutionAuthorityContext | null | undefined): ExecutionAuthorityContext {
    const result = validateAuthorityContext(ctx);
    if (!result.valid) {
        throw new ExecutionAuthorityError(result.reason, result.missingFields);
    }
    return ctx!;
}

/**
 * Create a server-resolved authority context for an operator + CAC assignment.
 * Supports both Individual and Business profiles.
 */
export function createServerAuthorityContext(params: {
    certificateId: string;
    assignmentId: string;
    operatorEmail: string;
    operatorName?: string | null;
    cacEmail?: string | null;
    cacName?: string | null;
    executionProfile?: "individual" | "business";
    tenantId?: string | null;
}): ExecutionAuthorityContext {
    return {
        certificateId: params.certificateId,
        assignmentId: params.assignmentId,
        operatorEmail: params.operatorEmail.trim().toLowerCase(),
        operatorName: params.operatorName ? params.operatorName.trim() : "Operator",
        cacEmail: params.cacEmail ? params.cacEmail.trim().toLowerCase() : "cac@prismrefraction.com",
        cacName: params.cacName ? params.cacName.trim() : "CAC Main Agent",
        executionProfile: params.executionProfile ?? "individual",
        tenantId: params.tenantId ?? "default",
        resolvedAt: new Date().toISOString(),
        resolvedBy: "server",
    };
}
