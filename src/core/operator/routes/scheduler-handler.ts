import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parseCronExpression, getNextNCronOccurrences } from "../scheduler-engine.js";
import type { DashboardService } from "../dashboard-service.js";
import type { IRouteHandler } from "./types.js";

export class SchedulerHandler implements IRouteHandler {
    match(req: IncomingMessage): boolean {
        const url = req.url ?? "";
        return url.startsWith("/api/scheduler/");
    }

    async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const rawUrl = req.url ?? "";
        const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
        const method = req.method?.toUpperCase() ?? "GET";

        const schedulerEvents = service.getSchedulerEvents();
        const schedulerProjects = service.getSchedulerProjects();
        const schedulerEngine = service.getSchedulerEngine();

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
            const body = await service.readJsonBody<{ eventId?: string; title?: string; start?: string; end?: string; description?: string }>(req);
            if (!body.title || !body.start) return this.json(res, 400, { error: "title and start are required" });
            const id = body.eventId || randomUUID();
            const evt = { id, title: body.title, start: body.start, end: body.end, description: body.description, createdAt: new Date().toISOString() };
            schedulerEvents.set(id, evt);
            return this.json(res, 200, { event: evt });
        }

        // ── Projects ─────────────────────────────────────────────────────────

        if (method === "GET" && url === "/api/scheduler/projects") {
            const projects = [...schedulerProjects.values()];
            return this.json(res, 200, { projects });
        }

        const projectDetailMatch = /^\/api\/scheduler\/projects\/([^/?]+)$/.exec(url);
        if (method === "GET" && projectDetailMatch) {
            const pid = decodeURIComponent(projectDetailMatch[1]!);
            const project = schedulerProjects.get(pid);
            if (!project) return this.json(res, 404, { error: "Project not found" });
            return this.json(res, 200, { project });
        }

        if (method === "POST" && url === "/api/scheduler/projects") {
            const body = await service.readJsonBody<{ name?: string; description?: string }>(req);
            if (!body.name) return this.json(res, 400, { error: "name is required" });
            const id = randomUUID();
            const project = {
                id,
                name: body.name,
                description: body.description,
                tasks: [] as Array<{ id: string; title: string; status: string; assignee?: string; startDate?: string; endDate?: string; dueDate?: string; createdAt: string }>,
                milestones: [] as Array<{ title: string; dueDate?: string }>,
                createdAt: new Date().toISOString(),
            };
            schedulerProjects.set(id, project);
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
            const body = await service.readJsonBody<{ title?: string; projectId?: string; status?: string; assignee?: string; startDate?: string; endDate?: string; dueDate?: string }>(req);
            if (!body.title) return this.json(res, 400, { error: "title is required" });
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
            if (body.projectId) {
                const project = schedulerProjects.get(body.projectId);
                if (project) { project.tasks.push(task); }
                else { return this.json(res, 404, { error: "Project not found" }); }
            }
            return this.json(res, 200, { task });
        }

        const taskUpdateMatch = /^\/api\/scheduler\/tasks\/([^/?]+)/.exec(url);
        if (method === "PUT" && taskUpdateMatch) {
            const taskId = decodeURIComponent(taskUpdateMatch[1]!);
            const qs = new URL(url, "http://localhost").searchParams;
            const projectId = qs.get("projectId") || "";
            const body = await service.readJsonBody<{ status?: string; title?: string; assignee?: string }>(req);
            let found = false;
            for (const p of schedulerProjects.values()) {
                if (projectId && p.id !== projectId) continue;
                const task = p.tasks.find((t: any) => t.id === taskId);
                if (task) {
                    if (body.status) task.status = body.status;
                    if (body.title) task.title = body.title;
                    if (body.assignee !== undefined) task.assignee = body.assignee;
                    found = true;
                    break;
                }
            }
            if (!found) return this.json(res, 404, { error: "Task not found" });
            return this.json(res, 200, { ok: true });
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
                    entry = schedulerEngine.scheduleRecurring(body.label, body.cronExpression, body.action, body.payload);
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
