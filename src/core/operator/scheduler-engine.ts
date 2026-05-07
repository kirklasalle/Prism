/**
 * Scheduler Engine — programmatic scheduling with cron-expression support.
 *
 * Manages recurring and one-time scheduled events using Node.js timers.
 * Supports human-readable cron expressions (parsed in-process, no OS cron).
 * Integrates with ActivityBus for audit trail on every scheduled action.
 */
import { randomUUID } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";

// ──────────────────────────────────────────────────────────────────────────────
// Cron Expression Parser (lightweight, in-process)
// Supports: minute hour dayOfMonth month dayOfWeek
//   * = any, N = specific, N-M = range, */N = step, N,M = list
// ──────────────────────────────────────────────────────────────────────────────

interface CronFields {
    minutes: number[];
    hours: number[];
    daysOfMonth: number[];
    months: number[];
    daysOfWeek: number[];
}

function expandCronField(field: string, min: number, max: number): number[] {
    const results = new Set<number>();
    for (const part of field.split(",")) {
        const stepMatch = part.match(/^(.+)\/(\d+)$/);
        if (stepMatch) {
            const step = parseInt(stepMatch[2], 10);
            const base = stepMatch[1] === "*" ? `${min}-${max}` : stepMatch[1];
            const rangeMatch = base.match(/^(\d+)-(\d+)$/);
            if (rangeMatch) {
                const lo = parseInt(rangeMatch[1], 10);
                const hi = parseInt(rangeMatch[2], 10);
                for (let i = lo; i <= hi; i += step) results.add(i);
            } else {
                const start = parseInt(base, 10);
                for (let i = start; i <= max; i += step) results.add(i);
            }
        } else if (part === "*") {
            for (let i = min; i <= max; i++) results.add(i);
        } else if (part.includes("-")) {
            const [lo, hi] = part.split("-").map(Number);
            for (let i = lo; i <= hi; i++) results.add(i);
        } else {
            results.add(parseInt(part, 10));
        }
    }
    return [...results].filter((n) => n >= min && n <= max).sort((a, b) => a - b);
}

export function parseCronExpression(expression: string): CronFields {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
        throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
    }
    return {
        minutes: expandCronField(parts[0], 0, 59),
        hours: expandCronField(parts[1], 0, 23),
        daysOfMonth: expandCronField(parts[2], 1, 31),
        months: expandCronField(parts[3], 1, 12),
        daysOfWeek: expandCronField(parts[4], 0, 6),
    };
}

export function getNextCronOccurrence(fields: CronFields, after: Date = new Date()): Date {
    const d = new Date(after.getTime() + 60_000);
    d.setSeconds(0, 0);
    // Brute-force search forward up to ~2 years
    const limit = 365 * 2 * 24 * 60;
    for (let i = 0; i < limit; i++) {
        if (
            fields.months.includes(d.getMonth() + 1) &&
            fields.daysOfMonth.includes(d.getDate()) &&
            fields.daysOfWeek.includes(d.getDay()) &&
            fields.hours.includes(d.getHours()) &&
            fields.minutes.includes(d.getMinutes())
        ) {
            return d;
        }
        d.setTime(d.getTime() + 60_000);
    }
    throw new Error("Could not find next cron occurrence within 2-year window");
}

