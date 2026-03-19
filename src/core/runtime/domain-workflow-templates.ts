import type { WorkflowDAG, WorkflowExecutor } from "./workflow.js";

export type DomainWorkflowTemplateId = "email" | "calendar" | "notes" | "tasks";

export function createDomainWorkflowTemplates(
    executor: WorkflowExecutor,
): Record<DomainWorkflowTemplateId, WorkflowDAG> {
    return {
        email: executor.createDAG(
            "Email Workflow",
            [
                {
                    id: "email_scan",
                    operation: "email_ops",
                    args: {
                        action: "triage_inbox",
                        mode: "summary_and_priority",
                        threadId: "thread-default",
                    },
                    risk: "low",
                    mutatesState: false,
                    retries: 1,
                    timeoutMs: 250,
                },
                {
                    id: "email_send",
                    operation: "email_ops",
                    args: {
                        action: "send_draft",
                        threadId: "thread-default",
                        rollbackHint: "Revert outbound message in transport queue.",
                    },
                    risk: "high",
                    mutatesState: true,
                    rollbackPlan: "Revert outbound message in transport queue.",
                },
                {
                    id: "email_draft_fallback",
                    operation: "email_ops",
                    args: {
                        action: "draft_reply",
                        threadId: "thread-default",
                    },
                    risk: "low",
                    mutatesState: false,
                },
            ],
            [
                { stepId: "email_send", condition: "on_failure", nextStepId: "email_draft_fallback" },
                { stepId: "email_send", condition: "on_timeout", nextStepId: "email_draft_fallback" },
            ],
        ),
        calendar: executor.createDAG(
            "Calendar Workflow",
            [
                {
                    id: "calendar_fetch",
                    operation: "calendar_plan",
                    args: {
                        action: "detect_conflicts",
                        planningWindow: "day",
                        calendarId: "calendar-default",
                    },
                    risk: "low",
                    mutatesState: false,
                    retries: 1,
                    timeoutMs: 250,
                },
                {
                    id: "calendar_commit",
                    operation: "calendar_plan",
                    args: {
                        action: "commit_day_plan",
                        calendarId: "calendar-default",
                        rollbackHint: "Restore prior event snapshot.",
                    },
                    risk: "high",
                    mutatesState: true,
                    rollbackPlan: "Restore prior event snapshot.",
                },
                {
                    id: "calendar_propose_fallback",
                    operation: "calendar_plan",
                    args: {
                        action: "propose_day_plan",
                        calendarId: "calendar-default",
                    },
                    risk: "low",
                    mutatesState: false,
                },
            ],
            [
                {
                    stepId: "calendar_commit",
                    condition: "on_failure",
                    nextStepId: "calendar_propose_fallback",
                },
                {
                    stepId: "calendar_commit",
                    condition: "on_timeout",
                    nextStepId: "calendar_propose_fallback",
                },
            ],
        ),
        notes: executor.createDAG(
            "Notes Workflow",
            [
                {
                    id: "notes_capture",
                    operation: "notes_extract",
                    args: {
                        action: "capture",
                        extractMode: "action_and_deadline_candidates",
                        noteId: "note-default",
                    },
                    risk: "low",
                    mutatesState: false,
                    retries: 1,
                    timeoutMs: 250,
                },
                {
                    id: "notes_persist",
                    operation: "notes_extract",
                    args: {
                        action: "extract_actions_deadlines",
                        noteId: "note-default",
                        rollbackHint: "Reinstate previous note version.",
                    },
                    risk: "medium",
                    mutatesState: true,
                    rollbackPlan: "Reinstate previous note version.",
                },
                {
                    id: "notes_extract_fallback",
                    operation: "notes_extract",
                    args: {
                        action: "extract",
                        noteId: "note-default",
                    },
                    risk: "low",
                    mutatesState: false,
                },
            ],
            [
                {
                    stepId: "notes_persist",
                    condition: "on_failure",
                    nextStepId: "notes_extract_fallback",
                },
                {
                    stepId: "notes_persist",
                    condition: "on_timeout",
                    nextStepId: "notes_extract_fallback",
                },
            ],
        ),
        tasks: executor.createDAG(
            "Tasks Workflow",
            [
                {
                    id: "tasks_analyze",
                    operation: "tasks_timeline",
                    args: {
                        action: "build_chronological_plan",
                        timelineId: "timeline-default",
                    },
                    risk: "low",
                    mutatesState: false,
                    retries: 1,
                    timeoutMs: 250,
                },
                {
                    id: "tasks_commit",
                    operation: "tasks_timeline",
                    args: {
                        action: "commit_chronological_timeline",
                        timelineId: "timeline-default",
                        rollbackHint: "Restore prior committed timeline state.",
                    },
                    risk: "high",
                    mutatesState: true,
                    rollbackPlan: "Restore prior committed timeline state.",
                    timeoutMs: 10,
                },
                {
                    id: "tasks_replan_fallback",
                    operation: "tasks_timeline",
                    args: {
                        action: "rebuild_chronological_plan",
                        timelineId: "timeline-default",
                    },
                    risk: "low",
                    mutatesState: false,
                },
            ],
            [
                { stepId: "tasks_commit", condition: "on_failure", nextStepId: "tasks_replan_fallback" },
                { stepId: "tasks_commit", condition: "on_timeout", nextStepId: "tasks_replan_fallback" },
            ],
        ),
    };
}