import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

type EmailAction = "summarize" | "draft_reply" | "send";
type CalendarAction = "availability_lookup" | "propose" | "create_or_update_event";
type NotesAction = "capture" | "extract" | "persist";
type TasksAction = "plan" | "replan" | "commit";

export class EmailCapabilityTool implements Tool {
    readonly name = "email_ops";
    readonly contract = {
        version: "1.0.0",
        args: {
            action: { type: "string", required: true, enum: ["summarize", "draft_reply", "send"] },
            threadId: { type: "string", required: true },
            query: { type: "string" },
            rollbackHint: { type: "string" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const action = stringArg(request.args.action, "summarize") as EmailAction;
        const mutatingAction = action === "send";
        const rollbackHint = optionalStringArg(request.args.rollbackHint);

        const output = {
            domain: "email",
            action,
            mutatingAction,
            retrievalAttribution: [{ source: "email-thread-index", confidence: 0.99 }],
            rollbackHint,
        };

        return mutatingAction
            ? {
                ok: true,
                output,
                sideEffects: [{ type: "api", description: "email_ops mutating request" }],
            }
            : {
                ok: true,
                output,
            };
    }
}

export class CalendarPlanningTool implements Tool {
    readonly name = "calendar_plan";
    readonly contract = {
        version: "1.0.0",
        args: {
            action: {
                type: "string",
                required: true,
                enum: ["availability_lookup", "propose", "create_or_update_event"],
            },
            calendarId: { type: "string", required: true },
            payload: { type: "object" },
            rollbackHint: { type: "string" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const action = stringArg(request.args.action, "availability_lookup") as CalendarAction;
        const mutatingAction = action === "create_or_update_event";
        const rollbackHint = optionalStringArg(request.args.rollbackHint);

        const output = {
            domain: "calendar",
            action,
            mutatingAction,
            retrievalAttribution: [{ source: "calendar-availability-cache", confidence: 0.98 }],
            rollbackHint,
        };

        return mutatingAction
            ? {
                ok: true,
                output,
                sideEffects: [{ type: "api", description: "calendar_plan mutating request" }],
            }
            : {
                ok: true,
                output,
            };
    }
}

export class NotesExtractionTool implements Tool {
    readonly name = "notes_extract";
    readonly contract = {
        version: "1.0.0",
        args: {
            action: { type: "string", required: true, enum: ["capture", "extract", "persist"] },
            noteId: { type: "string", required: true },
            text: { type: "string" },
            rollbackHint: { type: "string" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const action = stringArg(request.args.action, "capture") as NotesAction;
        const mutatingAction = action === "persist";
        const rollbackHint = optionalStringArg(request.args.rollbackHint);

        const output = {
            domain: "notes",
            action,
            mutatingAction,
            retrievalAttribution: [{ source: "notes-knowledge-base", confidence: 0.97 }],
            rollbackHint,
        };

        return mutatingAction
            ? {
                ok: true,
                output,
                sideEffects: [{ type: "api", description: "notes_extract mutating request" }],
            }
            : {
                ok: true,
                output,
            };
    }
}

export class TasksTimelineTool implements Tool {
    readonly name = "tasks_timeline";
    readonly contract = {
        version: "1.0.0",
        args: {
            action: { type: "string", required: true, enum: ["plan", "replan", "commit"] },
            timelineId: { type: "string", required: true },
            payload: { type: "object" },
            rollbackHint: { type: "string" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const action = stringArg(request.args.action, "plan") as TasksAction;
        const mutatingAction = action === "commit";
        const rollbackHint = optionalStringArg(request.args.rollbackHint);

        const output = {
            domain: "tasks",
            action,
            mutatingAction,
            retrievalAttribution: [{ source: "tasks-timeline-engine", confidence: 0.96 }],
            rollbackHint,
        };

        return mutatingAction
            ? {
                ok: true,
                output,
                sideEffects: [{ type: "api", description: "tasks_timeline mutating request" }],
            }
            : {
                ok: true,
                output,
            };
    }
}

function stringArg(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

function optionalStringArg(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}