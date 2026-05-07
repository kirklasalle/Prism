/**
 * Gmail OAuth 2.0 Adapter
 *
 * Implements the full 3-legged OAuth 2.0 flow for the Gmail API using the
 * `googleapis` npm package (optional dependency).  When googleapis is not
 * installed or the environment variables are not set, every method returns
 * gracefully with `available: false` so the caller can fall back to the
 * file-backed EmailOpsTool.
 *
 * Required environment variables:
 *   PRISM_GMAIL_CLIENT_ID       — Google OAuth 2.0 client ID
 *   PRISM_GMAIL_CLIENT_SECRET   — Google OAuth 2.0 client secret
 *   PRISM_GMAIL_REDIRECT_URI    — OAuth redirect URI  (default: http://localhost:7070/api/auth/gmail/callback)
 *
 * Flow:
 *   1. Call getAuthorizationUrl()   → redirect the user to Google consent
 *   2. Receive code from callback   → call exchangeCode(code)
 *   3. Tokens are stored in OAuthTokenStore
 *   4. Subsequent API calls auto-refresh tokens via refreshIfExpired()
 *
 * Phase E2 — Email OAuth workstream.
 */

import type { OAuthTokenStore, OAuthToken } from "../../core/operator/oauth-token-store.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface GmailMessage {
    id: string;
    threadId: string;
    from: string;
    to: string[];
    subject: string;
    snippet: string;
    body: string;
    date: string;
    labelIds: string[];
    isUnread: boolean;
}

export interface GmailThread {
    threadId: string;
    subject: string;
    messages: GmailMessage[];
    lastMessageDate: string;
    isUnread: boolean;
}

export interface GmailSendResult {
    messageId: string;
    threadId: string;
    labelIds: string[];
}

export interface GmailAdapterStatus {
    available: boolean;
    connected: boolean;
    email: string | null;
    error?: string;
}

// ── Gmail OAuth scopes ────────────────────────────────────────────────────────

const GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/userinfo.email",
];

const PROVIDER_KEY = "gmail";

// ── Adapter implementation ────────────────────────────────────────────────────

export class GmailOAuthAdapter {
    private googleapisModule: any = null;
    private initialized = false;
    private initPromise: Promise<void>;

    constructor(private readonly tokenStore: OAuthTokenStore) {
        this.initPromise = this.tryInit();
    }

    /** Whether the `googleapis` package is available and credentials are configured. */
    get isAvailable(): boolean {
        return this.googleapisModule !== null
            && !!process.env.PRISM_GMAIL_CLIENT_ID
            && !!process.env.PRISM_GMAIL_CLIENT_SECRET;
    }

    /** Whether a valid (possibly expired) token is stored. */
    get isConnected(): boolean {
        return this.tokenStore.has(PROVIDER_KEY);
    }

    // ── OAuth flow ──────────────────────────────────────────────────────────

    /**
     * Generate the Google consent URL.
     * Redirect the user's browser to this URL to begin the OAuth flow.
     */
    async getAuthorizationUrl(): Promise<string> {
        await this.initPromise;
        if (!this.isAvailable) {
            throw new Error("Gmail OAuth not available: googleapis not installed or credentials not configured.");
        }
        const oauth2Client = this.createOAuth2Client();
        return oauth2Client.generateAuthUrl({
            access_type: "offline",
            scope: GMAIL_SCOPES,
            prompt: "consent",  // Force consent to always get a refresh token
        });
    }

    /**
     * Exchange the authorization code from Google's callback for tokens.
     * Stores the tokens in the OAuthTokenStore and returns status.
     */
    async exchangeCode(code: string): Promise<GmailAdapterStatus> {
        await this.initPromise;
        if (!this.isAvailable) {
            return { available: false, connected: false, email: null, error: "googleapis not available" };
        }
        try {
            const oauth2Client = this.createOAuth2Client();
            const { tokens } = await oauth2Client.getToken(code);
            if (!tokens.access_token) {
                throw new Error("No access token in response");
            }
            oauth2Client.setCredentials(tokens);
            const email = await this.getUserEmail(oauth2Client);
            const oauthToken: OAuthToken = {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token ?? null,
                expiresAt: tokens.expiry_date
                    ? new Date(tokens.expiry_date).toISOString()
                    : null,
                scopes: GMAIL_SCOPES,
                provider: PROVIDER_KEY,
            };
            this.tokenStore.set(PROVIDER_KEY, oauthToken);
            return { available: true, connected: true, email };
        } catch (err: unknown) {
            return {
                available: true,
                connected: false,
                email: null,
                error: (err as Error).message,
            };
        }
    }

    /**
     * Get current connection status without making any API calls.
     */
    async getStatus(): Promise<GmailAdapterStatus> {
        await this.initPromise;
        if (!this.isAvailable) {
            return { available: false, connected: false, email: null };
        }
        if (!this.isConnected) {
            return { available: true, connected: false, email: null };
        }
        try {
            const oauth2Client = await this.getAuthenticatedClient();
            const email = await this.getUserEmail(oauth2Client);
            return { available: true, connected: true, email };
        } catch (err: unknown) {
            return {
                available: true,
                connected: false,
                email: null,
                error: (err as Error).message,
            };
        }
    }

