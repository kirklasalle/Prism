/**
 * Phase F-C — Multi-tenant workspace path wiring.
 *
 * Asserts that `workspacePath()` composes with `tenantSubroot()` so that
 * tenant-scoped DB filenames live under `{root}/.tenants/{id}/...` when
 * multi-tenant mode is enabled, and that the legacy path is preserved
 * when the flag is off.
 */

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    workspacePath,
    untenantedWorkspacePath,
    _setWorkspaceRootForTest,
} from "../src/core/config/workspace-resolver.js";
import { withTenant } from "../src/core/config/tenant-context.js";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function testMultiTenantWorkspace(): Promise<void> {
    const tmp = mkdtempSync(join(tmpdir(), "prism-mt-ws-"));
    const prevRoot = process.env.PRISM_WORKSPACE_ROOT;
    const prevFlag = process.env.PRISM_MULTI_TENANT;
    try {
        _setWorkspaceRootForTest(tmp);

        // ── Flag off: tenant scope is a no-op ──
        process.env.PRISM_MULTI_TENANT = "off";
        const offDefault = workspacePath("state", "x.db");
        const offScoped = withTenant({ tenantId: "acme" }, () => workspacePath("state", "x.db"));
        assert(offDefault === offScoped, "flag-off: tenant scope ignored");
        assert(offDefault === join(tmp, "state", "x.db"), "flag-off: legacy path");

        // ── Flag on, default tenant: legacy path preserved ──
        process.env.PRISM_MULTI_TENANT = "on";
        const onDefault = workspacePath("state", "x.db");
        assert(onDefault === join(tmp, "state", "x.db"), "default tenant: legacy path");

        // ── Flag on, non-default tenant: subroot used ──
        const acmePath = withTenant({ tenantId: "acme" }, () => workspacePath("state", "x.db"));
        const expected = join(tmp, ".tenants", "acme", "state", "x.db");
        assert(acmePath === expected, `acme path: ${acmePath} vs ${expected}`);
        assert(existsSync(join(tmp, ".tenants", "acme")), "tenant subroot mkdir'd");

        // ── untenanted helper bypasses tenant scope ──
        const bypass = withTenant({ tenantId: "acme" }, () => untenantedWorkspacePath("state", "shared.db"));
        assert(bypass === join(tmp, "state", "shared.db"), "untenantedWorkspacePath bypasses tenant");
    } finally {
        if (prevRoot === undefined) delete process.env.PRISM_WORKSPACE_ROOT;
        else process.env.PRISM_WORKSPACE_ROOT = prevRoot;
        if (prevFlag === undefined) delete process.env.PRISM_MULTI_TENANT;
        else process.env.PRISM_MULTI_TENANT = prevFlag;
        try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    }
}
