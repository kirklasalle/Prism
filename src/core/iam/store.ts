/**
 * PRISM Enterprise IAM — Phase H-1 data model + store
 *
 * Provides the persistent identity store for the enterprise IAM layer.
 * Entirely additive: when `PRISM_ENTERPRISE_IAM` is not set to `"on"`,
 * nothing in the runtime constructs an `IamStore` and the existing single-
 * admin-token auth path is the only gate. The store can also be exercised
 * directly by tests with an in-memory database.
 *
 * Schema (SQLite — created on first construction, idempotent):
 *
 *   iam_users          (id PK, tenant_id, email UNIQUE, display_name,
 *                       status, created_at, updated_at, attrs JSON)
 *   iam_roles          (id PK, tenant_id, name, description, created_at)
 *   iam_memberships    (user_id, tenant_id, role_id) PK(user_id, tenant_id, role_id)
 *   iam_api_keys       (id PK, user_id, tenant_id, hash, label,
 *                       created_at, last_used_at, revoked_at)
 *   iam_idp_configs    (id PK, tenant_id, kind, config_json, created_at)
 *                       — kind in {oidc, saml}
 *   iam_scim_tokens    (id PK, tenant_id, hash, label, created_at, revoked_at)
 *   iam_sso_sessions   (id PK, user_id, tenant_id, expires_at, created_at)
 *
 * Role hierarchy (seeded per tenant on first touch): root > admin > operator > viewer.
 * See `rbac.ts` for the permission map.
 *
 * Security notes:
 *   - API key + SCIM-token plaintext is never stored; only sha256 hashes.
 *   - `revoked_at` is set on revoke; rows are kept for audit, not deleted.
 *   - All writes are wrapped in a single transaction when batched.
 *
 * Phase H-1 deliberately leaves wiring/binding to subsequent phases. This
 * file plus `rbac.ts` plus the optional principal field on `AuthResult`
 * is the entire H-1 surface.
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type IamUserStatus = "active" | "suspended" | "deprovisioned";
export type IamIdpKind = "oidc" | "saml";

export interface IamUser {
    id: string;
    tenantId: string;
    email: string;
    displayName: string | null;
    status: IamUserStatus;
    createdAt: string;
    updatedAt: string;
    attrs: Record<string, unknown>;
}

export interface IamRole {
    id: string;
    tenantId: string;
    name: string;
    description: string | null;
    createdAt: string;
}

export interface IamMembership {
    userId: string;
    tenantId: string;
    roleId: string;
}

export interface IamApiKey {
    id: string;
    userId: string;
    tenantId: string;
    label: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
}

export interface IamIdpConfig {
    id: string;
    tenantId: string;
    kind: IamIdpKind;
    config: Record<string, unknown>;
    createdAt: string;
}

export interface IamScimToken {
    id: string;
    tenantId: string;
    label: string;
    createdAt: string;
    revokedAt: string | null;
}

export interface IamSsoSession {
    id: string;
    userId: string;
    tenantId: string;
    expiresAt: string;
    createdAt: string;
}

/** Default seeded role names, in descending privilege order. */
export const DEFAULT_ROLE_NAMES = ["root", "admin", "operator", "viewer"] as const;
export type DefaultRoleName = typeof DEFAULT_ROLE_NAMES[number];

/** Result of a successful API-key verification. */
export interface ApiKeyVerifyResult {
    apiKey: IamApiKey;
    user: IamUser;
}

/** Result of a successful SCIM-token verification. */
export interface ScimTokenVerifyResult {
    token: IamScimToken;
}

function nowIso(): string {
    return new Date().toISOString();
}

function newId(prefix: string): string {
    return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function sha256Hex(input: string): string {
    return createHash("sha256").update(input, "utf-8").digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
        return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
    } catch {
        return false;
    }
}

