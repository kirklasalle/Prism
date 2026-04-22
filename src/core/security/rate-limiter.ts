/**
 * PRISM Rate Limiter
 *
 * Fixed-window per-IP rate limiting for the dashboard HTTP server.
 * Prevents abuse without requiring external dependencies.
 */

import type { IncomingMessage } from "node:http";

export interface RateLimitConfig {
    /** Max requests per window per IP */
    maxRequests: number;
    /** Window size in milliseconds */
    windowMs: number;
    /** Routes that bypass rate limiting */
    exemptRoutes?: string[];
}

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    retryAfterMs?: number;
}

interface WindowEntry {
    count: number;
    resetAt: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
    maxRequests: 200,
    windowMs: 60_000, // 1 minute
    exemptRoutes: ["/health", "/api/health"],
};

export class RateLimiter {
    private readonly windows = new Map<string, WindowEntry>();
    private readonly config: Required<RateLimitConfig>;
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor(config?: Partial<RateLimitConfig>) {
        this.config = {
            maxRequests: config?.maxRequests ?? DEFAULT_CONFIG.maxRequests,
            windowMs: config?.windowMs ?? DEFAULT_CONFIG.windowMs,
            exemptRoutes: config?.exemptRoutes ?? DEFAULT_CONFIG.exemptRoutes ?? [],
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
        const entry = this.windows.get(ip);

        if (!entry || now >= entry.resetAt) {
            // New window
            this.windows.set(ip, { count: 1, resetAt: now + this.config.windowMs });
            return { allowed: true, remaining: this.config.maxRequests - 1 };
        }

        if (entry.count >= this.config.maxRequests) {
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: entry.resetAt - now,
            };
        }

        entry.count++;
        return { allowed: true, remaining: this.config.maxRequests - entry.count };
    }

    dispose(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
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

    private cleanup(): void {
        const now = Date.now();
        for (const [ip, entry] of this.windows) {
            if (now >= entry.resetAt) {
                this.windows.delete(ip);
            }
        }
    }
}
