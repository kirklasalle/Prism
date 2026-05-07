/**
 * Terminal Session Tool — REAL command execution.
 *
 * This tool provides real shell command execution for Prism agents.
 * It manages session state (start/stop/revoke/status) and executes
 * commands via child_process.exec with safety controls.
 *
 * When an optional TerminalSessionAdapter is provided, commands are
 * delegated to the full PTY/policy/persistence pipeline. Otherwise,
 * commands are executed directly via child_process for immediate results.
 *
 * Phase E — Production Hardening: Replaced simulated exec with real execution.
 */
import { randomUUID } from "node:crypto";
import type { Tool, ToolRequest, ToolResult, GovernanceSchema } from "../../core/tools/types.js";
import type { TerminalSessionAdapter, ExecCommandResponse } from "../application/terminal-session-adapter.js";

type TerminalSessionState = "running" | "stopped" | "revoked";

interface TerminalSessionRecord {
    id: string;
    cwd?: string;
    state: TerminalSessionState;
    startedAt: string;
    updatedAt: string;
    lastCommand?: string;
    /** Adapter session ID when backed by a TerminalSessionAdapter. */
    adapterSessionId?: string;
}

const TERMINAL_SESSION_GOVERNANCE: GovernanceSchema = {
    actions: {
        start: { minimumRisk: "medium", mutating: true, rollbackRequired: true },
        exec: { minimumRisk: "medium", mutating: true, rollbackRequired: true },
        stop: { minimumRisk: "medium", mutating: true, rollbackRequired: true },
        revoke: { minimumRisk: "high", mutating: true, rollbackRequired: true },
        status: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    },
};

const sessions = new Map<string, TerminalSessionRecord>();

function nowIso(): string {
    return new Date().toISOString();
}

/**
 * Safety blocklist — high-risk patterns that require explicit approval.
 * Matches the same set used by the dashboard /api/computer/exec endpoint.
 */
const BLOCKED_COMMAND_PATTERN = /rm\s+-rf|del\s+\/[sfq]|format\s+[a-z]:|shutdown|restart|reboot/i;

/** Default command execution timeout (15 seconds). */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Maximum output buffer size (512 KB). */
const MAX_BUFFER = 512 * 1024;

export class TerminalSessionTool implements Tool {
    readonly name = "terminal_session";
    readonly governance = TERMINAL_SESSION_GOVERNANCE;
    readonly contract = {
        version: "1.1.0",
        args: {
            action: {
                type: "string",
                required: true,
                enum: ["start", "exec", "stop", "revoke", "status"],
            },
            sessionId: { type: "string" },
            command: { type: "string" },
            cwd: { type: "string" },
            env: { type: "object" },
            timeout_ms: { type: "number" },
        },
    } as const;

    /**
     * @param adapter  Optional TerminalSessionAdapter for full PTY/policy integration.
     *                 When not provided, commands execute via child_process.exec.
     */
    constructor(private readonly adapter?: TerminalSessionAdapter) {}

    async execute(request: ToolRequest): Promise<ToolResult> {
        const action = String(request.args.action ?? "").toLowerCase();
        const sessionId = request.args.sessionId ? String(request.args.sessionId) : undefined;

        if (action === "start") {
            return this.handleStart(request, sessionId);
        }

        if (!sessionId) {
            return { ok: false, output: { error: "sessionId is required for this action." } };
        }

        const record = sessions.get(sessionId);
        if (!record) {
            return { ok: false, output: { error: `Session ${sessionId} not found.` } };
        }

        switch (action) {
            case "exec":
                return this.handleExec(request, record);
            case "stop":
                return this.handleStop(request, record);
            case "revoke":
                return this.handleRevoke(request, record);
            case "status":
                return this.handleStatus(record);
            default:
                return {
                    ok: false,
                    output: { error: `Unknown terminal_session action: ${action}` },
                };
        }
    }

    // ── Action handlers ──────────────────────────────────────────────────

