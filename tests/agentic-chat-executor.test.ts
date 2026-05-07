/**
 * Tests for AgenticChatExecutor — tool dispatch, max-iteration guard,
 * workspace sandbox enforcement, and LLM error propagation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgenticChatExecutor } from "../src/core/operator/agentic-chat-executor.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import type { Tool, ToolRequest, ToolResult } from "../src/core/tools/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a ToolRegistry with a single echo tool. */
function echoRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    const echoTool: Tool = {
        name: "echo",
        contract: {
            version: "1.0.0",
            args: {
                message: { type: "string", required: true },
            },
        },
        execute: async (req: ToolRequest): Promise<ToolResult> => ({
            ok: true,
            output: { echoed: (req.args as { message: string }).message },
        }),
    };
    registry.register(echoTool);
    return registry;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AgenticChatExecutor", () => {
    it("returns direct text response without tool calls", async () => {
        const executor = new AgenticChatExecutor(echoRegistry());
        const result = await executor.execute(
            "Say hello",
            [],
            "You are helpful.",
            async (_) => ({ content: "Hello from the model.", toolCalls: undefined, stopReason: "end_turn" as const }),
        );
        assert.equal(result.finalContent, "Hello from the model.");
        assert.equal(result.toolCallsExecuted, 0);
        assert.equal(result.iterations, 1);
    });

    it("executes a single tool call and returns final content", async () => {
        const executor = new AgenticChatExecutor(echoRegistry());
        let calls = 0;
        const result = await executor.execute(
            "Echo ping",
            [],
            "You are helpful.",
            async (_) => {
                calls++;
                if (calls === 1) {
                    return {
                        content: "",
                        toolCalls: [{ id: "tc-1", name: "echo", arguments: { message: "ping" } }],
                        stopReason: "tool_use" as const,
                    };
                }
                return { content: "Tool result received.", toolCalls: undefined, stopReason: "end_turn" as const };
            },
        );
        assert.equal(result.toolCallsExecuted, 1);
        assert.equal(result.finalContent, "Tool result received.");
    });

    it("emits text, tool_call, and done events to onEvent callback", async () => {
        const executor = new AgenticChatExecutor(echoRegistry());
        const eventTypes: string[] = [];
        let genCalls = 0;

        await executor.execute(
            "Emit events",
            [],
            "sys",
            async (_) => {
                genCalls++;
                if (genCalls === 1) {
                    return {
                        content: "",
                        toolCalls: [{ id: "tc-evt", name: "echo", arguments: { message: "hi" } }],
                        stopReason: "tool_use" as const,
                    };
                }
                return { content: "Done.", toolCalls: undefined, stopReason: "end_turn" as const };
            },
            undefined,
            (evt) => eventTypes.push(evt.type),
        );

        assert.ok(eventTypes.includes("tool_call"), "tool_call event emitted");
        assert.ok(eventTypes.includes("tool_result"), "tool_result event emitted");
        assert.ok(eventTypes.includes("done"), "done event emitted");
    });

    it("propagates null response as an error event", async () => {
        const executor = new AgenticChatExecutor(echoRegistry());
        const result = await executor.execute("hi", [], "sys", async (_) => null);
        const errorEvent = result.events.find((e) => e.type === "error");
        assert.ok(errorEvent, "error event emitted when generate returns null");
    });

    it("propagates LLM throw as an error event without crashing", async () => {
        const executor = new AgenticChatExecutor(echoRegistry());
        const result = await executor.execute(
            "hi",
            [],
            "sys",
            async (_): Promise<never> => { throw new Error("Simulated provider failure"); },
        );
        const errorEvent = result.events.find((e) => e.type === "error");
        assert.ok(errorEvent, "error event emitted on provider throw");
        assert.ok(errorEvent?.error?.includes("Simulated provider failure"), "error message propagated");
    });

    it("stops at maxIterations and emits an error event", async () => {
        const executor = new AgenticChatExecutor(echoRegistry(), { maxIterations: 3 });
        const result = await executor.execute(
            "loop",
            [],
            "sys",
            async (_) => ({
                content: "",
                toolCalls: [{ id: "tc-inf", name: "echo", arguments: { message: "loop" } }],
                stopReason: "tool_use" as const,
            }),
        );
        assert.equal(result.iterations, 3);
        const errorEvent = result.events.find((e) => e.type === "error");
        assert.ok(errorEvent?.error?.includes("maximum"), "max-iterations error emitted");
    });

    it("rejects tool call to unknown tool and emits tool_result with ok:false", async () => {
        const executor = new AgenticChatExecutor(echoRegistry());
        let callCount = 0;
        const result = await executor.execute(
            "call unknown",
            [],
            "sys",
            async (_) => {
                callCount++;
                if (callCount === 1) {
                    return {
                        content: "",
                        toolCalls: [{ id: "tc-unk", name: "nonexistent_tool", arguments: {} }],
                        stopReason: "tool_use" as const,
                    };
                }
                return { content: "Done.", toolCalls: undefined, stopReason: "end_turn" as const };
            },
        );
        const toolResult = result.events.find((e) => e.type === "tool_result");
        assert.ok(toolResult, "tool_result event emitted");
        assert.equal(toolResult?.toolResult?.ok, false, "unknown tool returns ok:false");
        assert.ok(toolResult?.toolResult?.output?.includes("Unknown tool"), "error message present");
    });

    it("enforces workspace sandbox — rejects absolute path outside workspace", async () => {
        const registry = new ToolRegistry();
        const fileWriteTool: Tool = {
            name: "file_write",
            contract: {
                version: "1.0.0",
                args: {
                    path: { type: "string", required: true },
                    content: { type: "string", required: true },
                },
            },
            execute: async () => ({ ok: true, output: { written: true } }),
        };
        registry.register(fileWriteTool);

        const executor = new AgenticChatExecutor(registry, { workspaceSandbox: true });
        let callCount = 0;
        const result = await executor.execute(
            "write outside workspace",
            [],
            "sys",
            async (_) => {
                callCount++;
                if (callCount === 1) {
                    return {
                        content: "",
                        toolCalls: [{
                            id: "tc-sandbox",
                            name: "file_write",
                            arguments: { path: "/etc/passwd", content: "hacked" },
                        }],
                        stopReason: "tool_use" as const,
                    };
                }
                return { content: "Done.", toolCalls: undefined, stopReason: "end_turn" as const };
            },
        );

        const toolResult = result.events.find((e) => e.type === "tool_result");
        assert.ok(toolResult, "tool_result event present");
        assert.equal(toolResult?.toolResult?.ok, false, "sandbox violation rejected");
        assert.ok(
            toolResult?.toolResult?.output?.includes("outside workspace"),
            "sandbox error message present",
        );
    });

    it("getToolDefinitions returns registered tool schemas", () => {
        const executor = new AgenticChatExecutor(echoRegistry());
        const defs = executor.getToolDefinitions();
        assert.ok(defs.length >= 1, "at least one tool definition");
        const echoDef = defs.find((d) => d.name === "echo");
        assert.ok(echoDef, "echo tool definition present");
    });
});
