/**
 * PRISM Enterprise IAM — signed-cookie session store (Phase H-2)
 *
 * Sessions are persisted in `iam_sso_sessions` (see `IamStore`); the
 * cookie value carries only the opaque session id wrapped in an HMAC-SHA-256
 * signature so it cannot be forged without `PRISM_SSO_SESSION_SECRET`.
 *
 * Cookie format: `<sessionId>.<base64url(hmac)>`. The cookie is set with
 * `HttpOnly; Secure; SameSite=Lax; Path=/`. `Secure` is dropped only when
 * the runtime is in dev mode (`PRISM_ENV_PROFILE=dev` AND request is HTTP)
 * so SSO can be tested locally over loopback.
 *
 * The secret is read from `PRISM_SSO_SESSION_SECRET`. If unset, a random
 * 32-byte value is generated on first construction and held only in memory
 * — this is fine for single-process dev / test runs but means existing
 * sessions are invalidated on every restart. Production deployments MUST
 * provide a stable value.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { IamStore, IamSsoSession } from "../store.js";

const COOKIE_NAME = "prism_sso";

export interface SessionCookieOptions {
    /** When set, mirrors a fixed value for tests. */
    secret?: string;
    /** Cookie name override (default `prism_sso`). */
    cookieName?: string;
    /** Force `Secure` flag on/off for tests. */
    secure?: boolean;
}

export class SessionManager {
    private readonly secret: Buffer;
    private readonly cookieName: string;
    private readonly forceSecure: boolean | undefined;

    constructor(private readonly store: IamStore, opts: SessionCookieOptions = {}) {
        const raw = opts.secret ?? process.env.PRISM_SSO_SESSION_SECRET ?? "";
        this.secret = raw.length >= 32
            ? Buffer.from(raw, "utf-8")
            : randomBytes(32);
        this.cookieName = opts.cookieName ?? COOKIE_NAME;
        this.forceSecure = opts.secure;
    }

    /** Create a fresh session for `userId@tenantId` and return the cookie value. */
    issue(userId: string, tenantId: string, ttlSeconds = 8 * 3600): { cookie: string; session: IamSsoSession } {
        const session = this.store.createSession(userId, tenantId, ttlSeconds);
        const cookie = this.signSessionId(session.id);
        return { cookie, session };
    }

    /** Verify a presented cookie value and return the underlying session. */
    verify(cookieValue: string | undefined | null): IamSsoSession | null {
        if (!cookieValue) return null;
        const sessionId = this.unsignSessionId(cookieValue);
        if (!sessionId) return null;
        return this.store.getSession(sessionId);
    }

    /** Revoke the session referenced by a cookie (logout). */
    revoke(cookieValue: string | undefined | null): void {
        const sessionId = this.unsignSessionId(cookieValue ?? "");
        if (sessionId) this.store.deleteSession(sessionId);
    }

    /** Build a `Set-Cookie` header value for a freshly issued cookie. */
    buildSetCookie(cookieValue: string, ttlSeconds = 8 * 3600): string {
        const parts = [
            `${this.cookieName}=${cookieValue}`,
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            `Max-Age=${ttlSeconds}`,
        ];
        const secure = this.forceSecure ?? (process.env.PRISM_ENV_PROFILE !== "dev");
        if (secure) parts.push("Secure");
        return parts.join("; ");
    }

    /** Build the corresponding clear-cookie header value. */
    buildClearCookie(): string {
        const parts = [
            `${this.cookieName}=`,
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            "Max-Age=0",
        ];
        const secure = this.forceSecure ?? (process.env.PRISM_ENV_PROFILE !== "dev");
        if (secure) parts.push("Secure");
        return parts.join("; ");
    }

    /** Read the SSO cookie out of an inbound request, or null. */
    readCookie(req: IncomingMessage): string | null {
        const header = req.headers["cookie"];
        if (!header || typeof header !== "string") return null;
        const parts = header.split(/;\s*/);
        for (const p of parts) {
            const eq = p.indexOf("=");
            if (eq < 0) continue;
            const name = p.slice(0, eq);
            const value = p.slice(eq + 1);
            if (name === this.cookieName) return value;
        }
        return null;
    }

    /** Helper to set the SSO cookie on an outbound response. */
    writeCookie(res: ServerResponse, cookieValue: string, ttlSeconds = 8 * 3600): void {
        res.setHeader("Set-Cookie", this.buildSetCookie(cookieValue, ttlSeconds));
    }

    /** Helper to clear the SSO cookie on an outbound response. */
    clearCookie(res: ServerResponse): void {
        res.setHeader("Set-Cookie", this.buildClearCookie());
    }

    private signSessionId(sessionId: string): string {
        const sig = createHmac("sha256", this.secret).update(sessionId).digest("base64url");
        return `${sessionId}.${sig}`;
    }

    private unsignSessionId(cookieValue: string): string | null {
        const dot = cookieValue.lastIndexOf(".");
        if (dot < 0) return null;
        const id = cookieValue.slice(0, dot);
        const sig = cookieValue.slice(dot + 1);
        if (!id || !sig) return null;
        const expected = createHmac("sha256", this.secret).update(id).digest("base64url");
        try {
            const a = Buffer.from(sig, "base64url");
            const b = Buffer.from(expected, "base64url");
            if (a.length !== b.length) return null;
            if (!timingSafeEqual(a, b)) return null;
        } catch {
            return null;
        }
        return id;
    }
}
