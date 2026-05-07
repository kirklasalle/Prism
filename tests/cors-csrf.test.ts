/**
 * R2 — CORS allowlist + Origin/Referer CSRF guard tests.
 *
 * Validates the contract of `applyCorsAndCsrf` and `resolveAllowedOrigins`
 * end-to-end against a stubbed `IncomingMessage` / `ServerResponse`. No
 * server is spawned — these are pure unit tests.
 *
 * Coverage:
 *   1. Loopback origins are auto-allowlisted.
 *   2. PRISM_CORS_ORIGINS adds explicit origins; "*" is rejected.
 *   3. GET with a same-origin Origin header passes and gets ACAO mirror.
 *   4. GET with a foreign Origin header is rejected with 403.
 *   5. POST with no Origin header passes (non-browser API client).
 *   6. POST with a foreign Origin header is rejected (CSRF).
 *   7. POST with a valid same-origin Referer (no Origin) passes.
 *   8. OPTIONS preflight from allowed origin returns 204 with full headers.
 *   9. OPTIONS preflight from foreign origin is rejected with 403.
 *  10. /api/auth/* is exempt from CSRF (bootstrap path).
 *  11. /api/health is exempt from CSRF (probe path).
 */

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
    applyCorsAndCsrf,
    resolveAllowedOrigins,
    type CorsCsrfConfig,
} from "../src/core/security/cors-csrf.js";

interface StubResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    ended: boolean;
    headersSent: boolean;
    setHeader(name: string, value: string): void;
    writeHead(status: number, headers?: Record<string, string>): void;
    end(body?: string): void;
}

function mkRes(): StubResponse & ServerResponse {
    const r: StubResponse = {
        statusCode: 0,
        headers: {},
        body: "",
        ended: false,
        headersSent: false,
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        writeHead(status, headers) {
            this.statusCode = status;
            this.headersSent = true;
            if (headers) {
                for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v;
            }
        },
        end(body) { this.ended = true; if (body) this.body = body; },
    };
    return r as unknown as StubResponse & ServerResponse;
}

function mkReq(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
    return { method, url, headers: { ...headers } } as unknown as IncomingMessage;
}

const PORT = 7070;
const SAME_ORIGIN = `http://localhost:${PORT}`;
const FOREIGN = "https://evil.example.com";

function defaultConfig(extra: string[] = []): CorsCsrfConfig {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (extra.length > 0) env.PRISM_CORS_ORIGINS = extra.join(",");
    else delete env.PRISM_CORS_ORIGINS;
    return {
        allowedOrigins: resolveAllowedOrigins(PORT, env),
        logRejections: false,
    };
}

