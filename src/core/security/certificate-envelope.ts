/**
 * Canonical Certificate Envelope v1.0 — Phase 1 Trust Root Repair (IC-04, IC-09, IC-14)
 *
 * Defines the structured JSON envelope for PRISM Initialization Certificates.
 * Enforces exact `format: "prism-initialization-certificate"` and `version: "1.0"`.
 * Binds the complete required identity tuple:
 *   - Operator Email & Display Name
 *   - CAC Main Agent Email & Display Name
 *   - Optional Location Name
 * Binds governance provenance digests:
 *   - PAD (Platform Accountability Directive) SHA-256 digest
 *   - Canonical Covenant version & digest
 * Binds workspace metadata & issuer key fingerprint.
 *
 * Cryptographic signature is computed over the deterministic JCS (RFC 8785)
 * canonical JSON string of the envelope object.
 *
 * @module core/security/certificate-envelope
 */

export interface InitializationCertificateEnvelopeV1 {
    /** Format discriminator — MUST be exactly "prism-initialization-certificate". */
    readonly format: "prism-initialization-certificate";
    /** Schema version — MUST be exactly "1.0". */
    readonly version: "1.0";
    /** Deterministic issuer key ID (SHA-256 hex fingerprint prefix). */
    readonly issuerKeyId: string;
    /** Sequence number for lifetime certificate order (1-indexed). */
    readonly sequence: number;
    /** ISO-8601 timestamp when this certificate was issued. */
    readonly createdAt: string;

    /** Required Identity Tuple (IC-04) */
    readonly identity: {
        /** Operator email address (normalized lowercase). */
        readonly operatorEmail: string;
        /** Operator human-readable display name. */
        readonly operatorName: string;
        /** CAC Main Agent email address (durable assistant email). */
        readonly cacEmail: string;
        /** CAC Main Agent human-readable display name. */
        readonly cacName: string;
        /** Optional operator-defined location context (e.g., "Desktop", "Dept"). */
        readonly locationName: string | null;
    };

