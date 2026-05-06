/**
 * Tests for the Self-Healing Workflow Synthesis (SHWS) prototype.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { INDIVIDUAL_PROFILE } from "../src/core/policy/execution-profiles.js";
import { WorkflowExecutor } from "../src/core/runtime/workflow.js";
import type { WorkflowStep } from "../src/core/runtime/workflow.js";
import { CausalCompiler } from "../src/core/incubation/ccc/compiler.js";
import { loadConstitution } from "../src/core/incubation/ccc/constitution.js";
import { WorkflowHistoryIndex } from "../src/core/incubation/shws/history-index.js";
import { PolicyValidator } from "../src/core/incubation/shws/policy-validator.js";
import { WorkflowSynthesizer } from "../src/core/incubation/shws/synthesizer.js";

export async function testShwsSynthesizer(): Promise<void> {
    const bus = new ActivityBus();
    const events: string[] = [];
    bus.subscribe({ onEvent: (e) => events.push(e.operation) });
    const policy = new PolicyEngine();
    const compiler = new CausalCompiler(policy);
    const validator = new PolicyValidator(compiler);
    const approvals = new ApprovalQueue();
    const history = new WorkflowHistoryIndex(50);
    const constitution = loadConstitution(resolve(process.cwd(), "examples", "constitutions", "business-default.json"));
    const synth = new WorkflowSynthesizer(history, validator, approvals, bus, { maxDepth: 3 });
    const executor = new WorkflowExecutor();

    const failedStep: WorkflowStep = {
        id: "send-1",
        operation: "send.email",
        args: {},
        risk: "medium",
        mutatesState: true,
        rollbackPlan: "discard draft",
    };
    const failedDag = executor.createDAG("test-wf", [failedStep]);

    // 1. No history → null with no_history event
    const empty = synth.proposeFallback({
        failedStepId: "send-1",
        dag: failedDag,
        profile: INDIVIDUAL_PROFILE,
        constitution,
    });
    assert.equal(empty, null, "no history should yield null");
    assert.ok(events.includes("incubation.shws.no_history"));

    // 2. Seed history with a viable repair fragment, then propose
    const repairSteps: WorkflowStep[] = [
        { id: "retry-1", operation: "retry.email", args: {}, risk: "low", mutatesState: false },
    ];
    history.record({
        workflowId: "wf-prior",
        stepId: "send-1",
        operation: "send.email",
        succeeded: true,
        recordedAt: new Date().toISOString(),
        repairSteps,
    });
    const candidate = synth.proposeFallback({
        failedStepId: "send-1",
        dag: failedDag,
        profile: INDIVIDUAL_PROFILE,
        constitution,
    });
    assert.ok(candidate, "should propose a candidate");
    assert.equal(candidate!.requiresTier3Approval, true);
    assert.equal(candidate!.prototype, true);
    assert.equal(candidate!.proposedSteps.length, 1);
    assert.equal(candidate!.compiledPlan.enforceable, true);
    assert.ok(events.includes("incubation.shws.candidate_proposed"));

    // 3. Approval-gate: ApprovalQueue should now have a pending request
    const pending = approvals.list();
    assert.ok(pending.some((p) => p.operation.startsWith("incubation.shws.apply.")));

    // 4. Already-active guard: a second propose for the same DAG returns null
    const dup = synth.proposeFallback({
        failedStepId: "send-1",
        dag: failedDag,
        profile: INDIVIDUAL_PROFILE,
        constitution,
    });
    assert.equal(dup, null);
    assert.ok(events.includes("incubation.shws.already_active"));

    // 5. Max-depth cap
    const dag2 = executor.createDAG("test-wf-2", [failedStep]);
    const capped = synth.proposeFallback({
        failedStepId: "send-1",
        dag: dag2,
        profile: INDIVIDUAL_PROFILE,
        constitution,
        currentDepth: 3,
    });
    assert.equal(capped, null);
    assert.ok(events.includes("incubation.shws.depth_capped"));

    // 6. Policy-invalid rejection: repair with a forbidden CAC reason via principle is harder to synthesize
    // here; instead, force rejection by injecting a repair step that the constitution disallows
    // (medium-risk mutation without rollbackPlan).
    const badHistory = new WorkflowHistoryIndex(10);
    badHistory.record({
        workflowId: "wf-bad",
        stepId: "send-2",
        operation: "send.email.bad",
        succeeded: true,
        recordedAt: new Date().toISOString(),
        repairSteps: [
            { id: "bad-1", operation: "delete.records", args: {}, risk: "medium", mutatesState: true /* no rollbackPlan */ },
        ],
    });
    const synth2 = new WorkflowSynthesizer(badHistory, validator, new ApprovalQueue(), bus);
    // Need to use BUSINESS_PROFILE so constitution's rollback rule actually denies
    const { BUSINESS_PROFILE } = await import("../src/core/policy/execution-profiles.js");
    const dag3 = executor.createDAG("test-wf-3", [
        { id: "send-2", operation: "send.email.bad", args: {}, risk: "medium", mutatesState: true, rollbackPlan: "noop" },
    ]);
    const rejected = synth2.proposeFallback({
        failedStepId: "send-2",
        dag: dag3,
        profile: BUSINESS_PROFILE,
        constitution,
    });
    assert.ok(rejected, "should still return candidate object");
    assert.ok(rejected!.rejected, "candidate must be marked rejected");
    assert.ok(events.includes("incubation.shws.candidate_rejected"));

    // Stats sanity
    const stats = synth.getStats();
    assert.ok(stats.proposedCount >= 1);
    assert.ok(stats.historySize >= 1);

    // Clean up: deny all pending approvals so their 120s timers don't keep
    // the event loop alive past test completion.
    for (const p of approvals.list()) approvals.deny(p.id);
}
