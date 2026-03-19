import * as assert from "assert";
import { describe, it, before, after } from "mocha";
import sqlite3 from "sqlite3";
import { TerminalSessionAdapter, TerminalSessionState } from "../src/adapters/application/terminal-session-adapter.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { ActivityBus } from "../src/core/activity/bus.js";

describe("Terminal Session Adapter", function () {
    // stopSession waits 2 seconds before SIGKILL escalation.
    // Increase suite timeout to avoid false negatives.
    this.timeout(15000);

    let adapter: TerminalSessionAdapter;
    let db: sqlite3.Database;
    let policyEngine: PolicyEngine;
    let activityBus: ActivityBus;

    const shell = process.platform === "win32" ? "powershell" : "/bin/sh";

    before(async () => {
        db = new sqlite3.Database(":memory:");
        policyEngine = new PolicyEngine();
        activityBus = new ActivityBus();
        adapter = new TerminalSessionAdapter(db, policyEngine, activityBus);
    });

    after(async () => {
        await new Promise<void>((resolve, reject) => {
            db.close((err) => (err ? reject(err) : resolve()));
        });
    });

    it("starts a session with expected metadata", async () => {
        const session = await adapter.startSession(shell, process.cwd(), "test-user");

        assert.ok(session.session_id.length > 10);
        assert.strictEqual(session.shell, shell);
        assert.strictEqual(session.working_directory, process.cwd());
        assert.strictEqual(session.user, "test-user");
        assert.strictEqual(session.state, TerminalSessionState.IDLE);
        assert.ok(!!session.process_id);

        await adapter.stopSession(session.session_id);
    });

    it("returns status for active session", async () => {
        const session = await adapter.startSession(shell, process.cwd(), "status-user");

        const status = await adapter.getSessionStatus(session.session_id);
        assert.strictEqual(status.session_id, session.session_id);
        assert.strictEqual(status.user, "status-user");

        await adapter.stopSession(session.session_id);
    });

    it("throws when status requested for unknown session", async () => {
        await assert.rejects(async () => {
            await adapter.getSessionStatus("missing-session-id");
        }, /not found/);
    });

    it("throws when executing command on unknown session", async () => {
        await assert.rejects(async () => {
            await adapter.execCommand("missing-session-id", "echo hello");
        }, /not found/);
    });

    it("stops a session and blocks further status lookup", async () => {
        const session = await adapter.startSession(shell, process.cwd(), "stop-user");

        await adapter.stopSession(session.session_id);

        await assert.rejects(async () => {
            await adapter.getSessionStatus(session.session_id);
        }, /not found/);
    });

    it("revokes a session and returns revocation metadata", async () => {
        const session = await adapter.startSession(shell, process.cwd(), "revoke-user");

        const result = await adapter.revokeSession(session.session_id, "test-revoke");
        assert.strictEqual(result.session_id, session.session_id);
        assert.strictEqual(result.forced_termination, true);
        assert.strictEqual(result.cleanup_status, "completed");

        await assert.rejects(async () => {
            await adapter.getSessionStatus(session.session_id);
        }, /not found/);
    });

    it("returns empty history for a fresh session", async () => {
        const session = await adapter.startSession(shell, process.cwd(), "history-user");

        const history = await adapter.getSessionHistory(session.session_id);
        assert.deepStrictEqual(history, []);

        await adapter.stopSession(session.session_id);
    });

    it("classifies command tiers as expected", async () => {
        const classify = (adapter as any).classifyCommandTier.bind(adapter) as (command: string) => string;

        assert.strictEqual(classify("ls -la"), "tier1");
        assert.strictEqual(classify("mkdir demo"), "tier2");
        assert.strictEqual(classify("rm -rf demo"), "tier3");
        assert.strictEqual(classify("unknowncmd --flag"), "tier2");
    });

    it("emits lifecycle events to activity bus", async () => {
        const session = await adapter.startSession(shell, process.cwd(), "event-user");
        await adapter.stopSession(session.session_id);

        const events = activityBus.listEvents();
        const hasStart = events.some((event) => event.operation === "terminal_session_start" && event.status === "succeeded");
        const hasStop = events.some((event) => event.operation === "terminal_session_stop" && event.status === "succeeded");

        assert.strictEqual(hasStart, true);
        assert.strictEqual(hasStop, true);
    });

    it("persists session rows in sqlite", async () => {
        const session = await adapter.startSession(shell, process.cwd(), "db-user");

        const rowCount = await new Promise<number>((resolve, reject) => {
            db.get(
                "SELECT COUNT(*) AS count FROM terminal_sessions WHERE session_id = ?",
                [session.session_id],
                (err, row: { count: number }) => (err ? reject(err) : resolve(row.count))
            );
        });

        assert.ok(rowCount >= 1);

        await adapter.stopSession(session.session_id);
    });
});

export function testTerminalSessionAdapter(): void {
    // Integration entry point for custom runners.
}
