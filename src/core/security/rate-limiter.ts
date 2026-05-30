/**
 * PRISM Rate Limiter
 *
 * Fixed-window per-IP rate limiting for the dashboard HTTP server.
 * Prevents abuse without requiring external dependencies.
 *
 * R2 (2026-Q3): Adds **per-route overrides**. Sensitive endpoints —
 * authentication, setup wizard mutations, the streaming chat surface —
 * carry tighter caps than the global default so a single misbehaving
 * client cannot brute-force credentials or DoS the LLM pipeline.
 * Per-route counters are tracked independently of the global counter:
 * a request that passes the global cap but trips a route-specific cap
 * is still rejected. Route matching is exact-path or longest-prefix.
 */

import type { IncomingMessage } from "node:http";

/**
 * A per-route override: matches by exact path or longest-prefix and
 * applies its own (count, windowMs) instead of the global defaults.
 * Routes are checked in array order; the first match wins.
 */
export interface RouteRateLimit {
    /** Exact path (`/api/auth/login`) or prefix ending in `/` (`/api/setup/`). */
    pattern: string;
    /** Max requests per window per IP for this route. */
    maxRequests: number;
    /** Window size in ms for this route. */
    windowMs: number;
}

export interface RateLimitConfig {
    /** Max requests per window per IP */
    maxRequests: number;
    /** Window size in milliseconds */
    windowMs: number;
    /** Routes that bypass rate limiting */
    exemptRoutes?: string[];
    /** Per-route overrides applied in addition to the global limit. */
    routeLimits?: RouteRateLimit[];
    /**
     * When true (default), loopback clients (127.0.0.1, ::1, localhost-equivalent)
     * skip the **global** rate limit. The dashboard is operator-local — every
     * tab that polls at 2–5s intervals belongs to the operator's own browser,
     * and clipping the global budget at 200/min collapses the UI as soon as
     * 4–5 tabs have been visited. Per-route overrides (/api/auth/, /api/setup/)
     * continue to apply on loopback so brute-force protection on credential
     * surfaces is preserved. Disable explicitly with `bypassLoopback:false`
     * when running behind a reverse proxy that does not strip X-Forwarded-For.
     */
    bypassLoopback?: boolean;
}

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    retryAfterMs?: number;
    /** Identifier of the rule that caused a denial — useful for logs / tests. */
    rule?: "global" | string;
}

interface WindowEntry {
    count: number;
    resetAt: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
    maxRequests: 50,
    windowMs: 60_000, // 1 minute
    exemptRoutes: ["/health", "/api/health"],
};

/**
 * Default per-route overrides. These caps reflect operational reality:
 *
 *   - `/api/auth/*` is a credential-validating surface; aggressive caps
 *     blunt brute-force attempts even before the auth gate runs.
 *   - `/api/setup/*` mutates first-run state; abuse here is either a
 *     misconfigured client or an attack on a freshly bootstrapped node.
 *   - `/api/chat/stream` is the LLM streaming surface; runaway clients
 *     can burn through provider quotas and CPU. The limit is generous
 *     (60/min) but bounded.
 *
 * Operators can override these via the `routeLimits` constructor arg.
 */
export const DEFAULT_ROUTE_LIMITS: RouteRateLimit[] = [
    { pattern: "/api/auth/", maxRequests: 20, windowMs: 60_000 },
    { pattern: "/api/setup/", maxRequests: 30, windowMs: 60_000 },
    { pattern: "/api/chat/stream", maxRequests: 60, windowMs: 60_000 },
];

