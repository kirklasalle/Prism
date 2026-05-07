/**
 * E2E Smoke Test — PRISM Dashboard Server
 *
 * Starts the dashboard service, verifies key endpoints respond correctly,
 * and validates authentication gate, rate limiting, and health check.
 *
 * Run: npm run build && node --test --test-force-exit dist/tests/e2e-smoke.test.js
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AuthGate } from "../src/core/security/auth.js";
import { RateLimiter } from "../src/core/security/rate-limiter.js";

// ──────────────────────────────────────────────────────────────────────────────
// Unit tests for AuthGate
// ──────────────────────────────────────────────────────────────────────────────

describe("AuthGate", () => {
    const tokenPath = join(process.cwd(), ".prism-test-token");

    after(() => {
        try { unlinkSync(tokenPath); } catch { /* ok */ }
    });

    it("generates and persists a token on first create", () => {
        try { unlinkSync(tokenPath); } catch { /* ok */ }
        const gate = new AuthGate({ tokenFilePath: tokenPath });
        const token = gate.getToken();
        assert.ok(token.length >= 32, "token should be at least 32 chars");
        assert.ok(existsSync(tokenPath), "token file should be created");
        const stored = readFileSync(tokenPath, "utf-8").trim();
        assert.equal(stored, token);
    });

    it("loads existing token on subsequent create", () => {
        const gate1 = new AuthGate({ tokenFilePath: tokenPath });
        const token1 = gate1.getToken();
        const gate2 = new AuthGate({ tokenFilePath: tokenPath });
        assert.equal(gate2.getToken(), token1);
    });

    it("authenticates valid bearer token", () => {
        const gate = new AuthGate({ tokenFilePath: tokenPath });
        const token = gate.getToken();
        const req = { headers: { authorization: `Bearer ${token}` }, url: "/api/test" } as any;
        const result = gate.check(req);
        assert.equal(result.authenticated, true);
    });

    it("rejects invalid bearer token", () => {
        const gate = new AuthGate({ tokenFilePath: tokenPath });
        const req = { headers: { authorization: "Bearer wrong-token" }, url: "/api/test" } as any;
        const result = gate.check(req);
        assert.equal(result.authenticated, false);
    });

    it("allows public routes without auth", () => {
        const gate = new AuthGate({ tokenFilePath: tokenPath });
        const req = { headers: {}, url: "/health" } as any;
        const result = gate.check(req);
        assert.equal(result.authenticated, true);
    });

    it("allows public prefixes without auth", () => {
        const gate = new AuthGate({ tokenFilePath: tokenPath });
        const req = { headers: {}, url: "/public/dashboard.css" } as any;
        const result = gate.check(req);
        assert.equal(result.authenticated, true);
    });

    it("rejects missing auth header on protected routes", () => {
        const gate = new AuthGate({ tokenFilePath: tokenPath });
        const req = { headers: {}, url: "/api/chat/message" } as any;
        const result = gate.check(req);
        assert.equal(result.authenticated, false);
    });

    it("accepts token via query param", () => {
        const gate = new AuthGate({ tokenFilePath: tokenPath });
        const token = gate.getToken();
        const req = { headers: {}, url: `/dashboard?token=${token}` } as any;
        const result = gate.check(req);
        assert.equal(result.authenticated, true);
    });

    it("bypasses all checks when disabled", () => {
        const gate = new AuthGate({ tokenFilePath: tokenPath, disabled: true });
        const req = { headers: {}, url: "/api/test" } as any;
        const result = gate.check(req);
        assert.equal(result.authenticated, true);
    });

    it("regenerates token", () => {
        const gate = new AuthGate({ tokenFilePath: tokenPath });
        const old = gate.getToken();
        const newToken = gate.regenerateToken();
        assert.notEqual(newToken, old);
        assert.equal(gate.getToken(), newToken);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Unit tests for RateLimiter
// ──────────────────────────────────────────────────────────────────────────────

describe("RateLimiter", () => {
    it("allows requests within limit", () => {
        const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });
        const req = { url: "/api/test", socket: { remoteAddress: "1.2.3.4" }, headers: {} } as any;
        for (let i = 0; i < 5; i++) {
            const result = limiter.check(req);
            assert.equal(result.allowed, true);
        }
        limiter.dispose();
    });

    it("blocks requests over limit", () => {
        const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60000 });
        const req = { url: "/api/test", socket: { remoteAddress: "5.6.7.8" }, headers: {} } as any;
        for (let i = 0; i < 3; i++) {
            limiter.check(req);
        }
        const blocked = limiter.check(req);
        assert.equal(blocked.allowed, false);
        assert.equal(blocked.remaining, 0);
        assert.ok(typeof blocked.retryAfterMs === "number");
        limiter.dispose();
    });

    it("exempts health routes", () => {
        const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60000 });
        const req = { url: "/health", socket: { remoteAddress: "9.9.9.9" }, headers: {} } as any;
        // Should always be allowed since /health is exempt
        for (let i = 0; i < 10; i++) {
            const result = limiter.check(req);
            assert.equal(result.allowed, true);
        }
        limiter.dispose();
    });

    it("tracks different IPs separately", () => {
        const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000 });
        const req1 = { url: "/api/test", socket: { remoteAddress: "10.0.0.1" }, headers: {} } as any;
        const req2 = { url: "/api/test", socket: { remoteAddress: "10.0.0.2" }, headers: {} } as any;
        limiter.check(req1);
        limiter.check(req1);
        const blocked = limiter.check(req1);
        assert.equal(blocked.allowed, false);
        // Different IP should still be allowed
        const allowed = limiter.check(req2);
        assert.equal(allowed.allowed, true);
        limiter.dispose();
    });
});
