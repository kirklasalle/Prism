import { randomUUID } from "node:crypto";
import type { Tool, ToolRequest, ToolResult, GovernanceSchema } from "../../core/tools/types.js";
import type { ContainerSandboxAdapter } from "../application/container-sandbox-adapter.js";

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
        version: "1.1.0",
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

    /**
     * @param adapter  Optional ContainerSandboxAdapter for full filesystem-isolated
     *                 runtime with policy/persistence. When not provided, uses in-memory
     *                 state for lightweight operation.
     */
    constructor(private readonly adapter?: ContainerSandboxAdapter) {}

    async execute(request: ToolRequest): Promise<ToolResult> {
        const action = String(request.args.action ?? "").toLowerCase();
        const sandboxId = request.args.sandboxId ? String(request.args.sandboxId) : undefined;

        // ── Route through full adapter when available ────────────────────
        if (this.adapter) {
            return this.executeViaAdapter(action, request, sandboxId);
        }

        // ── Fallback: in-memory state (no filesystem isolation) ──────────
        return this.executeInMemory(action, request, sandboxId);
    }

    // ── Adapter-backed execution ─────────────────────────────────────────

    private async executeViaAdapter(
        action: string,
        request: ToolRequest,
        sandboxId?: string,
    ): Promise<ToolResult> {
        try {
            if (action === "create") {
                const image = request.args.image ? String(request.args.image) : "prism/default:latest";
                const quotas = request.args.quotas && typeof request.args.quotas === "object"
                    ? (request.args.quotas as Record<string, unknown>)
                    : undefined;
                const container = await this.adapter!.createContainer(image, {
                    cpu_limit: (quotas?.cpu_limit as number) ?? 1,
                    memory_limit_mb: (quotas?.memory_limit_mb as number) ?? 256,
                    disk_limit_mb: (quotas?.disk_limit_mb as number) ?? 1024,
                });
                return {
                    ok: true,
                    output: {
                        sandboxId: container.container_id,
                        image: container.image,
                        state: container.state,
                        createdAt: container.created_at,
                        backend: "container-adapter",
                    },
                    sideEffects: [{
                        type: "process",
                        action: "create",
                        resource: container.container_id,
                        mutating: true,
                        reversible: true,
                        rollbackPlan: request.rollbackPlan,
                        description: `container_sandbox create: ${container.container_id}`,
                    }],
                };
            }

            if (!sandboxId) {
                return { ok: false, output: { error: "sandboxId is required for this action." } };
            }

            if (action === "start") {
                const started = await this.adapter!.startContainer(sandboxId);
                return {
                    ok: true,
                    output: { sandboxId, state: started.state, startedAt: started.started_at, backend: "container-adapter" },
                    sideEffects: [{
                        type: "process", action: "start", resource: sandboxId,
                        mutating: true, reversible: true, rollbackPlan: request.rollbackPlan,
                        description: `container_sandbox start: ${sandboxId}`,
                    }],
                };
            }

            if (action === "stop") {
                await this.adapter!.stopContainer(sandboxId);
                return {
                    ok: true,
                    output: { sandboxId, state: "stopped", backend: "container-adapter" },
                    sideEffects: [{
                        type: "process", action: "stop", resource: sandboxId,
                        mutating: true, reversible: true, rollbackPlan: request.rollbackPlan,
                        description: `container_sandbox stop: ${sandboxId}`,
                    }],
                };
            }

            if (action === "destroy") {
                await this.adapter!.destroyContainer(sandboxId, "tool_destroy");
                return {
                    ok: true,
                    output: { sandboxId, destroyed: true, backend: "container-adapter" },
                    sideEffects: [{
                        type: "process", action: "destroy", resource: sandboxId,
                        mutating: true, reversible: false, rollbackPlan: request.rollbackPlan,
                        description: `container_sandbox destroy: ${sandboxId}`,
                    }],
                };
            }

            if (action === "snapshot") {
                const snapshotName = request.args.snapshotId
                    ? String(request.args.snapshotId)
                    : `snapshot-${randomUUID()}`;
                const snapshot = await this.adapter!.snapshotContainer(sandboxId, snapshotName);
                return {
                    ok: true,
                    output: {
                        sandboxId,
                        snapshotId: snapshot.snapshot_id,
                        snapshotName: snapshot.snapshot_name,
                        snapshotSizeMb: snapshot.snapshot_size_mb,
                        backend: "container-adapter",
                    },
                    sideEffects: [{
                        type: "file", action: "snapshot", resource: `${sandboxId}/${snapshot.snapshot_id}`,
                        mutating: true, reversible: true, rollbackPlan: request.rollbackPlan,
                        description: `container_sandbox snapshot: ${sandboxId}/${snapshot.snapshot_id}`,
                    }],
                };
            }

            if (action === "revert") {
                const snapshotId = request.args.snapshotId ? String(request.args.snapshotId) : "";
                if (!snapshotId) {
                    return { ok: false, output: { error: "snapshotId is required for revert." } };
                }
                const reverted = await this.adapter!.revertContainer(sandboxId, snapshotId);
                return {
                    ok: true,
                    output: { sandboxId, revertedTo: snapshotId, state: reverted.state, backend: "container-adapter" },
                    sideEffects: [{
                        type: "process", action: "revert", resource: `${sandboxId}/${snapshotId}`,
                        mutating: true, reversible: false, rollbackPlan: request.rollbackPlan,
                        description: `container_sandbox revert: ${sandboxId}/${snapshotId}`,
                    }],
                };
            }

            if (action === "status") {
                const container = await this.adapter!.getContainerStatus(sandboxId);
                const snapshots = await this.adapter!.listSnapshots(sandboxId);
                return {
                    ok: true,
                    output: {
                        sandboxId,
                        image: container.image,
                        state: container.state,
                        resourceQuota: container.resource_quota,
                        snapshots: snapshots.map(s => s.snapshot_id),
                        createdAt: container.created_at,
                        startedAt: container.started_at ?? null,
                        stoppedAt: container.stopped_at ?? null,
                        backend: "container-adapter",
                    },
                };
            }

            return { ok: false, output: { error: `Unknown container_sandbox action: ${action}` } };
        } catch (adapterErr) {
            const errMsg = adapterErr instanceof Error ? adapterErr.message : String(adapterErr);
            // Adapter operation failed — report error (don't silently fall back for
            // container operations since the user expects real isolation)
            return { ok: false, output: { error: `Container adapter error: ${errMsg}` } };
        }
    }

    // ── In-memory fallback (no filesystem isolation) ─────────────────────

    private async executeInMemory(
        action: string,
        request: ToolRequest,
        sandboxId?: string,
    ): Promise<ToolResult> {
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
                    backend: "in-memory",
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
                output: { sandboxId, state: record.state, updatedAt: record.updatedAt, backend: "in-memory" },
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
                output: { sandboxId, state: record.state, updatedAt: record.updatedAt, backend: "in-memory" },
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
                    backend: "in-memory",
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
                output: { sandboxId, revertedTo: snapshotId, updatedAt: record.updatedAt, backend: "in-memory" },
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
                output: { sandboxId, destroyed: true, backend: "in-memory" },
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
                    backend: "in-memory",
                },
            };
        }

        return {
            ok: false,
            output: { error: `Unknown container_sandbox action: ${action}` },
        };
    }
}
