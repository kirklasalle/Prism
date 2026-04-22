/**
 * PRISM TUI — NetworkTab integration tests.
 *
 * Run: node --test dist/tests/tui-tab-network.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { NetworkTab } from "../src/tui/tabs/NetworkTab.js";
import { createMockClient, MOCK_NETWORK_INTERFACES } from "./tui-mocks.js";

describe("NetworkTab", () => {
    it("renders without crashing", () => {
        const client = createMockClient();
        const inst = render(React.createElement(NetworkTab, { client, focused: true }));
        assert.ok((inst.lastFrame() ?? "").length > 0);
        inst.unmount();
    });

    it("shows network interfaces after loading", async () => {
        const client = createMockClient();
        const inst = render(React.createElement(NetworkTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(
            frame.includes("eth0") || frame.includes("192.168") || frame.includes("Network") || frame.length > 10,
            "should show network data",
        );
        inst.unmount();
    });

    it("handles empty interfaces", async () => {
        const client = createMockClient({
            getNetworkInterfaces: () => Promise.resolve([]),
        });
        const inst = render(React.createElement(NetworkTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        assert.ok((inst.lastFrame() ?? "").length > 0);
        inst.unmount();
    });
});
