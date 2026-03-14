import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { createDomainWorkflowTemplates } from "../src/core/runtime/domain-workflow-templates.js";
import { Orchestrator } from "../src/core/runtime/orchestrator.js";
import { WorkflowExecutor } from "../src/core/runtime/workflow.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import type { Tool, ToolRequest, ToolResult } from "../src/core/tools/types.js";

class MockTool implements Tool {
    constructor(
        readonly name: string,
        private readonly handler: (request: ToolRequest) => Promise<ToolResult>,
    ) { }

    async execute(request: ToolRequest): Promise<ToolResult> {
        return this.handler(request);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function createHarness(tools: Tool[]): {
    bus: ActivityBus;
    orchestrator: Orchestrator;
    workflowExecutor: WorkflowExecutor;
    approvalQueue: ApprovalQueue;
} {
    const bus = new ActivityBus();
    const policy = new PolicyEngine();
    const registry = new ToolRegistry();
    const approvalQueue = new ApprovalQueue();

    for (const tool of tools) {
        registry.register(tool);
    }

    return {
        bus,
        orchestrator: new Orchestrator(randomUUID(), bus, policy, registry, {
            approvalQueue,
            approvalTimeoutMs: 1_000,
        }),
        workflowExecutor: new WorkflowExecutor(),
        approvalQueue,
    };
}

export async function testDomainWorkflowTemplates(): Promise<void> {
    await testTemplatesAvailable();
    await testCalendarAllowPath();
    await testEmailDenyPathFallback();
    await testTasksTimeoutPathFallback();

    console.log("✓ Domain workflow template tests passed");
}

async function testTemplatesAvailable(): Promise<void> {
    const templates = createDomainWorkflowTemplates(new WorkflowExecutor());

    assert.ok(templates.email);
    assert.ok(templates.calendar);
    assert.ok(templates.notes);
    assert.ok(templates.tasks);

    for (const dag of Object.values(templates)) {
        assert.ok(dag.steps.some((step) => step.mutatesState));
        assert.ok(dag.fallbacks.length >= 1);
    }
}

async function testCalendarAllowPath(): Promise<void> {
    const { bus, orchestrator, workflowExecutor, approvalQueue } = createHarness([
        new MockTool("calendar_plan", async () => {
            return { ok: true, output: { ok: true } };
        }),
    ]);
    const calendarDag = createDomainWorkflowTemplates(workflowExecutor).calendar;

    setTimeout(() => {
        const pending = approvalQueue.list();
        if (pending.length > 0) {
            approvalQueue.approve(pending[0]!.id);
        }
    }, 20);

    await orchestrator.runWorkflow(calendarDag);

    const approvalGranted = bus
        .listEvents()
        .find((event) => event.operation === "calendar_plan.approval_granted");
    assert.ok(approvalGranted);

    const completion = bus
        .listEvents()
        .find((event) => event.operation === `workflow.${calendarDag.id}.completed`);
    assert.ok(completion);
    assert.strictEqual(completion!.status, "succeeded");
}

async function testEmailDenyPathFallback(): Promise<void> {
    const { bus, orchestrator, workflowExecutor, approvalQueue } = createHarness([
        new MockTool("email_ops", async () => {
            return { ok: true, output: { ok: true } };
        }),
    ]);
    const emailDag = createDomainWorkflowTemplates(workflowExecutor).email;

    setTimeout(() => {
        const pending = approvalQueue.list();
        if (pending.length > 0) {
            approvalQueue.deny(pending[0]!.id);
        }
    }, 20);

    await orchestrator.runWorkflow(emailDag);

    const approvalDenied = bus
        .listEvents()
        .find((event) => event.operation === "email_ops.approval_denied");
    assert.ok(approvalDenied);

    const fallbackAttempt = bus
        .listEvents()
        .find((event) => event.operation === "workflow.step.email_draft_fallback.attempt.1");
    assert.ok(fallbackAttempt);

    const completion = bus
        .listEvents()
        .find((event) => event.operation === `workflow.${emailDag.id}.completed`);
    assert.ok(completion);
    assert.strictEqual(completion!.status, "succeeded");
}

async function testTasksTimeoutPathFallback(): Promise<void> {
    const { bus, orchestrator, workflowExecutor, approvalQueue } = createHarness([
        new MockTool("tasks_timeline", async (request) => {
            if (request.args.action === "commit") {
                await sleep(40);
            }

            return { ok: true, output: { ok: true } };
        }),
    ]);
    const tasksDag = createDomainWorkflowTemplates(workflowExecutor).tasks;

    setTimeout(() => {
        const pending = approvalQueue.list();
        if (pending.length > 0) {
            approvalQueue.approve(pending[0]!.id);
        }
    }, 20);

    await orchestrator.runWorkflow(tasksDag);

    const timeoutEvent = bus
        .listEvents()
        .find((event) => event.operation === "workflow.step.tasks_commit.timeout");
    assert.ok(timeoutEvent);

    const fallbackAttempt = bus
        .listEvents()
        .find((event) => event.operation === "workflow.step.tasks_replan_fallback.attempt.1");
    assert.ok(fallbackAttempt);

    const completion = bus
        .listEvents()
        .find((event) => event.operation === `workflow.${tasksDag.id}.completed`);
    assert.ok(completion);
    assert.strictEqual(completion!.status, "succeeded");
}