    private async handleStart(request: ToolRequest, sessionId?: string): Promise<ToolResult> {
        const id = sessionId ?? `term-${randomUUID()}`;
        const existing = sessions.get(id);
        if (existing && existing.state === "running") {
            return { ok: false, output: { error: `Session ${id} is already running.` } };
        }

        const timestamp = nowIso();
        const cwd = request.args.cwd ? String(request.args.cwd) : existing?.cwd;

        // If adapter is available, create a real PTY session
        let adapterSessionId: string | undefined;
        if (this.adapter) {
            try {
                const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
                const session = await this.adapter.startSession(
                    shell,
                    cwd ?? process.cwd(),
                    "prism-agent",
                );
                adapterSessionId = session.session_id;
            } catch {
                // Adapter start failed — fall back to direct exec mode
            }
        }

        const record: TerminalSessionRecord = {
            id,
            cwd,
            state: "running",
            startedAt: existing?.startedAt ?? timestamp,
            updatedAt: timestamp,
            lastCommand: existing?.lastCommand,
            adapterSessionId,
        };
        sessions.set(id, record);

        return {
            ok: true,
            output: {
                sessionId: id,
                state: record.state,
                cwd: record.cwd ?? null,
                startedAt: record.startedAt,
                updatedAt: record.updatedAt,
                ptyEnabled: !!adapterSessionId,
            },
            sideEffects: [{
                type: "process",
                action: "start",
                resource: id,
                mutating: true,
                reversible: true,
                rollbackPlan: request.rollbackPlan,
                description: `terminal_session start: ${id}`,
            }],
        };
    }

    private async handleExec(request: ToolRequest, record: TerminalSessionRecord): Promise<ToolResult> {
        if (record.state !== "running") {
            return {
                ok: false,
                output: { error: `Session ${record.id} is not running (state=${record.state}).` },
            };
        }

        const command = String(request.args.command ?? "").trim();
        if (!command) {
            return { ok: false, output: { error: "command is required for exec." } };
        }

        // Safety check
        if (BLOCKED_COMMAND_PATTERN.test(command)) {
            return {
                ok: false,
                output: {
                    error: "Command blocked by safety policy.",
                    command,
                    blockedPattern: BLOCKED_COMMAND_PATTERN.source,
                },
            };
        }

        record.lastCommand = command;
        record.updatedAt = nowIso();
        sessions.set(record.id, record);

        const timeoutMs = typeof request.args.timeout_ms === "number"
            ? request.args.timeout_ms
            : DEFAULT_TIMEOUT_MS;

        // ── Route 1: Full adapter with PTY/policy/persistence ────────────
        if (this.adapter && record.adapterSessionId) {
            try {
                const result: ExecCommandResponse = await this.adapter.execCommand(
                    record.adapterSessionId,
                    command,
                    timeoutMs,
                );
                return {
                    ok: true,
                    output: {
                        sessionId: record.id,
                        state: record.state,
                        command,
                        stdout: result.stdout,
                        stderr: result.stderr,
                        exitCode: result.exit_code,
                        executionTimeMs: result.execution_time_ms,
                        simulated: false,
                        backend: "pty-adapter",
                        updatedAt: record.updatedAt,
                    },
                    sideEffects: [{
                        type: "process",
                        action: "exec",
                        resource: record.id,
                        mutating: true,
                        reversible: true,
                        rollbackPlan: request.rollbackPlan,
                        description: `terminal_session exec: ${record.id}`,
                    }],
                };
            } catch (adapterErr) {
                // Adapter execution failed — fall through to direct exec
                const errMsg = adapterErr instanceof Error ? adapterErr.message : String(adapterErr);
                console.warn(`[TerminalSessionTool] Adapter exec failed (${errMsg}), falling back to direct exec.`);
            }
        }

        // ── Route 2: Direct child_process.exec (real execution) ──────────
        try {
            const { exec: execCb } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const execAsync = promisify(execCb);

            const start = Date.now();
            const result = await execAsync(command, {
                timeout: timeoutMs,
                maxBuffer: MAX_BUFFER,
                cwd: record.cwd ?? undefined,
                env: typeof request.args.env === "object" && request.args.env !== null
                    ? { ...process.env, ...(request.args.env as Record<string, string>) }
                    : undefined,
            });
            const executionTimeMs = Date.now() - start;

            return {
                ok: true,
                output: {
                    sessionId: record.id,
                    state: record.state,
                    command,
                    stdout: result.stdout ?? "",
                    stderr: result.stderr ?? "",
                    exitCode: 0,
                    executionTimeMs,
                    simulated: false,
                    backend: "child_process",
                    updatedAt: record.updatedAt,
                },
                sideEffects: [{
                    type: "process",
                    action: "exec",
                    resource: record.id,
                    mutating: true,
                    reversible: true,
                    rollbackPlan: request.rollbackPlan,
                    description: `terminal_session exec: ${record.id}`,
                }],
            };
        } catch (error: unknown) {
            const err = error as { stdout?: string; stderr?: string; message?: string; code?: number };
            return {
                ok: true, // We still return ok:true because the command ran (it just exited non-zero)
                output: {
                    sessionId: record.id,
                    state: record.state,
                    command,
                    stdout: err.stdout ?? "",
                    stderr: err.stderr ?? err.message ?? String(error),
                    exitCode: err.code ?? 1,
                    simulated: false,
                    backend: "child_process",
                    updatedAt: record.updatedAt,
                },
                sideEffects: [{
                    type: "process",
                    action: "exec",
                    resource: record.id,
                    mutating: true,
                    reversible: true,
                    rollbackPlan: request.rollbackPlan,
                    description: `terminal_session exec: ${record.id}`,
                }],
            };
        }
    }

