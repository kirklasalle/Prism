/**
 * Tests for the Phase H-1 IAM store.
 *
 * Exercises the additive identity layer in isolation against an in-memory
 * SQLite database. No dashboard / runtime wiring — that lands in H-2 / H-3.
 */

import assert from "node:assert/strict";
import { IamStore, DEFAULT_ROLE_NAMES } from "../src/core/iam/store.js";

export async function testIamStore(): Promise<void> {
    const store = new IamStore(":memory:");
    try {
        // ── seed default roles is idempotent ──────────────────────────────
        const roles = store.seedDefaultRoles("default");
        for (const name of DEFAULT_ROLE_NAMES) {
            assert.ok(roles[name], `role ${name} seeded`);
        }
        const roles2 = store.seedDefaultRoles("default");
        assert.deepEqual(roles, roles2, "seedDefaultRoles is idempotent");
        assert.equal(store.listRoles("default").length, DEFAULT_ROLE_NAMES.length);

        // ── user lifecycle + uniqueness ───────────────────────────────────
        const u1 = store.createUser({
            tenantId: "default",
            email: "alice@example.com",
            displayName: "Alice",
            attrs: { dept: "eng" },
        });
        assert.ok(u1.id.startsWith("usr_"));
        assert.equal(u1.email, "alice@example.com");
        assert.equal(u1.attrs.dept, "eng");

        const fetched = store.getUserByEmail("default", "alice@example.com");
        assert.ok(fetched && fetched.id === u1.id);

        // duplicate email is rejected by the UNIQUE constraint
        let dupRejected = false;
        try {
            store.createUser({ tenantId: "default", email: "alice@example.com" });
        } catch {
            dupRejected = true;
        }
        assert.ok(dupRejected, "duplicate email must be rejected");

        // status transitions
        store.setUserStatus(u1.id, "suspended");
        assert.equal(store.getUser(u1.id)?.status, "suspended");
        store.setUserStatus(u1.id, "active");

        // listing scoped by tenant
        store.createUser({ tenantId: "other-tenant", email: "carol@example.com" });
        assert.equal(store.listUsers("default").length, 1);
        assert.equal(store.listUsers("other-tenant").length, 1);

        // ── memberships ───────────────────────────────────────────────────
        const adminRoleId = roles["admin"];
        const operatorRoleId = roles["operator"];
        store.addMembership(u1.id, "default", adminRoleId);
        store.addMembership(u1.id, "default", operatorRoleId);
        // duplicate add is no-op
        store.addMembership(u1.id, "default", adminRoleId);
        const heldRoles = store.listRoleNamesForUser(u1.id, "default").sort();
        assert.deepEqual(heldRoles, ["admin", "operator"]);
        store.removeMembership(u1.id, "default", operatorRoleId);
        assert.deepEqual(store.listRoleNamesForUser(u1.id, "default"), ["admin"]);

        // ── API keys: hash-only storage + verify + revoke ─────────────────
        const { token, record } = store.createApiKey(u1.id, "default", "ci-pipeline");
        assert.ok(token.startsWith("prsm_"));
        assert.equal(record.userId, u1.id);
        assert.equal(record.label, "ci-pipeline");

        const ok = store.verifyApiKey(token);
        assert.ok(ok, "valid token verifies");
        assert.equal(ok!.user.id, u1.id);
        assert.ok(ok!.apiKey.lastUsedAt, "verify updates last_used_at");

        // wrong token must NOT verify
        assert.equal(store.verifyApiKey("prsm_not-a-real-key"), null);
        assert.equal(store.verifyApiKey(""), null);
        assert.equal(store.verifyApiKey("x"), null);

        // suspended user cannot verify their key
        store.setUserStatus(u1.id, "suspended");
        assert.equal(store.verifyApiKey(token), null, "suspended user fails verify");
        store.setUserStatus(u1.id, "active");

        // revoked key cannot verify
        store.revokeApiKey(record.id);
        assert.equal(store.verifyApiKey(token), null, "revoked key fails verify");

        // ── IdP configs ───────────────────────────────────────────────────
        const idp = store.addIdpConfig("default", "oidc", {
            issuer: "https://accounts.example.com",
            client_id: "abc",
        });
        assert.equal(idp.kind, "oidc");
        assert.equal((idp.config as { issuer: string }).issuer, "https://accounts.example.com");
        const fetchedIdp = store.getIdpConfig(idp.id);
        assert.ok(fetchedIdp && fetchedIdp.id === idp.id);
        assert.equal(store.listIdpConfigs("default").length, 1);

        // ── SCIM tokens ───────────────────────────────────────────────────
        const scim = store.createScimToken("default", "vanta");
        assert.ok(scim.token.startsWith("prsm_scim_"));
        const verified = store.verifyScimToken(scim.token);
        assert.ok(verified, "scim token verifies");
        store.revokeScimToken(scim.record.id);
        assert.equal(store.verifyScimToken(scim.token), null, "revoked scim token fails");

        // ── sessions ──────────────────────────────────────────────────────
        const session = store.createSession(u1.id, "default", 60);
        assert.ok(session.id.startsWith("sess_"));
        const got = store.getSession(session.id);
        assert.ok(got && got.userId === u1.id);
        store.deleteSession(session.id);
        assert.equal(store.getSession(session.id), null);

        // expired session is filtered
        const expired = store.createSession(u1.id, "default", -1);
        assert.equal(store.getSession(expired.id), null, "expired sessions are not returned");
    } finally {
        store.close();
    }
}
