/**
 * Email Adapter — file-backed email triage and draft tool.
 *
 * Threads are stored as JSON files in {dataDir}/email/{threadId}.json.
 * The data directory defaults to prism-data/ in the current working directory
 * and can be overridden via PRISM_DATA_DIR.
 *
 * When a GmailOAuthAdapter is provided and `isConnected`, operations are routed
 * through the real Gmail API.  Otherwise the file-backed path is used (tests,
 * local dev without credentials, etc.).
 *
 * Operations (action arg):
 *   summarize    — read thread / list inbox, return messages + metadata
 *   draft_reply  — append a draft to the thread (file-backed) or queue for send
 *   send         — send via Gmail API when connected, else promote file draft
 *   list_inbox   — list recent inbox threads (Gmail only; falls back to summary of known threads)
 *   mark_read    — mark a thread read in Gmail
 *   archive      — archive a thread in Gmail
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";
import type { GmailOAuthAdapter } from "./email-oauth-adapter.js";
import type { OutlookOAuthAdapter } from "./outlook-oauth-adapter.js";

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

    /**
     * @param _dataDir  Optional data directory override (useful in tests).
     * @param gmailAdapter  Optional Gmail adapter.
     * @param outlookAdapter Optional Outlook adapter.
     */
    constructor(
        private readonly _dataDir?: string,
        private readonly gmailAdapter?: GmailOAuthAdapter,
        private readonly outlookAdapter?: OutlookOAuthAdapter
    ) { }

    async execute(request: ToolRequest): Promise<ToolResult> {
        const args = request.args as {
            action?: string;
            threadId?: string;
            body?: string;
            subject?: string;
            from?: string;
            to?: string | string[];
            query?: string;
            maxResults?: number;
        };

        const action = args.action ?? "";
        const threadId = args.threadId ?? "thread-default";
        const dir = this._dataDir ?? dataDir();

        // ── OAuth-live paths (when connected) ──────────────────────────────
        const useGmail = this.gmailAdapter?.isConnected === true;
        const useOutlook = !useGmail && this.outlookAdapter?.isConnected === true;

        if (useGmail) {
            switch (action) {
                case "list_inbox": {
                    const threads = await this.gmailAdapter!.listThreads(
                        args.maxResults ?? 20,
                        args.query
                    );
                    return {
                        ok: true,
                        output: {
                            source: "gmail",
                            threadCount: threads.length,
                            threads: threads.map((t) => ({
                                threadId: t.threadId,
                                subject: t.subject,
                                lastMessageDate: t.lastMessageDate,
                                isUnread: t.isUnread,
                                messageCount: t.messages.length,
                                snippet: t.messages.at(-1)?.snippet ?? "",
                            })),
                        },
                    };
                }

                case "summarize": {
                    // If a threadId is provided, retrieve that thread; otherwise list inbox
                    if (args.threadId && args.threadId !== "thread-default") {
                        const thread = await this.gmailAdapter!.getThread(null, args.threadId);
                        return {
                            ok: true,
                            output: {
                                source: "gmail",
                                threadId: thread.threadId,
                                subject: thread.subject,
                                messageCount: thread.messages.length,
                                isUnread: thread.isUnread,
                                messages: thread.messages.map((m) => ({
                                    id: m.id,
                                    from: m.from,
                                    subject: m.subject,
                                    snippet: m.snippet,
                                    date: m.date,
                                    isUnread: m.isUnread,
                                })),
                            },
                        };
                    }
                    // No threadId — fall through to list_inbox behaviour
                    const threads = await this.gmailAdapter!.listThreads(args.maxResults ?? 10, args.query);
                    return {
                        ok: true,
                        output: {
                            source: "gmail",
                            threadCount: threads.length,
                            threads: threads.map((t) => ({
                                threadId: t.threadId,
                                subject: t.subject,
                                lastMessageDate: t.lastMessageDate,
                                isUnread: t.isUnread,
                            })),
                        },
                    };
                }

                case "send": {
                    const to = Array.isArray(args.to) ? args.to : [args.to ?? ""];
                    if (to.length === 0 || !to[0]) {
                        return { ok: false, output: { error: "send requires a 'to' address" } };
                    }
                    const result = await this.gmailAdapter!.sendEmail(
                        to,
                        args.subject ?? "(no subject)",
                        args.body ?? "",
                        args.threadId !== "thread-default" ? args.threadId : undefined
                    );
                    return {
                        ok: true,
                        output: { source: "gmail", ...result },
                        sideEffects: [{ type: "network", description: `Email sent via Gmail to ${to.join(", ")}` }],
                    };
                }

                case "mark_read": {
                    await this.gmailAdapter!.markAsRead(threadId);
                    return { ok: true, output: { source: "gmail", threadId, marked: "read" } };
                }

                case "archive": {
                    await this.gmailAdapter!.archiveThread(threadId);
                    return { ok: true, output: { source: "gmail", threadId, archived: true } };
                }

                // draft_reply remains file-backed even when Gmail is connected
                // (drafts are composed locally before sending)
            }
        }

        if (useOutlook) {
            switch (action) {
                case "list_inbox": {
                    const messages = await this.outlookAdapter!.listMessages(args.maxResults ?? 20);
                    return {
                        ok: true,
                        output: {
                            source: "outlook",
                            messageCount: messages.length,
                            messages: messages.map((m) => ({
                                id: m.id,
                                from: m.from,
                                subject: m.subject,
                                snippet: m.bodyPreview,
                                date: m.receivedDateTime,
                                isRead: m.isRead,
                            })),
                        },
                    };
                }

                case "summarize": {
                    // Outlook summary — for now, we just list recent messages
                    const messages = await this.outlookAdapter!.listMessages(args.maxResults ?? 10);
                    return {
                        ok: true,
                        output: {
                            source: "outlook",
                            messageCount: messages.length,
                            messages: messages.map((m) => ({
                                id: m.id,
                                from: m.from,
                                subject: m.subject,
                                snippet: m.bodyPreview,
                                date: m.receivedDateTime,
                                isRead: m.isRead,
                            })),
                        },
                    };
                }

                case "send": {
                    const to = Array.isArray(args.to) ? args.to : [args.to ?? ""];
                    if (to.length === 0 || !to[0]) {
                        return { ok: false, output: { error: "send requires a 'to' address" } };
                    }
                    const result = await this.outlookAdapter!.sendEmail(
                        to,
                        args.subject ?? "(no subject)",
                        args.body ?? ""
                    );
                    return {
                        ok: true,
                        output: { source: "outlook", ...result },
                        sideEffects: [{ type: "network", description: `Email sent via Outlook to ${to.join(", ")}` }],
                    };
                }

                case "mark_read": {
                    if (!args.threadId || args.threadId === "thread-default") {
                        return { ok: false, output: { error: "mark_read requires a message ID in 'threadId'" } };
                    }
                    await this.outlookAdapter!.markAsRead(args.threadId);
                    return { ok: true, output: { source: "outlook", messageId: args.threadId, marked: "read" } };
                }
            }
        }

        // ── File-backed paths (default / fallback) ─────────────────────────
        switch (action) {
            case "summarize": {
                const thread = loadThread(dir, threadId);
                return {
                    ok: true,
                    output: {
                        source: "file",
                        threadId: thread.threadId,
                        subject: thread.subject,
                        messageCount: thread.messages.length,
                        draftCount: thread.drafts.length,
                        sentCount: thread.sent.length,
                        messages: thread.messages,
                    },
                };
            }

            case "list_inbox": {
                // File backend: return summary of known threadIds in directory
                return {
                    ok: true,
                    output: {
                        source: "file",
                        message: "Connect Gmail via /api/auth/gmail/authorize for real inbox access.",
                        threads: [],
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
                    output: { source: "file", threadId, sent },
                    sideEffects: [{ type: "file", description: `message sent: ${threadPath(dir, threadId)}` }],
                };
            }

            default:
                return { ok: false, output: { error: `Unknown email action: ${action}` } };
        }
    }
}
