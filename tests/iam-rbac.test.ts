/**
 * Tests for the Phase H-1 RBAC helpers.
 *
 * The legacy admin-token path produces a synthetic principal with
 * `roles: ["root"]`; every existing role-gated check must still pass for it.
 */

import assert from "node:assert/strict";
import {
    adminTokenPrincipal,
    highestRole,
    listRoleNames,
    principalHasRole,
    RbacError,
    requireRole,
    roleAtLeast,
    type IamPrincipal,
} from "../src/core/iam/rbac.js";

export async function testIamRbac(): Promise<void> {
    // ── role hierarchy ────────────────────────────────────────────────────
    assert.deepEqual(listRoleNames(), ["root", "admin", "operator", "viewer"]);
    assert.equal(roleAtLeast("root", "viewer"), true);
    assert.equal(roleAtLeast("admin", "operator"), true);
    assert.equal(roleAtLeast("operator", "operator"), true, "equality satisfies");
    assert.equal(roleAtLeast("viewer", "operator"), false);
    assert.equal(roleAtLeast("viewer", "root"), false);
    assert.equal(roleAtLeast("not-a-role", "viewer"), false, "unknown role never satisfies");

    // ── admin-token synthetic principal ───────────────────────────────────
    const admin = adminTokenPrincipal();
    assert.equal(admin.userId, "_admin");
    assert.equal(admin.tenantId, "default");
    assert.deepEqual(admin.roles, ["root"]);
    assert.equal(admin.source, "admin_token");
    for (const r of ["root", "admin", "operator", "viewer"] as const) {
        assert.equal(principalHasRole(admin, r), true, `admin token satisfies '${r}'`);
    }

    // ── operator-only principal ───────────────────────────────────────────
    const op: IamPrincipal = {
        userId: "u_op",
        tenantId: "default",
        roles: ["operator"],
        source: "sso_session",
    };
    assert.equal(principalHasRole(op, "operator"), true);
    assert.equal(principalHasRole(op, "viewer"), true);
    assert.equal(principalHasRole(op, "admin"), false);
    assert.equal(principalHasRole(op, "root"), false);

    // ── highestRole picks the strongest grant ─────────────────────────────
    const multi: IamPrincipal = {
        userId: "u_m",
        tenantId: "default",
        roles: ["viewer", "admin", "operator"],
        source: "sso_session",
    };
    assert.equal(highestRole(multi), "admin");
    assert.equal(highestRole({ ...multi, roles: [] }), null);
    assert.equal(highestRole(null), null);

    // ── requireRole throws RbacError when insufficient ────────────────────
    let thrown: unknown = null;
    try { requireRole(op, "admin"); } catch (e) { thrown = e; }
    assert.ok(thrown instanceof RbacError, "RbacError must be thrown");
    assert.equal((thrown as RbacError).statusCode, 403);
    assert.equal((thrown as RbacError).code, "forbidden");
    assert.equal((thrown as RbacError).required, "admin");
    assert.deepEqual(Array.from((thrown as RbacError).held), ["operator"]);

    // requireRole on null/undefined principal also throws
    let nullThrown: unknown = null;
    try { requireRole(null, "viewer"); } catch (e) { nullThrown = e; }
    assert.ok(nullThrown instanceof RbacError);

    // requireRole passes silently on satisfaction
    requireRole(admin, "root");
    requireRole(op, "viewer");

    // ── unknown roles are ignored, not granted ────────────────────────────
    const garbage: IamPrincipal = {
        userId: "u_g",
        tenantId: "default",
        roles: ["super-duper-admin", "not-a-role"] as unknown as IamPrincipal["roles"],
        source: "api_key",
    };
    assert.equal(principalHasRole(garbage, "viewer"), false, "unknown role names confer nothing");
    assert.equal(highestRole(garbage), null);
}
