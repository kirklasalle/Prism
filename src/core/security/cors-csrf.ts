/**
 * PRISM CORS + CSRF guard (R2).
 *
 * Two related defenses, both applied early in the HTTP pipeline:
 *
 * 1. **CORS allowlist** — exact-match origin allowlist with explicit
 *    `OPTIONS` preflight handling. By default the only allowed origin is
 *    the dashboard's own listening URL (loopback). Operators add
 *    additional origins via `PRISM_CORS_ORIGINS` (comma-separated). A
 *    request whose `Origin` header is non-empty AND not in the allowlist
 *    is rejected with `403 Forbidden` rather than silently downgraded —
 *    misconfiguration should fail loudly.
 *
 * 2. **Origin/Referer-based CSRF check** — modern, cookie-free CSRF
 *    defense. State-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`)
 *    must carry an `Origin` (or `Referer`) header whose origin is in the
 *    allowlist. Bearer-token API clients and `curl` are exempted because
 *    they do not run inside a cookied browser context (no CSRF surface).
 *    Same-origin GETs are not checked — they cannot mutate state.
 *
 * The bearer-token authentication scheme already prevents most CSRF
 * attacks (browsers do not auto-attach `Authorization: Bearer …`), but
 * the dashboard HTML is loaded by browsers and could be tricked into
 * issuing fetches under a stolen token if an XSS sink existed. The
 * Origin/Referer check is defense in depth: even with a leaked token,
 * a cross-origin page cannot mint a forged state-changing request that
 * is accepted by the runtime.
 *
 * No new dependencies. Pure node:http types.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Methods that can change server state. The set of methods that *do not*
 * mutate (`GET`, `HEAD`, `OPTIONS`) is intentionally narrow — `OPTIONS`
 * is a preflight, never a state change; `GET` and `HEAD` should be
 * idempotent by HTTP contract.
 */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Routes that bypass the Origin/Referer CSRF check entirely. These are
 * either (a) infrastructure endpoints that must be reachable from
 * scripted clients with no Origin header (health probes, metrics
 * scrapers) or (b) explicit "machine API" routes consumed by CLI tools
 * via bearer token only. Adding to this list is a security decision —
 * each entry must be defensible.
 */
const CSRF_EXEMPT_ROUTES = new Set([
    "/health",
    "/api/health",
    "/metrics",
    "/.well-known/agent.json",
]);

/**
 * Routes that bypass the Origin/Referer CSRF check via prefix match.
 * `/api/auth/*` is exempted because the auth flow itself bootstraps the
 * token; without an exemption first-time login from a fresh browser
 * (which has no cached token) would be impossible.
 */
const CSRF_EXEMPT_PREFIXES = ["/api/auth/"];

export interface CorsCsrfConfig {
    /**
     * Exact-match allowlist of accepted `Origin` values. Each entry must
     * be a full origin (`scheme://host[:port]`) — no globs, no path. The
     * string `"null"` (for `data:` URLs and sandboxed iframes) is
     * deliberately *not* accepted.
     */
    allowedOrigins: string[];
    /** Whether to log every rejection at WARN level. Default: true. */
    logRejections?: boolean;
}

export interface CorsCsrfResult {
    /** True when the request is allowed to proceed. */
    allowed: boolean;
    /**
     * Set when the guard already wrote a complete response (e.g. a 204
     * preflight ack or a 403 rejection). When true, the caller MUST stop
     * processing the request.
     */
    responseSent: boolean;
    /** Human-readable reason for rejection. Set when `allowed=false`. */
    reason?: string;
}

/**
 * Resolve the dashboard's effective allowlist from environment + the
 * server's own listening port. The own-origin loopback variants
 * (`http://localhost:PORT`, `http://127.0.0.1:PORT`) are always added
 * — without them the dashboard cannot fetch its own API.
 */
export function resolveAllowedOrigins(port: number, env: NodeJS.ProcessEnv = process.env): string[] {
    const list = new Set<string>([
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
        `https://localhost:${port}`,
        `https://127.0.0.1:${port}`,
    ]);
    const fromEnv = (env.PRISM_CORS_ORIGINS ?? "").trim();
    if (fromEnv) {
        for (const raw of fromEnv.split(",")) {
            const v = raw.trim();
            if (!v) continue;
            // Reject obvious wildcards — `*` is never acceptable in the
            // allowlist because the dashboard exposes authenticated state.
            if (v === "*") {
                throw new Error("[security] PRISM_CORS_ORIGINS=\"*\" is not permitted — allowlist must be specific origins");
            }
            // Strip trailing slash for tolerance — operators copy-paste
            // origins with and without a trailing slash.
            list.add(v.replace(/\/$/, ""));
        }
    }
    return Array.from(list);
}

