/**
 * PRISM Enterprise IAM — OIDC provider (Phase H-2)
 *
 * Implements the OAuth 2.0 Authorization-Code flow with PKCE plus OpenID
 * Connect ID-token verification. No new external dependencies — uses
 * `node:crypto` for SHA-256, RSA-SHA256 verify, and the random nonce.
 *
 * The fetcher is injected so tests can drive the entire flow without
 * touching the network. Production callers pass `globalThis.fetch`.
 *
 * Only RS256 + ES256 ID-tokens are accepted. HMAC-signed (`HS256`)
 * tokens are deliberately rejected — those would let the IdP and the SP
 * share a symmetric key, which is fragile in practice.
 *
 * Scope of v1 (deliberate trim, will grow as needed):
 *   - Authorization-Code with PKCE (S256). No implicit / hybrid flow.
 *   - JWKS fetched from the discovery doc; `kid` mandatory if jwks has
 *     multiple keys.
 *   - `iss`, `aud`, `exp`, `iat`, `nonce` validation.
 *   - `email` and `sub` extraction; everything else surfaced as `attrs`.
 *   - Refresh-token rotation NOT yet plumbed through (sessions are
 *     short-lived; re-login is the recovery path in v1).
 */

import { createHash, createPublicKey, createVerify, randomBytes } from "node:crypto";

export type FetchFn = typeof fetch;

export interface OidcConfig {
    /** OIDC discovery URL — usually `<issuer>/.well-known/openid-configuration`. */
    discoveryUrl: string;
    /** Registered client id at the IdP. */
    clientId: string;
    /** Registered client secret. Optional for public clients (PKCE-only). */
    clientSecret?: string;
    /** Redirect URI registered with the IdP. */
    redirectUri: string;
    /** Scopes to request (space-separated). Defaults to `openid email profile`. */
    scopes?: string;
    /** Override fetcher (tests). Defaults to global `fetch`. */
    fetcher?: FetchFn;
    /** Override clock (tests). Returns epoch seconds. */
    nowSeconds?: () => number;
}

export interface OidcDiscoveryDoc {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
    userinfo_endpoint?: string;
}

export interface OidcAuthRequestState {
    state: string;
    nonce: string;
    codeVerifier: string;
    codeChallenge: string;
}

export interface OidcVerifiedIdentity {
    /** Stable subject id from the IdP. */
    sub: string;
    /** Email when present in the ID token / userinfo. */
    email?: string;
    /** Display name fallback chain: `name` → `preferred_username` → `email` → `sub`. */
    displayName?: string;
    /** Issuer that signed the ID token. */
    issuer: string;
    /** Full set of claims for downstream attribute mapping. */
    claims: Record<string, unknown>;
}

export class OidcError extends Error {
    constructor(message: string, readonly code: string = "oidc_error") {
        super(message);
        this.name = "OidcError";
    }
}

export class OidcProvider {
    private discoveryCache: { doc: OidcDiscoveryDoc; fetchedAt: number } | null = null;
    private jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
    private readonly fetcher: FetchFn;
    private readonly nowSeconds: () => number;

    constructor(private readonly config: OidcConfig) {
        this.fetcher = config.fetcher ?? (globalThis.fetch as FetchFn);
        if (typeof this.fetcher !== "function") {
            throw new OidcError("global fetch is not available; pass `fetcher` explicitly", "missing_fetcher");
        }
        this.nowSeconds = config.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    }

    /**
     * Build the authorization URL plus the per-flow state we need to keep
     * server-side until the callback. The caller stores `state` (keyed by
     * the random `state` value or by session) and presents it back when
     * the IdP redirects to `redirect_uri`.
     */
    async beginAuth(): Promise<{ url: string; state: OidcAuthRequestState }> {
        const doc = await this.discovery();
        const codeVerifier = base64UrlEncode(randomBytes(48));
        const codeChallenge = base64UrlEncode(sha256(codeVerifier));
        const state: OidcAuthRequestState = {
            state: randomBytes(16).toString("hex"),
            nonce: randomBytes(16).toString("hex"),
            codeVerifier,
            codeChallenge,
        };
        const params = new URLSearchParams({
            response_type: "code",
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            scope: this.config.scopes ?? "openid email profile",
            state: state.state,
            nonce: state.nonce,
            code_challenge: state.codeChallenge,
            code_challenge_method: "S256",
        });
        return { url: `${doc.authorization_endpoint}?${params.toString()}`, state };
    }

