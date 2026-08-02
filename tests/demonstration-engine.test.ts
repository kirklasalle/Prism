/**
 * Tests for DemonstrationEngine — Step-Through mode, advance, auto mode, report generation, and chat integration.
 */

import assert from "node:assert";
import { test, describe, it, beforeEach } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import type { ToolRequest, ToolResult } from "../src/core/tools/types.js";
import { DemonstrationEngine } from "../src/core/runtime/demonstration-engine.js";

describe("DemonstrationEngine", () => {
    let activityBus: ActivityBus;
    let registry: ToolRegistry;
    let engine: DemonstrationEngine;

    beforeEach(() => {
        activityBus = new ActivityBus();
        registry = new ToolRegistry();
        engine = new DemonstrationEngine(activityBus, registry);
    });

    it("initializes with Step-Through mode as default", () => {
        const state = engine.getState();
        assert.strictEqual(state.status, "idle");
        assert.strictEqual(state.playbackMode, "step-through");
        assert.strictEqual(state.stepTimeoutMs, 30000);
    });

    it("allows setting playback mode and step timeout", () => {
        engine.setPlaybackMode("auto");
        assert.strictEqual(engine.getState().playbackMode, "auto");

        engine.setStepTimeout(15000);
        assert.strictEqual(engine.getState().stepTimeoutMs, 15000);
    });

    it("provides full list of definitions including 43 scenarios", () => {
        const defs = engine.getDefinitions();
        assert.ok(defs.length > 9, "Should include interactive demos + benchmark scenarios");
        const scenarioDefs = defs.filter((d) => d.category === "scenario-suite");
        assert.ok(scenarioDefs.length >= 43, `Expected at least 43 scenarios, found ${scenarioDefs.length}`);

        const multiPageDemo = defs.find((demo) => demo.id === "browser-2");
        const pageTwoStep = multiPageDemo?.steps.find((step) => step.id === "b2-4");
        assert.strictEqual(pageTwoStep?.args.url, "https://example.org");
    });

    it("reads the canonical startup script from the PRISM installation", async () => {
        let requestedPath = "";
        registry = new ToolRegistry();
        registry.register({
            name: "file_read",
            async execute(request: ToolRequest): Promise<ToolResult> {
                requestedPath = String(request.args.path);
                return { ok: true, output: { content: "startup" } };
            },
        });
        engine = new DemonstrationEngine(activityBus, registry);

        await (engine as any).executeStep({
            action: "tool:file_read",
            args: { path: "start_web.bat" },
            narration: "",
            id: "c3-2",
            automated: true,
        });

        assert.ok(requestedPath.endsWith(`${path.sep}start_web.bat`));
        assert.ok(existsSync(requestedPath));
        assert.ok(!requestedPath.includes(`${path.sep}workspace${path.sep}`));
    });

    it("defers owned browser cleanup when Stop is requested", async () => {
        const calls: ToolRequest[] = [];
        registry = new ToolRegistry();
        registry.register({
            name: "browser_control",
            async execute(request: ToolRequest): Promise<ToolResult> {
                calls.push(request);
                return { ok: true, output: {} };
            },
        });
        engine = new DemonstrationEngine(activityBus, registry);
        (engine as any).demoBrowserSessions = [{ id: "browser-active", headless: false, owned: true }];

        engine.stop();
        await new Promise((resolve) => setImmediate(resolve));

        assert.strictEqual(calls.filter((call) => call.args.action === "close_session").length, 0);
    });

    it("closes only Demo-owned headed browsers after successful browser use", async () => {
        const calls: ToolRequest[] = [];
        registry = new ToolRegistry();
        registry.register({
            name: "browser_control",
            async execute(request: ToolRequest): Promise<ToolResult> {
                calls.push(request);
                return { ok: true, output: { closed: true } };
            },
        });
        engine = new DemonstrationEngine(activityBus, registry);
        (engine as any).demoBrowserSessions = [
            { id: "owned-headed", headless: false, owned: true },
            { id: "owned-headless", headless: true, owned: true },
            { id: "operator-headed", headless: false, owned: false },
        ];

        await (engine as any).closeOwnedHeadedBrowserSessions();

        assert.deepStrictEqual(
            calls.filter((call) => call.args.action === "close_session").map((call) => call.args.sessionId),
            ["owned-headed"],
        );
        assert.deepStrictEqual(
            (engine as any).demoBrowserSessions.map((session: any) => session.id),
            ["owned-headless", "operator-headed"],
        );
        assert.strictEqual(engine.getState().log.at(-1)?.status, "succeeded");
    });

    it("executes headed and headless browser sessions and persists both screenshots", async () => {
        const calls: ToolRequest[] = [];
        const broadcasts: Array<Record<string, unknown>> = [];
        let launchCount = 0;
        registry = new ToolRegistry();
        registry.register({
            name: "browser_control",
            async execute(request: ToolRequest): Promise<ToolResult> {
                calls.push(request);
                const action = String(request.args.action);
                if (action === "list_sessions") return { ok: true, output: { sessions: [] } };
                if (action === "launch_session") {
                    launchCount += 1;
                    return { ok: true, output: { id: `browser-test-${launchCount}`, headless: request.args.headless } };
                }
                if (action === "navigate") return { ok: true, output: { url: request.args.url, title: "Example Domain" } };
                if (action === "screenshot") {
                    const imageBytes = Buffer.from(`png-${String(request.args.sessionId)}`);
                    return { ok: true, output: { base64: imageBytes.toString("base64"), sizeBytes: imageBytes.length } };
                }
                return { ok: true, output: {} };
            },
        });
        engine = new DemonstrationEngine(activityBus, registry);
        engine.setBroadcast((message) => broadcasts.push(message));

        const executeStep = (step: Record<string, unknown>) => (engine as any).executeStep(step);
        const opened = await executeStep({ action: "demo:browser_open", args: {}, narration: "", id: "open", automated: true });
        assert.match(opened.output, /Headed session launched/);
        assert.match(opened.output, /Headless session launched/);

        await executeStep({ action: "demo:browser_navigate", args: { url: "https://example.com" }, narration: "", id: "nav", automated: true });
        const captured = await executeStep({ action: "demo:browser_screenshot", args: {}, narration: "", id: "shot", automated: true });
        (engine as any).state.log.push({
            timestamp: new Date().toISOString(),
            demoId: "browser-test",
            stepId: "shot",
            narration: "Captured browser evidence",
            action: "demo:browser_screenshot",
            args: {},
            status: "succeeded",
            durationMs: 1,
            output: captured.output,
            screenshotPath: captured.screenshotPath,
        });
        const reports = engine.generateReports();
        const reportHtml = readFileSync(reports.htmlPath, "utf-8");

        const launches = calls.filter((call) => call.args.action === "launch_session");
        assert.deepStrictEqual(launches.map((call) => call.args.headless), [false, true]);
        assert.deepStrictEqual(launches.map((call) => call.args.alwaysOnTop), [true, false]);
        assert.deepStrictEqual(launches.map((call) => call.args.idleTimeoutMs), [0, 0]);
        assert.strictEqual(calls.filter((call) => call.args.action === "navigate").length, 2);
        assert.strictEqual(calls.filter((call) => call.args.action === "screenshot").length, 2);
        assert.ok(existsSync(captured.screenshotPath));
        assert.match(captured.screenshotDataUrl, /^data:image\/png;base64,/);
        assert.match(reportHtml, /demo:browser_screenshot/);
        assert.match(reportHtml, /data:image\/png;base64,/);
        const headlessFocus = broadcasts.filter((message) =>
            message.type === "demo_browser_session_focus" && message.headless === true,
        );
        assert.deepStrictEqual(
            headlessFocus.map((message) => `${String(message.operation)}:${String(message.phase)}`),
            ["navigate:started", "navigate:succeeded", "screenshot:started", "screenshot:succeeded"],
        );
    });

    it("generates Markdown and HTML reports in workspace/Demo_results/", () => {
        const reports = engine.generateReports();
        assert.ok(reports.mdPath.endsWith(".md"));
        assert.ok(reports.htmlPath.endsWith(".html"));
        assert.ok(existsSync(reports.mdPath), `Markdown report file should exist at ${reports.mdPath}`);
        assert.ok(existsSync(reports.htmlPath), `HTML report file should exist at ${reports.htmlPath}`);

        const mdContent = readFileSync(reports.mdPath, "utf-8");
        assert.ok(mdContent.includes("PRISM Demonstration Executive Report"));
        assert.ok(mdContent.includes("Kirk LaSalle"));
    });

    it("triggers onCompleteCallback when demonstration sequence finishes", async () => {
        let callbackTriggered = false;
        engine.setOnCompleteCallback(async (reports) => {
            callbackTriggered = true;
            assert.ok(reports.mdPath);
            assert.ok(reports.htmlPath);
        });

        engine.setPlaybackMode("auto");
        engine.setSpeed(100);

        await engine.start({}, ["self-control"], "auto");
        assert.strictEqual(callbackTriggered, true, "onCompleteCallback should have fired");
    });
});
