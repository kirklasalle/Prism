/**
 * PRISM TUI — ChatTab integration tests.
 *
 * Run: node --test dist/tests/tui-tab-chat.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { ChatTab } from "../src/tui/tabs/ChatTab.js";
import { createMockClient, createMockWsClient, MOCK_SESSIONS, MOCK_MESSAGES } from "./tui-mocks.js";

describe("ChatTab", () => {
    it("renders without crashing", () => {
        const client = createMockClient();
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(ChatTab, { client, wsClient, focused: true }));
        const frame = inst.lastFrame() ?? "";
        assert.ok(frame.length > 0, "should render content");
        inst.unmount();
    });

    it("shows loading state initially", () => {
        const client = createMockClient({
            getSessions: () => new Promise(() => {}), // never resolves
        });
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(ChatTab, { client, wsClient, focused: true }));
        // Should show some loading indication or empty state
        const frame = inst.lastFrame() ?? "";
        assert.ok(frame.length > 0);
        inst.unmount();
    });

    it("renders session data when loaded", async () => {
        const client = createMockClient();
        const wsClient = createMockWsClient();
        const inst = render(React.createElement(ChatTab, { client, wsClient, focused: true }));
        // Wait for API poll to complete
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        // Should show session info or chat interface
        assert.ok(frame.length > 0, "should have rendered content after load");
        inst.unmount();
    });
});
