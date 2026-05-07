/**
 * Scheduler API Route Integration Tests — exercises all /api/scheduler/* REST
 * endpoints exposed by DashboardService.
 *
 * Spins up a DashboardService on an ephemeral port, makes real HTTP requests,
 * and validates CRUD operations for events, projects, and tasks.
 *
 * Run via Mocha: mocha dist/tests/scheduler-api-routes.test.js --timeout 60000
 */
import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { DashboardService } from "../src/core/operator/dashboard-service.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";

/* ── Test helpers ─────────────────────────────────────────────────────── */

let service: DashboardService;
let port: number;
let tmpDir: string;
let chatStore: ChatSessionStore;

function fetchJson(path: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port, path }, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => { data += chunk; });
            res.on("end", () => {
                try { resolve({ status: res.statusCode!, body: JSON.parse(data || "{}") }); }
                catch { resolve({ status: res.statusCode!, body: data }); }
            });
        }).on("error", reject);
    });
}

function requestJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: "127.0.0.1",
            port,
            path,
            method,
            headers: body == null ? {} : { "Content-Type": "application/json" },
        }, (res) => {
            let payload = "";
            res.on("data", (chunk: Buffer) => { payload += chunk; });
            res.on("end", () => {
                try { resolve({ status: res.statusCode!, body: JSON.parse(payload || "{}") }); }
                catch { resolve({ status: res.statusCode!, body: payload }); }
            });
        });
        req.on("error", reject);
        if (body != null) req.write(JSON.stringify(body));
        req.end();
    });
}

/* ── Suite ─────────────────────────────────────────────────────────────── */

