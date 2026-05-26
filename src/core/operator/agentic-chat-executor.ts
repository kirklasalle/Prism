import { randomUUID } from "node:crypto";
import { resolve, normalize, sep, isAbsolute } from "node:path";
import type { ToolRegistry } from "../tools/registry.js";
import type { Tool, ToolRequest, ToolResult } from "../tools/types.js";
import type {
    LlmToolDefinition,
    LlmToolCall,
    LlmStreamChunk,
} from "./llm-provider-manager.js";
import { toolsToLlmDefinitions } from "../tools/tool-schema-converter.js";
import { resolveWorkspaceRoot } from "../config/workspace-resolver.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgenticChatConfig {
    maxIterations: number;
    maxWritesPerTurn: number;
    maxFileSizeBytes: number;
    workspaceSandbox: boolean;
    toolFilter?: (tool: Tool) => boolean;
}

const DEFAULT_CONFIG: AgenticChatConfig = {
    maxIterations: 25,
    maxWritesPerTurn: 15,
    maxFileSizeBytes: 1_048_576, // 1 MB
    workspaceSandbox: true,
};

export interface AgenticTurnEvent {
    type: "text" | "tool_call" | "tool_result" | "error" | "done";
    text?: string;
    toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
    toolResult?: { id: string; name: string; ok: boolean; output: string };
    error?: string;
    iteration?: number;
}

export type AgenticEventCallback = (event: AgenticTurnEvent) => void;

interface ConversationEntry {
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    tool_call_id?: string;
    tool_calls?: LlmToolCall[];
    thoughtSignature?: string;
}

export interface AgenticResult {
    finalContent: string;
    toolCallsExecuted: number;
    iterations: number;
    events: AgenticTurnEvent[];
}

type LlmGenerateFn = (input: {
    message: string;
    conversation: ConversationEntry[];
    systemPrompt: string;
    tools?: LlmToolDefinition[];
    tool_choice?: "auto" | "none" | "required";
}, selection?: { providerId?: string; model?: string }) => Promise<{
    content: string;
    toolCalls?: LlmToolCall[];
    stopReason?: string;
} | null>;

// ── Executor ─────────────────────────────────────────────────────────────────

export class AgenticChatExecutor {
    private readonly registry: ToolRegistry;
    private readonly config: AgenticChatConfig;
    private readonly toolDefinitions: LlmToolDefinition[];

    constructor(registry: ToolRegistry, config?: Partial<AgenticChatConfig>) {
        this.registry = registry;
        this.config = { ...DEFAULT_CONFIG, ...config };

        let tools = registry.list();
        if (this.config.toolFilter) {
            tools = tools.filter(this.config.toolFilter);
        }
        this.toolDefinitions = toolsToLlmDefinitions(tools);
    }

    getToolDefinitions(): LlmToolDefinition[] {
        return this.toolDefinitions;
    }

    async execute(
        userMessage: string,
        conversationHistory: ConversationEntry[],
        systemPrompt: string,
        generateFn: LlmGenerateFn,
        selection?: { providerId?: string; model?: string },
        onEvent?: AgenticEventCallback,
        options?: { modelTier?: number; allowedTools?: string[] },
    ): Promise<AgenticResult> {
        const events: AgenticTurnEvent[] = [];
        const emit = (event: AgenticTurnEvent) => {
            events.push(event);
            onEvent?.(event);
        };

        const conversation: ConversationEntry[] = [...conversationHistory];
        let totalToolCalls = 0;
        let writeCount = 0;
        let finalContent = "";

        const modelTier = options?.modelTier ?? 3;
        let activeTools = this.toolDefinitions;
        if (options?.allowedTools) {
            activeTools = this.toolDefinitions.filter(t => options.allowedTools?.includes(t.name));
        } else if (modelTier <= 2) {
            // T1/T2 models only get minimal core tools by default
            const coreTools = ["shell_exec", "file_read", "file_write", "prism_dashboard_control", "ask_reasoning_model"];
            activeTools = this.toolDefinitions.filter(t => coreTools.includes(t.name));
        }

        for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
            let result;
            try {
                result = await generateFn(
                    {
                        message: iteration === 0 ? userMessage : "",
                        conversation,
                        systemPrompt,
                        tools: activeTools.length > 0 ? activeTools : undefined,
                        tool_choice: activeTools.length > 0 ? "auto" : undefined,
                    },
                    selection,
                );
            } catch (llmError) {
                emit({ type: "error", error: `LLM provider error: ${String(llmError)}`, iteration });
                emit({ type: "done", iteration });
                return { finalContent: finalContent || `LLM provider error: ${String(llmError)}`, toolCallsExecuted: totalToolCalls, iterations: iteration + 1, events };
            }

            if (!result) {
                emit({ type: "error", error: "LLM returned no response.", iteration });
                break;
            }

            // Accumulate text content
            if (result.content) {
                finalContent += (finalContent ? "\n" : "") + result.content;
                emit({ type: "text", text: result.content, iteration });
            }

            // If no tool calls, done
            if (!result.toolCalls?.length || result.stopReason !== "tool_use") {
                emit({ type: "done", iteration });
                return { finalContent, toolCallsExecuted: totalToolCalls, iterations: iteration + 1, events };
            }

            // Add assistant message with tool calls to conversation
            conversation.push({
                role: "assistant",
                content: result.content || "",
                tool_calls: result.toolCalls,
                thoughtSignature: (result as any).thoughtSignature,
            });

            // Execute each tool call
            for (const toolCall of result.toolCalls) {
                totalToolCalls++;
                emit({ type: "tool_call", toolCall: { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments }, iteration });

                const toolResult = await this.executeTool(
                    toolCall,
                    writeCount,
                );

                if (toolResult.isWrite) writeCount++;

                let outputStr = typeof toolResult.output === "string"
                    ? toolResult.output
                    : JSON.stringify(toolResult.output, null, 2);

                if (!toolResult.ok && modelTier <= 2 && outputStr.length > 500) {
                    outputStr = outputStr.substring(0, 500) + "\n...[truncated]. Look at the first error line and try a different command or ask the reasoning model for help.";
                }

                emit({
                    type: "tool_result",
                    toolResult: { id: toolCall.id, name: toolCall.name, ok: toolResult.ok, output: outputStr },
                    iteration,
                });

                // Add tool result to conversation
                conversation.push({
                    role: "tool",
                    content: outputStr,
                    tool_call_id: toolCall.id,
                });
            }
        }

