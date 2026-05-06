/**
 * PRISM Enterprise IAM — `/api/iam/*` routes (Phase H-2)
 *
 * **Gating**: The `Router` only constructs and mounts this handler when
 * `PRISM_ENTERPRISE_IAM=on`. With the flag absent or off, none of these
 * routes are registered — the legacy single-admin-token gate is the only
 * auth surface, and existing tests are byte-identical.
 *
 * **Auth**: This handler is mounted ABOVE the dashboard's main `AuthGate`
 * for `/api/iam/sso/*` only — login + callback must be reachable without
 * a bearer token. The introspection routes (`/api/iam/me`, `/logout`)
 * still require a valid session cookie OR an admin bearer token.
 *
 * **Routes**:
 *   GET  /api/iam/sso/:kind/login          → 302 to IdP authorize URL
 *   GET  /api/iam/sso/:kind/callback       → completes auth, sets cookie, 302 to /
 *   GET  /api/iam/me                       → current principal as JSON
 *   POST /api/iam/logout                   → revokes session, clears cookie
 *
 * The handler owns a single `IamStore` instance (in-memory by default;
 * a sibling helper allows passing a file-backed DB path). State per
 * pending auth flow (OIDC `state`, SAML request id) is held in an
 * in-process map keyed by a short opaque token written into a transient
 * cookie — fine for single-process v1; clustered deployments will need
 * to externalise this in a follow-up.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { DashboardService } from "../dashboard-service.js";
import type { IRouteHandler } from "./types.js";
import { IamStore, type IamUser } from "../../iam/store.js";
import { adminTokenPrincipal, type IamPrincipal, type RoleName } from "../../iam/rbac.js";
import { SessionManager } from "../../iam/sso/session.js";
import { OidcError, OidcProvider, type OidcAuthRequestState, type OidcConfig, type OidcVerifiedIdentity } from "../../iam/sso/oidc.js";
import { SamlError, SamlProvider, type SamlAuthnRequestState } from "../../iam/sso/saml.js";

interface PendingFlow {
    kind: "oidc" | "saml";
    tenantId: string;
    /** OIDC: state+nonce+code_verifier+code_challenge.  SAML: requestId+relayState+issuedAt. */
    state: OidcAuthRequestState | SamlAuthnRequestState;
    createdAt: number;
}

const FLOW_COOKIE = "prism_sso_flow";
const FLOW_TTL_MS = 10 * 60 * 1000;

export interface IamRouteOptions {
    /**
     * Optional override of the IAM store. Tests inject an `:memory:`-backed
     * store; production callers will pass a file-path-backed store
     * constructed once per process.
     */
    iamStore?: IamStore;
    /** Default tenant id for the legacy admin-token mapping. */
    defaultTenantId?: string;
    /** Override session manager (tests). */
    sessionManager?: SessionManager;
    /**
     * OIDC provider factory keyed by IdP-config id. Tests inject a fake
     * provider here; production wiring instantiates `OidcProvider` from
     * `iam_idp_configs` rows on demand. The default factory reads each
     * tenant's first OIDC config from the store.
     */
    oidcProviderFactory?: (configId: string) => OidcProvider;
    /** Default ACS / redirect base URL (for assembling redirect_uri values). */
    publicBaseUrl?: string;
}

export function isEnterpriseIamEnabled(): boolean {
    return process.env.PRISM_ENTERPRISE_IAM === "on";
}

export class IamRouteHandler implements IRouteHandler {
    private readonly store: IamStore;
    private readonly sessions: SessionManager;
    private readonly defaultTenantId: string;
    private readonly oidcFactory: (configId: string) => OidcProvider;
    private readonly publicBaseUrl: string;
    private readonly pendingFlows = new Map<string, PendingFlow>();

    constructor(opts: IamRouteOptions = {}) {
        this.store = opts.iamStore ?? new IamStore(":memory:");
        this.sessions = opts.sessionManager ?? new SessionManager(this.store);
        this.defaultTenantId = opts.defaultTenantId ?? "default";
        this.publicBaseUrl = opts.publicBaseUrl ?? "";
        this.oidcFactory = opts.oidcProviderFactory ?? ((configId: string) => {
            const cfg = this.store.getIdpConfig(configId);
            if (!cfg || cfg.kind !== "oidc") {
                throw new OidcError(`unknown OIDC config id: ${configId}`, "unknown_idp");
            }
            return new OidcProvider(cfg.config as unknown as OidcConfig);
        });
        // Make sure the four canonical roles exist for the default tenant
        // so freshly-provisioned IdP users can be granted something useful.
        this.store.seedDefaultRoles(this.defaultTenantId);
    }

