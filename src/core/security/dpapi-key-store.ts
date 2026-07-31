/**
 * Windows DPAPI Key Protection Module — Phase 1 Trust Root Repair (IC-01)
 *
 * Provides OS-backed non-exportable key storage for the Ed25519 issuer private key.
 * On Windows, private keys are encrypted using Windows Data Protection API (DPAPI)
 * with `DataProtectionScope.CurrentUser` via .NET `ProtectedData`.
 *
 * All string payloads are Base64 encoded when passed to PowerShell to preserve
 * exact character sequences and line breaks without escaping bugs.
 *
 * @module core/security/dpapi-key-store
 */

import { execSync } from "node:child_process";

const IS_WINDOWS = process.platform === "win32";

/**
 * Protect (encrypt) a plaintext PEM private key using Windows DPAPI.
 * Returns Base64-encoded encrypted cipher text.
 */
export function protectPrivateKeyPEM(plaintextPem: string): string {
    if (!IS_WINDOWS) {
        console.warn(
            "[PRISM][security] Platform is not Windows — DPAPI key encryption unavailable. " +
            "Falling back to ACL-restricted file permissions (IC-01).",
        );
        return plaintextPem;
    }

    try {
        const b64Input = Buffer.from(plaintextPem, "utf-8").toString("base64");
        const script = [
            "Add-Type -AssemblyName System.Security",
            `$bytes = [System.Convert]::FromBase64String('${b64Input}')`,
            "$entropy = [System.Text.Encoding]::UTF8.GetBytes('PRISM-Refraction-IssuerKey-Entropy-v1')",
            "$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
            "[System.Convert]::ToBase64String($protected)",
        ].join("; ");

        const result = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        }).trim();

        if (!result) {
            throw new Error("PowerShell DPAPI protection returned empty output");
        }

        return result;
    } catch (err) {
        console.warn(
            "[PRISM][security] DPAPI key protection failed, falling back to ACL-restricted raw PEM:",
            (err as Error).message,
        );
        return plaintextPem;
    }
}

/**
 * Unprotect (decrypt) a Base64-encoded encrypted key ciphertext using Windows DPAPI.
 * Returns the decrypted plaintext PEM.
 */
export function unprotectPrivateKeyPEM(ciphertextBase64: string): string {
    if (!IS_WINDOWS) {
        return ciphertextBase64;
    }

    // If it's already a raw PEM format, return as-is (legacy fallback)
    if (ciphertextBase64.includes("-----BEGIN PRIVATE KEY-----")) {
        return ciphertextBase64;
    }

    try {
        const script = [
            "Add-Type -AssemblyName System.Security",
            `$bytes = [System.Convert]::FromBase64String('${ciphertextBase64.trim()}')`,
            "$entropy = [System.Text.Encoding]::UTF8.GetBytes('PRISM-Refraction-IssuerKey-Entropy-v1')",
            "$unprotected = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
            "[System.Convert]::ToBase64String($unprotected)",
        ].join("; ");

        const resultB64 = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        }).trim();

        const result = Buffer.from(resultB64, "base64").toString("utf-8");

        if (!result || !result.includes("-----BEGIN PRIVATE KEY-----")) {
            throw new Error("DPAPI unprotect output does not contain valid PEM key header");
        }

        return result;
    } catch (err) {
        throw new Error(`Failed to decrypt DPAPI-protected private key: ${(err as Error).message}`);
    }
}