        // Max iterations hit
        emit({ type: "error", error: `Reached maximum iteration limit (${this.config.maxIterations}).` });
        emit({ type: "done" });
        return { finalContent: finalContent || "I reached the maximum number of tool-calling iterations.", toolCallsExecuted: totalToolCalls, iterations: this.config.maxIterations, events };
    }

    private async executeTool(
        toolCall: LlmToolCall,
        currentWriteCount: number,
    ): Promise<{ ok: boolean; output: Record<string, unknown>; isWrite: boolean }> {
        const toolName = toolCall.name;
        let tool: Tool;
        try {
            tool = this.registry.get(toolName);
        } catch {
            return { ok: false, output: { error: `Unknown tool: ${toolName}` }, isWrite: false };
        }

        const isWrite = isWriteOperation(toolName, toolCall.arguments);

        // Enforce write budget
        if (isWrite && currentWriteCount >= this.config.maxWritesPerTurn) {
            return {
                ok: false,
                output: { error: `Write limit reached (${this.config.maxWritesPerTurn} per turn). Skipping ${toolName}.` },
                isWrite: false,
            };
        }

        // Enforce workspace sandbox for file operations
        if (this.config.workspaceSandbox && isFileOperation(toolName)) {
            const pathArg = toolCall.arguments.path as string | undefined;
            if (pathArg && !isWithinWorkspace(pathArg)) {
                return {
                    ok: false,
                    output: { error: `Path is outside workspace sandbox: ${pathArg}` },
                    isWrite: false,
                };
            }
        }

        // Enforce file size limit for writes
        if (toolName === "file_write" && typeof toolCall.arguments.content === "string") {
            if (toolCall.arguments.content.length > this.config.maxFileSizeBytes) {
                return {
                    ok: false,
                    output: { error: `Content exceeds maximum file size (${this.config.maxFileSizeBytes} bytes).` },
                    isWrite: true,
                };
            }
        }

        const request: ToolRequest = {
            operation: toolName,
            args: toolCall.arguments,
            risk: isWrite ? "medium" : "low",
            mutatesState: isWrite,
        };

        try {
            const result = await tool.execute(request);
            return { ok: result.ok, output: result.output, isWrite };
        } catch (err: unknown) {
            return { ok: false, output: { error: String(err) }, isWrite };
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const WRITE_TOOLS = new Set(["file_write", "file_delete", "shell_exec", "terminal_session", "container_sandbox", "computer"]);

const FILE_TOOLS = new Set(["file_read", "file_write", "file_delete", "file_list"]);

function isWriteOperation(toolName: string, args: Record<string, unknown>): boolean {
    if (WRITE_TOOLS.has(toolName)) return true;
    // MCP tools are conservatively treated as writes
    if (toolName.startsWith("mcp_")) return true;
    return false;
}

function isFileOperation(toolName: string): boolean {
    return FILE_TOOLS.has(toolName);
}

function isWithinWorkspace(filePath: string): boolean {
    try {
        const wsRoot = resolveWorkspaceRoot();
        // Resolve relative paths against workspace root, not process.cwd()
        const basePath = isAbsolute(filePath) ? filePath : resolve(wsRoot, filePath);
        const normalized = normalize(basePath);
        const normalizedRoot = normalize(wsRoot);
        // Allow any path under the workspace root tree
        if (normalized.startsWith(normalizedRoot + sep) || normalized === normalizedRoot) {
            return true;
        }
        // Also allow reading from the source project directory (D:\Projects\Prism)
        const srcRoot = normalize(process.cwd());
        if (normalized.startsWith(srcRoot + sep) || normalized === srcRoot) {
            return true;
        }
        return false;
    } catch {
        return false;
    }
}
