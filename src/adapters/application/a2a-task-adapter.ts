/**
 * A2ATaskAdapter — Agent-to-Agent (A2A) Protocol task lifecycle
 *
 * Implements the server-side A2A task model:
 *   - Receives task submissions from external A2A callers (Docker Agent, LangGraph, etc.)
 *   - Applies 3-tier governance policy classification to incoming tasks
 *   - Persists task state in SQLite
 *   - Emits ActivityBus events with layer: "agent" for every lifecycle transition
 *
 * Phase F — see docs/A2A_OCI_INTEGRATION_SPEC.md for full spec.
 */

import { randomUUID } from "node:crypto";
import sqlite3 from "sqlite3";
import type { ActivityBus } from "../../core/activity/bus.js";
import type { AuthorityTier } from "../../core/activity/types.js";

// ── Public types ────────────────────────────────────────────────────────────

export interface A2AMessagePart {
    text: string;
}

export interface A2AMessage {
    role: "user" | "agent";
    parts: A2AMessagePart[];
}

export interface A2ATaskRequest {
    /** Optional caller-provided task ID (UUID). A fresh UUID is generated if omitted. */
    id?: string;
    /** Optional caller session correlation ID. */
    sessionId?: string;
    /** The task message from the external caller. */
    message: A2AMessage;
    /** Routing metadata. `characterId` selects which PRISM character handles the task. */
    metadata?: {
        characterId?: string;
        [key: string]: unknown;
    };
}

export type A2ATaskStatus = "submitted" | "working" | "completed" | "failed" | "cancelled";

export interface A2ATask {
    task_id: string;
    session_id: string | null;
    character_id: string;
    status: A2ATaskStatus;
    input_text: string;
    output_text: string | null;
    policy_tier: string | null;
    created_at: string;
    completed_at: string | null;
}

// ── Tier classification ─────────────────────────────────────────────────────

/** Patterns that indicate a destructive / code-execution request (Tier 3). */
const TIER3_PATTERNS: RegExp[] = [
    /\b(delete|remove|drop|rm|truncate|format|wipe|destroy|kill|terminate)\b/i,
    /\b(exec|execute|run|spawn|shell|bash|cmd|powershell|script)\b/i,
    /\b(write|create|modify|update|alter|patch)\s+(file|disk|database|db|table|schema)\b/i,
    /\b(deploy|push|publish|release)\s+(to\s+)?(production|prod|live)\b/i,
];

/** Patterns that indicate a state-reading / conditional request (Tier 2). */
const TIER2_PATTERNS: RegExp[] = [
    /\b(read|list|get|fetch|query|search|find|show|display|analyze|review)\b/i,
    /\b(status|info|describe|summary|report|check)\b/i,
    /\b(http|api|network|request|upload|download)\b/i,
];

function tierToAuthorityTier(tier: "tier1" | "tier2" | "tier3"): AuthorityTier {
    if (tier === "tier3") return "tier3_approval";
    if (tier === "tier2") return "tier2_conditional";
    return "tier1_autonomous";
}