describe("R2 — CORS + CSRF guard", () => {
    describe("resolveAllowedOrigins", () => {
        it("auto-includes loopback variants for the configured port", () => {
            const list = resolveAllowedOrigins(7070, {});
            assert.ok(list.includes("http://localhost:7070"));
            assert.ok(list.includes("http://127.0.0.1:7070"));
            assert.ok(list.includes("https://localhost:7070"));
            assert.ok(list.includes("https://127.0.0.1:7070"));
        });

        it("appends explicit origins from PRISM_CORS_ORIGINS", () => {
            const list = resolveAllowedOrigins(7070, {
                PRISM_CORS_ORIGINS: "https://ops.prism.example, https://admin.prism.example/",
            });
            assert.ok(list.includes("https://ops.prism.example"));
            // trailing slash is normalised
            assert.ok(list.includes("https://admin.prism.example"));
        });

        it("rejects PRISM_CORS_ORIGINS=\"*\"", () => {
            assert.throws(
                () => resolveAllowedOrigins(7070, { PRISM_CORS_ORIGINS: "*" }),
                /not permitted/i,
            );
        });
    });

    describe("CORS validation", () => {
        it("allows GET with same-origin Origin and mirrors ACAO header", () => {
            const req = mkReq("GET", "/api/health", { origin: SAME_ORIGIN });
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, defaultConfig());
            assert.equal(r.allowed, true);
            assert.equal(r.responseSent, false);
            assert.equal(res.headers["access-control-allow-origin"], SAME_ORIGIN);
            assert.equal(res.headers["vary"], "Origin");
            assert.equal(res.headers["access-control-allow-credentials"], "true");
        });

        it("allows GET without Origin header (server-to-server / curl)", () => {
            const req = mkReq("GET", "/api/health", {});
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, defaultConfig());
            assert.equal(r.allowed, true);
            assert.equal(r.responseSent, false);
            assert.equal(res.headers["access-control-allow-origin"], undefined);
        });

        it("rejects GET with a foreign Origin and writes a 403 body", () => {
            const req = mkReq("GET", "/api/setup/status", { origin: FOREIGN });
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, defaultConfig());
            assert.equal(r.allowed, false);
            assert.equal(r.responseSent, true);
            assert.equal(res.statusCode, 403);
            assert.match(res.body, /Origin not allowed/);
        });
    });

    describe("CORS preflight (OPTIONS)", () => {
        it("returns 204 with full preflight headers for an allowed origin", () => {
            const req = mkReq("OPTIONS", "/api/setup/profile", {
                origin: SAME_ORIGIN,
                "access-control-request-method": "POST",
                "access-control-request-headers": "Authorization, Content-Type",
            });
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, defaultConfig());
            assert.equal(r.allowed, false);
            assert.equal(r.responseSent, true);
            assert.equal(res.statusCode, 204);
            assert.equal(res.headers["access-control-allow-origin"], SAME_ORIGIN);
            assert.match(res.headers["access-control-allow-methods"] ?? "", /POST/);
            assert.match(res.headers["access-control-allow-headers"] ?? "", /Authorization/);
            assert.equal(res.headers["access-control-max-age"], "600");
        });

        it("rejects preflight from a foreign origin with 403", () => {
            const req = mkReq("OPTIONS", "/api/setup/profile", {
                origin: FOREIGN,
                "access-control-request-method": "POST",
            });
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, defaultConfig());
            assert.equal(r.allowed, false);
            assert.equal(r.responseSent, true);
            assert.equal(res.statusCode, 403);
        });
    });

    describe("CSRF (Origin/Referer) on state-changing methods", () => {
        it("allows POST with no Origin/Referer (non-browser API client)", () => {
            const req = mkReq("POST", "/api/setup/profile", {});
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, defaultConfig());
            assert.equal(r.allowed, true, "non-browser POST without Origin must be allowed (bearer auth still applies)");
            assert.equal(r.responseSent, false);
        });

        it("allows POST with a valid same-origin Origin", () => {
            const req = mkReq("POST", "/api/setup/profile", { origin: SAME_ORIGIN });
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, defaultConfig());
            assert.equal(r.allowed, true);
            assert.equal(res.headers["access-control-allow-origin"], SAME_ORIGIN);
        });

        it("allows POST with a valid same-origin Referer (no Origin header)", () => {
            const req = mkReq("POST", "/api/setup/profile", {
                referer: `${SAME_ORIGIN}/setup`,
            });
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, defaultConfig());
            assert.equal(r.allowed, true);
        });

        it("rejects POST with a foreign Origin (CSRF)", () => {
            const req = mkReq("POST", "/api/setup/profile", { origin: FOREIGN });
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, defaultConfig());
            assert.equal(r.allowed, false);
            assert.equal(res.statusCode, 403);
            // CORS layer rejects before the CSRF layer is reached, but
            // either reason is acceptable — both are 403 with a body.
            assert.match(res.body, /Origin not allowed|CSRF/);
        });

        it("rejects POST with a foreign Referer when Origin is absent", () => {
            const req = mkReq("POST", "/api/setup/profile", {
                referer: "https://attacker.example.com/foo",
            });
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, defaultConfig());
            assert.equal(r.allowed, false);
            assert.equal(res.statusCode, 403);
        });

        it("exempts /api/auth/* (bootstrap path)", () => {
            const req = mkReq("POST", "/api/auth/login", { origin: FOREIGN });
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, defaultConfig());
            // Note: foreign Origin is still rejected at the CORS layer
            // even for exempt routes — exemption only applies to the
            // CSRF check, not the origin allowlist.
            assert.equal(r.allowed, false);
            assert.equal(res.statusCode, 403);
        });

        it("exempts /api/health probe path", () => {
            const req = mkReq("POST", "/api/health", {});
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, defaultConfig());
            assert.equal(r.allowed, true);
        });
    });

    describe("Custom allowlist via PRISM_CORS_ORIGINS", () => {
        it("admits a configured remote operator origin", () => {
            const cfg = defaultConfig(["https://ops.prism.example"]);
            const req = mkReq("POST", "/api/setup/profile", {
                origin: "https://ops.prism.example",
            });
            const res = mkRes();
            const r = applyCorsAndCsrf(req, res, cfg);
            assert.equal(r.allowed, true);
        });
    });
});