describe("Scheduler API Routes (/api/scheduler/*)", function () {
    this.timeout(60_000);

    before(async () => {
        process.env.PRISM_AUTH_DISABLED = "true";
        tmpDir = mkdtempSync(join(tmpdir(), "prism-scheduler-api-"));
        const bus = new ActivityBus();
        chatStore = new ChatSessionStore(":memory:");

        service = new DashboardService(
            new ApprovalQueue(),
            bus,
            {
                sessionId: "sched-test-session",
                environmentProfile: "test",
                mode: "server",
                startedAt: new Date().toISOString(),
                executionProfileSegment: "individual",
            },
            chatStore,
            [],                                          // actions
            0,                                           // port = ephemeral
            undefined,                                   // metricsCollector
            undefined,                                   // retrievalDashboardStore
            new InMemoryProviderSecretStore(),            // providerSecretStore
            undefined,                                   // activityStore
            join(tmpDir, "session-packages.json"),        // sessionPackageStorePath
            join(tmpDir, "exports"),                      // sessionPackageExportDir
        );

        service.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        const addr = (service as unknown as { server: { address(): { port: number } | null } }).server.address();
        port = addr ? addr.port : 0;
        assert.ok(port > 0, "DashboardService should bind to an ephemeral port");
    });

    after(async () => {
        await service.stop();
        chatStore.close();
        rmSync(tmpDir, { recursive: true, force: true });
        delete process.env.PRISM_AUTH_DISABLED;
    });

    /* ── Events ───────────────────────────────────────────────────────── */

    describe("Events CRUD", () => {
        let eventId: string;

        it("GET /api/scheduler/events returns empty initially", async () => {
            const { status, body } = await fetchJson("/api/scheduler/events");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body.events));
            assert.strictEqual(body.events.length, 0);
        });

        it("POST /api/scheduler/events creates an event", async () => {
            const { status, body } = await requestJson("POST", "/api/scheduler/events", {
                title: "Sprint Planning",
                start: "2026-04-13",
                end: "2026-04-13",
                description: "Q2 sprint kick-off",
            });
            assert.strictEqual(status, 200);
            assert.ok(body.event);
            assert.ok(body.event.id);
            assert.strictEqual(body.event.title, "Sprint Planning");
            eventId = body.event.id;
        });

        it("GET /api/scheduler/events returns the created event", async () => {
            const { status, body } = await fetchJson("/api/scheduler/events?start=2026-01-01&end=2026-12-31");
            assert.strictEqual(status, 200);
            assert.strictEqual(body.events.length, 1);
            assert.strictEqual(body.events[0].id, eventId);
        });

        it("GET /api/scheduler/events filters by date range", async () => {
            // Event is on 2026-04-13. Querying for earlier range should exclude it.
            const { body: empty } = await fetchJson("/api/scheduler/events?start=2026-01-01&end=2026-03-01");
            assert.strictEqual(empty.events.length, 0);

            // Querying for the matching range should include it.
            const { body: found } = await fetchJson("/api/scheduler/events?start=2026-04-01&end=2026-04-30");
            assert.strictEqual(found.events.length, 1);
        });

        it("POST /api/scheduler/events re-uses eventId for update", async () => {
            const { status, body } = await requestJson("POST", "/api/scheduler/events", {
                eventId,
                title: "Sprint Planning (Updated)",
                start: "2026-04-13",
            });
            assert.strictEqual(status, 200);
            assert.strictEqual(body.event.id, eventId);
            assert.strictEqual(body.event.title, "Sprint Planning (Updated)");

            // Confirm only one event exists (was overwritten, not duplicated)
            const { body: all } = await fetchJson("/api/scheduler/events");
            assert.strictEqual(all.events.length, 1);
        });

        it("POST /api/scheduler/events requires title and start", async () => {
            const { status } = await requestJson("POST", "/api/scheduler/events", { description: "no title" });
            assert.strictEqual(status, 400);
        });
    });

    /* ── Projects ─────────────────────────────────────────────────────── */

    describe("Projects CRUD", () => {
        let projectId: string;

        it("GET /api/scheduler/projects returns empty initially", async () => {
            const { status, body } = await fetchJson("/api/scheduler/projects");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body.projects));
            assert.strictEqual(body.projects.length, 0);
        });

        it("POST /api/scheduler/projects creates a project", async () => {
            const { status, body } = await requestJson("POST", "/api/scheduler/projects", {
                name: "PRISM v2.0",
                description: "Next major release",
            });
            assert.strictEqual(status, 200);
            assert.ok(body.project);
            assert.ok(body.project.id);
            assert.strictEqual(body.project.name, "PRISM v2.0");
            assert.deepStrictEqual(body.project.tasks, []);
            projectId = body.project.id;
        });

        it("GET /api/scheduler/projects returns the created project", async () => {
            const { status, body } = await fetchJson("/api/scheduler/projects");
            assert.strictEqual(status, 200);
            assert.strictEqual(body.projects.length, 1);
            assert.strictEqual(body.projects[0].id, projectId);
        });

        it("GET /api/scheduler/projects/:id returns project detail", async () => {
            const { status, body } = await fetchJson(`/api/scheduler/projects/${projectId}`);
            assert.strictEqual(status, 200);
            assert.ok(body.project);
            assert.strictEqual(body.project.id, projectId);
            assert.strictEqual(body.project.name, "PRISM v2.0");
        });

        it("GET /api/scheduler/projects/:id returns 404 for unknown", async () => {
            const { status } = await fetchJson("/api/scheduler/projects/nonexistent");
            assert.strictEqual(status, 404);
        });

        it("POST /api/scheduler/projects requires name", async () => {
            const { status } = await requestJson("POST", "/api/scheduler/projects", { description: "no name" });
            assert.strictEqual(status, 400);
        });
    });

    /* ── Tasks ────────────────────────────────────────────────────────── */

    describe("Tasks CRUD", () => {
        let taskId: string;
        let projectId: string;

        before(async () => {
            // Create a project first
            const { body } = await requestJson("POST", "/api/scheduler/projects", { name: "Task Test Project" });
            projectId = body.project.id;
        });

        it("POST /api/scheduler/tasks creates a task under a project", async () => {
            const { status, body } = await requestJson("POST", "/api/scheduler/tasks", {
                title: "Implement scheduler routes",
                projectId,
                status: "todo",
            });
            assert.strictEqual(status, 200);
            assert.ok(body.task);
            assert.ok(body.task.id);
            assert.strictEqual(body.task.title, "Implement scheduler routes");
            assert.strictEqual(body.task.status, "todo");
            taskId = body.task.id;
        });

        it("GET /api/scheduler/tasks lists all tasks across projects", async () => {
            const { status, body } = await fetchJson("/api/scheduler/tasks");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body.tasks));
            const found = body.tasks.find((t: any) => t.id === taskId);
            assert.ok(found, "newly created task should appear in list");
            assert.strictEqual(found.projectId, projectId);
        });

        it("PUT /api/scheduler/tasks/:id updates task status", async () => {
            const { status } = await requestJson("PUT", `/api/scheduler/tasks/${taskId}?projectId=${projectId}`, {
                status: "in-progress",
            });
            assert.strictEqual(status, 200);

            // Verify the update via task list
            const { body } = await fetchJson("/api/scheduler/tasks");
            const updated = body.tasks.find((t: any) => t.id === taskId);
            assert.strictEqual(updated.status, "in-progress");
        });

        it("PUT /api/scheduler/tasks/:id updates task title", async () => {
            const { status } = await requestJson("PUT", `/api/scheduler/tasks/${taskId}?projectId=${projectId}`, {
                title: "Implement scheduler routes (done)",
            });
            assert.strictEqual(status, 200);
        });

        it("PUT /api/scheduler/tasks/:id returns 404 for unknown task", async () => {
            const { status } = await requestJson("PUT", "/api/scheduler/tasks/nonexistent", { status: "done" });
            assert.strictEqual(status, 404);
        });

        it("POST /api/scheduler/tasks requires title", async () => {
            const { status } = await requestJson("POST", "/api/scheduler/tasks", { projectId });
            assert.strictEqual(status, 400);
        });

        it("POST /api/scheduler/tasks returns 404 for unknown projectId", async () => {
            const { status } = await requestJson("POST", "/api/scheduler/tasks", {
                title: "Orphan task",
                projectId: "nonexistent-project",
            });
            assert.strictEqual(status, 404);
        });

        it("task appears in project detail", async () => {
            const { body } = await fetchJson(`/api/scheduler/projects/${projectId}`);
            assert.ok(body.project.tasks.length >= 1);
            const t = body.project.tasks.find((t: any) => t.id === taskId);
            assert.ok(t, "task should appear in project detail");
        });
    });

    /* ── Full lifecycle: Kanban drag-drop simulation ──────────────────── */

    describe("Kanban lifecycle", () => {
        let projectId: string;
        const taskIds: string[] = [];

        before(async () => {
            const { body } = await requestJson("POST", "/api/scheduler/projects", { name: "Kanban Project" });
            projectId = body.project.id;

            for (const title of ["Design", "Develop", "Test", "Deploy"]) {
                const { body: tb } = await requestJson("POST", "/api/scheduler/tasks", {
                    title,
                    projectId,
                    status: "backlog",
                });
                taskIds.push(tb.task.id);
            }
        });

        it("moves tasks through all kanban stages", async () => {
            const stages = ["todo", "in-progress", "review", "done"];
            for (let i = 0; i < stages.length && i < taskIds.length; i++) {
                const { status } = await requestJson("PUT", `/api/scheduler/tasks/${taskIds[i]}?projectId=${projectId}`, {
                    status: stages[i],
                });
                assert.strictEqual(status, 200);
            }

            // Verify final task states
            const { body } = await fetchJson(`/api/scheduler/projects/${projectId}`);
            const tasks = body.project.tasks;
            assert.strictEqual(tasks.find((t: any) => t.title === "Design")!.status, "todo");
            assert.strictEqual(tasks.find((t: any) => t.title === "Develop")!.status, "in-progress");
            assert.strictEqual(tasks.find((t: any) => t.title === "Test")!.status, "review");
            assert.strictEqual(tasks.find((t: any) => t.title === "Deploy")!.status, "done");
        });
    });

    /* ── Cron Jobs CRUD ────────────────────────────────────────────────── */

    describe("Cron Jobs CRUD", () => {
        let recurringJobId: string;
        let onceJobId: string;

        it("GET /api/scheduler/cron returns empty array initially", async () => {
            const { status, body } = await fetchJson("/api/scheduler/cron");
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body), "body should be an array");
            assert.strictEqual(body.length, 0);
        });

        it("POST /api/scheduler/cron without label returns 400", async () => {
            const { status, body } = await requestJson("POST", "/api/scheduler/cron", {
                action: "test-action",
                cronExpression: "*/5 * * * *",
            });
            assert.strictEqual(status, 400);
            assert.ok(body.error.includes("label"));
        });

        it("POST /api/scheduler/cron without action returns 400", async () => {
            const { status, body } = await requestJson("POST", "/api/scheduler/cron", {
                label: "Test Job",
                cronExpression: "*/5 * * * *",
            });
            assert.strictEqual(status, 400);
            assert.ok(body.error.includes("action"));
        });

        it("POST /api/scheduler/cron with invalid cron expression returns 400", async () => {
            const { status, body } = await requestJson("POST", "/api/scheduler/cron", {
                label: "Bad Cron",
                action: "test-action",
                cronExpression: "not-a-cron",
            });
            assert.strictEqual(status, 400);
            assert.ok(body.error.includes("Invalid cron"));
        });

        it("POST /api/scheduler/cron creates a recurring job", async () => {
            const { status, body } = await requestJson("POST", "/api/scheduler/cron", {
                label: "Every 5 min",
                action: "health-check",
                cronExpression: "*/5 * * * *",
                payload: { target: "api" },
            });
            assert.strictEqual(status, 201);
            assert.ok(body.job.id, "should have an id");
            assert.strictEqual(body.job.label, "Every 5 min");
            assert.strictEqual(body.job.type, "recurring");
            assert.strictEqual(body.job.cronExpression, "*/5 * * * *");
            assert.strictEqual(body.job.action, "health-check");
            assert.ok(body.job.nextRunAt, "should have nextRunAt");
            assert.deepStrictEqual(body.job.payload, { target: "api" });
            recurringJobId = body.job.id;
        });

        it("POST /api/scheduler/cron creates a one-time job", async () => {
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            const { status, body } = await requestJson("POST", "/api/scheduler/cron", {
                label: "One-time deploy",
                type: "once",
                action: "deploy",
                runAt: futureDate,
            });
            assert.strictEqual(status, 201);
            assert.ok(body.job.id, "should have an id");
            assert.strictEqual(body.job.type, "once");
            assert.strictEqual(body.job.runAt, futureDate);
            onceJobId = body.job.id;
        });

        it("POST /api/scheduler/cron once without runAt returns 400", async () => {
            const { status, body } = await requestJson("POST", "/api/scheduler/cron", {
                label: "Missing runAt",
                type: "once",
                action: "test-action",
            });
            assert.strictEqual(status, 400);
            assert.ok(body.error.includes("runAt"));
        });

        it("GET /api/scheduler/cron lists created jobs with nextOccurrences", async () => {
            const { status, body } = await fetchJson("/api/scheduler/cron");
            assert.strictEqual(status, 200);
            assert.strictEqual(body.length, 2);
            const recurring = body.find((j: any) => j.id === recurringJobId);
            assert.ok(recurring, "recurring job should be in list");
            assert.ok(Array.isArray(recurring.nextOccurrences), "should have nextOccurrences array");
            assert.ok(recurring.nextOccurrences.length > 0, "should have at least one next occurrence");
        });

        it("GET /api/scheduler/cron/:id/preview returns job with 10 occurrences", async () => {
            const { status, body } = await fetchJson(`/api/scheduler/cron/${recurringJobId}/preview`);
            assert.strictEqual(status, 200);
            assert.strictEqual(body.id, recurringJobId);
            assert.strictEqual(body.label, "Every 5 min");
            assert.ok(Array.isArray(body.nextOccurrences), "should have nextOccurrences");
            assert.strictEqual(body.nextOccurrences.length, 10);
        });

        it("GET /api/scheduler/cron/nonexistent/preview returns 404", async () => {
            const { status } = await fetchJson("/api/scheduler/cron/nonexistent/preview");
            assert.strictEqual(status, 404);
        });

        it("POST /api/scheduler/cron/validate with valid expression", async () => {
            const { status, body } = await requestJson("POST", "/api/scheduler/cron/validate", {
                cronExpression: "0 9 * * 1-5",
            });
            assert.strictEqual(status, 200);
            assert.strictEqual(body.valid, true);
            assert.ok(body.fields, "should have parsed fields");
            assert.ok(Array.isArray(body.nextDates), "should have nextDates");
            assert.strictEqual(body.nextDates.length, 5);
        });

        it("POST /api/scheduler/cron/validate with invalid expression", async () => {
            const { status, body } = await requestJson("POST", "/api/scheduler/cron/validate", {
                cronExpression: "bad cron",
            });
            assert.strictEqual(status, 200);
            assert.strictEqual(body.valid, false);
            assert.ok(body.error, "should have error message");
        });

        it("DELETE /api/scheduler/cron/:id cancels the recurring job", async () => {
            const { status, body } = await requestJson("DELETE", `/api/scheduler/cron/${recurringJobId}`);
            assert.strictEqual(status, 200);
            assert.strictEqual(body.ok, true);
        });

        it("DELETE /api/scheduler/cron/:id again returns 404", async () => {
            const { status } = await requestJson("DELETE", `/api/scheduler/cron/${recurringJobId}`);
            assert.strictEqual(status, 404);
        });

        it("DELETE /api/scheduler/cron/:id cancels the one-time job", async () => {
            const { status, body } = await requestJson("DELETE", `/api/scheduler/cron/${onceJobId}`);
            assert.strictEqual(status, 200);
            assert.strictEqual(body.ok, true);
        });

        it("GET /api/scheduler/cron returns empty after cancellation", async () => {
            const { status, body } = await fetchJson("/api/scheduler/cron");
            assert.strictEqual(status, 200);
            assert.strictEqual(body.length, 0);
        });
    });
});