/**
 * Extract the request origin from `Origin` or, as fallback, from
 * `Referer` (parsed to scheme://host[:port]). Returns null when neither
 * is present — used by the CSRF check to distinguish browser requests
 * from non-browser API clients.
 */
function extractRequestOrigin(req: IncomingMessage): string | null {
    const originHeader = req.headers["origin"];
    if (typeof originHeader === "string" && originHeader.length > 0 && originHeader !== "null") {
        return originHeader.replace(/\/$/, "");
    }
    const refererHeader = req.headers["referer"];
    if (typeof refererHeader === "string" && refererHeader.length > 0) {
        try {
            const u = new URL(refererHeader);
            return `${u.protocol}//${u.host}`;
        } catch {
            return null;
        }
    }
    return null;
}

function isExemptFromCsrf(url: string): boolean {
    const path = url.split("?")[0];
    if (CSRF_EXEMPT_ROUTES.has(path)) return true;
    for (const prefix of CSRF_EXEMPT_PREFIXES) {
        if (path.startsWith(prefix)) return true;
    }
    return false;
}

/**
 * Inspect a request and decide whether it should proceed. Always
 * applies CORS response headers when an Origin is present and allowed;
 * always rejects state-changing requests whose origin is not allowed.
 *
 * Idempotent and side-effect free except for response header / status
 * writes. Safe to call exactly once per request, before auth.
 */
export function applyCorsAndCsrf(
    req: IncomingMessage,
    res: ServerResponse,
    config: CorsCsrfConfig,
): CorsCsrfResult {
    const allowed = config.allowedOrigins;
    const url = req.url ?? "/";
    const method = (req.method ?? "GET").toUpperCase();
    const origin = extractRequestOrigin(req);

    // ── 1. CORS: validate Origin header (when present) ───────────────
    // A request without an Origin header is either (a) a same-origin
    // browser GET to a page navigation — fine, no CORS concern, or (b)
    // a non-browser client (curl, HTTP test runner) — fine, CORS does
    // not apply. We only reject when an Origin IS present and is NOT
    // in the allowlist.
    if (origin !== null) {
        if (!allowed.includes(origin)) {
            if (config.logRejections !== false) {
                console.warn(`[security][cors] rejected origin "${origin}" for ${method} ${url}`);
            }
            return rejectAndRespond(res, 403, "Origin not allowed", { origin });
        }
        // Mirror the validated origin back. Returning the literal allowed
        // origin (rather than `*`) keeps the response credentialable.
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    // ── 2. CORS preflight (OPTIONS) — short-circuit with 204 ─────────
    if (method === "OPTIONS") {
        const requestedHeaders = String(req.headers["access-control-request-headers"] ?? "");
        const requestedMethod = String(req.headers["access-control-request-method"] ?? "");
        // Reject preflights from non-allowlisted origins. (If origin is
        // null we fall through and return a generic 204 — some browsers
        // do this for same-origin OPTIONS.)
        if (origin !== null && !allowed.includes(origin)) {
            return rejectAndRespond(res, 403, "Preflight origin not allowed", { origin });
        }
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader(
            "Access-Control-Allow-Headers",
            requestedHeaders || "Authorization, Content-Type, X-Requested-With",
        );
        res.setHeader("Access-Control-Max-Age", "600");
        if (requestedMethod) {
            // Browsers send `Access-Control-Request-Method` on every
            // preflight. We honour it but don't validate beyond the
            // method allowlist above.
        }
        res.writeHead(204);
        res.end();
        return { allowed: false, responseSent: true };
    }

    // ── 3. Origin/Referer CSRF check on state-changing methods ───────
    if (STATE_CHANGING_METHODS.has(method) && !isExemptFromCsrf(url)) {
        if (origin === null) {
            // No Origin and no Referer — fine for non-browser API
            // clients (curl, automation). They are still authenticated
            // by the bearer token gate downstream. Allow.
            return { allowed: true, responseSent: false };
        }
        if (!allowed.includes(origin)) {
            if (config.logRejections !== false) {
                console.warn(`[security][csrf] rejected ${method} ${url} from origin "${origin}"`);
            }
            return rejectAndRespond(res, 403, "CSRF check failed: origin not allowed", { origin, method });
        }
    }

    return { allowed: true, responseSent: false };
}

function rejectAndRespond(
    res: ServerResponse,
    status: number,
    reason: string,
    detail: Record<string, unknown>,
): CorsCsrfResult {
    if (!res.headersSent) {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: reason, ...detail }));
    }
    return { allowed: false, responseSent: true, reason };
}
