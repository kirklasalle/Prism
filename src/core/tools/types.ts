import type { OperationRisk } from "../policy/types.js";
import type { ToolContract } from "./contracts.js";

export interface ToolRequest {
    operation: string;
    args: Record<string, unknown>;
    risk: OperationRisk;
    mutatesState: boolean;
    rollbackPlan?: string;
}

export interface ToolResult {
    ok: boolean;
    output: Record<string, unknown>;
    sideEffects?: Array<{
        type: "file" | "process" | "network" | "database" | "api";
        description: string;
        action?: string;
        resource?: string;
        mutating?: boolean;
        reversible?: boolean;
        rollbackPlan?: string;
    }>;
}

/**
 * Governance rules for a tool action.
 * Specifies minimum risk tier, mutation requirements, and rollback plan enforcement.
 */
export interface ActionGovernanceRule {
    /** Minimum required risk level for this action. */
    minimumRisk: OperationRisk;
    /** Whether this action mutates state. */
    mutating: boolean;
    /** Whether rollback plan is required (even for non-high-risk executions). */
    rollbackRequired: boolean;
}

/**
 * Per-tool governance schema.
 * Maps action names to their governance rules.
 */
export interface GovernanceSchema {
    /** Maps action name -> governance rule. If action not listed, defaults apply (low risk, non-mutating). */
    actions: Record<string, ActionGovernanceRule>;
}

export interface Tool {
    name: string;
    contract?: ToolContract;
    governance?: GovernanceSchema;
    execute(request: ToolRequest): Promise<ToolResult>;
}
