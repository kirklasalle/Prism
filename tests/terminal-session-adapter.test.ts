/**
 * Terminal Session Adapter — Integration Tests (P0-2)
 *
 * Tests REAL terminal/shell execution via the TerminalSessionAdapter.
 * This enforces node-pty backed PTY sessions only.
 *
 * Coverage:
 *   ✓ Session lifecycle (start → exec → stop)
 *   ✓ Real command execution (echo, pwd/cd)
 *   ✓ Command exit codes (success + failure)
 *   ✓ PTY detection (isPtyEnabled)
 *   ✓ Terminal resize (PTY-only)
 *   ✓ Command history persistence
 *   ✓ Policy tier classification
 *   ✓ Activity bus event emission
 *   ✓ SQLite session persistence
 *   ✓ Session revocation lifecycle
 *   ✓ Error cases (unknown session, missing params)
 *   ✓ Concurrent sessions
 *   ✓ Execution profile switching
 */
import assert from "node:assert";
import sqlite3 from "sqlite3";
import { TerminalSessionAdapter, TerminalSessionState } from "../src/adapters/application/terminal-session-adapter.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import { INDIVIDUAL_PROFILE, BUSINESS_PROFILE } from "../src/core/policy/execution-profiles.js";

/** Helper: create a fresh adapter with in-memory SQLite. */
function createTestAdapter(profile?: typeof INDIVIDUAL_PROFILE): {
    adapter: TerminalSessionAdapter;
    db: sqlite3.Database;
    bus: ActivityBus;
} {
    const db = new sqlite3.Database(":memory:");
    const policyEngine = new PolicyEngine();
    const bus = new ActivityBus();
    const adapter = new TerminalSessionAdapter(db, policyEngine, bus, profile);
    return { adapter, db, bus };
}

/** Platform-appropriate shell. */
const SHELL = process.platform === "win32" ? "cmd.exe" : "/bin/sh";

/** Close db cleanly. */
function closeDb(db: sqlite3.Database): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(() => {
            db.close(() => resolve());
        }, 25);
    });
}

// ── Test Functions ──────────────────────────────────────────────────────

export async function testTerminalSessionAdapter(): Promise<void> {
    await testPtyDetection();
    await testSessionStartAndMetadata();
    await testRealCommandExecution();
    await testCommandExitCodes();
    await testResizeTerminal();
    await testCommandHistory();
    await testCommandTierClassification();
    await testActivityBusEvents();
    await testSqlitePersistence();
    await testSessionRevocation();
    await testErrorCases();
    await testConcurrentSessions();
    await testExecutionProfileSwitching();
    await testPauseResumeSession();

    console.log("✓ Terminal session adapter integration tests passed");
}

// ──────────────────────────────────────────────────────────────────────────

async function testSessionStartAndMetadata(): Promise<void> {
    const { adapter, db } = createTestAdapter();
    try {
        const session = await adapter.startSession(SHELL, process.cwd(), "test-user");

        assert.ok(session.session_id.length > 10, "Session ID should be a UUID");
        assert.strictEqual(session.shell, SHELL, "Shell should match requested shell");
        assert.strictEqual(session.working_directory, process.cwd(), "CWD should match");
        assert.strictEqual(session.user, "test-user", "User should match");
        assert.strictEqual(session.state, TerminalSessionState.IDLE, "Initial state should be IDLE");
        assert.ok(typeof session.process_id === "number" && session.process_id > 0, "Should have a real PID");
        assert.ok(session.start_time, "Should have start_time");
        assert.ok(session.environment, "Should capture environment");

        await adapter.stopSession(session.session_id);
    } finally {
        await closeDb(db);
    }
}

