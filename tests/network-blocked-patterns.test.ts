/**
 * Network Blocked Patterns — Regression Tests
 *
 * Validates that all permanently blocked command patterns are correctly
 * rejected by NetworkTool.execute(), regardless of tier classification.
 *
 * Run: npx mocha dist/tests/network-blocked-patterns.test.js --timeout 30000
 */
import { describe, it } from "mocha";
import assert from "node:assert";

// Import NetworkTool from the compiled output
import { NetworkTool } from "../src/adapters/network/network-tool.js";

describe("NetworkTool — Blocked Pattern Enforcement", function () {
    this.timeout(15_000);

    const tool = new NetworkTool();

    /** All 7 blocked patterns from network-tool.ts */
    const BLOCKED_PATTERNS = [
        "netsh interface reset",
        "netsh winsock reset",
        "netsh int ip reset",
        "net stop /y",
        "iptables -f",
        "iptables --flush",
        "ip link set dev",
    ];

    describe("exact blocked patterns", () => {
        for (const pattern of BLOCKED_PATTERNS) {
            it(`rejects: "${pattern}"`, async () => {
                const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: pattern } });
                assert.strictEqual(result.ok, false, `Should block "${pattern}"`);
                assert.ok(
                    String((result.output as any).error).includes("blocked"),
                    `Error message should mention 'blocked' for "${pattern}"`,
                );
            });
        }
    });

    describe("blocked patterns with surrounding context", () => {
        it("rejects 'netsh interface reset all' (pattern as prefix)", async () => {
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "netsh interface reset all" } });
            assert.strictEqual(result.ok, false);
        });

        it("rejects 'sudo netsh winsock reset' (pattern with prefix)", async () => {
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "sudo netsh winsock reset" } });
            assert.strictEqual(result.ok, false);
        });

        it("rejects 'iptables -F INPUT' (blocked flag with chain)", async () => {
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "iptables -F INPUT" } });
            assert.strictEqual(result.ok, false);
        });

        it("rejects 'iptables --flush OUTPUT' (blocked long flag with chain)", async () => {
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "iptables --flush OUTPUT" } });
            assert.strictEqual(result.ok, false);
        });

        it("rejects 'ip link set dev eth0 down' (device manipulation)", async () => {
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "ip link set dev eth0 down" } });
            assert.strictEqual(result.ok, false);
        });

        it("rejects 'net stop /y Server' (forced service stop)", async () => {
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "net stop /y Server" } });
            assert.strictEqual(result.ok, false);
        });
    });

    describe("case-insensitive blocking", () => {
        it("rejects 'NETSH INTERFACE RESET' (uppercase)", async () => {
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "NETSH INTERFACE RESET" } });
            assert.strictEqual(result.ok, false);
        });

        it("rejects 'Netsh Winsock Reset' (mixed case)", async () => {
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "Netsh Winsock Reset" } });
            assert.strictEqual(result.ok, false);
        });

        it("rejects 'IPTABLES -f' (uppercase with lowercase flag)", async () => {
            // -F is the blocked pattern; -f is lowercase
            // The original blocked pattern is "iptables -F" — this tests case folding
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "IPTABLES -F" } });
            assert.strictEqual(result.ok, false);
        });
    });

    describe("boundary conditions", () => {
        it("rejects empty command", async () => {
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "" } });
            assert.strictEqual(result.ok, false);
        });

        it("rejects whitespace-only command", async () => {
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "   " } });
            assert.strictEqual(result.ok, false);
        });

        it("rejects unknown command (not on allowlist)", async () => {
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "rm -rf /" } });
            assert.strictEqual(result.ok, false);
            assert.ok(
                String((result.output as any).error).includes("not recognized"),
                "Should explain command is not recognized",
            );
        });

        it("allows safe tier-1 command (positive control)", async () => {
            // hostname is universally available and safe
            const result = await tool.execute({ operation: "network_exec", risk: "low", mutatesState: false, args: { command: "hostname" } });
            assert.strictEqual(result.ok, true, "hostname should be allowed as tier-1");
        });
    });
});
