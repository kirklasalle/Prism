import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
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

export async function testWorkflowOrchestrator(): Promise<void> {
    await testWorkflowSuccessPath();
    await testWorkflowOnFailureFallback();
    await testWorkflowOnTimeoutFallback();
    await testWorkflowRetryThenSuccess();
    await testWorkflowRetryExhaustedThenFallback();
    await testWorkflowApprovalGatedStep();
    await testWorkflowApprovalDeniedNoFallbackFails();
    await testWorkflowApprovalDeniedWithFallbackSucceeds();
    await testWorkflowApprovalTimeoutWithFallbackSucceeds();

    console.log("✓ Workflow orchestrator tests passed");
}

async function testWorkflowSuccessPath(): Promise<void> {
    const executed: string[] = [];
    const { bus, orchestrator, workflowExecutor } = createHarness([
        new MockTool("ok_one", async () => {
            executed.push("ok_one");
            return { ok: true, output: { ok: true } };
        }),
        new MockTool("ok_two", async () => {
            executed.push("ok_two");
            return { ok: true, output: { ok: true } };
        }),
    ]);

    const dag = workflowExecutor.createDAG("Success", [
        { id: "s1", operation: "ok_one", args: {}, risk: "low", mutatesState: false },
        { id: "s2", operation: "ok_two", args: {}, risk: "low", mutatesState: false },
    ]);

    await orchestrator.runWorkflow(dag);

    assert.deepStrictEqual(executed, ["ok_one", "ok_two"]);
    const completion = bus.listEvents().find((e) => e.operation === `workflow.${dag.id}.completed`);
    assert.ok(completion);
    assert.strictEqual(completion!.status, "succeeded");
}

async function testWorkflowOnFailureFallback(): Promise<void> {
    const executed: string[] = [];
    const { bus, orchestrator, workflowExecutor } = createHarness([
        new MockTool("will_fail", async () => {
            executed.push("will_fail");
            return { ok: false, output: { reason: "expected" } };
        }),
        new MockTool("recover", async () => {
            executed.push("recover");
            return { ok: true, output: { recovered: true } };
        }),
    ]);

    const dag = workflowExecutor.createDAG(
        "FailureFallback",
        [
            { id: "s1", operation: "will_fail", args: {}, risk: "low", mutatesState: false },
            { id: "s2", operation: "recover", args: {}, risk: "low", mutatesState: false },
        ],
        [{ stepId: "s1", condition: "on_failure", nextStepId: "s2" }],
    );

    await orchestrator.runWorkflow(dag);

    assert.deepStrictEqual(executed, ["will_fail", "recover"]);
    const completion = bus.listEvents().find((e) => e.operation === `workflow.${dag.id}.completed`);
    assert.ok(completion);
    assert.strictEqual(completion!.status, "succeeded");
}

async function testWorkflowOnTimeoutFallback(): Promise<void> {
    const executed: string[] = [];
    const { bus, orchestrator, workflowExecutor } = createHarness([
        new MockTool("slow_timeout", async () => {
            executed.push("slow_timeout");
            await sleep(40);
            return { ok: true, output: { slow: true } };
        }),
        new MockTool("recover_timeout", async () => {
            executed.push("recover_timeout");
            return { ok: true, output: { recovered: true } };
        }),
    ]);

    const dag = workflowExecutor.createDAG(
        "TimeoutFallback",
        [
            {
                id: "s1",
                operation: "slow_timeout",
                args: {},
                risk: "low",
                mutatesState: false,
                timeoutMs: 5,
            },
            { id: "s2", operation: "recover_timeout", args: {}, risk: "low", mutatesState: false },
        ],
        [{ stepId: "s1", condition: "on_timeout", nextStepId: "s2" }],
    );

    await orchestrator.runWorkflow(dag);

    assert.deepStrictEqual(executed, ["slow_timeout", "recover_timeout"]);
    const timeoutEvent = bus.listEvents().find((e) => e.operation === "workflow.step.s1.timeout");
    assert.ok(timeoutEvent);
    const completion = bus.listEvents().find((e) => e.operation === `workflow.${dag.id}.completed`);
    assert.ok(completion);
    assert.strictEqual(completion!.status, "succeeded");
}

