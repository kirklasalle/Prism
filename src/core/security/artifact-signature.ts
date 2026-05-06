/**
 * Phase F-F — Release Artifact Signing
 *
 * Ed25519 detached signatures over SHA-256 digests of release binaries
 * and plugin packs. Mirrors the existing PluginPackValidator key model
 * (PEM private keys + base64 SPKI public keys + key registry) so the
 * same operational SOP from `docs/SECURITY_KEY_MANAGEMENT.md` applies.
 *
 * Sidecar files emitted alongside the artifact:
 *   <artifact>.sig       — base64-encoded 64-byte Ed25519 signature
 *   <artifact>.sig.json  — keyId / algorithm / signedAt / sha256 manifest
 *
 * @module core/security/artifact-signature
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface ArtifactSignatureManifest {
    /** Stable identifier of the signing key (matches registry entry). */
    keyId: string;
    /** Always `"ed25519"` for the v1 release artifact format. */
    algorithm: "ed25519";
    /** ISO-8601 timestamp the signature was produced. */
    signedAt: string;
    /** Hex-encoded SHA-256 digest of the artifact bytes. */
    sha256: string;
    /** Original artifact filename (basename only — informational). */
    artifact: string;
    /** Format version of this sidecar. */
    formatVersion: 1;
}

export interface ReleaseSigningKeyEntry {
    keyId: string;
    /** `release` is the new tier added by Phase F-F. */
    tier: "release" | "official" | "community";
    label?: string;
    algorithm: "ed25519";
    publicKeyBase64: string;
    addedAt?: string;
    expiresAt?: string | null;
    revokedAt?: string | null;
}

export interface ReleaseSigningKeyRegistry {
    version?: number;
    keys: ReleaseSigningKeyEntry[];
}

export function sha256Hex(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Sign an artifact buffer with an Ed25519 PEM private key. Returns the
 * detached signature (Buffer) and the manifest sidecar payload.
 */
export function signArtifact(
    artifactBytes: Buffer,
    privateKeyPem: string,
    keyId: string,
    artifactName: string,
): { signature: Buffer; manifest: ArtifactSignatureManifest } {
    const key = createPrivateKey(privateKeyPem);
    const digest = sha256Hex(artifactBytes);
    const signature = sign(null, artifactBytes, key);
    const manifest: ArtifactSignatureManifest = {
        keyId,
        algorithm: "ed25519",
        signedAt: new Date().toISOString(),
        sha256: digest,
        artifact: artifactName,
        formatVersion: 1,
    };
    return { signature, manifest };
}

/**
 * Verify a detached Ed25519 signature over the artifact bytes using a
 * base64-encoded SPKI public key (matching the registry format).
 */
export function verifyArtifactSignature(
    artifactBytes: Buffer,
    signature: Buffer,
    publicKeyBase64: string,
): boolean {
    const der = Buffer.from(publicKeyBase64, "base64");
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return verify(null, artifactBytes, key, signature);
}

/** Load and JSON-parse a release-signing key registry file. */
export function loadReleaseSigningKeyRegistry(path: string): ReleaseSigningKeyRegistry {
    if (!existsSync(path)) {
        throw new Error(`release signing key registry not found at ${path}`);
    }
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as ReleaseSigningKeyRegistry;
    if (!parsed || !Array.isArray(parsed.keys)) {
        throw new Error(`malformed release signing key registry at ${path}`);
    }
    return parsed;
}

/** Locate a key entry by keyId; returns null if missing or revoked. */
export function findReleaseKey(
    registry: ReleaseSigningKeyRegistry,
    keyId: string,
): ReleaseSigningKeyEntry | null {
    const found = registry.keys.find((k) => k.keyId === keyId) ?? null;
    if (!found) return null;
    if (found.revokedAt) return null;
    return found;
}

/**
 * Verify an artifact + sidecar pair against a registry. Returns a
 * structured verdict with reason — never throws on a bad signature.
 */
export function verifyArtifactWithSidecar(opts: {
    artifactBytes: Buffer;
    signature: Buffer;
    manifest: ArtifactSignatureManifest;
    registry: ReleaseSigningKeyRegistry;
}): { ok: boolean; reason: string; keyId: string } {
    const { artifactBytes, signature, manifest, registry } = opts;
    if (manifest.algorithm !== "ed25519") {
        return { ok: false, reason: `unsupported algorithm: ${manifest.algorithm}`, keyId: manifest.keyId };
    }
    const expectedDigest = sha256Hex(artifactBytes);
    if (expectedDigest !== manifest.sha256) {
        return { ok: false, reason: "artifact digest does not match manifest", keyId: manifest.keyId };
    }
    const key = findReleaseKey(registry, manifest.keyId);
    if (!key) {
        return { ok: false, reason: `keyId not found or revoked: ${manifest.keyId}`, keyId: manifest.keyId };
    }
    const valid = verifyArtifactSignature(artifactBytes, signature, key.publicKeyBase64);
    return {
        ok: valid,
        reason: valid ? "signature valid" : "signature verification failed",
        keyId: manifest.keyId,
    };
}

/** Convenience helper for CLI scripts. */
export function writeSidecars(artifactPath: string, signature: Buffer, manifest: ArtifactSignatureManifest): {
    sigPath: string;
    manifestPath: string;
} {
    const sigPath = `${artifactPath}.sig`;
    const manifestPath = `${artifactPath}.sig.json`;
    writeFileSync(sigPath, signature.toString("base64") + "\n", "utf-8");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    return { sigPath, manifestPath };
}