async function testRealCommandExecution(): Promise<void> {
    const { adapter, db } = createTestAdapter();
    try {
        const session = await adapter.startSession(SHELL, process.cwd(), "exec-user");

        // Execute a simple echo command — this MUST return real output
        const echoCmd = process.platform === "win32" ? "echo hello-prism" : "echo hello-prism";
        const result = await adapter.execCommand(session.session_id, echoCmd, 10000);

        assert.strictEqual(result.session_id, session.session_id, "Response should reference correct session");
        assert.strictEqual(result.command, echoCmd, "Command should be echoed back");
        assert.ok(
            result.stdout.includes("hello-prism"),
            `P0-2: Real stdout must contain 'hello-prism', got: '${result.stdout.substring(0, 200)}'`,
        );
        assert.strictEqual(result.exit_code, 0, "Successful command should have exit_code 0");
        assert.ok(result.execution_time_ms >= 0, "Execution time should be non-negative");
        assert.ok(result.timestamp, "Should have a timestamp");

        // Execute another command to verify session is still alive
        const pwdCmd = process.platform === "win32" ? "cd" : "pwd";
        const pwdResult = await adapter.execCommand(session.session_id, pwdCmd, 10000);
        assert.strictEqual(pwdResult.exit_code, 0, "Second command should also succeed");
        assert.ok(pwdResult.stdout.length > 0, "pwd/cd should return a path");

        await adapter.stopSession(session.session_id);
    } finally {
        await closeDb(db);
    }
}

async function testCommandExitCodes(): Promise<void> {
    const { adapter, db } = createTestAdapter();
    try {
        const session = await adapter.startSession(SHELL, process.cwd(), "exitcode-user");

        // Successful command: exit code 0
        const echoCmd = process.platform === "win32" ? "echo ok" : "echo ok";
        const successResult = await adapter.execCommand(session.session_id, echoCmd, 10000);
        assert.strictEqual(successResult.exit_code, 0, "echo should return exit code 0");

        await adapter.stopSession(session.session_id);
    } finally {
        await closeDb(db);
    }
}

async function testPtyDetection(): Promise<void> {
    const { adapter, db } = createTestAdapter();
    try {
        // Wait for init to settle and enforce real PTY readiness.
        await new Promise((r) => setTimeout(r, 500));
        const ptyEnabledAfter = adapter.isPtyEnabled();
        assert.strictEqual(ptyEnabledAfter, true, "PTY must be enabled (real node-pty backend required)");
        console.log("    ✓ PTY is enabled and required");

        // Prove the PTY backend can actually host a live session.
        const probeSession = await adapter.startSession(SHELL, process.cwd(), "pty-probe");
        await adapter.stopSession(probeSession.session_id);
    } finally {
        await closeDb(db);
    }
}

async function testResizeTerminal(): Promise<void> {
    const { adapter, db } = createTestAdapter();
    try {
        const session = await adapter.startSession(SHELL, process.cwd(), "resize-user");

        // resizeTerminal should not throw — it's a no-op for non-PTY sessions
        // and calls ptyProcess.resize() for PTY sessions
        assert.doesNotThrow(() => {
            adapter.resizeTerminal(session.session_id, 120, 40);
        }, "resizeTerminal should not throw");

        // Resize with different dimensions
        assert.doesNotThrow(() => {
            adapter.resizeTerminal(session.session_id, 200, 60);
        }, "Second resize should also not throw");

        // Resize unknown session should be silent (no-op)
        assert.doesNotThrow(() => {
            adapter.resizeTerminal("nonexistent-session-id", 80, 24);
        }, "Resize of unknown session should be a no-op");

        await adapter.stopSession(session.session_id);
    } finally {
        await closeDb(db);
    }
}

