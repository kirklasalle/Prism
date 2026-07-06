import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { workspacePath } from "../../config/workspace-resolver.js";
import { parseCronExpression, getNextNCronOccurrences } from "../scheduler-engine.js";
import type { DashboardService } from "../dashboard-service.js";
import type { IRouteHandler } from "./types.js";

export class SchedulerHandler implements IRouteHandler {
    private initialized = false;

    match(req: IncomingMessage): boolean {
        const url = req.url ?? "";
        return url.startsWith("/api/scheduler/");
    }

    private initPersistence(service: DashboardService) {
        if (this.initialized) return;
        this.initialized = true;
        if (service.status.environmentProfile === "test" || process.env.NODE_ENV === "test") {
            return;
        }
        try {
            const eventsPath = workspacePath("state", "scheduler_events.json");
            const projectsPath = workspacePath("state", "scheduler_projects.json");

            if (existsSync(eventsPath)) {
                const data = JSON.parse(readFileSync(eventsPath, "utf-8"));
                const map = service.getSchedulerEvents();
                map.clear();
                for (const item of data) {
                    map.set(item.id, item);
                }
            }
            if (existsSync(projectsPath)) {
                const data = JSON.parse(readFileSync(projectsPath, "utf-8"));
                const map = service.getSchedulerProjects();
                map.clear();
                for (const item of data) {
                    map.set(item.id, item);
                }
            }
        } catch (err) {
            console.error("[SchedulerHandler] Failed to load persisted data:", err);
        }
    }

    private savePersistence(service: DashboardService) {
        if (service.status.environmentProfile === "test" || process.env.NODE_ENV === "test") {
            return;
        }
        try {
            const eventsPath = workspacePath("state", "scheduler_events.json");
            const projectsPath = workspacePath("state", "scheduler_projects.json");

            const events = [...service.getSchedulerEvents().values()];
            const projects = [...service.getSchedulerProjects().values()];

            writeFileSync(eventsPath, JSON.stringify(events, null, 2), "utf-8");
            writeFileSync(projectsPath, JSON.stringify(projects, null, 2), "utf-8");
        } catch (err) {
            console.error("[SchedulerHandler] Failed to save persisted data:", err);
        }
    }

    async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        this.initPersistence(service);

        const rawUrl = req.url ?? "";
        const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
        const method = req.method?.toUpperCase() ?? "GET";

        const schedulerEvents = service.getSchedulerEvents();
        const schedulerProjects = service.getSchedulerProjects();
        const schedulerEngine = service.getSchedulerEngine();

        const triggerTabSwitch = () => {
            service.broadcastEvent({ type: "ui_action", action: "switch_tab", tabId: "scheduler" });
        };

        // ── Events ──────────────────────────────────────────────────────────

        if (method === "GET" && url.startsWith("/api/scheduler/events")) {
            const qs = new URL(url, "http://localhost").searchParams;
            const startFilter = qs.get("start") || "";
            const endFilter = qs.get("end") || "";
            let events = [...schedulerEvents.values()];
            if (startFilter) events = events.filter((e) => (e.end || e.start) >= startFilter);
            if (endFilter) events = events.filter((e) => e.start <= endFilter);
            return this.json(res, 200, { events });
        }

        if (method === "POST" && url === "/api/scheduler/events") {
            const body = await service.readJsonBody<{
                id?: string;
                eventId?: string;
                title?: string;
                start?: string;
                end?: string;
                description?: string;
                startTime?: string;
                endTime?: string;
            }>(req);
            if (!body.title || !body.start) return this.json(res, 400, { error: "title and start are required" });
            triggerTabSwitch();
            const id = body.eventId || body.id || randomUUID();
            const evt = {
                id,
                title: body.title,
                start: body.start,
                end: body.end,
                description: body.description,
                startTime: body.startTime,
                endTime: body.endTime,
                createdAt: new Date().toISOString(),
            };
            schedulerEvents.set(id, evt);
            this.savePersistence(service);
            return this.json(res, 200, { event: evt });
        }

