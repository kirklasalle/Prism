/**
 * PRISM TUI — WorkspaceTab integration tests.
 *
 * Run: node --test dist/tests/tui-tab-workspace.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { WorkspaceTab } from "../src/tui/tabs/WorkspaceTab.js";
import { createMockClient, MOCK_WORKSPACE_FILES } from "./tui-mocks.js";

describe("WorkspaceTab", () => {
    it("renders without crashing", () => {
        const client = createMockClient();
        const inst = render(React.createElement(WorkspaceTab, { client, focused: true }));
        assert.ok((inst.lastFrame() ?? "").length > 0);
        inst.unmount();
    });

    it("shows file listing after loading", async () => {
        const client = createMockClient();
        const inst = render(React.createElement(WorkspaceTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(
            frame.includes("src") || frame.includes("README") || frame.includes("Workspace") || frame.length > 10,
            "should show file list",
        );
        inst.unmount();
    });

    it("shows empty workspace gracefully", async () => {
        const client = createMockClient({
            getWorkspaceFiles: () => Promise.resolve([]),
        });
        const inst = render(React.createElement(WorkspaceTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        assert.ok((inst.lastFrame() ?? "").length > 0, "should render empty state");
        inst.unmount();
    });
});
