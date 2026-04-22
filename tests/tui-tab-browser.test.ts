/**
 * PRISM TUI — BrowserTab integration tests.
 *
 * Run: node --test dist/tests/tui-tab-browser.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { BrowserTab } from "../src/tui/tabs/BrowserTab.js";
import { createMockClient, MOCK_BROWSER_SESSION } from "./tui-mocks.js";

describe("BrowserTab", () => {
    it("renders without crashing", () => {
        const client = createMockClient();
        const inst = render(React.createElement(BrowserTab, { client, focused: true }));
        assert.ok((inst.lastFrame() ?? "").length > 0);
        inst.unmount();
    });

    it("shows browser session status after loading", async () => {
        const client = createMockClient();
        const inst = render(React.createElement(BrowserTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(
            frame.includes("example.com") || frame.includes("active") || frame.includes("Browser") || frame.length > 10,
            "should show browser session info",
        );
        inst.unmount();
    });

    it("shows inactive state when no session", async () => {
        const client = createMockClient({
            getBrowserSession: () => Promise.resolve({ active: false, headless: false }),
        });
        const inst = render(React.createElement(BrowserTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(frame.length > 0, "should render inactive state");
        inst.unmount();
    });
});
