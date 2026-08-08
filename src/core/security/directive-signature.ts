import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIRECTIVE_FILENAME = "Permanent_Active_Directives.txt";
const SIGNATURE_FILENAME = "permanent-active-directives.signature.json";
const KEYS_FILENAME = "governance-signing-keys.json";

export interface GovernanceSigningKey {
    keyId: string;
    algorithm: "ed25519";
    publicKeyBase64: string;
    addedAt?: string;
    expiresAt?: string | null;
    revokedAt?: string | null;
}

export interface GovernanceSigningKeySet {
    version: number;
    keys: GovernanceSigningKey[];
}

export interface DirectiveSignatureFile {
    keyId: string;
    algorithm: "ed25519";
    signedAt: string;
    file: string;
    sha256: string;
    signatureBase64: string;
    formatVersion: 1;
}

export interface DirectiveSignatureResult {
    valid: boolean;
    signatureVerified: boolean;
    hashMatches: boolean;
    keyId: string | null;
    currentHash: string;
    expectedHash: string;
    signatureDigest: string;
    directivePath: string;
    signaturePath: string;
    keysPath: string;
    verifiedAt: string;
    error?: string;
}

export interface DirectiveSignatureBootGateOptions {
    workspaceRoot?: string;
    bypassEnvVar?: string;
}

function isTruthy(value: string | undefined): boolean {
    return value === "1" || value === "true" || value === "yes" || value === "on";
}

function resolveWorkspaceRoot(workspaceRoot?: string): string {
    if (workspaceRoot) {
        return workspaceRoot;
    }

    let currentDir = dirname(fileURLToPath(import.meta.url));
    while (currentDir !== "/" && !currentDir.match(/^[a-zA-Z]:\\$/)) {
        if (existsSync(join(currentDir, "package.json"))) {
            return currentDir;
        }
        currentDir = dirname(currentDir);
    }

    return process.cwd();
}

function computeSha256(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

function readJsonFile<T>(filePath: string): T {
    const content = readFileSync(filePath, "utf8");
    return JSON.parse(content) as T;
}

function getActiveKey(keySet: GovernanceSigningKeySet, keyId: string): GovernanceSigningKey | undefined {
    const key = keySet.keys.find((candidate) => candidate.keyId === keyId && candidate.algorithm === "ed25519");
    if (!key) {
        return undefined;
    }
    if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) {
        return undefined;
    }
    if (key.revokedAt) {
        return undefined;
    }
    return key;
}

export function verifyDirectiveSignature(workspaceRoot?: string): DirectiveSignatureResult {
    const root = resolveWorkspaceRoot(workspaceRoot);
    const directivePath = join(root, DIRECTIVE_FILENAME);
    const signaturePath = join(root, "config", SIGNATURE_FILENAME);
    const keysPath = join(root, "config", KEYS_FILENAME);
    const verifiedAt = new Date().toISOString();

    const base: Omit<DirectiveSignatureResult, "valid" | "signatureVerified" | "hashMatches"> = {
        keyId: null,
        currentHash: "",
        expectedHash: "",
        signatureDigest: "",
        directivePath,
        signaturePath,
        keysPath,
        verifiedAt,
    };

    if (!existsSync(directivePath)) {
        return {
            valid: false,
            signatureVerified: false,
            hashMatches: false,
            ...base,
            error: `Directive file not found: ${directivePath}`,
        };
    }

    if (!existsSync(signaturePath)) {
        return {
            valid: false,
            signatureVerified: false,
            hashMatches: false,
            ...base,
            error: `Directive signature file not found: ${signaturePath}`,
        };
    }

    if (!existsSync(keysPath)) {
        return {
            valid: false,
            signatureVerified: false,
            hashMatches: false,
            ...base,
            error: `Governance keys file not found: ${keysPath}`,
        };
    }

    try {
        const directiveContent = readFileSync(directivePath, "utf8");
        const currentHash = computeSha256(directiveContent);
        const signatureContent = readFileSync(signaturePath, "utf8");
        const signatureDigest = computeSha256(signatureContent);
        const signatureFile = JSON.parse(signatureContent) as DirectiveSignatureFile;
        const keySet = readJsonFile<GovernanceSigningKeySet>(keysPath);
        const key = getActiveKey(keySet, signatureFile.keyId);

        if (!key) {
            return {
                valid: false,
                signatureVerified: false,
                hashMatches: false,
                ...base,
                keyId: signatureFile.keyId,
                currentHash,
                expectedHash: signatureFile.sha256,
                signatureDigest,
                error: `No active governance key found for keyId=${signatureFile.keyId}`,
            };
        }

        const hashMatches = currentHash === signatureFile.sha256;
        if (!hashMatches) {
            return {
                valid: false,
                signatureVerified: false,
                hashMatches: false,
                ...base,
                keyId: signatureFile.keyId,
                currentHash,
                expectedHash: signatureFile.sha256,
                signatureDigest,
                error: "Directive hash mismatch against signed payload.",
            };
        }

        const publicKeyDer = Buffer.from(key.publicKeyBase64, "base64");
        const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
        const signatureBuffer = Buffer.from(signatureFile.signatureBase64, "base64");
        const contentBuffer = Buffer.from(directiveContent, "utf8");
        const signatureVerified = verify(null, contentBuffer, publicKey, signatureBuffer);

        return {
            valid: signatureVerified,
            signatureVerified,
            hashMatches,
            ...base,
            keyId: signatureFile.keyId,
            currentHash,
            expectedHash: signatureFile.sha256,
            signatureDigest,
            error: signatureVerified ? undefined : "Directive signature verification failed.",
        };
    } catch (err) {
        return {
            valid: false,
            signatureVerified: false,
            hashMatches: false,
            ...base,
            error: `Failed to verify directive signature: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

export function enforceDirectiveSignatureBootGate(
    options: DirectiveSignatureBootGateOptions = {},
): DirectiveSignatureResult {
    const bypassEnvVar = options.bypassEnvVar ?? "PRISM_SKIP_DIRECTIVE_SIGNATURE_BOOT_GATE";
    const bypassRequested = isTruthy(process.env[bypassEnvVar]?.toLowerCase());
    const isProduction = process.env.NODE_ENV === "production";
    const result = verifyDirectiveSignature(options.workspaceRoot);

    if (bypassRequested && isProduction) {
        throw new Error(`[PRISM][boot-gate] ${bypassEnvVar}=true is not permitted in production. Refusing startup.`);
    }

    if (!result.valid && !bypassRequested) {
        const reason = result.error ?? "unknown signature verification failure";
        throw new Error(`[PRISM][boot-gate] Directive signature check failed: ${reason}`);
    }

    if (!result.valid && bypassRequested) {
        console.warn(
            `[PRISM][boot-gate] Directive signature check failed but bypassed via ${bypassEnvVar}=true (non-production).`,
        );
    }

    return result;
}
