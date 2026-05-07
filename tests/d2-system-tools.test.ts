import assert from "node:assert";
import { ContainerSandboxTool } from "../src/adapters/system/container-sandbox-tool.js";
import { TerminalSessionTool } from "../src/adapters/system/terminal-session-tool.js";
import { normalizeRequestByGovernance, extractActionFromRequest } from "../src/core/tools/governance-normalizer.js";

const base = {
    operation: "",
    args: {},
    risk: "low" as const,
    mutatesState: false,
};

export async function testD2SystemTools(): Promise<void> {
    await testTerminalSessionToolLifecycle();
    await testContainerSandboxToolLifecycle();
    await testGovernanceNormalization();

    console.log("✓ D2 system tools tests passed");
}

async function testTerminalSessionToolLifecycle(): Promise<void> {
    const tool = new TerminalSessionTool();

    const start = await tool.execute({
        ...base,
        risk: "medium",
        mutatesState: true,
        rollbackPlan: "stop test-session",
        args: { action: "start", sessionId: "test-session", cwd: "." },
    });
    assert.strictEqual(start.ok, true);
    assert.strictEqual(start.output["sessionId"], "test-session");
    assert.strictEqual(start.output["state"], "running");

    const exec = await tool.execute({
        ...base,
        risk: "medium",
        mutatesState: true,
        rollbackPlan: "revert exec side-effects for test-session",
        args: { action: "exec", sessionId: "test-session", command: "echo hi" },
    });
    assert.strictEqual(exec.ok, true);
    assert.strictEqual(exec.output["exitCode"], 0);
    assert.strictEqual(exec.output["simulated"], false, "P0-1: exec must no longer be simulated");
    // Verify real output from the echo command
    const stdout = String(exec.output["stdout"] ?? "").trim();
    assert.ok(stdout.includes("hi"), `Expected stdout to contain 'hi', got: '${stdout}'`);
    assert.strictEqual(exec.output["backend"], "child_process");
    assert.strictEqual(exec.sideEffects?.[0]?.action, "exec");
    assert.strictEqual(exec.sideEffects?.[0]?.mutating, true);
    assert.strictEqual(exec.sideEffects?.[0]?.reversible, true);

    const status = await tool.execute({
        ...base,
        args: { action: "status", sessionId: "test-session" },
    });
    assert.strictEqual(status.ok, true);
    assert.strictEqual(status.output["lastCommand"], "echo hi");

    const stop = await tool.execute({
        ...base,
        risk: "medium",
        mutatesState: true,
        rollbackPlan: "start test-session",
        args: { action: "stop", sessionId: "test-session" },
    });
    assert.strictEqual(stop.ok, true);
    assert.strictEqual(stop.output["state"], "stopped");

    const revoke = await tool.execute({
        ...base,
        risk: "high",
        mutatesState: true,
        rollbackPlan: "manual operator restore",
        args: { action: "revoke", sessionId: "test-session" },
    });
    assert.strictEqual(revoke.ok, true);
    assert.strictEqual(revoke.output["state"], "revoked");
}

async function testContainerSandboxToolLifecycle(): Promise<void> {
    const tool = new ContainerSandboxTool();

    const create = await tool.execute({
        ...base,
        risk: "medium",
        mutatesState: true,
        rollbackPlan: "destroy test-sandbox",
        args: {
            action: "create",
            sandboxId: "test-sandbox",
            image: "node:20-alpine",
            quotas: { cpu: "1", memoryMb: 512 },
        },
    });
    assert.strictEqual(create.ok, true);
    assert.strictEqual(create.output["sandboxId"], "test-sandbox");
    assert.strictEqual(create.output["state"], "created");

    const start = await tool.execute({
        ...base,
        risk: "medium",
        mutatesState: true,
        rollbackPlan: "stop test-sandbox",
        args: { action: "start", sandboxId: "test-sandbox" },
    });
    assert.strictEqual(start.ok, true);
    assert.strictEqual(start.output["state"], "running");

    const snapshot = await tool.execute({
        ...base,
        risk: "medium",
        mutatesState: true,
        rollbackPlan: "revert to previous snapshot",
        args: { action: "snapshot", sandboxId: "test-sandbox", snapshotId: "snap-1" },
    });
    assert.strictEqual(snapshot.ok, true);
    assert.strictEqual(snapshot.output["snapshotId"], "snap-1");
    assert.strictEqual(snapshot.sideEffects?.[0]?.action, "snapshot");

    const revert = await tool.execute({
        ...base,
        risk: "high",
        mutatesState: true,
        rollbackPlan: "restore sandbox from backup image",
        args: { action: "revert", sandboxId: "test-sandbox", snapshotId: "snap-1" },
    });
    assert.strictEqual(revert.ok, true);
    assert.strictEqual(revert.output["revertedTo"], "snap-1");

    const destroy = await tool.execute({
        ...base,
        risk: "high",
        mutatesState: true,
        rollbackPlan: "recreate from known snapshot",
        args: { action: "destroy", sandboxId: "test-sandbox" },
    });
    assert.strictEqual(destroy.ok, true);

    const statusAfterDestroy = await tool.execute({
        ...base,
        args: { action: "status", sandboxId: "test-sandbox" },
    });
    assert.strictEqual(statusAfterDestroy.ok, false);
}

async function testGovernanceNormalization(): Promise<void> {
    const terminalTool = new TerminalSessionTool();
    const containerTool = new ContainerSandboxTool();

    // Test 1: Terminal tool auto-promotes low risk to medium for mutating action
    const terminalStartLow = {
        ...base,
        risk: "low" as const,
        mutatesState: false,
        args: { action: "start" },
    };
    const { normalized: terminalNorm, normalizations: terminalNorms } = normalizeRequestByGovernance(
        terminalStartLow,
        terminalTool.governance,
    );
    assert.strictEqual(terminalNorm.risk, "medium", "Terminal start should auto-promote to medium");
    assert.ok(terminalNorms.length > 0, "Should have normalizations");
    assert.ok(terminalNorms.some((n) => n.field === "risk"), "Should normalize risk");
    assert.ok(terminalNorms.some((n) => n.field === "mutatesState"), "Should normalize mutatesState");

    // Test 2: Container tool auto-promotes low to high for destroy action
    const containerDestroyLow = {
        ...base,
        risk: "low" as const,
        mutatesState: false,
        args: { action: "destroy" },
    };
    const { normalized: containerNorm, normalizations: containerNorms } = normalizeRequestByGovernance(
        containerDestroyLow,
        containerTool.governance,
    );
    assert.strictEqual(containerNorm.risk, "high", "Container destroy should auto-promote to high");
    assert.ok(containerNorms.length > 0, "Should have normalizations");

    // Test 3: Extract action correctly
    const actionStart = extractActionFromRequest({ ...base, args: { action: "start" } });
    assert.strictEqual(actionStart, "start");

    // Test 4: Handle missing action
    const noAction = extractActionFromRequest({ ...base, args: {} });
    assert.strictEqual(noAction, null);

    // Test 5: Status action (low risk) should not be normalized
    const terminalStatusLow = {
        ...base,
        risk: "low" as const,
        mutatesState: false,
        args: { action: "status" },
    };
    const { normalized: statusNorm, normalizations: statusNorms } = normalizeRequestByGovernance(
        terminalStatusLow,
        terminalTool.governance,
    );
    assert.strictEqual(statusNorm.risk, "low", "Status should remain low");
    assert.strictEqual(statusNorms.length, 0, "Status should have no normalizations");
}
