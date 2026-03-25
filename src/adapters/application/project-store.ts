/**
 * Project Store — file-backed project & milestone management.
 *
 * Project data is stored as JSON in {dataDir}/projects/{projectId}.json.
 * Links to existing calendar and task timeline stores for unified scheduling.
 *
 * Operations (action arg):
 *   list_projects       — list all projects (read-only)
 *   get_project         — get single project with milestones
 *   create_project      — create new project
 *   update_project      — update project fields
 *   delete_project      — remove project
 *   create_milestone    — add milestone to project
 *   update_milestone    — update milestone fields
 *   delete_milestone    — remove milestone from project
 *   dashboard           — aggregated dashboard data (overdue, upcoming, progress)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";
import { workspaceDataDir } from "../../core/config/workspace-resolver.js";

// ──────────────────────────────────────────────────────────────────────────────
// Data types
// ──────────────────────────────────────────────────────────────────────────────

export type ProjectStatus = "planning" | "active" | "on-hold" | "complete" | "archived";
export type MilestoneStatus = "pending" | "in-progress" | "complete" | "missed";
export type TaskStatus = "backlog" | "todo" | "in-progress" | "review" | "done";

export interface Milestone {
    id: string;
    title: string;
    description?: string;
    dueDate?: string;
    status: MilestoneStatus;
    color?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ProjectTask {
    id: string;
    title: string;
    description?: string;
    status: TaskStatus;
    priority: "high" | "medium" | "low";
    assignee?: string;
    labels?: string[];
    parentId?: string;
    dependencies?: string[];
    milestoneId?: string;
    startDate?: string;
    endDate?: string;
    estimatedHours?: number;
    actualHours?: number;
    progress: number;
    createdAt: string;
    updatedAt: string;
}

export interface Project {
    id: string;
    title: string;
    description?: string;
    status: ProjectStatus;
    milestones: Milestone[];
    tasks: ProjectTask[];
    calendarId?: string;
    createdAt: string;
    updatedAt: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function projectDataDir(): string {
    return join(process.env.PRISM_DATA_DIR ?? workspaceDataDir(), "projects");
}

function projectPath(dir: string, projectId: string): string {
    return join(dir, `${projectId}.json`);
}

function loadProject(dir: string, projectId: string): Project | null {
    const path = projectPath(dir, projectId);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as Project;
}

function saveProject(dir: string, project: Project): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(projectPath(dir, project.id), JSON.stringify(project, null, 2), "utf-8");
}

function listAllProjects(dir: string): Project[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
            try {
                return JSON.parse(readFileSync(join(dir, f), "utf-8")) as Project;
            } catch {
                return null;
            }
        })
        .filter((p): p is Project => p !== null);
}

// ──────────────────────────────────────────────────────────────────────────────
// Tool
// ──────────────────────────────────────────────────────────────────────────────

export class ProjectStoreTool implements Tool {
    readonly name = "project_store";

    constructor(private readonly _dataDir?: string) {}

    private dir(): string {
        return this._dataDir ?? projectDataDir();
    }

    async execute(request: ToolRequest): Promise<ToolResult> {
        const args = request.args as Record<string, unknown>;
        const action = (args.action as string) ?? "";
        const dir = this.dir();

        switch (action) {
            case "list_projects": {
                const projects = listAllProjects(dir);
                return {
                    ok: true,
                    output: {
                        projectCount: projects.length,
                        projects: projects.map((p) => ({
                            id: p.id,
                            title: p.title,
                            status: p.status,
                            milestoneCount: p.milestones.length,
                            taskCount: p.tasks.length,
                            completedTasks: p.tasks.filter((t) => t.status === "done").length,
                            updatedAt: p.updatedAt,
                        })),
                    },
                };
            }

            case "get_project": {
                const projectId = args.projectId as string;
                if (!projectId) return { ok: false, output: { error: "projectId required" } };
                const project = loadProject(dir, projectId);
                if (!project) return { ok: false, output: { error: `Project not found: ${projectId}` } };
                return { ok: true, output: { ...project } as Record<string, unknown> };
            }

            case "create_project": {
                const now = new Date().toISOString();
                const project: Project = {
                    id: randomUUID(),
                    title: (args.title as string) ?? "Untitled Project",
                    description: args.description as string | undefined,
                    status: "planning",
                    milestones: [],
                    tasks: [],
                    calendarId: args.calendarId as string | undefined,
                    createdAt: now,
                    updatedAt: now,
                };
                saveProject(dir, project);
                return {
                    ok: true,
                    output: { ...project } as Record<string, unknown>,
                    sideEffects: [{ type: "file", description: `project created: ${projectPath(dir, project.id)}` }],
                };
            }

            case "update_project": {
                const projectId = args.projectId as string;
                if (!projectId) return { ok: false, output: { error: "projectId required" } };
                const project = loadProject(dir, projectId);
                if (!project) return { ok: false, output: { error: `Project not found: ${projectId}` } };
                if (args.title) project.title = args.title as string;
                if (args.description !== undefined) project.description = args.description as string;
                if (args.status) project.status = args.status as ProjectStatus;
                project.updatedAt = new Date().toISOString();
                saveProject(dir, project);
                return {
                    ok: true,
                    output: { ...project } as Record<string, unknown>,
                    sideEffects: [{ type: "file", description: `project updated: ${projectPath(dir, project.id)}` }],
                };
            }

            case "delete_project": {
                const projectId = args.projectId as string;
                if (!projectId) return { ok: false, output: { error: "projectId required" } };
                const path = projectPath(dir, projectId);
                if (!existsSync(path)) return { ok: false, output: { error: `Project not found: ${projectId}` } };
                unlinkSync(path);
                return {
                    ok: true,
                    output: { deleted: projectId },
                    sideEffects: [{ type: "file", description: `project deleted: ${path}` }],
                };
            }

            case "create_milestone": {
                const projectId = args.projectId as string;
                if (!projectId) return { ok: false, output: { error: "projectId required" } };
                const project = loadProject(dir, projectId);
                if (!project) return { ok: false, output: { error: `Project not found: ${projectId}` } };
                const now = new Date().toISOString();
                const milestone: Milestone = {
                    id: randomUUID(),
                    title: (args.title as string) ?? "Untitled Milestone",
                    description: args.description as string | undefined,
                    dueDate: args.dueDate as string | undefined,
                    status: "pending",
                    color: args.color as string | undefined,
                    createdAt: now,
                    updatedAt: now,
                };
                project.milestones.push(milestone);
                project.updatedAt = now;
                saveProject(dir, project);
                return {
                    ok: true,
                    output: { ...milestone } as Record<string, unknown>,
                    sideEffects: [{ type: "file", description: `milestone created in project ${projectId}` }],
                };
            }

            case "update_milestone": {
                const projectId = args.projectId as string;
                const milestoneId = args.milestoneId as string;
                if (!projectId || !milestoneId) return { ok: false, output: { error: "projectId and milestoneId required" } };
                const project = loadProject(dir, projectId);
                if (!project) return { ok: false, output: { error: `Project not found: ${projectId}` } };
                const milestone = project.milestones.find((m) => m.id === milestoneId);
                if (!milestone) return { ok: false, output: { error: `Milestone not found: ${milestoneId}` } };
                if (args.title) milestone.title = args.title as string;
                if (args.description !== undefined) milestone.description = args.description as string;
                if (args.dueDate !== undefined) milestone.dueDate = args.dueDate as string;
                if (args.status) milestone.status = args.status as MilestoneStatus;
                if (args.color !== undefined) milestone.color = args.color as string;
                milestone.updatedAt = new Date().toISOString();
                project.updatedAt = milestone.updatedAt;
                saveProject(dir, project);
                return {
                    ok: true,
                    output: { ...milestone } as Record<string, unknown>,
                    sideEffects: [{ type: "file", description: `milestone updated in project ${projectId}` }],
                };
            }

            case "delete_milestone": {
                const projectId = args.projectId as string;
                const milestoneId = args.milestoneId as string;
                if (!projectId || !milestoneId) return { ok: false, output: { error: "projectId and milestoneId required" } };
                const project = loadProject(dir, projectId);
                if (!project) return { ok: false, output: { error: `Project not found: ${projectId}` } };
                const idx = project.milestones.findIndex((m) => m.id === milestoneId);
                if (idx < 0) return { ok: false, output: { error: `Milestone not found: ${milestoneId}` } };
                project.milestones.splice(idx, 1);
                project.updatedAt = new Date().toISOString();
                saveProject(dir, project);
                return {
                    ok: true,
                    output: { deleted: milestoneId },
                    sideEffects: [{ type: "file", description: `milestone deleted from project ${projectId}` }],
                };
            }

            case "create_task": {
                const projectId = args.projectId as string;
                if (!projectId) return { ok: false, output: { error: "projectId required" } };
                const project = loadProject(dir, projectId);
                if (!project) return { ok: false, output: { error: `Project not found: ${projectId}` } };
                const now = new Date().toISOString();
                const task: ProjectTask = {
                    id: randomUUID(),
                    title: (args.title as string) ?? "Untitled Task",
                    description: args.description as string | undefined,
                    status: (args.status as TaskStatus) ?? "backlog",
                    priority: (args.priority as "high" | "medium" | "low") ?? "medium",
                    assignee: args.assignee as string | undefined,
                    labels: (args.labels as string[]) ?? [],
                    parentId: args.parentId as string | undefined,
                    dependencies: (args.dependencies as string[]) ?? [],
                    milestoneId: args.milestoneId as string | undefined,
                    startDate: args.startDate as string | undefined,
                    endDate: args.endDate as string | undefined,
                    estimatedHours: args.estimatedHours as number | undefined,
                    progress: 0,
                    createdAt: now,
                    updatedAt: now,
                };
                project.tasks.push(task);
                project.updatedAt = now;
                saveProject(dir, project);
                return {
                    ok: true,
                    output: { ...task } as Record<string, unknown>,
                    sideEffects: [{ type: "file", description: `task created in project ${projectId}` }],
                };
            }

            case "update_task": {
                const projectId = args.projectId as string;
                const taskId = args.taskId as string;
                if (!projectId || !taskId) return { ok: false, output: { error: "projectId and taskId required" } };
                const project = loadProject(dir, projectId);
                if (!project) return { ok: false, output: { error: `Project not found: ${projectId}` } };
                const task = project.tasks.find((t) => t.id === taskId);
                if (!task) return { ok: false, output: { error: `Task not found: ${taskId}` } };
                if (args.title) task.title = args.title as string;
                if (args.description !== undefined) task.description = args.description as string;
                if (args.status) task.status = args.status as TaskStatus;
                if (args.priority) task.priority = args.priority as "high" | "medium" | "low";
                if (args.assignee !== undefined) task.assignee = args.assignee as string;
                if (args.labels) task.labels = args.labels as string[];
                if (args.parentId !== undefined) task.parentId = args.parentId as string;
                if (args.dependencies) task.dependencies = args.dependencies as string[];
                if (args.milestoneId !== undefined) task.milestoneId = args.milestoneId as string;
                if (args.startDate !== undefined) task.startDate = args.startDate as string;
                if (args.endDate !== undefined) task.endDate = args.endDate as string;
                if (args.estimatedHours !== undefined) task.estimatedHours = args.estimatedHours as number;
                if (args.actualHours !== undefined) task.actualHours = args.actualHours as number;
                if (args.progress !== undefined) task.progress = Math.max(0, Math.min(100, args.progress as number));
                task.updatedAt = new Date().toISOString();
                project.updatedAt = task.updatedAt;
                saveProject(dir, project);
                return {
                    ok: true,
                    output: { ...task } as Record<string, unknown>,
                    sideEffects: [{ type: "file", description: `task updated in project ${projectId}` }],
                };
            }

            case "delete_task": {
                const projectId = args.projectId as string;
                const taskId = args.taskId as string;
                if (!projectId || !taskId) return { ok: false, output: { error: "projectId and taskId required" } };
                const project = loadProject(dir, projectId);
                if (!project) return { ok: false, output: { error: `Project not found: ${projectId}` } };
                const idx = project.tasks.findIndex((t) => t.id === taskId);
                if (idx < 0) return { ok: false, output: { error: `Task not found: ${taskId}` } };
                project.tasks.splice(idx, 1);
                project.updatedAt = new Date().toISOString();
                saveProject(dir, project);
                return {
                    ok: true,
                    output: { deleted: taskId },
                    sideEffects: [{ type: "file", description: `task deleted from project ${projectId}` }],
                };
            }

            case "dashboard": {
                const projects = listAllProjects(dir);
                const now = new Date();
                const allTasks = projects.flatMap((p) => p.tasks.map((t) => ({ ...t, projectId: p.id, projectTitle: p.title })));
                const allMilestones = projects.flatMap((p) => p.milestones.map((m) => ({ ...m, projectId: p.id, projectTitle: p.title })));
                const overdueTasks = allTasks.filter(
                    (t) => t.endDate && new Date(t.endDate) < now && t.status !== "done",
                );
                const upcomingMilestones = allMilestones
                    .filter((m) => m.dueDate && new Date(m.dueDate) >= now && m.status !== "complete")
                    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
                    .slice(0, 5);
                const tasksByStatus: Record<string, number> = {};
                for (const t of allTasks) {
                    tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1;
                }
                return {
                    ok: true,
                    output: {
                        projectCount: projects.length,
                        totalTasks: allTasks.length,
                        tasksByStatus,
                        overdueTasks: overdueTasks.slice(0, 10),
                        upcomingMilestones,
                        activeProjects: projects.filter((p) => p.status === "active").length,
                    },
                };
            }

            default:
                return { ok: false, output: { error: `Unknown project_store action: ${action}` } };
        }
    }
}