    /** Exchange an authorization code for an ID token and verify it. */
    async completeAuth(input: {
        code: string;
        state: OidcAuthRequestState;
    }): Promise<OidcVerifiedIdentity> {
        const doc = await this.discovery();
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            code: input.code,
            redirect_uri: this.config.redirectUri,
            client_id: this.config.clientId,
            code_verifier: input.state.codeVerifier,
        });
        if (this.config.clientSecret) body.set("client_secret", this.config.clientSecret);

        const tokenRes = await this.fetcher(doc.token_endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body: body.toString(),
        });
        if (!tokenRes.ok) {
            const text = await safeText(tokenRes);
            throw new OidcError(`token endpoint returned ${tokenRes.status}: ${text}`, "token_exchange_failed");
        }
        const tokenJson = await tokenRes.json() as { id_token?: string };
        const idToken = tokenJson.id_token;
        if (!idToken || typeof idToken !== "string") {
            throw new OidcError("token endpoint did not return id_token", "missing_id_token");
        }
        return await this.verifyIdToken(idToken, { expectedNonce: input.state.nonce });
    }

    /**
     * Verify an ID token signature + standard claims. Exported as a public
     * method so tests can exercise the verification path directly.
     */
    async verifyIdToken(
        idToken: string,
        opts: { expectedNonce?: string } = {},
    ): Promise<OidcVerifiedIdentity> {
        const doc = await this.discovery();
        const parts = idToken.split(".");
        if (parts.length !== 3) throw new OidcError("malformed id_token", "malformed_jwt");
        const headerJson = parseJsonOrThrow(base64UrlDecodeToString(parts[0]));
        const payloadJson = parseJsonOrThrow(base64UrlDecodeToString(parts[1]));
        const sig = Buffer.from(parts[2], "base64url");

        const alg = String(headerJson["alg"] ?? "");
        if (alg !== "RS256" && alg !== "ES256") {
            throw new OidcError(`unsupported alg: ${alg}`, "unsupported_alg");
        }

        const jwk = await this.resolveJwk(headerJson["kid"] as string | undefined);
        const pubKey = createPublicKey({ key: jwk as never, format: "jwk" });
        const verifier = createVerify(alg === "RS256" ? "RSA-SHA256" : "sha256");
        verifier.update(`${parts[0]}.${parts[1]}`);
        verifier.end();
        const ok = verifier.verify(pubKey, sig);
        if (!ok) throw new OidcError("invalid id_token signature", "invalid_signature");

        const claims = payloadJson as Record<string, unknown>;
        const now = this.nowSeconds();
        if (claims["iss"] !== doc.issuer) {
            throw new OidcError(`issuer mismatch: got ${String(claims["iss"])}, expected ${doc.issuer}`, "iss_mismatch");
        }
        const aud = claims["aud"];
        const audOk = aud === this.config.clientId
            || (Array.isArray(aud) && aud.includes(this.config.clientId));
        if (!audOk) throw new OidcError("aud mismatch", "aud_mismatch");
        const exp = Number(claims["exp"]);
        if (!Number.isFinite(exp) || exp < now) throw new OidcError("id_token expired", "expired");
        const iat = Number(claims["iat"]);
        if (!Number.isFinite(iat) || iat > now + 300) {
            throw new OidcError("id_token issued in the future", "iat_in_future");
        }
        if (opts.expectedNonce !== undefined && claims["nonce"] !== opts.expectedNonce) {
            throw new OidcError("nonce mismatch", "nonce_mismatch");
        }
        const sub = claims["sub"];
        if (typeof sub !== "string" || sub.length === 0) {
            throw new OidcError("missing sub claim", "missing_sub");
        }
        const email = typeof claims["email"] === "string" ? (claims["email"] as string) : undefined;
        const displayName = (typeof claims["name"] === "string" && claims["name"])
            || (typeof claims["preferred_username"] === "string" && claims["preferred_username"])
            || email
            || sub;
        return {
            sub,
            email,
            displayName: String(displayName),
            issuer: doc.issuer,
            claims,
        };
    }

    private async discovery(): Promise<OidcDiscoveryDoc> {
        const TTL = 10 * 60; // 10 minutes
        const now = this.nowSeconds();
        if (this.discoveryCache && now - this.discoveryCache.fetchedAt < TTL) {
            return this.discoveryCache.doc;
        }
        const res = await this.fetcher(this.config.discoveryUrl, { method: "GET" });
        if (!res.ok) {
            throw new OidcError(`discovery fetch failed: ${res.status}`, "discovery_failed");
        }
        const doc = await res.json() as OidcDiscoveryDoc;
        for (const k of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
            if (typeof doc[k] !== "string") {
                throw new OidcError(`discovery doc missing field: ${k}`, "discovery_invalid");
            }
        }
        this.discoveryCache = { doc, fetchedAt: now };
        return doc;
    }

    private async resolveJwk(kid: string | undefined): Promise<JsonWebKey> {
        const TTL = 10 * 60;
        const now = this.nowSeconds();
        if (!this.jwksCache || now - this.jwksCache.fetchedAt >= TTL) {
            const doc = await this.discovery();
            const res = await this.fetcher(doc.jwks_uri, { method: "GET" });
            if (!res.ok) throw new OidcError(`jwks fetch failed: ${res.status}`, "jwks_failed");
            const jwks = await res.json() as { keys?: JsonWebKey[] };
            if (!Array.isArray(jwks.keys)) throw new OidcError("jwks invalid", "jwks_invalid");
            this.jwksCache = { keys: jwks.keys, fetchedAt: now };
        }
        const keys = this.jwksCache.keys;
        if (kid) {
            const match = keys.find((k) => (k as JsonWebKey & { kid?: string }).kid === kid);
            if (match) return match;
            throw new OidcError(`no jwks key matches kid=${kid}`, "kid_unknown");
        }
        if (keys.length === 1) return keys[0];
        throw new OidcError("kid required when jwks has multiple keys", "kid_required");
    }
}

function sha256(input: string | Buffer): Buffer {
    return createHash("sha256").update(input).digest();
}

function base64UrlEncode(buf: Buffer): string {
    return buf.toString("base64url");
}

function base64UrlDecodeToString(s: string): string {
    return Buffer.from(s, "base64url").toString("utf-8");
}

function parseJsonOrThrow(s: string): Record<string, unknown> {
    try {
        const obj = JSON.parse(s);
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
            throw new Error("not an object");
        }
        return obj as Record<string, unknown>;
    } catch (e) {
        throw new OidcError(`malformed JSON segment: ${(e as Error).message}`, "malformed_jwt");
    }
}

async function safeText(res: Response): Promise<string> {
    try { return (await res.text()).slice(0, 500); } catch { return ""; }
}
