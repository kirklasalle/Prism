/**
 * PRISM Enterprise IAM — admin REST API (Phase H-3)
 *
 * Mounts under `/api/iam/admin/*` and is gated by both
 * `PRISM_ENTERPRISE_IAM=on` and the caller's principal carrying at
 * least the `admin` role. The endpoints are intentionally narrow — just
 * enough for the H-3 admin UI to provision SCIM tokens and manage
 * user/role assignments. IdP CRUD is deferred to H-3.1.
 *
 * Endpoints
 *   GET    /api/iam/admin/users                       → list users
 *   POST   /api/iam/admin/users/:id/status            → { status: "active"|"suspended" }
 *   POST   /api/iam/admin/users/:id/roles             → { role: "admin" }
 *   DELETE /api/iam/admin/users/:id/roles/:roleName
 *   GET    /api/iam/admin/roles                       → list roles
 *   GET    /api/iam/admin/scim-tokens                 → list (no plaintext)
 *   POST   /api/iam/admin/scim-tokens                 → { label } → returns plaintext ONCE
 *   DELETE /api/iam/admin/scim-tokens/:id             → revoke
 *
 * Auth: a request must carry either a session cookie resolving to a
 * principal with `admin` (or higher), an API key whose user holds
 * `admin`, or the legacy admin bearer token (synthetic `root`
 * principal). The legacy admin token always passes — operators must
 * be able to bootstrap before any IdP is configured.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import type { DashboardService } from "../dashboard-service.js";
import type { IRouteHandler } from "./types.js";
import type { IamStore, IamUserStatus } from "../../iam/store.js";
import type { IamRouteHandler } from "./iam-handler.js";
import { adminTokenPrincipal, principalHasRole, type IamPrincipal, type RoleName } from "../../iam/rbac.js";

export interface IamAdminRouteOptions {
    iam: IamRouteHandler;
    /**
     * Tells the handler whether the inbound request is the legacy admin
     * bearer (which has already been validated by the upstream AuthGate).
     * Tests can inject a deterministic predicate.
     */
    isLegacyAdminBearer?: (req: IncomingMessage) => boolean;
    defaultTenantId?: string;
}

export class IamAdminRouteHandler implements IRouteHandler {
    private readonly iam: IamRouteHandler;
    private readonly store: IamStore;
    private readonly isLegacyAdminBearer: (req: IncomingMessage) => boolean;
    private readonly defaultTenantId: string;

    constructor(opts: IamAdminRouteOptions) {
        this.iam = opts.iam;
        this.store = opts.iam.getStore();
        this.defaultTenantId = opts.defaultTenantId ?? "default";
        this.isLegacyAdminBearer = opts.isLegacyAdminBearer ?? this.defaultLegacyBearerCheck;
    }

    /**
     * Default: any `Authorization: Bearer <something>` header on a
     * non-public route is assumed to be the legacy admin bearer because
     * the upstream `AuthGate` would have rejected an unknown bearer
     * before dispatch reached us. Tests bypass this with an injected
     * predicate.
     */
    private defaultLegacyBearerCheck = (req: IncomingMessage): boolean => {
        const auth = req.headers["authorization"];
        return typeof auth === "string" && auth.startsWith("Bearer ");
    };

    match(req: IncomingMessage): boolean {
        return (req.url ?? "").split("?")[0].startsWith("/api/iam/admin/");
    }

    async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const url = new URL(req.url ?? "/", "http://localhost");
        const path = url.pathname;
        const method = (req.method ?? "GET").toUpperCase();

        const principal = this.resolvePrincipal(req);
        if (!principal || !principalHasRole(principal, "admin")) {
            return this.json(res, principal ? 403 : 401, {
                error: { code: principal ? "forbidden" : "unauthenticated", message: "admin role required" },
            });
        }
        const tenantId = principal.tenantId || this.defaultTenantId;

