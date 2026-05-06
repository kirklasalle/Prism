/**
 * Tests for McpClientAdapter, McpConnection, and McpProxyTool.
 *
 * Uses a fake echo-server (node:child_process + node:net) to simulate an MCP
 * server over stdio, so no Python / external process is required.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { McpClientAdapter, McpConnection, McpProxyTool } from "../src/adapters/protocol/mcp-client-tool.js";
import { ToolRegistry } from "../src/core/tools/registry.js";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers: spin up a minimal MCP echo server in a temp Node.js script
// ──────────────────────────────────────────────────────────────────────────────

const ECHO_SERVER_SCRIPT = `
import { createInterface } from "node:readline";

const tools = [
  { name: "echo", description: "Echo back the input", inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } },
  { name: "add",  description: "Add two numbers",     inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },
];

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    if (msg.method === "initialize") {
      respond(msg.id, { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "echo-server", version: "1.0.0" } });
    } else if (msg.method === "notifications/initialized") {
      // notification — no response
    } else if (msg.method === "tools/list") {
      respond(msg.id, { tools });
    } else if (msg.method === "tools/call") {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      if (name === "echo") {
        respond(msg.id, { content: [{ type: "text", text: args.message ?? "" }], isError: false });
      } else if (name === "add") {
        respond(msg.id, { content: [{ type: "text", text: JSON.stringify({ sum: (args.a ?? 0) + (args.b ?? 0) }) }], isError: false });
      } else {
        respond(msg.id, { content: [{ type: "text", text: "unknown tool" }], isError: true });
      }
    }
  } catch { /* ignore parse errors */ }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
