import { randomUUID } from "node:crypto";
import { resolve, normalize, sep, isAbsolute } from "node:path";
import type { ToolRegistry } from "../tools/registry.js";
import type { Tool, ToolRequest, ToolResult } from "../tools/types.js";
import type {
    LlmToolDefinition,
    LlmToolCall,
    LlmStreamChunk,
    LlmContentPart,
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

/**
 * Detect whether a user message is a research/information-gathering request.
 * When true, the executor forces tool_choice='required' for the first N
 * iterations so PRISM MUST use tools rather than responding with suggestions.
 */
function isResearchQuery(message: string): boolean {
    const lower = message.toLowerCase();
    const researchVerbs = [
        "find", "search", "look up", "lookup", "locate", "fetch", "get",
        "help me find", "help find", "check", "research", "investigate",
        "show me", "list", "browse", "scan", "query", "retrieve",
    ];
    const researchObjects = [
        "car", "vehicle", "listing", "price", "deal", "sale", "product",
        "job", "property", "house", "apartment", "flight", "hotel",
        "restaurant", "business", "company", "person", "contact",
        "news", "article", "data", "information", "details", "specs",
        "stock", "weather", "event", "ticket",
    ];
    const hasVerb = researchVerbs.some(v => lower.includes(v));
    const hasObject = researchObjects.some(o => lower.includes(o));
    // Also detect explicit "I need" + something
    const hasNeed = /\b(i need|we need|please|can you|could you|help)\b/.test(lower);
    return hasVerb || (hasNeed && hasObject);
}

/** How many iterations to force tool_choice='required' for research queries. */
const RESEARCH_FORCED_TOOL_ITERATIONS = 3;

/**
 * Detect whether the LLM's response is giving up with suggestions/advice
 * instead of actually completing the research task.
 * Returns true when the model is telling the user to do the work themselves.
 */
function isGaveUpResponse(text: string): boolean {
    const lower = text.toLowerCase();
    const gaveUpPatterns = [
        /here are some (steps|suggestions|tips|recommendations|alternatives)/,
        /you (can|could|should|might|may) (try|check|visit|contact|search|look|browse|use)/,
        /i (couldn't|could not|was unable|wasn't able) (to )?(find|locate|retrieve)/,
        /unfortunately.{0,40}(couldn't|could not|no results|no listings|not find)/,
        /\b(reach out to|contact|visit)\b.{0,30}\b(dealership|dealer|local|directly)\b/,
        /continue checking/,
        /consider (looking|checking|trying|using)/,
        /if you (need|want|would like) (further|more|additional)/,
        /local (dealerships|dealers|businesses)/,
        /social media.{0,20}(groups|boards|pages)/,
        /community boards/,
        /car auctions/,
        /set (up )?alerts/,
    ];
    const matchCount = gaveUpPatterns.filter(p => p.test(lower)).length;
    // Require at least 2 pattern matches to avoid false positives
    return matchCount >= 2;
}

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
    content: string | LlmContentPart[];
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

        // Detect research/information-gathering queries — force tool use on first N passes
        const isResearch = isResearchQuery(userMessage);
        let researchReinjections = 0;
        const MAX_RESEARCH_REINJECTIONS = 3;

        for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
            let result;
            try {
                // For research tasks, force tool use for the first N iterations
                // so the model must try multiple sources before it can give up
                const toolChoice: "auto" | "none" | "required" =
                    (activeTools.length > 0 && isResearch && iteration < RESEARCH_FORCED_TOOL_ITERATIONS)
                        ? "required"
                        : (activeTools.length > 0 ? "auto" : "none");

                result = await generateFn(
                    {
                        message: iteration === 0 ? userMessage : "",
                        conversation,
                        systemPrompt,
                        tools: activeTools.length > 0 ? activeTools : undefined,
                        tool_choice: toolChoice,
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
                emit({ type: "done", iteration });
                return { finalContent: finalContent || "LLM returned no response.", toolCallsExecuted: totalToolCalls, iterations: iteration + 1, events };
            }

            // Accumulate text content
            if (result.content) {
                finalContent += (finalContent ? "\n" : "") + result.content;
                emit({ type: "text", text: result.content, iteration });
            }

            // If no tool calls — check if the model gave up on a research task
            if (!result.toolCalls?.length || result.stopReason !== "tool_use") {
                // For research tasks: detect "gave up" responses and re-inject
                // a continuation message forcing the model to keep trying
                if (isResearch && result.content && isGaveUpResponse(result.content) && researchReinjections < MAX_RESEARCH_REINJECTIONS) {
                    researchReinjections++;
                    // Add the assistant's "gave up" message to conversation
                    conversation.push({
                        role: "assistant",
                        content: result.content,
                    });
                    // Inject a user-role message telling the model to keep going
                    conversation.push({
                        role: "user",
                        content: "Do NOT suggest steps for me to do. YOU must execute those steps yourself using your tools. "
                            + "Try the specific sites and strategies you just mentioned — use http_request to fetch from Autotrader, Cars.com, Craigslist, or similar sites. "
                            + "If http_request gets blocked or returns no useful data, use browser_control to launch a visible browser session and navigate to those sites. "
                            + "Try broadening the search: increase the price range, expand the radius, or adjust mileage limits. "
                            + "Keep searching until you find real results with actual prices, mileage, and URLs. Do NOT give up.",
                    });
                    emit({ type: "text", text: `[PRISM Research Agent] Initial search yielded no results — retrying with broader strategy (attempt ${researchReinjections}/${MAX_RESEARCH_REINJECTIONS})...`, iteration });
                    // Continue the loop — don't exit
                    continue;
                }

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

                // Assemble multimodal content parts if the output contains base64 image data
                let contentVal: string | LlmContentPart[] = outputStr;
                if (toolResult.ok && toolResult.output && typeof toolResult.output === "object" && typeof (toolResult.output as any).base64 === "string") {
                    const format = (toolResult.output as any).format || "png";
                    const toolContentParts: LlmContentPart[] = [
                        { type: "text", text: "" },
                        {
                            type: "image_url",
                            image_url: { url: `data:image/${format};base64,${(toolResult.output as any).base64}` }
                        }
                    ];

                    const shallowCopy = { ...toolResult.output } as any;
                    delete shallowCopy.base64;
                    let cleanOutput = JSON.stringify(shallowCopy, null, 2);
                    if (cleanOutput.length > 3000) cleanOutput = cleanOutput.slice(0, 3000) + "\n...[truncated]";
                    toolContentParts[0] = { type: "text", text: cleanOutput };
                    contentVal = toolContentParts;
                }

                // Add tool result to conversation
                conversation.push({
                    role: "tool",
                    content: contentVal,
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
