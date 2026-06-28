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

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ActivityBus } from "../../activity/bus.js";
import { URL } from "node:url";
import type { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import { SessionManager } from "../../iam/sso/session.js";
import { IamStore, type IamUser } from "../../iam/store.js";
import { adminTokenPrincipal, type IamPrincipal, type RoleName } from "../../iam/rbac.js";
import { OidcConfig, OidcProvider, OidcError, OidcVerifiedIdentity, type OidcAuthRequestState } from "../../iam/sso/oidc.js";
import { SamlProvider, SamlError, type SamlAuthnRequestState } from "../../iam/sso/saml.js";
import type { CacProvider, CacAuthRequest, CacSecurityLevel, CacOperatorPrivilege } from "../../iam/cac/types.js";
import type { SecureOperatorSessionManager, SecureOperatorSessionOptions } from "../secure-operator-session-manager.js";
import { SecureComputerUseTool } from "../../../adapters/system/secure-computer-use-tool.js";
import { SecureBrowserControlTool } from "../../../adapters/system/secure-browser-control-tool.js";

interface PendingFlow {
    kind: "oidc" | "saml";
    tenantId: string;
    /** OIDC: state+nonce+code_verifier+code_challenge.  SAML: requestId+relayState+issuedAt. */
    state: OidcAuthRequestState | SamlAuthnRequestState;
    createdAt: number;
}

const FLOW_COOKIE = "prism_sso_flow";
const FLOW_TTL_MS = 15 * 60 * 1000;

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
    /** CAC provider for secure operator authentication */
    cacProvider?: CacProvider;
    /** Secure operator session manager */
    secureOperatorSessionManager?: SecureOperatorSessionManager;
    /** ActivityBus for auth telemetry — events flow to Logs & Debug tab. */
    activityBus?: ActivityBus;
}

export function isEnterpriseIamEnabled(): boolean {
    return true;
}

export class IamRouteHandler implements IRouteHandler {
    private readonly store: IamStore;
    private readonly sessions: SessionManager;
    private readonly defaultTenantId: string;
    private readonly oidcFactory: (configId: string) => OidcProvider;
    private readonly publicBaseUrl: string;
    private readonly cacProvider?: CacProvider;
    private readonly secureOperatorSessionManager?: SecureOperatorSessionManager;
    private readonly pendingFlows = new Map<string, PendingFlow>();
    private readonly activityBus?: ActivityBus;

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
        this.cacProvider = opts.cacProvider;
        this.secureOperatorSessionManager = opts.secureOperatorSessionManager;
        this.activityBus = opts.activityBus;

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
    getSessions(): SessionManager { return this.sessions; }

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
            // POST /api/iam/login
            if (path === "/api/iam/login" && method === "POST") {
                return await this.handleLocalLogin(req, res, _service);
            }
            // GET /api/iam/me
            if (path === "/api/iam/me" && method === "GET") {
                return this.handleMe(req, res);
            }
            // POST /api/iam/logout
            if (path === "/api/iam/logout" && method === "POST") {
                return await this.handleLogout(req, res, _service);
            }

