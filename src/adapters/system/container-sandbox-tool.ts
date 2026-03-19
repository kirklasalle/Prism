import { randomUUID } from "node:crypto";
import type { Tool, ToolRequest, ToolResult, GovernanceSchema } from "../../core/tools/types.js";

type SandboxState = "created" | "running" | "stopped";

interface ContainerSandboxRecord {
    id: string;
    image: string;
    state: SandboxState;
    quotas?: Record<string, unknown>;
    snapshots: string[];
    createdAt: string;
    updatedAt: string;
}

const CONTAINER_SANDBOX_GOVERNANCE: GovernanceSchema = {
    actions: {
        create: { minimumRisk: "medium", mutating: true, rollbackRequired: true },
        start: { minimumRisk: "medium", mutating: true, rollbackRequired: true },
        stop: { minimumRisk: "medium", mutating: true, rollbackRequired: true },
        snapshot: { minimumRisk: "medium", mutating: true, rollbackRequired: true },
        revert: { minimumRisk: "high", mutating: true, rollbackRequired: true },
        destroy: { minimumRisk: "high", mutating: true, rollbackRequired: true },
        status: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    },
};

const sandboxes = new Map<string, ContainerSandboxRecord>();

function nowIso(): string {
    return new Date().toISOString();
}

export class ContainerSandboxTool implements Tool {
    readonly name = "container_sandbox";
    readonly governance = CONTAINER_SANDBOX_GOVERNANCE;
    readonly contract = {
        version: "1.0.0",
        args: {
            action: {
                type: "string",
                required: true,
                enum: ["create", "start", "stop", "destroy", "snapshot", "revert", "status"],
            },
            sandboxId: { type: "string" },
            image: { type: "string" },
            quotas: { type: "object" },
            snapshotId: { type: "string" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const action = String(request.args.action ?? "").toLowerCase();
        const sandboxId = request.args.sandboxId ? String(request.args.sandboxId) : undefined;

        if (action === "create") {
            const id = sandboxId ?? `sandbox-${randomUUID()}`;
            if (sandboxes.has(id)) {
                return { ok: false, output: { error: `Sandbox ${id} already exists.` } };
            }

            const timestamp = nowIso();
            const record: ContainerSandboxRecord = {
                id,
                image: request.args.image ? String(request.args.image) : "prism/default:latest",
                state: "created",
                quotas: request.args.quotas && typeof request.args.quotas === "object"
                    ? (request.args.quotas as Record<string, unknown>)
                    : undefined,
                snapshots: [],
                createdAt: timestamp,
                updatedAt: timestamp,
            };
            sandboxes.set(id, record);
            return {
                ok: true,
                output: {
                    sandboxId: id,
                    image: record.image,
                    state: record.state,
                    createdAt: record.createdAt,
                },
                sideEffects: [{
                    type: "process",
                    action: "create",
                    resource: id,
                    mutating: true,
                    reversible: true,
                    rollbackPlan: request.rollbackPlan,
                    description: `container_sandbox create: ${id}`,
                }],
            };
        }

        if (!sandboxId) {
            return { ok: false, output: { error: "sandboxId is required for this action." } };
        }

        const record = sandboxes.get(sandboxId);
        if (!record) {
            return { ok: false, output: { error: `Sandbox ${sandboxId} not found.` } };
        }

        if (action === "start") {
            record.state = "running";
            record.updatedAt = nowIso();
            sandboxes.set(sandboxId, record);
            return {
                ok: true,
                output: { sandboxId, state: record.state, updatedAt: record.updatedAt },
                sideEffects: [{
                    type: "process",
                    action: "start",
                    resource: sandboxId,
                    mutating: true,
                    reversible: true,
                    rollbackPlan: request.rollbackPlan,
                    description: `container_sandbox start: ${sandboxId}`,
                }],
            };
        }

        if (action === "stop") {
            record.state = "stopped";
            record.updatedAt = nowIso();
            sandboxes.set(sandboxId, record);
            return {
                ok: true,
                output: { sandboxId, state: record.state, updatedAt: record.updatedAt },
                sideEffects: [{
                    type: "process",
                    action: "stop",
                    resource: sandboxId,
                    mutating: true,
                    reversible: true,
                    rollbackPlan: request.rollbackPlan,
                    description: `container_sandbox stop: ${sandboxId}`,
                }],
            };
        }

        if (action === "snapshot") {
            const snapshotId = request.args.snapshotId
                ? String(request.args.snapshotId)
                : `snapshot-${randomUUID()}`;
            record.snapshots.push(snapshotId);
            record.updatedAt = nowIso();
            sandboxes.set(sandboxId, record);
            return {
                ok: true,
                output: {
                    sandboxId,
                    snapshotId,
                    snapshotCount: record.snapshots.length,
                    updatedAt: record.updatedAt,
                },
                sideEffects: [{
                    type: "file",
                    action: "snapshot",
                    resource: `${sandboxId}/${snapshotId}`,
                    mutating: true,
                    reversible: true,
                    rollbackPlan: request.rollbackPlan,
                    description: `container_sandbox snapshot: ${sandboxId}/${snapshotId}`,
                }],
            };
        }

        if (action === "revert") {
            const snapshotId = request.args.snapshotId ? String(request.args.snapshotId) : "";
            if (!snapshotId) {
                return { ok: false, output: { error: "snapshotId is required for revert." } };
            }
            if (!record.snapshots.includes(snapshotId)) {
                return {
                    ok: false,
                    output: { error: `Snapshot ${snapshotId} not found for ${sandboxId}.` },
                };
            }

            record.updatedAt = nowIso();
            sandboxes.set(sandboxId, record);
            return {
                ok: true,
                output: { sandboxId, revertedTo: snapshotId, updatedAt: record.updatedAt },
                sideEffects: [{
                    type: "process",
                    action: "revert",
                    resource: `${sandboxId}/${snapshotId}`,
                    mutating: true,
                    reversible: false,
                    rollbackPlan: request.rollbackPlan,
                    description: `container_sandbox revert: ${sandboxId}/${snapshotId}`,
                }],
            };
        }

        if (action === "destroy") {
            sandboxes.delete(sandboxId);
            return {
                ok: true,
                output: { sandboxId, destroyed: true },
                sideEffects: [{
                    type: "process",
                    action: "destroy",
                    resource: sandboxId,
                    mutating: true,
                    reversible: false,
                    rollbackPlan: request.rollbackPlan,
                    description: `container_sandbox destroy: ${sandboxId}`,
                }],
            };
        }

        if (action === "status") {
            return {
                ok: true,
                output: {
                    sandboxId,
                    image: record.image,
                    state: record.state,
                    quotas: record.quotas ?? null,
                    snapshots: [...record.snapshots],
                    createdAt: record.createdAt,
                    updatedAt: record.updatedAt,
                },
            };
        }

        return {
            ok: false,
            output: { error: `Unknown container_sandbox action: ${action}` },
        };
    }
}
