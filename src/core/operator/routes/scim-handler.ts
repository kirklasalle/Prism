/**
 * PRISM Enterprise IAM — SCIM 2.0 endpoints (Phase H-3)
 *
 * Implements a minimal but spec-compliant subset of SCIM 2.0
 * (RFC 7643 + RFC 7644) under `/scim/v2/*`. Sufficient for Okta /
 * Entra ID / OneLogin / JumpCloud user-and-group provisioning.
 *
 *   GET    /scim/v2/ServiceProviderConfig
 *   GET    /scim/v2/Schemas
 *   GET    /scim/v2/ResourceTypes
 *   GET    /scim/v2/Users[?filter=userName eq "x"&startIndex=&count=]
 *   POST   /scim/v2/Users
 *   GET    /scim/v2/Users/:id
 *   PUT    /scim/v2/Users/:id
 *   PATCH  /scim/v2/Users/:id        (active=true|false toggle minimum)
 *   DELETE /scim/v2/Users/:id        (deprovisions)
 *   GET    /scim/v2/Groups
 *   GET    /scim/v2/Groups/:id
 *
 * **Auth**: bearer-token only. Tokens are created via the H-3 admin UI
 * (or programmatically via `IamStore.createScimToken`) and verified
 * with `IamStore.verifyScimToken`. The legacy admin token is accepted
 * as a synthetic SCIM principal so an operator can call SCIM with
 * the same bearer they already use.
 *
 * **Gating**: only mounted by `Router` when `PRISM_ENTERPRISE_IAM=on`
 * AND `PRISM_SCIM=on`. The legacy single-admin-token path is unchanged
 * with both flags absent.
 *
 * Out of scope for this PR (tracked as H-3.1):
 *  - Complex SCIM filter expressions (we accept only `userName eq "x"`).
 *  - Bulk operations.
 *  - Group write operations (POST/PUT/PATCH /Groups). Only read-only
 *    listing is exposed because PRISM roles are the canonical write
 *    surface and SCIM clients vary widely in group semantics.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { DashboardService } from "../dashboard-service.js";
import type { IRouteHandler } from "./types.js";
import type { IamStore, IamUser, IamRole } from "../../iam/store.js";

export function isScimEnabled(): boolean {
    return process.env.PRISM_ENTERPRISE_IAM === "on" && process.env.PRISM_SCIM === "on";
}

export interface ScimRouteOptions {
    iamStore: IamStore;
    defaultTenantId?: string;
    /**
     * Optional override that lets the caller authenticate the legacy
     * single-admin-token bearer. The router resolves this against
     * `AuthGate.tokenFilePath`; tests pass a fixed string.
     */
    adminTokenVerifier?: (presented: string) => boolean;
}

export class ScimRouteHandler implements IRouteHandler {
    private readonly store: IamStore;
    private readonly defaultTenantId: string;
    private readonly adminTokenVerifier: (presented: string) => boolean;

    constructor(opts: ScimRouteOptions) {
        this.store = opts.iamStore;
        this.defaultTenantId = opts.defaultTenantId ?? "default";
        this.adminTokenVerifier = opts.adminTokenVerifier ?? (() => false);
    }

    match(req: IncomingMessage): boolean {
        return (req.url ?? "").split("?")[0].startsWith("/scim/v2/");
    }

    async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const url = new URL(req.url ?? "/", "http://localhost");
        const path = url.pathname;
        const method = (req.method ?? "GET").toUpperCase();

        // Auth: SCIM bearer or legacy admin bearer.
        const tenantId = this.authenticate(req);
        if (!tenantId) {
            return this.scimError(res, 401, "unauthorized", "missing or invalid SCIM bearer");
        }

