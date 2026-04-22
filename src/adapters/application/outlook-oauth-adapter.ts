/**
 * Outlook OAuth Adapter — Microsoft Graph API via MSAL
 *
 * Implements OAuth 2.0 (authorization code flow with PKCE) for the Microsoft
 * Graph mail and calendar APIs.  Uses the `@azure/msal-node` npm package
 * (optional dependency).  When MSAL is not installed or credentials are not
 * set, every method returns gracefully with `available: false`.
 *
 * Required environment variables:
 *   PRISM_OUTLOOK_CLIENT_ID      — Azure AD / Entra app (client) ID
 *   PRISM_OUTLOOK_TENANT_ID      — Azure AD tenant ID, or "common" for personal accounts
 *   PRISM_OUTLOOK_REDIRECT_URI   — OAuth redirect URI (default: http://localhost:7070/api/auth/outlook/callback)
 *
 * Note: The Microsoft Identity Platform does not return a client_secret for
 * public clients (SPA / desktop apps).  PRISM registers as a public client
 * so no PRISM_OUTLOOK_CLIENT_SECRET is required.  If you are registering
 * PRISM as a confidential client add PRISM_OUTLOOK_CLIENT_SECRET.
 *
 * Scopes granted:
 *   openid profile email offline_access
 *   Mail.ReadWrite Mail.Send
 *   Calendars.ReadWrite
 *
 * Phase E2 — Outlook OAuth workstream.
 */

import { createHash, randomBytes } from "node:crypto";
import type { OAuthTokenStore, OAuthToken } from "../../core/operator/oauth-token-store.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface OutlookMessage {
    id: string;
    conversationId: string;
    from: string;
    to: string[];
    subject: string;
    bodyPreview: string;
    body: string;
    receivedDateTime: string;
    isRead: boolean;
    hasAttachments: boolean;
    importance: "low" | "normal" | "high";
}

export interface OutlookThread {
    conversationId: string;
    subject: string;
    messages: OutlookMessage[];
    lastMessageDate: string;
    hasUnread: boolean;
}

export interface OutlookSendResult {
    messageId: string;
    conversationId: string;
}

export interface OutlookAdapterStatus {
    available: boolean;
    connected: boolean;
    email: string | null;
    displayName: string | null;
    error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDER_KEY = "outlook";

const GRAPH_SCOPES = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "Mail.ReadWrite",
    "Mail.Send",
    "Calendars.ReadWrite",
];

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// ── Adapter implementation ────────────────────────────────────────────────────

export class OutlookOAuthAdapter {
    private msalModule: any = null;
    private initialized = false;
    private initPromise: Promise<void>;
    /** PKCE verifier for the current in-flight auth request. */
    private pkceVerifier: string | null = null;

    constructor(private readonly tokenStore: OAuthTokenStore) {
        this.initPromise = this.tryInit();
    }

    get isAvailable(): boolean {
        return this.msalModule !== null
            && !!process.env.PRISM_OUTLOOK_CLIENT_ID;
    }

    get isConnected(): boolean {
        return this.tokenStore.has(PROVIDER_KEY);
    }

    // ── OAuth flow ──────────────────────────────────────────────────────────

    /**
     * Generate the Microsoft consent URL with PKCE challenge.
     * Redirect the user's browser to this URL.
     */
    async getAuthorizationUrl(): Promise<string> {
        await this.initPromise;
        if (!this.isAvailable) {
            throw new Error("Outlook OAuth not available: @azure/msal-node not installed or credentials not configured.");
        }

        // Generate PKCE pair
        const verifier = randomBytes(32).toString("base64url");
        this.pkceVerifier = verifier;
        const challenge = createHash("sha256").update(verifier).digest("base64url");

        const clientId = process.env.PRISM_OUTLOOK_CLIENT_ID!;
        const tenantId = process.env.PRISM_OUTLOOK_TENANT_ID ?? "common";
        const redirectUri = process.env.PRISM_OUTLOOK_REDIRECT_URI
            ?? "http://localhost:7070/api/auth/outlook/callback";

        const params = new URLSearchParams({
            client_id: clientId,
            response_type: "code",
            redirect_uri: redirectUri,
            scope: GRAPH_SCOPES.join(" "),
            response_mode: "query",
            code_challenge: challenge,
            code_challenge_method: "S256",
        });

        return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
    }