    /**
     * Disconnect: remove stored tokens.
     */
    async disconnect(): Promise<void> {
        this.tokenStore.clear(PROVIDER_KEY);
    }

    // ── Gmail API operations ────────────────────────────────────────────────

    /**
     * List recent inbox threads, optionally filtered by query.
     * @param maxResults Maximum number of threads to return (default: 20)
     * @param query Optional Gmail query string (e.g. "is:unread", "from:user@example.com")
     */
    async listThreads(maxResults = 20, query?: string): Promise<GmailThread[]> {
        await this.initPromise;
        const client = await this.getAuthenticatedClient();
        const { google } = this.googleapisModule;
        const gmail = google.gmail({ version: "v1", auth: client });

        const listResp = await gmail.users.threads.list({
            userId: "me",
            maxResults,
            q: query ?? "in:inbox",
        });

        const threadItems = listResp.data.threads ?? [];
        const threads: GmailThread[] = [];

        for (const item of threadItems) {
            if (!item.id) continue;
            try {
                const thread = await this.getThread(gmail, item.id);
                threads.push(thread);
            } catch {
                // Skip threads that fail to load — don't interrupt the whole list
            }
        }

        return threads;
    }

    /**
     * Get a specific thread by ID.
     */
    async getThread(gmailClient: any, threadId: string): Promise<GmailThread> {
        await this.initPromise;
        const client = gmailClient ?? (await this.getGmailClient());
        const threadResp = await client.users.threads.get({
            userId: "me",
            id: threadId,
            format: "full",
        });

        const messages: GmailMessage[] = (threadResp.data.messages ?? []).map(
            (m: any) => this.parseMessage(m)
        );

        const subject = messages[0]?.subject ?? "(no subject)";
        const lastDate = messages.at(-1)?.date ?? new Date().toISOString();
        const isUnread = messages.some((m) => m.isUnread);

        return { threadId, subject, messages, lastMessageDate: lastDate, isUnread };
    }

    /**
     * Send an email.
     * @param to Recipient addresses
     * @param subject Email subject
     * @param body Email body (plain text or HTML)
     * @param threadId Optional thread ID to reply in-thread
     */
    async sendEmail(
        to: string[],
        subject: string,
        body: string,
        threadId?: string
    ): Promise<GmailSendResult> {
        await this.initPromise;
        const client = await this.getGmailClient();

        const fromEmail = await this.getUserEmail(await this.getAuthenticatedClient());
        const raw = this.buildRawMessage(fromEmail ?? "me", to, subject, body, threadId);

        const sendResp = await client.users.messages.send({
            userId: "me",
            requestBody: {
                raw,
                threadId,
            },
        });

        return {
            messageId: sendResp.data.id ?? "",
            threadId: sendResp.data.threadId ?? threadId ?? "",
            labelIds: sendResp.data.labelIds ?? [],
        };
    }

    /**
     * Mark a thread as read.
     */
    async markAsRead(threadId: string): Promise<void> {
        await this.initPromise;
        const client = await this.getGmailClient();
        await client.users.threads.modify({
            userId: "me",
            id: threadId,
            requestBody: { removeLabelIds: ["UNREAD"] },
        });
    }

    /**
     * Archive a thread (remove from inbox).
     */
    async archiveThread(threadId: string): Promise<void> {
        await this.initPromise;
        const client = await this.getGmailClient();
        await client.users.threads.modify({
            userId: "me",
            id: threadId,
            requestBody: { removeLabelIds: ["INBOX"] },
        });
    }

    // ── Calendar API operations ─────────────────────────────────────────────

    /**
     * List upcoming calendar events.
     */
    async listEvents(maxResults = 50, timeMin = new Date().toISOString()): Promise<any[]> {
        await this.initPromise;
        const client = await this.getCalendarClient();
        const resp = await client.events.list({
            calendarId: "primary",
            timeMin,
            maxResults,
            singleEvents: true,
            orderBy: "startTime",
        });
        return resp.data.items ?? [];
    }

    /**
     * Create a new calendar event.
     */
    async createEvent(event: any): Promise<any> {
        await this.initPromise;
        const client = await this.getCalendarClient();
        const resp = await client.events.insert({
            calendarId: "primary",
            requestBody: event,
        });
        return resp.data;
    }

    /**
     * Update an existing calendar event.
     */
    async updateEvent(eventId: string, event: any): Promise<any> {
        await this.initPromise;
        const client = await this.getCalendarClient();
        const resp = await client.events.update({
            calendarId: "primary",
            eventId,
            requestBody: event,
        });
        return resp.data;
    }

    /**
     * Delete a calendar event.
     */
    async deleteEvent(eventId: string): Promise<void> {
        await this.initPromise;
        const client = await this.getCalendarClient();
        await client.events.delete({
            calendarId: "primary",
            eventId,
        });
    }