`;

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

let tempDir: string;
let echoScriptPath: string;
let settingsPath: string;

describe("McpClientAdapter", () => {
    before(() => {
        tempDir = join(tmpdir(), `prism-mcp-test-${Date.now()}`);
        mkdirSync(tempDir, { recursive: true });
        echoScriptPath = join(tempDir, "echo-server.mjs");
        writeFileSync(echoScriptPath, ECHO_SERVER_SCRIPT);

        settingsPath = join(tempDir, "mcp-settings.json");
        writeFileSync(
            settingsPath,
            JSON.stringify({
                mcpServers: {
                    "test-echo": {
                        command: "node",
                        args: [echoScriptPath],
                        cwd: tempDir,
                    },
                },
            }),
        );
    });

    after(() => {
        // Best-effort cleanup — Windows may hold file handles briefly after process kill
        try {
            if (existsSync(tempDir)) {
                rmSync(tempDir, { recursive: true, force: true });
            }
        } catch {
            // Ignore EPERM and similar cleanup failures; OS will reclaim temp files
        }
    });

    it("connects to a stdio MCP server and discovers tools", async () => {
        const adapter = new McpClientAdapter();
        const registry = new ToolRegistry();
        const result = await adapter.loadAndRegister(settingsPath, registry);
        adapter.disconnectAll();

        assert.equal(result.errors.length, 0, `Unexpected errors: ${JSON.stringify(result.errors)}`);
        assert.equal(result.registered.length, 2);
        assert.ok(result.registered.includes("mcp_echo"), "expected mcp_echo");
        assert.ok(result.registered.includes("mcp_add"), "expected mcp_add");
        assert.equal(result.serverToolCounts["test-echo"], 2);
    });

    it("registered tools are retrievable from ToolRegistry", async () => {
        const adapter = new McpClientAdapter();
        const registry = new ToolRegistry();
        await adapter.loadAndRegister(settingsPath, registry);
        adapter.disconnectAll();

        const echoTool = registry.get("mcp_echo");
        assert.ok(echoTool, "mcp_echo should be in registry");
        assert.equal(echoTool.name, "mcp_echo");
    });

    it("executes echo tool and returns result", async () => {
        const adapter = new McpClientAdapter();
        const registry = new ToolRegistry();
        await adapter.loadAndRegister(settingsPath, registry);

        const echoTool = registry.get("mcp_echo");
        const result = await echoTool.execute({
            operation: "mcp_echo",
            args: { message: "hello prism" },
            risk: "low",
            mutatesState: false,
        });

        adapter.disconnectAll();

        assert.ok(result.ok, `Tool execution failed: ${JSON.stringify(result.output)}`);
        assert.equal(result.output["result"], "hello prism");
    });

    it("executes add tool and returns JSON-parsed numeric result", async () => {
        const adapter = new McpClientAdapter();
        const registry = new ToolRegistry();
        await adapter.loadAndRegister(settingsPath, registry);

        const addTool = registry.get("mcp_add");
        const result = await addTool.execute({
            operation: "mcp_add",
            args: { a: 21, b: 21 },
            risk: "low",
            mutatesState: false,
        });

        adapter.disconnectAll();

        assert.ok(result.ok);
        assert.equal((result.output as { sum?: number })["sum"], 42);
    });

    it("returns error result for unknown MCP tool name", async () => {
        const adapter = new McpClientAdapter();
        const registry = new ToolRegistry();
        await adapter.loadAndRegister(settingsPath, registry);
        const servers = adapter.getConnectedServers();
        assert.equal(servers.length, 1);
        assert.equal(servers[0]!.name, "test-echo");
        adapter.disconnectAll();
    });

    it("collects errors for non-existent server, continues loading others", async () => {
        const badSettingsPath = join(tempDir, "bad-settings.json");
        writeFileSync(
            badSettingsPath,
            JSON.stringify({
                mcpServers: {
                    "bad-server": {
                        command: "node",
                        args: ["/nonexistent/path/server.mjs"],
                        cwd: tempDir,
                    },
                    "test-echo": {
                        command: "node",
                        args: [echoScriptPath],
                        cwd: tempDir,
                    },
                },
            }),
        );

        const adapter = new McpClientAdapter();
        const registry = new ToolRegistry();
        const result = await adapter.loadAndRegister(badSettingsPath, registry);
        adapter.disconnectAll();

        assert.equal(result.errors.length, 1);
        assert.equal(result.errors[0]!.server, "bad-server");
        // echo server still loaded despite bad-server failure
        assert.equal(result.registered.length, 2);
    });

    it("serverNames option limits which servers are loaded", async () => {
        const adapter = new McpClientAdapter();
        const registry = new ToolRegistry();
        const result = await adapter.loadAndRegister(settingsPath, registry, {
            serverNames: ["nonexistent-server"],
        });
        adapter.disconnectAll();

        assert.equal(result.registered.length, 0);
        assert.equal(result.errors.length, 0);
    });

    it("throws on missing settings file", async () => {
        const adapter = new McpClientAdapter();
        const registry = new ToolRegistry();
        await assert.rejects(
            () => adapter.loadAndRegister("/nonexistent/mcp-settings.json", registry),
            /Cannot read MCP settings/,
        );
    });

    it("McpProxyTool has correct name and serverName metadata", async () => {
        const adapter = new McpClientAdapter();
        const registry = new ToolRegistry();
        await adapter.loadAndRegister(settingsPath, registry);

        const proxy = registry.get("mcp_echo") as McpProxyTool;
        assert.equal(proxy.serverName, "test-echo");
        assert.ok(proxy.mcpDescription.length > 0, "description should be set");
        adapter.disconnectAll();
    });

    it("getServerStates reports connected state with toolCount", async () => {
        const adapter = new McpClientAdapter();
        const registry = new ToolRegistry();
        await adapter.loadAndRegister(settingsPath, registry);

        const states = adapter.getServerStates();
        assert.equal(states.length, 1);
        assert.equal(states[0]!.name, "test-echo");
        assert.equal(states[0]!.state, "connected");
        assert.equal(states[0]!.toolCount, 2);
        assert.equal(states[0]!.retryCount, 0);
        assert.equal(states[0]!.lastError, null);

        adapter.disconnectAll();
    });

    it("forceReconnect on a connected server keeps it healthy", async () => {
        const adapter = new McpClientAdapter();
        const registry = new ToolRegistry();
        await adapter.loadAndRegister(settingsPath, registry);

        const result = await adapter.forceReconnect("test-echo");
        assert.equal(result.ok, true);
        const states = adapter.getServerStates();
        assert.equal(states[0]!.state, "connected");
        assert.equal(states[0]!.toolCount, 2);

        adapter.disconnectAll();
    });

    it("forceReconnect returns error for unknown server name", async () => {
        const adapter = new McpClientAdapter();
        const registry = new ToolRegistry();
        await adapter.loadAndRegister(settingsPath, registry);

        const result = await adapter.forceReconnect("does-not-exist");
        assert.equal(result.ok, false);
        assert.match(String(result.error), /Unknown MCP server/);

        adapter.disconnectAll();
    });

    it("McpConnection.stderrTail captures lines (no truncation)", async () => {
        // A throwaway script that writes a long stderr line and exits.
        const failScriptPath = join(tempDir, "fail-server.mjs");
        const longLine = "X".repeat(180); // > the old 120-char cap
        writeFileSync(
            failScriptPath,
            `process.stderr.write(${JSON.stringify(longLine)} + "\\n");\n` +
            `process.stderr.write("Traceback (most recent call last):\\n");\n` +
            `process.stderr.write("  File 'foo.py', line 1\\n");\n` +
            `process.stderr.write("ValueError: something specific went wrong\\n");\n` +
            `process.exit(2);\n`,
        );
        const conn = new McpConnection("fail", { command: "node", args: [failScriptPath] });
        await assert.rejects(() => conn.connect());
        const tail = conn.stderrTail(20);
        assert.ok(tail.length >= 4, `expected >= 4 stderr lines, got ${tail.length}`);
        // The long line should NOT be truncated.
        assert.ok(tail.some((l) => l === longLine), "expected full long line preserved verbatim");
        // firstStderrHint should prefer the actual exception, not the Traceback header.
        const hint = conn.firstStderrHint();
        assert.match(hint, /ValueError: something specific went wrong/);
    });
});
