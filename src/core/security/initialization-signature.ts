import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { workspacePath } from "../config/workspace-resolver.js";
import {
    loadOrCreateRegistry,
    saveRegistry,
    registerKey,
    revokeKey,
    getActiveKey,
    computeKeyFingerprint,
    isKeyTrusted,
} from "./key-registry.js";
import { protectPrivateKeyPEM, unprotectPrivateKeyPEM } from "./dpapi-key-store.js";
import {
    type InitializationCertificateEnvelopeV1,
    serializeCanonicalCertificate,
    generateMarkdownCertificateV1,
    parseCertificateEnvelopeV1,
} from "./certificate-envelope.js";

export interface InitializationKeyPair {
    privateKeyPem: string;
    publicKeyBase64: string;
}

const KEYS_FILE_NAME = "initialization_keys.json";
const KEYS_ENC_FILE_NAME = "initialization_keys.enc";

/**
 * Retrieve or generate the system-unique Ed25519 keypair for the Initialization Certificate.
 * Keys are DPAPI-encrypted on Windows (`initialization_keys.enc`).
 *
 * Phase 0 & Phase 1 security rules (IC-01, IC-12):
 *   - Malformed key material fails closed instead of silently regenerating.
 *   - On Windows, private keys are DPAPI-encrypted on disk.
 *   - New keys are registered in the issuer key registry.
 */
export function getOrGenerateKeyPair(): InitializationKeyPair {
    const configDir = process.env.PRISM_CONFIG_DIR?.trim() || workspacePath("config");
    const encPath = join(configDir, KEYS_ENC_FILE_NAME);
    const keysPath = join(configDir, KEYS_FILE_NAME);

    if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
    }

    // 1. Try loading DPAPI-protected key file if present
    if (existsSync(encPath)) {
        try {
            const rawEnc = readFileSync(encPath, "utf-8");
            const parsed = JSON.parse(rawEnc) as { ciphertextPem: string; publicKeyBase64: string };
            const decryptedPem = unprotectPrivateKeyPEM(parsed.ciphertextPem);

            createPrivateKey(decryptedPem); // Validate key load

            const pair: InitializationKeyPair = { privateKeyPem: decryptedPem, publicKeyBase64: parsed.publicKeyBase64 };

            const registry = loadOrCreateRegistry();
            registerKey(registry, pair.publicKeyBase64);
            saveRegistry(registry);

            return pair;
        } catch (err) {
            const forensicPath = encPath + `.corrupt.${Date.now()}`;
            try { copyFileSync(encPath, forensicPath); } catch {}
            throw new KeyMaterialError(
                `Failed to load DPAPI key store (${(err as Error).message}). ` +
                `Original file preserved at ${forensicPath}.`,
                encPath,
            );
        }
    }

    // 2. Legacy raw JSON key file check & auto-migration to DPAPI
    if (existsSync(keysPath)) {
        try {
            const raw = readFileSync(keysPath, "utf-8");
            const parsed = JSON.parse(raw) as InitializationKeyPair;

            if (!parsed.privateKeyPem || !parsed.publicKeyBase64) {
                throw new KeyMaterialError("Malformed key material: missing privateKeyPem or publicKeyBase64", keysPath);
            }

            createPrivateKey(parsed.privateKeyPem);

            // Auto-migrate to DPAPI encrypted format
            const ciphertextPem = protectPrivateKeyPEM(parsed.privateKeyPem);
            writeFileSync(encPath, JSON.stringify({ ciphertextPem, publicKeyBase64: parsed.publicKeyBase64 }, null, 2) + "\n", "utf-8");
            restrictKeyFileACL(encPath);

            const registry = loadOrCreateRegistry();
            registerKey(registry, parsed.publicKeyBase64);
            saveRegistry(registry);

            return parsed;
        } catch (err) {
            if (err instanceof KeyMaterialError) throw err;
            const forensicPath = keysPath + `.corrupt.${Date.now()}`;
            try { copyFileSync(keysPath, forensicPath); } catch {}
            throw new KeyMaterialError(
                `Failed to parse initialization keys (${(err as Error).message}). File preserved at ${forensicPath}.`,
                keysPath,
            );
        }
    }

    // 3. Generate a new Ed25519 key pair
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

    // Save encrypted key
    const ciphertextPem = protectPrivateKeyPEM(privateKeyPem);
    writeFileSync(encPath, JSON.stringify({ ciphertextPem, publicKeyBase64 }, null, 2) + "\n", "utf-8");
    restrictKeyFileACL(encPath);

    const registry = loadOrCreateRegistry();
    registerKey(registry, publicKeyBase64);
    saveRegistry(registry);

    return { privateKeyPem, publicKeyBase64 };
}