    private async handleStop(request: ToolRequest, record: TerminalSessionRecord): Promise<ToolResult> {
        // Stop adapter session if running
        if (this.adapter && record.adapterSessionId) {
            try {
                await this.adapter.stopSession(record.adapterSessionId);
            } catch {
                // Best-effort cleanup
            }
        }

        record.state = "stopped";
        record.updatedAt = nowIso();
        sessions.set(record.id, record);
        return {
            ok: true,
            output: { sessionId: record.id, state: record.state, updatedAt: record.updatedAt },
            sideEffects: [{
                type: "process",
                action: "stop",
                resource: record.id,
                mutating: true,
                reversible: true,
                rollbackPlan: request.rollbackPlan,
                description: `terminal_session stop: ${record.id}`,
            }],
        };
    }

    private async handleRevoke(request: ToolRequest, record: TerminalSessionRecord): Promise<ToolResult> {
        // Force-revoke adapter session if running
        if (this.adapter && record.adapterSessionId) {
            try {
                await this.adapter.revokeSession(record.adapterSessionId, "tool_revoke");
            } catch {
                // Best-effort cleanup
            }
        }

        record.state = "revoked";
        record.updatedAt = nowIso();
        sessions.set(record.id, record);
        return {
            ok: true,
            output: { sessionId: record.id, state: record.state, updatedAt: record.updatedAt },
            sideEffects: [{
                type: "process",
                action: "revoke",
                resource: record.id,
                mutating: true,
                reversible: false,
                rollbackPlan: request.rollbackPlan,
                description: `terminal_session revoke: ${record.id}`,
            }],
        };
    }

    private handleStatus(record: TerminalSessionRecord): ToolResult {
        return {
            ok: true,
            output: {
                sessionId: record.id,
                state: record.state,
                cwd: record.cwd ?? null,
                startedAt: record.startedAt,
                updatedAt: record.updatedAt,
                lastCommand: record.lastCommand ?? null,
                ptyEnabled: !!record.adapterSessionId,
            },
        };
    }
}
