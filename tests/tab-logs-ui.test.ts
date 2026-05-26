/**
 * Frontend Unit Tests for tab-logs.js – DOM rendering logic.
 *
 * Uses jsdom to provide a minimal browser-like environment, then loads
 * tab-logs.js with a mocked dashboard-core.js so we can test:
 *   - renderEvents (event table)
 *   - renderTraceView (correlated traces + timeline)
 *   - renderActions (quick action cards)
 *   - renderApprovals (pending approval cards)
 *   - renderActionHistory (action run history table)
 *   - renderToolCallLog (tool call log table)
 *
 * Run: mocha dist/tests/tab-logs-ui.test.js --timeout 30000
 */
import { describe, it, before, after, beforeEach } from "mocha";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";

type JSDOMInstance = InstanceType<typeof JSDOM>;

/* ──── Global DOM scaffold ─────────────────────────────────────────────────────────────── */

const SCAFFOLD_HTML = `<!DOCTYPE html><html><body>
<!-- Events panel -->
<div id="events"></div>

<!-- Trace view -->
<div id="trace-view"></div>

<!-- Quick actions -->
<div id="actions"></div>

<!-- Pending approvals -->
<div id="pending"></div>

<!-- Action history -->
<div id="action-history"></div>

<!-- Tool call log -->
<div id="tool-call-log"></div>
</body></html>`;

const MOCK_DASHBOARD_CORE = `
export const state = {
  events: [],
  traceData: null,
  selectedTraceId: null,
  selectedSessionId: null,
  notice: '',
  actions: [],
  pending: [],
  actionHistory: [],
  toolCallLog: [],
  logEntries: [],
  activeTab: 'logs',
};
export function request(url, opts) { return Promise.resolve({}); }
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
export function formatRelativeTime(ts) { return ts || ''; }
export function safeIso(ts) { return ts || ''; }
export function dashboardLog() {}
export function statusBadge(action) {
  if (!action || !action.status) return '';
  return '<span class="badge">' + action.status + '</span>';
}
export function safeRenderStep(step, fn) { fn(); }
export function renderLogsPanel() {}
`;

/* ──── Module types ──────────────────────────────────────────────────────────────────────── */

interface TabLogsModule {
    renderEvents(): void;
    renderTraceView(): void;
    loadTrace(correlationId: string): Promise<void>;
    renderActions(): void;
    renderApprovals(): void;
    renderActionHistory(): void;
    renderToolCallLog(): void;
}

/* ──── Suite ───────────────────────────────────────────────────────────────────────────────── */