export function getNextNCronOccurrences(expression: string, count: number, after?: Date): Date[] {
    const fields = parseCronExpression(expression);
    const results: Date[] = [];
    let cursor = after ?? new Date();
    for (let i = 0; i < count; i++) {
        const next = getNextCronOccurrence(fields, cursor);
        results.push(next);
        cursor = next;
    }
    return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// Schedule types
// ──────────────────────────────────────────────────────────────────────────────

export interface ScheduleEntry {
    id: string;
    label: string;
    type: "once" | "recurring";
    /** ISO datetime for one-time schedules */
    runAt?: string;
    /** Cron expression for recurring schedules */
    cronExpression?: string;
    /** Callback name or action identifier */
    action: string;
    /** Arbitrary payload passed to the action handler */
    payload?: Record<string, unknown>;
    enabled: boolean;
    createdAt: string;
    lastRunAt?: string;
    nextRunAt?: string;
}

export interface SchedulerEngineOptions {
    activityBus: ActivityBus;
    sessionId: string;
    /** Called when a scheduled action fires */
    onAction?: (entry: ScheduleEntry) => void | Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Engine
// ──────────────────────────────────────────────────────────────────────────────

export class SchedulerEngine {
    private readonly schedules = new Map<string, ScheduleEntry>();
    private readonly timers = new Map<string, NodeJS.Timeout>();
    private readonly activityBus: ActivityBus;
    private readonly sessionId: string;
    private readonly onAction?: (entry: ScheduleEntry) => void | Promise<void>;

    constructor(options: SchedulerEngineOptions) {
        this.activityBus = options.activityBus;
        this.sessionId = options.sessionId;
        this.onAction = options.onAction;
    }

    scheduleOnce(label: string, runAt: string | Date, action: string, payload?: Record<string, unknown>): ScheduleEntry {
        const id = randomUUID();
        const runDate = typeof runAt === "string" ? new Date(runAt) : runAt;
        const entry: ScheduleEntry = {
            id,
            label,
            type: "once",
            runAt: runDate.toISOString(),
            action,
            payload,
            enabled: true,
            createdAt: new Date().toISOString(),
            nextRunAt: runDate.toISOString(),
        };
        this.schedules.set(id, entry);
        this.armOnce(entry, runDate);
        this.emitAudit("scheduler.schedule_created", entry);
        return entry;
    }

    scheduleRecurring(label: string, cronExpression: string, action: string, payload?: Record<string, unknown>): ScheduleEntry {
        const fields = parseCronExpression(cronExpression);
        const nextRun = getNextCronOccurrence(fields);
        const id = randomUUID();
        const entry: ScheduleEntry = {
            id,
            label,
            type: "recurring",
            cronExpression,
            action,
            payload,
            enabled: true,
            createdAt: new Date().toISOString(),
            nextRunAt: nextRun.toISOString(),
        };
        this.schedules.set(id, entry);
        this.armRecurring(entry);
        this.emitAudit("scheduler.schedule_created", entry);
        return entry;
    }

    cancel(id: string): boolean {
        const timer = this.timers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(id);
        }
        const entry = this.schedules.get(id);
        if (entry) {
            entry.enabled = false;
            this.emitAudit("scheduler.schedule_cancelled", entry);
        }
        return this.schedules.delete(id);
    }

    list(): ScheduleEntry[] {
        return [...this.schedules.values()];
    }

    get(id: string): ScheduleEntry | undefined {
        return this.schedules.get(id);
    }

    getNextOccurrences(id: string, count: number): Date[] {
        const entry = this.schedules.get(id);
        if (!entry?.cronExpression) return [];
        return getNextNCronOccurrences(entry.cronExpression, count);
    }

    stop(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private armOnce(entry: ScheduleEntry, runDate: Date): void {
        const delayMs = Math.max(0, runDate.getTime() - Date.now());
        // Node.js setTimeout max is ~24.8 days; clamp and re-arm if needed
        const safeDelay = Math.min(delayMs, 2_147_000_000);
        const timer = setTimeout(() => {
            if (delayMs > safeDelay) {
                // Re-arm for remaining time
                this.armOnce(entry, runDate);
            } else {
                this.fire(entry);
                this.schedules.delete(entry.id);
                this.timers.delete(entry.id);
            }
        }, safeDelay);
        timer.unref();
        this.timers.set(entry.id, timer);
    }

    private armRecurring(entry: ScheduleEntry): void {
        if (!entry.cronExpression || !entry.enabled) return;
        const fields = parseCronExpression(entry.cronExpression);
        const nextRun = getNextCronOccurrence(fields);
        entry.nextRunAt = nextRun.toISOString();
        const delayMs = Math.max(0, nextRun.getTime() - Date.now());
        const safeDelay = Math.min(delayMs, 2_147_000_000);
        const timer = setTimeout(() => {
            if (delayMs > safeDelay) {
                this.armRecurring(entry);
            } else {
                this.fire(entry);
                // Re-arm for next occurrence
                this.armRecurring(entry);
            }
        }, safeDelay);
        timer.unref();
        this.timers.set(entry.id, timer);
    }

    private fire(entry: ScheduleEntry): void {
        entry.lastRunAt = new Date().toISOString();
        this.emitAudit("scheduler.action_fired", entry);
        try {
            this.onAction?.(entry);
        } catch {
            this.emitAudit("scheduler.action_error", entry);
        }
    }

    private emitAudit(operation: string, entry: ScheduleEntry): void {
        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "causal",
            operation,
            status: "succeeded",
            details: {
                scheduleId: entry.id,
                label: entry.label,
                type: entry.type,
                action: entry.action,
                cronExpression: entry.cronExpression,
                nextRunAt: entry.nextRunAt,
                lastRunAt: entry.lastRunAt,
            },
        });
    }
}