function tierToPolicyLabel(tier: "tier1" | "tier2" | "tier3"): string {
    if (tier === "tier3") return "tier3_approval";
    if (tier === "tier2") return "tier2_conditional";
    return "tier1_autonomous";
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export class A2ATaskAdapter {
    private readonly initializationPromise: Promise<void>;

    constructor(
        private readonly db: sqlite3.Database,
        private readonly activityBus: ActivityBus
    ) {
        this.initializationPromise = this.initializeDatabase();
    }

    // ── Database setup ──────────────────────────────────────────────────────

    private initializeDatabase(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.run(
                `CREATE TABLE IF NOT EXISTS a2a_tasks (
                    task_id       TEXT PRIMARY KEY,
                    session_id    TEXT,
                    character_id  TEXT NOT NULL,
                    status        TEXT NOT NULL,
                    input_text    TEXT NOT NULL,
                    output_text   TEXT,
                    policy_tier   TEXT,
                    created_at    TEXT NOT NULL,
                    completed_at  TEXT,
                    created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,
                (err) => {
                    if (err) { reject(err); return; }
                    this.db.run(
                        `CREATE INDEX IF NOT EXISTS idx_a2a_tasks_status
                         ON a2a_tasks (status)`,
                        (err2) => (err2 ? reject(err2) : resolve())
                    );
                }
            );
        });
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Classify an A2A message into a governance tier.
     * Exposed publicly for use in route handlers and tests.
     */
    classifyTaskTier(message: A2AMessage): "tier1" | "tier2" | "tier3" {
        const text = message.parts.map((p) => p.text).join(" ");
        if (TIER3_PATTERNS.some((p) => p.test(text))) return "tier3";
        if (TIER2_PATTERNS.some((p) => p.test(text))) return "tier2";
        return "tier1";
    }

    /**
     * Submit a new A2A task.
     * Tier 3 tasks are set to "submitted" (awaiting governance approval).
     * Tier 1/2 tasks are set to "working" (ready for LLM dispatch).
     */
    async submitTask(request: A2ATaskRequest): Promise<A2ATask> {
        await this.initializationPromise;

        const task_id = (request.id && request.id.length > 0) ? request.id : randomUUID();
        const character_id = request.metadata?.characterId ?? "aria-individual";
        const input_text = request.message.parts.map((p) => p.text).join("\n");
        const tier = this.classifyTaskTier(request.message);
        const policy_tier = tierToPolicyLabel(tier);

        // Tier-3 tasks stay "submitted" pending governance approval.
        // Tier-1/2 tasks move directly to "working".
        const status: A2ATaskStatus = tier === "tier3" ? "submitted" : "working";
        const created_at = new Date().toISOString();

        const task: A2ATask = {
            task_id,
            session_id: request.sessionId ?? null,
            character_id,
            status,
            input_text,
            output_text: null,
            policy_tier,
            created_at,
            completed_at: null,
        };

        await new Promise<void>((resolve, reject) => {
            this.db.run(
                `INSERT INTO a2a_tasks
                 (task_id, session_id, character_id, status, input_text, output_text, policy_tier, created_at, completed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    task.task_id,
                    task.session_id,
                    task.character_id,
                    task.status,
                    task.input_text,
                    task.output_text,
                    task.policy_tier,
                    task.created_at,
                    task.completed_at,
                ],
                (err) => (err ? reject(err) : resolve())
            );
        });

        this.activityBus.emit({
            sessionId: task_id,
            layer: "agent",
            operation: "a2a_task_received",
            status: "succeeded",
            details: {
                task_id,
                character_id,
                policy_tier,
                input_length: input_text.length,
                a2a_status: status,
            },
            authorityTier: tierToAuthorityTier(tier),
            policyDecision: tier === "tier3" ? "require_approval" : "allow",
        });

        return task;
    }

    /** Retrieve a task by ID. Returns null if not found. */
    async getTask(taskId: string): Promise<A2ATask | null> {
        await this.initializationPromise;
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT task_id, session_id, character_id, status, input_text, output_text,
                         policy_tier, created_at, completed_at
                 FROM a2a_tasks WHERE task_id = ?`,
                [taskId],
                (err, row: A2ATask | undefined) => {
                    if (err) { reject(err); return; }
                    resolve(row ?? null);
                }
            );
        });
    }

    /**
     * Cancel a task.
     * No-ops if the task is already in a terminal state (completed/failed/cancelled).
     * Returns the updated task (or null if task_id not found).
     */
    async cancelTask(taskId: string): Promise<A2ATask | null> {
        await this.initializationPromise;
        const task = await this.getTask(taskId);
        if (!task) return null;

        // Already terminal — return as-is
        if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
            return task;
        }

        const completed_at = new Date().toISOString();
        await new Promise<void>((resolve, reject) => {
            this.db.run(
                `UPDATE a2a_tasks SET status = 'cancelled', completed_at = ? WHERE task_id = ?`,
                [completed_at, taskId],
                (err) => (err ? reject(err) : resolve())
            );
        });

        this.activityBus.emit({
            sessionId: taskId,
            layer: "agent",
            operation: "a2a_task_cancelled",
            status: "succeeded",
            details: { task_id: taskId, character_id: task.character_id },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow",
        });

        return { ...task, status: "cancelled", completed_at };
    }

    /**
     * Mark a task as completed with an output.
     * Called internally after successful LLM dispatch.
     */
    async completeTask(taskId: string, outputText: string): Promise<void> {
        await this.initializationPromise;
        const completed_at = new Date().toISOString();
        await new Promise<void>((resolve, reject) => {
            this.db.run(
                `UPDATE a2a_tasks SET status = 'completed', output_text = ?, completed_at = ? WHERE task_id = ?`,
                [outputText, completed_at, taskId],
                (err) => (err ? reject(err) : resolve())
            );
        });

        this.activityBus.emit({
            sessionId: taskId,
            layer: "agent",
            operation: "a2a_task_completed",
            status: "succeeded",
            details: { task_id: taskId, output_length: outputText.length },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow",
        });
    }

    /**
     * Mark a task as failed.
     * Called if LLM dispatch or governance evaluation fails.
     */
    async failTask(taskId: string, errorMessage: string): Promise<void> {
        await this.initializationPromise;
        const completed_at = new Date().toISOString();
        await new Promise<void>((resolve, reject) => {
            this.db.run(
                `UPDATE a2a_tasks SET status = 'failed', output_text = ?, completed_at = ? WHERE task_id = ?`,
                [errorMessage, completed_at, taskId],
                (err) => (err ? reject(err) : resolve())
            );
        });

        this.activityBus.emit({
            sessionId: taskId,
            layer: "agent",
            operation: "a2a_task_failed",
            status: "failed",
            details: { task_id: taskId, error: errorMessage },
            authorityTier: "tier1_autonomous",
            policyDecision: "deny",
        });
    }
}
