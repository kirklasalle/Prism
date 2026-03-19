import { randomUUID } from "node:crypto";
import type { Tool, ToolRequest, ToolResult, GovernanceSchema } from "../../core/tools/types.js";

type TerminalSessionState = "running" | "stopped" | "revoked";

interface TerminalSessionRecord {
    id: string;
    cwd?: string;
    state: TerminalSessionState;
    startedAt: string;
    updatedAt: string;
    lastCommand?: string;
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

export class TerminalSessionTool implements Tool {
    readonly name = "terminal_session";
    readonly governance = TERMINAL_SESSION_GOVERNANCE;
    readonly contract = {
        version: "1.0.0",
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
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const action = String(request.args.action ?? "").toLowerCase();
        const sessionId = request.args.sessionId ? String(request.args.sessionId) : undefined;

        if (action === "start") {
            const id = sessionId ?? `term-${randomUUID()}`;
            const existing = sessions.get(id);
            if (existing && existing.state === "running") {
                return { ok: false, output: { error: `Session ${id} is already running.` } };
            }

            const timestamp = nowIso();
            const record: TerminalSessionRecord = {
                id,
                cwd: request.args.cwd ? String(request.args.cwd) : existing?.cwd,
                state: "running",
                startedAt: existing?.startedAt ?? timestamp,
                updatedAt: timestamp,
                lastCommand: existing?.lastCommand,
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

        if (!sessionId) {
            return { ok: false, output: { error: "sessionId is required for this action." } };
        }

        const record = sessions.get(sessionId);
        if (!record) {
            return { ok: false, output: { error: `Session ${sessionId} not found.` } };
        }

        if (action === "exec") {
            if (record.state !== "running") {
                return {
                    ok: false,
                    output: { error: `Session ${sessionId} is not running (state=${record.state}).` },
                };
            }

            const command = String(request.args.command ?? "").trim();
            if (!command) {
                return { ok: false, output: { error: "command is required for exec." } };
            }

            record.lastCommand = command;
            record.updatedAt = nowIso();
            sessions.set(sessionId, record);
            return {
                ok: true,
                output: {
                    sessionId,
                    state: record.state,
                    command,
                    stdout: "",
                    stderr: "",
                    exitCode: 0,
                    simulated: true,
                    updatedAt: record.updatedAt,
                },
                sideEffects: [{
                    type: "process",
                    action: "exec",
                    resource: sessionId,
                    mutating: true,
                    reversible: true,
                    rollbackPlan: request.rollbackPlan,
                    description: `terminal_session exec: ${sessionId}`,
                }],
            };
        }

        if (action === "stop") {
            record.state = "stopped";
            record.updatedAt = nowIso();
            sessions.set(sessionId, record);
            return {
                ok: true,
                output: { sessionId, state: record.state, updatedAt: record.updatedAt },
                sideEffects: [{
                    type: "process",
                    action: "stop",
                    resource: sessionId,
                    mutating: true,
                    reversible: true,
                    rollbackPlan: request.rollbackPlan,
                    description: `terminal_session stop: ${sessionId}`,
                }],
            };
        }

        if (action === "revoke") {
            record.state = "revoked";
            record.updatedAt = nowIso();
            sessions.set(sessionId, record);
            return {
                ok: true,
                output: { sessionId, state: record.state, updatedAt: record.updatedAt },
                sideEffects: [{
                    type: "process",
                    action: "revoke",
                    resource: sessionId,
                    mutating: true,
                    reversible: false,
                    rollbackPlan: request.rollbackPlan,
                    description: `terminal_session revoke: ${sessionId}`,
                }],
            };
        }

        if (action === "status") {
            return {
                ok: true,
                output: {
                    sessionId,
                    state: record.state,
                    cwd: record.cwd ?? null,
                    startedAt: record.startedAt,
                    updatedAt: record.updatedAt,
                    lastCommand: record.lastCommand ?? null,
                },
            };
        }

        return {
            ok: false,
            output: { error: `Unknown terminal_session action: ${action}` },
        };
    }
}