    // ── Internal helpers ────────────────────────────────────────────────────

    private async tryInit(): Promise<void> {
        try {
            this.googleapisModule = await import("googleapis");
            this.initialized = true;
        } catch {
            // googleapis not installed — adapter operates in unavailable mode
            this.initialized = false;
        }
    }

    private createOAuth2Client(): any {
        const { google } = this.googleapisModule;
        return new google.auth.OAuth2(
            process.env.PRISM_GMAIL_CLIENT_ID,
            process.env.PRISM_GMAIL_CLIENT_SECRET,
            process.env.PRISM_GMAIL_REDIRECT_URI ?? "http://localhost:7070/api/auth/gmail/callback"
        );
    }

    private async getAuthenticatedClient(): Promise<any> {
        if (!this.isAvailable) {
            throw new Error("Gmail OAuth not available.");
        }
        const token = this.tokenStore.get(PROVIDER_KEY);
        if (!token) {
            throw new Error("Not connected to Gmail. Call getAuthorizationUrl() first.");
        }
        const oauth2Client = this.createOAuth2Client();
        oauth2Client.setCredentials({
            access_token: token.accessToken,
            refresh_token: token.refreshToken,
            expiry_date: token.expiresAt ? new Date(token.expiresAt).getTime() : undefined,
        });

        // Auto-refresh if token is within 5 minutes of expiry or already expired
        if (token.expiresAt) {
            const expiresAt = new Date(token.expiresAt).getTime();
            const now = Date.now();
            const BUFFER_MS = 5 * 60 * 1000;
            if (expiresAt - now < BUFFER_MS) {
                try {
                    const { credentials } = await oauth2Client.refreshAccessToken();
                    const refreshed: OAuthToken = {
                        ...token,
                        accessToken: credentials.access_token!,
                        expiresAt: credentials.expiry_date
                            ? new Date(credentials.expiry_date).toISOString()
                            : token.expiresAt,
                    };
                    this.tokenStore.set(PROVIDER_KEY, refreshed);
                    oauth2Client.setCredentials(credentials);
                } catch {
                    // Refresh failed — proceed with current token; API call will fail with auth error
                }
            }
        }

        return oauth2Client;
    }

    private async getGmailClient(): Promise<any> {
        const { google } = this.googleapisModule;
        const auth = await this.getAuthenticatedClient();
        return google.gmail({ version: "v1", auth });
    }

    private async getCalendarClient(): Promise<any> {
        const { google } = this.googleapisModule;
        const auth = await this.getAuthenticatedClient();
        return google.calendar({ version: "v3", auth });
    }

    private async getUserEmail(oauth2Client: any): Promise<string | null> {
        try {
            const { google } = this.googleapisModule;
            const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
            const info = await oauth2.userinfo.get();
            return info.data.email ?? null;
        } catch {
            return null;
        }
    }

    private parseMessage(message: any): GmailMessage {
        const headers: Record<string, string> = {};
        for (const h of (message.payload?.headers ?? [])) {
            headers[h.name.toLowerCase()] = h.value;
        }

        const body = this.extractBody(message.payload);
        const isUnread = (message.labelIds ?? []).includes("UNREAD");

        return {
            id: message.id,
            threadId: message.threadId,
            from: headers["from"] ?? "",
            to: (headers["to"] ?? "").split(",").map((s: string) => s.trim()),
            subject: headers["subject"] ?? "(no subject)",
            snippet: message.snippet ?? "",
            body,
            date: headers["date"] ?? new Date().toISOString(),
            labelIds: message.labelIds ?? [],
            isUnread,
        };
    }

    private extractBody(payload: any): string {
        if (!payload) return "";

        // Direct body data
        if (payload.body?.data) {
            return Buffer.from(payload.body.data, "base64url").toString("utf8");
        }

        // Multipart — prefer text/plain, fall back to text/html
        if (payload.parts) {
            const textPart = payload.parts.find((p: any) => p.mimeType === "text/plain");
            if (textPart?.body?.data) {
                return Buffer.from(textPart.body.data, "base64url").toString("utf8");
            }
            const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
            if (htmlPart?.body?.data) {
                // Return raw HTML — the caller can strip tags if needed
                return Buffer.from(htmlPart.body.data, "base64url").toString("utf8");
            }
            // Recurse into nested multipart
            for (const part of payload.parts) {
                const nested = this.extractBody(part);
                if (nested) return nested;
            }
        }

        return "";
    }

    private buildRawMessage(
        from: string,
        to: string[],
        subject: string,
        body: string,
        threadId?: string
    ): string {
        const lines = [
            `From: ${from}`,
            `To: ${to.join(", ")}`,
            `Subject: ${subject}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/plain; charset=UTF-8`,
            "",
            body,
        ];
        const raw = lines.join("\r\n");
        return Buffer.from(raw).toString("base64url");
    }
}
