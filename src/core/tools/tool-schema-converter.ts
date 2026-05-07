import type { Tool } from "./types.js";
import type { ToolContract, ToolArgSchema } from "./contracts.js";
import type { LlmToolDefinition, LlmToolParameterSchema } from "../operator/llm-provider-manager.js";

/**
 * Converts PRISM Tool instances into LLM-compatible function-calling schemas.
 * Handles:
 * - Builtin tools with ToolContract.args
 * - MCP proxy tools with inputSchema (JSON Schema)
 * - Tools with no schema (generates a passthrough schema)
 */
export function toolsToLlmDefinitions(tools: Tool[]): LlmToolDefinition[] {
    const definitions: LlmToolDefinition[] = [];
    for (const tool of tools) {
        const def = toolToLlmDefinition(tool);
        if (def) definitions.push(def);
    }
    return definitions;
}

export function toolToLlmDefinition(tool: Tool): LlmToolDefinition | null {
    // MCP proxy tools store their schema differently
    const mcpTool = tool as any;
    if (mcpTool.mcpInputSchema) {
        return mcpToolToDefinition(tool.name, mcpTool.mcpDescription ?? "", mcpTool.mcpInputSchema);
    }

    if (tool.contract) {
        return contractToolToDefinition(tool.name, tool.contract);
    }

    // Tools with no contract or inputSchema: generate a description-only entry
    // with a generic args passthrough
    return {
        name: tool.name,
        description: descriptionFromName(tool.name),
        parameters: {
            type: "object",
            properties: {
                args: {
                    type: "object",
                    description: "Arguments to pass to the tool as key-value pairs.",
                },
            },
            required: [],
        },
    };
}

function contractToolToDefinition(name: string, contract: ToolContract): LlmToolDefinition {
    const properties: Record<string, LlmToolParameterSchema> = {};
    const required: string[] = [];

    for (const [argName, schema] of Object.entries(contract.args)) {
        properties[argName] = contractArgToSchema(schema);
        if (schema.required) {
            required.push(argName);
        }
    }

    return {
        name,
        description: descriptionFromName(name),
        parameters: {
            type: "object",
            properties,
            required: required.length > 0 ? required : undefined,
        },
    };
}

function contractArgToSchema(arg: ToolArgSchema): LlmToolParameterSchema {
    const schema: LlmToolParameterSchema = { type: arg.type };
    if (arg.enum?.length) {
        schema.enum = [...arg.enum];
    }
    return schema;
}

function mcpToolToDefinition(
    name: string,
    description: string,
    inputSchema: { type?: string; properties?: Record<string, any>; required?: string[] },
): LlmToolDefinition {
    const properties: Record<string, LlmToolParameterSchema> = {};
    if (inputSchema.properties) {
        for (const [propName, propSchema] of Object.entries(inputSchema.properties)) {
            properties[propName] = sanitizeMcpPropertySchema(propSchema);
        }
    }

    return {
        name,
        description: description || descriptionFromName(name),
        parameters: {
            type: "object",
            properties,
            required: inputSchema.required,
        },
    };
}

/**
 * Sanitize an individual MCP property schema for OpenAI compatibility.
 * OpenAI requires `items` on array types and rejects unknown fields.
 */
function sanitizeMcpPropertySchema(propSchema: any): LlmToolParameterSchema {
    if (!propSchema || typeof propSchema !== "object") {
        return { type: "string" };
    }

    const result: LlmToolParameterSchema = {
        type: propSchema.type ?? "string",
    };

    if (propSchema.description) {
        result.description = propSchema.description;
    }

    if (propSchema.enum?.length) {
        result.enum = [...propSchema.enum];
    }

    // OpenAI requires `items` on array schemas — provide a default if missing
    if (result.type === "array") {
        if (propSchema.items && typeof propSchema.items === "object") {
            result.items = { type: propSchema.items.type ?? "string" };
            if (propSchema.items.description) {
                result.items.description = propSchema.items.description;
            }
            if (propSchema.items.enum?.length) {
                result.items.enum = [...propSchema.items.enum];
            }
        } else {
            result.items = { type: "string" };
        }
    }

    return result;
}

const TOOL_DESCRIPTIONS: Record<string, string> = {
    shell_exec: "Execute a shell command and return stdout/stderr. Args: command (string, required), cwd (string, optional), timeout_ms (number, optional).",
    terminal_session: "Manage persistent terminal sessions. Args: action (string: create|send|read|list|close), session_id (string), command (string).",
    container_sandbox: "Run commands in an isolated container sandbox. Args: action (string), image (string), command (string).",
    file_read: "Read the contents of a file. Args: path (string, required).",
    file_write: "Write content to a file, creating directories as needed. Args: path (string, required), content (string, required).",
    file_delete: "Delete a file. Args: path (string, required).",
    file_list: "List files and directories at a path. Args: path (string, required).",
    http_request: "Make an HTTP request. Args: method (string), url (string, required), headers (object), body (string).",
    network_tool: "Network operations: ping, dns, port scan. Args: action (string, required), target (string, required).",
    neo4j_query: "Execute a Cypher query against Neo4j. Args: query (string, required), params (object).",
    email_capability: "Email operations. Args: action (string, required).",
    calendar_planning: "Calendar operations. Args: action (string, required).",
    notes_extraction: "Notes operations. Args: action (string, required).",
    tasks_timeline: "Task management operations. Args: action (string, required).",
    vision_capture: "Capture screenshots. Args: action (string: capture|burst|list|get), options (object).",
    semantic_query: "Query semantic memory for relevant context. Args: query (string, required).",
    ask_reasoning_model: "Delegate a complex reasoning, coding, or analysis task to the primary reasoning model. Args: prompt (string, required).",
    memory_query: "Query episodic and session memory. Args: query (string, required).",
};

function descriptionFromName(name: string): string {
    return TOOL_DESCRIPTIONS[name] ?? `Execute the ${name} tool.`;
}
