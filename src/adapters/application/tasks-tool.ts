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
 *   update_status — update a task's status field by task id
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Data types
// ──────────────────────────────────────────────────────────────────────────────

export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus = "backlog" | "todo" | "in-progress" | "review" | "done";

export interface Task {
    id: string;
    title: string;
    due?: string;
    priority: TaskPriority;
    completed: boolean;
    addedAt: string;
    status?: TaskStatus;
    assignee?: string;
    labels?: string[];
    parentId?: string;
    dependencies?: string[];
    milestoneId?: string;
    startDate?: string;
    endDate?: string;
    estimatedHours?: number;
    actualHours?: number;
    progress?: number;
    projectId?: string;
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
            taskId?: string;
            status?: TaskStatus;
            assignee?: string;
            progress?: number;
            /** For plan/replan: optional list of tasks to add to the timeline */
            tasks?: Array<{ title: string; due?: string; priority?: TaskPriority; status?: TaskStatus; assignee?: string; labels?: string[]; startDate?: string; endDate?: string; estimatedHours?: number; milestoneId?: string; projectId?: string; dependencies?: string[] }>;
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
                            status: t.status ?? "backlog",
                            ...(t.assignee ? { assignee: t.assignee } : {}),
                            ...(t.labels ? { labels: t.labels } : {}),
                            ...(t.startDate ? { startDate: t.startDate } : {}),
                            ...(t.endDate ? { endDate: t.endDate } : {}),
                            ...(t.estimatedHours ? { estimatedHours: t.estimatedHours } : {}),
                            ...(t.milestoneId ? { milestoneId: t.milestoneId } : {}),
                            ...(t.projectId ? { projectId: t.projectId } : {}),
                            ...(t.dependencies ? { dependencies: t.dependencies } : {}),
                            progress: 0,
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
                            status: t.status ?? "backlog",
                            ...(t.assignee ? { assignee: t.assignee } : {}),
                            ...(t.labels ? { labels: t.labels } : {}),
                            ...(t.startDate ? { startDate: t.startDate } : {}),
                            ...(t.endDate ? { endDate: t.endDate } : {}),
                            ...(t.estimatedHours ? { estimatedHours: t.estimatedHours } : {}),
                            ...(t.milestoneId ? { milestoneId: t.milestoneId } : {}),
                            ...(t.projectId ? { projectId: t.projectId } : {}),
                            ...(t.dependencies ? { dependencies: t.dependencies } : {}),
                            progress: 0,
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

            case "update_status": {
                const tl = loadTimeline(dir, timelineId);
                const taskId = args.taskId;
                if (!taskId) return { ok: false, output: { error: "taskId required" } };
                const task = tl.tasks.find((t) => t.id === taskId);
                if (!task) return { ok: false, output: { error: `Task not found: ${taskId}` } };
                if (args.status) { task.status = args.status; task.completed = args.status === "done"; }
                if (args.assignee !== undefined) task.assignee = args.assignee;
                if (args.progress !== undefined) task.progress = Math.max(0, Math.min(100, args.progress));
                saveTimeline(dir, tl);
                return {
                    ok: true,
                    output: { timelineId, task },
                    sideEffects: [{ type: "file", description: `task updated: ${timelinePath(dir, timelineId)}` }],
                };
            }

            default:
                return { ok: false, output: { error: `Unknown tasks action: ${action}` } };
        }
    }
}