    /**
     * Exchange the authorization code from Microsoft's callback for tokens.
     */
    async exchangeCode(code: string): Promise<OutlookAdapterStatus> {
        await this.initPromise;
        if (!this.isAvailable) {
            return { available: false, connected: false, email: null, displayName: null, error: "@azure/msal-node not available" };
        }

        const clientId = process.env.PRISM_OUTLOOK_CLIENT_ID!;
        const tenantId = process.env.PRISM_OUTLOOK_TENANT_ID ?? "common";
        const redirectUri = process.env.PRISM_OUTLOOK_REDIRECT_URI
            ?? "http://localhost:7070/api/auth/outlook/callback";

        try {
            const body = new URLSearchParams({
                client_id: clientId,
                code,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
                scope: GRAPH_SCOPES.join(" "),
                code_verifier: this.pkceVerifier ?? "",
            });

            if (process.env.PRISM_OUTLOOK_CLIENT_SECRET) {
                body.set("client_secret", process.env.PRISM_OUTLOOK_CLIENT_SECRET);
            }

            const resp = await fetch(
                `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: body.toString(),
                }
            );

            if (!resp.ok) {
                const err = await resp.text();
                throw new Error(`Token exchange failed: ${err}`);
            }

            const data = await resp.json() as {
                access_token: string;
                refresh_token?: string;
                expires_in?: number;
            };

            this.pkceVerifier = null;

            const expiresAt = data.expires_in
                ? new Date(Date.now() + data.expires_in * 1000).toISOString()
                : null;

            const oauthToken: OAuthToken = {
                accessToken: data.access_token,
                refreshToken: data.refresh_token ?? null,
                expiresAt,
                scopes: GRAPH_SCOPES,
                provider: PROVIDER_KEY,
            };
            this.tokenStore.set(PROVIDER_KEY, oauthToken);

            const profile = await this.getProfile(data.access_token);
            return {
                available: true,
                connected: true,
                email: profile.email,
                displayName: profile.displayName,
            };
        } catch (err: unknown) {
            return {
                available: true,
                connected: false,
                email: null,
                displayName: null,
                error: (err as Error).message,
            };
        }
    }

    /**
     * Get current connection status.
     */
    async getStatus(): Promise<OutlookAdapterStatus> {
        await this.initPromise;
        if (!this.isAvailable) {
            return { available: false, connected: false, email: null, displayName: null };
        }
        if (!this.isConnected) {
            return { available: true, connected: false, email: null, displayName: null };
        }
        try {
            const token = await this.getValidAccessToken();
            const profile = await this.getProfile(token);
            return { available: true, connected: true, email: profile.email, displayName: profile.displayName };
        } catch (err: unknown) {
            return {
                available: true,
                connected: false,
                email: null,
                displayName: null,
                error: (err as Error).message,
            };
        }
    }

    async disconnect(): Promise<void> {
        this.tokenStore.clear(PROVIDER_KEY);
    }

    // ── Mail API ────────────────────────────────────────────────────────────

    /**
     * List inbox messages, optionally filtered.
     * @param maxResults Maximum number of messages (default: 25)
     * @param folder Folder name, default "inbox"
     */
    async listMessages(maxResults = 25, folder = "inbox"): Promise<OutlookMessage[]> {
        const token = await this.getValidAccessToken();
        const url = `${GRAPH_BASE}/me/mailFolders/${folder}/messages?$top=${maxResults}&$orderby=receivedDateTime desc`;
        const data = await this.graphGet(url, token);
        return (data.value ?? []).map((m: any) => this.parseMessage(m));
    }

    /**
     * Send an email.
     */
    async sendEmail(
        to: string[],
        subject: string,
        body: string,
        isHtml = false
    ): Promise<OutlookSendResult> {
        const token = await this.getValidAccessToken();
        const payload = {
            message: {
                subject,
                body: { contentType: isHtml ? "HTML" : "Text", content: body },
                toRecipients: to.map((addr) => ({ emailAddress: { address: addr } })),
            },
            saveToSentItems: true,
        };
        const resp = await fetch(`${GRAPH_BASE}/me/sendMail`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`sendMail failed: ${err}`);
        }
        // sendMail returns 202 with no body; we use a placeholder
        return { messageId: "", conversationId: "" };
    }

    /**
     * Mark a message as read.
     */
    async markAsRead(messageId: string): Promise<void> {
        const token = await this.getValidAccessToken();
        await fetch(`${GRAPH_BASE}/me/messages/${messageId}`, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ isRead: true }),
        });
    }

    // ── Calendar API ────────────────────────────────────────────────────────

    /**
     * List upcoming calendar events.
     */
    async listEvents(maxResults = 50, timeMin = new Date().toISOString()): Promise<any[]> {
        const token = await this.getValidAccessToken();
        const url = `${GRAPH_BASE}/me/calendar/events?$top=${maxResults}&$filter=start/dateTime ge '${timeMin}'&$orderby=start/dateTime`;
        const data = await this.graphGet(url, token);
        return data.value ?? [];
    }

    /**
     * Create a new calendar event.
     */
    async createEvent(event: any): Promise<any> {
        const token = await this.getValidAccessToken();
        const resp = await fetch(`${GRAPH_BASE}/me/calendar/events`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(event),
        });
        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`createEvent failed: ${err}`);
        }
        return resp.json();
    }

    /**
     * Update an existing calendar event.
     */
    async updateEvent(eventId: string, event: any): Promise<any> {
        const token = await this.getValidAccessToken();
        const resp = await fetch(`${GRAPH_BASE}/me/calendar/events/${eventId}`, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(event),
        });
        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`updateEvent failed: ${err}`);
        }
        return resp.json();
    }

    /**
     * Delete a calendar event.
     */
    async deleteEvent(eventId: string): Promise<void> {
        const token = await this.getValidAccessToken();
        const resp = await fetch(`${GRAPH_BASE}/me/calendar/events/${eventId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`deleteEvent failed: ${err}`);
        }
    }

    // ── Internal helpers ────────────────────────────────────────────────────

    private async tryInit(): Promise<void> {
        try {
            this.msalModule = await import("@azure/msal-node");
            this.initialized = true;
        } catch {
            this.initialized = false;
        }
    }

    private async getValidAccessToken(): Promise<string> {
        const token = this.tokenStore.get(PROVIDER_KEY);
        if (!token) throw new Error("Not connected to Outlook. Call getAuthorizationUrl() first.");

        if (token.expiresAt) {
            const expiresAt = new Date(token.expiresAt).getTime();
            const BUFFER_MS = 5 * 60 * 1000;
            if (Date.now() + BUFFER_MS >= expiresAt && token.refreshToken) {
                try {
                    const refreshed = await this.refreshToken(token.refreshToken);
                    return refreshed;
                } catch {
                    // Use current token; API call will fail with auth error if truly expired
                }
            }
        }

        return token.accessToken;
    }

    private async refreshToken(refreshToken: string): Promise<string> {
        const clientId = process.env.PRISM_OUTLOOK_CLIENT_ID!;
        const tenantId = process.env.PRISM_OUTLOOK_TENANT_ID ?? "common";

        const body = new URLSearchParams({
            client_id: clientId,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            scope: GRAPH_SCOPES.join(" "),
        });

        if (process.env.PRISM_OUTLOOK_CLIENT_SECRET) {
            body.set("client_secret", process.env.PRISM_OUTLOOK_CLIENT_SECRET);
        }

        const resp = await fetch(
            `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
            {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body.toString(),
            }
        );

        if (!resp.ok) throw new Error(`Token refresh failed: ${await resp.text()}`);

        const data = await resp.json() as {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
        };

        const current = this.tokenStore.get(PROVIDER_KEY)!;
        const updated: OAuthToken = {
            ...current,
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? current.refreshToken,
            expiresAt: data.expires_in
                ? new Date(Date.now() + data.expires_in * 1000).toISOString()
                : current.expiresAt,
        };
        this.tokenStore.set(PROVIDER_KEY, updated);
        return data.access_token;
    }

    private async getProfile(accessToken: string): Promise<{ email: string | null; displayName: string | null }> {
        try {
            const data = await this.graphGet(`${GRAPH_BASE}/me?$select=mail,displayName,userPrincipalName`, accessToken);
            return {
                email: data.mail ?? data.userPrincipalName ?? null,
                displayName: data.displayName ?? null,
            };
        } catch {
            return { email: null, displayName: null };
        }
    }

    private async graphGet(url: string, token: string): Promise<any> {
        const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`Graph API error ${resp.status}: ${err}`);
        }
        return resp.json();
    }

    private parseMessage(m: any): OutlookMessage {
        return {
            id: m.id,
            conversationId: m.conversationId ?? "",
            from: m.from?.emailAddress?.address ?? "",
            to: (m.toRecipients ?? []).map((r: any) => r.emailAddress?.address ?? ""),
            subject: m.subject ?? "(no subject)",
            bodyPreview: m.bodyPreview ?? "",
            body: m.body?.content ?? "",
            receivedDateTime: m.receivedDateTime ?? new Date().toISOString(),
            isRead: m.isRead ?? false,
            hasAttachments: m.hasAttachments ?? false,
            importance: m.importance ?? "normal",
        };
    }
}
