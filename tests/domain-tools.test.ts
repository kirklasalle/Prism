/**
 * Tests for the domain workflow tools:
 *   EmailOpsTool     (email_ops)
 *   CalendarPlanTool (calendar_plan)
 *   NotesExtractTool (notes_extract)
 *   TasksTimelineTool (tasks_timeline)
 *
 * Each suite uses a unique temp directory so tools operate on isolated data.
 * All file I/O is against the temp dir; tests clean up on exit.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { EmailOpsTool } from "../src/adapters/application/email-tool.js";
import type { EmailThread } from "../src/adapters/application/email-tool.js";
import { CalendarPlanTool } from "../src/adapters/application/calendar-tool.js";
import type { CalendarData } from "../src/adapters/application/calendar-tool.js";
import { NotesExtractTool } from "../src/adapters/application/notes-tool.js";
import { TasksTimelineTool } from "../src/adapters/application/tasks-tool.js";
import type { TaskTimeline } from "../src/adapters/application/tasks-tool.js";

// ──────────────────────────────────────────────────────────────────────────────
// Shared setup
// ──────────────────────────────────────────────────────────────────────────────

let tempDir: string;
const base = { operation: "", args: {}, risk: "low" as const, mutatesState: false };

before(() => {
    tempDir = join(tmpdir(), `prism-domain-tools-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
});

after(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

// ──────────────────────────────────────────────────────────────────────────────
// EmailOpsTool
// ──────────────────────────────────────────────────────────────────────────────

describe("EmailOpsTool", () => {
    let emailDir: string;
    let tool: EmailOpsTool;

    before(() => {
        emailDir = join(tempDir, "email");
        tool = new EmailOpsTool(emailDir);
    });

    it("summarize returns empty thread when file does not exist", async () => {
        const result = await tool.execute({
            ...base, args: { action: "summarize", threadId: "new-thread" },
        });
        assert.ok(result.ok);
        assert.equal(result.output["messageCount"], 0);
        assert.equal(result.output["draftCount"], 0);
    });

    it("draft_reply saves a draft to the thread file", async () => {
        const result = await tool.execute({
            ...base, args: { action: "draft_reply", threadId: "thread-1", body: "Hello there!" },
        });
        assert.ok(result.ok);
        assert.equal((result.output["draft"] as { body: string }).body, "Hello there!");
        assert.equal(result.sideEffects?.length, 1);

        // Verify persistence
        const file = join(emailDir, "thread-1.json");
        const data = JSON.parse(readFileSync(file, "utf-8")) as EmailThread;
        assert.equal(data.drafts.length, 1);
        assert.equal(data.drafts[0]!.body, "Hello there!");
    });

    it("send promotes draft to sent and clears drafts", async () => {
        const sendResult = await tool.execute({
            ...base, args: { action: "send", threadId: "thread-1" },
        });
        assert.ok(sendResult.ok);
        assert.equal((sendResult.output["sent"] as { body: string }).body, "Hello there!");

        // Verify no drafts remain
        const file = join(emailDir, "thread-1.json");
        const data = JSON.parse(readFileSync(file, "utf-8")) as EmailThread;
        assert.equal(data.drafts.length, 0);
        assert.equal(data.sent.length, 1);
    });

    it("send fails when there are no drafts", async () => {
        const result = await tool.execute({
            ...base, args: { action: "send", threadId: "empty-thread" },
        });
        assert.ok(!result.ok);
        assert.ok(result.output["error"]);
    });

    it("summarize returns accurate counts after operations", async () => {
        // Build up thread-2 with 1 draft
        await tool.execute({ ...base, args: { action: "draft_reply", threadId: "thread-2", body: "Reply A" } });
        await tool.execute({ ...base, args: { action: "draft_reply", threadId: "thread-2", body: "Reply B" } });
        const result = await tool.execute({ ...base, args: { action: "summarize", threadId: "thread-2" } });
        assert.ok(result.ok);
        assert.equal(result.output["draftCount"], 2);
    });

    it("unknown action returns ok=false", async () => {
        const result = await tool.execute({ ...base, args: { action: "teleport", threadId: "t" } });
        assert.ok(!result.ok);
        assert.ok(String(result.output["error"]).includes("Unknown email action"));
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// CalendarPlanTool
// ──────────────────────────────────────────────────────────────────────────────

describe("CalendarPlanTool", () => {
    let calDir: string;
    let tool: CalendarPlanTool;

    before(() => {
        calDir = join(tempDir, "calendar");
        tool = new CalendarPlanTool(calDir);
    });

    it("availability_lookup returns empty list for new calendar", async () => {
        const result = await tool.execute({
            ...base, args: { action: "availability_lookup", calendarId: "cal-1" },
        });
        assert.ok(result.ok);
        assert.equal(result.output["eventCount"], 0);
        assert.equal(result.output["proposedCount"], 0);
    });

    it("create_or_update_event adds a confirmed event", async () => {
        const result = await tool.execute({
            ...base,
            mutatesState: true,
            risk: "high" as const,
            args: {
                action: "create_or_update_event",
                calendarId: "cal-1",
                eventId: "evt-001",
                title: "Team Standup",
                start: "2026-03-16T09:00:00Z",
                end: "2026-03-16T09:30:00Z",
            },
        });
        assert.ok(result.ok);
        assert.equal((result.output["event"] as { proposed: boolean }).proposed, false);
        assert.equal((result.output["event"] as { title: string }).title, "Team Standup");
    });

    it("availability_lookup returns confirmed event after create", async () => {
        const result = await tool.execute({
            ...base, args: { action: "availability_lookup", calendarId: "cal-1" },
        });
        assert.ok(result.ok);
        assert.equal(result.output["confirmedCount"], 1);
        assert.equal(result.output["proposedCount"], 0);
    });

    it("propose adds an event flagged as proposed", async () => {
        const result = await tool.execute({
            ...base,
            args: {
                action: "propose",
                calendarId: "cal-1",
                title: "Optional Social",
                start: "2026-03-17T18:00:00Z",
                end: "2026-03-17T20:00:00Z",
            },
        });
        assert.ok(result.ok);
        assert.equal((result.output["event"] as { proposed: boolean }).proposed, true);
    });

    it("create_or_update_event updates existing event by id", async () => {
        const result = await tool.execute({
            ...base,
            mutatesState: true,
            risk: "high" as const,
            args: {
                action: "create_or_update_event",
                calendarId: "cal-1",
                eventId: "evt-001",
                title: "Team Standup (updated)",
                start: "2026-03-16T09:00:00Z",
                end: "2026-03-16T09:45:00Z",
            },
        });
        assert.ok(result.ok);
        const calFile = join(calDir, "cal-1.json");
        const data = JSON.parse(readFileSync(calFile, "utf-8")) as CalendarData;
        const evt = data.events.find((e) => e.id === "evt-001");
        assert.equal(evt?.title, "Team Standup (updated)");
        // Should still be exactly 2 events (1 confirmed + 1 proposed), not duplicated
        assert.equal(data.events.length, 2);
    });

    it("unknown action returns ok=false", async () => {
        const result = await tool.execute({ ...base, args: { action: "warp", calendarId: "cal-1" } });
        assert.ok(!result.ok);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// NotesExtractTool
// ──────────────────────────────────────────────────────────────────────────────

describe("NotesExtractTool", () => {
    let notesDir: string;
    let tool: NotesExtractTool;
    const NOTE_CONTENT = `# Meeting Notes 2026-03-15\n\n## Agenda\n\n- [ ] Review roadmap\n- [x] Define MVP scope\n\nTODO: Follow up with team on P4 status\n\nSome general discussion text here.\n`;

    before(() => {
        notesDir = join(tempDir, "notes");
        tool = new NotesExtractTool(notesDir);
    });

    it("capture returns empty string and exists=false for missing note", async () => {
        const result = await tool.execute({ ...base, args: { action: "capture", noteId: "new-note" } });
        assert.ok(result.ok);
        assert.equal(result.output["content"], "");
        assert.equal(result.output["exists"], false);
    });

    it("persist writes content to disk", async () => {
        const result = await tool.execute({
            ...base, mutatesState: true, risk: "medium" as const,
            args: { action: "persist", noteId: "note-1", content: NOTE_CONTENT },
        });
        assert.ok(result.ok);
        assert.ok((result.output["charCount"] as number) > 0);
        assert.equal(result.sideEffects?.length, 1);
    });

    it("capture returns persisted content", async () => {
        const result = await tool.execute({ ...base, args: { action: "capture", noteId: "note-1" } });
        assert.ok(result.ok);
        assert.ok(String(result.output["content"]).includes("Meeting Notes"));
        assert.equal(result.output["exists"], true);
    });

    it("extract finds action items and headings", async () => {
        const result = await tool.execute({ ...base, args: { action: "extract", noteId: "note-1" } });
        assert.ok(result.ok);
        const actionItems = result.output["actionItems"] as string[];
        const headings = result.output["headings"] as string[];
        assert.ok(actionItems.some((item) => item.includes("Review roadmap")));
        assert.ok(actionItems.some((item) => item.includes("Follow up")));
        assert.ok(headings.some((h) => h.includes("Meeting Notes")));
        assert.ok((result.output["wordCount"] as number) > 0);
    });

    it("extract saves extraction file", async () => {
        const exPath = join(notesDir, "note-1.extracted.json");
        assert.ok(existsSync(exPath));
    });

    it("persist fails when content is empty", async () => {
        const result = await tool.execute({
            ...base, mutatesState: true, args: { action: "persist", noteId: "note-1", content: "" },
        });
        assert.ok(!result.ok);
    });

    it("extract fails when note does not exist", async () => {
        const result = await tool.execute({ ...base, args: { action: "extract", noteId: "ghost-note" } });
        assert.ok(!result.ok);
    });

    it("unknown action returns ok=false", async () => {
        const result = await tool.execute({ ...base, args: { action: "shred", noteId: "note-1" } });
        assert.ok(!result.ok);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// TasksTimelineTool
// ──────────────────────────────────────────────────────────────────────────────

describe("TasksTimelineTool", () => {
    let tasksDir: string;
    let tool: TasksTimelineTool;

    before(() => {
        tasksDir = join(tempDir, "tasks");
        tool = new TasksTimelineTool(tasksDir);
    });

    it("plan returns empty timeline for new timelineId", async () => {
        const result = await tool.execute({ ...base, args: { action: "plan", timelineId: "tl-1" } });
        assert.ok(result.ok);
        assert.equal(result.output["taskCount"], 0);
        assert.equal(result.output["committed"], false);
    });

    it("plan with tasks arg creates and returns sorted tasks", async () => {
        const result = await tool.execute({
            ...base,
            args: {
                action: "plan",
                timelineId: "tl-1",
                tasks: [
                    { title: "Low priority task", priority: "low" },
                    { title: "High priority task", priority: "high", due: "2026-03-16" },
                    { title: "Medium priority task", priority: "medium" },
                ],
            },
        });
        assert.ok(result.ok);
        assert.equal(result.output["taskCount"], 3);
        const tasks = result.output["tasks"] as Array<{ title: string; priority: string }>;
        // First task should be high priority
        assert.equal(tasks[0]!.priority, "high");
    });

    it("commit marks timeline as committed", async () => {
        const result = await tool.execute({
            ...base, mutatesState: true, risk: "high" as const,
            args: { action: "commit", timelineId: "tl-1" },
        });
        assert.ok(result.ok);
        assert.equal(result.output["committed"], true);
        assert.ok(result.output["committedAt"]);

        const file = join(tasksDir, "tl-1.json");
        const data = JSON.parse(readFileSync(file, "utf-8")) as TaskTimeline;
        assert.equal(data.committed, true);
    });

    it("replan clears committed flag", async () => {
        const result = await tool.execute({ ...base, args: { action: "replan", timelineId: "tl-1" } });
        assert.ok(result.ok);
        assert.equal(result.output["committed"], false);

        const file = join(tasksDir, "tl-1.json");
        const data = JSON.parse(readFileSync(file, "utf-8")) as TaskTimeline;
        assert.equal(data.committed, false);
        assert.equal(data.committedAt, undefined);
    });

    it("replan with new tasks appends and re-sorts", async () => {
        const result = await tool.execute({
            ...base,
            args: {
                action: "replan",
                timelineId: "tl-1",
                tasks: [{ title: "Urgent new task", priority: "high", due: "2026-03-15" }],
            },
        });
        assert.ok(result.ok);
        const tasks = result.output["tasks"] as Array<{ title: string; priority: string }>;
        // New high-priority task should be near the top
        assert.equal(tasks[0]!.priority, "high");
        assert.ok(tasks.some((t) => t.title === "Urgent new task"));
    });

    it("unknown action returns ok=false", async () => {
        const result = await tool.execute({ ...base, args: { action: "explode", timelineId: "tl-1" } });
        assert.ok(!result.ok);
    });
});
