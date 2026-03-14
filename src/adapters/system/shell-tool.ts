import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

const execAsync = promisify(exec);

// Patterns that are permanently blocked regardless of authority tier.
const BLOCKED_PATTERNS: readonly string[] = [
    "rm -rf /",
    "rm -rf /*",
    "format c:",
    "format /c",
    "del /f /s /q c:\\",
    ":(){ :|:& };:",
    "dd if=/dev/zero of=/dev/sda",
];

export class ShellTool implements Tool {
    readonly name = "shell_exec";
    readonly contract = {
        version: "1.0.0",
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

        const lower = command.toLowerCase();
        for (const pattern of BLOCKED_PATTERNS) {
            if (lower.includes(pattern)) {
                return {
                    ok: false,
                    output: { error: `Command blocked — matches unsafe pattern: "${pattern}"` },
                };
            }
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
