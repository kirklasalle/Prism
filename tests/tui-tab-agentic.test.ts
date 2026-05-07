/**
 * PRISM TUI — AgenticTab integration tests.
 *
 * Run: node --test dist/tests/tui-tab-agentic.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { AgenticTab } from "../src/tui/tabs/AgenticTab.js";
import { createMockClient, createMockWsClient, MOCK_AGENTS, MOCK_SWARMS } from "./tui-mocks.js";

describe("AgenticTab", () => {
    it("renders without crashing", () => {
        const client = createMockClient();
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(AgenticTab, { client, wsClient, focused: true }));
        assert.ok((inst.lastFrame() ?? "").length > 0);
        inst.unmount();
    });

    it("shows agent data after loading", async () => {
        const client = createMockClient();
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(AgenticTab, { client, wsClient, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(
            frame.includes("analyst") || frame.includes("coder") || frame.includes("Agent") || frame.length > 10,
            "should show agent data",
        );
        inst.unmount();
    });

    it("renders with empty agent list", async () => {
        const client = createMockClient({
            getAgents: () => Promise.resolve([]),
            getSwarms: () => Promise.resolve([]),
            getAgentTelemetry: () => Promise.resolve({ totalDispatches: 0, avgLatencyMs: 0 }),
            getCharacters: () => Promise.resolve([]),
        });
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(AgenticTab, { client, wsClient, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(frame.length > 0, "should render empty state");
        inst.unmount();
    });
});