        const eventDetailMatch = /^\/api\/scheduler\/events\/([^/?]+)$/.exec(url);
        if (eventDetailMatch) {
            const eventId = decodeURIComponent(eventDetailMatch[1]!);

            if (method === "PUT") {
                const body = await service.readJsonBody<{
                    title?: string;
                    start?: string;
                    end?: string;
                    description?: string;
                    startTime?: string;
                    endTime?: string;
                }>(req);
                if (!body.title || !body.start) return this.json(res, 400, { error: "title and start are required" });
                triggerTabSwitch();
                const existing = schedulerEvents.get(eventId);
                if (!existing) return this.json(res, 404, { error: "Event not found" });

                const updated = {
                    ...existing,
                    title: body.title,
                    start: body.start,
                    end: body.end,
                    description: body.description,
                    startTime: body.startTime,
                    endTime: body.endTime,
                };
                schedulerEvents.set(eventId, updated);
                this.savePersistence(service);
                return this.json(res, 200, { event: updated });
            }

            if (method === "DELETE") {
                triggerTabSwitch();
                if (!schedulerEvents.has(eventId)) return this.json(res, 404, { error: "Event not found" });
                schedulerEvents.delete(eventId);
                this.savePersistence(service);
                return this.json(res, 200, { ok: true });
            }
        }

        // ── Projects ─────────────────────────────────────────────────────────

        if (method === "GET" && url === "/api/scheduler/projects") {
            const projects = [...schedulerProjects.values()];
            return this.json(res, 200, { projects });
        }

        const projectDetailMatch = /^\/api\/scheduler\/projects\/([^/?]+)$/.exec(url);
        if (projectDetailMatch) {
            const pid = decodeURIComponent(projectDetailMatch[1]!);

            if (method === "GET") {
                const project = schedulerProjects.get(pid);
                if (!project) return this.json(res, 404, { error: "Project not found" });
                return this.json(res, 200, { project });
            }

            if (method === "DELETE") {
                triggerTabSwitch();
                if (!schedulerProjects.has(pid)) return this.json(res, 404, { error: "Project not found" });
                schedulerProjects.delete(pid);
                this.savePersistence(service);
                return this.json(res, 200, { ok: true });
            }
        }

        if (method === "POST" && url === "/api/scheduler/projects") {
            const body = await service.readJsonBody<{ name?: string; description?: string }>(req);
            if (!body.name) return this.json(res, 400, { error: "name is required" });
            triggerTabSwitch();
            const id = randomUUID();
            const project = {
                id,
                name: body.name,
                description: body.description,
                tasks: [] as Array<{
                    id: string;
                    title: string;
                    status: string;
                    assignee?: string;
                    startDate?: string;
                    endDate?: string;
                    dueDate?: string;
                    createdAt: string;
                }>,
                milestones: [] as Array<{ title: string; dueDate?: string }>,
                createdAt: new Date().toISOString(),
            };
            schedulerProjects.set(id, project);
            this.savePersistence(service);
            return this.json(res, 200, { project });
        }

        // ── Tasks ────────────────────────────────────────────────────────────

        if (method === "GET" && url === "/api/scheduler/tasks") {
            const tasks: Array<Record<string, unknown>> = [];
            for (const p of schedulerProjects.values()) {
                for (const t of p.tasks) tasks.push({ ...t, projectId: p.id, projectName: p.name });
            }
            return this.json(res, 200, { tasks });
        }

        if (method === "POST" && url === "/api/scheduler/tasks") {
            const body = await service.readJsonBody<{
                title?: string;
                projectId?: string;
                status?: string;
                assignee?: string;
                startDate?: string;
                endDate?: string;
                dueDate?: string;
            }>(req);
            if (!body.title) return this.json(res, 400, { error: "title is required" });
            if (!body.projectId) return this.json(res, 400, { error: "Project ID is required" });
            triggerTabSwitch();
            const task = {
                id: randomUUID(),
                title: body.title,
                status: body.status || "backlog",
                assignee: body.assignee,
                startDate: body.startDate,
                endDate: body.endDate,
                dueDate: body.dueDate,
                createdAt: new Date().toISOString(),
            };
            const project = schedulerProjects.get(body.projectId);
            if (project) {
                project.tasks.push(task);
            } else {
                return this.json(res, 404, { error: "Project not found" });
            }
            this.savePersistence(service);
            return this.json(res, 200, { task });
        }