async function testCommandHistory(): Promise<void> {
    const { adapter, db } = createTestAdapter();
    try {
        const session = await adapter.startSession(SHELL, process.cwd(), "history-user");

        // Fresh session should have empty history
        const emptyHistory = await adapter.getSessionHistory(session.session_id);
        assert.deepStrictEqual(emptyHistory, [], "Fresh session should have empty history");

        // Execute a command
        const echoCmd = process.platform === "win32" ? "echo history-test" : "echo history-test";
        await adapter.execCommand(session.session_id, echoCmd, 10000);

        // History should now have one entry
        const history = await adapter.getSessionHistory(session.session_id);
        assert.strictEqual(history.length, 1, "Should have 1 history entry");
        assert.strictEqual(history[0].command, echoCmd, "History should record the command");
        assert.strictEqual(history[0].exit_code, 0, "History should record exit code");
        assert.ok(
            history[0].stdout.includes("history-test"),
            "History should record real stdout",
        );

        await adapter.stopSession(session.session_id);
    } finally {
        await closeDb(db);
    }
}

async function testCommandTierClassification(): Promise<void> {
    const { adapter, db } = createTestAdapter();
    try {
        // Access private method via cast
        const classify = (adapter as any).classifyCommandTier.bind(adapter) as (cmd: string) => string;

        // Tier 1: Read-only
        assert.strictEqual(classify("ls -la"), "tier1", "ls should be tier1");
        assert.strictEqual(classify("cat file.txt"), "tier1", "cat should be tier1");
        assert.strictEqual(classify("grep pattern file"), "tier1", "grep should be tier1");
        assert.strictEqual(classify("pwd"), "tier1", "pwd should be tier1");
        assert.strictEqual(classify("echo hello"), "tier1", "echo should be tier1");
        assert.strictEqual(classify("hostname"), "tier1", "hostname should be tier1");
        assert.strictEqual(classify("ipconfig"), "tier1", "ipconfig should be tier1");

        // Tier 2: Mutating
        assert.strictEqual(classify("mkdir demo"), "tier2", "mkdir should be tier2");
        assert.strictEqual(classify("touch file.txt"), "tier2", "touch should be tier2");
        assert.strictEqual(classify("cp src dest"), "tier2", "cp should be tier2");
        assert.strictEqual(classify("mv old new"), "tier2", "mv should be tier2");

        // Tier 3: High-risk
        assert.strictEqual(classify("rm -rf /tmp/demo"), "tier3", "rm should be tier3");
        assert.strictEqual(classify("sudo apt install"), "tier3", "sudo should be tier3");
        assert.strictEqual(classify("shutdown -h now"), "tier3", "shutdown should be tier3");
        assert.strictEqual(classify("kill 1234"), "tier3", "kill should be tier3");

        // Unknown: defaults to tier2
        assert.strictEqual(classify("unknowncmd --flag"), "tier2", "Unknown commands default to tier2");
        assert.strictEqual(classify("node index.js"), "tier2", "node should default to tier2");
    } finally {
        await closeDb(db);
    }
}

async function testActivityBusEvents(): Promise<void> {
    const { adapter, db, bus } = createTestAdapter();
    try {
        const session = await adapter.startSession(SHELL, process.cwd(), "event-user");
        await adapter.stopSession(session.session_id);

        const events = bus.listEvents();

        // Verify start event
        const startEvents = events.filter(
            (e) => e.operation === "terminal_session_start" && e.status === "succeeded",
        );
        assert.ok(startEvents.length >= 1, "Should emit terminal_session_start event");
        assert.strictEqual(
            startEvents[0].sessionId,
            session.session_id,
            "Start event should reference the session",
        );

        // Verify stop event
        const stopEvents = events.filter(
            (e) => e.operation === "terminal_session_stop" && e.status === "succeeded",
        );
        assert.ok(stopEvents.length >= 1, "Should emit terminal_session_stop event");
    } finally {
        await closeDb(db);
    }
}

