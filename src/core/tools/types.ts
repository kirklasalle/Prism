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
    }>;
}

export interface Tool {
    name: string;
    contract?: ToolContract;
    execute(request: ToolRequest): Promise<ToolResult>;
}