export class RateLimiter {
    private readonly globalWindows = new Map<string, WindowEntry>();
    private readonly routeWindows = new Map<string, Map<string, WindowEntry>>();
    private readonly config: Required<RateLimitConfig>;
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor(config?: Partial<RateLimitConfig>) {
        this.config = {
            maxRequests: config?.maxRequests ?? DEFAULT_CONFIG.maxRequests,
            windowMs: config?.windowMs ?? DEFAULT_CONFIG.windowMs,
            exemptRoutes: config?.exemptRoutes ?? DEFAULT_CONFIG.exemptRoutes ?? [],
            routeLimits: config?.routeLimits ?? DEFAULT_ROUTE_LIMITS,
            bypassLoopback: config?.bypassLoopback ?? true,
        };
        // Cleanup stale entries every 5 minutes
        this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60_000);
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    check(req: IncomingMessage): RateLimitResult {
        const url = (req.url ?? "").split("?")[0];

        // Exempt routes
        if (this.config.exemptRoutes.includes(url)) {
            return { allowed: true, remaining: this.config.maxRequests };
        }

        const ip = this.extractIp(req);
        const now = Date.now();

        // ── 1. Per-route bucket (when applicable). Checked first so a
        //       sensitive endpoint cannot be abused even when the global
        //       counter has plenty of headroom remaining. ─────────────
        const route = this.matchRoute(url);
        if (route) {
            const result = this.consume(this.routeBucket(route.pattern), ip, now, route.maxRequests, route.windowMs);
            if (!result.allowed) {
                return { ...result, rule: `route:${route.pattern}` };
            }
        }

        // ── 2. Global bucket ─────────────────────────────────────────
        // Loopback clients bypass the global cap by default — see
        // RateLimitConfig.bypassLoopback for rationale. Per-route caps
        // (auth, setup) above already ran and still apply.
        if (this.config.bypassLoopback && this.isLoopback(req)) {
            return { allowed: true, remaining: this.config.maxRequests };
        }
        const global = this.consume(this.globalWindows, ip, now, this.config.maxRequests, this.config.windowMs);
        if (!global.allowed) {
            return { ...global, rule: "global" };
        }
        return global;
    }

    dispose(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    private consume(
        bucket: Map<string, WindowEntry>,
        ip: string,
        now: number,
        max: number,
        windowMs: number,
    ): RateLimitResult {
        const entry = bucket.get(ip);
        if (!entry || now >= entry.resetAt) {
            bucket.set(ip, { count: 1, resetAt: now + windowMs });
            return { allowed: true, remaining: max - 1 };
        }
        if (entry.count >= max) {
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: entry.resetAt - now,
            };
        }
        entry.count++;
        return { allowed: true, remaining: max - entry.count };
    }

    private matchRoute(url: string): RouteRateLimit | null {
        // Longest-prefix wins: scan all matches and pick the most specific.
        let best: RouteRateLimit | null = null;
        for (const rule of this.config.routeLimits) {
            if (rule.pattern.endsWith("/")) {
                if (url.startsWith(rule.pattern)) {
                    if (!best || rule.pattern.length > best.pattern.length) best = rule;
                }
            } else if (url === rule.pattern) {
                // Exact match always wins over a shorter prefix.
                return rule;
            }
        }
        return best;
    }

    private routeBucket(pattern: string): Map<string, WindowEntry> {
        let bucket = this.routeWindows.get(pattern);
        if (!bucket) {
            bucket = new Map();
            this.routeWindows.set(pattern, bucket);
        }
        return bucket;
    }

    private extractIp(req: IncomingMessage): string {
        // Trust X-Forwarded-For only if from loopback (reverse proxy scenario)
        const remoteAddr = req.socket.remoteAddress ?? "unknown";
        if (remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1") {
            const forwarded = req.headers["x-forwarded-for"];
            if (typeof forwarded === "string") {
                const first = forwarded.split(",")[0].trim();
                if (first) return first;
            }
        }
        return remoteAddr;
    }

    /**
     * Loopback test against the *socket* — never the X-Forwarded-For header.
     * Used by `check()` to decide whether the global cap applies. We
     * deliberately do not honor X-Forwarded-For here: a reverse-proxied
     * request always sees a loopback socket, but the *real* client may be
     * remote and must be subject to the global limit.
     */
    private isLoopback(req: IncomingMessage): boolean {
        const remoteAddr = req.socket.remoteAddress ?? "";
        if (remoteAddr !== "127.0.0.1" && remoteAddr !== "::1" && remoteAddr !== "::ffff:127.0.0.1") {
            return false;
        }
        // If a reverse proxy is in front, the real client appears in
        // X-Forwarded-For. In that case we are NOT loopback for the
        // purposes of bypassing the global cap.
        const forwarded = req.headers["x-forwarded-for"];
        if (typeof forwarded === "string" && forwarded.trim().length > 0) {
            return false;
        }
        return true;
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [ip, entry] of this.globalWindows) {
            if (now >= entry.resetAt) this.globalWindows.delete(ip);
        }
        for (const bucket of this.routeWindows.values()) {
            for (const [ip, entry] of bucket) {
                if (now >= entry.resetAt) bucket.delete(ip);
            }
        }
    }
}
