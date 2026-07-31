/**
 * Issuer Key Registry — Phase 0 & Phase 1 Trust Root Repair (IC-01, IC-02, IC-12)
 *
 * Maintains a pinned registry of Ed25519 issuer keys used to sign
 * Initialization Certificates. Each entry records the key's fingerprint
 * (SHA-256 of the raw SPKI DER), lifecycle status, timestamps, and rotation lineage.
 *
 * Persisted as `initialization_key_registry.json` in workspace config.
 *
 * @module core/security/key-registry
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspacePath } from "../config/workspace-resolver.js";

export type IssuerKeyStatus = "active" | "revoked" | "compromised";

export interface IssuerKeyEntry {
    /** Deterministic key identifier: SHA-256 fingerprint of SPKI DER bytes prefix. */
    readonly keyId: string;
    /** Base64-encoded SPKI DER public key. */
    readonly publicKeyBase64: string;
    /** SHA-256 hex fingerprint of the raw SPKI DER bytes. */
    readonly fingerprint: string;
    /** Lifecycle status. */
    status: IssuerKeyStatus;
    /** ISO-8601 timestamp when registered. */
    readonly createdAt: string;
    /** ISO-8601 timestamp when revoked. Null if active. */
    revokedAt: string | null;
    /** Human-readable reason for revocation. */
    revocationReason: string | null;
    /** Key ID of the previous key this key supersedes in rotation lineage. */
    supersedesKeyId?: string | null;
}

export interface IssuerKeyRegistry {
    readonly version: 1;
    readonly keys: IssuerKeyEntry[];
}

const REGISTRY_FILE_NAME = "initialization_key_registry.json";

export function computeKeyFingerprint(publicKeyBase64: string): string {
    const der = Buffer.from(publicKeyBase64, "base64");
    return createHash("sha256").update(der).digest("hex");
}

export function getRegistryPath(): string {
    const configDir = process.env.PRISM_CONFIG_DIR?.trim() || workspacePath("config");
    return join(configDir, REGISTRY_FILE_NAME);
}

export function loadOrCreateRegistry(): IssuerKeyRegistry {
    const registryPath = getRegistryPath();

    if (existsSync(registryPath)) {
        try {
            const raw = readFileSync(registryPath, "utf-8");
            const parsed = JSON.parse(raw) as IssuerKeyRegistry;
            if (parsed.version === 1 && Array.isArray(parsed.keys)) {
                return parsed;
            }
        } catch {}
    }

    return { version: 1, keys: [] };
}

export function saveRegistry(registry: IssuerKeyRegistry): void {
    const registryPath = getRegistryPath();
    writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

export function registerKey(
    registry: IssuerKeyRegistry,
    publicKeyBase64: string,
    supersedesKeyId?: string | null,
): IssuerKeyEntry {
    const fingerprint = computeKeyFingerprint(publicKeyBase64);
    const existing = registry.keys.find((k) => k.fingerprint === fingerprint);
    if (existing) return existing;

    const entry: IssuerKeyEntry = {
        keyId: fingerprint.slice(0, 16),
        publicKeyBase64,
        fingerprint,
        status: "active",
        createdAt: new Date().toISOString(),
        revokedAt: null,
        revocationReason: null,
        supersedesKeyId: supersedesKeyId ?? null,
    };

    registry.keys.push(entry);
    return entry;
}

export function revokeKey(
    registry: IssuerKeyRegistry,
    fingerprint: string,
    reason: string,
    status: "revoked" | "compromised" = "revoked",
): boolean {
    const entry = registry.keys.find((k) => k.fingerprint === fingerprint || k.keyId === fingerprint);
    if (!entry) return false;
    if (entry.status !== "active") return false;

    entry.status = status;
    entry.revokedAt = new Date().toISOString();
    entry.revocationReason = reason;
    return true;
}

export function getActiveKey(registry: IssuerKeyRegistry): IssuerKeyEntry | null {
    const active = registry.keys.filter((k) => k.status === "active");
    if (active.length === 0) return null;
    return active[active.length - 1]!;
}

export function isKeyTrusted(
    registry: IssuerKeyRegistry,
    publicKeyBase64: string,
): { trusted: boolean; reason: string } {
    const fingerprint = computeKeyFingerprint(publicKeyBase64);
    const entry = registry.keys.find((k) => k.fingerprint === fingerprint);

    if (!entry) {
        return { trusted: false, reason: `Unknown issuer key: fingerprint ${fingerprint.slice(0, 16)} not in registry` };
    }

    if (entry.status === "compromised") {
        return { trusted: false, reason: `Issuer key ${entry.keyId} is marked as compromised: ${entry.revocationReason}` };
    }

    if (entry.status === "revoked") {
        return { trusted: false, reason: `Issuer key ${entry.keyId} is revoked: ${entry.revocationReason}` };
    }

    return { trusted: true, reason: `Issuer key ${entry.keyId} is active` };
}

export interface KeyRotationResult {
    oldKey: IssuerKeyEntry | null;
    newKey: IssuerKeyEntry;
    registry: IssuerKeyRegistry;
}

/**
 * IC-01, IC-12: Perform an audited key rotation ceremony.
 * Revokes the current active key with the provided reason and registers a new active key
 * with explicit lineage tracking (`supersedesKeyId`).
 */
export function performKeyRotationCeremony(
    newPublicKeyBase64: string,
    reason: string,
    status: "revoked" | "compromised" = "compromised",
): KeyRotationResult {
    const registry = loadOrCreateRegistry();
    const oldKey = getActiveKey(registry);

    if (oldKey) {
        revokeKey(registry, oldKey.fingerprint, reason, status);
    }

    const newKey = registerKey(registry, newPublicKeyBase64, oldKey?.keyId ?? null);
    saveRegistry(registry);

    console.log(
        `[PRISM][security] Key rotation ceremony completed. Old key: ${oldKey ? oldKey.keyId : "none"} (${status}), ` +
        `New key: ${newKey.keyId} (supersedes: ${newKey.supersedesKeyId || "none"}). Reason: "${reason}"`,
    );

    return { oldKey, newKey, registry };
}
