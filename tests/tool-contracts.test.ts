import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { ActivityBus } from "../src/core/activity/bus.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { Orchestrator } from "../src/core/runtime/orchestrator.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import type { Tool, ToolRequest, ToolResult } from "../src/core/tools/types.js";
import { ShellTool } from "../src/adapters/system/shell-tool.js";
import { validateToolContract, validateToolRequestAgainstContract } from "../src/core/tools/contracts.js";
import type { ToolContract } from "../src/core/tools/contracts.js";

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
    await testValidContractPassesValidation();
    await testMissingArgsSchemaFails();
    await testUnsupportedArgTypeFails();
    await testEnumOnNonStringFails();
    await testRequestMissingRequiredArg();
    await testRequestTypeMismatch();
    await testRequestEnumViolation();
    await testRequestPassesValidContract();

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

async function testValidContractPassesValidation(): Promise<void> {
    const contract: ToolContract = {
        version: "1.0.0",
        args: {
            query: { type: "string", required: true },
            limit: { type: "number", required: false },
        },
    };
    const errors = validateToolContract("test_tool", contract);
    assert.strictEqual(errors.length, 0, `Expected no errors, got: ${errors.join(", ")}`);
}

async function testMissingArgsSchemaFails(): Promise<void> {
    const contract = {
        version: "1.0.0",
        args: null,
    } as unknown as ToolContract;
    const errors = validateToolContract("bad_args", contract);
    assert.ok(errors.length > 0, "Expected errors for null args schema");
    assert.ok(errors.some(e => e.includes("args schema")));
}

async function testUnsupportedArgTypeFails(): Promise<void> {
    const contract: ToolContract = {
        version: "1.0.0",
        args: {
            data: { type: "function" as any, required: true },
        },
    };
    const errors = validateToolContract("bad_type", contract);
    assert.ok(errors.length > 0, "Expected error for unsupported arg type");
    assert.ok(errors.some(e => e.includes("unsupported type")));
}

async function testEnumOnNonStringFails(): Promise<void> {
    const contract: ToolContract = {
        version: "1.0.0",
        args: {
            count: { type: "number", required: true, enum: ["a", "b"] as any },
        },
    };
    const errors = validateToolContract("enum_mismatch", contract);
    assert.ok(errors.length > 0, "Expected error for enum on non-string type");
    assert.ok(errors.some(e => e.includes("enum")));
}

async function testRequestMissingRequiredArg(): Promise<void> {
    const contract: ToolContract = {
        version: "1.0.0",
        args: {
            command: { type: "string", required: true },
        },
    };
    const errors = validateToolRequestAgainstContract(
        { operation: "test", args: {}, risk: "low", mutatesState: false },
        contract,
    );
    assert.ok(errors.length > 0, "Expected error for missing required arg");
    assert.ok(errors.some(e => e.includes('Missing required arg "command"')));
}

async function testRequestTypeMismatch(): Promise<void> {
    const contract: ToolContract = {
        version: "1.0.0",
        args: {
            count: { type: "number", required: true },
        },
    };
    const errors = validateToolRequestAgainstContract(
        { operation: "test", args: { count: "not_a_number" }, risk: "low", mutatesState: false },
        contract,
    );
    assert.ok(errors.length > 0, "Expected error for type mismatch");
    assert.ok(errors.some(e => e.includes("expected number")));
}

async function testRequestEnumViolation(): Promise<void> {
    const contract: ToolContract = {
        version: "1.0.0",
        args: {
            mode: { type: "string", required: true, enum: ["fast", "balanced", "governed"] },
        },
    };
    const errors = validateToolRequestAgainstContract(
        { operation: "test", args: { mode: "turbo" }, risk: "low", mutatesState: false },
        contract,
    );
    assert.ok(errors.length > 0, "Expected error for enum violation");
    assert.ok(errors.some(e => e.includes("must be one of")));
}

async function testRequestPassesValidContract(): Promise<void> {
    const contract: ToolContract = {
        version: "1.0.0",
        args: {
            query: { type: "string", required: true },
            verbose: { type: "boolean", required: false },
        },
    };
    const errors = validateToolRequestAgainstContract(
        { operation: "test", args: { query: "hello", verbose: true }, risk: "low", mutatesState: false },
        contract,
    );
    assert.strictEqual(errors.length, 0, `Expected no errors, got: ${errors.join(", ")}`);
}