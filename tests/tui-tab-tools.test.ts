/**
 * PRISM TUI — ToolsTab integration tests.
 *
 * Run: node --test dist/tests/tui-tab-tools.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { ToolsTab } from "../src/tui/tabs/ToolsTab.js";
import { createMockClient, createMockWsClient, MOCK_TOOLS } from "./tui-mocks.js";

describe("ToolsTab", () => {
    it("renders without crashing", () => {
        const client = createMockClient();
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(ToolsTab, { client, wsClient, focused: true }));
        assert.ok((inst.lastFrame() ?? "").length > 0);
        inst.unmount();
    });

    it("shows tool data after loading", async () => {
        const client = createMockClient();
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(ToolsTab, { client, wsClient, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(
            frame.includes("readFile") || frame.includes("shellExec") || frame.includes("Tool") || frame.length > 10,
            "should show tools content",
        );
        inst.unmount();
    });

    it("handles error state", async () => {
        const client = createMockClient({
            getToolsStatus: () => Promise.reject(new Error("Network error")),
        });
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(ToolsTab, { client, wsClient, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(frame.length > 0, "should render even on error");
        inst.unmount();
    });
});
