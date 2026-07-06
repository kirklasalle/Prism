import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { workspacePath } from "../config/workspace-resolver.js";

export interface InitializationKeyPair {
    privateKeyPem: string;
    publicKeyBase64: string;
}

const KEYS_FILE_NAME = "initialization_keys.json";

/**
 * Retrieve or generate the system-unique Ed25519 keypair for the Initialization Certificate.
 * Keys are saved inside the workspace config directory under `initialization_keys.json`.
 */
export function getOrGenerateKeyPair(): InitializationKeyPair {
    const keysPath = workspacePath("config", KEYS_FILE_NAME);
    const configDir = dirname(keysPath);

    if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
    }

    if (existsSync(keysPath)) {
        try {
            const raw = readFileSync(keysPath, "utf-8");
            return JSON.parse(raw) as InitializationKeyPair;
        } catch (err) {
            console.warn("[PRISM][security] Failed to parse initialization keys, regenerating...", err);
        }
    }

    // Generate a new Ed25519 key pair
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

    const pair: InitializationKeyPair = { privateKeyPem, publicKeyBase64 };
    writeFileSync(keysPath, JSON.stringify(pair, null, 2) + "\n", "utf-8");
    return pair;
}

/**
 * Sign the Initialization Certificate content.
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
 * Verify the signature of Initialization Certificate content.
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

/**
 * Parse a generated Markdown certificate and verify its cryptographic signature.
 */
export function verifyMarkdownCertificate(fullMarkdown: string): boolean {
    const splitMarker = "## Cryptographic Signature Verification";
    const parts = fullMarkdown.split(splitMarker);
    if (parts.length !== 2) {
        console.warn("[PRISM][security] Certificate Markdown split failed (marker not found)");
        return false;
    }
    const certContentToSign = parts[0]!.trim();
    const signatureSection = parts[1]!;

    // Extract Public Key and Signature using regex
    const pubKeyMatch = /- \*\*Public Key:\*\* ([A-Za-z0-9+/=]+)/.exec(signatureSection);
    const sigMatch = /- \*\*Signature:\*\* ([A-Za-z0-9+/=]+)/.exec(signatureSection);

    if (!pubKeyMatch || !sigMatch) {
        console.warn("[PRISM][security] Failed to parse signature or public key from certificate markdown");
        return false;
    }

    const publicKeyBase64 = pubKeyMatch[1]!;
    const signatureBase64 = sigMatch[1]!;

    return verifyCertificateContent(certContentToSign, signatureBase64, publicKeyBase64);
}
