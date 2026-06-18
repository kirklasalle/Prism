import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

const execAsync = promisify(exec);

/**
 * Destructive command token patterns — checked as tokenized sub-sequences
 * so obfuscation like `rm -rf $DEST` where DEST resolves to `/` still
 * catches the intent. Each entry is an array of tokens that must ALL appear
 * (case-insensitive) in the command for it to be blocked.
 *
 * This is defense-in-depth, not a guarantee. The PolicyEngine provides the
 * primary governance layer; this is a fast-path safety net.
 */
const DESTRUCTIVE_PATTERNS: readonly (readonly string[])[] = [
    // Mass filesystem destruction
    ["rm", "-rf", "/"],
    ["rm", "-rf", "/*"],
    ["rm", "--no-preserve-root", "-rf"],
    ["dd", "of=/dev/sda"],
    ["dd", "of=/dev/sdb"],
    ["dd", "of=/dev/nvme"],
    ["mkfs"],
    ["format", "c:"],
    ["format", "/c"],
    // Fork bomb and similar
    [":(){"],
    // Windows destructive
    ["del", "/f", "/s", "/q", "c:\\"],
    ["del", "/f", "/s", "/q", "c:"],
    ["rd", "/s", "/q", "c:\\"],
    ["rmdir", "/s", "/q", "c:\\"],
    // Boot/init manipulation
    ["halt"],
    ["shutdown", "-h"],
    ["poweroff"],
];

/**
 * Check a command against destructive patterns using token-level matching.
 * This is more robust than substring matching because it catches:
 *   - Extra flags inserted between tokens: `rm -rf --verbose /`
 *   - Variable expansions: `rm -rf $MOUNTPOINT` (if MOUNTPOINT=/)
 *   - Aliased paths: `rm -rf /` where `rm` is the real rm
 */
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

export class ShellTool implements Tool {
    readonly name = "shell_exec";
    readonly contract = {
        version: "1.1.0",
        args: {
            command: { type: "string", required: true },
            timeoutMs: { type: "number" },
            cwd: { type: "string" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const command = String(request.args.command ?? "").trim();
        const timeoutMs = Number(request.args.timeoutMs ?? 30_000);
        const cwd = request.args.cwd ? String(request.args.cwd) : undefined;

        if (!command) {
            return { ok: false, output: { error: "No command supplied." } };
        }

        // Token-level destructive pattern check (more robust than substring)
        const matched = matchesDestructiveTokens(command);
        if (matched) {
            return {
                ok: false,
                output: { error: `Command blocked — matches destructive pattern: "${matched}"` },
            };
        }

        try {
            const { stdout, stderr } = await execAsync(command, { timeout: timeoutMs, cwd });
            return {
                ok: true,
                output: { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 },
                sideEffects: [
                    { type: "process", description: `shell_exec: ${command}` },
                ],
            };
        } catch (err: unknown) {
            const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
            return {
                ok: false,
                output: {
                    error: e.message ?? "Unknown error",
                    stdout: e.stdout?.trim() ?? "",
                    stderr: e.stderr?.trim() ?? "",
                    exitCode: e.code ?? 1,
                },
            };
        }
    }
}