    /** Governance & Runtime Provenance Digests (IC-08, IC-14) */
    readonly provenance: {
        /** SHA-256 hex digest of the boot Platform Accountability Directive (PAD), or null if absent. */
        readonly padDigest: string | null;
        /** Version string of the active Sacred Covenant (e.g. "1.0"). */
        readonly covenantVersion: string;
        /** SHA-256 hex digest of the active Sacred Covenant text. */
        readonly covenantDigest: string;
        /** Active workspace root path. */
        readonly workspaceRoot: string;
    };
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

export function validateCertificateEnvelopeV1(envelope: unknown): string[] {
    const errors: string[] = [];
    if (!envelope || typeof envelope !== "object") return ["Envelope must be an object"];
    const candidate = envelope as Partial<InitializationCertificateEnvelopeV1>;
    if (candidate.format !== "prism-initialization-certificate") errors.push("Unsupported certificate format");
    if (candidate.version !== "1.0") errors.push("Unsupported certificate version");
    if (typeof candidate.issuerKeyId !== "string" || candidate.issuerKeyId.trim() === "") {
        errors.push("issuerKeyId is required");
    }
    if (!Number.isInteger(candidate.sequence) || Number(candidate.sequence) < 1) {
        errors.push("sequence must be a positive integer");
    }
    if (typeof candidate.createdAt !== "string" || !Number.isFinite(Date.parse(candidate.createdAt))) {
        errors.push("createdAt must be an ISO-8601 timestamp");
    }

    const identity = candidate.identity;
    if (!identity || typeof identity !== "object") {
        errors.push("identity is required");
    } else {
        if (typeof identity.operatorEmail !== "string" || identity.operatorEmail.trim() === "") {
            errors.push("identity.operatorEmail is required");
        } else if (identity.operatorEmail !== identity.operatorEmail.toLowerCase()) {
            errors.push("identity.operatorEmail must be normalized lowercase");
        }
        if (typeof identity.operatorName !== "string" || identity.operatorName.trim() === "") {
            errors.push("identity.operatorName is required");
        }
        if (typeof identity.cacEmail !== "string" || identity.cacEmail.trim() === "") {
            errors.push("identity.cacEmail is required");
        } else if (identity.cacEmail !== identity.cacEmail.toLowerCase()) {
            errors.push("identity.cacEmail must be normalized lowercase");
        }
        if (typeof identity.cacName !== "string" || identity.cacName.trim() === "") {
            errors.push("identity.cacName is required");
        }
        if (identity.locationName !== null && typeof identity.locationName !== "string") {
            errors.push("identity.locationName must be a string or null");
        }
    }

    const provenance = candidate.provenance;
    if (!provenance || typeof provenance !== "object") {
        errors.push("provenance is required");
    } else {
        if (provenance.padDigest !== null && !SHA256_HEX_PATTERN.test(String(provenance.padDigest))) {
            errors.push("provenance.padDigest must be a SHA-256 digest or null");
        }
        if (typeof provenance.covenantVersion !== "string" || provenance.covenantVersion.trim() === "") {
            errors.push("provenance.covenantVersion is required");
        }
        if (!SHA256_HEX_PATTERN.test(String(provenance.covenantDigest))) {
            errors.push("provenance.covenantDigest must be a SHA-256 digest");
        }
        if (typeof provenance.workspaceRoot !== "string" || provenance.workspaceRoot.trim() === "") {
            errors.push("provenance.workspaceRoot is required");
        }
    }
    return errors;
}

/**
 * Deterministically serialize a JavaScript object according to JCS rules (RFC 8785):
 * - Keys are sorted lexicographically by UTF-16 code units.
 * - Whitespace is minimized (no indentation or spaces around colons/commas).
 * - Numbers and strings follow standard JSON stringification rules.
 */
export function serializeCanonicalCertificate(envelope: InitializationCertificateEnvelopeV1): string {
    return stringifyCanonical(envelope);
}

function stringifyCanonical(val: unknown): string {
    if (val === null || typeof val !== "object") {
        return JSON.stringify(val);
    }

    if (Array.isArray(val)) {
        const items = val.map((item) => stringifyCanonical(item));
        return `[${items.join(",")}]`;
    }

    const obj = val as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const pairs = sortedKeys.map((key) => `${JSON.stringify(key)}:${stringifyCanonical(obj[key])}`);
    return `{${pairs.join(",")}}`;
}

const CERT_MARKER_START = "```json:prism-certificate-v1";
const CERT_MARKER_END = "```";
const SIG_MARKER = "## Cryptographic Signature Verification";

/**
 * Render a human-readable Markdown certificate document containing the
 * embedded canonical JSON envelope and the cryptographic signature block.
 */
export function generateMarkdownCertificateV1(
    envelope: InitializationCertificateEnvelopeV1,
    signatureBase64: string,
    publicKeyBase64: string,
): string {
    const prettyJson = JSON.stringify(envelope, null, 2);

    return `# PRISM System Initialization Certificate (v1.0)

> **IMMUTABLE SECURITY CERTIFICATE — DO NOT EDIT OR DELETE**
> This certificate binds the Operator and CAC Main Agent identity tuple to this PRISM runtime instance.

## Identity & Governance Binding

- **Operator Email:** \`${envelope.identity.operatorEmail}\`
- **Operator Name:** ${envelope.identity.operatorName}
- **CAC Main Agent Email:** \`${envelope.identity.cacEmail}\`
- **CAC Main Agent Name:** ${envelope.identity.cacName}
- **Location Context:** ${envelope.identity.locationName || "Not Specified"}
- **Issuer Key ID:** \`${envelope.issuerKeyId}\`
- **Issued At:** ${envelope.createdAt}

## System Integrity Provenance

- **Workspace Root:** \`${envelope.provenance.workspaceRoot}\`
- **Covenant Version:** ${envelope.provenance.covenantVersion} (\`${envelope.provenance.covenantDigest.slice(0, 12)}...\`)
- **PAD Boot Digest:** ${envelope.provenance.padDigest ? `\`${envelope.provenance.padDigest.slice(0, 12)}...\`` : "None"}

## Machine-Readable Envelope (Canonical v1.0)

${CERT_MARKER_START}
${prettyJson}
${CERT_MARKER_END}

${SIG_MARKER}

- **Protocol Version:** ${envelope.version}
- **Format:** ${envelope.format}
- **Public Key:** ${publicKeyBase64}
- **Signature:** ${signatureBase64}
`;
}

export interface ParsedCertificateV1 {
    envelope: InitializationCertificateEnvelopeV1;
    signatureBase64: string;
    publicKeyBase64: string;
    canonicalPayload: string;
}

/**
 * Parse a Markdown certificate document and extract the structured envelope
 * and signature details. Returns null if the Markdown does not match v1.0 format.
 */
export function parseCertificateEnvelopeV1(markdown: string): ParsedCertificateV1 | null {
    try {
        // Extract embedded JSON block
        const jsonMatch = /```json:prism-certificate-v1\s*\n([\s\S]*?)\n```/.exec(markdown);
        if (!jsonMatch) {
            // Fallback: try parsing generic ```json block if marked as prism-certificate
            const genericMatch = /```json\s*\n(\{[\s\S]*?"format":\s*"prism-initialization-certificate"[\s\S]*?\})\n```/.exec(markdown);
            if (!genericMatch) return null;
            return parseFromRawJson(genericMatch[1]!, markdown);
        }
        return parseFromRawJson(jsonMatch[1]!, markdown);
    } catch {
        return null;
    }
}

function parseFromRawJson(jsonStr: string, markdown: string): ParsedCertificateV1 | null {
    const rawObj = JSON.parse(jsonStr) as InitializationCertificateEnvelopeV1;

    if (validateCertificateEnvelopeV1(rawObj).length > 0) return null;

    // Extract signature section
    const pubKeyMatch = /- \*\*Public Key:\*\* ([A-Za-z0-9+/=]+)/.exec(markdown);
    const sigMatch = /- \*\*Signature:\*\* ([A-Za-z0-9+/=]+)/.exec(markdown);

    if (!pubKeyMatch || !sigMatch) {
        return null;
    }

    const publicKeyBase64 = pubKeyMatch[1]!;
    const signatureBase64 = sigMatch[1]!;

    // Compute canonical JCS string over the parsed envelope object
    const canonicalPayload = serializeCanonicalCertificate(rawObj);

    return {
        envelope: rawObj,
        signatureBase64,
        publicKeyBase64,
        canonicalPayload,
    };
}