export class IamStore {
    private readonly db: DatabaseSync;
    private readonly ownsDb: boolean;
    private readonly stmts: {
        insertUser: StatementSync;
        getUserById: StatementSync;
        getUserByEmail: StatementSync;
        listUsers: StatementSync;
        updateUserStatus: StatementSync;
        updateUserAttrs: StatementSync;
        insertRole: StatementSync;
        getRoleById: StatementSync;
        getRoleByName: StatementSync;
        listRolesForTenant: StatementSync;
        insertMembership: StatementSync;
        deleteMembership: StatementSync;
        listMembershipsForUser: StatementSync;
        insertApiKey: StatementSync;
        getApiKeyByHash: StatementSync;
        revokeApiKey: StatementSync;
        touchApiKey: StatementSync;
        listApiKeysForUser: StatementSync;
        insertIdp: StatementSync;
        getIdpById: StatementSync;
        listIdpsForTenant: StatementSync;
        insertScimToken: StatementSync;
        getScimTokenByHash: StatementSync;
        revokeScimToken: StatementSync;
        listScimTokensForTenant: StatementSync;
        insertSession: StatementSync;
        getSession: StatementSync;
        deleteSession: StatementSync;
    };

    constructor(dbOrPath: DatabaseSync | string = ":memory:") {
        if (typeof dbOrPath === "string") {
            this.db = new DatabaseSync(dbOrPath);
            this.ownsDb = true;
        } else {
            this.db = dbOrPath;
            this.ownsDb = false;
        }
        this.migrate();
        this.stmts = this.prepareStatements();
    }

    /** Close the underlying database (only if this store opened it). */
    close(): void {
        if (this.ownsDb) {
            try { this.db.close(); } catch { /* best-effort */ }
        }
    }

