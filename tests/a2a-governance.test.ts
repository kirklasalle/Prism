import * as assert from "assert";
import { describe, it, before, after } from "mocha";
import sqlite3 from "sqlite3";
import { A2ATaskAdapter } from "../src/adapters/application/a2a-task-adapter.js";
import { GovernanceHooksAdapter } from "../src/adapters/application/governance-hooks-adapter.js";
import { ActivityBus } from "../src/core/activity/bus.js";

describe("A2ATaskAdapter", function () {
    this.timeout(10000);

    let adapter: A2ATaskAdapter;
    let db: sqlite3.Database;
    let activityBus: ActivityBus;

    before(async () => {
        db = new sqlite3.Database(":memory:");
        activityBus = new ActivityBus();
        adapter = new A2ATaskAdapter(db, activityBus);
    });

    after(async () => {
        await new Promise<void>((resolve, reject) => {
            db.close((err) => (err ? reject(err) : resolve()));
        });
    });

    describe("classifyTaskTier", () => {
        it("classifies analysis/summarization as tier1", () => {
            const tier = adapter.classifyTaskTier({
                role: "user",
                parts: [{ text: "Summarize this document and explain the key points." }],
            });
            assert.strictEqual(tier, "tier1");
        });

        it("classifies search/query requests as tier2", () => {
            const tier = adapter.classifyTaskTier({
                role: "user",
                parts: [{ text: "Search for all files related to the project and list them." }],
            });
            assert.strictEqual(tier, "tier2");
        });

        it("classifies shell/exec requests as tier3", () => {
            const tier = adapter.classifyTaskTier({
                role: "user",
                parts: [{ text: "Execute the cleanup script to remove temporary files." }],
            });
            assert.strictEqual(tier, "tier3");
        });

        it("classifies delete requests as tier3", () => {
            const tier = adapter.classifyTaskTier({
                role: "user",
                parts: [{ text: "Delete the old log files from the archive directory." }],
            });
            assert.strictEqual(tier, "tier3");
        });

        it("classifies multi-part messages using all parts", () => {
            const tier = adapter.classifyTaskTier({
                role: "user",
                parts: [
                    { text: "First, analyze the data." },
                    { text: "Then, execute the transformation script." },
                ],
            });
            assert.strictEqual(tier, "tier3");
        });
    });

    describe("submitTask", () => {
        it("creates a tier1 task in working state", async () => {
            const task = await adapter.submitTask({
                message: { role: "user", parts: [{ text: "Explain quantum computing." }] },
                metadata: { characterId: "aria-individual" },
            });

            assert.ok(task.task_id.length > 10);
            assert.strictEqual(task.character_id, "aria-individual");
            assert.strictEqual(task.status, "working");
            assert.strictEqual(task.policy_tier, "tier1_autonomous");
            assert.strictEqual(task.output_text, null);
            assert.ok(task.created_at);
        });

        it("creates a tier3 task in submitted state (awaiting approval)", async () => {
            const task = await adapter.submitTask({
                message: { role: "user", parts: [{ text: "Delete all old log files." }] },
                metadata: { characterId: "sentinel-business" },
            });

            assert.strictEqual(task.status, "submitted");
            assert.strictEqual(task.policy_tier, "tier3_approval");
        });

        it("uses provided task ID if supplied", async () => {
            const customId = "custom-task-id-12345";
            const task = await adapter.submitTask({
                id: customId,
                message: { role: "user", parts: [{ text: "Hello." }] },
            });
            assert.strictEqual(task.task_id, customId);
        });

        it("defaults character to aria-individual when not specified", async () => {
            const task = await adapter.submitTask({
                message: { role: "user", parts: [{ text: "Help me plan my day." }] },
            });
            assert.strictEqual(task.character_id, "aria-individual");
        });

        it("persists session_id from request", async () => {
            const task = await adapter.submitTask({
                sessionId: "session-abc",
                message: { role: "user", parts: [{ text: "Hello." }] },
            });
            assert.strictEqual(task.session_id, "session-abc");
        });

        it("emits a2a_task_received event to ActivityBus", async () => {
            let emittedEvent: unknown = null;
            activityBus.subscribe({
                onEvent: (e) => {
                    if (e.operation === "a2a_task_received") emittedEvent = e;
                },
            });
            await adapter.submitTask({
                message: { role: "user", parts: [{ text: "Review this code." }] },
            });
            assert.ok(emittedEvent !== null, "Expected a2a_task_received event");
        });
    });

    describe("getTask", () => {
        it("returns task after submit", async () => {
            const submitted = await adapter.submitTask({
                message: { role: "user", parts: [{ text: "Help me write an email." }] },
            });
            const retrieved = await adapter.getTask(submitted.task_id);
            assert.ok(retrieved !== null);
            assert.strictEqual(retrieved.task_id, submitted.task_id);
            assert.strictEqual(retrieved.status, submitted.status);
        });

        it("returns null for unknown task ID", async () => {
            const result = await adapter.getTask("nonexistent-task-id-xyz");
            assert.strictEqual(result, null);
        });
    });

    describe("cancelTask", () => {
        it("cancels a working task", async () => {
            const task = await adapter.submitTask({
                message: { role: "user", parts: [{ text: "Analyze this chart." }] },
            });
            assert.strictEqual(task.status, "working");

            const cancelled = await adapter.cancelTask(task.task_id);
            assert.ok(cancelled !== null);
            assert.strictEqual(cancelled.status, "cancelled");
            assert.ok(cancelled.completed_at);
        });

        it("no-ops cancel on already-cancelled task", async () => {
            const task = await adapter.submitTask({
                message: { role: "user", parts: [{ text: "Draft a summary." }] },
            });
            await adapter.cancelTask(task.task_id);
            const again = await adapter.cancelTask(task.task_id);
            assert.strictEqual(again?.status, "cancelled");
        });

        it("returns null when cancelling unknown task", async () => {
            const result = await adapter.cancelTask("unknown-task-999");
            assert.strictEqual(result, null);
        });
    });

    describe("completeTask / failTask", () => {
        it("marks a task completed with output text", async () => {
            const task = await adapter.submitTask({
                message: { role: "user", parts: [{ text: "Tell me about AI." }] },
            });
            await adapter.completeTask(task.task_id, "AI is a field of computer science...");
            const updated = await adapter.getTask(task.task_id);
            assert.strictEqual(updated?.status, "completed");
            assert.strictEqual(updated?.output_text, "AI is a field of computer science...");
            assert.ok(updated?.completed_at);
        });

        it("marks a task failed with error message", async () => {
            const task = await adapter.submitTask({
                message: { role: "user", parts: [{ text: "Process this data." }] },
            });
            await adapter.failTask(task.task_id, "LLM provider unavailable");
            const updated = await adapter.getTask(task.task_id);
            assert.strictEqual(updated?.status, "failed");
            assert.strictEqual(updated?.output_text, "LLM provider unavailable");
        });
    });
});