        try {
            if (path === "/scim/v2/ServiceProviderConfig" && method === "GET") {
                return this.scimJson(res, 200, this.serviceProviderConfig());
            }
            if (path === "/scim/v2/Schemas" && method === "GET") {
                return this.scimJson(res, 200, this.schemas());
            }
            if (path === "/scim/v2/ResourceTypes" && method === "GET") {
                return this.scimJson(res, 200, this.resourceTypes());
            }

            // Users
            if (path === "/scim/v2/Users" && method === "GET") {
                return this.handleListUsers(url, tenantId, res);
            }
            if (path === "/scim/v2/Users" && method === "POST") {
                return await this.handleCreateUser(req, tenantId, res, service);
            }
            const userMatch = /^\/scim\/v2\/Users\/([^/]+)$/.exec(path);
            if (userMatch) {
                const id = decodeURIComponent(userMatch[1]);
                if (method === "GET") return this.handleGetUser(id, tenantId, res);
                if (method === "PUT") return await this.handleReplaceUser(req, id, tenantId, res, service);
                if (method === "PATCH") return await this.handlePatchUser(req, id, tenantId, res, service);
                if (method === "DELETE") return this.handleDeleteUser(id, tenantId, res);
            }

            // Groups (read-only)
            if (path === "/scim/v2/Groups" && method === "GET") {
                return this.handleListGroups(tenantId, res);
            }
            const groupMatch = /^\/scim\/v2\/Groups\/([^/]+)$/.exec(path);
            if (groupMatch && method === "GET") {
                return this.handleGetGroup(decodeURIComponent(groupMatch[1]), tenantId, res);
            }

            return this.scimError(res, 404, "notFound", `${method} ${path}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return this.scimError(res, 500, "internalError", message);
        }
    }

    // ── auth ────────────────────────────────────────────────────────────────

    private authenticate(req: IncomingMessage): string | null {
        const auth = req.headers["authorization"];
        if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;
        const token = auth.slice("Bearer ".length).trim();
        if (!token) return null;
        // Try SCIM token first.
        const scim = this.store.verifyScimToken(token);
        if (scim) return scim.token.tenantId;
        // Fall back to legacy admin bearer.
        if (this.adminTokenVerifier(token)) return this.defaultTenantId;
        return null;
    }

    // ── users ───────────────────────────────────────────────────────────────

    private handleListUsers(url: URL, tenantId: string, res: ServerResponse): void {
        const filter = url.searchParams.get("filter") ?? "";
        const startIndex = Math.max(1, Number(url.searchParams.get("startIndex") ?? "1"));
        const count = Math.max(0, Math.min(1000, Number(url.searchParams.get("count") ?? "100")));

        let users = this.store.listUsers(tenantId);
        if (filter) {
            const eq = /^userName\s+eq\s+"([^"]+)"$/i.exec(filter);
            if (eq) {
                const want = eq[1].toLowerCase();
                users = users.filter((u) => u.email.toLowerCase() === want);
            } else {
                return this.scimError(res, 400, "invalidFilter", `unsupported filter: ${filter}`);
            }
        }
        const total = users.length;
        const page = users.slice(startIndex - 1, startIndex - 1 + count);
        return this.scimJson(res, 200, {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
            totalResults: total,
            startIndex,
            itemsPerPage: page.length,
            Resources: page.map((u) => this.userToScim(u)),
        });
    }

    private async handleCreateUser(
        req: IncomingMessage, tenantId: string, res: ServerResponse, service: DashboardService,
    ): Promise<void> {
        const body = await this.readJson(req, service);
        if (!body || typeof body !== "object") {
            return this.scimError(res, 400, "invalidValue", "missing JSON body");
        }
        const userName = typeof body.userName === "string" ? body.userName : "";
        if (!userName) {
            return this.scimError(res, 400, "invalidValue", "userName required");
        }
        const existing = this.store.getUserByEmail(tenantId, userName);
        if (existing) {
            // SCIM 2.0 mandates 409 + scimType=uniqueness.
            return this.scimError(res, 409, "uniqueness", `user already exists: ${userName}`, "uniqueness");
        }
        const displayName = typeof body.displayName === "string" ? body.displayName : userName;
        const status = body.active === false ? "suspended" : "active";
        const user = this.store.createUser({
            tenantId,
            email: userName,
            displayName,
            status,
            attrs: { scim: body },
        });
        const viewer = this.store.getRoleByName(tenantId, "viewer");
        if (viewer) this.store.addMembership(user.id, tenantId, viewer.id);
        return this.scimJson(res, 201, this.userToScim(this.store.getUser(user.id)!), {
            Location: `/scim/v2/Users/${encodeURIComponent(user.id)}`,
        });
    }

    private handleGetUser(id: string, tenantId: string, res: ServerResponse): void {
        const user = this.store.getUser(id);
        if (!user || user.tenantId !== tenantId) {
            return this.scimError(res, 404, "notFound", `Users/${id}`);
        }
        return this.scimJson(res, 200, this.userToScim(user));
    }

    private async handleReplaceUser(
        req: IncomingMessage, id: string, tenantId: string, res: ServerResponse, service: DashboardService,
    ): Promise<void> {
        const user = this.store.getUser(id);
        if (!user || user.tenantId !== tenantId) {
            return this.scimError(res, 404, "notFound", `Users/${id}`);
        }
        const body = await this.readJson(req, service);
        if (!body || typeof body !== "object") {
            return this.scimError(res, 400, "invalidValue", "missing JSON body");
        }
        // Honour `active` toggle. Other field updates (displayName, etc.)
        // are accepted but not persisted in this minimal surface; the IAM
        // admin UI is the authoritative write path for those fields. We
        // explicitly track that limitation here so SCIM clients see a
        // successful 200 (idempotent PUT) without silent data loss on
        // the SCIM-managed `userName` (immutable) + `active` fields.
        if (body.active === false && user.status === "active") this.store.setUserStatus(id, "suspended");
        if (body.active === true && user.status !== "active") this.store.setUserStatus(id, "active");
        return this.scimJson(res, 200, this.userToScim(this.store.getUser(id)!));
    }

    private async handlePatchUser(
        req: IncomingMessage, id: string, tenantId: string, res: ServerResponse, service: DashboardService,
    ): Promise<void> {
        const user = this.store.getUser(id);
        if (!user || user.tenantId !== tenantId) {
            return this.scimError(res, 404, "notFound", `Users/${id}`);
        }
        const body = await this.readJson(req, service);
        if (!body || typeof body !== "object" || !Array.isArray(body.Operations)) {
            return this.scimError(res, 400, "invalidValue", "missing Operations array");
        }
        for (const op of body.Operations as Array<Record<string, unknown>>) {
            const opName = String(op["op"] ?? "").toLowerCase();
            const path = typeof op["path"] === "string" ? op["path"] : "";
            const value = op["value"];
            if ((opName === "replace" || opName === "add") && (path === "active" || path === "")) {
                // Some IdPs send {op:"replace", value:{active:false}} with no path.
                const flag = path === "active"
                    ? value
                    : (value && typeof value === "object" ? (value as Record<string, unknown>)["active"] : undefined);
                if (flag === false) this.store.setUserStatus(id, "suspended");
                else if (flag === true) this.store.setUserStatus(id, "active");
            }
            // Other ops are silently accepted (no-op) — Okta sends frequent
            // displayName / name.* patches that we don't persist in v1.
        }
        return this.scimJson(res, 200, this.userToScim(this.store.getUser(id)!));
    }

    private handleDeleteUser(id: string, tenantId: string, res: ServerResponse): void {
        const user = this.store.getUser(id);
        if (!user || user.tenantId !== tenantId) {
            return this.scimError(res, 404, "notFound", `Users/${id}`);
        }
        // SCIM DELETE → deprovision (we never hard-delete users so the
        // audit trail and any owned api-keys retain their referential
        // pointers).
        this.store.setUserStatus(id, "deprovisioned");
        res.statusCode = 204;
        res.end();
    }

    // ── groups (read-only) ──────────────────────────────────────────────────

    private handleListGroups(tenantId: string, res: ServerResponse): void {
        const roles = this.store.listRoles(tenantId);
        return this.scimJson(res, 200, {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
            totalResults: roles.length,
            startIndex: 1,
            itemsPerPage: roles.length,
            Resources: roles.map((r) => this.roleToScimGroup(r)),
        });
    }

    private handleGetGroup(id: string, tenantId: string, res: ServerResponse): void {
        const role = this.store.getRole(id);
        if (!role || role.tenantId !== tenantId) {
            return this.scimError(res, 404, "notFound", `Groups/${id}`);
        }
        return this.scimJson(res, 200, this.roleToScimGroup(role));
    }

    // ── SCIM resource shaping ───────────────────────────────────────────────

    private userToScim(u: IamUser): Record<string, unknown> {
        return {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            id: u.id,
            userName: u.email,
            displayName: u.displayName ?? u.email,
            active: u.status === "active",
            emails: [{ value: u.email, primary: true }],
            meta: {
                resourceType: "User",
                created: u.createdAt,
                lastModified: u.updatedAt,
                location: `/scim/v2/Users/${encodeURIComponent(u.id)}`,
            },
        };
    }

    private roleToScimGroup(r: IamRole): Record<string, unknown> {
        return {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            id: r.id,
            displayName: r.name,
            meta: {
                resourceType: "Group",
                created: r.createdAt,
                location: `/scim/v2/Groups/${encodeURIComponent(r.id)}`,
            },
        };
    }

    private serviceProviderConfig(): Record<string, unknown> {
        return {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
            documentationUri: "https://github.com/kirklasalle/Prism/blob/main/CHANGELOG.md",
            patch: { supported: true },
            bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
            filter: { supported: true, maxResults: 1000 },
            changePassword: { supported: false },
            sort: { supported: false },
            etag: { supported: false },
            authenticationSchemes: [{
                type: "oauthbearertoken",
                name: "OAuth Bearer Token",
                description: "PRISM SCIM bearer token issued via the IAM admin UI.",
            }],
        };
    }

    private schemas(): Record<string, unknown> {
        return {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
            totalResults: 2,
            Resources: [
                { id: "urn:ietf:params:scim:schemas:core:2.0:User", name: "User" },
                { id: "urn:ietf:params:scim:schemas:core:2.0:Group", name: "Group" },
            ],
        };
    }

    private resourceTypes(): Record<string, unknown> {
        return {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
            totalResults: 2,
            Resources: [
                { id: "User", name: "User", endpoint: "/Users", schema: "urn:ietf:params:scim:schemas:core:2.0:User" },
                { id: "Group", name: "Group", endpoint: "/Groups", schema: "urn:ietf:params:scim:schemas:core:2.0:Group" },
            ],
        };
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private async readJson(req: IncomingMessage, service: DashboardService): Promise<Record<string, unknown> | null> {
        // Reuse the dashboard service's body reader if available; otherwise
        // fall back to a local implementation so this handler stays testable
        // without a full DashboardService instance.
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

    private scimJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
        const headers: Record<string, string> = {
            "Content-Type": "application/scim+json",
            ...(extraHeaders ?? {}),
        };
        res.writeHead(status, headers);
        res.end(JSON.stringify(body));
    }

    private scimError(res: ServerResponse, status: number, label: string, detail: string, scimType?: string): void {
        const body: Record<string, unknown> = {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
            status: String(status),
            detail: `${label}: ${detail}`,
        };
        if (scimType) body.scimType = scimType;
        return this.scimJson(res, status, body);
    }
}
