/**
 * Calendar Adapter — file-backed calendar event management tool.
 *
 * Calendar data is stored as JSON in {dataDir}/calendar/{calendarId}.json.
 * The data directory defaults to prism-data/ in the current working directory
 * and can be overridden via PRISM_DATA_DIR.
 *
 * Operations (action arg):
 *   availability_lookup    — return events list (read-only)
 *   create_or_update_event — add or update a confirmed event
 *   propose                — add event flagged as proposed (not committed)
 *   list_range             — return events within a date range
 *   delete_event           — remove an event by id
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Data types
// ──────────────────────────────────────────────────────────────────────────────

export type CalendarCategory = "meeting" | "deadline" | "milestone" | "reminder" | "blocked" | "general";

export interface CalendarEvent {
    id: string;
    title: string;
    start: string;
    end: string;
    proposed: boolean;
    attendees?: string[];
    description?: string;
    recurrence?: string;
    color?: string;
    category?: CalendarCategory;
    allDay?: boolean;
    location?: string;
}

export interface CalendarData {
    calendarId: string;
    events: CalendarEvent[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

import { workspaceDataDir } from "../../core/config/workspace-resolver.js";

function dataDir(): string {
    return join(process.env.PRISM_DATA_DIR ?? workspaceDataDir(), "calendar");
}

function calendarPath(dir: string, calendarId: string): string {
    return join(dir, `${calendarId}.json`);
}

function loadCalendar(dir: string, calendarId: string): CalendarData {
    const path = calendarPath(dir, calendarId);
    if (!existsSync(path)) {
        return { calendarId, events: [] };
    }
    return JSON.parse(readFileSync(path, "utf-8")) as CalendarData;
}

function saveCalendar(dir: string, data: CalendarData): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(calendarPath(dir, data.calendarId), JSON.stringify(data, null, 2), "utf-8");
}

// ──────────────────────────────────────────────────────────────────────────────
// Tool
// ──────────────────────────────────────────────────────────────────────────────

export class CalendarPlanTool implements Tool {
    readonly name = "calendar_plan";

    constructor(private readonly _dataDir?: string) { }

    async execute(request: ToolRequest): Promise<ToolResult> {
        const args = request.args as {
            action?: string;
            calendarId?: string;
            eventId?: string;
            title?: string;
            start?: string;
            end?: string;
            attendees?: string[];
            description?: string;
            recurrence?: string;
            color?: string;
            category?: CalendarCategory;
            allDay?: boolean;
            location?: string;
            rangeStart?: string;
            rangeEnd?: string;
        };

        const action = args.action ?? "";
        const calendarId = args.calendarId ?? "calendar-default";
        const dir = this._dataDir ?? dataDir();

        switch (action) {
            case "availability_lookup": {
                const data = loadCalendar(dir, calendarId);
                const confirmed = data.events.filter((e) => !e.proposed);
                const proposed = data.events.filter((e) => e.proposed);
                return {
                    ok: true,
                    output: {
                        calendarId,
                        eventCount: data.events.length,
                        confirmedCount: confirmed.length,
                        proposedCount: proposed.length,
                        events: data.events,
                    },
                };
            }

            case "create_or_update_event": {
                const data = loadCalendar(dir, calendarId);
                const eventId = args.eventId ?? randomUUID();
                const existing = data.events.findIndex((e) => e.id === eventId);
                const event: CalendarEvent = {
                    id: eventId,
                    title: args.title ?? "(untitled)",
                    start: args.start ?? new Date().toISOString(),
                    end: args.end ?? new Date().toISOString(),
                    proposed: false,
                    ...(args.attendees ? { attendees: args.attendees } : {}),
                    ...(args.description ? { description: args.description } : {}),
                    ...(args.recurrence ? { recurrence: args.recurrence } : {}),
                    ...(args.color ? { color: args.color } : {}),
                    ...(args.category ? { category: args.category } : {}),
                    ...(args.allDay !== undefined ? { allDay: args.allDay } : {}),
                    ...(args.location ? { location: args.location } : {}),
                };
                if (existing >= 0) {
                    data.events[existing] = event;
                } else {
                    data.events.push(event);
                }
                saveCalendar(dir, data);
                return {
                    ok: true,
                    output: { calendarId, event },
                    sideEffects: [{ type: "file", description: `calendar updated: ${calendarPath(dir, calendarId)}` }],
                };
            }

            case "propose": {
                const data = loadCalendar(dir, calendarId);
                const event: CalendarEvent = {
                    id: args.eventId ?? randomUUID(),
                    title: args.title ?? "(proposed)",
                    start: args.start ?? new Date().toISOString(),
                    end: args.end ?? new Date().toISOString(),
                    proposed: true,
                    ...(args.attendees ? { attendees: args.attendees } : {}),
                    ...(args.description ? { description: args.description } : {}),
                };
                data.events.push(event);
                saveCalendar(dir, data);
                return {
                    ok: true,
                    output: { calendarId, event },
                    sideEffects: [{ type: "file", description: `proposal saved: ${calendarPath(dir, calendarId)}` }],
                };
            }

            case "list_range": {
                const data = loadCalendar(dir, calendarId);
                const rangeStart = args.rangeStart ? new Date(args.rangeStart).getTime() : 0;
                const rangeEnd = args.rangeEnd ? new Date(args.rangeEnd).getTime() : Infinity;
                const filtered = data.events.filter((e) => {
                    const eStart = new Date(e.start).getTime();
                    const eEnd = new Date(e.end).getTime();
                    return eStart <= rangeEnd && eEnd >= rangeStart;
                });
                return {
                    ok: true,
                    output: { calendarId, eventCount: filtered.length, events: filtered },
                };
            }

            case "delete_event": {
                const data = loadCalendar(dir, calendarId);
                const eventId = args.eventId;
                if (!eventId) return { ok: false, output: { error: "eventId required" } };
                const idx = data.events.findIndex((e) => e.id === eventId);
                if (idx < 0) return { ok: false, output: { error: `Event not found: ${eventId}` } };
                data.events.splice(idx, 1);
                saveCalendar(dir, data);
                return {
                    ok: true,
                    output: { calendarId, deleted: eventId },
                    sideEffects: [{ type: "file", description: `event deleted from calendar: ${calendarPath(dir, calendarId)}` }],
                };
            }

            default:
                return { ok: false, output: { error: `Unknown calendar action: ${action}` } };
        }
    }
}