describe("GovernanceHooksAdapter", function () {
    this.timeout(5000);

    let adapter: GovernanceHooksAdapter;
    let activityBus: ActivityBus;

    before(() => {
        activityBus = new ActivityBus();
        adapter = new GovernanceHooksAdapter(activityBus);
    });

    describe("classifyToolTier", () => {
        it("classifies shell as tier3", () => {
            assert.strictEqual(adapter.classifyToolTier("shell", {}), "tier3");
        });

        it("classifies file_read as tier2", () => {
            assert.strictEqual(adapter.classifyToolTier("file_read", {}), "tier2");
        });

        it("classifies unknown tool as tier1", () => {
            assert.strictEqual(adapter.classifyToolTier("ask_question", {}), "tier1");
        });

        it("escalates to tier3 based on destructive tool_input content", () => {
            const tier = adapter.classifyToolTier("run_command", { cmd: "rm -rf /tmp/data" });
            assert.strictEqual(tier, "tier3");
        });

        it("classifies exec as tier3", () => {
            assert.strictEqual(adapter.classifyToolTier("exec", {}), "tier3");
        });

        it("classifies http_request as tier2", () => {
            assert.strictEqual(adapter.classifyToolTier("http_request", {}), "tier2");
        });
    });

    describe("handlePreToolUse", () => {
        it("returns allow for low-risk tools", async () => {
            const result = await adapter.handlePreToolUse({
                tool_name: "ask_question",
                tool_input: { prompt: "What is the weather?" },
                agent_name: "developer",
            });
            assert.strictEqual(result.permission_decision, "allow");
            assert.ok(result.prism_audit_id.length > 10);
        });

        it("returns allow with message for medium-risk tools", async () => {
            const result = await adapter.handlePreToolUse({
                tool_name: "file_read",
                tool_input: { path: "/config/settings.json" },
            });
            assert.strictEqual(result.permission_decision, "allow");
            assert.ok(result.message?.includes("Tier 2"));
        });

        it("returns ask for high-risk tools (tier3)", async () => {
            const result = await adapter.handlePreToolUse({
                tool_name: "shell",
                tool_input: { cmd: "node index.js" },
                agent_name: "docker-agent",
            });
            assert.strictEqual(result.permission_decision, "ask");
            assert.ok(result.message?.includes("Tier 3"));
            assert.ok(result.prism_audit_id.length > 10);
        });

        it("emits governance event to ActivityBus", async () => {
            let emittedEvent: unknown = null;
            activityBus.subscribe({
                onEvent: (e) => {
                    if (e.operation === "pre_tool_use_evaluated") emittedEvent = e;
                },
            });
            await adapter.handlePreToolUse({
                tool_name: "file_read",
                tool_input: {},
            });
            assert.ok(emittedEvent !== null, "Expected pre_tool_use_evaluated event");
        });

        it("each call produces a unique audit ID", async () => {
            const r1 = await adapter.handlePreToolUse({ tool_name: "file_read", tool_input: {} });
            const r2 = await adapter.handlePreToolUse({ tool_name: "file_read", tool_input: {} });
            assert.notStrictEqual(r1.prism_audit_id, r2.prism_audit_id);
        });
    });

    describe("handlePostToolUse", () => {
        it("returns recorded: true with a unique audit ID", async () => {
            const result = await adapter.handlePostToolUse({
                tool_name: "file_read",
                tool_input: { path: "/config/settings.json" },
                tool_output: { content: "..." },
                agent_name: "docker-agent",
            });
            assert.strictEqual(result.recorded, true);
            assert.ok(result.prism_audit_id.length > 10);
        });

        it("emits governance event to ActivityBus", async () => {
            let emittedEvent: unknown = null;
            activityBus.subscribe({
                onEvent: (e) => {
                    if (e.operation === "post_tool_use_recorded") emittedEvent = e;
                },
            });
            await adapter.handlePostToolUse({
                tool_name: "http_request",
                tool_input: { url: "https://api.example.com/data" },
            });
            assert.ok(emittedEvent !== null, "Expected post_tool_use_recorded event");
        });
    });
});
