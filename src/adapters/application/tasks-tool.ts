/**
 * Tasks Timeline Adapter — file-backed task list management tool.
 *
 * Timeline data is stored as JSON in {dataDir}/tasks/{timelineId}.json.
 * The data directory defaults to prism-data/ and is overridable via PRISM_DATA_DIR.
 *
 * Operations (action arg):
 *   plan    — read timeline, return tasks sorted by priority then due date (read-only)
 *   commit  — mark timeline as committed, record committedAt timestamp
 *   replan  — clear committed flag, re-sort tasks by priority/due for revision
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Data types
// ──────────────────────────────────────────────────────────────────────────────

export type TaskPriority = "high" | "medium" | "low";

export interface Task {
    id: string;
    title: string;
    due?: string;
    priority: TaskPriority;
    completed: boolean;
    addedAt: string;
}

export interface TaskTimeline {
    timelineId: string;
    committed: boolean;
    committedAt?: string;
    tasks: Task[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

import { workspaceDataDir } from "../../core/config/workspace-resolver.js";

function dataDir(): string {
    return join(process.env.PRISM_DATA_DIR ?? workspaceDataDir(), "tasks");
}

function timelinePath(dir: string, timelineId: string): string {
    return join(dir, `${timelineId}.json`);
}

function loadTimeline(dir: string, timelineId: string): TaskTimeline {
    const path = timelinePath(dir, timelineId);
    if (!existsSync(path)) {
        return { timelineId, committed: false, tasks: [] };
    }
    return JSON.parse(readFileSync(path, "utf-8")) as TaskTimeline;
}

function saveTimeline(dir: string, tl: TaskTimeline): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(timelinePath(dir, tl.timelineId), JSON.stringify(tl, null, 2), "utf-8");
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

function sortTasks(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
        const pDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (pDiff !== 0) return pDiff;
        // Secondary: due date ascending (missing due goes last)
        if (!a.due && !b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// Tool
// ──────────────────────────────────────────────────────────────────────────────

export class TasksTimelineTool implements Tool {
    readonly name = "tasks_timeline";

    constructor(private readonly _dataDir?: string) { }

    async execute(request: ToolRequest): Promise<ToolResult> {
        const args = request.args as {
            action?: string;
            timelineId?: string;
            /** For plan/replan: optional list of tasks to add to the timeline */
            tasks?: Array<{ title: string; due?: string; priority?: TaskPriority }>;
        };

        const action = args.action ?? "";
        const timelineId = args.timelineId ?? "timeline-default";
        const dir = this._dataDir ?? dataDir();

        switch (action) {
            case "plan": {
                const tl = loadTimeline(dir, timelineId);
                // Merge any incoming tasks before returning the sorted plan
                if (args.tasks && args.tasks.length > 0) {
                    for (const t of args.tasks) {
                        tl.tasks.push({
                            id: randomUUID(),
                            title: t.title,
                            ...(t.due ? { due: t.due } : {}),
                            priority: t.priority ?? "medium",
                            completed: false,
                            addedAt: new Date().toISOString(),
                        });
                    }
                    saveTimeline(dir, tl);
                }
                const sorted = sortTasks(tl.tasks);
                return {
                    ok: true,
                    output: {
                        timelineId,
                        committed: tl.committed,
                        taskCount: sorted.length,
                        pendingCount: sorted.filter((t) => !t.completed).length,
                        tasks: sorted,
                    },
                };
            }

            case "commit": {
                const tl = loadTimeline(dir, timelineId);
                tl.committed = true;
                tl.committedAt = new Date().toISOString();
                tl.tasks = sortTasks(tl.tasks);
                saveTimeline(dir, tl);
                return {
                    ok: true,
                    output: {
                        timelineId,
                        committed: true,
                        committedAt: tl.committedAt,
                        taskCount: tl.tasks.length,
                    },
                    sideEffects: [{ type: "file", description: `timeline committed: ${timelinePath(dir, timelineId)}` }],
                };
            }

            case "replan": {
                const tl = loadTimeline(dir, timelineId);
                tl.committed = false;
                delete tl.committedAt;
                // Append any new tasks provided for replanning
                if (args.tasks && args.tasks.length > 0) {
                    for (const t of args.tasks) {
                        tl.tasks.push({
                            id: randomUUID(),
                            title: t.title,
                            ...(t.due ? { due: t.due } : {}),
                            priority: t.priority ?? "medium",
                            completed: false,
                            addedAt: new Date().toISOString(),
                        });
                    }
                }
                tl.tasks = sortTasks(tl.tasks);
                saveTimeline(dir, tl);
                return {
                    ok: true,
                    output: {
                        timelineId,
                        committed: false,
                        taskCount: tl.tasks.length,
                        tasks: tl.tasks,
                    },
                    sideEffects: [{ type: "file", description: `timeline replanned: ${timelinePath(dir, timelineId)}` }],
                };
            }

            default:
                return { ok: false, output: { error: `Unknown tasks action: ${action}` } };
        }
    }
}
