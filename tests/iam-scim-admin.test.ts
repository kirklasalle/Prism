/**
 * Phase H-3 tests — SCIM 2.0 endpoints + IAM admin REST endpoints.
 *
 * Both handlers are exercised with synthetic IncomingMessage / FakeRes
 * objects (the same pattern used by `iam-sso.test.ts`).
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

import { IamStore } from "../src/core/iam/store.js";
import { ScimRouteHandler } from "../src/core/operator/routes/scim-handler.js";
import { IamAdminRouteHandler } from "../src/core/operator/routes/iam-admin-handler.js";
import { IamRouteHandler } from "../src/core/operator/routes/iam-handler.js";
import { SessionManager } from "../src/core/iam/sso/session.js";

function makeReq(method: string, url: string, headers: Record<string, string> = {}, body?: string): IncomingMessage {
    const emitter = new EventEmitter() as IncomingMessage;
    (emitter as unknown as { method: string }).method = method;
    (emitter as unknown as { url: string }).url = url;
    (emitter as unknown as { headers: Record<string, string> }).headers = headers;
    // The SCIM and admin handlers fall back to async-iterating the
    // IncomingMessage when no DashboardService.readJsonBody is provided.
    // Emit the body as a single chunk on next tick.
    if (body !== undefined) {
        process.nextTick(() => {
            (emitter as unknown as EventEmitter).emit("data", Buffer.from(body));
            (emitter as unknown as EventEmitter).emit("end");
        });
    } else {
        process.nextTick(() => { (emitter as unknown as EventEmitter).emit("end"); });
    }
    // node:http stream interface needed for `for await`.
    (emitter as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<Buffer> })[Symbol.asyncIterator] = async function* () {
        if (body !== undefined) yield Buffer.from(body);
    };
    return emitter;
}

class FakeRes extends EventEmitter {
    statusCode = 200;
    headers: Record<string, string | string[]> = {};
    body = "";
    ended = false;
    setHeader(k: string, v: string | string[]): void { this.headers[k.toLowerCase()] = v; }
    getHeader(k: string): string | string[] | undefined { return this.headers[k.toLowerCase()]; }
    writeHead(status: number, headers?: Record<string, string>): this {
        this.statusCode = status;
        if (headers) for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v;
        return this;
    }
    write(chunk: string): boolean { this.body += chunk; return true; }
    end(chunk?: string): this { if (chunk) this.body += chunk; this.ended = true; return this; }
    json(): unknown { return this.body ? JSON.parse(this.body) : null; }
}
function asRes(f: FakeRes): ServerResponse { return f as unknown as ServerResponse; }

// ── SCIM ─────────────────────────────────────────────────────────────────────

export async function testScimRoutes(): Promise<void> {
    const store = new IamStore(":memory:");
    try {
        store.seedDefaultRoles("default");
        const { token: scimToken } = store.createScimToken("default", "test-okta");
        const handler = new ScimRouteHandler({ iamStore: store });
        const auth = { authorization: `Bearer ${scimToken}` };

        // 1. ServiceProviderConfig is reachable + auth-gated.
        {
            const res = new FakeRes();
            await handler.handle(makeReq("GET", "/scim/v2/ServiceProviderConfig"), asRes(res), {} as never);
            assert.equal(res.statusCode, 401, "no bearer → 401");
        }
        {
            const res = new FakeRes();
            await handler.handle(makeReq("GET", "/scim/v2/ServiceProviderConfig", auth), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
            const j = res.json() as { schemas: string[] };
            assert.ok(j.schemas[0].includes("ServiceProviderConfig"));
        }

        // 2. POST /Users creates a user and grants `viewer`.
        let userId = "";
        {
            const res = new FakeRes();
            await handler.handle(makeReq(
                "POST", "/scim/v2/Users",
                { ...auth, "content-type": "application/json" },
                JSON.stringify({ userName: "scim-alice@example.com", displayName: "Alice", active: true }),
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 201, `body: ${res.body}`);
            const u = res.json() as { id: string; userName: string; active: boolean };
            assert.equal(u.userName, "scim-alice@example.com");
            assert.ok(u.active);
            userId = u.id;
            assert.deepEqual(store.listRoleNamesForUser(userId, "default"), ["viewer"]);
        }

        // 3. POST same userName → 409 uniqueness.
        {
            const res = new FakeRes();
            await handler.handle(makeReq(
                "POST", "/scim/v2/Users",
                { ...auth, "content-type": "application/json" },
                JSON.stringify({ userName: "scim-alice@example.com" }),
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 409);
            const e = res.json() as { scimType: string };
            assert.equal(e.scimType, "uniqueness");
        }

        // 4. GET /Users?filter=userName eq "x"
        {
            const res = new FakeRes();
            const url = `/scim/v2/Users?filter=${encodeURIComponent('userName eq "scim-alice@example.com"')}`;
            await handler.handle(makeReq("GET", url, auth), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
            const list = res.json() as { totalResults: number; Resources: Array<{ userName: string }> };
            assert.equal(list.totalResults, 1);
            assert.equal(list.Resources[0].userName, "scim-alice@example.com");
        }

        // 5. PATCH active=false suspends the user.
        {
            const res = new FakeRes();
            await handler.handle(makeReq(
                "PATCH", `/scim/v2/Users/${encodeURIComponent(userId)}`,
                { ...auth, "content-type": "application/json" },
                JSON.stringify({
                    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
                    Operations: [{ op: "replace", path: "active", value: false }],
                }),
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
            assert.equal(store.getUser(userId)!.status, "suspended");
        }
        // PATCH with no path but value.active=true reactivates.
        {
            const res = new FakeRes();
            await handler.handle(makeReq(
                "PATCH", `/scim/v2/Users/${encodeURIComponent(userId)}`,
                { ...auth, "content-type": "application/json" },
                JSON.stringify({ Operations: [{ op: "replace", value: { active: true } }] }),
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
            assert.equal(store.getUser(userId)!.status, "active");
        }

        // 6. DELETE deprovisions.
        {
            const res = new FakeRes();
            await handler.handle(makeReq(
                "DELETE", `/scim/v2/Users/${encodeURIComponent(userId)}`, auth,
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 204);
            assert.equal(store.getUser(userId)!.status, "deprovisioned");
        }

        // 7. GET /Groups lists the seeded roles.
        {
            const res = new FakeRes();
            await handler.handle(makeReq("GET", "/scim/v2/Groups", auth), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
            const list = res.json() as { Resources: Array<{ displayName: string }> };
            const names = list.Resources.map((g) => g.displayName).sort();
            assert.deepEqual(names, ["admin", "operator", "root", "viewer"]);
        }

        // 8. Unsupported filter → 400 invalidFilter.
        {
            const res = new FakeRes();
            await handler.handle(makeReq(
                "GET",
                `/scim/v2/Users?filter=${encodeURIComponent("emails co alice")}`,
                auth,
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 400);
            const e = res.json() as { detail: string };
            assert.ok(e.detail.includes("invalidFilter"));
        }

        // 9. Legacy admin bearer fallback works when adminTokenVerifier
        // returns true.
        {
            const adminHandler = new ScimRouteHandler({
                iamStore: store,
                adminTokenVerifier: (t) => t === "legacy-admin",
            });
            const res = new FakeRes();
            await adminHandler.handle(makeReq(
                "GET", "/scim/v2/Users",
                { authorization: "Bearer legacy-admin" },
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
        }

        // 10. Revoked SCIM token no longer authenticates.
        {
            const tokens = store.listScimTokens("default");
            store.revokeScimToken(tokens[0].id);
            // verifyScimToken's SQL filters `revoked_at IS NULL`, so a
            // revoked token must return 401.
            const res = new FakeRes();
            await handler.handle(makeReq("GET", "/scim/v2/Users", auth), asRes(res), {} as never);
            assert.equal(res.statusCode, 401, "revoked SCIM token must not authenticate");
        }
    } finally {
        store.close();
    }
}

// ── IAM Admin REST ───────────────────────────────────────────────────────────

export async function testIamAdminRoutes(): Promise<void> {
    const store = new IamStore(":memory:");
    try {
        store.seedDefaultRoles("default");

        // Build an IamRouteHandler that shares this store, then an
        // admin handler bound to the same instance.
        const sessionMgr = new SessionManager(store, { secret: "z".repeat(32), secure: false });
        const iam = new IamRouteHandler({ iamStore: store, sessionManager: sessionMgr });
        const adminHandler = new IamAdminRouteHandler({
            iam,
            // Allow the synthetic bearer "legacy-admin-token" through.
            isLegacyAdminBearer: (req) => {
                const a = req.headers["authorization"];
                return typeof a === "string" && a === "Bearer legacy-admin-token";
            },
        });
        const adminAuth = { authorization: "Bearer legacy-admin-token" };

        // 1. No auth → 401.
        {
            const res = new FakeRes();
            await adminHandler.handle(makeReq("GET", "/api/iam/admin/users"), asRes(res), {} as never);
            assert.equal(res.statusCode, 401);
        }

        // Seed a non-admin user + cookie session for the forbidden test.
        const viewer = store.createUser({ tenantId: "default", email: "viewer@example.com" });
        const viewerRole = store.getRoleByName("default", "viewer")!;
        store.addMembership(viewer.id, "default", viewerRole.id);
        const { cookie: viewerCookie } = sessionMgr.issue(viewer.id, "default", 600);

        // 2. Viewer-only principal → 403.
        {
            const res = new FakeRes();
            await adminHandler.handle(makeReq(
                "GET", "/api/iam/admin/users",
                { cookie: `prism_sso=${viewerCookie}` },
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 403);
        }

        // 3. Legacy admin bearer → 200, sees the seeded user.
        {
            const res = new FakeRes();
            await adminHandler.handle(makeReq("GET", "/api/iam/admin/users", adminAuth), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
            const data = res.json() as { users: Array<{ email: string; roles: string[] }> };
            const v = data.users.find((u) => u.email === "viewer@example.com");
            assert.ok(v);
            assert.deepEqual(v!.roles, ["viewer"]);
        }

        // 4. Promote viewer → admin.
        {
            const res = new FakeRes();
            await adminHandler.handle(makeReq(
                "POST", `/api/iam/admin/users/${encodeURIComponent(viewer.id)}/roles`,
                { ...adminAuth, "content-type": "application/json" },
                JSON.stringify({ role: "admin" }),
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
            assert.ok(store.listRoleNamesForUser(viewer.id, "default").includes("admin"));
        }

        // 5. The previously-viewer cookie now has admin → list users works.
        {
            const res = new FakeRes();
            await adminHandler.handle(makeReq(
                "GET", "/api/iam/admin/users",
                { cookie: `prism_sso=${viewerCookie}` },
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
        }

        // 6. Suspend the user via /status.
        {
            const res = new FakeRes();
            await adminHandler.handle(makeReq(
                "POST", `/api/iam/admin/users/${encodeURIComponent(viewer.id)}/status`,
                { ...adminAuth, "content-type": "application/json" },
                JSON.stringify({ status: "suspended" }),
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
            assert.equal(store.getUser(viewer.id)!.status, "suspended");
        }

        // 7. SCIM tokens: create + list + revoke.
        let tokenId = "";
        {
            const res = new FakeRes();
            await adminHandler.handle(makeReq(
                "POST", "/api/iam/admin/scim-tokens",
                { ...adminAuth, "content-type": "application/json" },
                JSON.stringify({ label: "okta-prod" }),
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 201);
            const data = res.json() as { token: string; record: { id: string; label: string } };
            assert.ok(data.token.startsWith("prsm_scim_"));
            assert.equal(data.record.label, "okta-prod");
            tokenId = data.record.id;
        }
        {
            const res = new FakeRes();
            await adminHandler.handle(makeReq("GET", "/api/iam/admin/scim-tokens", adminAuth), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
            const data = res.json() as { tokens: Array<{ id: string; label: string }> };
            assert.ok(data.tokens.some((t) => t.id === tokenId));
        }
        {
            const res = new FakeRes();
            await adminHandler.handle(makeReq(
                "DELETE", `/api/iam/admin/scim-tokens/${encodeURIComponent(tokenId)}`, adminAuth,
            ), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
            const list = store.listScimTokens("default");
            const t = list.find((tt) => tt.id === tokenId);
            assert.ok(t && t.revokedAt, "token marked revoked");
        }

        // 8. Roles list.
        {
            const res = new FakeRes();
            await adminHandler.handle(makeReq("GET", "/api/iam/admin/roles", adminAuth), asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
            const data = res.json() as { roles: Array<{ name: string }> };
            const names = data.roles.map((r) => r.name).sort();
            assert.deepEqual(names, ["admin", "operator", "root", "viewer"]);
        }
    } finally {
        store.close();
    }
}