            // CAC Authentication Routes
            // POST /api/iam/cac/auth
            if (path === "/api/iam/cac/auth" && method === "POST") {
                return await this.handleCacAuth(req, res);
            }
            // GET /api/iam/cac/session/:sessionId
            if (path.startsWith("/api/iam/cac/session/") && method === "GET") {
                const sessionId = path.split("/")[5];
                return this.handleGetCacSession(sessionId, res);
            }
            // POST /api/iam/cac/session/:sessionId/terminate
            if (path.match(/^\/api\/iam\/cac\/session\/[^/]+\/terminate$/) && method === "POST") {
                const sessionId = path.split("/")[5];
                return await this.handleTerminateCacSession(sessionId, req, res);
            }
            // GET /api/iam/cac/sessions
            if (path === "/api/iam/cac/sessions" && method === "GET") {
                return this.handleListCacSessions(res);
            }
            // POST /api/iam/cac/emergency-shutdown
            if (path === "/api/iam/cac/emergency-shutdown" && method === "POST") {
                return await this.handleCacEmergencyShutdown(req, res);
            }
            // POST /api/iam/cac/execute/computer
            if (path === "/api/iam/cac/execute/computer" && method === "POST") {
                return await this.handleSecureToolExecute(req, res, _service, "computer");
            }
            // POST /api/iam/cac/execute/browser
            if (path === "/api/iam/cac/execute/browser" && method === "POST") {
                return await this.handleSecureToolExecute(req, res, _service, "browser");
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

    private async handleLogout(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const principal = this.resolvePrincipalFromCookie(req);
        const cookieValue = this.sessions.readCookie(req);
        this.sessions.revoke(cookieValue);
        this.sessions.clearCookie(res);

        // Disconnect Gmail and Outlook integrations
        try {
            if (typeof service.getGmailOAuth === "function") {
                await service.getGmailOAuth().disconnect();
            }
        } catch (err) {
            console.error("[PRISM][logout] Error disconnecting Gmail:", err);
        }
        try {
            if (typeof service.getOutlookOAuth === "function") {
                await service.getOutlookOAuth().disconnect();
            }
        } catch (err) {
            console.error("[PRISM][logout] Error disconnecting Outlook:", err);
        }

        // Close all active browser sessions
        try {
            if (service && Array.isArray(service.tools)) {
                const browserTool = service.tools.find(t => t.name === "browser_control") as any;
                const mgr = browserTool?.getManager();
                if (mgr) {
                    await mgr.closeAll();
                }
            }
        } catch (err) {
            console.error("[PRISM][logout] Error closing browser sessions:", err);
        }

        this.emitAuthEvent("iam.logout", "succeeded", {
            email: principal?.email ?? "unknown",
            userId: principal?.userId,
            message: `Operator ${principal?.email ?? "unknown"} logged out`,
        }, undefined, principal?.email, principal?.userId);
        res.statusCode = 204;
        res.end();
    }

    private async handleLocalLogin(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const loginStartMs = Date.now();
        let bodyText = "";
        for await (const chunk of req) bodyText += chunk;
        const parsed = JSON.parse(bodyText) as { email?: string; password?: string; tenantId?: string };
        const tenantId = parsed.tenantId ?? this.defaultTenantId;
        const email = String(parsed.email ?? "").trim().toLowerCase();
        const password = String(parsed.password ?? "").trim();
        if (!email || !password) {
            this.emitAuthEvent("iam.login.rejected", "failed", { email: email || "(empty)", reason: "missing_credentials" });
            return this.json(res, 400, { error: { code: "invalid_credentials", message: "Email and password required" } });
        }

        const user = this.store.getUserByEmail(tenantId, email);
        if (!user) {
            this.emitAuthEvent("iam.login.failed", "failed", { email, reason: "user_not_found", tenantId });
            return this.json(res, 401, { error: { code: "unauthorized", message: "Invalid credentials" } });
        } else {
            const storedHash = String(user.attrs?.passwordHash ?? "");
            const sha256Hex = (str: string) => createHash("sha256").update(str, "utf-8").digest("hex");
            if (storedHash && storedHash !== sha256Hex(password)) {
                this.emitAuthEvent("iam.login.failed", "failed", { email, reason: "invalid_password", userId: user.id, tenantId });
                return this.json(res, 401, { error: { code: "unauthorized", message: "Invalid credentials" } });
            }
            if (!storedHash) {
                user.attrs = { ...user.attrs, passwordHash: sha256Hex(password) };
                this.store.updateUserAttrs(user.id, user.attrs);
                this.emitAuthEvent("iam.login.password_set", "succeeded", { email, userId: user.id, message: "Initial password hash stored" });
            }
        }

        if (user.status !== "active") {
            this.emitAuthEvent("iam.login.blocked", "failed", { email, reason: "account_inactive", userId: user.id, status: user.status });
            return this.json(res, 403, { error: { code: "account_inactive", message: "Operator account is not active" } });
        }

        const { cookie, session } = this.sessions.issue(user.id, tenantId);
        this.sessions.writeCookie(res, cookie);

        const durationMs = Date.now() - loginStartMs;
        const roles = this.store.listRoleNamesForUser(user.id, tenantId);
        this.emitAuthEvent("iam.login.success", "succeeded", {
            email, userId: user.id, tenantId,
            roles: roles.join(", "),
            displayName: user.displayName,
            sessionId: session.id,
            message: `Operator ${email} authenticated successfully`,
        }, durationMs, user.email, user.id);

        // ── Post-login: claim orphan Initialization Certificate sessions ──
        // The wizard creates an Init Certificate session before the operator
        // has logged in, so it may have operator_email = null or a placeholder
        // like 'operator@prism.local'. We only claim the MOST RECENT orphan
        // certificate created within 24h — older certificates belong to the
        // operator who originally ran that wizard and are part of their
        // provenance chain.
        try {
            const chatStore = service.getChatStore();
            const allSessions = chatStore.listSessions();
            const now = Date.now();
            const CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

            // Find orphan Init Certificate sessions within the claim window,
            // sorted by creation time (most recent first).
            const claimable = allSessions
                .filter(s => {
                    const isInitCert = /Initialization Certificate/i.test(s.title || "");
                    const isOrphan = !s.operatorEmail
                        || s.operatorEmail === "operator@prism.local"
                        || s.operatorEmail === "not set";
                    const age = now - new Date(s.createdAt).getTime();
                    return isInitCert && isOrphan && age < CLAIM_WINDOW_MS;
                })
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

            // Claim only the most recent one — it's the certificate from
            // the wizard run that preceded this login.
            if (claimable.length > 0) {
                const target = claimable[0]!;
                chatStore.updateSessionOperatorEmail(target.sessionId, email);
                this.emitAuthEvent("iam.login.session_claimed", "succeeded", {
                    email, sessionId: target.sessionId,
                    previousEmail: target.operatorEmail || "(none)",
                    message: `Claimed Initialization Certificate session for provenance chain`,
                });
            }
        } catch (claimErr) {
            // Non-fatal — session claiming must not block login
            console.warn("[PRISM][login] Failed to claim Init Certificate sessions:", claimErr);
        }

        // ── Post-login: apply wizard LLM provider preferences ─────────────
        // The wizard saves activeLlmProviderId and activeLlmModel to preferences.
        // Apply them at login so the dashboard shows the correct provider.
        try {
            const { readPreferences } = await import("../../config/workspace-resolver.js");
            const prefs = readPreferences();
            if (prefs?.activeLlmProviderId) {
                const llm = service.getLlmProviderManager();
                if (llm.activeProviderId !== prefs.activeLlmProviderId
                    || (prefs.activeLlmModel && llm.activeModel !== prefs.activeLlmModel)) {
                    await llm.setActiveSelection(
                        prefs.activeLlmProviderId,
                        prefs.activeLlmModel ?? undefined,
                    );
                    this.emitAuthEvent("iam.login.llm_restored", "succeeded", {
                        email,
                        providerId: prefs.activeLlmProviderId,
                        model: prefs.activeLlmModel ?? "(default)",
                        message: `Restored LLM provider from wizard preferences`,
                    });
                }
            }
        } catch (llmErr) {
            // Non-fatal — provider restore must not block login
            console.warn("[PRISM][login] Failed to restore LLM preferences:", llmErr);
        }

        // Return the dashboard auth token so the login page can redirect
        // to /dashboard?token=<token> for the initial authenticated load.
        const dashboardToken = service.getAuthGate().getToken();
        return this.json(res, 200, { ok: true, user, session, dashboardToken });
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

    // CAC Authentication Handler Methods

    private async handleCacAuth(req: IncomingMessage, res: ServerResponse): Promise<void> {
        if (!this.cacProvider || !this.secureOperatorSessionManager) {
            return this.json(res, 501, {
                error: {
                    code: "cac_not_configured",
                    message: "CAC authentication not available"
                }
            });
        }

        try {
            const body = await this.readRequestBody(req);
            const authRequest: CacAuthRequest = JSON.parse(body);

            // Validate required fields
            if (!authRequest.clientIp || !authRequest.tenantId || !authRequest.securityLevel || !authRequest.operatorPrivilege) {
                return this.json(res, 400, {
                    error: {
                        code: "invalid_request",
                        message: "Missing required fields: clientIp, tenantId, securityLevel, operatorPrivilege"
                    }
                });
            }

            const sessionOptions: SecureOperatorSessionOptions = {
                sessionType: authRequest.sessionType || "full_control",
                securityLevel: authRequest.securityLevel as CacSecurityLevel,
                operatorPrivilege: authRequest.operatorPrivilege as CacOperatorPrivilege,
                characterId: authRequest.characterId,
                metadata: authRequest.metadata
            };

            const session = await this.secureOperatorSessionManager.createSession(authRequest, sessionOptions);

            return this.json(res, 200, {
                success: true,
                sessionId: session.sessionId,
                sessionType: session.sessionType,
                expiresAt: session.expiresAt,
                securityLevel: session.securityConstraints.level,
                privilegeLevel: session.securityConstraints.privilege,
                allowedOperations: session.securityConstraints.allowedOperations
            });

        } catch (error) {
            console.error("CAC authentication error:", error);
            this.emitAuthEvent("iam.cac.auth.failed", "failed", {
                reason: error instanceof Error ? error.message : "Authentication failed",
            });
            return this.json(res, 400, {
                error: {
                    code: "authentication_failed",
                    message: error instanceof Error ? error.message : "Authentication failed"
                }
            });
        }
    }

    private handleGetCacSession(sessionId: string, res: ServerResponse): void {
        if (!this.secureOperatorSessionManager) {
            return this.json(res, 501, {
                error: {
                    code: "cac_not_configured",
                    message: "CAC session management not available"
                }
            });
        }

        const session = this.secureOperatorSessionManager.getSession(sessionId);
        if (!session) {
            return this.json(res, 404, {
                error: {
                    code: "session_not_found",
                    message: `Session not found: ${sessionId}`
                }
            });
        }

        return this.json(res, 200, {
            sessionId: session.sessionId,
            sessionType: session.sessionType,
            status: session.status,
            createdAt: session.createdAt,
            lastActivityAt: session.lastActivityAt,
            expiresAt: session.expiresAt,
            securityLevel: session.securityConstraints.level,
            privilegeLevel: session.securityConstraints.privilege,
            allowedOperations: session.securityConstraints.allowedOperations,
            operatorEmail: session.cacSession.certificateInfo.email,
            characterId: session.cacSession.characterId
        });
    }

    private async handleTerminateCacSession(sessionId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
        if (!this.secureOperatorSessionManager) {
            return this.json(res, 501, {
                error: {
                    code: "cac_not_configured",
                    message: "CAC session management not available"
                }
            });
        }

        try {
            const body = await this.readRequestBody(req);
            const { reason } = JSON.parse(body);

            await this.secureOperatorSessionManager.terminateSession(sessionId, reason || "Manual termination");

            return this.json(res, 200, {
                success: true,
                message: `Session ${sessionId} terminated successfully`
            });

        } catch (error) {
            console.error(`Error terminating CAC session ${sessionId}:`, error);
            return this.json(res, 400, {
                error: {
                    code: "termination_failed",
                    message: error instanceof Error ? error.message : "Failed to terminate session"
                }
            });
        }
    }

    private handleListCacSessions(res: ServerResponse): void {
        if (!this.secureOperatorSessionManager) {
            return this.json(res, 501, {
                error: {
                    code: "cac_not_configured",
                    message: "CAC session management not available"
                }
            });
        }

        const sessions = this.secureOperatorSessionManager.listSessions();
        const sessionSummaries = sessions.map(session => ({
            sessionId: session.sessionId,
            sessionType: session.sessionType,
            status: session.status,
            createdAt: session.createdAt,
            lastActivityAt: session.lastActivityAt,
            expiresAt: session.expiresAt,
            securityLevel: session.securityConstraints.level,
            privilegeLevel: session.securityConstraints.privilege,
            operatorEmail: session.cacSession.certificateInfo.email,
            characterId: session.cacSession.characterId
        }));

        return this.json(res, 200, {
            sessions: sessionSummaries,
            totalCount: sessions.length
        });
    }

    private async handleCacEmergencyShutdown(req: IncomingMessage, res: ServerResponse): Promise<void> {
        if (!this.secureOperatorSessionManager) {
            return this.json(res, 501, { error: { code: "cac_not_configured", message: "CAC session management not available" } });
        }

        try {
            const body = await this.readRequestBody(req);
            const { reason } = JSON.parse(body);

            if (!reason) {
                return this.json(res, 400, { error: { code: "invalid_request", message: "Emergency shutdown reason is required" } });
            }

            await this.secureOperatorSessionManager.emergencyShutdown(reason);

            return this.json(res, 200, {
                success: true,
                message: "Emergency shutdown executed successfully"
            });
        } catch (error) {
            return this.json(res, 500, { error: { code: "shutdown_failed", message: error instanceof Error ? error.message : "Emergency shutdown failed" } });
        }
    }

    private async handleSecureToolExecute(req: IncomingMessage, res: ServerResponse, service: DashboardService, toolType: "computer" | "browser"): Promise<void> {
        if (!this.secureOperatorSessionManager) {
            return this.json(res, 501, { error: { code: "cac_not_configured", message: "CAC session management not available" } });
        }

        try {
            const bodyText = await this.readRequestBody(req);
            const requestPayload = JSON.parse(bodyText);

            if (!requestPayload || !requestPayload.args || !requestPayload.args.operatorSessionId) {
                return this.json(res, 400, { error: { code: "invalid_request", message: "Missing args or operatorSessionId" } });
            }

            const activityBus = service.getActivityBus();
            let result;

            if (toolType === "computer") {
                const tool = new SecureComputerUseTool({
                    sessionManager: this.secureOperatorSessionManager,
                    activityBus
                });
                result = await tool.execute(requestPayload);
            } else {
                const tool = new SecureBrowserControlTool({
                    sessionManager: this.secureOperatorSessionManager,
                    activityBus
                });
                result = await tool.execute(requestPayload);
            }

            return this.json(res, 200, result);
        } catch (error) {
            console.error(`Secure ${toolType} tool execution error:`, error);
            return this.json(res, 500, { error: { code: "tool_execution_failed", message: error instanceof Error ? error.message : "Tool execution failed" } });
        }
    }

    // ── Auth Telemetry Helpers ────────────────────────────────────────────

    /** Emit an authentication event to the ActivityBus → Logs & Debug tab. */
    private emitAuthEvent(
        operation: string,
        status: "started" | "succeeded" | "failed",
        details: Record<string, unknown>,
        durationMs?: number,
        operatorEmail?: string | null,
        operatorId?: string | null,
    ): void {
        if (!this.activityBus) return;
        try {
            this.activityBus.emit({
                sessionId: "auth",
                layer: "governance",
                operation,
                status,
                details: { ...details, source: "auth" },
                durationMs,
                operatorEmail: operatorEmail ?? undefined,
                operatorId: operatorId ?? undefined,
            });
        } catch { /* swallow — telemetry must never break auth */ }
    }

    private readRequestBody(req: IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                resolve(body);
            });
            req.on('error', reject);
        });
    }
}

function randomShortId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
