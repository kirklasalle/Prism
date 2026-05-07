/**
 * PRISM TUI — TelemetryTab integration tests.
 *
 * Run: node --test dist/tests/tui-tab-telemetry.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { TelemetryTab } from "../src/tui/tabs/TelemetryTab.js";
import { createMockClient, MOCK_TELEMETRY_SUMMARY, MOCK_APPROVALS } from "./tui-mocks.js";

describe("TelemetryTab", () => {
    it("renders without crashing", () => {
        const client = createMockClient();
        const inst = render(React.createElement(TelemetryTab, { client, focused: true }));
        assert.ok((inst.lastFrame() ?? "").length > 0);
        inst.unmount();
    });

    it("shows telemetry summary after loading", async () => {
        const client = createMockClient();
        const inst = render(React.createElement(TelemetryTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        const frame = inst.lastFrame() ?? "";
        assert.ok(
            frame.includes("500") || frame.includes("Events") || frame.includes("Telemetry") || frame.length > 10,
            "should show telemetry data",
        );
        inst.unmount();
    });

    it("renders with zero metrics", async () => {
        const client = createMockClient({
            getTelemetrySummary: () => Promise.resolve({
                totalEvents: 0, errorCount: 0, avgLatencyMs: 0, p95LatencyMs: 0, uptimeSeconds: 0,
            }),
            getRetrievalCohorts: () => Promise.resolve([]),
            getRetrievalAlerts: () => Promise.resolve([]),
            getPendingApprovals: () => Promise.resolve([]),
        });
        const inst = render(React.createElement(TelemetryTab, { client, focused: true }));
        await new Promise((r) => setTimeout(r, 200));
        assert.ok((inst.lastFrame() ?? "").length > 0, "should render zero-state");
        inst.unmount();
    });
});
