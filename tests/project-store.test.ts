import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectStoreTool } from "../src/adapters/application/project-store.js";
import type { ToolRequest } from "../src/core/tools/types.js";

function makeTmpDir(): string {
    return mkdtempSync(join(tmpdir(), "prism-project-test-"));
}

function req(args: Record<string, unknown>): ToolRequest {
    return { operation: "project_store", args, risk: "low", mutatesState: false };
}

export async function testProjectStoreCreateAndList(): Promise<void> {
    const dir = makeTmpDir();
    try {
        const store = new ProjectStoreTool(dir);

        // Create project
        const createResult = await store.execute(req({ action: "create_project", title: "Test Project", description: "A test" }));
        assert.strictEqual(createResult.ok, true);
        const project = createResult.output as Record<string, unknown>;
        assert.ok(project.id);
        assert.strictEqual(project.title, "Test Project");
        assert.strictEqual(project.status, "planning");

        // List projects
        const listResult = await store.execute(req({ action: "list_projects" }));
        assert.strictEqual(listResult.ok, true);
        const listOutput = listResult.output as Record<string, unknown>;
        assert.strictEqual(listOutput.projectCount, 1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

export async function testProjectStoreGetProject(): Promise<void> {
    const dir = makeTmpDir();
    try {
        const store = new ProjectStoreTool(dir);
        const createResult = await store.execute(req({ action: "create_project", title: "Get Test" }));
        const project = createResult.output as Record<string, unknown>;

        const getResult = await store.execute(req({ action: "get_project", projectId: project.id }));
        assert.strictEqual(getResult.ok, true);
        assert.strictEqual((getResult.output as Record<string, unknown>).title, "Get Test");

        // Not found
        const notFound = await store.execute(req({ action: "get_project", projectId: "nonexistent" }));
        assert.strictEqual(notFound.ok, false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

export async function testProjectStoreUpdateProject(): Promise<void> {
    const dir = makeTmpDir();
    try {
        const store = new ProjectStoreTool(dir);
        const createResult = await store.execute(req({ action: "create_project", title: "Update Test" }));
        const project = createResult.output as Record<string, unknown>;

        const updateResult = await store.execute(req({ action: "update_project", projectId: project.id, title: "Updated Title", status: "active" }));
        assert.strictEqual(updateResult.ok, true);
        assert.strictEqual((updateResult.output as Record<string, unknown>).title, "Updated Title");
        assert.strictEqual((updateResult.output as Record<string, unknown>).status, "active");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

export async function testProjectStoreDeleteProject(): Promise<void> {
    const dir = makeTmpDir();
    try {
        const store = new ProjectStoreTool(dir);
        const createResult = await store.execute(req({ action: "create_project", title: "Delete Test" }));
        const project = createResult.output as Record<string, unknown>;

        const deleteResult = await store.execute(req({ action: "delete_project", projectId: project.id }));
        assert.strictEqual(deleteResult.ok, true);

        const listResult = await store.execute(req({ action: "list_projects" }));
        assert.strictEqual((listResult.output as Record<string, unknown>).projectCount, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

export async function testProjectStoreMilestones(): Promise<void> {
    const dir = makeTmpDir();
    try {
        const store = new ProjectStoreTool(dir);
        const createResult = await store.execute(req({ action: "create_project", title: "Milestone Test" }));
        const project = createResult.output as Record<string, unknown>;

        // Create milestone
        const msResult = await store.execute(req({ action: "create_milestone", projectId: project.id, title: "v1.0 Release", dueDate: "2025-12-31" }));
        assert.strictEqual(msResult.ok, true);
        const ms = msResult.output as Record<string, unknown>;
        assert.ok(ms.id);
        assert.strictEqual(ms.title, "v1.0 Release");

        // Verify milestone on project
        const getResult = await store.execute(req({ action: "get_project", projectId: project.id }));
        const fetched = getResult.output as { milestones: Array<{ id: string; title: string }> };
        assert.strictEqual(fetched.milestones.length, 1);
        assert.strictEqual(fetched.milestones[0]!.title, "v1.0 Release");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

export async function testProjectStoreTasks(): Promise<void> {
    const dir = makeTmpDir();
    try {
        const store = new ProjectStoreTool(dir);
        const createResult = await store.execute(req({ action: "create_project", title: "Task Test" }));
        const project = createResult.output as Record<string, unknown>;

        // Create task
        const taskResult = await store.execute(req({ action: "create_task", projectId: project.id, title: "Build feature X", priority: "high", status: "todo" }));
        assert.strictEqual(taskResult.ok, true);
        const task = taskResult.output as Record<string, unknown>;
        assert.ok(task.id);
        assert.strictEqual(task.title, "Build feature X");
        assert.strictEqual(task.priority, "high");

        // Update task
        const updateResult = await store.execute(req({ action: "update_task", projectId: project.id, taskId: task.id, status: "in-progress", progress: 50 }));
        assert.strictEqual(updateResult.ok, true);
        assert.strictEqual((updateResult.output as Record<string, unknown>).status, "in-progress");
        assert.strictEqual((updateResult.output as Record<string, unknown>).progress, 50);

        // Delete task
        const deleteResult = await store.execute(req({ action: "delete_task", projectId: project.id, taskId: task.id }));
        assert.strictEqual(deleteResult.ok, true);

        const getResult = await store.execute(req({ action: "get_project", projectId: project.id }));
        const fetched = getResult.output as { tasks: unknown[] };
        assert.strictEqual(fetched.tasks.length, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

export async function testProjectStoreDashboard(): Promise<void> {
    const dir = makeTmpDir();
    try {
        const store = new ProjectStoreTool(dir);
        await store.execute(req({ action: "create_project", title: "Dashboard Test" }));

        const dashResult = await store.execute(req({ action: "dashboard" }));
        assert.strictEqual(dashResult.ok, true);
        const dash = dashResult.output as Record<string, unknown>;
        assert.strictEqual(dash.projectCount, 1);
        assert.ok(Array.isArray(dash.projects));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
