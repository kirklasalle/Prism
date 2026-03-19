import type { ToolRequest, GovernanceSchema } from "./types.js";
import type { OperationRisk } from "../policy/types.js";

const riskRank: Record<OperationRisk, number> = {
    low: 1,
    medium: 2,
    high: 3,
};

/**
 * Extract the action name from a tool request.
 * Handles both "action" arg (common in D2 tools) and operation-level dispatch.
 */
export function extractActionFromRequest(request: ToolRequest): string | null {
    const actionArg = request.args.action;
    if (typeof actionArg === "string") {
        return actionArg.toLowerCase();
    }
    return null;
}

/**
 * Normalize a request based on the tool's governance schema.
 * Returns a normalized request and a list of normalizations applied.
 */
export function normalizeRequestByGovernance(
    request: ToolRequest,
    schema: GovernanceSchema | undefined,
): {
    normalized: ToolRequest;
    normalizations: Array<{ field: string; oldValue: unknown; newValue: unknown; reason: string }>;
} {
    const normalizations: Array<{ field: string; oldValue: unknown; newValue: unknown; reason: string }> = [];
    const normalized = { ...request };

    if (!schema) {
        return { normalized, normalizations };
    }

    // Extract action from request
    const action = extractActionFromRequest(request);
    if (!action) {
        // No action specified, can't normalize
        return { normalized, normalizations };
    }

    const rule = schema.actions[action];
    if (!rule) {
        // No governance rule for this action, use defaults
        return { normalized, normalizations };
    }

    // Check risk adequacy
    const currentRiskRank = riskRank[normalized.risk as OperationRisk] ?? 0;
    const minimumRiskRank = riskRank[rule.minimumRisk] ?? 0;

    if (currentRiskRank < minimumRiskRank) {
        normalizations.push({
            field: "risk",
            oldValue: normalized.risk,
            newValue: rule.minimumRisk,
            reason: `Action '${action}' requires minimum risk=${rule.minimumRisk}. Auto-promoted from ${normalized.risk}.`,
        });
        normalized.risk = rule.minimumRisk as OperationRisk;
    }

    // Check mutating state declaration
    if (rule.mutating && !normalized.mutatesState) {
        normalizations.push({
            field: "mutatesState",
            oldValue: normalized.mutatesState,
            newValue: true,
            reason: `Action '${action}' is inherently mutating. Auto-corrected declaration.`,
        });
        normalized.mutatesState = true;
    }

    // Check rollback requirement
    if (rule.rollbackRequired && !normalized.rollbackPlan && normalized.risk !== "low") {
        // Auto-generate a placeholder if one is missing for high-risk mutations
        normalizations.push({
            field: "rollbackPlan",
            oldValue: normalized.rollbackPlan ?? "(missing)",
            newValue: `[Rollback plan required for ${action} at risk=${normalized.risk}]`,
            reason: `Action '${action}' requires explicit rollback plan; placeholder enforced.`,
        });
        normalized.rollbackPlan = `[Rollback plan required for ${action} at risk=${normalized.risk}]`;
    }

    return { normalized, normalizations };
}

/**
 * Validate a request against governance schema.
 * Returns null if valid, or an error message if validation fails.
 */
export function validateRequestAgainstGovernance(
    request: ToolRequest,
    schema: GovernanceSchema | undefined,
): string | null {
    if (!schema) {
        return null;
    }

    const action = extractActionFromRequest(request);
    if (!action) {
        return null; // No action to validate
    }

    const rule = schema.actions[action];
    if (!rule) {
        return null; // No rule for this action
    }

    const currentRiskRank = riskRank[request.risk as OperationRisk] ?? 0;
    const minimumRiskRank = riskRank[rule.minimumRisk] ?? 0;

    if (currentRiskRank < minimumRiskRank) {
        return `Action '${action}' requires risk=${rule.minimumRisk} or higher; got risk=${request.risk}.`;
    }

    if (rule.mutating && !request.mutatesState) {
        return `Action '${action}' is mutating but request has mutatesState=false.`;
    }

    if (rule.rollbackRequired && !request.rollbackPlan && rule.minimumRisk !== "low") {
        return `Action '${action}' (risk=${rule.minimumRisk}) requires rollbackPlan; none provided.`;
    }

    return null;
}
