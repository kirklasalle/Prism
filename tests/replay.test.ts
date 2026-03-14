import assert from "node:assert";
import { ActivityBus } from "../src/core/activity/bus.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { Orchestrator } from "../src/core/runtime/orchestrator.js";
import { WorkflowExecutor } from "../src/core/runtime/workflow.js";
import { buildReplaySignature, compareReplayParity } from "../src/core/runtime/replay.js";
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

async function runDeterministicWorkflowTrace(): Promise<ReturnType<ActivityBus["listEvents"]>> {
    const bus = new ActivityBus();
    const policy = new PolicyEngine();
    const registry = new ToolRegistry();
    const workflowExecutor = new WorkflowExecutor();

    registry.register(new MockTool("replay_step_one", async () => ({ ok: true, output: { result: "one" } })));
    registry.register(new MockTool("replay_step_two", async () => ({ ok: true, output: { result: "two" } })));

    const orchestrator = new Orchestrator("replay-session", bus, policy, registry);

    const dag = workflowExecutor.createDAG("ReplayDeterministic", [
        { id: "s1", operation: "replay_step_one", args: {}, risk: "low", mutatesState: false },
        { id: "s2", operation: "replay_step_two", args: {}, risk: "low", mutatesState: false },
    ]);

    await orchestrator.runWorkflow(dag);

    return bus.listEvents();
}

export async function testReplayHarness(): Promise<void> {
    const firstTrace = await runDeterministicWorkflowTrace();
    const secondTrace = await runDeterministicWorkflowTrace();

    const firstSignature = buildReplaySignature(firstTrace, { includeSessionId: false });
    const secondSignature = buildReplaySignature(secondTrace, { includeSessionId: false });

    const parity = compareReplayParity(firstSignature, secondSignature);
    assert.strictEqual(parity.matches, true);
    assert.ok(parity.expectedLength > 0);

    const tampered = [...secondSignature];
    tampered[0] = { ...tampered[0], operation: "tampered.operation" };
    const tamperedParity = compareReplayParity(firstSignature, tampered);
    assert.strictEqual(tamperedParity.matches, false);
    assert.strictEqual(tamperedParity.firstMismatchIndex, 0);

    console.log("✓ Replay harness tests passed");
}