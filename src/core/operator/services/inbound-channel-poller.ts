import { readPreferences } from "../../config/workspace-resolver.js";

export class InboundChannelPoller {
    private interval: NodeJS.Timeout | null = null;
    private logs: string[] = [];

    constructor(
        private readonly gmailAdapter: any,
        private readonly outlookAdapter: any,
        private readonly approvalQueue: any,
        private readonly chatStore: any,
        private readonly dashboardService: any,
        private readonly activityBus?: any,
    ) {}

    addLog(msg: string) {
        const timestamp = new Date().toLocaleTimeString();
        this.logs.push(`[${timestamp}] ${msg}`);
        if (this.logs.length > 100) {
            this.logs.shift();
        }
        console.log(`[CHANNELS] ${msg}`);
        if (this.activityBus) {
            try {
                this.activityBus.emit({
                    sessionId: this.chatStore.listSessions()?.[0]?.sessionId || "system",
                    layer: "governance",
                    operation: "channels_poller_event",
                    status:
                        msg.includes("ERROR") || msg.includes("failed") || msg.includes("Failed")
                            ? "failed"
                            : "succeeded",
                    details: { message: msg },
                });
            } catch (e) {
                // best effort
            }
        }
    }

    getLogs(): string[] {
        return this.logs;
    }

    clearLogs() {
        this.logs = [];
    }

    start() {
        if (this.interval) return;
        this.addLog("[SYSTEM] Inbound channel poller service started.");
        // Poll every 30 seconds
        this.interval = setInterval(() => this.poll(), 30000);
        // Run first poll asynchronously
        Promise.resolve().then(() => this.poll());
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            this.addLog("[SYSTEM] Inbound channel poller service stopped.");
        }
    }

    async poll() {
        try {
            const prefs = readPreferences();
            const presence = prefs?.operatorPresence;
            if (!presence) return;

            // If Offline or DND, hold inbound poller
            if (presence.status === "offline" || presence.status === "dnd") {
                return;
            }

            const allowedEmails: string[] = [];
            // Parse operator email or SMS email
            if (presence.smsPhone && presence.smsCarrier) {
                try {
                    const cleanPhone = presence.smsPhone.replace(/[^0-9]/g, "");
                    const carriers: Record<string, string> = {
                        att: "txt.att.net",
                        verizon: "vtext.com",
                        tmobile: "tmomail.net",
                        sprint: "messaging.sprintpcs.com",
                    };
                    const domain = carriers[presence.smsCarrier.toLowerCase()];
                    if (domain) {
                        allowedEmails.push(`${cleanPhone}@${domain}`);
                    }
                } catch {}
            }

            // Also check for user's primary OAuth emails if connected
            if (this.gmailAdapter?.isConnected) {
                try {
                    const client = await this.gmailAdapter.getAuthenticatedClient();
                    const gmailEmail = await this.gmailAdapter.getUserEmail(client);
                    if (gmailEmail) allowedEmails.push(gmailEmail);
                } catch {}
            }
            if (this.outlookAdapter?.isConnected) {
                try {
                    const outlookEmail = await this.outlookAdapter.getUserEmail();
                    if (outlookEmail) allowedEmails.push(outlookEmail);
                } catch {}
            }

            // Now, poll Gmail inbox
            if (this.gmailAdapter?.isConnected) {
                try {
                    const threads = await this.gmailAdapter.listThreads(10, "is:unread");
                    for (const t of threads) {
                        for (const m of t.messages) {
                            if (!m.isUnread) continue;
                            await this.processMessage(m, allowedEmails);
                            // Mark as read so we don't process it again
                            await this.gmailAdapter.markAsRead(t.threadId);
                        }
                    }
                } catch {}
            }

            // Now, poll Outlook inbox
            if (this.outlookAdapter?.isConnected) {
                try {
                    const messages = await this.outlookAdapter.listMessages(10);
                    for (const m of messages) {
                        if (m.isRead) continue;
                        await this.processMessage(
                            {
                                from: m.from,
                                subject: m.subject,
                                body: m.body || m.bodyPreview || "",
                            },
                            allowedEmails,
                        );
                        await this.outlookAdapter.markAsRead(m.id);
                    }
                } catch {}
            }
        } catch (error: any) {
            this.addLog(`[ERROR] Polling failed: ${error.message || error}`);
        }
    }

    private async processMessage(m: { from: string; subject: string; body: string }, allowedEmails: string[]) {
        const extractEmail = (fromHeader: string): string => {
            const match = fromHeader.match(/<([^>]+)>/);
            return (match ? match[1]! : fromHeader).trim().toLowerCase();
        };

        const senderEmail = extractEmail(m.from);
        const isAllowed =
            allowedEmails.length === 0 || allowedEmails.some((email) => senderEmail === email.trim().toLowerCase());
        if (!isAllowed) {
            return;
        }

        const subject = m.subject || "";
        const body = (m.body || "").trim();

        this.addLog(`[INBOUND] Received message from ${m.from}: "${body}"`);

        // Check if subject or body has [PRISM-TASK:<id>]
        const taskMatch =
            subject.match(/\[PRISM-TASK:\s*([a-zA-Z0-9\-]+)\]/i) || body.match(/\[PRISM-TASK:\s*([a-zA-Z0-9\-]+)\]/i);

        if (taskMatch) {
            const approvalId = taskMatch[1]!;
            const cleanBody = body.replace(/\[PRISM-TASK:[^\]]+\]/gi, "").trim();
            const firstLine = cleanBody.split(/\r?\n/)[0]?.trim() || "";

            const isApprove = /^(APPROVE|APPROVED|YES)\b/i.test(firstLine);
            const isDeny = /^(DENY|DENIED|NO)\b/i.test(firstLine);

            if (isApprove) {
                const ok = this.approvalQueue.approve(approvalId);
                if (ok) {
                    this.addLog(`[INBOUND] Task ${approvalId} APPROVED by operator.`);
                } else {
                    this.addLog(`[INBOUND] Task ${approvalId} could not be approved (expired or invalid).`);
                }
            } else if (isDeny) {
                const ok = this.approvalQueue.deny(approvalId);
                if (ok) {
                    this.addLog(`[INBOUND] Task ${approvalId} DENIED by operator.`);
                } else {
                    this.addLog(`[INBOUND] Task ${approvalId} could not be denied (expired or invalid).`);
                }
            } else {
                await this.relayFreeformMessage(cleanBody);
            }
        } else {
            await this.relayFreeformMessage(body);
        }
    }

    private async relayFreeformMessage(text: string) {
        if (!text) return;
        try {
            const sessions = this.chatStore.listSessions();
            const session = sessions[0];
            if (session) {
                this.addLog(`[INBOUND] Relaying freeform message to active session: "${text.substring(0, 30)}..."`);
                await this.dashboardService.submitChatMessage(session.sessionId, text);
            } else {
                this.addLog(`[ERROR] No active chat session found to relay: "${text}"`);
            }
        } catch (error: any) {
            this.addLog(`[ERROR] Failed to relay freeform message: ${error.message || error}`);
        }
    }
}
