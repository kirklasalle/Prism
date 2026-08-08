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
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

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
    activationState: "authenticated" | "operational";
    enrollmentBindingId: string | null;
    expiresAt: string;
    createdAt: string;
}

export type PadAdoptionDecision = "accept" | "reject";

export interface PadAdoptionReceiptPayload {
    tenantId: string;
    userId: string;
    activePadDigest: string;
    activePadVersion: string;
    previousPadDigest: string | null;
    governanceKeyId: string;
    governanceSignatureDigest: string;
    releaseCommit: string;
    sessionId: string;
    decision: PadAdoptionDecision;
    nonce: string;
    decidedAt: string;
}

export interface PadAdoptionReceipt extends PadAdoptionReceiptPayload {
    id: string;
    payloadHash: string;
    localSignatureBase64: string;
    localPublicKeyBase64: string;
}

export interface RecordPadAdoptionReceiptInput extends PadAdoptionReceiptPayload {
    localSignatureBase64: string;
    localPublicKeyBase64: string;
}

/** Default seeded role names, in descending privilege order. */
export const DEFAULT_ROLE_NAMES = ["root", "admin", "operator", "viewer"] as const;
export type DefaultRoleName = (typeof DEFAULT_ROLE_NAMES)[number];

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
        deleteUser: StatementSync;
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
        insertPadAdoptionReceipt: StatementSync;
        getAcceptedPadAdoption: StatementSync;
        listPadAdoptionReceipts: StatementSync;
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
            try {
                this.db.close();
            } catch {
                /* best-effort */
            }
        }
    }

    private migrate(): void {
        this.db.exec("PRAGMA foreign_keys = ON;");
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
                activation_state TEXT NOT NULL DEFAULT 'operational',
                enrollment_binding_id TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES iam_users(id) ON DELETE CASCADE
      );
            CREATE TABLE IF NOT EXISTS pad_adoption_receipts (
                id                          TEXT PRIMARY KEY,
                tenant_id                   TEXT NOT NULL,
                user_id                     TEXT NOT NULL,
                active_pad_digest           TEXT NOT NULL,
                active_pad_version          TEXT NOT NULL,
                previous_pad_digest         TEXT,
                governance_key_id           TEXT NOT NULL,
                governance_signature_digest TEXT NOT NULL,
                release_commit              TEXT NOT NULL,
                session_id                  TEXT NOT NULL,
                decision                    TEXT NOT NULL CHECK (decision IN ('accept', 'reject')),
                nonce                       TEXT NOT NULL UNIQUE,
                decided_at                  TEXT NOT NULL,
                payload_hash                TEXT NOT NULL,
                local_signature_base64      TEXT NOT NULL,
                local_public_key_base64     TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_pad_adoption_unique_acceptance
                ON pad_adoption_receipts (tenant_id, user_id, active_pad_digest)
                WHERE decision = 'accept';
            CREATE INDEX IF NOT EXISTS idx_pad_adoption_operator
                ON pad_adoption_receipts (tenant_id, user_id, decided_at DESC);
            CREATE TABLE IF NOT EXISTS iam_enrollment_tokens (
                token_hash TEXT PRIMARY KEY,
                binding_id TEXT NOT NULL,
                consumed_by_session_id TEXT,
                consumed_at TEXT,
                created_at TEXT NOT NULL
            );
    `);
        this.ensureColumn("iam_sso_sessions", "activation_state", "TEXT NOT NULL DEFAULT 'operational'");
        this.ensureColumn("iam_sso_sessions", "enrollment_binding_id", "TEXT");
    }

    private ensureColumn(table: string, column: string, definition: string): void {
        const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!columns.some((existing) => existing.name === column)) {
            this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
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
            deleteUser: this.db.prepare(`
                DELETE FROM iam_users WHERE id = :id
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
                INSERT INTO iam_sso_sessions
                    (id, user_id, tenant_id, activation_state, enrollment_binding_id, expires_at, created_at)
                VALUES
                    (:id, :user_id, :tenant_id, :activation_state, NULL, :expires_at, :created_at)
            `),
            getSession: this.db.prepare(`
                SELECT * FROM iam_sso_sessions WHERE id = :id AND expires_at > :now
            `),
            deleteSession: this.db.prepare(`DELETE FROM iam_sso_sessions WHERE id = :id`),
            insertPadAdoptionReceipt: this.db.prepare(`
                INSERT INTO pad_adoption_receipts
                    (id, tenant_id, user_id, active_pad_digest, active_pad_version, previous_pad_digest,
                     governance_key_id, governance_signature_digest, release_commit, session_id, decision,
                     nonce, decided_at, payload_hash, local_signature_base64, local_public_key_base64)
                VALUES
                    (:id, :tenant_id, :user_id, :active_pad_digest, :active_pad_version, :previous_pad_digest,
                     :governance_key_id, :governance_signature_digest, :release_commit, :session_id, :decision,
                     :nonce, :decided_at, :payload_hash, :local_signature_base64, :local_public_key_base64)
            `),
            getAcceptedPadAdoption: this.db.prepare(`
                SELECT * FROM pad_adoption_receipts
                WHERE tenant_id = :tenant_id AND user_id = :user_id
                  AND active_pad_digest = :active_pad_digest AND decision = 'accept'
                LIMIT 1
            `),
            listPadAdoptionReceipts: this.db.prepare(`
                SELECT * FROM pad_adoption_receipts
                WHERE tenant_id = :tenant_id AND user_id = :user_id
                ORDER BY decided_at ASC, id ASC
            `),
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
        const row = this.stmts.getUserByEmail.get({ tenant_id: tenantId, email }) as
            Record<string, unknown> | undefined;
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

    deleteUser(id: string): void {
        this.stmts.deleteUser.run({ id });
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
        const rows = this.stmts.listMembershipsForUser.all({ user_id: userId, tenant_id: tenantId }) as Record<
            string,
            unknown
        >[];
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
            id,
            user_id: userId,
            tenant_id: tenantId,
            hash,
            label,
            created_at: now,
        });
        const record: IamApiKey = {
            id,
            userId,
            tenantId,
            label,
            createdAt: now,
            lastUsedAt: null,
            revokedAt: null,
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
            id,
            tenant_id: tenantId,
            kind,
            config_json: JSON.stringify(config),
            created_at: now,
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

    createSession(
        userId: string,
        tenantId: string,
        ttlSeconds = 8 * 3600,
        activationState: "authenticated" | "operational" = "operational",
    ): IamSsoSession {
        const id = newId("sess");
        const now = new Date();
        const expires = new Date(now.getTime() + ttlSeconds * 1000);
        const session: IamSsoSession = {
            id,
            userId,
            tenantId,
            activationState,
            enrollmentBindingId: null,
            createdAt: now.toISOString(),
            expiresAt: expires.toISOString(),
        };
        this.stmts.insertSession.run({
            id,
            user_id: userId,
            tenant_id: tenantId,
            activation_state: activationState,
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
            activationState: String(row["activation_state"]) as "authenticated" | "operational",
            enrollmentBindingId: row["enrollment_binding_id"] ? String(row["enrollment_binding_id"]) : null,
            expiresAt: String(row["expires_at"]),
            createdAt: String(row["created_at"]),
        };
    }

    deleteSession(id: string): void {
        this.stmts.deleteSession.run({ id });
    }

    // ── PAD adoption receipts ──────────────────────────────────────────────

    recordPadAdoptionReceipt(input: RecordPadAdoptionReceiptInput): PadAdoptionReceipt {
        if (!/^[a-f0-9]{64}$/.test(input.activePadDigest)) throw new Error("Invalid active PAD digest");
        if (input.previousPadDigest !== null && !/^[a-f0-9]{64}$/.test(input.previousPadDigest)) {
            throw new Error("Invalid previous PAD digest");
        }
        if (!/^[a-f0-9]{64}$/.test(input.governanceSignatureDigest)) {
            throw new Error("Invalid governance signature digest");
        }
        if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(input.releaseCommit)) {
            throw new Error("Invalid release commit");
        }
        if (!input.nonce.trim() || !input.sessionId.trim() || !input.governanceKeyId.trim()) {
            throw new Error("Receipt nonce, session ID, and governance key ID are required");
        }
        if (Number.isNaN(Date.parse(input.decidedAt))) throw new Error("Invalid receipt decision timestamp");

        const payload = canonicalPadAdoptionPayload(input);
        const payloadHash = sha256Hex(payload);
        let signatureValid = false;
        try {
            const publicKey = createPublicKey({
                key: Buffer.from(input.localPublicKeyBase64, "base64"),
                format: "der",
                type: "spki",
            });
            signatureValid = verify(
                null,
                Buffer.from(payload, "utf8"),
                publicKey,
                Buffer.from(input.localSignatureBase64, "base64"),
            );
        } catch {
            signatureValid = false;
        }
        if (!signatureValid) throw new Error("PAD adoption receipt signature is invalid");

        const receipt: PadAdoptionReceipt = {
            id: newId("padrec"),
            ...input,
            payloadHash,
        };
        this.stmts.insertPadAdoptionReceipt.run({
            id: receipt.id,
            tenant_id: receipt.tenantId,
            user_id: receipt.userId,
            active_pad_digest: receipt.activePadDigest,
            active_pad_version: receipt.activePadVersion,
            previous_pad_digest: receipt.previousPadDigest,
            governance_key_id: receipt.governanceKeyId,
            governance_signature_digest: receipt.governanceSignatureDigest,
            release_commit: receipt.releaseCommit,
            session_id: receipt.sessionId,
            decision: receipt.decision,
            nonce: receipt.nonce,
            decided_at: receipt.decidedAt,
            payload_hash: receipt.payloadHash,
            local_signature_base64: receipt.localSignatureBase64,
            local_public_key_base64: receipt.localPublicKeyBase64,
        });
        return receipt;
    }

    hasAcceptedPadAdoption(tenantId: string, userId: string, activePadDigest: string): boolean {
        return Boolean(
            this.stmts.getAcceptedPadAdoption.get({
                tenant_id: tenantId,
                user_id: userId,
                active_pad_digest: activePadDigest,
            }),
        );
    }

    listPadAdoptionReceipts(tenantId: string, userId: string): PadAdoptionReceipt[] {
        const rows = this.stmts.listPadAdoptionReceipts.all({ tenant_id: tenantId, user_id: userId }) as Record<
            string,
            unknown
        >[];
        return rows.map(rowToPadAdoptionReceipt);
    }

    activateSessionWithEnrollment(
        sessionId: string,
        expectedToken: string,
        presentedToken: string,
        bindingId: string,
    ): boolean {
        const expectedHash = createHash("sha256").update(expectedToken).digest();
        const presentedHash = createHash("sha256").update(presentedToken).digest();
        if (!expectedToken || !presentedToken || !bindingId || !timingSafeEqual(expectedHash, presentedHash)) {
            return false;
        }

        const tokenHash = expectedHash.toString("hex");
        const now = nowIso();
        this.db.exec("BEGIN IMMEDIATE");
        try {
            this.db
                .prepare(
                    `INSERT OR IGNORE INTO iam_enrollment_tokens
                        (token_hash, binding_id, consumed_by_session_id, consumed_at, created_at)
                     VALUES (:tokenHash, :bindingId, NULL, NULL, :createdAt)`,
                )
                .run({ tokenHash, bindingId, createdAt: now });
            const token = this.db
                .prepare(
                    `SELECT binding_id, consumed_by_session_id
                     FROM iam_enrollment_tokens WHERE token_hash = :tokenHash`,
                )
                .get({ tokenHash }) as { binding_id: string; consumed_by_session_id: string | null } | undefined;
            if (!token || token.binding_id !== bindingId || token.consumed_by_session_id) {
                this.db.exec("ROLLBACK");
                return false;
            }

            const sessionUpdate = this.db
                .prepare(
                    `UPDATE iam_sso_sessions
                     SET activation_state = 'operational', enrollment_binding_id = :bindingId
                     WHERE id = :sessionId AND activation_state = 'authenticated' AND expires_at > :now`,
                )
                .run({ bindingId, sessionId, now });
            if (sessionUpdate.changes !== 1) {
                this.db.exec("ROLLBACK");
                return false;
            }
            this.db
                .prepare(
                    `UPDATE iam_enrollment_tokens
                     SET consumed_by_session_id = :sessionId, consumed_at = :now
                     WHERE token_hash = :tokenHash AND consumed_by_session_id IS NULL`,
                )
                .run({ sessionId, now, tokenHash });
            this.db.exec("COMMIT");
            return true;
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }

    // ── row mappers ─────────────────────────────────────────────────────────

    private rowToUser(r: Record<string, unknown>): IamUser {
        let attrs: Record<string, unknown> = {};
        try {
            attrs = JSON.parse(String(r["attrs"] ?? "{}")) as Record<string, unknown>;
        } catch {
            /* ignore */
        }
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

export function canonicalPadAdoptionPayload(input: PadAdoptionReceiptPayload): string {
    return JSON.stringify({
        tenantId: input.tenantId,
        userId: input.userId,
        activePadDigest: input.activePadDigest,
        activePadVersion: input.activePadVersion,
        previousPadDigest: input.previousPadDigest,
        governanceKeyId: input.governanceKeyId,
        governanceSignatureDigest: input.governanceSignatureDigest,
        releaseCommit: input.releaseCommit,
        sessionId: input.sessionId,
        decision: input.decision,
        nonce: input.nonce,
        decidedAt: input.decidedAt,
    });
}

function rowToPadAdoptionReceipt(row: Record<string, unknown>): PadAdoptionReceipt {
    return {
        id: String(row["id"]),
        tenantId: String(row["tenant_id"]),
        userId: String(row["user_id"]),
        activePadDigest: String(row["active_pad_digest"]),
        activePadVersion: String(row["active_pad_version"]),
        previousPadDigest: row["previous_pad_digest"] ? String(row["previous_pad_digest"]) : null,
        governanceKeyId: String(row["governance_key_id"]),
        governanceSignatureDigest: String(row["governance_signature_digest"]),
        releaseCommit: String(row["release_commit"]),
        sessionId: String(row["session_id"]),
        decision: String(row["decision"]) as PadAdoptionDecision,
        nonce: String(row["nonce"]),
        decidedAt: String(row["decided_at"]),
        payloadHash: String(row["payload_hash"]),
        localSignatureBase64: String(row["local_signature_base64"]),
        localPublicKeyBase64: String(row["local_public_key_base64"]),
    };
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
    try {
        cfg = JSON.parse(String(r["config_json"] ?? "{}")) as Record<string, unknown>;
    } catch {
        /* ignore */
    }
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
        case "root":
            return "Full control including IAM administration and tenant configuration.";
        case "admin":
            return "Tenant administrator: manages users, roles, and policies.";
        case "operator":
            return "Day-to-day agent operation, run management, and observability.";
        case "viewer":
            return "Read-only access to dashboards and audit trails.";
    }
}
