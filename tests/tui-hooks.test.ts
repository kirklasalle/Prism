/**
 * PRISM TUI — Custom React hook tests.
 *
 * Uses ink-testing-library to render wrapper components that exercise hooks.
 *
 * Run: node --test dist/tests/tui-hooks.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React, { useEffect } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { createMockClient, createMockWsClient } from "./tui-mocks.js";

/* ================================================================== */
/*  Helper: wait for React re-render                                   */
/* ================================================================== */

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/* ================================================================== */
/*  useConnection                                                      */
/* ================================================================== */

describe("useConnection hook", () => {
    it("tracks connection state changes", async () => {
        const { useConnection } = await import("../src/tui/hooks.js");
        const wsClient = createMockWsClient();

        function TestComponent() {
            const connected = useConnection(wsClient);
            return React.createElement(Text, null, `connected:${connected}`);
        }

        const inst = render(React.createElement(TestComponent));
        assert.ok(inst.lastFrame()?.includes("connected:false"));

        // Wait for useEffect to register the event listener, then simulate connect
        await delay(100);
        wsClient.connect();
        await delay(200);

        const frameAfterConnect = inst.lastFrame() ?? "";
        assert.ok(frameAfterConnect.includes("connected:true"),
            `Expected connected:true, got: "${frameAfterConnect}"`);

        // Simulate disconnect
        wsClient.disconnect();
        await delay(200);

        const frameAfterDisconnect = inst.lastFrame() ?? "";
        assert.ok(frameAfterDisconnect.includes("connected:false"),
            `Expected connected:false, got: "${frameAfterDisconnect}"`);

        inst.unmount();
    });
});

/* ================================================================== */
/*  useWsEvent                                                         */
/* ================================================================== */

describe("useWsEvent hook", () => {
    it("receives typed events and returns last message", async () => {
        const { useWsEvent } = await import("../src/tui/hooks.js");
        const wsClient = createMockWsClient();

        function TestComponent() {
            const msg = useWsEvent(wsClient, "activity_event");
            return React.createElement(Text, null, msg ? `got:${(msg as Record<string, unknown>).action}` : "waiting");
        }

        const inst = render(React.createElement(TestComponent));
        assert.ok(inst.lastFrame()?.includes("waiting"));

        // Wait for useEffect to register the listener
        await delay(100);
        wsClient.simulateMessage("activity_event", { action: "spawn" });
        await delay(200);

        const frame1 = inst.lastFrame() ?? "";
        assert.ok(frame1.includes("got:spawn"),
            `Expected got:spawn, got: "${frame1}"`);

        wsClient.simulateMessage("activity_event", { action: "stop" });
        await delay(200);

        const frame2 = inst.lastFrame() ?? "";
        assert.ok(frame2.includes("got:stop"),
            `Expected got:stop, got: "${frame2}"`);

        inst.unmount();
    });

    it("ignores events of other types", async () => {
        const { useWsEvent } = await import("../src/tui/hooks.js");
        const wsClient = createMockWsClient();

        function TestComponent() {
            const msg = useWsEvent(wsClient, "activity_event");
            return React.createElement(Text, null, msg ? "received" : "waiting");
        }

        const inst = render(React.createElement(TestComponent));
        // Wait for useEffect to register the listener, then emit wrong type
        await delay(100);
        wsClient.simulateMessage("other_event", { data: "x" });
        await delay(200);
        assert.ok(inst.lastFrame()?.includes("waiting"));

        inst.unmount();
    });
});

/* ================================================================== */
/*  useScrollableLog                                                   */
/* ================================================================== */

describe("useScrollableLog hook", () => {
    it("appends lines and respects max limit", async () => {
        const { useScrollableLog } = await import("../src/tui/hooks.js");

        function TestComponent() {
            const { lines, append } = useScrollableLog(3);
            useEffect(() => {
                append("line1");
                append("line2");
                append("line3");
                append("line4"); // should evict line1
            }, []);
            return React.createElement(Text, null, `[${lines.join(",")}]`);
        }

        const inst = render(React.createElement(TestComponent));
        await delay(200);
        const frame = inst.lastFrame() ?? "";
        assert.ok(!frame.includes("line1"), "line1 should be evicted");
        assert.ok(frame.includes("line2"));
        assert.ok(frame.includes("line3"));
        assert.ok(frame.includes("line4"));

        inst.unmount();
    });
});
