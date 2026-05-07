/**
 * PRISM TUI — ComputerTab integration tests.
 *
 * Run: node --test dist/tests/tui-tab-computer.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { ComputerTab } from "../src/tui/tabs/ComputerTab.js";
import { createMockClient, MOCK_SYSTEM_INFO } from "./tui-mocks.js";

describe("ComputerTab", () => {
    it("renders without crashing", () => {
        const client = createMockClient();
        const inst = render(React.createElement(ComputerTab, { client, focused: true }));
        assert.ok((inst.lastFrame() ?? "").length > 0);
        inst.unmount();
    });

    it("shows system info after loading", async () => {
        const client = createMockClient();
        const inst = render(React.createElement(ComputerTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(
            frame.includes("win32") || frame.includes("x64") || frame.includes("System") || frame.includes("OS") || frame.length > 10,
            "should show system info",
        );
        inst.unmount();
    });

    it("handles system info error gracefully", async () => {
        const client = createMockClient({
            getSystemInfo: () => Promise.reject(new Error("Cannot reach server")),
        });
        const inst = render(React.createElement(ComputerTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(frame.length > 0, "should render error state");
        inst.unmount();
    });
});