/**
 * Sign raw content bytes/string using the active issuer key.
 */
export function signCertificateContent(content: string): { signatureBase64: string; publicKeyBase64: string } {
    const { privateKeyPem, publicKeyBase64 } = getOrGenerateKeyPair();
    const key = createPrivateKey(privateKeyPem);
    const data = Buffer.from(content, "utf-8");
    const signature = sign(null, data, key);
    return {
        signatureBase64: signature.toString("base64"),
        publicKeyBase64,
    };
}

/**
 * Verify raw signature over arbitrary string content.
 */
export function verifyCertificateContent(content: string, signatureBase64: string, publicKeyBase64: string): boolean {
    try {
        const der = Buffer.from(publicKeyBase64, "base64");
        const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
        const signature = Buffer.from(signatureBase64, "base64");
        const data = Buffer.from(content, "utf-8");
        return verify(null, data, publicKey, signature);
    } catch (err) {
        console.warn("[PRISM][security] Certificate verification failed with error:", err);
        return false;
    }
}

export interface IssueCertificateParams {
    operatorEmail: string;
    operatorName: string;
    cacEmail: string;
    cacName: string;
    locationName?: string | null;
    workspaceRoot: string;
    padDigest?: string | null;
    covenantVersion?: string;
    covenantDigest?: string;
    sequence?: number;
}

/**
 * IC-04, IC-09, IC-14: Issue a canonical v1.0 Initialization Certificate.
 * Binds complete identity tuple, governance digests, workspace root, and issuer key fingerprint.
 * Signs the JCS RFC 8785 deterministic JSON canonical payload.
 */
export function issueCertificateV1(params: IssueCertificateParams): {
    markdown: string;
    envelope: InitializationCertificateEnvelopeV1;
    signatureBase64: string;
    publicKeyBase64: string;
} {
    const { publicKeyBase64 } = getOrGenerateKeyPair();
    const issuerKeyId = computeKeyFingerprint(publicKeyBase64).slice(0, 16);

    const envelope: InitializationCertificateEnvelopeV1 = {
        format: "prism-initialization-certificate",
        version: "1.0",
        issuerKeyId,
        sequence: params.sequence ?? 1,
        createdAt: new Date().toISOString(),
        identity: {
            operatorEmail: params.operatorEmail.trim().toLowerCase(),
            operatorName: params.operatorName.trim(),
            cacEmail: params.cacEmail.trim().toLowerCase(),
            cacName: params.cacName.trim(),
            locationName: params.locationName ? params.locationName.trim() : null,
        },
        provenance: {
            padDigest: params.padDigest ?? null,
            covenantVersion: params.covenantVersion ?? "1.0",
            covenantDigest: params.covenantDigest ?? "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            workspaceRoot: params.workspaceRoot,
        },
    };

    const canonicalPayload = serializeCanonicalCertificate(envelope);
    const { signatureBase64 } = signCertificateContent(canonicalPayload);
    const markdown = generateMarkdownCertificateV1(envelope, signatureBase64, publicKeyBase64);

    return {
        markdown,
        envelope,
        signatureBase64,
        publicKeyBase64,
    };
}

/**
 * IC-04, IC-09: Verify a canonical v1.0 Markdown certificate.
 * Checks signature over the canonical JCS payload and verifies key trust in key registry.
 */
