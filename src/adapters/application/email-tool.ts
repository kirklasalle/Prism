/**
 * Email Adapter — file-backed email triage and draft tool.
 *
 * Threads are stored as JSON files in {dataDir}/email/{threadId}.json.
 * The data directory defaults to prism-data/ in the current working directory
 * and can be overridden via PRISM_DATA_DIR.
 *
 * Operations (action arg):
 *   summarize    — read thread, return messages + metadata (read-only)
 *   draft_reply  — append a draft to the thread (or create empty placeholder)
 *   send         — promote first draft to sent, clear drafts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Data types
// ──────────────────────────────────────────────────────────────────────────────

export interface EmailMessage {
    from: string;
    body: string;
    timestamp: string;
}

export interface EmailDraft {
    body: string;
    createdAt: string;
}

export interface EmailSent {
    body: string;
    sentAt: string;
}

export interface EmailThread {
    threadId: string;
    subject: string;
    messages: EmailMessage[];
    drafts: EmailDraft[];
    sent: EmailSent[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

import { workspaceDataDir } from "../../core/config/workspace-resolver.js";

function dataDir(): string {
    return join(process.env.PRISM_DATA_DIR ?? workspaceDataDir(), "email");
}

function threadPath(dir: string, threadId: string): string {
    return join(dir, `${threadId}.json`);
}

function loadThread(dir: string, threadId: string): EmailThread {
    const path = threadPath(dir, threadId);
    if (!existsSync(path)) {
        return { threadId, subject: "(no subject)", messages: [], drafts: [], sent: [] };
    }
    return JSON.parse(readFileSync(path, "utf-8")) as EmailThread;
}

function saveThread(dir: string, thread: EmailThread): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(threadPath(dir, thread.threadId), JSON.stringify(thread, null, 2), "utf-8");
}

// ──────────────────────────────────────────────────────────────────────────────
// Tool
// ──────────────────────────────────────────────────────────────────────────────

export class EmailOpsTool implements Tool {
    readonly name = "email_ops";

    /** Construct with an optional data directory override (useful in tests). */
    constructor(private readonly _dataDir?: string) { }

    async execute(request: ToolRequest): Promise<ToolResult> {
        const args = request.args as {
            action?: string;
            threadId?: string;
            body?: string;
            subject?: string;
            from?: string;
        };

        const action = args.action ?? "";
        const threadId = args.threadId ?? "thread-default";
        const dir = this._dataDir ?? dataDir();

        switch (action) {
            case "summarize": {
                const thread = loadThread(dir, threadId);
                return {
                    ok: true,
                    output: {
                        threadId: thread.threadId,
                        subject: thread.subject,
                        messageCount: thread.messages.length,
                        draftCount: thread.drafts.length,
                        sentCount: thread.sent.length,
                        messages: thread.messages,
                    },
                };
            }

            case "draft_reply": {
                const thread = loadThread(dir, threadId);
                const draft: EmailDraft = {
                    body: args.body ?? "(no body)",
                    createdAt: new Date().toISOString(),
                };
                thread.drafts.push(draft);
                saveThread(dir, thread);
                return {
                    ok: true,
                    output: { threadId, draft },
                    sideEffects: [{ type: "file", description: `draft saved: ${threadPath(dir, threadId)}` }],
                };
            }

            case "send": {
                const thread = loadThread(dir, threadId);
                if (thread.drafts.length === 0) {
                    return { ok: false, output: { error: "No draft to send", threadId } };
                }
                const [first, ...rest] = thread.drafts;
                const sent: EmailSent = { body: first!.body, sentAt: new Date().toISOString() };
                thread.sent.push(sent);
                thread.drafts = rest;
                saveThread(dir, thread);
                return {
                    ok: true,
                    output: { threadId, sent },
                    sideEffects: [{ type: "file", description: `message sent: ${threadPath(dir, threadId)}` }],
                };
            }

            default:
                return { ok: false, output: { error: `Unknown email action: ${action}` } };
        }
    }
}
