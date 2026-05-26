/**
 * PRISM Autonomous Planner — Priority 1 (Roadmap to Autonomy)
 *
 * ReAct (Reason + Act) planning engine that connects the configured LLM
 * to the AutonomousAgentLoop. This is the "brain" that decides what tool
 * to call next for a given autonomous goal.
 *
 * Flow:
 *   1. Receives an objective (goal) and available tools
 *   2. Builds a system prompt with tool definitions + constraints
 *   3. Sends to LLM → receives reasoning + tool call
 *   4. Executes tool via AutonomousAgentLoop.executeStep()
 *   5. Feeds result back to LLM → loops until done or budget exhausted
 *
 * Uses the configured Provider & Settings LLM for reasoning.
 * All actions pipe to Logs & Debug via the activity bus.
 * Guardian checkpoint events emitted every N actions.
 *
 * Design constraints:
 *   - Pluggable LLM interface (LlmGenerateFn) — no direct provider coupling
 *   - Conversation buffer capped to prevent context overflow
 *   - Graceful degradation: if LLM returns no tool call, goal completes
 *   - All state piped to activity bus for unified telemetry
 */

import type { ActivityBus } from "../activity/bus.js";
import type { AutonomousAgentLoop, AutonomousGoal } from "./autonomous-agent-loop.js";
import type { AutonomousBrowserAgent, BrowserAgentPerception } from "./autonomous-browser-agent.js";
import type { AutonomousComputerAgent } from "./autonomous-computer-agent.js";
import type { LlmContentPart } from "../operator/llm-provider-manager.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal LLM generation function — mirrors the AgenticChatExecutor pattern. */
export type AutonomousLlmGenerateFn = (input: {
    message: string;
    conversation: ConversationEntry[];
    systemPrompt: string;
    tools?: LlmToolDef[];
    tool_choice?: "auto" | "none" | "required";
}) => Promise<{
    content: string;
    toolCalls?: LlmToolCallResult[];
    stopReason?: string;
} | null>;

export interface ConversationEntry {
    role: "user" | "assistant" | "system" | "tool";
    content: string | LlmContentPart[];
    tool_call_id?: string;
    tool_calls?: LlmToolCallResult[];
}

export interface LlmToolDef {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
}

export interface LlmToolCallResult {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface PlannerConfig {
    /** Max iterations of the ReAct loop per goal. */
    maxIterations: number;
    /** Max conversation entries to keep (prevents context overflow). */
    maxConversationBuffer: number;
    /** System prompt preamble for the planner. */
    systemPromptOverride?: string;
}

export interface PlannerResult {
    goalId: string;
    status: "completed" | "failed" | "terminated" | "budget_exhausted";
    summary: string;
    iterations: number;
    toolCallsExecuted: number;
    totalDurationMs: number;
}

const DEFAULT_CONFIG: PlannerConfig = {
    maxIterations: 50,
    maxConversationBuffer: 40,
};

// ── System Prompt ────────────────────────────────────────────────────────────

const PLANNER_SYSTEM_PROMPT = `You are PRISM Autonomous Planner — an expert AI agent that executes complex objectives by reasoning step-by-step and using tools.

## Behavior
1. You receive an objective from the operator.
2. Break it down into concrete steps.
3. Use available tools to execute each step.
4. After each tool result, evaluate progress and decide the next action.
5. When the objective is fully achieved, respond with a summary WITHOUT any tool calls.

## Rules
- Always explain your reasoning before calling a tool.
- Use the most specific tool available for each task.
- If a tool call fails, analyze the error and try a different approach.
- Never repeat the same failed tool call with identical arguments.
- If you cannot make progress after 3 failed attempts, summarize what you achieved and stop.
- When the objective is complete, provide a clear summary of what was accomplished.
- Be concise in reasoning — focus on what to do next, not lengthy analysis.

## Safety
- Do not execute destructive commands (rm -rf, format, etc.) unless explicitly instructed.
- Prefer read-only operations for information gathering.
- If an action seems risky, explain why and choose a safer alternative.`;

// ── Planner ──────────────────────────────────────────────────────────────────

export class AutonomousPlanner {
    private readonly config: PlannerConfig;
    private readonly activityBus: ActivityBus;
    private abortRequested = false;