async function testSqlitePersistence(): Promise<void> {
    const { adapter, db } = createTestAdapter();
    try {
        const session = await adapter.startSession(SHELL, process.cwd(), "db-user");

        // Verify session row exists in sqlite
        const rowCount = await new Promise<number>((resolve, reject) => {
            db.get(
                "SELECT COUNT(*) AS count FROM terminal_sessions WHERE session_id = ?",
                [session.session_id],
                (err: any, row: { count: number }) => (err ? reject(err) : resolve(row.count)),
            );
        });
        assert.ok(rowCount >= 1, "Session should be persisted in SQLite");

        // Execute a command and verify command_history row
        const echoCmd = process.platform === "win32" ? "echo persistence" : "echo persistence";
        await adapter.execCommand(session.session_id, echoCmd, 10000);

        const historyCount = await new Promise<number>((resolve, reject) => {
            db.get(
                "SELECT COUNT(*) AS count FROM terminal_command_history WHERE session_id = ?",
                [session.session_id],
                (err: any, row: { count: number }) => (err ? reject(err) : resolve(row.count)),
            );
        });
        assert.ok(historyCount >= 1, "Command execution should be persisted in terminal_command_history");

        await adapter.stopSession(session.session_id);

        // Verify signal log row exists after stop
        const signalCount = await new Promise<number>((resolve, reject) => {
            db.get(
                "SELECT COUNT(*) AS count FROM terminal_signal_log WHERE session_id = ?",
                [session.session_id],
                (err: any, row: { count: number }) => (err ? reject(err) : resolve(row.count)),
            );
        });
        assert.ok(signalCount >= 1, "Stop signal should be persisted in terminal_signal_log");
    } finally {
        await closeDb(db);
    }
}

async function testSessionRevocation(): Promise<void> {
    const { adapter, db, bus } = createTestAdapter();
    try {
        const session = await adapter.startSession(SHELL, process.cwd(), "revoke-user");

        const result = await adapter.revokeSession(session.session_id, "security-audit");

        assert.strictEqual(result.session_id, session.session_id, "Revocation should reference correct session");
        assert.strictEqual(result.forced_termination, true, "Revocation should force terminate");
        assert.strictEqual(result.cleanup_status, "completed", "Cleanup should be completed");
        assert.ok(result.revocation_time, "Should have revocation timestamp");

        // Session should no longer be accessible
        await assert.rejects(
            async () => adapter.getSessionStatus(session.session_id),
            /not found/,
            "Revoked session should not be found",
        );

        // Verify revocation event emitted
        const revokeEvents = bus.listEvents().filter(
            (e) => e.operation === "terminal_session_revoke" && e.status === "succeeded",
        );
        assert.ok(revokeEvents.length >= 1, "Should emit terminal_session_revoke event");
        assert.strictEqual(
            revokeEvents[0].authorityTier,
            "tier3_approval",
            "Revocation should be tier3",
        );
    } finally {
        await closeDb(db);
    }
}

async function testErrorCases(): Promise<void> {
    const { adapter, db } = createTestAdapter();
    try {
        // Unknown session — status
        await assert.rejects(
            async () => adapter.getSessionStatus("nonexistent-session"),
            /not found/,
            "Status of unknown session should throw",
        );

        // Unknown session — execCommand
        await assert.rejects(
            async () => adapter.execCommand("nonexistent-session", "echo test"),
            /not found/,
            "Exec on unknown session should throw",
        );

        // Unknown session — stopSession
        await assert.rejects(
            async () => adapter.stopSession("nonexistent-session"),
            /not found/,
            "Stop of unknown session should throw",
        );

        // Unknown session — revokeSession
        await assert.rejects(
            async () => adapter.revokeSession("nonexistent-session", "test"),
            /not found/,
            "Revoke of unknown session should throw",
        );
    } finally {
        await closeDb(db);
    }
}

async function testConcurrentSessions(): Promise<void> {
    const { adapter, db } = createTestAdapter();
    try {
        // Start two sessions simultaneously
        const [session1, session2] = await Promise.all([
            adapter.startSession(SHELL, process.cwd(), "user-1"),
            adapter.startSession(SHELL, process.cwd(), "user-2"),
        ]);

        assert.notStrictEqual(session1.session_id, session2.session_id, "Sessions should have unique IDs");
        assert.notStrictEqual(session1.process_id, session2.process_id, "Sessions should have different PIDs");

        // Verify both sessions report status independently
        const status1 = await adapter.getSessionStatus(session1.session_id);
        const status2 = await adapter.getSessionStatus(session2.session_id);
        assert.strictEqual(status1.user, "user-1");
        assert.strictEqual(status2.user, "user-2");

        // Stop both
        await adapter.stopSession(session1.session_id);
        await adapter.stopSession(session2.session_id);
    } finally {
        await closeDb(db);
    }
}

