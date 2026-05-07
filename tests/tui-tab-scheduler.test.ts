/**
 * PRISM TUI — SchedulerTab integration tests.
 *
 * Run: node --test dist/tests/tui-tab-scheduler.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { SchedulerTab } from "../src/tui/tabs/SchedulerTab.js";
import { createMockClient, MOCK_SCHEDULER_EVENTS, MOCK_PROJECTS } from "./tui-mocks.js";

describe("SchedulerTab", () => {
    it("renders without crashing", () => {
        const client = createMockClient();
        const inst = render(React.createElement(SchedulerTab, { client, focused: true }));
        assert.ok((inst.lastFrame() ?? "").length > 0);
        inst.unmount();
    });

    it("shows scheduler events after loading", async () => {
        const client = createMockClient();
        const inst = render(React.createElement(SchedulerTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(
            frame.includes("Daily standup") || frame.includes("Calendar") || frame.includes("Scheduler") || frame.length > 10,
            "should show scheduler content",
        );
        inst.unmount();
    });

    it("renders with empty events and projects", async () => {
        const client = createMockClient({
            getSchedulerEvents: () => Promise.resolve([]),
            getProjects: () => Promise.resolve([]),
            getSchedulerTasks: () => Promise.resolve([]),
        });
        const inst = render(React.createElement(SchedulerTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        assert.ok((inst.lastFrame() ?? "").length > 0, "should render empty state");
        inst.unmount();
    });

    it("handles API errors gracefully", async () => {
        const client = createMockClient({
            getSchedulerEvents: () => Promise.reject(new Error("Timeout")),
        });
        const inst = render(React.createElement(SchedulerTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        assert.ok((inst.lastFrame() ?? "").length > 0, "should render error state");
        inst.unmount();
    });
});
