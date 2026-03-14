import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { ActivityBus } from "../src/core/activity/bus.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { Orchestrator } from "../src/core/runtime/orchestrator.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import type { Tool, ToolRequest, ToolResult } from "../src/core/tools/types.js";
import { ShellTool } from "../src/adapters/system/shell-tool.js";

class InvalidContractTool implements Tool {
    readonly name = "invalid_contract_tool";
    readonly contract = {
        version: "1",
        args: {
            payload: { type: "string", required: true },
        },
    } as const;

    async execute(_request: ToolRequest): Promise<ToolResult> {
        return { ok: true, output: { ok: true } };
    }
}

export async function testToolContracts(): Promise<void> {
    await testContractVersionValidation();
    await testRuntimeSchemaValidationBlocksExecution();

    console.log("✓ Tool contract tests passed");
}

async function testContractVersionValidation(): Promise<void> {
    const registry = new ToolRegistry();
    assert.throws(() => {
        registry.register(new InvalidContractTool());
    }, /semver/i);
}

async function testRuntimeSchemaValidationBlocksExecution(): Promise<void> {
    const bus = new ActivityBus();
    const policy = new PolicyEngine();
    const registry = new ToolRegistry();
    registry.register(new ShellTool());

    const orchestrator = new Orchestrator(randomUUID(), bus, policy, registry);
    await orchestrator.run({
        operation: "shell_exec",
        args: {},
        risk: "low",
        mutatesState: false,
    });

    const validationEvent = bus
        .listEvents()
        .find((event) => event.operation === "shell_exec.contract_validation");

    assert.ok(validationEvent);
    assert.strictEqual(validationEvent!.status, "failed");

    const executionEvent = bus
        .listEvents()
        .find((event) => event.operation === "shell_exec" && event.status === "succeeded");
    assert.strictEqual(executionEvent, undefined);
}