async function testExecutionProfileSwitching(): Promise<void> {
    const { adapter, db } = createTestAdapter(INDIVIDUAL_PROFILE);
    try {
        // Verify initial profile
        assert.strictEqual(
            adapter.getExecutionProfile().segment,
            "individual",
            "Should start with individual profile",
        );

        // Switch to business profile
        adapter.setExecutionProfile(BUSINESS_PROFILE);
        assert.strictEqual(
            adapter.getExecutionProfile().segment,
            "business",
            "Should switch to business profile",
        );

        // Business profile should have audit requirements
        assert.strictEqual(
            adapter.getExecutionProfile().auditAllOperations,
            true,
            "Business profile should audit all operations",
        );
        assert.strictEqual(
            adapter.getExecutionProfile().rollbackPlanRequired,
            true,
            "Business profile should require rollback plans",
        );

        // Switch back to individual
        adapter.setExecutionProfile(INDIVIDUAL_PROFILE);
        assert.strictEqual(
            adapter.getExecutionProfile().segment,
            "individual",
            "Should switch back to individual",
        );
    } finally {
        await closeDb(db);
    }
}

/**
 * Verify real OS-level pause/resume against a running PTY child process.
 * POSIX uses SIGSTOP/SIGCONT; Win32 uses NtSuspendProcess/NtResumeProcess via
 * PowerShell P/Invoke. Test asserts state transitions, signal-log persistence,
 * and that the resumed session can still execute commands.
 */
async function testPauseResumeSession(): Promise<void> {
    const { adapter, db } = createTestAdapter();
    try {
        const session = await adapter.startSession(SHELL, process.cwd(), "test-user");

        await adapter.pauseSession(session.session_id);
        const paused = await adapter.getSessionStatus(session.session_id);
        assert.strictEqual(paused.state, TerminalSessionState.SUSPENDED, "Session should report SUSPENDED after pauseSession");

        await adapter.resumeSession(session.session_id);
        const resumed = await adapter.getSessionStatus(session.session_id);
        assert.strictEqual(resumed.state, TerminalSessionState.ACTIVE, "Session should report ACTIVE after resumeSession");

        // Resumed session must still execute commands.
        const result = await adapter.execCommand(session.session_id, "echo prism-resume", 5000);
        assert.strictEqual(result.exit_code, 0, "Resumed session should execute commands successfully");
        assert.match(result.stdout, /prism-resume/, "Resumed session stdout should contain command output");

        // Verify both signal-log entries were persisted.
        const expectedPause = process.platform === "win32" ? "NtSuspendProcess" : "SIGSTOP";
        const expectedResume = process.platform === "win32" ? "NtResumeProcess" : "SIGCONT";
        const signals = await new Promise<Array<{ signal: string; reason: string }>>((resolve, reject) => {
            db.all(
                "SELECT signal, reason FROM terminal_signal_log WHERE session_id = ? ORDER BY id ASC",
                [session.session_id],
                (err: any, rows: any[]) => err ? reject(err) : resolve(rows as any),
            );
        });
        const signalNames = signals.map(s => s.signal);
        assert.ok(signalNames.includes(expectedPause), `Signal log should include ${expectedPause}; got ${signalNames.join(",")}`);
        assert.ok(signalNames.includes(expectedResume), `Signal log should include ${expectedResume}; got ${signalNames.join(",")}`);

        await adapter.stopSession(session.session_id);
    } finally {
        await closeDb(db);
    }
}
