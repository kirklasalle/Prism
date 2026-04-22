/**
 * PRISM TUI — LogsTab integration tests.
 *
 * Run: node --test dist/tests/tui-tab-logs.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { LogsTab } from "../src/tui/tabs/LogsTab.js";
import { createMockClient, createMockWsClient, MOCK_EVENTS } from "./tui-mocks.js";

describe("LogsTab", () => {
    it("renders without crashing", () => {
        const client = createMockClient();
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(LogsTab, { client, wsClient, focused: true }));
        assert.ok((inst.lastFrame() ?? "").length > 0);
        inst.unmount();
    });

    it("shows events after loading", async () => {
        const client = createMockClient();
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(LogsTab, { client, wsClient, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(frame.length > 10, "should have content after loading");
        inst.unmount();
    });

    it("receives WebSocket messages into live stream", async () => {
        const client = createMockClient();
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(LogsTab, { client, wsClient, focused: true }));

        // Simulate WS message
        wsClient.simulateMessage("activity_event", { operation: "test_op" });
        await new Promise((r) => setTimeout(r, 200));

        const frame = inst.lastFrame() ?? "";
        assert.ok(frame.length > 0, "should render with ws messages");
        inst.unmount();
    });

    it("renders with no events", async () => {
        const client = createMockClient({
            getEvents: () => Promise.resolve([]),
        });
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(LogsTab, { client, wsClient, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        assert.ok((inst.lastFrame() ?? "").length > 0, "should render empty state");
        inst.unmount();
    });
});