async function testWorkflowRetryThenSuccess(): Promise<void> {
    let attempts = 0;
    const { bus, orchestrator, workflowExecutor } = createHarness([
        new MockTool("flaky", async () => {
            attempts++;
            if (attempts === 1) {
                return { ok: false, output: { attempt: attempts } };
            }
            return { ok: true, output: { attempt: attempts } };
        }),
    ]);

    const dag = workflowExecutor.createDAG("RetryThenSuccess", [
        {
            id: "s1",
            operation: "flaky",
            args: {},
            risk: "low",
            mutatesState: false,
            retries: 1,
        },
    ]);

    await orchestrator.runWorkflow(dag);

    assert.strictEqual(attempts, 2);
    const completion = bus.listEvents().find((e) => e.operation === `workflow.${dag.id}.completed`);
    assert.ok(completion);
    assert.strictEqual(completion!.status, "succeeded");
}

async function testWorkflowRetryExhaustedThenFallback(): Promise<void> {
    let attempts = 0;
    const executed: string[] = [];
    const { bus, orchestrator, workflowExecutor } = createHarness([
        new MockTool("always_fail", async () => {
            attempts++;
            executed.push("always_fail");
            return { ok: false, output: { attempt: attempts } };
        }),
        new MockTool("recover_after_retry", async () => {
            executed.push("recover_after_retry");
            return { ok: true, output: { recovered: true } };
        }),
    ]);

    const dag = workflowExecutor.createDAG(
        "RetryFallback",
        [
            {
                id: "s1",
                operation: "always_fail",
                args: {},
                risk: "low",
                mutatesState: false,
                retries: 1,
            },
            {
                id: "s2",
                operation: "recover_after_retry",
                args: {},
                risk: "low",
                mutatesState: false,
            },
        ],
        [{ stepId: "s1", condition: "on_failure", nextStepId: "s2" }],
    );

    await orchestrator.runWorkflow(dag);

    assert.strictEqual(attempts, 2);
    assert.deepStrictEqual(executed, ["always_fail", "always_fail", "recover_after_retry"]);
    const completion = bus.listEvents().find((e) => e.operation === `workflow.${dag.id}.completed`);
    assert.ok(completion);
    assert.strictEqual(completion!.status, "succeeded");
}

async function testWorkflowApprovalGatedStep(): Promise<void> {
    const executed: string[] = [];
    const { bus, orchestrator, workflowExecutor, approvalQueue } = createHarness([
        new MockTool("high_risk_tool", async () => {
            executed.push("high_risk_tool");
            return { ok: true, output: { applied: true } };
        }),
        new MockTool("post_approval", async () => {
            executed.push("post_approval");
            return { ok: true, output: { done: true } };
        }),
    ]);

    const dag = workflowExecutor.createDAG("ApprovalPath", [
        {
            id: "s1",
            operation: "high_risk_tool",
            args: {},
            risk: "high",
            mutatesState: true,
            rollbackPlan: "restore snapshot",
        },
        {
            id: "s2",
            operation: "post_approval",
            args: {},
            risk: "low",
            mutatesState: false,
        },
    ]);

    setTimeout(() => {
        const pending = approvalQueue.list();
        if (pending.length > 0) {
            approvalQueue.approve(pending[0]!.id);
        }
    }, 20);

    await orchestrator.runWorkflow(dag);

    assert.deepStrictEqual(executed, ["high_risk_tool", "post_approval"]);
    const approvalRequested = bus.listEvents().find(
        (e) => e.operation === "high_risk_tool.approval_requested",
    );
    assert.ok(approvalRequested);
    const approvalGranted = bus.listEvents().find(
        (e) => e.operation === "high_risk_tool.approval_granted",
    );
    assert.ok(approvalGranted);
    const completion = bus.listEvents().find((e) => e.operation === `workflow.${dag.id}.completed`);
    assert.ok(completion);
    assert.strictEqual(completion!.status, "succeeded");
}

