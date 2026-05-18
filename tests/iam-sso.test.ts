/**
 * Tests for the Phase H-2 IAM SSO + session layer.
 *
 * Covers:
 *  - SessionManager: cookie sign / verify, tamper rejection, secret rotation
 *    invalidates old cookies, revoke flow, dev/prod Secure flag.
 *  - OidcProvider: PKCE auth-URL shape, ID-token verify against an injected
 *    fetcher serving discovery + JWKS + token endpoint, tampered signature
 *    rejection, expired-token rejection, nonce-mismatch rejection.
 *  - SamlProvider: AuthnRequest shape; completeAuth currently throws
 *    `not_implemented` (deferred to Phase H-2.1).
 *  - IamRouteHandler end-to-end: /sso/oidc/login → 302, /callback sets a
 *    session cookie, /me returns the principal, /logout clears the
 *    cookie, unknown /v1 paths return 404.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";
import { ServerResponse } from "node:http";
import type { IncomingMessage } from "node:http";
import { Socket } from "node:net";

import { IamStore } from "../src/core/iam/store.js";
import { SessionManager } from "../src/core/iam/sso/session.js";
import { OidcError, OidcProvider } from "../src/core/iam/sso/oidc.js";
import { SamlError, SamlProvider } from "../src/core/iam/sso/saml.js";
import { IamRouteHandler } from "../src/core/operator/routes/iam-handler.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeReq(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
    const emitter = new EventEmitter() as IncomingMessage;
    (emitter as unknown as { method: string }).method = method;
    (emitter as unknown as { url: string }).url = url;
    (emitter as unknown as { headers: Record<string, string> }).headers = headers;
    return emitter;
}

class FakeRes extends EventEmitter {
    statusCode = 200;
    headers: Record<string, string | string[]> = {};
    body = "";
    ended = false;
    setHeader(k: string, v: string | string[]): void { this.headers[k.toLowerCase()] = v; }
    getHeader(k: string): string | string[] | undefined { return this.headers[k.toLowerCase()]; }
    writeHead(status: number, headers?: Record<string, string>): this {
        this.statusCode = status;
        if (headers) {
            for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v;
        }
        return this;
    }
    write(chunk: string): boolean { this.body += chunk; return true; }
    end(chunk?: string): this { if (chunk) this.body += chunk; this.ended = true; return this; }
}

function asRes(fake: FakeRes): ServerResponse {
    return fake as unknown as ServerResponse;
}

function base64url(buf: Buffer): string { return buf.toString("base64url"); }

interface SignedJwt {
    token: string;
    publicJwk: JsonWebKey & { kid: string };
}

function signRs256Jwt(payload: Record<string, unknown>, kid = "test-kid"): SignedJwt {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = { alg: "RS256", typ: "JWT", kid };
    const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
    const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
    const signer = createSign("RSA-SHA256");
    signer.update(`${headerB64}.${payloadB64}`);
    signer.end();
    const sig = base64url(signer.sign(privateKey));
    const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey & { kid?: string };
    publicJwk.kid = kid;
    return { token: `${headerB64}.${payloadB64}.${sig}`, publicJwk: publicJwk as JsonWebKey & { kid: string } };
}

interface MockEndpoints {
    discovery?: () => unknown;
    jwks?: () => unknown;
    token?: () => unknown;
}

function makeFetcher(endpoints: MockEndpoints): typeof fetch {
    return (async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = typeof input === "string" ? input : (input instanceof URL ? input.href : input.url);
        let body: unknown;
        if (url.endsWith("/.well-known/openid-configuration") && endpoints.discovery) body = endpoints.discovery();
        else if (url.endsWith("/jwks") && endpoints.jwks) body = endpoints.jwks();
        else if (url.endsWith("/token") && endpoints.token) body = endpoints.token();
        else {
            return new Response("not found", { status: 404 });
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
}

// ── tests ────────────────────────────────────────────────────────────────────

export async function testIamSsoSession(): Promise<void> {
    const store = new IamStore(":memory:");
    try {
        store.seedDefaultRoles("default");
        const user = store.createUser({ tenantId: "default", email: "alice@example.com" });
        const mgr = new SessionManager(store, { secret: "x".repeat(32), secure: false });

        const { cookie, session } = mgr.issue(user.id, "default", 60);
        assert.equal(typeof cookie, "string");
        assert.ok(cookie.includes(session.id));
        assert.ok(cookie.includes("."));

        const verified = mgr.verify(cookie);
        assert.ok(verified, "valid cookie verifies");
        assert.equal(verified!.userId, user.id);

        // Tampered cookie does NOT verify. Decode the signature half, flip a
        // byte, re-encode — deterministic, unlike a base64url char swap.
        const dot = cookie.lastIndexOf(".");
        const sigBuf = Buffer.from(cookie.slice(dot + 1), "base64url");
        sigBuf[0] ^= 0xff;
        const tampered = `${cookie.slice(0, dot + 1)}${sigBuf.toString("base64url")}`;
        assert.equal(mgr.verify(tampered), null, "tampered signature rejected");

        // Different secret rejects existing cookie.
        const mgrAlt = new SessionManager(store, { secret: "y".repeat(32), secure: false });
        assert.equal(mgrAlt.verify(cookie), null, "secret rotation invalidates cookie");

        // Set-Cookie shape includes HttpOnly + SameSite + Path
        const setCookieDev = mgr.buildSetCookie(cookie, 60);
        assert.ok(setCookieDev.includes("HttpOnly"));
        assert.ok(setCookieDev.includes("SameSite=Lax"));
        assert.ok(setCookieDev.includes("Path=/"));
        assert.ok(!setCookieDev.includes("Secure"), "secure=false override drops Secure flag");

        const mgrSecure = new SessionManager(store, { secret: "x".repeat(32), secure: true });
        assert.ok(mgrSecure.buildSetCookie("v", 60).includes("Secure"));

        // revoke deletes the underlying session row
        mgr.revoke(cookie);
        assert.equal(mgr.verify(cookie), null, "revoked session no longer verifies");

        // empty / malformed cookie values
        assert.equal(mgr.verify(""), null);
        assert.equal(mgr.verify(null), null);
        assert.equal(mgr.verify("no-dot-anywhere"), null);
    } finally {
        store.close();
    }
}

export async function testIamSsoOidc(): Promise<void> {
    const issuer = "https://idp.example.com";
    const audience = "test-client";
    // Generate a key + sign a valid id_token.
    const valid = signRs256Jwt({
        iss: issuer,
        aud: audience,
        sub: "alice-sub",
        email: "alice@example.com",
        name: "Alice",
        nonce: "n123",
        iat: Math.floor(Date.now() / 1000) - 5,
        exp: Math.floor(Date.now() / 1000) + 600,
    });
    let issuedToken: string = valid.token;
    const fetcher = makeFetcher({
        discovery: () => ({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
        }),
        jwks: () => ({ keys: [valid.publicJwk] }),
        token: () => ({ id_token: issuedToken, token_type: "Bearer" }),
    });

    const provider = new OidcProvider({
        discoveryUrl: `${issuer}/.well-known/openid-configuration`,
        clientId: audience,
        redirectUri: "http://localhost:7070/api/iam/sso/oidc/callback",
        fetcher,
    });

    // beginAuth shape
    const { url, state } = await provider.beginAuth();
    assert.ok(url.startsWith(`${issuer}/authorize?`));
    const params = new URL(url).searchParams;
    assert.equal(params.get("response_type"), "code");
    assert.equal(params.get("client_id"), audience);
    assert.equal(params.get("code_challenge_method"), "S256");
    assert.ok(params.get("code_challenge"));
    assert.ok(params.get("nonce"));
    assert.equal(params.get("state"), state.state);

    // completeAuth: the fetcher's /token returns the valid token; we set the
    // expected nonce on the state object so verification passes.
    state.nonce = "n123";
    const identity = await provider.completeAuth({ code: "fake-code", state });
    assert.equal(identity.sub, "alice-sub");
    assert.equal(identity.email, "alice@example.com");
    assert.equal(identity.displayName, "Alice");
    assert.equal(identity.issuer, issuer);

    // Tampered signature rejected. Flip the first byte of the decoded signature
    // so the change is byte-deterministic regardless of the encoded last-char
    // padding bits (otherwise the test was flaky on roughly 1/256 of runs).
    const parts = valid.token.split(".");
    const sigBytes = Buffer.from(parts[2], "base64url");
    sigBytes[0] ^= 0xff;
    const tampered = `${parts[0]}.${parts[1]}.${sigBytes.toString("base64url")}`;
    let thrown: unknown = null;
    try { await provider.verifyIdToken(tampered, { expectedNonce: "n123" }); } catch (e) { thrown = e; }
    assert.ok(thrown instanceof OidcError);
    assert.equal((thrown as OidcError).code, "invalid_signature");

    // Expired token rejected.
    const expired = signRs256Jwt({
        iss: issuer, aud: audience, sub: "x", iat: 1, exp: 2, nonce: "n123",
    });
    issuedToken = expired.token;
    // Need to also feed the matching pubkey: since we cached jwks, refresh it
    // via a fresh provider keyed to the new key.
    const fetcher2 = makeFetcher({
        discovery: () => ({
            issuer, authorization_endpoint: `${issuer}/a`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
        }),
        jwks: () => ({ keys: [expired.publicJwk] }),
        token: () => ({ id_token: expired.token }),
    });
    const provider2 = new OidcProvider({
        discoveryUrl: `${issuer}/.well-known/openid-configuration`,
        clientId: audience,
        redirectUri: "http://localhost/cb",
        fetcher: fetcher2,
    });
    let expiredErr: unknown = null;
    try { await provider2.verifyIdToken(expired.token, { expectedNonce: "n123" }); } catch (e) { expiredErr = e; }
    assert.ok(expiredErr instanceof OidcError);
    assert.equal((expiredErr as OidcError).code, "expired");

    // Nonce mismatch rejected.
    const nonceMismatch = signRs256Jwt({
        iss: issuer, aud: audience, sub: "x", nonce: "actual",
        iat: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 600,
    });
    const fetcher3 = makeFetcher({
        discovery: () => ({
            issuer, authorization_endpoint: `${issuer}/a`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
        }),
        jwks: () => ({ keys: [nonceMismatch.publicJwk] }),
    });
    const provider3 = new OidcProvider({
        discoveryUrl: `${issuer}/.well-known/openid-configuration`,
        clientId: audience,
        redirectUri: "http://localhost/cb",
        fetcher: fetcher3,
    });
    let nonceErr: unknown = null;
    try { await provider3.verifyIdToken(nonceMismatch.token, { expectedNonce: "expected" }); } catch (e) { nonceErr = e; }
    assert.ok(nonceErr instanceof OidcError);
    assert.equal((nonceErr as OidcError).code, "nonce_mismatch");
}

export async function testIamSsoSaml(): Promise<void> {
    const provider = new SamlProvider({
        entityId: "urn:prism:sp",
        acsUrl: "http://localhost:7070/api/iam/sso/saml/callback",
        idpSsoUrl: "https://idp.example.com/sso",
        idFactory: () => "_test-id-1",
    });
    const { url, state } = provider.beginAuth();
    assert.ok(url.startsWith("https://idp.example.com/sso?"));
    const params = new URL(url).searchParams;
    const samlReq = params.get("SAMLRequest");
    assert.ok(samlReq);
    const decoded = Buffer.from(samlReq!, "base64").toString("utf-8");
    assert.ok(decoded.includes("AuthnRequest"));
    assert.ok(decoded.includes("urn:prism:sp"));
    assert.ok(decoded.includes("ID=\"_test-id-1\""));
    assert.equal(state.requestId, "_test-id-1");

    let thrown: unknown = null;
    try { provider.completeAuth({ samlResponse: "irrelevant", state }); } catch (e) { thrown = e; }
    assert.ok(thrown instanceof SamlError);
    assert.equal((thrown as SamlError).code, "not_implemented");
}

export async function testIamRoutesEndToEnd(): Promise<void> {
    const store = new IamStore(":memory:");
    try {
        store.seedDefaultRoles("default");

        // Pre-seed a user that the OIDC flow will resolve to.
        const issuer = "https://idp.example.com";
        const audience = "test-client";
        const valid = signRs256Jwt({
            iss: issuer, aud: audience, sub: "bob-sub", email: "bob@example.com", name: "Bob",
            nonce: "PLACEHOLDER",
            iat: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 600,
        });
        // We re-sign the token after we know the nonce the provider generates,
        // since the route handler uses the provider's beginAuth() to choose nonce.

        // Add an IdP config to the store.
        const cfg = store.addIdpConfig("default", "oidc", {
            discoveryUrl: `${issuer}/.well-known/openid-configuration`,
            clientId: audience,
            redirectUri: "http://localhost:7070/api/iam/sso/oidc/callback",
        });

        // Build a captured-state OIDC provider so the test can re-sign the
        // id_token with the actual nonce chosen by beginAuth().
        let lastNonce = "";
        let lastState = "";
        let nextIdToken = "";
        const fetcher = makeFetcher({
            discovery: () => ({
                issuer,
                authorization_endpoint: `${issuer}/authorize`,
                token_endpoint: `${issuer}/token`,
                jwks_uri: `${issuer}/jwks`,
            }),
            jwks: () => ({ keys: [valid.publicJwk] }),
            token: () => ({ id_token: nextIdToken }),
        });
        const provider = new OidcProvider({
            discoveryUrl: `${issuer}/.well-known/openid-configuration`,
            clientId: audience,
            redirectUri: "http://localhost:7070/api/iam/sso/oidc/callback",
            fetcher,
        });
        // Wrap beginAuth to capture nonce + state and re-sign id_token.
        const realBegin = provider.beginAuth.bind(provider);
        provider.beginAuth = async () => {
            const r = await realBegin();
            lastNonce = r.state.nonce;
            lastState = r.state.state;
            const fresh = signRs256Jwt({
                iss: issuer, aud: audience, sub: "bob-sub", email: "bob@example.com", name: "Bob",
                nonce: lastNonce,
                iat: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 600,
            }, valid.publicJwk.kid);
            nextIdToken = fresh.token;
            // Re-feed jwks with this fresh key (sign uses a fresh keypair each call).
            // Replace the fetcher's jwks closure mid-flight by mutating the IIFE.
            (fetcher as unknown as { __jwks?: unknown }).__jwks = fresh.publicJwk;
            return r;
        };
        // Updated fetcher that reads __jwks after mutation.
        const dynFetcher: typeof fetch = (async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : (input instanceof URL ? input.href : input.url);
            if (url.endsWith("/.well-known/openid-configuration")) {
                return new Response(JSON.stringify({
                    issuer,
                    authorization_endpoint: `${issuer}/authorize`,
                    token_endpoint: `${issuer}/token`,
                    jwks_uri: `${issuer}/jwks`,
                }), { status: 200 });
            }
            if (url.endsWith("/jwks")) {
                const jwk = (fetcher as unknown as { __jwks?: JsonWebKey }).__jwks ?? valid.publicJwk;
                return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
            }
            if (url.endsWith("/token")) {
                return new Response(JSON.stringify({ id_token: nextIdToken }), { status: 200 });
            }
            return new Response("nf", { status: 404 });
        }) as unknown as typeof fetch;
        // Replace internal fetcher.
        (provider as unknown as { fetcher: typeof fetch }).fetcher = dynFetcher;

        const handler = new IamRouteHandler({
            iamStore: store,
            sessionManager: new SessionManager(store, { secret: "z".repeat(32), secure: false }),
            oidcProviderFactory: () => provider,
        });

        // 1. /api/iam/me without cookie or bearer → 401
        {
            const req = makeReq("GET", "/api/iam/me");
            const res = new FakeRes();
            await handler.handle(req, asRes(res), {} as never);
            assert.equal(res.statusCode, 401);
        }

        // 2. /api/iam/sso/oidc/login → 302 to IdP authorize URL + flow cookie set
        let flowCookie = "";
        {
            const req = makeReq("GET", `/api/iam/sso/oidc/login?config_id=${cfg.id}`);
            const res = new FakeRes();
            await handler.handle(req, asRes(res), {} as never);
            assert.equal(res.statusCode, 302);
            const loc = res.headers["location"] as string;
            assert.ok(loc.startsWith(`${issuer}/authorize?`), `unexpected redirect: ${loc}`);
            const setCookie = String(res.headers["set-cookie"]);
            assert.ok(setCookie.includes("prism_sso_flow="));
            flowCookie = setCookie.split("=")[1].split(";")[0];
            assert.ok(flowCookie);
            assert.ok(lastState, "captured state");
        }

        // 3. /api/iam/sso/oidc/callback?code=...&state=... → 302 / + sets prism_sso cookie
        let sessionCookie = "";
        {
            const req = makeReq(
                "GET",
                `/api/iam/sso/oidc/callback?code=fake&state=${lastState}&config_id=${cfg.id}`,
                { cookie: `prism_sso_flow=${flowCookie}` },
            );
            const res = new FakeRes();
            await handler.handle(req, asRes(res), {} as never);
            assert.equal(res.statusCode, 302, `body: ${res.body}`);
            assert.equal(res.headers["location"], "/");
            const setCookie = String(res.headers["set-cookie"]);
            assert.ok(setCookie.includes("prism_sso="), `set-cookie: ${setCookie}`);
            sessionCookie = setCookie.split("=")[1].split(";")[0];
            assert.ok(sessionCookie);
        }

        // User was upserted into the store with viewer role.
        const u = store.getUserByEmail("default", "bob@example.com");
        assert.ok(u, "user upserted");
        const roles = store.listRoleNamesForUser(u!.id, "default");
        assert.deepEqual(roles, ["viewer"], "default-grant viewer");

        // 4. /api/iam/me with the session cookie returns the principal.
        {
            const req = makeReq("GET", "/api/iam/me", { cookie: `prism_sso=${sessionCookie}` });
            const res = new FakeRes();
            await handler.handle(req, asRes(res), {} as never);
            assert.equal(res.statusCode, 200);
            const parsed = JSON.parse(res.body) as { principal: { email: string; roles: string[]; source: string } };
            assert.equal(parsed.principal.email, "bob@example.com");
            assert.deepEqual(parsed.principal.roles, ["viewer"]);
            assert.equal(parsed.principal.source, "sso_session");
        }

        // 5. /api/iam/logout clears the cookie + revokes the session.
        {
            const req = makeReq("POST", "/api/iam/logout", { cookie: `prism_sso=${sessionCookie}` });
            const res = new FakeRes();
            await handler.handle(req, asRes(res), {} as never);
            assert.equal(res.statusCode, 204);
            assert.ok(String(res.headers["set-cookie"]).includes("Max-Age=0"));
        }
        // Subsequent /me with the same cookie → 401 (session revoked).
        {
            const req = makeReq("GET", "/api/iam/me", { cookie: `prism_sso=${sessionCookie}` });
            const res = new FakeRes();
            await handler.handle(req, asRes(res), {} as never);
            assert.equal(res.statusCode, 401);
        }

        // 6. Unknown sub-route → 404.
        {
            const req = makeReq("GET", "/api/iam/nope");
            const res = new FakeRes();
            await handler.handle(req, asRes(res), {} as never);
            assert.equal(res.statusCode, 404);
        }
    } finally {
        store.close();
    }
}

// Suppress "unused" when fixtures are imported only for type-side effects.
void Socket; void createPrivateKey;