        const taskUpdateMatch = /^\/api\/scheduler\/tasks\/([^/?]+)/.exec(url);
        if (taskUpdateMatch) {
            const taskId = decodeURIComponent(taskUpdateMatch[1]!);
            const qs = new URL(url, "http://localhost").searchParams;
            const projectId = qs.get("projectId") || "";

            if (method === "PUT") {
                const body = await service.readJsonBody<{
                    status?: string;
                    title?: string;
                    assignee?: string;
                    startDate?: string;
                    endDate?: string;
                    dueDate?: string;
                }>(req);
                triggerTabSwitch();
                let found = false;
                for (const p of schedulerProjects.values()) {
                    if (projectId && p.id !== projectId) continue;
                    const task = p.tasks.find((t: any) => t.id === taskId);
                    if (task) {
                        if (body.status) task.status = body.status;
                        if (body.title) task.title = body.title;
                        if (body.assignee !== undefined) task.assignee = body.assignee;
                        if (body.startDate !== undefined) task.startDate = body.startDate;
                        if (body.endDate !== undefined) task.endDate = body.endDate;
                        if (body.dueDate !== undefined) task.dueDate = body.dueDate;
                        found = true;
                        break;
                    }
                }
                if (!found) return this.json(res, 404, { error: "Task not found" });
                this.savePersistence(service);
                return this.json(res, 200, { ok: true });
            }

            if (method === "DELETE") {
                triggerTabSwitch();
                let found = false;
                for (const p of schedulerProjects.values()) {
                    if (projectId && p.id !== projectId) continue;
                    const index = p.tasks.findIndex((t: any) => t.id === taskId);
                    if (index !== -1) {
                        p.tasks.splice(index, 1);
                        found = true;
                        break;
                    }
                }
                if (!found) return this.json(res, 404, { error: "Task not found" });
                this.savePersistence(service);
                return this.json(res, 200, { ok: true });
            }
        }

        // ── Cron Jobs ────────────────────────────────────────────────────────

        if (method === "GET" && url === "/api/scheduler/cron") {
            const jobs = schedulerEngine.list().map((e) => ({
                ...e,
                nextOccurrences: e.cronExpression
                    ? getNextNCronOccurrences(e.cronExpression, 3).map((d) => d.toISOString())
                    : [],
            }));
            return this.json(res, 200, jobs);
        }

        if (method === "POST" && url === "/api/scheduler/cron") {
            const body = await service.readJsonBody<{
                label?: string;
                type?: string;
                cronExpression?: string;
                runAt?: string;
                action?: string;
                payload?: Record<string, unknown>;
            }>(req);
            if (!body.label || !body.action) {
                return this.json(res, 400, { error: "label and action are required" });
            }
            triggerTabSwitch();
            try {
                let entry;
                if (body.type === "once") {
                    if (!body.runAt) {
                        return this.json(res, 400, { error: "runAt is required for one-time jobs" });
                    }
                    entry = schedulerEngine.scheduleOnce(body.label, body.runAt, body.action, body.payload);
                } else {
                    if (!body.cronExpression) {
                        return this.json(res, 400, { error: "cronExpression is required for recurring jobs" });
                    }
                    parseCronExpression(body.cronExpression);
                    entry = schedulerEngine.scheduleRecurring(
                        body.label,
                        body.cronExpression,
                        body.action,
                        body.payload,
                    );
                }
                service.broadcastEvent({ type: "scheduler:cron-created", id: entry.id, label: entry.label });
                return this.json(res, 201, { job: entry });
            } catch (err: any) {
                return this.json(res, 400, { error: "Invalid cron expression: " + (err?.message || String(err)) });
            }
        }

        if (method === "POST" && url === "/api/scheduler/cron/validate") {
            const body = await service.readJsonBody<{ cronExpression?: string }>(req);
            if (!body.cronExpression) {
                return this.json(res, 400, { valid: false, error: "cronExpression is required" });
            }
            try {
                const fields = parseCronExpression(body.cronExpression);
                const nextDates = getNextNCronOccurrences(body.cronExpression, 5).map((d) => d.toISOString());
                return this.json(res, 200, { valid: true, fields, nextDates });
            } catch (err: any) {
                return this.json(res, 200, { valid: false, error: err?.message || String(err) });
            }
        }

        // /api/scheduler/cron/:id and /api/scheduler/cron/:id/preview
        const cronIdMatch = /^\/api\/scheduler\/cron\/([^/?]+)(\/preview)?$/.exec(url);
        if (cronIdMatch) {
            const cronId = decodeURIComponent(cronIdMatch[1]!);
            const isPreview = !!cronIdMatch[2];

            if (isPreview && method === "GET") {
                const entry = schedulerEngine.get(cronId);
                if (!entry) return this.json(res, 404, { error: "Cron job not found" });
                const nextOccurrences = schedulerEngine.getNextOccurrences(cronId, 10).map((d) => d.toISOString());
                return this.json(res, 200, { ...entry, nextOccurrences });
            }

            if (!isPreview && method === "DELETE") {
                triggerTabSwitch();
                const removed = schedulerEngine.cancel(cronId);
                if (!removed) return this.json(res, 404, { error: "Cron job not found" });
                service.broadcastEvent({ type: "scheduler:cron-cancelled", id: cronId });
                return this.json(res, 200, { ok: true });
            }
        }

        // No matching scheduler route
        this.json(res, 404, { error: "Scheduler route not found" });
    }

    private json(res: ServerResponse, status: number, body: unknown): void {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
    }
}
