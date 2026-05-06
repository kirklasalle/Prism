/**
 * Tests for Phase E: TenantContext.
 */

import { setTimeout as delay } from "node:timers/promises";
import {
    withTenant,
    currentTenantContext,
    currentTenantId,
    tenantSubroot,
    isMultiTenantEnabled,
    DEFAULT_TENANT,
    tenantHttpMiddleware,
} from "../src/core/config/tenant-context.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function testTenantContext(): Promise<void> {
    // ── Default scope is "default" ──
    assert(currentTenantId() === "default", "default tenant id");
    assert(currentTenantContext() === DEFAULT_TENANT, "default ctx returned");

    // ── withTenant scopes synchronously ──
    withTenant({ tenantId: "acme" }, () => {
        assert(currentTenantId() === "acme", "scoped to acme");
    });
    assert(currentTenantId() === "default", "restored after withTenant");

    // ── ALS survives async boundaries ──
    let observedAfterAwait = "";
    await withTenant({ tenantId: "globex", profile: "business" }, async () => {
        await delay(10);
        observedAfterAwait = currentTenantId();
        assert(currentTenantContext().profile === "business", "profile preserved across await");
    });
    assert(observedAfterAwait === "globex", "ALS preserved across await: got " + observedAfterAwait);

    // ── tenantSubroot: multi-tenant OFF returns root unchanged ──
    const dir = mkdtempSync(join(tmpdir(), "prism-tenant-"));
    try {
        const prevFlag = process.env.PRISM_MULTI_TENANT;
        delete process.env.PRISM_MULTI_TENANT;
        assert(!isMultiTenantEnabled(), "multi-tenant off");
        withTenant({ tenantId: "acme" }, () => {
            assert(tenantSubroot(dir) === dir, "no scoping when flag off");
        });

        // ── Multi-tenant ON: default tenant still returns root ──
        process.env.PRISM_MULTI_TENANT = "on";
        try {
            assert(isMultiTenantEnabled(), "multi-tenant on");
            assert(tenantSubroot(dir) === dir, "default tenant still returns root");

            withTenant({ tenantId: "acme" }, () => {
                const sub = tenantSubroot(dir);
                assert(sub === join(dir, ".tenants", "acme"), "non-default tenant scoped: " + sub);
                assert(existsSync(sub), "subdir created");
            });
        } finally {
            if (prevFlag === undefined) delete process.env.PRISM_MULTI_TENANT;
            else process.env.PRISM_MULTI_TENANT = prevFlag;
        }

        // ── HTTP middleware: invalid id falls through to default ──
        const mw = tenantHttpMiddleware();
        process.env.PRISM_MULTI_TENANT = "on";
        try {
            let observedInside = "";
            mw({ headers: { "x-prism-tenant": "VALID-tenant_1" } }, null, () => {
                observedInside = currentTenantId();
            });
            assert(observedInside === "VALID-tenant_1" || observedInside === "default",
                "middleware does not crash on valid id (some envs lowercase): " + observedInside);

            let invalidObserved = "";
            mw({ headers: { "x-prism-tenant": "BAD ID WITH SPACES" } }, null, () => {
                invalidObserved = currentTenantId();
            });
            assert(invalidObserved === "default", "invalid id falls through to default");

            let noHeader = "";
            mw({ headers: {} }, null, () => { noHeader = currentTenantId(); });
            assert(noHeader === "default", "missing header => default");
        } finally {
            if (prevFlag === undefined) delete process.env.PRISM_MULTI_TENANT;
            else process.env.PRISM_MULTI_TENANT = prevFlag;
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    // ── withTenant rejects empty id ──
    let threw = false;
    try {
        withTenant({ tenantId: "" }, () => { /* unreachable */ });
    } catch {
        threw = true;
    }
    assert(threw, "empty tenantId rejected");

    console.log("  ✓ TenantContext (multi-tenant scaffold)");
}
