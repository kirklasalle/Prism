/**
 * Tests for NexusBridge tools — using a temporary directory to avoid
 * touching the real Nexus files.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    NexusCheckHotlineTool,
    NexusReadMemoryTool,
    NexusLogInsightTool,
    NexusBroadcastTool,
    nexusBridgeTools,
} from "../src/adapters/application/nexus-bridge-tool.js";

// ──────────────────────────────────────────────────────────────────────────────
// Setup: temp directory mirroring the real bridge structure
// ──────────────────────────────────────────────────────────────────────────────

let tempDir: string;
let hotlinePath: string;
let memoryDir: string;
let prismThreadPath: string;

const baseRequest = { operation: "", args: {}, risk: "low" as const, mutatesState: false };

before(() => {
    tempDir = join(tmpdir(), `prism-nexus-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    hotlinePath = join(tempDir, "hotline.md");
    memoryDir = join(tempDir, "memory");
    prismThreadPath = join(tempDir, "Thread_Active.md");

    mkdirSync(memoryDir, { recursive: true });

    // Seed test files
    writeFileSync(hotlinePath, "**From:** Nexus\n**Subject:** Test\n\nHello from Nexus\n");
    writeFileSync(join(memoryDir, "MEMORY.md"), "## Core Principles\n\nBeware the void.\n");
    writeFileSync(prismThreadPath, "# Active Thread\n\n");

    // Override env vars so tools point to temp paths
    process.env["NEXUS_HOTLINE"] = hotlinePath;
    process.env["NEXUS_MEMORY_DIR"] = memoryDir;
    process.env["NEXUS_PRISM_THREAD"] = prismThreadPath;
});

after(() => {
    delete process.env["NEXUS_HOTLINE"];
    delete process.env["NEXUS_MEMORY_DIR"];
    delete process.env["NEXUS_PRISM_THREAD"];
    try {
        rmSync(tempDir, { recursive: true, force: true });
    } catch {
        // Ignore cleanup failures on Windows
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("NexusCheckHotlineTool", () => {
    it("reads hotline content", async () => {
        const tool = new NexusCheckHotlineTool();
        const result = await tool.execute({ ...baseRequest, operation: tool.name });
        assert.ok(result.ok);
        assert.ok(String(result.output["snippet"]).includes("Hello from Nexus"));
        assert.ok((result.output["length"] as number) > 0);
        assert.equal(result.output["hasContent"], true);
    });

    it("respects maxChars truncation", async () => {
        const tool = new NexusCheckHotlineTool();
        const result = await tool.execute({
            ...baseRequest,
            operation: tool.name,
            args: { maxChars: 5 },
        });
        assert.ok(result.ok);
        assert.ok(String(result.output["snippet"]).length <= 5);
    });

    it("returns ok=true with empty content when file is empty", async () => {
        writeFileSync(hotlinePath, "");
        const tool = new NexusCheckHotlineTool();
        const result = await tool.execute({ ...baseRequest, operation: tool.name });
        assert.ok(result.ok);
        assert.equal(result.output["hasContent"], false);
        // Restore
        writeFileSync(hotlinePath, "**From:** Nexus\n**Subject:** Test\n\nHello from Nexus\n");
    });
});

describe("NexusReadMemoryTool", () => {
    it("reads MEMORY.md content", async () => {
        const tool = new NexusReadMemoryTool();
        const result = await tool.execute({ ...baseRequest, operation: tool.name });
        assert.ok(result.ok);
        assert.ok(String(result.output["content"]).includes("Beware the void"));
    });

    it("returns ok=false when memory file does not exist", async () => {
        process.env["NEXUS_MEMORY_DIR"] = join(tempDir, "nonexistent");
        const tool = new NexusReadMemoryTool();
        const result = await tool.execute({ ...baseRequest, operation: tool.name });
        assert.ok(!result.ok);
        assert.ok(result.output["error"]);
        // Restore
        process.env["NEXUS_MEMORY_DIR"] = memoryDir;
    });
});

describe("NexusLogInsightTool", () => {
    it("appends an insight to today's daily memory file", async () => {
        const tool = new NexusLogInsightTool();
        const result = await tool.execute({
            ...baseRequest,
            operation: tool.name,
            args: { content: "PRISM passed all MCP tests today.", category: "Test Results" },
        });
        assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result.output)}`);
        assert.ok((result.output["charsWritten"] as number) > 0);
        assert.equal(result.sideEffects?.length, 1);
        assert.equal(result.sideEffects![0]!.type, "file");

        // Verify content was written
        const writtenPath = result.output["path"] as string;
        const content = readFileSync(writtenPath, "utf-8");
        assert.ok(content.includes("PRISM passed all MCP tests today."));
        assert.ok(content.includes("Test Results"));
    });

    it("returns ok=false when content is empty", async () => {
        const tool = new NexusLogInsightTool();
        const result = await tool.execute({
            ...baseRequest,
            operation: tool.name,
            args: { content: "" },
        });
        assert.ok(!result.ok);
        assert.ok(result.output["error"]);
    });
});

describe("NexusBroadcastTool", () => {
    it("appends STP message to PRISM thread by default", async () => {
        const tool = new NexusBroadcastTool();
        const before = readFileSync(prismThreadPath, "utf-8");
        const result = await tool.execute({
            ...baseRequest,
            operation: tool.name,
            args: { subject: "Test Broadcast", message: "Hello from PRISM unit tests." },
        });

        assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result.output)}`);
        assert.equal(result.output["channel"], "prism-thread");

        const after = readFileSync(prismThreadPath, "utf-8");
        assert.ok(after.length > before.length);
        assert.ok(after.includes("Test Broadcast"));
        assert.ok(after.includes("Hello from PRISM unit tests."));
        assert.ok(after.includes("**From:** PRISM"));
    });

    it("appends to hotline when useHotline=true", async () => {
        const tool = new NexusBroadcastTool();
        const result = await tool.execute({
            ...baseRequest,
            operation: tool.name,
            args: { subject: "Hotline Test", message: "Broadcasting on hotline.", useHotline: true },
        });

        assert.ok(result.ok);
        assert.equal(result.output["channel"], "hotline");

        const hotlineContent = readFileSync(hotlinePath, "utf-8");
        assert.ok(hotlineContent.includes("Broadcasting on hotline."));
    });

    it("returns ok=false when subject is missing", async () => {
        const tool = new NexusBroadcastTool();
        const result = await tool.execute({
            ...baseRequest,
            operation: tool.name,
            args: { message: "No subject" },
        });
        assert.ok(!result.ok);
        assert.ok(result.output["error"]);
    });

    it("returns ok=false when message is missing", async () => {
        const tool = new NexusBroadcastTool();
        const result = await tool.execute({
            ...baseRequest,
            operation: tool.name,
            args: { subject: "No message" },
        });
        assert.ok(!result.ok);
        assert.ok(result.output["error"]);
    });
});

describe("nexusBridgeTools factory", () => {
    it("returns all 4 tools", () => {
        const tools = nexusBridgeTools();
        assert.equal(tools.length, 4);
        const names = tools.map((t) => t.name);
        assert.ok(names.includes("nexus_check_hotline"));
        assert.ok(names.includes("nexus_read_memory"));
        assert.ok(names.includes("nexus_log_insight"));
        assert.ok(names.includes("nexus_broadcast"));
    });
});
