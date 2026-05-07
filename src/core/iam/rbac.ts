/**
 * PRISM Enterprise IAM — RBAC helpers (Phase H-1)
 *
 * Coarse 4-tier role hierarchy: root > admin > operator > viewer.
 * Fine-grained permission scopes are deliberately deferred to a later phase
 * (the inventory called this out as v1 scope). Every permission check is
 * expressed as "the principal must hold role X or higher".
 *
 * The legacy single-admin-token path produces a synthetic principal with
 * `roles: ["root"]` so all existing callers continue to satisfy
 * `requireRole(p, "root")` without code changes when IAM is off.
 */

import type { DefaultRoleName } from "./store.js";

export type RoleName = DefaultRoleName;

/** Lower index = higher privilege. */
const ROLE_ORDER: readonly RoleName[] = ["root", "admin", "operator", "viewer"] as const;

const ROLE_INDEX: Record<string, number> = Object.freeze(
    Object.fromEntries(ROLE_ORDER.map((r, i) => [r, i])),
);

/**
 * The minimal authenticated identity carried by `AuthResult.principal`.
 * Optional fields permit the legacy admin-token path to populate only what
 * it knows.
 */
export interface IamPrincipal {
    /** Stable user id, or `"_admin"` for the legacy admin-token path. */
    userId: string;
    /** Tenant scope; `"default"` for non-tenanted deployments. */
    tenantId: string;
    /** Granted role names. Order does not matter — we take the highest. */
    roles: RoleName[];
    /** How this identity was authenticated. */
    source: "admin_token" | "api_key" | "sso_session" | "scim";
    /** Email, when known. */
    email?: string;
    /** Free-form attributes (claims from IdP, etc.). */
    attrs?: Record<string, unknown>;
}

/** True iff `held` outranks or equals `required` in the role hierarchy. */
export function roleAtLeast(held: string, required: RoleName): boolean {
    const heldIdx = ROLE_INDEX[held];
    const reqIdx = ROLE_INDEX[required];
    if (heldIdx === undefined || reqIdx === undefined) return false;
    return heldIdx <= reqIdx;
}

/** True iff the principal holds at least the required role. */
export function principalHasRole(principal: IamPrincipal | undefined | null, required: RoleName): boolean {
    if (!principal) return false;
    for (const r of principal.roles) {
        if (roleAtLeast(r, required)) return true;
    }
    return false;
}

/**
 * Return the highest role held by the principal (lowest ROLE_ORDER index),
 * or `null` if the principal has no recognised roles.
 */
export function highestRole(principal: IamPrincipal | undefined | null): RoleName | null {
    if (!principal) return null;
    let best: number | null = null;
    for (const r of principal.roles) {
        const idx = ROLE_INDEX[r];
        if (idx === undefined) continue;
        if (best === null || idx < best) best = idx;
    }
    return best === null ? null : ROLE_ORDER[best]!;
}

/** Throw a typed error when the principal does not satisfy `required`. */
export class RbacError extends Error {
    readonly statusCode = 403;
    readonly code = "forbidden";
    constructor(message: string, readonly required: RoleName, readonly held: readonly string[]) {
        super(message);
        this.name = "RbacError";
    }
}

/** Imperative guard. Throws `RbacError` when the principal is insufficient. */
export function requireRole(principal: IamPrincipal | undefined | null, required: RoleName): void {
    if (!principal) {
        throw new RbacError("authentication required", required, []);
    }
    if (!principalHasRole(principal, required)) {
        throw new RbacError(
            `role '${required}' or higher required`,
            required,
            principal.roles,
        );
    }
}

/**
 * Build the synthetic principal for the legacy single-admin-token auth path.
 * Returned for every successful admin-token check so downstream code can
 * uniformly call `requireRole(principal, "...")` regardless of whether IAM
 * is enabled.
 */
export function adminTokenPrincipal(tenantId = "default"): IamPrincipal {
    return {
        userId: "_admin",
        tenantId,
        roles: ["root"],
        source: "admin_token",
    };
}

/** Public accessor for tests / introspection. */
export function listRoleNames(): readonly RoleName[] {
    return ROLE_ORDER;
}
