/**
 * Cross-platform computer-use backend dispatch test.
 *
 * Verifies the platform router in `ComputerUseTool` selects the correct
 * backend identifier on each OS without actually synthesizing input — the
 * physical-input round-trip is gated PTAC territory (s13 in --suite=full).
 *
 * - On Win32 we expect `getBackendId() === "win32"` and no non-Win32 backend.
 * - On Linux we expect either `linux-wayland` or `linux-x11` depending on
 *   `$WAYLAND_DISPLAY`.
 * - On macOS we expect `"macos"`.
 *
 * The test is non-destructive: it does not move the cursor, type, or click.
 *
 * @module tests/computer-use-cross-platform.test
 */

import assert from "node:assert/strict";
import { ComputerUseTool } from "../src/adapters/system/computer-use-tool.js";
import { AutonomousComputerAgent } from "../src/core/runtime/autonomous-computer-agent.js";
import { ActivityBus } from "../src/core/activity/bus.js";

export async function testComputerUseCrossPlatformDispatch(): Promise<void> {
    const tool = new ComputerUseTool();
    const id = tool.getBackendId();
    if (process.platform === "win32") {
        assert.equal(id, "win32", "Win32 host must select the win32 backend");
    } else if (process.platform === "linux") {
        const expectWayland = Boolean(process.env.WAYLAND_DISPLAY);
        if (expectWayland) {
            assert.equal(id, "linux-wayland", "Linux+WAYLAND_DISPLAY must select linux-wayland backend");
        } else {
            assert.equal(id, "linux-x11", "Linux without WAYLAND_DISPLAY must select linux-x11 backend");
        }
    } else if (process.platform === "darwin") {
        assert.equal(id, "macos", "macOS host must select the macos backend");
    } else {
        // Other Unixes are not supported; selection should fall through to win32 default.
        assert.equal(id, "win32", `Unsupported platform ${process.platform} should default to win32 stub`);
    }
}

export async function testAutonomousComputerAgentExecution(): Promise<void> {
    const bus = new ActivityBus();
    const agent = new AutonomousComputerAgent(bus);

    // Initialize goal
    agent.initGoal("test-goal-id", "verify echo output");

    // Execute command with async fallback
    const command = process.platform === "win32" ? "cmd /c echo hello" : "echo hello";
    const result = await agent.executeCommand(command);

    assert.ok(result.success, "Echo command should succeed");
    assert.strictEqual(result.exitCode, 0, "Exit code should be 0");
    assert.match(result.output || "", /hello/, "Output should contain 'hello'");

    // Execute invalid command and verify it fails but completes
    const invalidCommand = "invalid_command_name_that_does_not_exist";
    const resultFail = await agent.executeCommand(invalidCommand);
    assert.ok(!resultFail.success, "Invalid command should fail");
    assert.notStrictEqual(resultFail.exitCode, 0, "Exit code should not be 0");
    assert.ok(resultFail.error, "Error details should be present");
}

export async function testComputerUseCrossPlatform(): Promise<void> {
    await testComputerUseCrossPlatformDispatch();
    await testAutonomousComputerAgentExecution();
}