export function verifyCertificateV1(markdown: string): {
    valid: boolean;
    trusted: boolean;
    envelope: InitializationCertificateEnvelopeV1 | null;
    reason: string;
} {
    const parsed = parseCertificateEnvelopeV1(markdown);
    if (!parsed) {
        // Fallback to legacy markdown verification if not v1.0 envelope
        const legacyValid = verifyMarkdownCertificate(markdown);
        return {
            valid: legacyValid,
            trusted: false,
            envelope: null,
            reason: legacyValid
                ? "Legacy v0 certificate signature valid, but lacks structured v1.0 envelope (IC-09)"
                : "Failed to parse certificate envelope and legacy signature verification failed",
        };
    }

    // 1. Verify signature over canonical payload
    const sigValid = verifyCertificateContent(
        parsed.canonicalPayload,
        parsed.signatureBase64,
        parsed.publicKeyBase64,
    );

    if (!sigValid) {
        return {
            valid: false,
            trusted: false,
            envelope: parsed.envelope,
            reason: "Ed25519 signature over canonical payload failed verification",
        };
    }

    // 2. Verify key trust in registry
    let registry;
    try {
        registry = loadOrCreateRegistry();
    } catch {
        return {
            valid: true,
            trusted: false,
            envelope: parsed.envelope,
            reason: "Signature valid, but key registry could not be loaded",
        };
    }

    const trustResult = isKeyTrusted(registry, parsed.publicKeyBase64);
    return {
        valid: true,
        trusted: trustResult.trusted,
        envelope: parsed.envelope,
        reason: trustResult.reason,
    };
}

/**
 * Legacy markdown verification helper (maintained for backwards compatibility with v0 certs).
 */
export function verifyMarkdownCertificate(fullMarkdown: string): boolean {
    const splitMarker = "## Cryptographic Signature Verification";
    const parts = fullMarkdown.split(splitMarker);
    if (parts.length !== 2) return false;

    const certContentToSign = parts[0]!.trim();
    const signatureSection = parts[1]!;

    const pubKeyMatch = /- \*\*Public Key:\*\* ([A-Za-z0-9+/=]+)/.exec(signatureSection);
    const sigMatch = /- \*\*Signature:\*\* ([A-Za-z0-9+/=]+)/.exec(signatureSection);

    if (!pubKeyMatch || !sigMatch) return false;

    return verifyCertificateContent(certContentToSign, sigMatch[1]!, pubKeyMatch[1]!);
}

/**
 * Pinned legacy verification helper.
 */
export function verifyMarkdownCertificateWithPin(fullMarkdown: string): {
    valid: boolean;
    trusted: boolean;
    reason: string;
} {
    const v1Result = verifyCertificateV1(fullMarkdown);
    if (v1Result.envelope) {
        return { valid: v1Result.valid, trusted: v1Result.trusted, reason: v1Result.reason };
    }

    const legacyValid = verifyMarkdownCertificate(fullMarkdown);
    if (!legacyValid) {
        return { valid: false, trusted: false, reason: "Signature verification failed" };
    }

    const pubKeyMatch = /- \*\*Public Key:\*\* ([A-Za-z0-9+/=]+)/.exec(fullMarkdown);
    if (!pubKeyMatch) return { valid: true, trusted: false, reason: "Valid legacy signature, key unknown" };

    const registry = loadOrCreateRegistry();
    const trust = isKeyTrusted(registry, pubKeyMatch[1]!);
    return { valid: true, trusted: trust.trusted, reason: trust.reason };
}

export class KeyMaterialError extends Error {
    constructor(message: string, public readonly keyFilePath: string) {
        super(message);
        this.name = "KeyMaterialError";
    }
}

function restrictKeyFileACL(filePath: string): void {
    if (process.platform !== "win32") return;
    try {
        const { execSync } = require("node:child_process");
        execSync(`icacls "${filePath}" /inheritance:r`, { stdio: "pipe" });
        const username = process.env.USERNAME || process.env.USER || "";
        if (username) {
            execSync(`icacls "${filePath}" /grant "${username}:(R,W)"`, { stdio: "pipe" });
        }
    } catch {}
}