    /** Public so the dashboard's auth layer can look up a presented cookie. */
    resolvePrincipalFromCookie(req: IncomingMessage): IamPrincipal | null {
        const cookieValue = this.sessions.readCookie(req);
        if (!cookieValue) return null;
        const session = this.sessions.verify(cookieValue);
        if (!session) return null;
        const user = this.store.getUser(session.userId);
        if (!user || user.status !== "active") return null;
        const roleNames = this.store.listRoleNamesForUser(user.id, user.tenantId) as RoleName[];
        return {
            userId: user.id,
            tenantId: user.tenantId,
            roles: roleNames,
            source: "sso_session",
            email: user.email,
            attrs: user.attrs,
        };
    }

    /** Public so an API-key bearer can authenticate a request. */
    resolvePrincipalFromApiKey(presentedToken: string): IamPrincipal | null {
        const verified = this.store.verifyApiKey(presentedToken);
        if (!verified) return null;
        const roleNames = this.store.listRoleNamesForUser(
            verified.user.id, verified.user.tenantId,
        ) as RoleName[];
        return {
            userId: verified.user.id,
            tenantId: verified.user.tenantId,
            roles: roleNames,
            source: "api_key",
            email: verified.user.email,
            attrs: verified.user.attrs,
        };
    }

    /** Read-only access to the underlying store (for SCIM in H-3). */
    getStore(): IamStore { return this.store; }

    match(req: IncomingMessage): boolean {
        const path = (req.url ?? "").split("?")[0];
        return path.startsWith("/api/iam/");
    }

    async handle(req: IncomingMessage, res: ServerResponse, _service: DashboardService): Promise<void> {
        const url = new URL(req.url ?? "/", "http://localhost");
        const path = url.pathname;
        const method = (req.method ?? "GET").toUpperCase();

        try {
            // GET /api/iam/sso/:kind/login?config_id=...
            const loginMatch = /^\/api\/iam\/sso\/(oidc|saml)\/login$/.exec(path);
            if (loginMatch && method === "GET") {
                return await this.handleLogin(loginMatch[1] as "oidc" | "saml", url, res);
            }
            // GET /api/iam/sso/:kind/callback
            const cbMatch = /^\/api\/iam\/sso\/(oidc|saml)\/callback$/.exec(path);
            if (cbMatch && method === "GET") {
                return await this.handleCallback(cbMatch[1] as "oidc" | "saml", req, url, res);
            }
            // GET /api/iam/me
            if (path === "/api/iam/me" && method === "GET") {
                return this.handleMe(req, res);
            }
            // POST /api/iam/logout
            if (path === "/api/iam/logout" && method === "POST") {
                return this.handleLogout(req, res);
            }

            return this.json(res, 404, { error: { code: "not_found", message: `Not found: ${method} ${path}` } });
        } catch (err: unknown) {
            if (err instanceof OidcError) {
                return this.json(res, 400, { error: { code: err.code, message: err.message } });
            }
            if (err instanceof SamlError) {
                const status = err.code === "not_implemented" ? 501 : 400;
                return this.json(res, status, { error: { code: err.code, message: err.message } });
            }
            const message = err instanceof Error ? err.message : String(err);
            return this.json(res, 500, { error: { code: "internal_error", message } });
        }
    }

