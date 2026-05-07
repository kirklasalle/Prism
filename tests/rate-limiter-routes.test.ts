/**
 * R2 — Per-route rate-limit overrides.
 *
 * Validates that the global cap and route-specific caps coexist
 * correctly:
 *
 *   1. A request to a route with no override consumes only the global
 *      bucket.
 *   2. A request to a route with a tighter override is denied as soon as
 *      the route bucket fills, even when global headroom remains.
 *   3. Different routes have independent buckets.
 *   4. Exempt routes (`/api/health`) are never counted.
 *   5. Exact-path overrides win over prefix overrides.
 *   6. The longest matching prefix wins when multiple prefixes match.
 */

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import type { IncomingMessage } from "node:http";

import { RateLimiter, DEFAULT_ROUTE_LIMITS } from "../src/core/security/rate-limiter.js";

function mkReq(url: string, ip = "10.0.0.1"): IncomingMessage {
    return {
        url,
        headers: {},
        socket: { remoteAddress: ip },
    } as unknown as IncomingMessage;
}

describe("R2 — RateLimiter per-route overrides", () => {
    it("default route limits include /api/auth/, /api/setup/, /api/chat/stream", () => {
        const patterns = DEFAULT_ROUTE_LIMITS.map((r) => r.pattern);
        assert.deepEqual(patterns.sort(), ["/api/auth/", "/api/chat/stream", "/api/setup/"]);
    });

    it("a request to a route with no override only consumes the global bucket", () => {
        const limiter = new RateLimiter({
            maxRequests: 3,
            windowMs: 60_000,
            routeLimits: [{ pattern: "/api/auth/", maxRequests: 2, windowMs: 60_000 }],
        });
        try {
            // Three requests to /api/orchestrator/run — all allowed by global=3.
            for (let i = 0; i < 3; i++) {
                const r = limiter.check(mkReq("/api/orchestrator/run"));
                assert.equal(r.allowed, true, `request ${i + 1} should be allowed`);
            }
            const denied = limiter.check(mkReq("/api/orchestrator/run"));
            assert.equal(denied.allowed, false);
            assert.equal(denied.rule, "global");
        } finally {
            limiter.dispose();
        }
    });

    it("denies once the route bucket fills, even with global headroom", () => {
        const limiter = new RateLimiter({
            maxRequests: 100, // wide-open global
            windowMs: 60_000,
            routeLimits: [{ pattern: "/api/auth/", maxRequests: 2, windowMs: 60_000 }],
        });
        try {
            assert.equal(limiter.check(mkReq("/api/auth/login")).allowed, true);
            assert.equal(limiter.check(mkReq("/api/auth/login")).allowed, true);
            const denied = limiter.check(mkReq("/api/auth/login"));
            assert.equal(denied.allowed, false);
            assert.equal(denied.rule, "route:/api/auth/");
            assert.ok((denied.retryAfterMs ?? 0) > 0);
        } finally {
            limiter.dispose();
        }
    });

    it("buckets are per-route — auth saturation does not block setup", () => {
        const limiter = new RateLimiter({
            maxRequests: 100,
            windowMs: 60_000,
            routeLimits: [
                { pattern: "/api/auth/", maxRequests: 1, windowMs: 60_000 },
                { pattern: "/api/setup/", maxRequests: 5, windowMs: 60_000 },
            ],
        });
        try {
            assert.equal(limiter.check(mkReq("/api/auth/login")).allowed, true);
            assert.equal(limiter.check(mkReq("/api/auth/login")).allowed, false);
            // Different prefix — independent bucket.
            for (let i = 0; i < 5; i++) {
                assert.equal(limiter.check(mkReq("/api/setup/profile")).allowed, true, `setup ${i + 1}`);
            }
        } finally {
            limiter.dispose();
        }
    });

    it("exempt routes are never counted", () => {
        const limiter = new RateLimiter({
            maxRequests: 1,
            windowMs: 60_000,
            exemptRoutes: ["/api/health"],
            routeLimits: [],
        });
        try {
            for (let i = 0; i < 50; i++) {
                assert.equal(limiter.check(mkReq("/api/health")).allowed, true, `health ${i + 1}`);
            }
        } finally {
            limiter.dispose();
        }
    });

    it("exact-path override wins over prefix override", () => {
        const limiter = new RateLimiter({
            maxRequests: 100,
            windowMs: 60_000,
            routeLimits: [
                { pattern: "/api/", maxRequests: 100, windowMs: 60_000 },
                { pattern: "/api/chat/stream", maxRequests: 1, windowMs: 60_000 }, // exact
            ],
        });
        try {
            assert.equal(limiter.check(mkReq("/api/chat/stream")).allowed, true);
            const denied = limiter.check(mkReq("/api/chat/stream"));
            assert.equal(denied.allowed, false);
            assert.equal(denied.rule, "route:/api/chat/stream");
        } finally {
            limiter.dispose();
        }
    });

    it("longest matching prefix wins", () => {
        const limiter = new RateLimiter({
            maxRequests: 100,
            windowMs: 60_000,
            routeLimits: [
                { pattern: "/api/", maxRequests: 100, windowMs: 60_000 },
                { pattern: "/api/setup/", maxRequests: 1, windowMs: 60_000 },
            ],
        });
        try {
            assert.equal(limiter.check(mkReq("/api/setup/profile")).allowed, true);
            const denied = limiter.check(mkReq("/api/setup/profile"));
            assert.equal(denied.allowed, false);
            assert.equal(denied.rule, "route:/api/setup/");
        } finally {
            limiter.dispose();
        }
    });

    it("per-IP isolation — one IP saturating route does not affect another", () => {
        const limiter = new RateLimiter({
            maxRequests: 100,
            windowMs: 60_000,
            routeLimits: [{ pattern: "/api/auth/", maxRequests: 1, windowMs: 60_000 }],
        });
        try {
            assert.equal(limiter.check(mkReq("/api/auth/login", "10.0.0.1")).allowed, true);
            assert.equal(limiter.check(mkReq("/api/auth/login", "10.0.0.1")).allowed, false);
            assert.equal(limiter.check(mkReq("/api/auth/login", "10.0.0.2")).allowed, true);
        } finally {
            limiter.dispose();
        }
    });
});