describe("tab-logs.js – Frontend Unit Tests", function () {
    this.timeout(30_000);

    let tmpDir: string;
    let mod: TabLogsModule;
    let dom: JSDOM;
    let mockState: Record<string, any>;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-tab-logs-ui-"));
        writeFileSync(join(tmpDir, "dashboard-core.js"), MOCK_DASHBOARD_CORE, "utf-8");
        copyFileSync(
            join(process.cwd(), "src", "core", "operator", "public", "tab-logs.js"),
            join(tmpDir, "tab-logs.js"),
        );

        dom = new JSDOM(SCAFFOLD_HTML, { url: "http://localhost" });
        (global as any).document = dom.window.document;
        (global as any).window = dom.window;
        Object.defineProperty(global, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
        (global as any).HTMLElement = dom.window.HTMLElement;
        Object.defineProperty(global, "location", { value: dom.window.location, writable: true, configurable: true });
        (global as any).URL = dom.window.URL;
        (global as any).fetch = () => Promise.reject(new Error("fetch not mocked"));

        const moduleUrl = pathToFileURL(join(tmpDir, "tab-logs.js")).href;
        mod = await import(moduleUrl) as TabLogsModule;

        const coreUrl = pathToFileURL(join(tmpDir, "dashboard-core.js")).href;
        const core = await import(coreUrl);
        mockState = core.state;
    });

    after(() => {
        delete (global as any).document;
        delete (global as any).window;
        delete (global as any).navigator;
        delete (global as any).HTMLElement;
        delete (global as any).location;
        delete (global as any).URL;
        delete (global as any).fetch;
        rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        dom.window.document.body.innerHTML = new JSDOM(SCAFFOLD_HTML).window.document.body.innerHTML;
        mockState.events = [];
        mockState.traceData = null;
        mockState.selectedTraceId = null;
        mockState.selectedSessionId = null;
        mockState.notice = "";
        mockState.actions = [];
        mockState.pending = [];
        mockState.actionHistory = [];
        mockState.toolCallLog = [];
    });

    /* ──── renderEvents ──────────────────────────────────────────────────────────────── */

    describe("renderEvents", () => {
        it("shows placeholder when events is empty", () => {
            mod.renderEvents();
            const el = dom.window.document.getElementById("events");
            assert.ok(el!.innerHTML.includes("No recent events"));
        });

        it("renders event table with correct columns", () => {
            mockState.events = [
                { timestamp: "2025-01-01T00:00:00Z", operation: "tool.call", status: "success" },
            ];
            mod.renderEvents();
            const el = dom.window.document.getElementById("events");
            assert.ok(el!.innerHTML.includes("<table"));
            assert.ok(el!.innerHTML.includes("Time"));
            assert.ok(el!.innerHTML.includes("Operation"));
            assert.ok(el!.innerHTML.includes("Status"));
        });

        it("renders multiple events as table rows", () => {
            mockState.events = [
                { timestamp: "2025-01-01T00:00:00Z", operation: "tool.call", status: "success" },
                { timestamp: "2025-01-01T00:01:00Z", operation: "agent.loop", status: "running" },
                { timestamp: "2025-01-01T00:02:00Z", operation: "governance.check", status: "approved" },
            ];
            mod.renderEvents();
            const el = dom.window.document.getElementById("events");
            assert.ok(el!.innerHTML.includes("tool.call"));
            assert.ok(el!.innerHTML.includes("agent.loop"));
            assert.ok(el!.innerHTML.includes("governance.check"));
            const rowCount = (el!.innerHTML.match(/<tr>/g) || []).length;
            // 1 header row + 3 data rows
            assert.strictEqual(rowCount, 4);
        });

        it("escapes HTML in event data", () => {
            mockState.events = [
                { timestamp: "2025-01-01T00:00:00Z", operation: "<script>evil</script>", status: "fail" },
            ];
            mod.renderEvents();
            const el = dom.window.document.getElementById("events");
            assert.ok(!el!.innerHTML.includes("<script>evil</script>"));
            assert.ok(el!.innerHTML.includes("&lt;script&gt;"));
        });
    });

    /* ──── renderTraceView ───────────────────────────────────────────────────────────── */

    describe("renderTraceView", () => {
        it("shows placeholder when traceData is null", () => {
            mod.renderTraceView();
            const el = dom.window.document.getElementById("trace-view");
            assert.ok(el!.innerHTML.includes("No correlated traces"));
        });

        it("shows placeholder for empty traces array", () => {
            mockState.traceData = { traces: [] };
            mod.renderTraceView();
            const el = dom.window.document.getElementById("trace-view");
            assert.ok(el!.innerHTML.includes("No correlated traces"));
        });

        it("renders trace table with correlation IDs", () => {
            mockState.traceData = {
                traces: [
                    { correlationId: "corr-abc-123", eventCount: 5, status: "complete", lastAt: "2025-01-01T00:00:00Z", failures: 0 },
                    { correlationId: "corr-def-456", eventCount: 3, status: "running", lastAt: "2025-01-01T00:01:00Z", failures: 1 },
                ],
                selectedTraceEvents: [],
            };
            mod.renderTraceView();
            const el = dom.window.document.getElementById("trace-view");
            assert.ok(el!.innerHTML.includes("corr-abc-123"));
            assert.ok(el!.innerHTML.includes("corr-def-456"));
            assert.ok(el!.innerHTML.includes("View"), "Should have View buttons");
        });

        it("shows failure count when failures > 0", () => {
            mockState.traceData = {
                traces: [
                    { correlationId: "corr-1", eventCount: 4, status: "error", lastAt: "2025-01-01T00:00:00Z", failures: 2 },
                ],
                selectedTraceEvents: [],
            };
            mod.renderTraceView();
            const el = dom.window.document.getElementById("trace-view");
            assert.ok(el!.innerHTML.includes("2 failed"));
        });

        it("renders selected trace timeline events", () => {
            mockState.selectedTraceId = "corr-abc";
            mockState.traceData = {
                traces: [
                    { correlationId: "corr-abc", eventCount: 2, status: "complete", lastAt: "2025-01-01T00:00:00Z", failures: 0 },
                ],
                selectedTraceEvents: [
                    { timestamp: "2025-01-01T00:00:00Z", operation: "step.1", status: "ok" },
                    { timestamp: "2025-01-01T00:00:01Z", operation: "step.2", status: "ok" },
                ],
            };
            mod.renderTraceView();
            const el = dom.window.document.getElementById("trace-view");
            assert.ok(el!.innerHTML.includes("step.1"));
            assert.ok(el!.innerHTML.includes("step.2"));
            assert.ok(el!.innerHTML.includes("Trace timeline"));
        });

        it("shows 'Viewing' button for currently selected trace", () => {
            mockState.selectedTraceId = "corr-abc";
            mockState.traceData = {
                traces: [
                    { correlationId: "corr-abc", eventCount: 1, status: "done", lastAt: "2025-01-01T00:00:00Z", failures: 0 },
                ],
                selectedTraceEvents: [],
            };
            mod.renderTraceView();
            const el = dom.window.document.getElementById("trace-view");
            assert.ok(el!.innerHTML.includes("Viewing"));
        });
    });

    /* ──── renderActions ─────────────────────────────────────────────────────────────── */

    describe("renderActions", () => {
        it("shows placeholder when actions is empty", () => {
            mod.renderActions();
            const el = dom.window.document.getElementById("actions");
            assert.ok(el!.innerHTML.includes("No dashboard actions"));
        });

        it("renders action cards with label and description", () => {
            mockState.actions = [
                { name: "restart", label: "Restart Agent", description: "Restart the agent process", status: "idle" },
                { name: "clear-cache", label: "Clear Cache", description: "Clears all cached data", status: "idle" },
            ];
            mod.renderActions();
            const el = dom.window.document.getElementById("actions");
            assert.ok(el!.innerHTML.includes("Restart Agent"));
            assert.ok(el!.innerHTML.includes("Clear Cache"));
            assert.ok(el!.innerHTML.includes("Restart the agent process"));
            assert.ok(el!.innerHTML.includes("Clears all cached data"));
        });

        it("includes Run button with action name as data attribute", () => {
            mockState.actions = [
                { name: "test-action", label: "Test", description: "A test action", status: "idle" },
            ];
            mod.renderActions();
            const el = dom.window.document.getElementById("actions");
            assert.ok(el!.innerHTML.includes("Run"));
            assert.ok(el!.innerHTML.includes("runAction"));
            assert.ok(el!.innerHTML.includes("test-action"));
        });

        it("disables Run button when action is running", () => {
            mockState.actions = [
                { name: "busy", label: "Busy Action", description: "Currently running", status: "running" },
            ];
            mod.renderActions();
            const el = dom.window.document.getElementById("actions");
            assert.ok(el!.innerHTML.includes("disabled"));
        });

        it("shows lastMessage when present", () => {
            mockState.actions = [
                { name: "a", label: "A", description: "desc", status: "idle", lastMessage: "Completed in 2s" },
            ];
            mod.renderActions();
            const el = dom.window.document.getElementById("actions");
            assert.ok(el!.innerHTML.includes("Completed in 2s"));
        });

        it("shows lastError when present", () => {
            mockState.actions = [
                { name: "a", label: "A", description: "desc", status: "idle", lastError: "Timeout exceeded" },
            ];
            mod.renderActions();
            const el = dom.window.document.getElementById("actions");
            assert.ok(el!.innerHTML.includes("Timeout exceeded"));
        });

        it("displays notice when state.notice is set", () => {
            mockState.notice = "System alert: maintenance window";
            mockState.actions = [
                { name: "a", label: "A", description: "desc", status: "idle" },
            ];
            mod.renderActions();
            const el = dom.window.document.getElementById("actions");
            assert.ok(el!.innerHTML.includes("System alert: maintenance window"));
        });
    });

    /* ──── renderApprovals ──────────────────────────────────────────────────────────── */

    describe("renderApprovals", () => {
        it("shows placeholder when pending is empty", () => {
            mod.renderApprovals();
            const el = dom.window.document.getElementById("pending");
            assert.ok(el!.innerHTML.includes("No pending approvals"));
        });

        it("renders approval cards with operation and ID", () => {
            mockState.pending = [
                { id: "req-001", operation: "file.write /etc/config" },
                { id: "req-002", operation: "network.request https://api.example.com" },
            ];
            mod.renderApprovals();
            const el = dom.window.document.getElementById("pending");
            assert.ok(el!.innerHTML.includes("file.write /etc/config"));
            assert.ok(el!.innerHTML.includes("req-001"));
            assert.ok(el!.innerHTML.includes("network.request"));
            assert.ok(el!.innerHTML.includes("req-002"));
        });

        it("includes Approve and Deny buttons", () => {
            mockState.pending = [
                { id: "req-001", operation: "test.op" },
            ];
            mod.renderApprovals();
            const el = dom.window.document.getElementById("pending");
            assert.ok(el!.innerHTML.includes("Approve"));
            assert.ok(el!.innerHTML.includes("Deny"));
            assert.ok(el!.innerHTML.includes("approve("));
            assert.ok(el!.innerHTML.includes("deny("));
        });

        it("passes approval ID as data attribute", () => {
            mockState.pending = [
                { id: "xyz-789", operation: "op" },
            ];
            mod.renderApprovals();
            const el = dom.window.document.getElementById("pending");
            assert.ok(el!.innerHTML.includes("xyz-789"));
        });
    });

    /* ──── renderActionHistory ───────────────────────────────────────────────────────── */

    describe("renderActionHistory", () => {
        it("shows placeholder when actionHistory is empty", () => {
            mod.renderActionHistory();
            const el = dom.window.document.getElementById("action-history");
            assert.ok(el!.innerHTML.includes("No action runs recorded"));
        });

        it("renders history table with action details", () => {
            mockState.actionHistory = [
                { label: "Restart", status: "success", startedAt: "2025-01-01T00:00:00Z", message: "Done" },
                { label: "Deploy", status: "failed", startedAt: "2025-01-01T00:01:00Z", error: "Timeout" },
            ];
            mod.renderActionHistory();
            const el = dom.window.document.getElementById("action-history");
            assert.ok(el!.innerHTML.includes("<table"));
            assert.ok(el!.innerHTML.includes("Restart"));
            assert.ok(el!.innerHTML.includes("Deploy"));
            assert.ok(el!.innerHTML.includes("success"));
            assert.ok(el!.innerHTML.includes("failed"));
        });

        it("shows message or error in outcome column", () => {
            mockState.actionHistory = [
                { label: "A", status: "ok", startedAt: "2025-01-01T00:00:00Z", message: "All good" },
                { label: "B", status: "fail", startedAt: "2025-01-01T00:01:00Z", error: "Connection refused" },
            ];
            mod.renderActionHistory();
            const el = dom.window.document.getElementById("action-history");
            assert.ok(el!.innerHTML.includes("All good"));
            assert.ok(el!.innerHTML.includes("Connection refused"));
        });

        it("caps display at 8 entries", () => {
            mockState.actionHistory = Array.from({ length: 15 }, (_, i) => ({
                label: "Action" + i,
                status: "ok",
                startedAt: "2025-01-01T00:00:00Z",
                message: "msg" + i,
            }));
            mod.renderActionHistory();
            const el = dom.window.document.getElementById("action-history");
            // Should have 8 data rows + 1 header row = 9 <tr> tags
            const rowCount = (el!.innerHTML.match(/<tr>/g) || []).length;
            assert.ok(rowCount <= 9, `Expected <= 9 rows (1 header + 8 data), got ${rowCount}`);
        });
    });

    /* ──── renderToolCallLog ──────────────────────────────────────────────────────────── */

    describe("renderToolCallLog", () => {
        it("shows placeholder when toolCallLog is empty", () => {
            mod.renderToolCallLog();
            const el = dom.window.document.getElementById("tool-call-log");
            assert.ok(el!.innerHTML.includes("No tool calls recorded"));
        });

        it("renders table with tool call entries", () => {
            mockState.toolCallLog = [
                { name: "readFile", timestamp: "2025-01-01T00:00:00Z", iteration: 1, arguments: { path: "/foo" }, output: "file content", ok: true },
                { name: "writeFile", timestamp: "2025-01-01T00:00:01Z", iteration: 2, arguments: { path: "/bar" }, output: "written", ok: false },
            ];
            mod.renderToolCallLog();
            const el = dom.window.document.getElementById("tool-call-log");
            assert.ok(el!.innerHTML.includes("<table"));
            assert.ok(el!.innerHTML.includes("readFile"));
            assert.ok(el!.innerHTML.includes("writeFile"));
            assert.ok(el!.innerHTML.includes("/foo"));
        });

        it("shows ok/fail status indicators", () => {
            mockState.toolCallLog = [
                { name: "tool1", ok: true },
                { name: "tool2", ok: false },
            ];
            mod.renderToolCallLog();
            const el = dom.window.document.getElementById("tool-call-log");
            assert.ok(el!.innerHTML.includes("ok") || el!.innerHTML.includes("✓"));
            assert.ok(el!.innerHTML.includes("fail") || el!.innerHTML.includes("✗"));
        });

        it("shows pending status when ok is undefined", () => {
            mockState.toolCallLog = [
                { name: "pendingTool", timestamp: "2025-01-01T00:00:00Z" },
            ];
            mod.renderToolCallLog();
            const el = dom.window.document.getElementById("tool-call-log");
            assert.ok(el!.innerHTML.includes("pending"));
        });

        it("truncates long output at 300 chars", () => {
            const longOutput = "z".repeat(400);
            mockState.toolCallLog = [
                { name: "tool1", output: longOutput, ok: true },
            ];
            mod.renderToolCallLog();
            const el = dom.window.document.getElementById("tool-call-log");
            assert.ok(!el!.innerHTML.includes("z".repeat(400)));
            assert.ok(el!.innerHTML.includes("z".repeat(300)));
        });

        it("renders iteration numbers", () => {
            mockState.toolCallLog = [
                { name: "tool1", iteration: 7, ok: true },
            ];
            mod.renderToolCallLog();
            const el = dom.window.document.getElementById("tool-call-log");
            assert.ok(el!.innerHTML.includes("7"));
        });

        it("handles entries with empty arguments", () => {
            mockState.toolCallLog = [
                { name: "noArgs", arguments: {}, ok: true },
            ];
            mod.renderToolCallLog();
            const el = dom.window.document.getElementById("tool-call-log");
            assert.ok(el!.innerHTML.includes("noArgs"));
            // Should show "-" placeholder for empty args
            assert.ok(el!.innerHTML.includes("-"));
        });
    });
});
