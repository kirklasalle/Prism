/**
 * ShellTool — Destructive Pattern Detection Tests
 *
 * Verifies that the token-level destructive pattern matching in ShellTool
 * correctly blocks dangerous commands while allowing legitimate ones.
 *
 * Phase R (Readiness) — Audit remediation item R3d.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Replicate the destructive pattern detection logic from shell-tool.ts
// so we can test it without spinning up the full tool runtime.
const DESTRUCTIVE_PATTERNS: readonly (readonly string[])[] = [
    ["rm", "-rf", "/"],
    ["rm", "-rf", "/*"],
    ["rm", "--no-preserve-root", "-rf"],
    ["dd", "of=/dev/sda"],
    ["dd", "of=/dev/sdb"],
    ["dd", "of=/dev/nvme"],
    ["mkfs"],
    ["format", "c:"],
    ["format", "/c"],
    [":(){"],
    ["del", "/f", "/s", "/q", "c:\\"],
    ["del", "/f", "/s", "/q", "c:"],
    ["rd", "/s", "/q", "c:\\"],
    ["rmdir", "/s", "/q", "c:\\"],
    ["halt"],
    ["shutdown", "-h"],
    ["poweroff"],
];

function matchesDestructiveTokens(command: string): string | null {
    const lower = command.toLowerCase();
    const tokens = lower.split(/\s+/);

    for (const pattern of DESTRUCTIVE_PATTERNS) {
        let pi = 0;
        for (const token of tokens) {
            if (token === pattern[pi] || token.startsWith(pattern[pi] + "=")) {
                pi++;
                if (pi >= pattern.length) {
                    return pattern.join(" ");
                }
            }
        }
    }
    return null;
}

describe("ShellTool — Destructive Pattern Detection", () => {
    // ── Direct matches (should be blocked) ────────────────────────────────
    describe("direct destructive commands", () => {
        const blocked: Array<{ cmd: string; desc: string }> = [
            { cmd: "rm -rf /", desc: "basic rm -rf /" },
            { cmd: "rm -rf /*", desc: "rm -rf on root glob" },
            { cmd: "rm -rf --no-preserve-root /", desc: "rm with no-preserve-root" },
            { cmd: "dd if=/dev/zero of=/dev/sda bs=4M", desc: "dd to sda" },
            { cmd: "dd of=/dev/sdb", desc: "dd to sdb" },
            { cmd: "mkfs.ext4 /dev/sda1", desc: "mkfs command" },
            { cmd: "format c: /fs:ntfs", desc: "Windows format c:" },
            { cmd: "format /c /q", desc: "Windows format /c" },
            { cmd: "del /f /s /q c:\\windows", desc: "Windows force delete" },
            { cmd: "rd /s /q c:\\", desc: "Windows rd" },
            { cmd: "rmdir /s /q c:\\", desc: "Windows rmdir" },
            { cmd: ":(){ :|:& };:", desc: "fork bomb" },
            { cmd: "halt", desc: "halt command" },
            { cmd: "shutdown -h now", desc: "shutdown halt" },
            { cmd: "poweroff", desc: "poweroff command" },
        ];

        for (const { cmd, desc } of blocked) {
            it(`blocks: ${desc}`, () => {
                const result = matchesDestructiveTokens(cmd);
                assert.notEqual(result, null, `Expected "${cmd}" to be blocked`);
            });
        }
    });

    // ── Obfuscation bypass attempts (should be blocked) ───────────────────
    describe("obfuscation bypass attempts", () => {
        const blocked: Array<{ cmd: string; desc: string }> = [
            { cmd: "rm -rf --verbose /", desc: "extra flag between tokens" },
            { cmd: "rm -rf -v /", desc: "short flag between tokens" },
            { cmd: "rm -rf /home; rm -rf /", desc: "chained with semicolon" },
            { cmd: "rm -rf $ROOT", desc: "variable for target (ROOT=/) — token match on rm -rf" },
        ];

        for (const { cmd, desc } of blocked) {
            it(`blocks: ${desc}`, () => {
                const result = matchesDestructiveTokens(cmd);
                assert.notEqual(result, null, `Expected "${cmd}" to be blocked`);
            });
        }
    });

    // ── Safe commands (should NOT be blocked) ─────────────────────────────
    describe("safe commands pass through", () => {
        const allowed: Array<{ cmd: string; desc: string }> = [
            { cmd: "ls -la /", desc: "list root directory" },
            { cmd: "cat /etc/passwd", desc: "read a file" },
            { cmd: "rm file.txt", desc: "remove a single file (no -rf)" },
            { cmd: "rm -rf ./temp", desc: "remove local temp dir (not root)" },
            { cmd: "rm -rf temp/", desc: "remove local temp dir (no leading /)" },
            { cmd: "format", desc: "format command alone (no args)" },
            { cmd: "echo rm -rf /", desc: "echoing dangerous command" },
            { cmd: "grep -r 'rm -rf' .", desc: "searching for rm pattern" },
            { cmd: "docker rm -f container", desc: "docker rm (not filesystem rm)" },
            { cmd: "node -e 'console.log(\"hello\")'", desc: "node eval" },
            { cmd: "npm run build", desc: "npm build" },
            { cmd: "git push origin main", desc: "git push" },
            { cmd: "shutdown --help", desc: "shutdown help (no -h flag)" },
            { cmd: "systemctl halt", desc: "systemctl halt (not bare halt)" },
        ];

        for (const { cmd, desc } of allowed) {
            it(`allows: ${desc}`, () => {
                const result = matchesDestructiveTokens(cmd);
                assert.equal(result, null, `Expected "${cmd}" to be allowed, but was blocked by pattern: ${result}`);
            });
        }
    });

    // ── Edge cases ────────────────────────────────────────────────────────
    describe("edge cases", () => {
        it("handles empty string", () => {
            assert.equal(matchesDestructiveTokens(""), null);
        });

        it("handles whitespace-only string", () => {
            assert.equal(matchesDestructiveTokens("   "), null);
        });

        it("handles single token", () => {
            assert.equal(matchesDestructiveTokens("hello"), null);
        });

        it("handles case insensitivity", () => {
            const result = matchesDestructiveTokens("RM -RF /");
            assert.notEqual(result, null, "Expected case-insensitive match");
        });

        it("handles mixed case", () => {
            const result = matchesDestructiveTokens("Rm -Rf /");
            assert.notEqual(result, null, "Expected mixed-case match");
        });
    });
});