import type { ToolRequest } from "./types.js";

export type ToolArgSchemaType = "string" | "number" | "boolean" | "object";

export interface ToolArgSchema {
    type: ToolArgSchemaType;
    required?: boolean;
    enum?: readonly string[];
}

export interface ToolContract {
    version: string;
    args: Record<string, ToolArgSchema>;
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export function validateToolContract(toolName: string, contract: ToolContract): string[] {
    const errors: string[] = [];

    if (!SEMVER_PATTERN.test(contract.version)) {
        errors.push(
            `Tool ${toolName} contract version must be semver (x.y.z), got "${contract.version}".`,
        );
    }

    if (!contract.args || typeof contract.args !== "object") {
        errors.push(`Tool ${toolName} contract args schema must be an object.`);
        return errors;
    }

    for (const [argName, schema] of Object.entries(contract.args)) {
        if (!schema || typeof schema !== "object") {
            errors.push(`Tool ${toolName} arg "${argName}" schema is invalid.`);
            continue;
        }

        if (!["string", "number", "boolean", "object"].includes(schema.type)) {
            errors.push(`Tool ${toolName} arg "${argName}" has unsupported type "${schema.type}".`);
        }

        if (schema.enum && schema.type !== "string") {
            errors.push(`Tool ${toolName} arg "${argName}" enum is only supported for string type.`);
        }
    }

    return errors;
}

export function validateToolRequestAgainstContract(
    request: ToolRequest,
    contract: ToolContract,
): string[] {
    const errors: string[] = [];

    for (const [argName, schema] of Object.entries(contract.args)) {
        const value = request.args[argName];

        if (schema.required && value === undefined) {
            errors.push(`Missing required arg "${argName}".`);
            continue;
        }

        if (value === undefined) {
            continue;
        }

        if (!matchesType(schema.type, value)) {
            errors.push(`Arg "${argName}" expected ${schema.type}, got ${typeof value}.`);
            continue;
        }

        if (schema.enum && typeof value === "string" && !schema.enum.includes(value)) {
            errors.push(`Arg "${argName}" must be one of: ${schema.enum.join(", ")}.`);
        }
    }

    return errors;
}

function matchesType(expected: ToolArgSchemaType, value: unknown): boolean {
    if (expected === "object") {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    return typeof value === expected;
}