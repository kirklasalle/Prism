import assert from "node:assert";
import { ActivityBus } from "../src/core/activity/bus.js";
import {
    SchedulerEngine,
    parseCronExpression,
    getNextCronOccurrence,
    getNextNCronOccurrences,
} from "../src/core/operator/scheduler-engine.js";

export async function testParseCronExpression(): Promise<void> {
    const fields = parseCronExpression("*/15 9-17 * * 1-5");
    assert.deepStrictEqual(fields.minutes, [0, 15, 30, 45]);
    assert.deepStrictEqual(fields.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
    assert.strictEqual(fields.daysOfMonth.length, 31);
    assert.strictEqual(fields.months.length, 12);
    assert.deepStrictEqual(fields.daysOfWeek, [1, 2, 3, 4, 5]);
}

export async function testParseCronExpressionSimple(): Promise<void> {
    const fields = parseCronExpression("0 0 1 1 *");
    assert.deepStrictEqual(fields.minutes, [0]);
    assert.deepStrictEqual(fields.hours, [0]);
    assert.deepStrictEqual(fields.daysOfMonth, [1]);
    assert.deepStrictEqual(fields.months, [1]);
    assert.strictEqual(fields.daysOfWeek.length, 7);
}

export async function testParseCronExpressionInvalid(): Promise<void> {
    assert.throws(() => parseCronExpression("bad"), /Invalid cron expression/);
    assert.throws(() => parseCronExpression("* * *"), /Invalid cron expression/);
}

export async function testGetNextCronOccurrence(): Promise<void> {
    const fields = parseCronExpression("0 12 * * *");
    const after = new Date("2025-06-01T10:00:00Z");
    const next = getNextCronOccurrence(fields, after);
    assert.strictEqual(next.getHours(), 12);
    assert.strictEqual(next.getMinutes(), 0);
    assert.ok(next > after, "Next occurrence should be after the given date");
}

export async function testGetNextNCronOccurrences(): Promise<void> {
    const dates = getNextNCronOccurrences("0 9 * * 1", 3, new Date("2025-01-01T00:00:00Z"));
    assert.strictEqual(dates.length, 3);
    for (const d of dates) {
        assert.strictEqual(d.getDay(), 1, "Should be Monday");
        assert.strictEqual(d.getHours(), 9);
    }
    assert.ok(dates[1]! > dates[0]!, "Dates should be ascending");
    assert.ok(dates[2]! > dates[1]!, "Dates should be ascending");
}

export async function testSchedulerEngineScheduleOnce(): Promise<void> {
    const bus = new ActivityBus();
    const fired: string[] = [];
    const engine = new SchedulerEngine({
        activityBus: bus,
        sessionId: "test-session",
        onAction: (entry) => { fired.push(entry.id); },
    });

    const runAt = new Date(Date.now() + 100);
    const entry = engine.scheduleOnce("test-once", runAt, "test.action", { key: "val" });

    assert.ok(entry.id);
    assert.strictEqual(entry.type, "once");
    assert.strictEqual(entry.label, "test-once");
    assert.strictEqual(entry.enabled, true);
    assert.strictEqual(engine.list().length, 1);

    // Wait for it to fire
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.strictEqual(fired.length, 1);
    assert.strictEqual(fired[0], entry.id);
    // After firing, one-shot should be removed
    assert.strictEqual(engine.list().length, 0);

    engine.stop();
}

export async function testSchedulerEngineCancel(): Promise<void> {
    const bus = new ActivityBus();
    const fired: string[] = [];
    const engine = new SchedulerEngine({
        activityBus: bus,
        sessionId: "test-session",
        onAction: (entry) => { fired.push(entry.id); },
    });

    const runAt = new Date(Date.now() + 500);
    const entry = engine.scheduleOnce("cancel-test", runAt, "test.action");
    assert.strictEqual(engine.list().length, 1);

    const cancelled = engine.cancel(entry.id);
    assert.strictEqual(cancelled, true);
    assert.strictEqual(engine.list().length, 0);

    // Wait to confirm it doesn't fire
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.strictEqual(fired.length, 0);

    engine.stop();
}

export async function testSchedulerEngineRecurring(): Promise<void> {
    const bus = new ActivityBus();
    const engine = new SchedulerEngine({
        activityBus: bus,
        sessionId: "test-session",
    });

    const entry = engine.scheduleRecurring("daily-9am", "0 9 * * *", "daily.report");
    assert.ok(entry.id);
    assert.strictEqual(entry.type, "recurring");
    assert.ok(entry.nextRunAt);
    assert.strictEqual(engine.list().length, 1);

    const occs = engine.getNextOccurrences(entry.id, 5);
    assert.strictEqual(occs.length, 5);

    engine.cancel(entry.id);
    engine.stop();
}

export async function testSchedulerEngineStop(): Promise<void> {
    const bus = new ActivityBus();
    const engine = new SchedulerEngine({
        activityBus: bus,
        sessionId: "test-session",
    });

    engine.scheduleOnce("a", new Date(Date.now() + 10000), "x");
    engine.scheduleOnce("b", new Date(Date.now() + 20000), "y");
    assert.strictEqual(engine.list().length, 2);

    engine.stop();
    // Timers cleared; entries still listed
    assert.strictEqual(engine.list().length, 2);
}

export async function testSchedulerEngineActivityBusIntegration(): Promise<void> {
    const bus = new ActivityBus();
    const auditEvents: Array<{ operation: string }> = [];
    bus.subscribe({ onEvent: (e) => auditEvents.push({ operation: e.operation }) });

    const engine = new SchedulerEngine({
        activityBus: bus,
        sessionId: "test-session",
    });

    const entry = engine.scheduleOnce("audit-test", new Date(Date.now() + 100), "test.action");
    assert.ok(auditEvents.some((e) => e.operation === "scheduler.schedule_created"));

    engine.cancel(entry.id);
    assert.ok(auditEvents.some((e) => e.operation === "scheduler.schedule_cancelled"));

    engine.stop();
}