    private migrate(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS iam_users (
        id           TEXT PRIMARY KEY,
        tenant_id    TEXT NOT NULL,
        email        TEXT NOT NULL,
        display_name TEXT,
        status       TEXT NOT NULL DEFAULT 'active',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        attrs        TEXT NOT NULL DEFAULT '{}',
        UNIQUE (tenant_id, email)
      );
      CREATE INDEX IF NOT EXISTS idx_iam_users_tenant ON iam_users (tenant_id);

      CREATE TABLE IF NOT EXISTS iam_roles (
        id          TEXT PRIMARY KEY,
        tenant_id   TEXT NOT NULL,
        name        TEXT NOT NULL,
        description TEXT,
        created_at  TEXT NOT NULL,
        UNIQUE (tenant_id, name)
      );

      CREATE TABLE IF NOT EXISTS iam_memberships (
        user_id   TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        role_id   TEXT NOT NULL,
        PRIMARY KEY (user_id, tenant_id, role_id),
        FOREIGN KEY (user_id) REFERENCES iam_users(id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES iam_roles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS iam_api_keys (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL,
        tenant_id     TEXT NOT NULL,
        hash          TEXT NOT NULL UNIQUE,
        label         TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL,
        last_used_at  TEXT,
        revoked_at    TEXT,
        FOREIGN KEY (user_id) REFERENCES iam_users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_iam_api_keys_user ON iam_api_keys (user_id);

      CREATE TABLE IF NOT EXISTS iam_idp_configs (
        id          TEXT PRIMARY KEY,
        tenant_id   TEXT NOT NULL,
        kind        TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_iam_idp_tenant ON iam_idp_configs (tenant_id);

      CREATE TABLE IF NOT EXISTS iam_scim_tokens (
        id          TEXT PRIMARY KEY,
        tenant_id   TEXT NOT NULL,
        hash        TEXT NOT NULL UNIQUE,
        label       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        revoked_at  TEXT
      );

      CREATE TABLE IF NOT EXISTS iam_sso_sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        tenant_id  TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES iam_users(id) ON DELETE CASCADE
      );
    `);
    }

    private prepareStatements() {
        return {
            insertUser: this.db.prepare(`
                INSERT INTO iam_users (id, tenant_id, email, display_name, status, created_at, updated_at, attrs)
                VALUES (:id, :tenant_id, :email, :display_name, :status, :created_at, :updated_at, :attrs)
            `),
            getUserById: this.db.prepare(`SELECT * FROM iam_users WHERE id = :id`),
            getUserByEmail: this.db.prepare(`
                SELECT * FROM iam_users WHERE tenant_id = :tenant_id AND email = :email
            `),
            listUsers: this.db.prepare(`
                SELECT * FROM iam_users WHERE tenant_id = :tenant_id ORDER BY created_at ASC
            `),
            updateUserStatus: this.db.prepare(`
                UPDATE iam_users SET status = :status, updated_at = :updated_at WHERE id = :id
            `),
            updateUserAttrs: this.db.prepare(`
                UPDATE iam_users SET attrs = :attrs, updated_at = :updated_at WHERE id = :id
            `),

            insertRole: this.db.prepare(`
                INSERT INTO iam_roles (id, tenant_id, name, description, created_at)
                VALUES (:id, :tenant_id, :name, :description, :created_at)
            `),
            getRoleById: this.db.prepare(`SELECT * FROM iam_roles WHERE id = :id`),
            getRoleByName: this.db.prepare(`
                SELECT * FROM iam_roles WHERE tenant_id = :tenant_id AND name = :name
            `),
            listRolesForTenant: this.db.prepare(`
                SELECT * FROM iam_roles WHERE tenant_id = :tenant_id ORDER BY name ASC
            `),

            insertMembership: this.db.prepare(`
                INSERT OR IGNORE INTO iam_memberships (user_id, tenant_id, role_id)
                VALUES (:user_id, :tenant_id, :role_id)
            `),
            deleteMembership: this.db.prepare(`
                DELETE FROM iam_memberships
                WHERE user_id = :user_id AND tenant_id = :tenant_id AND role_id = :role_id
            `),
            listMembershipsForUser: this.db.prepare(`
                SELECT m.user_id, m.tenant_id, m.role_id, r.name AS role_name
                FROM iam_memberships m
                JOIN iam_roles r ON r.id = m.role_id
                WHERE m.user_id = :user_id AND m.tenant_id = :tenant_id
                ORDER BY r.name ASC
            `),

            insertApiKey: this.db.prepare(`
                INSERT INTO iam_api_keys (id, user_id, tenant_id, hash, label, created_at, last_used_at, revoked_at)
                VALUES (:id, :user_id, :tenant_id, :hash, :label, :created_at, NULL, NULL)
            `),
            getApiKeyByHash: this.db.prepare(`
                SELECT * FROM iam_api_keys WHERE hash = :hash AND revoked_at IS NULL
            `),
            revokeApiKey: this.db.prepare(`
                UPDATE iam_api_keys SET revoked_at = :revoked_at WHERE id = :id
            `),
            touchApiKey: this.db.prepare(`
                UPDATE iam_api_keys SET last_used_at = :last_used_at WHERE id = :id
            `),
            listApiKeysForUser: this.db.prepare(`
                SELECT * FROM iam_api_keys WHERE user_id = :user_id ORDER BY created_at DESC
            `),

            insertIdp: this.db.prepare(`
                INSERT INTO iam_idp_configs (id, tenant_id, kind, config_json, created_at)
                VALUES (:id, :tenant_id, :kind, :config_json, :created_at)
            `),
            getIdpById: this.db.prepare(`SELECT * FROM iam_idp_configs WHERE id = :id`),
            listIdpsForTenant: this.db.prepare(`
                SELECT * FROM iam_idp_configs WHERE tenant_id = :tenant_id ORDER BY created_at ASC
            `),

            insertScimToken: this.db.prepare(`
                INSERT INTO iam_scim_tokens (id, tenant_id, hash, label, created_at, revoked_at)
                VALUES (:id, :tenant_id, :hash, :label, :created_at, NULL)
            `),
            getScimTokenByHash: this.db.prepare(`
                SELECT * FROM iam_scim_tokens WHERE hash = :hash AND revoked_at IS NULL
            `),
            revokeScimToken: this.db.prepare(`
                UPDATE iam_scim_tokens SET revoked_at = :revoked_at WHERE id = :id
            `),
            listScimTokensForTenant: this.db.prepare(`
                SELECT * FROM iam_scim_tokens WHERE tenant_id = :tenant_id ORDER BY created_at DESC
            `),

            insertSession: this.db.prepare(`
                INSERT INTO iam_sso_sessions (id, user_id, tenant_id, expires_at, created_at)
                VALUES (:id, :user_id, :tenant_id, :expires_at, :created_at)
            `),
            getSession: this.db.prepare(`
                SELECT * FROM iam_sso_sessions WHERE id = :id AND expires_at > :now
            `),
            deleteSession: this.db.prepare(`DELETE FROM iam_sso_sessions WHERE id = :id`),
        };
    }

    // ── seeding ─────────────────────────────────────────────────────────────

    /**
     * Idempotently seed the four default roles (`root`, `admin`, `operator`,
     * `viewer`) for a tenant. Returns a name → id map.
     */
    seedDefaultRoles(tenantId: string): Record<DefaultRoleName, string> {
        const out = {} as Record<DefaultRoleName, string>;
        const now = nowIso();
        for (const name of DEFAULT_ROLE_NAMES) {
            const existing = this.getRoleByName(tenantId, name);
            if (existing) {
                out[name] = existing.id;
                continue;
            }
            const id = newId("role");
            this.stmts.insertRole.run({
                id,
                tenant_id: tenantId,
                name,
                description: defaultRoleDescription(name),
                created_at: now,
            });
            out[name] = id;
        }
        return out;
    }

    // ── users ───────────────────────────────────────────────────────────────

    createUser(input: {
        tenantId: string;
        email: string;
        displayName?: string;
        status?: IamUserStatus;
        attrs?: Record<string, unknown>;
    }): IamUser {
        const id = newId("usr");
        const now = nowIso();
        const row = {
            id,
            tenant_id: input.tenantId,
            email: input.email,
            display_name: input.displayName ?? null,
            status: input.status ?? "active",
            created_at: now,
            updated_at: now,
            attrs: JSON.stringify(input.attrs ?? {}),
        };
        this.stmts.insertUser.run(row);
        return this.rowToUser(row);
    }

    getUser(id: string): IamUser | null {
        const row = this.stmts.getUserById.get({ id }) as Record<string, unknown> | undefined;
        return row ? this.rowToUser(row) : null;
    }

    getUserByEmail(tenantId: string, email: string): IamUser | null {
        const row = this.stmts.getUserByEmail.get({ tenant_id: tenantId, email }) as Record<string, unknown> | undefined;
        return row ? this.rowToUser(row) : null;
    }

    listUsers(tenantId: string): IamUser[] {
        const rows = this.stmts.listUsers.all({ tenant_id: tenantId }) as Record<string, unknown>[];
        return rows.map((r) => this.rowToUser(r));
    }

    setUserStatus(id: string, status: IamUserStatus): void {
        this.stmts.updateUserStatus.run({ id, status, updated_at: nowIso() });
    }

    updateUserAttrs(id: string, attrs: Record<string, unknown>): void {
        this.stmts.updateUserAttrs.run({ id, attrs: JSON.stringify(attrs), updated_at: nowIso() });
    }

    // ── roles ───────────────────────────────────────────────────────────────

    getRole(id: string): IamRole | null {
        const row = this.stmts.getRoleById.get({ id }) as Record<string, unknown> | undefined;
        return row ? this.rowToRole(row) : null;
    }

    getRoleByName(tenantId: string, name: string): IamRole | null {
        const row = this.stmts.getRoleByName.get({ tenant_id: tenantId, name }) as Record<string, unknown> | undefined;
        return row ? this.rowToRole(row) : null;
    }

    listRoles(tenantId: string): IamRole[] {
        const rows = this.stmts.listRolesForTenant.all({ tenant_id: tenantId }) as Record<string, unknown>[];
        return rows.map((r) => this.rowToRole(r));
    }

    // ── memberships ─────────────────────────────────────────────────────────

    addMembership(userId: string, tenantId: string, roleId: string): void {
        this.stmts.insertMembership.run({ user_id: userId, tenant_id: tenantId, role_id: roleId });
    }

    removeMembership(userId: string, tenantId: string, roleId: string): void {
        this.stmts.deleteMembership.run({ user_id: userId, tenant_id: tenantId, role_id: roleId });
    }

    listRoleNamesForUser(userId: string, tenantId: string): string[] {
        const rows = this.stmts.listMembershipsForUser.all({ user_id: userId, tenant_id: tenantId }) as Record<string, unknown>[];
        return rows.map((r) => String(r["role_name"]));
    }

    // ── API keys ────────────────────────────────────────────────────────────

    /**
     * Create an API key for a user. Returns the plaintext token (caller must
     * surface it once and never persist it elsewhere) plus the stored row.
     */
    createApiKey(userId: string, tenantId: string, label = ""): { token: string; record: IamApiKey } {
        const token = `prsm_${randomBytes(24).toString("base64url")}`;
        const hash = sha256Hex(token);
        const id = newId("key");
        const now = nowIso();
        this.stmts.insertApiKey.run({
            id, user_id: userId, tenant_id: tenantId, hash, label, created_at: now,
        });
        const record: IamApiKey = {
            id, userId, tenantId, label, createdAt: now, lastUsedAt: null, revokedAt: null,
        };
        return { token, record };
    }

    /**
     * Verify a presented API-key token. Returns null on miss, revoked, or
     * deprovisioned-user. On success, updates `last_used_at`.
     */
    verifyApiKey(token: string): ApiKeyVerifyResult | null {
        if (typeof token !== "string" || token.length < 10) return null;
        const presentedHash = sha256Hex(token);
        const row = this.stmts.getApiKeyByHash.get({ hash: presentedHash }) as Record<string, unknown> | undefined;
        if (!row) return null;
        const storedHash = String(row["hash"]);
        if (!constantTimeEqualHex(storedHash, presentedHash)) return null;
        const user = this.getUser(String(row["user_id"]));
        if (!user || user.status !== "active") return null;
        const now = nowIso();
        this.stmts.touchApiKey.run({ id: String(row["id"]), last_used_at: now });
        const apiKey: IamApiKey = {
            id: String(row["id"]),
            userId: String(row["user_id"]),
            tenantId: String(row["tenant_id"]),
            label: String(row["label"] ?? ""),
            createdAt: String(row["created_at"]),
            lastUsedAt: now,
            revokedAt: null,
        };
        return { apiKey, user };
    }

    revokeApiKey(id: string): void {
        this.stmts.revokeApiKey.run({ id, revoked_at: nowIso() });
    }

    listApiKeysForUser(userId: string): IamApiKey[] {
        const rows = this.stmts.listApiKeysForUser.all({ user_id: userId }) as Record<string, unknown>[];
        return rows.map(rowToApiKey);
    }

    // ── IdP configs ─────────────────────────────────────────────────────────

    addIdpConfig(tenantId: string, kind: IamIdpKind, config: Record<string, unknown>): IamIdpConfig {
        const id = newId("idp");
        const now = nowIso();
        this.stmts.insertIdp.run({
            id, tenant_id: tenantId, kind, config_json: JSON.stringify(config), created_at: now,
        });
        return { id, tenantId, kind, config, createdAt: now };
    }

    getIdpConfig(id: string): IamIdpConfig | null {
        const row = this.stmts.getIdpById.get({ id }) as Record<string, unknown> | undefined;
        return row ? rowToIdp(row) : null;
    }

    listIdpConfigs(tenantId: string): IamIdpConfig[] {
        const rows = this.stmts.listIdpsForTenant.all({ tenant_id: tenantId }) as Record<string, unknown>[];
        return rows.map(rowToIdp);
    }

    // ── SCIM tokens ─────────────────────────────────────────────────────────

    createScimToken(tenantId: string, label = ""): { token: string; record: IamScimToken } {
        const token = `prsm_scim_${randomBytes(24).toString("base64url")}`;
        const hash = sha256Hex(token);
        const id = newId("scim");
        const now = nowIso();
        this.stmts.insertScimToken.run({ id, tenant_id: tenantId, hash, label, created_at: now });
        return { token, record: { id, tenantId, label, createdAt: now, revokedAt: null } };
    }

    verifyScimToken(token: string): ScimTokenVerifyResult | null {
        if (typeof token !== "string" || token.length < 10) return null;
        const hash = sha256Hex(token);
        const row = this.stmts.getScimTokenByHash.get({ hash }) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (!constantTimeEqualHex(String(row["hash"]), hash)) return null;
        return {
            token: {
                id: String(row["id"]),
                tenantId: String(row["tenant_id"]),
                label: String(row["label"] ?? ""),
                createdAt: String(row["created_at"]),
                revokedAt: row["revoked_at"] ? String(row["revoked_at"]) : null,
            },
        };
    }

    revokeScimToken(id: string): void {
        this.stmts.revokeScimToken.run({ id, revoked_at: nowIso() });
    }

    listScimTokens(tenantId: string): IamScimToken[] {
        const rows = this.stmts.listScimTokensForTenant.all({ tenant_id: tenantId }) as Record<string, unknown>[];
        return rows.map((r) => ({
            id: String(r["id"]),
            tenantId: String(r["tenant_id"]),
            label: String(r["label"] ?? ""),
            createdAt: String(r["created_at"]),
            revokedAt: r["revoked_at"] ? String(r["revoked_at"]) : null,
        }));
    }

    // ── sessions ────────────────────────────────────────────────────────────

    createSession(userId: string, tenantId: string, ttlSeconds = 8 * 3600): IamSsoSession {
        const id = newId("sess");
        const now = new Date();
        const expires = new Date(now.getTime() + ttlSeconds * 1000);
        const session: IamSsoSession = {
            id,
            userId,
            tenantId,
            createdAt: now.toISOString(),
            expiresAt: expires.toISOString(),
        };
        this.stmts.insertSession.run({
            id,
            user_id: userId,
            tenant_id: tenantId,
            expires_at: session.expiresAt,
            created_at: session.createdAt,
        });
        return session;
    }

    getSession(id: string): IamSsoSession | null {
        const row = this.stmts.getSession.get({ id, now: nowIso() }) as Record<string, unknown> | undefined;
        if (!row) return null;
        return {
            id: String(row["id"]),
            userId: String(row["user_id"]),
            tenantId: String(row["tenant_id"]),
            expiresAt: String(row["expires_at"]),
            createdAt: String(row["created_at"]),
        };
    }

    deleteSession(id: string): void {
        this.stmts.deleteSession.run({ id });
    }

    // ── row mappers ─────────────────────────────────────────────────────────

    private rowToUser(r: Record<string, unknown>): IamUser {
        let attrs: Record<string, unknown> = {};
        try { attrs = JSON.parse(String(r["attrs"] ?? "{}")) as Record<string, unknown>; } catch { /* ignore */ }
        return {
            id: String(r["id"]),
            tenantId: String(r["tenant_id"]),
            email: String(r["email"]),
            displayName: r["display_name"] != null ? String(r["display_name"]) : null,
            status: String(r["status"]) as IamUserStatus,
            createdAt: String(r["created_at"]),
            updatedAt: String(r["updated_at"]),
            attrs,
        };
    }

    private rowToRole(r: Record<string, unknown>): IamRole {
        return {
            id: String(r["id"]),
            tenantId: String(r["tenant_id"]),
            name: String(r["name"]),
            description: r["description"] != null ? String(r["description"]) : null,
            createdAt: String(r["created_at"]),
        };
    }
}

function rowToApiKey(r: Record<string, unknown>): IamApiKey {
    return {
        id: String(r["id"]),
        userId: String(r["user_id"]),
        tenantId: String(r["tenant_id"]),
        label: String(r["label"] ?? ""),
        createdAt: String(r["created_at"]),
        lastUsedAt: r["last_used_at"] ? String(r["last_used_at"]) : null,
        revokedAt: r["revoked_at"] ? String(r["revoked_at"]) : null,
    };
}

function rowToIdp(r: Record<string, unknown>): IamIdpConfig {
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(String(r["config_json"] ?? "{}")) as Record<string, unknown>; } catch { /* ignore */ }
    return {
        id: String(r["id"]),
        tenantId: String(r["tenant_id"]),
        kind: String(r["kind"]) as IamIdpKind,
        config: cfg,
        createdAt: String(r["created_at"]),
    };
}

function defaultRoleDescription(name: DefaultRoleName): string {
    switch (name) {
        case "root": return "Full control including IAM administration and tenant configuration.";
        case "admin": return "Tenant administrator: manages users, roles, and policies.";
        case "operator": return "Day-to-day agent operation, run management, and observability.";
        case "viewer": return "Read-only access to dashboards and audit trails.";
    }
}
