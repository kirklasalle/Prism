import assert from "node:assert";
import { ActivityBus } from "../src/core/activity/bus.js";
import type { ActivityEvent } from "../src/core/activity/types.js";

export async function testActivityBus(): Promise<void> {
    const bus = new ActivityBus();
    const receivedEvents: ActivityEvent[] = [];

    // Subscribe to collect events
    bus.subscribe({
        onEvent(event: ActivityEvent): void {
            receivedEvents.push(event);
        },
    });

    // Emit an event
    const emitted = bus.emit({
        sessionId: "test-session-1",
        layer: "tool_execution",
        operation: "file_list",
        status: "started",
        details: { args: { path: "." } },
    });

    // Test: event was assigned id and timestamp
    assert.ok(emitted.id);
    assert.ok(emitted.timestamp);
    assert.ok(emitted.hash);

    // Test: subscriber received the event
    assert.strictEqual(receivedEvents.length, 1);
    assert.strictEqual(receivedEvents[0]!.id, emitted.id);
    assert.strictEqual(receivedEvents[0]!.operation, "file_list");

    // Test: bus can list all events
    const allEvents = bus.listEvents();
    assert.strictEqual(allEvents.length, 1);
    assert.strictEqual(allEvents[0]!.id, emitted.id);

    // Test: multiple events
    const emitted2 = bus.emit({
        sessionId: "test-session-1",
        layer: "governance",
        operation: "file_list.policy_check",
        status: "succeeded",
        details: { tier: "tier1_autonomous" },
    });

    assert.strictEqual(bus.listEvents().length, 2);
    assert.strictEqual(receivedEvents.length, 2);

    // Test: hash is unique per event
    assert.notStrictEqual(emitted.hash, emitted2.hash);

    console.log("✓ ActivityBus tests passed");
}