    constructor(
        activityBus: ActivityBus,
        config?: Partial<PlannerConfig>,
    ) {
        this.activityBus = activityBus;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Execute a goal end-to-end using the ReAct loop.
     *
     * This is the core autonomous execution method. It:
     *   1. Starts the goal in the loop
     *   2. Sends objective to LLM with tool definitions
     *   3. Executes returned tool calls via the loop
     *   4. Feeds results back to LLM
     *   5. Repeats until LLM returns no tool calls (done) or budget exhausted
     */
    async executeGoal(
        goal: AutonomousGoal,
        loop: AutonomousAgentLoop,
        generateFn: AutonomousLlmGenerateFn,
        toolDefinitions: LlmToolDef[],
        options?: {
            browserAgent?: AutonomousBrowserAgent;
            computerAgent?: AutonomousComputerAgent;
            onStep?: (step: { iteration: number; tool: string; success: boolean; summary: string }) => void;
        },
    ): Promise<PlannerResult> {
        this.abortRequested = false;
        const startTime = Date.now();
        let totalToolCalls = 0;
        let iteration = 0;

        const systemPrompt = this.buildSystemPrompt(goal, options);
        const conversation: ConversationEntry[] = [];

        this.emit("planner.goal.started", "succeeded", {
            goalId: goal.goalId,
            objective: goal.objective,
            toolCount: toolDefinitions.length,
        });

        try {
            for (iteration = 0; iteration < this.config.maxIterations; iteration++) {
                // Check abort
                if (this.abortRequested) {
                    loop.terminateGoal(goal.goalId, "Operator requested abort");
                    return this.buildResult(goal.goalId, "terminated", "Aborted by operator", iteration, totalToolCalls, startTime);
                }

                // Check if goal was paused/terminated externally
                const currentGoal = loop.getGoal(goal.goalId);
                if (!currentGoal || currentGoal.status === "terminated" || currentGoal.status === "completed") {
                    return this.buildResult(goal.goalId, currentGoal?.status === "completed" ? "completed" : "terminated",
                        currentGoal?.error || "Goal ended externally", iteration, totalToolCalls, startTime);
                }
                if (currentGoal.status === "paused" || currentGoal.status === "suspended" || currentGoal.status === "handing_off") {
                    // Wait for resume — poll every 2s, max 5min
                    const resumed = await this.waitForResume(loop, goal.goalId, 5 * 60 * 1000);
                    if (!resumed) {
                        return this.buildResult(goal.goalId, "terminated", "Goal execution was not resumed within 5 minutes", iteration, totalToolCalls, startTime);
                    }
                }

                // Build the user message for first iteration
                if (iteration === 0) {
                    conversation.push({
                        role: "user",
                        content: `Execute this objective:\n\n${goal.objective}`,
                    });
                }

                // Call LLM
                this.emit("planner.llm.calling", "succeeded", {
                    goalId: goal.goalId, iteration,
                    conversationLength: conversation.length,
                });

                let llmResult;
                try {
                    llmResult = await generateFn({
                        message: "",
                        conversation,
                        systemPrompt,
                        tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
                        tool_choice: toolDefinitions.length > 0 ? "auto" : undefined,
                    });
                } catch (llmError) {
                    this.emit("planner.llm.error", "failed", {
                        goalId: goal.goalId, iteration, error: String(llmError),
                    });
                    // Retry once with exponential backoff
                    await this.sleep(2000);
                    try {
                        llmResult = await generateFn({
                            message: "",
                            conversation,
                            systemPrompt,
                            tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
                            tool_choice: toolDefinitions.length > 0 ? "auto" : undefined,
                        });
                    } catch (retryError) {
                        loop.terminateGoal(goal.goalId, `LLM error after retry: ${String(retryError)}`);
                        return this.buildResult(goal.goalId, "failed", `LLM error: ${String(retryError)}`, iteration, totalToolCalls, startTime);
                    }
                }

                if (!llmResult) {
                    loop.terminateGoal(goal.goalId, "LLM returned null response");
                    return this.buildResult(goal.goalId, "failed", "LLM returned no response", iteration, totalToolCalls, startTime);
                }

                // Process text content (reasoning)
                if (llmResult.content) {
                    this.emit("planner.reasoning", "succeeded", {
                        goalId: goal.goalId, iteration,
                        reasoning: llmResult.content.slice(0, 500),
                    });
                }

                // If no tool calls → goal is complete
                if (!llmResult.toolCalls?.length || llmResult.stopReason !== "tool_use") {
                    loop.completeGoal(goal.goalId, llmResult.content || "Objective completed");
                    return this.buildResult(goal.goalId, "completed", llmResult.content || "Objective completed", iteration + 1, totalToolCalls, startTime);
                }

                // Add assistant message with tool calls to conversation
                conversation.push({
                    role: "assistant",
                    content: llmResult.content || "",
                    tool_calls: llmResult.toolCalls,
                });

                // Execute each tool call
                for (const toolCall of llmResult.toolCalls) {
                    totalToolCalls++;
                    let stepSuccess = false;
                    let toolContentParts: LlmContentPart[] = [];

                    try {
                        const step = await loop.executeStep(
                            goal.goalId,
                            toolCall.name,
                            toolCall.arguments,
                            iteration,
                        );

                        stepSuccess = step.status === "succeeded";
                        let toolOutputRaw = typeof step.output === "string"
                            ? step.output
                            : JSON.stringify(step.output ?? { ok: stepSuccess }, null, 2);

                        // Truncate large outputs for context efficiency
                        if (toolOutputRaw.length > 3000) {
                            toolOutputRaw = toolOutputRaw.slice(0, 3000) + "\n...[truncated]";
                        }

                        toolContentParts.push({ type: "text", text: toolOutputRaw });

                        if (step.output && typeof step.output === "object" && typeof (step.output as any).base64 === "string") {
                            const format = (step.output as any).format || "png";
                            toolContentParts.push({
                                type: "image_url",
                                image_url: { url: `data:image/${format};base64,${(step.output as any).base64}` }
                            });

                            // Remove base64 from the text part so we don't send megabytes of text
                            if (typeof step.output !== "string") {
                                const shallowCopy = { ...step.output } as any;
                                delete shallowCopy.base64;
                                let cleanOutput = JSON.stringify(shallowCopy, null, 2);
                                if (cleanOutput.length > 3000) cleanOutput = cleanOutput.slice(0, 3000) + "\n...[truncated]";
                                toolContentParts[0] = { type: "text", text: cleanOutput };
                            }
                        }

                    } catch (execError) {
                        toolContentParts.push({ type: "text", text: `Error: ${String(execError)}` });
                        stepSuccess = false;
                    }

                    // Add tool result to conversation
                    conversation.push({
                        role: "tool",
                        content: toolContentParts.length === 1 && toolContentParts[0].type === "text"
                            ? toolContentParts[0].text!
                            : toolContentParts,
                        tool_call_id: toolCall.id,
                    });

                    // Emit step event for UI
                    options?.onStep?.({
                        iteration,
                        tool: toolCall.name,
                        success: stepSuccess,
                        summary: toolContentParts[0].text!.slice(0, 200),
                    });

                    this.emit("planner.step.executed", stepSuccess ? "succeeded" : "failed", {
                        goalId: goal.goalId, iteration,
                        tool: toolCall.name, success: stepSuccess,
                        outputLength: (toolContentParts[0].text ?? "").length,
                    });
                }

                // Trim conversation buffer
                this.trimConversation(conversation);
            }

            // Max iterations exhausted
            loop.completeGoal(goal.goalId, `Reached max iterations (${this.config.maxIterations})`);
            return this.buildResult(goal.goalId, "budget_exhausted",
                `Reached maximum iterations (${this.config.maxIterations})`,
                iteration, totalToolCalls, startTime);

        } catch (fatalError) {
            loop.terminateGoal(goal.goalId, String(fatalError));
            return this.buildResult(goal.goalId, "failed", String(fatalError), iteration, totalToolCalls, startTime);
        }
    }

    /** Request abort of the current execution. */
    requestAbort(): void {
        this.abortRequested = true;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private buildSystemPrompt(
        goal: AutonomousGoal,
        options?: { browserAgent?: AutonomousBrowserAgent; computerAgent?: AutonomousComputerAgent },
    ): string {
        let prompt = this.config.systemPromptOverride || PLANNER_SYSTEM_PROMPT;

        // Add constraint context
        prompt += `\n\n## Current Goal Constraints`;
        prompt += `\n- Max actions: ${goal.constraints.maxActions}`;
        prompt += `\n- Max duration: ${Math.round(goal.constraints.maxDurationMs / 1000)}s`;
        prompt += `\n- Browser use: ${goal.constraints.allowBrowserUse ? "allowed" : "DISABLED"}`;
        prompt += `\n- Computer use: ${goal.constraints.allowComputerUse ? "allowed" : "DISABLED"}`;
        prompt += `\n- Shell exec: ${goal.constraints.allowShellExec ? "allowed" : "DISABLED"}`;

        // Browser agent context
        if (options?.browserAgent?.getSessionId()) {
            prompt += `\n\n## Active Browser Session`;
            prompt += `\nBrowser session ID: ${options.browserAgent.getSessionId()}`;
            const state = options.browserAgent.getGoalState();
            if (state) {
                prompt += `\nCurrent URL: ${state.currentUrl}`;
                prompt += `\nActions so far: ${state.actions.length}`;
            }
        }

        // Computer agent context
        if (options?.computerAgent?.getGoalState()) {
            const cState = options.computerAgent.getGoalState()!;
            prompt += `\n\n## Active Computer Session`;
            prompt += `\nWorking directory: ${cState.workingDirectory}`;
            prompt += `\nCommands executed: ${cState.actions.length}`;
        }

        return prompt;
    }

    private trimConversation(conversation: ConversationEntry[]): void {
        // Keep at most maxConversationBuffer entries
        // Always keep the first user message (the objective)
        while (conversation.length > this.config.maxConversationBuffer) {
            // Remove the oldest non-first entry
            if (conversation.length > 1) {
                conversation.splice(1, 1);
            } else {
                break;
            }
        }
    }

    private async waitForResume(loop: AutonomousAgentLoop, goalId: string, maxWaitMs: number): Promise<boolean> {
        const startWait = Date.now();
        while (Date.now() - startWait < maxWaitMs) {
            await this.sleep(2000);
            const goal = loop.getGoal(goalId);
            if (!goal) return false;
            if (goal.status === "executing" || goal.status === "planning") return true;
            if (goal.status === "terminated" || goal.status === "completed" || goal.status === "failed") return false;
        }
        return false;
    }

    private buildResult(
        goalId: string,
        status: PlannerResult["status"],
        summary: string,
        iterations: number,
        toolCallsExecuted: number,
        startTime: number,
    ): PlannerResult {
        const result: PlannerResult = {
            goalId, status, summary, iterations, toolCallsExecuted,
            totalDurationMs: Date.now() - startTime,
        };
        this.emit(`planner.goal.${status}`, status === "completed" ? "succeeded" : "failed", {
            ...result,
        });
        return result;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private emit(operation: string, status: "succeeded" | "failed", details: Record<string, unknown>): void {
        this.activityBus.emit({
            sessionId: "autonomous-planner",
            layer: "agent", operation, status,
            details: { ...details, source: "autonomous-planner" },
        });
    }
}