        try {
            // /users
            if (path === "/api/iam/admin/users" && method === "GET") {
                return this.listUsers(tenantId, res);
            }
            if (path === "/api/iam/admin/users" && method === "POST") {
                return await this.createUser(req, tenantId, res, service);
            }
            const userStatusM = /^\/api\/iam\/admin\/users\/([^/]+)\/status$/.exec(path);
            if (userStatusM && method === "POST") {
                return await this.setUserStatus(req, decodeURIComponent(userStatusM[1]), tenantId, res, service);
            }
            const userPasswordM = /^\/api\/iam\/admin\/users\/([^/]+)\/password$/.exec(path);
            if (userPasswordM && method === "POST") {
                return await this.setUserPassword(req, decodeURIComponent(userPasswordM[1]), tenantId, res, service);
            }
            const userM = /^\/api\/iam\/admin\/users\/([^/]+)$/.exec(path);
            if (userM && method === "DELETE") {
                return this.deleteUser(decodeURIComponent(userM[1]), tenantId, res);
            }
            const userRolesM = /^\/api\/iam\/admin\/users\/([^/]+)\/roles$/.exec(path);
            if (userRolesM && method === "POST") {
                return await this.addUserRole(req, decodeURIComponent(userRolesM[1]), tenantId, res, service);
            }
            const userRoleDelM = /^\/api\/iam\/admin\/users\/([^/]+)\/roles\/([^/]+)$/.exec(path);
            if (userRoleDelM && method === "DELETE") {
                return this.removeUserRole(
                    decodeURIComponent(userRoleDelM[1]),
                    decodeURIComponent(userRoleDelM[2]),
                    tenantId, res,
                );
            }

            // /roles
            if (path === "/api/iam/admin/roles" && method === "GET") {
                return this.listRoles(tenantId, res);
            }

            // /scim-tokens
            if (path === "/api/iam/admin/scim-tokens" && method === "GET") {
                return this.listScimTokens(tenantId, res);
            }
            if (path === "/api/iam/admin/scim-tokens" && method === "POST") {
                return await this.createScimToken(req, tenantId, res, service);
            }
            const scimDelM = /^\/api\/iam\/admin\/scim-tokens\/([^/]+)$/.exec(path);
            if (scimDelM && method === "DELETE") {
                return this.revokeScimToken(decodeURIComponent(scimDelM[1]), res);
            }

            return this.json(res, 404, { error: { code: "not_found", message: `${method} ${path}` } });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return this.json(res, 500, { error: { code: "internal_error", message } });
        }
    }

    // ── handlers ────────────────────────────────────────────────────────────

    private listUsers(tenantId: string, res: ServerResponse): void {
        const users = this.store.listUsers(tenantId).map((u) => ({
            id: u.id,
            email: u.email,
            displayName: u.displayName,
            status: u.status,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
            roles: this.store.listRoleNamesForUser(u.id, tenantId),
        }));
        return this.json(res, 200, { users });
    }

    private async setUserStatus(
        req: IncomingMessage, userId: string, tenantId: string, res: ServerResponse, service: DashboardService,
    ): Promise<void> {
        const user = this.store.getUser(userId);
        if (!user || user.tenantId !== tenantId) {
            return this.json(res, 404, { error: { code: "not_found", message: `user ${userId}` } });
        }
        const body = await this.readJson(req, service);
        const status = body && typeof body["status"] === "string" ? body["status"] : "";
        if (status !== "active" && status !== "suspended" && status !== "deprovisioned") {
            return this.json(res, 400, { error: { code: "invalid_status", message: "status must be active|suspended|deprovisioned" } });
        }
        this.store.setUserStatus(userId, status as IamUserStatus);
        return this.json(res, 200, { ok: true });
    }

    private async setUserPassword(
        req: IncomingMessage, userId: string, tenantId: string, res: ServerResponse, service: DashboardService,
    ): Promise<void> {
        const user = this.store.getUser(userId);
        if (!user || user.tenantId !== tenantId) {
            return this.json(res, 404, { error: { code: "not_found", message: `user ${userId}` } });
        }
        const body = await this.readJson(req, service);
        const password = body && typeof body["password"] === "string" ? body["password"].trim() : "";
        if (!password) {
            return this.json(res, 400, { error: { code: "invalid_password", message: "password required" } });
        }
        const passwordHash = createHash("sha256").update(password, "utf-8").digest("hex");
        const attrs = { ...(user.attrs || {}), passwordHash };
        this.store.updateUserAttrs(userId, attrs);
        return this.json(res, 200, { ok: true });
    }

    private deleteUser(userId: string, tenantId: string, res: ServerResponse): void {
        const user = this.store.getUser(userId);
        if (!user || user.tenantId !== tenantId) {
            return this.json(res, 404, { error: { code: "not_found", message: `user ${userId}` } });
        }
        this.store.deleteUser(userId);
        return this.json(res, 200, { ok: true });
    }

    private async addUserRole(
        req: IncomingMessage, userId: string, tenantId: string, res: ServerResponse, service: DashboardService,
    ): Promise<void> {
        const user = this.store.getUser(userId);
        if (!user || user.tenantId !== tenantId) {
            return this.json(res, 404, { error: { code: "not_found", message: `user ${userId}` } });
        }
        const body = await this.readJson(req, service);
        const roleName = body && typeof body["role"] === "string" ? body["role"] : "";
        if (!roleName) {
            return this.json(res, 400, { error: { code: "missing_role", message: "role required" } });
        }
        const role = this.store.getRoleByName(tenantId, roleName);
        if (!role) {
            return this.json(res, 404, { error: { code: "unknown_role", message: roleName } });
        }
        this.store.addMembership(userId, tenantId, role.id);
        return this.json(res, 200, { ok: true });
    }

    private removeUserRole(userId: string, roleName: string, tenantId: string, res: ServerResponse): void {
        const role = this.store.getRoleByName(tenantId, roleName);
        if (!role) {
            return this.json(res, 404, { error: { code: "unknown_role", message: roleName } });
        }
        this.store.removeMembership(userId, tenantId, role.id);
        return this.json(res, 200, { ok: true });
    }

    private async createUser(
        req: IncomingMessage, tenantId: string, res: ServerResponse, service: DashboardService,
    ): Promise<void> {
        const body = await this.readJson(req, service);
        if (!body || typeof body !== "object") {
            return this.json(res, 400, { error: { code: "invalid_value", message: "missing JSON body" } });
        }
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!email) {
            return this.json(res, 400, { error: { code: "invalid_value", message: "email is required" } });
        }
        const existing = this.store.getUserByEmail(tenantId, email);
        if (existing) {
            return this.json(res, 409, { error: { code: "uniqueness", message: `user already exists: ${email}` } });
        }
        const displayName = typeof body.displayName === "string" ? body.displayName.trim() : email;
        const status = body.status === "suspended" ? "suspended" : "active";
        
        let passwordHash: string | undefined;
        if (typeof body.password === "string" && body.password.trim()) {
            passwordHash = createHash("sha256").update(body.password.trim(), "utf-8").digest("hex");
        }

        const attrs = passwordHash ? { passwordHash } : {};
        const user = this.store.createUser({
            tenantId,
            email,
            displayName,
            status,
            attrs,
        });
        const viewer = this.store.getRoleByName(tenantId, "viewer");
        if (viewer) this.store.addMembership(user.id, tenantId, viewer.id);

        return this.json(res, 201, this.store.getUser(user.id)!);
    }

    private listRoles(tenantId: string, res: ServerResponse): void {
        return this.json(res, 200, { roles: this.store.listRoles(tenantId) });
    }

    private listScimTokens(tenantId: string, res: ServerResponse): void {
        return this.json(res, 200, { tokens: this.store.listScimTokens(tenantId) });
    }

    private async createScimToken(
        req: IncomingMessage, tenantId: string, res: ServerResponse, service: DashboardService,
    ): Promise<void> {
        const body = await this.readJson(req, service);
        const label = body && typeof body["label"] === "string" ? body["label"] : "";
        const { token, record } = this.store.createScimToken(tenantId, label);
        // The plaintext token is surfaced once and never persisted in
        // this response shape again. The UI is responsible for showing
        // it to the operator and warning them to copy it now.
        return this.json(res, 201, { token, record });
    }

    private revokeScimToken(id: string, res: ServerResponse): void {
        this.store.revokeScimToken(id);
        return this.json(res, 200, { ok: true });
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private resolvePrincipal(req: IncomingMessage): IamPrincipal | null {
        // 1. Session cookie via the IAM handler.
        const fromCookie = this.iam.resolvePrincipalFromCookie(req);
        if (fromCookie) return fromCookie;
        // 2. API key (Authorization: Bearer prsm_...).
        const auth = req.headers["authorization"];
        if (typeof auth === "string" && auth.startsWith("Bearer ")) {
            const token = auth.slice("Bearer ".length).trim();
            if (token.startsWith("prsm_")) {
                const fromKey = this.iam.resolvePrincipalFromApiKey(token);
                if (fromKey) return fromKey;
            }
        }
        // 3. Legacy admin token → synthetic root principal.
        if (this.isLegacyAdminBearer(req)) return adminTokenPrincipal(this.defaultTenantId);
        return null;
    }

    private async readJson(req: IncomingMessage, service: DashboardService): Promise<Record<string, unknown> | null> {
        const svc = service as unknown as { readJsonBody?: (r: IncomingMessage) => Promise<unknown> };
        if (svc && typeof svc.readJsonBody === "function") {
            const v = await svc.readJsonBody(req);
            return (v && typeof v === "object") ? v as Record<string, unknown> : null;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const text = Buffer.concat(chunks).toString("utf-8");
        if (!text) return null;
        try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
    }

    private json(res: ServerResponse, status: number, body: unknown): void {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
    }
}

// Re-export RoleName for convenience (used by docs).
export type { RoleName };
