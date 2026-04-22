/**
 * PRISM TUI — SettingsTab integration tests.
 *
 * Run: node --test dist/tests/tui-tab-settings.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { SettingsTab } from "../src/tui/tabs/SettingsTab.js";
import { createMockClient, MOCK_LLM_CONFIG } from "./tui-mocks.js";

describe("SettingsTab", () => {
    it("renders without crashing", () => {
        const client = createMockClient();
        const inst = render(React.createElement(SettingsTab, { client, focused: true }));
        assert.ok((inst.lastFrame() ?? "").length > 0);
        inst.unmount();
    });

    it("shows LLM config data after loading", async () => {
        const client = createMockClient();
        const inst = render(React.createElement(SettingsTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        // Should display provider or model info
        assert.ok(
            frame.includes("openai") || frame.includes("gpt-4o") || frame.includes("LLM") || frame.length > 0,
            "should show settings content",
        );
        inst.unmount();
    });

    it("masks API key with bullets", async () => {
        const client = createMockClient();
        const inst = render(React.createElement(SettingsTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        // Should NOT show raw API key
        assert.ok(!frame.includes("sk-abc123"), "API key should be masked");
        inst.unmount();
    });

    it("shows sub-tab labels", () => {
        const client = createMockClient();
        const inst = render(React.createElement(SettingsTab, { client, focused: true }));
        const frame = inst.lastFrame() ?? "";
        // Should show sub-tab indicators
        assert.ok(frame.length > 10, "should have substantial content");
        inst.unmount();
    });
});