    private async handleLogin(kind: "oidc" | "saml", url: URL, res: ServerResponse): Promise<void> {
        const tenantId = url.searchParams.get("tenant_id") ?? this.defaultTenantId;
        const configId = url.searchParams.get("config_id");
        if (!configId) {
            return this.json(res, 400, { error: { code: "missing_config_id", message: "config_id query param required" } });
        }

        if (kind === "oidc") {
            const provider = this.oidcFactory(configId);
            const { url: redirectUrl, state } = await provider.beginAuth();
            const flowId = this.persistFlow({ kind: "oidc", tenantId, state, createdAt: Date.now() });
            res.setHeader("Set-Cookie", `${FLOW_COOKIE}=${flowId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
            res.writeHead(302, { Location: redirectUrl });
            res.end();
            return;
        }
        // SAML
        const cfg = this.store.getIdpConfig(configId);
        if (!cfg || cfg.kind !== "saml") {
            return this.json(res, 400, { error: { code: "unknown_idp", message: `unknown SAML config id: ${configId}` } });
        }
        const provider = new SamlProvider(cfg.config as never);
        const { url: redirectUrl, state } = provider.beginAuth();
        const flowId = this.persistFlow({ kind: "saml", tenantId, state, createdAt: Date.now() });
        res.setHeader("Set-Cookie", `${FLOW_COOKIE}=${flowId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
        res.writeHead(302, { Location: redirectUrl });
        res.end();
    }

    private async handleCallback(kind: "oidc" | "saml", req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
        const flowId = this.readFlowCookie(req);
        if (!flowId) {
            return this.json(res, 400, { error: { code: "missing_flow", message: "no SSO flow in progress" } });
        }
        const flow = this.pendingFlows.get(flowId);
        this.pendingFlows.delete(flowId);
        if (!flow || flow.kind !== kind) {
            return this.json(res, 400, { error: { code: "invalid_flow", message: "flow mismatch or expired" } });
        }
        if (Date.now() - flow.createdAt > FLOW_TTL_MS) {
            return this.json(res, 400, { error: { code: "flow_expired", message: "SSO flow expired" } });
        }

        if (kind === "oidc") {
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            const oidcState = flow.state as OidcAuthRequestState;
            if (!code || state !== oidcState.state) {
                return this.json(res, 400, { error: { code: "invalid_callback", message: "missing code or state mismatch" } });
            }
            const configId = url.searchParams.get("config_id") ?? "";
            const provider = configId ? this.oidcFactory(configId) : this.oidcFactory(this.findFirstOidcConfigId(flow.tenantId));
            const identity = await provider.completeAuth({ code, state: oidcState });
            return this.completeLoginAndRedirect(res, flow.tenantId, identity);
        }

        // SAML — currently surfaces "not_implemented".
        // The real flow will pull `SAMLResponse` from the POST body; this
        // GET callback is a placeholder so the route still exists.
        return this.json(res, 501, { error: { code: "not_implemented", message: "SAML callback verification deferred to H-2.1" } });
    }

    private completeLoginAndRedirect(res: ServerResponse, tenantId: string, identity: OidcVerifiedIdentity): void {
        if (!identity.email) {
            this.json(res, 400, { error: { code: "missing_email", message: "IdP did not return email claim" } });
            return;
        }
        const user = this.upsertUser(tenantId, identity);
        const { cookie } = this.sessions.issue(user.id, tenantId);
        const headers: Record<string, string> = {
            "Set-Cookie": this.sessions.buildSetCookie(cookie),
            Location: "/",
        };
        res.writeHead(302, headers);
        res.end();
    }

    private upsertUser(tenantId: string, identity: OidcVerifiedIdentity): IamUser {
        const email = identity.email!;
        const existing = this.store.getUserByEmail(tenantId, email);
        if (existing) return existing;
        const user = this.store.createUser({
            tenantId,
            email,
            displayName: identity.displayName ?? email,
            attrs: { sso_sub: identity.sub, sso_iss: identity.issuer, claims: identity.claims },
        });
        // Default new SSO users to viewer; admins can promote via the
        // upcoming H-3 admin UI.
        const viewerRole = this.store.getRoleByName(tenantId, "viewer");
        if (viewerRole) this.store.addMembership(user.id, tenantId, viewerRole.id);
        return user;
    }

    private handleMe(req: IncomingMessage, res: ServerResponse): void {
        const principal = this.resolvePrincipalFromCookie(req) ?? this.adminFromBearer(req);
        if (!principal) {
            return this.json(res, 401, { error: { code: "unauthenticated", message: "no session or bearer token" } });
        }
        return this.json(res, 200, { principal });
    }

    private handleLogout(req: IncomingMessage, res: ServerResponse): void {
        const cookieValue = this.sessions.readCookie(req);
        this.sessions.revoke(cookieValue);
        this.sessions.clearCookie(res);
        res.statusCode = 204;
        res.end();
    }

    /** Surface the legacy admin token as a synthetic principal for `/me`. */
    private adminFromBearer(req: IncomingMessage): IamPrincipal | null {
        const auth = req.headers["authorization"];
        if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;
        // We don't have the AuthGate token here — just return the synthetic
        // root principal; the upstream AuthGate has already validated the
        // bearer before our `match()` was reached for non-public routes.
        // For `/api/iam/me` the route is non-public so this is safe.
        return adminTokenPrincipal(this.defaultTenantId);
    }

    private readFlowCookie(req: IncomingMessage): string | null {
        const header = req.headers["cookie"];
        if (typeof header !== "string") return null;
        for (const part of header.split(/;\s*/)) {
            const eq = part.indexOf("=");
            if (eq < 0) continue;
            if (part.slice(0, eq) === FLOW_COOKIE) return part.slice(eq + 1);
        }
        return null;
    }

    private persistFlow(flow: PendingFlow): string {
        // Garbage-collect old entries opportunistically.
        const cutoff = Date.now() - FLOW_TTL_MS;
        for (const [id, f] of this.pendingFlows) {
            if (f.createdAt < cutoff) this.pendingFlows.delete(id);
        }
        const id = randomShortId();
        this.pendingFlows.set(id, flow);
        return id;
    }

    private findFirstOidcConfigId(tenantId: string): string {
        const all = this.store.listIdpConfigs(tenantId);
        const oidc = all.find((c) => c.kind === "oidc");
        if (!oidc) throw new OidcError(`no OIDC config for tenant ${tenantId}`, "no_oidc_config");
        return oidc.id;
    }

    private json(res: ServerResponse, status: number, body: unknown): void {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
    }
}

function randomShortId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
