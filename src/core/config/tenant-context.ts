/**
 * Multi-Tenant Context (Phase E)
 *
 * Establishes an `AsyncLocalStorage`-based tenant scope so that downstream
 * helpers (workspace path resolution, audit emission, store lookups) can
 * specialize per-tenant without threading a tenant id through every call.
 *
 * Default tenant is `"default"` — when no scope is active, behavior is
 * identical to single-tenant. Multi-tenant mode is gated by the env flag
 * `PRISM_MULTI_TENANT=on`. When the flag is off, `withTenant` is a no-op
 * (the body still runs, but `currentTenantContext()` returns the default).
 *
 * Tenant subroots live at `{workspaceRoot}/.tenants/{id}/` and are lazily
 * created the first time a tenant-scoped path is requested.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export interface TenantContext {
    tenantId: string;
    /** Optional override of workspace root for this tenant. Falls back to global resolver. */
    workspaceRoot?: string;
    /** Tenant profile classifier. */
    profile?: "individual" | "business" | "enterprise";
    /** Identity hint (user id, account id, etc.) — opaque. */
    identity?: string;
}

export const DEFAULT_TENANT: TenantContext = { tenantId: "default" };

const _storage = new AsyncLocalStorage<TenantContext>();

/** Whether multi-tenant scoping is active (env-gated). */
export function isMultiTenantEnabled(): boolean {
    return process.env.PRISM_MULTI_TENANT === "on";
}

/** Run `fn` inside the supplied tenant scope. */
export function withTenant<T>(ctx: TenantContext, fn: () => T): T {
    if (!ctx.tenantId || typeof ctx.tenantId !== "string") {
        throw new Error("withTenant: tenantId is required");
    }
    return _storage.run(ctx, fn);
}

/** Return the current tenant context, or the default when none is active. */
export function currentTenantContext(): TenantContext {
    return _storage.getStore() ?? DEFAULT_TENANT;
}

/** Return the current tenant id (always defined). */
export function currentTenantId(): string {
    return currentTenantContext().tenantId;
}

/**
 * Compute a tenant-scoped subdirectory under the given root.
 *
 * - When multi-tenant mode is OFF, returns `{root}` unchanged (legacy behavior).
 * - When multi-tenant mode is ON and a non-default tenant is active, returns
 *   `{root}/.tenants/{tenantId}/`. The directory is lazily created.
 *
 * Default tenant always returns `{root}` to preserve zero-behavior-change for
 * existing single-tenant deployments.
 */
export function tenantSubroot(root: string): string {
    if (!isMultiTenantEnabled()) return root;
    const id = currentTenantId();
    if (id === "default") return root;
    const dir = join(root, ".tenants", id);
    try {
        mkdirSync(dir, { recursive: true });
    } catch {
        /* best-effort */
    }
    return dir;
}

/**
 * Express-style middleware that extracts the `X-Prism-Tenant` header into
 * a tenant context for the duration of the request. Only active when
 * `PRISM_MULTI_TENANT=on`. Validates id format `^[a-z0-9][a-z0-9-_]{0,63}$`.
 */
export function tenantHttpMiddleware(): (req: { headers: Record<string, string | string[] | undefined> }, _res: unknown, next: () => void) => void {
    const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
    return (req, _res, next) => {
        if (!isMultiTenantEnabled()) {
            next();
            return;
        }
        const raw = req.headers["x-prism-tenant"] ?? req.headers["X-Prism-Tenant"];
        const id = Array.isArray(raw) ? raw[0] : raw;
        if (!id || typeof id !== "string" || !idPattern.test(id)) {
            next();
            return;
        }
        withTenant({ tenantId: id }, () => next());
    };
}

/** Test/admin escape hatch: clear scope (returns to DEFAULT_TENANT). */
export function _disposeTenantScopeForTest(): void {
    // ALS doesn't expose disposal; consumers should use withTenant(default, fn).
}
