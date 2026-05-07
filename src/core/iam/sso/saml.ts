/**
 * PRISM Enterprise IAM — SAML 2.0 SP scaffold (Phase H-2)
 *
 * **Scope trim:** A safe, audit-grade SAML SP requires XML-DSig with
 * canonicalisation (Exclusive C14N) which is non-trivial to implement
 * correctly without a battle-tested library, and we hold a strict
 * "no new external runtime dependencies" rule across this workstream.
 *
 * For Phase H-2 we ship the **interface scaffold** so the dashboard
 * routes can be uniform across OIDC and SAML, plus the AuthnRequest
 * generator which is purely outbound and does not require signature
 * verification. The full SAMLResponse signature-verification path is
 * deliberately deferred to a follow-up sub-phase (H-2.1) and currently
 * returns `SamlError("not_implemented")`.
 *
 * Operators that need SSO today should use the OIDC path, which is
 * fully functional.
 */

import { randomBytes } from "node:crypto";

export interface SamlConfig {
    /** SP entity id (URN). */
    entityId: string;
    /** ACS (assertion-consumer-service) URL where the IdP POSTs the response. */
    acsUrl: string;
    /** IdP single sign-on URL (where AuthnRequest is sent). */
    idpSsoUrl: string;
    /** PEM-encoded IdP signing certificate. Required when verification is enabled. */
    idpSigningCertPem?: string;
    /** Override id factory (tests). */
    idFactory?: () => string;
}

export interface SamlAuthnRequestState {
    requestId: string;
    relayState: string;
    issuedAt: string;
}

export interface SamlVerifiedIdentity {
    /** SAML NameID. */
    nameId: string;
    /** Email when present in attributes. */
    email?: string;
    /** Display name fallback. */
    displayName?: string;
    /** All attribute statements as a flat map. */
    attributes: Record<string, string | string[]>;
}

export class SamlError extends Error {
    constructor(message: string, readonly code: string = "saml_error") {
        super(message);
        this.name = "SamlError";
    }
}

export class SamlProvider {
    private readonly idFactory: () => string;

    constructor(private readonly config: SamlConfig) {
        this.idFactory = config.idFactory ?? (() => `_${randomBytes(16).toString("hex")}`);
    }

    /**
     * Build a SAML AuthnRequest for the configured IdP. Returns the redirect
     * URL the browser should be sent to plus the state we must persist
     * server-side until the IdP POSTs back to the ACS.
     *
     * The request is unsigned in v1; signed AuthnRequests are deferred
     * with the verification work.
     */
    beginAuth(): { url: string; state: SamlAuthnRequestState } {
        const requestId = this.idFactory();
        const issuedAt = new Date().toISOString();
        const relayState = randomBytes(16).toString("hex");
        const xml = [
            `<?xml version="1.0" encoding="UTF-8"?>`,
            `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"`,
            ` xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"`,
            ` ID="${requestId}" Version="2.0" IssueInstant="${issuedAt}"`,
            ` Destination="${escapeAttr(this.config.idpSsoUrl)}"`,
            ` AssertionConsumerServiceURL="${escapeAttr(this.config.acsUrl)}"`,
            ` ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">`,
            `<saml:Issuer>${escapeText(this.config.entityId)}</saml:Issuer>`,
            `</samlp:AuthnRequest>`,
        ].join("");
        const encoded = Buffer.from(xml, "utf-8").toString("base64");
        const params = new URLSearchParams({
            SAMLRequest: encoded,
            RelayState: relayState,
        });
        return {
            url: `${this.config.idpSsoUrl}?${params.toString()}`,
            state: { requestId, relayState, issuedAt },
        };
    }

    /**
     * Verify a SAMLResponse and extract the authenticated identity.
     *
     * Deferred to follow-up sub-phase H-2.1. Currently throws so the
     * route layer surfaces a typed `not_implemented` envelope.
     */
    completeAuth(_input: { samlResponse: string; state: SamlAuthnRequestState }): SamlVerifiedIdentity {
        throw new SamlError(
            "SAML response verification is not yet implemented in this build (Phase H-2.1). " +
            "Use the OIDC provider, which is fully supported.",
            "not_implemented",
        );
    }
}

function escapeText(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
    return escapeText(s).replace(/"/g, "&quot;");
}