async function testWorkflowApprovalDeniedNoFallbackFails(): Promise<void> {
    const executed: string[] = [];
    const { bus, orchestrator, workflowExecutor, approvalQueue } = createHarness([
        new MockTool("high_risk_deny", async () => {
            executed.push("high_risk_deny");
            return { ok: true, output: { shouldNotRun: true } };
        }),
    ]);

    const dag = workflowExecutor.createDAG("ApprovalDeniedNoFallback", [
        {
            id: "s1",
            operation: "high_risk_deny",
            args: {},
            risk: "high",
            mutatesState: true,
            rollbackPlan: "restore snapshot",
        },
    ]);

    setTimeout(() => {
        const pending = approvalQueue.list();
        if (pending.length > 0) {
            approvalQueue.deny(pending[0]!.id);
        }
    }, 20);

    await orchestrator.runWorkflow(dag);

    assert.deepStrictEqual(executed, []);
    const denied = bus.listEvents().find((e) => e.operation === "high_risk_deny.approval_denied");
    assert.ok(denied);
    const completion = bus.listEvents().find((e) => e.operation === `workflow.${dag.id}.completed`);
    assert.ok(completion);
    assert.strictEqual(completion!.status, "failed");
}

async function testWorkflowApprovalDeniedWithFallbackSucceeds(): Promise<void> {
    const executed: string[] = [];
    const { bus, orchestrator, workflowExecutor, approvalQueue } = createHarness([
        new MockTool("high_risk_deny_fallback", async () => {
            executed.push("high_risk_deny_fallback");
            return { ok: true, output: { shouldNotRun: true } };
        }),
        new MockTool("deny_recovery", async () => {
            executed.push("deny_recovery");
            return { ok: true, output: { recovered: true } };
        }),
    ]);

    const dag = workflowExecutor.createDAG(
        "ApprovalDeniedWithFallback",
        [
            {
                id: "s1",
                operation: "high_risk_deny_fallback",
                args: {},
                risk: "high",
                mutatesState: true,
                rollbackPlan: "restore snapshot",
            },
            {
                id: "s2",
                operation: "deny_recovery",
                args: {},
                risk: "low",
                mutatesState: false,
            },
        ],
        [{ stepId: "s1", condition: "on_failure", nextStepId: "s2" }],
    );

    setTimeout(() => {
        const pending = approvalQueue.list();
        if (pending.length > 0) {
            approvalQueue.deny(pending[0]!.id);
        }
    }, 20);

    await orchestrator.runWorkflow(dag);

    assert.deepStrictEqual(executed, ["deny_recovery"]);
    const denied = bus.listEvents().find(
        (e) => e.operation === "high_risk_deny_fallback.approval_denied",
    );
    assert.ok(denied);
    const completion = bus.listEvents().find((e) => e.operation === `workflow.${dag.id}.completed`);
    assert.ok(completion);
    assert.strictEqual(completion!.status, "succeeded");
}

async function testWorkflowApprovalTimeoutWithFallbackSucceeds(): Promise<void> {
    const executed: string[] = [];
    const { bus, orchestrator, workflowExecutor } = createHarness([
        new MockTool("high_risk_timeout", async () => {
            executed.push("high_risk_timeout");
            return { ok: true, output: { shouldNotRun: true } };
        }),
        new MockTool("timeout_recovery", async () => {
            executed.push("timeout_recovery");
            return { ok: true, output: { recovered: true } };
        }),
    ]);

    const dag = workflowExecutor.createDAG(
        "ApprovalTimeoutWithFallback",
        [
            {
                id: "s1",
                operation: "high_risk_timeout",
                args: {},
                risk: "high",
                mutatesState: true,
                rollbackPlan: "restore snapshot",
            },
            {
                id: "s2",
                operation: "timeout_recovery",
                args: {},
                risk: "low",
                mutatesState: false,
            },
        ],
        [{ stepId: "s1", condition: "on_failure", nextStepId: "s2" }],
    );

    await orchestrator.runWorkflow(dag);

    assert.deepStrictEqual(executed, ["timeout_recovery"]);
    const denied = bus.listEvents().find((e) => e.operation === "high_risk_timeout.approval_denied");
    assert.ok(denied);
    const completion = bus.listEvents().find((e) => e.operation === `workflow.${dag.id}.completed`);
    assert.ok(completion);
    assert.strictEqual(completion!.status, "succeeded");
}